import socketio
from sqlalchemy import or_, and_
import redis.asyncio as redis_async
from datetime import datetime, timezone

from app import models, schemas
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.auth import get_user_from_environ


# Socket.IO setup
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

redis_client = redis_async.from_url(settings.REDIS_URL, decode_responses=True)

@sio.event
async def connect(sid, environ):
    user_id = await get_user_from_environ(environ)
    if not user_id:
        return False
    async with sio.session(sid) as session:
        session['user_id'] = int(user_id)
    await sio.enter_room(sid, str(user_id))
    
    # Track presence in Redis
    conn_count = await redis_client.incr(f"user:{user_id}:connections")
    if conn_count == 1:
        await redis_client.sadd("online_users", user_id)
        await sio.emit('presence', {'user_id': user_id, 'status': 'online'})

@sio.event
async def request_presence(sid):
    online_users = await redis_client.smembers("online_users")
    await sio.emit('presence_sync', list(online_users), room=sid)
    await sio.emit('signaling_ready', room=sid)



@sio.event
async def disconnect(sid):
    try:
        session = await sio.get_session(sid)
        user_id = session.get('user_id')
        if user_id:
            conn_count = await redis_client.decr(f"user:{user_id}:connections")
            if conn_count <= 0:
                await redis_client.delete(f"user:{user_id}:connections")
                await redis_client.srem("online_users", user_id)
                await sio.emit('presence', {'user_id': user_id, 'status': 'offline'})
    except Exception as e:
        print(f"Disconnect error: {e}")


@sio.event
async def typing(sid, data):
    async with sio.session(sid) as session:
        user_id = session.get('user_id')
    if not user_id: return
    receiver_id = data.get('receiver_id')
    if receiver_id:
        data['sender_id'] = int(user_id)
        await sio.emit('typing', data, room=str(receiver_id))


@sio.event
async def webrtc_offer(sid, data):
    async with sio.session(sid) as session:
        user_id = session.get('user_id')
    if not user_id: return
    receiver_id = data.get('receiver_id')
    if receiver_id:
        data['sender_id'] = int(user_id)
        await sio.emit('webrtc_offer', data, room=str(receiver_id))


@sio.event
async def webrtc_answer(sid, data):
    async with sio.session(sid) as session:
        user_id = session.get('user_id')
    if not user_id: return
    receiver_id = data.get('receiver_id')
    if receiver_id:
        data['sender_id'] = int(user_id)
        await sio.emit('webrtc_answer', data, room=str(receiver_id))


@sio.event
async def webrtc_ice_candidate(sid, data):
    async with sio.session(sid) as session:
        user_id = session.get('user_id')
    if not user_id: return
    receiver_id = data.get('receiver_id')
    if receiver_id:
        data['sender_id'] = int(user_id)
        await sio.emit('webrtc_ice_candidate', data, room=str(receiver_id))


@sio.event
async def webrtc_end(sid, data):
    async with sio.session(sid) as session:
        user_id = session.get('user_id')
    if not user_id: return
    receiver_id = data.get('receiver_id')
    if receiver_id:
        data['sender_id'] = int(user_id)
        await sio.emit('webrtc_end', data, room=str(receiver_id))


@sio.event
async def webrtc_upgrade_request(sid, data):
    async with sio.session(sid) as session:
        user_id = session.get('user_id')
    if not user_id: return
    receiver_id = data.get('receiver_id')
    if receiver_id:
        data['sender_id'] = int(user_id)
        await sio.emit('webrtc_upgrade_request', data, room=str(receiver_id))


@sio.event
async def webrtc_upgrade_response(sid, data):
    async with sio.session(sid) as session:
        user_id = session.get('user_id')
    if not user_id: return
    receiver_id = data.get('receiver_id')
    if receiver_id:
        data['sender_id'] = int(user_id)
        await sio.emit('webrtc_upgrade_response', data, room=str(receiver_id))


# --- Chat Operations ---


@sio.event
async def send(sid, data):
    async with sio.session(sid) as session:
        user_id = session.get('user_id')
    if not user_id: return
    
    receiver_id = data.get('receiver_id')
    if not receiver_id: return
    
    with SessionLocal() as db:
        blocking = db.query(models.BlockedUser).filter(
            or_(
                and_(models.BlockedUser.user_id == user_id, models.BlockedUser.blocked_contact_id == receiver_id),
                and_(models.BlockedUser.user_id == receiver_id, models.BlockedUser.blocked_contact_id == user_id)
            )
        ).first()
        if blocking:
            return
            
        now_utc = datetime.now(timezone.utc)
        
        new_msg = models.Message(
            sender_id=user_id,
            receiver_id=receiver_id,
            content=data.get('content'),
            file_data=data.get('file_data'),
            file_type=data.get('file_type'),
            reply_to_id=data.get('reply_to_id'),
            updated_at=now_utc
        )
        
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user:
            user.last_seen = now_utc
            
        db.add(new_msg)
        db.commit()
        db.refresh(new_msg)
        
        response_data = schemas.MessageResponse.model_validate(new_msg).model_dump()
        for k, v in response_data.items():
            if isinstance(v, datetime):
                response_data[k] = v.isoformat()
        await sio.emit('receive_message', response_data, room=str(receiver_id))
        await sio.emit('receive_message', response_data, room=str(user_id))


@sio.event
async def edit(sid, data):
    async with sio.session(sid) as session:
        user_id = session.get('user_id')
    if not user_id: return
    
    message_id = data.get('id')
    if not message_id: return
    
    with SessionLocal() as db:
        msg = db.query(models.Message).filter(
            models.Message.id == message_id,
            models.Message.sender_id == user_id
        ).first()
        
        if not msg: return
        
        now_utc = datetime.now(timezone.utc)
        msg.content = data.get('content')
        msg.is_edited = True
        msg.edited_at = now_utc
        msg.updated_at = now_utc
        db.commit()
        db.refresh(msg)
        
        response_data = schemas.MessageResponse.model_validate(msg).model_dump()
        for k, v in response_data.items():
            if isinstance(v, datetime):
                response_data[k] = v.isoformat()
        await sio.emit('edit', response_data, room=str(msg.receiver_id))
        await sio.emit('edit', response_data, room=str(user_id))


@sio.event
async def delete(sid, data):
    async with sio.session(sid) as session:
        user_id = session.get('user_id')
    if not user_id: return
    
    message_id = data.get('id')
    if not message_id: return
    
    with SessionLocal() as db:
        msg = db.query(models.Message).filter(
            models.Message.id == message_id,
            models.Message.sender_id == user_id
        ).first()
        
        if not msg: return
        
        now_utc = datetime.now(timezone.utc)
        msg.is_deleted = True
        msg.updated_at = now_utc
        receiver_id = msg.receiver_id
        db.commit()
        await sio.emit('delete', {"id": message_id}, room=str(receiver_id))
        await sio.emit('delete', {"id": message_id}, room=str(user_id))


@sio.event
async def mark_read(sid, data):
    session = await sio.get_session(sid)
    user_id = session.get('user_id')
    if not user_id: return
    
    raw_contact_id = data.get('contact_id')
    if not raw_contact_id: return
    
    try:
        contact_id = int(raw_contact_id)
    except (ValueError, TypeError):
        return
    
    with SessionLocal() as db:
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

        now_utc = datetime.now(timezone.utc)
        affected = db.query(models.Message).filter(
            models.Message.id.in_(msg_ids)
        ).update(
            {
                models.Message.is_read: True,
                models.Message.updated_at: now_utc
            },
            synchronize_session=False
        )
        db.commit()
        
        # Notify the sender (to update blue checkmarks)
        await sio.emit('read_receipt', {
            'contact_id': int(user_id),
            'message_ids': msg_ids
        }, room=str(contact_id))
        
        # Notify the reader's other tabs (to clear unread badges)
        await sio.emit('read_receipt', {
            'contact_id': int(contact_id),
            'message_ids': msg_ids,
            'is_self_sync': True
        }, room=str(user_id))
