from jose import jwt
from typing import List
from sqlalchemy.orm import aliased
from sqlalchemy import case, func, or_, and_
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, status, Request, Response, \
        HTTPException, BackgroundTasks, Form

from app import models, schemas
from app.core import auth, deps
from app.core.config import settings
from app.services import backgound_jobs
from app.core.email import send_password_reset_email

from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.twiml.voice_response import VoiceResponse, Dial, Client


router = APIRouter(prefix="/api")


# --- Auth Endpoint ---


@router.post(
    "/register", 
    response_model=schemas.UserResponse, 
    tags=[settings.AUTH_TAG]
)
def register(
    user: schemas.UserCreate, 
    response: Response, 
    db: deps.db_session
):
    db_user = db.query(models.User).filter((
        models.User.email == user.email
    ) | (
        models.User.mobile_number == user.mobile_number
    )).first()
    
    if db_user:
        raise HTTPException(
            status_code=400, 
            detail="Mobile number or Email already registered"
        )
    
    hashed_password = auth.get_password_hash(user.password)
    new_user = models.User(
        mobile_number=user.mobile_number,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        password_hash=hashed_password,
        public_key=user.public_key,
        encrypted_private_key=user.encrypted_private_key,
        encrypted_dek=user.encrypted_dek,
        keys_salt=user.keys_salt,
        dek_iv=user.dek_iv,
        priv_key_iv=user.priv_key_iv
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Auto login
    token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": str(new_user.id)}, expires_delta=token_expires
    )
    
    response.set_cookie(
        key="access_token", 
        value=f"Bearer {access_token}", 
        httponly=True,
        samesite="lax",
        secure=True  # Switch to True in a production HTTPS environment
    )
    
    return new_user


@router.post("/login", tags=[settings.AUTH_TAG])
def login(
    login_data: schemas.UserLogin, 
    response: Response, 
    db: deps.db_session
):
    user = db.query(models.User).filter(
        models.User.mobile_number == login_data.mobile_number
    ).first()
    if not user or not auth.verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Incorrect mobile number or password"
        )
    
    token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": str(user.id)}, expires_delta=token_expires
    )
    
    response.set_cookie(
        key="access_token", 
        value=f"Bearer {access_token}", 
        httponly=True,
        samesite="lax",
        secure=True  # Switch to True in a production HTTPS environment
    )
    
    return {
        "access_token": access_token, 
        "token_type": "bearer", 
        "user_id": user.id,
        "encrypted_private_key": user.encrypted_private_key,
        "encrypted_dek": user.encrypted_dek,
        "keys_salt": user.keys_salt,
        "dek_iv": user.dek_iv,
        "priv_key_iv": user.priv_key_iv
    }


@router.post("/logout", tags=[settings.AUTH_TAG])
def logout(response: Response):
    response.delete_cookie(
        key="access_token",
        samesite="lax",
        secure=True  # Switch to True in a production HTTPS environment
    )
    return {"msg": "Successfully logged out"}


# --- Forgot Password Endpoints ---


@router.post("/forgot-password", tags=[settings.AUTH_TAG])
async def forgot_password(
    req: schemas.ForgotPasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: deps.db_session
):
    user = db.query(models.User).filter(models.User.email == req.email).first()
    if user:
        # Create token valid for 15 mins with a specific reset scope
        expires = timedelta(minutes=15)
        to_encode = {"sub": str(user.id), "scope": "reset_password"}
        token = auth.create_access_token(
            data=to_encode,
            expires_delta=expires
        )
        
        # Get request host for the email link
        host = str(request.base_url).strip("/")
        background_tasks.add_task(send_password_reset_email, user.email, token, host)
        return {'msg': "Password reset link sent."}
    
    else:
        return {"msg": "Your email is not registered."}


@router.post("/reset-password", tags=[settings.AUTH_TAG])
async def reset_password(
    req: schemas.ResetPasswordRequest,
    db: deps.db_session
):
    try:
        payload = jwt.decode(
            req.token, 
            settings.SECRET_KEY, 
            algorithms=[settings.ALGORITHM]
        )
        
        user_id = payload.get("sub")
        scope = payload.get("scope")
        if not user_id or scope != "reset_password":
            raise ValueError()
    
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")

    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Update user fields
    user.password_hash = auth.get_password_hash(req.new_password)
    user.public_key = req.public_key
    user.encrypted_private_key = req.encrypted_private_key
    user.encrypted_dek = req.encrypted_dek
    user.keys_salt = req.keys_salt
    user.dek_iv = req.dek_iv
    user.priv_key_iv = req.priv_key_iv

    db.commit()
    return {"msg": "Password successfully reset."}


# --- Profile and User Search Endpoints ---


@router.get(
    "/profile", 
    response_model=schemas.UserResponse, 
    tags=[settings.PROFILE_TAG]
)
def get_profile(request: Request, db: deps.db_session):
    user = deps.get_current_user(request, db)
    return user


@router.patch(
    "/profile", 
    response_model=schemas.UserResponse, 
    tags=[settings.PROFILE_TAG]
)
def update_profile(
    user_update: schemas.UserUpdate, 
    request: Request, 
    db: deps.db_session
):
    user = deps.get_current_user(request, db)
    if user_update.first_name is not None:
        user.first_name = user_update.first_name
    
    if user_update.last_name is not None:
        user.last_name = user_update.last_name
    
    if user_update.profile_pic is not None:
        user.profile_pic = user_update.profile_pic
    
    db.commit()
    db.refresh(user)
    return user


@router.post("/profile/password", tags=[settings.PROFILE_TAG])
def update_password(
    pw_update: schemas.UserUpdatePassword, 
    request: Request, 
    db: deps.db_session
):
    user = deps.get_current_user(request, db)
    if not auth.verify_password(pw_update.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect old password")
    
    user.password_hash = auth.get_password_hash(pw_update.new_password)
    user.encrypted_dek = pw_update.encrypted_dek
    user.dek_iv = pw_update.dek_iv
    user.keys_salt = pw_update.keys_salt
    
    db.commit()
    return {"msg": "Password updated successfully"}


# --- Contacts Endpoint ---


@router.get(
    "/contacts", 
    response_model=List[schemas.ContactResponse], 
    tags=[settings.CONTACT_TAG]
)
def get_contacts(
    request: Request,
    db: deps.db_session,
    query: str | None = None,
    limit: int = 20,
    offset: int = 0
):
    current_user = deps.get_current_user(request, db)

    limit = min(limit, 100)

    # Identify the contact (other user)
    contact_case = case(
        (models.Message.sender_id == current_user.id, models.Message.receiver_id),
        else_=models.Message.sender_id
    ).label("contact_id")

    # ChatClear subquery
    chat_clear_subq = (
        db.query(
            models.ChatClear.contact_id,
            models.ChatClear.cleared_at
        )
        .filter(models.ChatClear.user_id == current_user.id)
        .subquery()
    )

    # Messages filtered by chat clear
    filtered_messages = (
        db.query(
            models.Message.id,
            models.Message.sender_id,
            models.Message.receiver_id,
            models.Message.content,
            models.Message.created_at,
            models.Message.is_read,
            contact_case
        )
        .outerjoin(
            chat_clear_subq,
            chat_clear_subq.c.contact_id == contact_case
        )
        .filter(
            or_(
                chat_clear_subq.c.cleared_at == None,
                models.Message.created_at > chat_clear_subq.c.cleared_at
            ),
            or_(
                models.Message.sender_id == current_user.id,
                models.Message.receiver_id == current_user.id
            ),
            models.Message.is_deleted == False
        )
        .subquery()
    )

    # Window function to get latest message per contact
    last_message_subq = (
        db.query(
            filtered_messages.c.contact_id,
            filtered_messages.c.content,
            filtered_messages.c.created_at,
            func.row_number().over(
                partition_by=filtered_messages.c.contact_id,
                order_by=filtered_messages.c.created_at.desc()
            ).label("rn")
        )
        .subquery()
    )

    last_message = (
        db.query(last_message_subq)
        .filter(last_message_subq.c.rn == 1)
        .subquery()
    )

    # Unread count
    unread_subq = (
        db.query(
            filtered_messages.c.sender_id.label("contact_id"),
            func.count(filtered_messages.c.id).label("unread_count")
        )
        .filter(
            filtered_messages.c.receiver_id == current_user.id,
            filtered_messages.c.is_read == False
        )
        .group_by(filtered_messages.c.sender_id)
        .subquery()
    )

    # Block checks
    blocked_by_me = aliased(models.BlockedUser)
    blocked_me = aliased(models.BlockedUser)

    results_query = (
        db.query(
            models.User,
            last_message.c.content,
            last_message.c.created_at,
            func.coalesce(unread_subq.c.unread_count, 0),
            (blocked_by_me.id != None).label("blocked_by_me"),
            (blocked_me.id != None).label("blocked_me")
        )
        .outerjoin(
            unread_subq,
            unread_subq.c.contact_id == models.User.id
        )
        .outerjoin(
            blocked_by_me,
            and_(
                blocked_by_me.user_id == current_user.id,
                blocked_by_me.blocked_contact_id == models.User.id
            )
        )
        .outerjoin(
            blocked_me,
            and_(
                blocked_me.user_id == models.User.id,
                blocked_me.blocked_contact_id == current_user.id
            )
        )
    )

    if query:
        # Strictly match only mobile number
        results_query = results_query.filter(
            models.User.id != current_user.id,
            models.User.mobile_number == query
        ).outerjoin(
            last_message,
            last_message.c.contact_id == models.User.id
        ).order_by(
            last_message.c.created_at.desc(), 
            models.User.first_name.asc(), 
            models.User.last_name.asc()
        )
    else:
        results_query = results_query.join(
            last_message,
            last_message.c.contact_id == models.User.id
        ).order_by(last_message.c.created_at.desc())

    results = results_query.limit(limit).offset(offset).all()

    contacts = []
    for user, last_msg, last_time, unread_cnt, by_me_flag, me_flag in results:
        contacts.append(
            schemas.ContactResponse(
                id=user.id,
                first_name=user.first_name,
                last_name=user.last_name,
                mobile_number=user.mobile_number,
                profile_pic=user.profile_pic,
                is_online=user.is_online,
                last_message=last_msg,
                last_message_at=last_time,
                public_key=user.public_key,
                blocked_by_me=by_me_flag,
                blocked_me=me_flag,
                unread_count=unread_cnt
            )
        )

    return contacts


@router.post("/contacts/block", tags=[settings.CONTACT_TAG])
def block_user(
    block_req: schemas.BlockUserRequest, 
    request: Request, 
    db: deps.db_session
):
    user = deps.get_current_user(request, db)
    # Check if already blocked
    existing = db.query(models.BlockedUser).filter(
        models.BlockedUser.user_id == user.id,
        models.BlockedUser.blocked_contact_id == block_req.blocked_contact_id
    ).first()
    if existing:
        return {"msg": "User already blocked"}
    
    new_block = models.BlockedUser(
        user_id=user.id,
        blocked_contact_id=block_req.blocked_contact_id
    )
    db.add(new_block)
    db.commit()
    return {"msg": "User blocked"}


@router.post("/contacts/unblock", tags=[settings.CONTACT_TAG])
def unblock_user(
    block_req: schemas.BlockUserRequest, 
    request: Request, 
    db: deps.db_session
):
    user = deps.get_current_user(request, db)
    db.query(models.BlockedUser).filter(
        models.BlockedUser.user_id == user.id,
        models.BlockedUser.blocked_contact_id == block_req.blocked_contact_id
    ).delete()
    db.commit()
    return {"msg": "User unblocked"}


# --- Messages Endpoint ---


@router.get(
    "/messages/{contact_id}", 
    response_model=List[schemas.MessageResponse], 
    tags=[settings.MESSAGE_TAG]
)
def get_messages(
    contact_id: int, 
    request: Request, 
    db: deps.db_session,
    limit: int = 50,
    offset: int = 0
):
    user = deps.get_current_user(request, db)
    
    # Cap limit for safety
    limit = min(limit, 100)
    
    # Check if user has cleared this chat
    c_record = db.query(models.ChatClear).filter(
        models.ChatClear.user_id == user.id,
        models.ChatClear.contact_id == contact_id
    ).first()

    # Construct base query for message filtering
    query = db.query(models.Message).filter(
        or_(
            and_(
                models.Message.sender_id == user.id,
                models.Message.receiver_id == contact_id
            ),
            and_(
                models.Message.sender_id == contact_id,
                models.Message.receiver_id == user.id
            )
        )
    ).filter(models.Message.is_deleted.isnot(True))

    # Apply filter if the chat was cleared
    if c_record:
        query = query.filter(models.Message.created_at > c_record.cleared_at)

    inner_q = query.order_by(
        models.Message.created_at.desc()
    ).limit(limit).offset(offset)
    
    # Use aliased to treat the subquery as the Message entity
    msg_alias = aliased(models.Message, inner_q.subquery())

    messages = db.query(msg_alias).order_by(msg_alias.created_at.asc()).all()
    
    return messages


@router.delete("/messages/{message_id}", tags=[settings.MESSAGE_TAG])
def delete_message(message_id: int, request: Request, db: deps.db_session):
    user = deps.get_current_user(request, db)
    msg = db.query(models.Message).filter(
        models.Message.id == message_id,
        models.Message.sender_id == user.id
    ).first()
    
    if not msg:
        raise HTTPException(
            status_code=404, 
            detail="Message not found or not authorized"
        )
    
    now_utc = datetime.now(timezone.utc)

    # Check 1-hour limit
    t_diff = now_utc - msg.created_at.replace(tzinfo=timezone.utc)
    if t_diff > timedelta(hours=1):
        raise HTTPException(
            status_code=400, 
            detail="Cannot delete message after 1 hour"
        )
    
    msg.is_deleted = True
    db.commit()
    return {"msg": "Message deleted"}


@router.post("/messages/clear/{contact_id}", tags=[settings.MESSAGE_TAG])
def clear_chat(
    contact_id: int, 
    request: Request, 
    db: deps.db_session,
    background_tasks: BackgroundTasks,
):
    user = deps.get_current_user(request, db)
    
    clear_record = db.query(models.ChatClear).filter(
        models.ChatClear.user_id == user.id,
        models.ChatClear.contact_id == contact_id
    ).first()
    
    now_utc = datetime.now(timezone.utc)
    
    if clear_record:
        clear_record.cleared_at = now_utc
    
    else:
        clear_record = models.ChatClear(
            user_id=user.id,
            contact_id=contact_id,
            cleared_at=now_utc
        )
        db.add(clear_record)
    
    db.commit()
    
    # Hard deleting both user cleared messages.
    background_tasks.add_task(
        backgound_jobs.delete_cleared_messages,
        contact_id, user.id, now_utc # Parameters
        )
    
    return {"msg": "Chat cleared"}


# --- Calling Endpoint ---


@router.get("/call/token", tags=[settings.MESSAGE_TAG])
def get_call_token(request: Request, db: deps.db_session):
    user = deps.get_current_user(request, db)
    
    access_token = AccessToken(
        settings.TWILIO_SID,
        settings.TWILIO_API_KEY,
        settings.TWILIO_SECRET,
        identity=str(user.id)
    )
    
    grant = VoiceGrant(
        outgoing_application_sid=settings.TWILIO_TWIML_APP_SID,
        incoming_allow=True
    )
    access_token.add_grant(grant)
    
    return {"token": access_token.to_jwt()}


@router.post("/call/voice", tags=[settings.MESSAGE_TAG])
async def handle_voice_webhook(To: str = Form(None)):
    response = VoiceResponse()
    if To:
        dial = Dial()
        dial.client(To)
        response.append(dial)
    else:
        response.say("Target user not provided.")
        
    return Response(content=str(response), media_type="application/xml")

