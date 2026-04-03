import socketio
from sqlalchemy import or_, and_
from datetime import datetime, timezone, timedelta

from app import models
from app.core import deps
from app.core.database import SessionLocal


# Create the Socket.IO server
# Create the Socket.IO server with faster heartbeat (ping) settings
sio = socketio.AsyncServer(
    async_mode='asgi',
    ping_timeout=10,    # How long to wait for a pong response
    ping_interval=10   # How often to send a ping
)


# Socket.IO app served from the mount root in main.py
sio_app = socketio.ASGIApp(sio, socketio_path='')


@sio.event
async def connect(sid, environ, auth=None):
    user_id = deps.get_current_websocket_user_id(
        environ=environ, socket_auth=auth
    )
    if not user_id:
        return False # Reject connection
        
    async with sio.session(sid) as session:
        session['user_id'] = user_id
        
    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user:
            user.last_seen = datetime.now(timezone.utc)
            user.socket_sid = sid
            db.commit()
            
            await sio.emit('presence', {
                "action": "presence",
                "user_id": user_id,
                "is_online": True
            })
    finally:
        db.close()


@sio.event
async def disconnect(sid):
    try:
        db = SessionLocal()
        user = db.query(models.User).filter(
            models.User.socket_sid == sid
        ).first()
        if user:
            user.last_seen = datetime.now(timezone.utc)
            if user.socket_sid == sid:
                user.socket_sid = None
            db.commit()
            
            await sio.emit('presence', {
                "action": "presence",
                "user_id": user.id,
                "is_online": False
            })
        
    finally:
        db.close()


@sio.event
async def send(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get('user_id')
    if not user_id:
        return
        
    receiver_id = data.get("receiver_id")
    content = data.get("content")
    file_data = data.get("file_data")
    file_type = data.get("file_type")
    reply_to_id = data.get("reply_to_id")
    
    db = SessionLocal()
    try:
        blocking_exists = db.query(models.BlockedUser).filter(
            or_(
                and_(models.BlockedUser.user_id == user_id,
                     models.BlockedUser.blocked_contact_id == receiver_id),
                and_(models.BlockedUser.user_id == receiver_id,
                     models.BlockedUser.blocked_contact_id == user_id)
            )
        ).first()

        if blocking_exists:
            err_payload = {
                "action": "error", 
                "message": "Message blocked. Unblock to continue."
            }
            await sio.emit('error', err_payload, to=sid)
            return
            
        new_msg = models.Message(
            sender_id=user_id,
            receiver_id=receiver_id,
            content=content,
            file_data=file_data,
            file_type=file_type,
            reply_to_id=reply_to_id
        )
        db.add(new_msg)
        
        receiver = db.query(models.User).filter(
            models.User.id == receiver_id
        ).first()

        db.commit()
        db.refresh(new_msg)
        
        out_payload = {
            "action": "receive",
            "id": new_msg.id,
            "sender_id": user_id,
            "receiver_id": receiver_id,
            "content": content,
            "file_data": file_data,
            "file_type": file_type,
            "reply_to_id": reply_to_id,
            "is_deleted": False,
            "is_edited": False,
            "created_at": new_msg.created_at.replace(tzinfo=timezone.utc).isoformat()
        }
        
        receiver = db.query(models.User).filter(models.User.id == receiver_id).first()
        if receiver and receiver.socket_sid:
            await sio.emit(
                'receive_message', out_payload, to=receiver.socket_sid
            )
            
        await sio.emit('receive_message', out_payload, to=sid)
    finally:
        db.close()


@sio.event
async def sync_presence(sid, data):
    """Broadcasts a request for all active clients to verify their presence."""
    await sio.emit('request_presence', {"requested_by": sid})


@sio.event
async def reply_presence(sid, data):
    """Receives a presence confirmation from a client and broadcasts it to everyone."""
    user_id = data.get("user_id")
    if user_id:
        await sio.emit('presence', {
            "action": "presence",
            "user_id": user_id,
            "is_online": True
        })


@sio.event
async def mark_read(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    if not user_id:
        return

    contact_id = data.get("contact_id")

    try:
        contact_id = int(contact_id)
    except (TypeError, ValueError):
        return

    db = SessionLocal()

    try:
        msg_ids = [
            m.id for m in db.query(models.Message.id).filter(
                models.Message.sender_id == contact_id,
                models.Message.receiver_id == user_id,
                models.Message.is_read == False,
                models.Message.is_deleted == False
            ).all()
        ]

        if not msg_ids:
            return

        db.query(models.Message).filter(
            models.Message.id.in_(msg_ids)
        ).update(
            {models.Message.is_read: True},
            synchronize_session=False
        )

        db.commit()

        receipt_payload = {
            "action": "read_receipt", 
            "contact_id": user_id, 
            "message_ids": msg_ids
        }
            
        sender = db.query(models.User).filter(
            models.User.id == contact_id
        ).first()
        if sender and sender.socket_sid:
            await sio.emit(
                'read_receipt', receipt_payload, to=sender.socket_sid
            )
    
    finally:
        db.close()


@sio.event
async def edit(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get('user_id')
    if not user_id:
        return
        
    message_id = int(data.get("id"))
    new_content = data.get("content")
    
    db = SessionLocal()
    try:
        now_utc = datetime.now(timezone.utc)

        msg = db.query(models.Message).filter(
            models.Message.id == message_id,
            models.Message.sender_id == user_id
        ).first()

        if msg:
            t_diff = now_utc - msg.created_at.replace(tzinfo=timezone.utc)
            if t_diff > timedelta(hours=1):
                err_payload = {
                    "action": "error", 
                    "message": "Cannot edit message after 1 hour"
                }
                await sio.emit('error', err_payload, to=sid)
                return

            msg.content = new_content
            msg.is_edited = True
            msg.edited_at = now_utc
            db.commit()
            
            out_payload = {
                "action": "edit",
                "id": message_id,
                "content": new_content,
                "receiver_id": msg.receiver_id,
                "sender_id": user_id
            }
            
            receiver = db.query(models.User).filter(
                models.User.id == msg.receiver_id
            ).first()
            if receiver and receiver.socket_sid:
                await sio.emit('edit', out_payload, to=receiver.socket_sid)
            await sio.emit('edit', out_payload, to=sid)
            
    finally:
        db.close()


@sio.event
async def delete(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get('user_id')
    if not user_id:
        return
        
    message_id = int(data.get("id"))
    
    db = SessionLocal()
    try:
        now_utc = datetime.now(timezone.utc)

        msg = db.query(models.Message).filter(
            models.Message.id == message_id,
            models.Message.sender_id == user_id
        ).first()
        
        if msg:
            t_diff = now_utc - msg.created_at.replace(tzinfo=timezone.utc)
            if t_diff > timedelta(hours=1):
                err_payload = {
                    "action": "error", 
                    "message": "Cannot delete message after 1 hour"
                }
                await sio.emit('error', err_payload, to=sid)
                return

            msg.is_deleted = True
            db.commit()
            
            out_payload = {
                "action": "delete",
                "id": message_id,
                "receiver_id": msg.receiver_id,
                "sender_id": user_id
            }
            
            receiver = db.query(models.User).filter(
                models.User.id == msg.receiver_id
            ).first()
            if receiver and receiver.socket_sid:
                await sio.emit('delete', out_payload, to=receiver.socket_sid)
            await sio.emit('delete', out_payload, to=sid)
            
    finally:
        db.close()


@sio.event
async def typing(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get('user_id')
    if not user_id:
        return
        
    receiver_id = data.get("receiver_id")
    is_typing = data.get("is_typing", True)
    
    db = SessionLocal()
    try:
        receiver = db.query(models.User).filter(
            models.User.id == receiver_id
        ).first()
        if receiver and receiver.socket_sid:
            await sio.emit('typing', {
                "sender_id": user_id,
                "is_typing": is_typing
            }, to=receiver.socket_sid)
    
    finally:
        db.close()


@sio.event
async def webrtc_offer(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get('user_id')
    if not user_id:
        return
        
    receiver_id = data.get("receiver_id")
    offer = data.get("offer")
    
    db = SessionLocal()
    try:
        receiver = db.query(models.User).filter(models.User.id == receiver_id).first()
        if receiver and receiver.socket_sid:
            await sio.emit('webrtc_offer', {
                "sender_id": user_id,
                "offer": offer
            }, to=receiver.socket_sid)
    finally:
        db.close()


@sio.event
async def webrtc_answer(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get('user_id')
    if not user_id:
        return
        
    receiver_id = data.get("receiver_id")
    answer = data.get("answer")
    
    db = SessionLocal()
    try:
        receiver = db.query(models.User).filter(models.User.id == receiver_id).first()
        if receiver and receiver.socket_sid:
            await sio.emit('webrtc_answer', {
                "sender_id": user_id,
                "answer": answer
            }, to=receiver.socket_sid)
    finally:
        db.close()


@sio.event
async def webrtc_ice_candidate(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get('user_id')
    if not user_id:
        return
        
    receiver_id = data.get("receiver_id")
    candidate = data.get("candidate")
    
    db = SessionLocal()
    try:
        receiver = db.query(models.User).filter(models.User.id == receiver_id).first()
        if receiver and receiver.socket_sid:
            await sio.emit('webrtc_ice_candidate', {
                "sender_id": user_id,
                "candidate": candidate
            }, to=receiver.socket_sid)
    finally:
        db.close()


@sio.event
async def webrtc_end(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get('user_id')
    if not user_id:
        return
        
    receiver_id = data.get("receiver_id")
    
    db = SessionLocal()
    try:
        receiver = db.query(models.User).filter(models.User.id == receiver_id).first()
        if receiver and receiver.socket_sid:
            await sio.emit('webrtc_end', {
                "sender_id": user_id
            }, to=receiver.socket_sid)
    finally:
        db.close()
