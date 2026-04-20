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
from app.core import webauthn_utils, redis_client


ONLINE_WINDOW = timedelta(minutes=2)
VALID_CALL_TYPES = {"audio", "video"}
VALID_CALL_STATUSES = {
    "initiated", "ringing", "accepted", "ended", "missed", "rejected"
}


router = APIRouter(prefix="/api")


def is_user_online(user: models.User, now_utc: datetime | None = None) -> bool:
    if not user.last_seen:
        return False

    now_utc = now_utc or datetime.now(timezone.utc)
    last_seen = user.last_seen
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)

    return (now_utc - last_seen) <= ONLINE_WINDOW


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
def logout(request: Request, response: Response, db: deps.db_session):
    user_id = auth.get_current_user_id(request)
    if user_id:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user:
            user.last_seen = None
            db.commit()

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
    return schemas.UserResponse.model_validate(user).model_copy(
        update={"is_online": is_user_online(user)}
    )


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
    
    # Allow initializing security fields if they are not already set
    if user_update.public_key is not None:
        user.public_key = user_update.public_key
    if user_update.encrypted_private_key is not None:
        user.encrypted_private_key = user_update.encrypted_private_key
    if user_update.encrypted_dek is not None:
        user.encrypted_dek = user_update.encrypted_dek
    if user_update.keys_salt is not None:
        user.keys_salt = user_update.keys_salt
    if user_update.dek_iv is not None:
        user.dek_iv = user_update.dek_iv
    if user_update.priv_key_iv is not None:
        user.priv_key_iv = user_update.priv_key_iv
    
    db.commit()
    db.refresh(user)
    return schemas.UserResponse.model_validate(user).model_copy(
        update={"is_online": is_user_online(user)}
    )


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
    now_utc = datetime.now(timezone.utc)

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
                is_online=is_user_online(user, now_utc),
                last_message=last_msg,
                last_message_at=last_time,
                public_key=user.public_key,
                blocked_by_me=by_me_flag,
                blocked_me=me_flag,
                unread_count=unread_cnt
            )
        )

    return contacts


@router.post(
    "/presence/ping",
    response_model=schemas.PresenceResponse,
    tags=[settings.CONTACT_TAG]
)
def ping_presence(request: Request, db: deps.db_session):
    user = deps.get_current_user(request, db)
    now_utc = datetime.now(timezone.utc)
    user.last_seen = now_utc
    db.commit()

    online_user_ids = [
        user_id for (user_id,) in db.query(models.User.id).filter(
            models.User.is_active == True,
            models.User.is_deleted == False,
            models.User.last_seen != None,
            models.User.last_seen >= now_utc - ONLINE_WINDOW
        ).all()
    ]

    return schemas.PresenceResponse(online_user_ids=online_user_ids)


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


@router.get(
    "/sync/messages",
    response_model=List[schemas.MessageResponse],
    tags=[settings.MESSAGE_TAG]
)
def sync_messages(
    request: Request,
    db: deps.db_session,
    limit: int = 200,
    updated_after: datetime | None = None
):
    user = deps.get_current_user(request, db)
    limit = min(limit, 500)

    query = db.query(models.Message).filter(
        or_(
            models.Message.sender_id == user.id,
            models.Message.receiver_id == user.id
        )
    )

    if updated_after is not None:
        if updated_after.tzinfo is None:
            updated_after = updated_after.replace(tzinfo=timezone.utc)
        query = query.filter(models.Message.updated_at > updated_after)

    inner_q = query.order_by(
        models.Message.created_at.desc()
    ).limit(limit)

    msg_alias = aliased(models.Message, inner_q.subquery())

    return db.query(msg_alias).order_by(msg_alias.created_at.asc()).all()


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


# --- Calls Endpoint ---


@router.get(
    "/calls/history",
    response_model=List[schemas.CallLogResponse],
    tags=[settings.CALL_TAG]
)
def get_call_history(
    request: Request,
    db: deps.db_session,
    contact_id: int | None = None,
    limit: int = 20,
    offset: int = 0
):
    user = deps.get_current_user(request, db)
    limit = min(limit, 100)

    initiator = aliased(models.User)
    receiver = aliased(models.User)

    query = db.query(
        models.CallLog,
        (initiator.first_name + " " + initiator.last_name).label("initiator_name"),
        initiator.profile_pic.label("initiator_pic"),
        (receiver.first_name + " " + receiver.last_name).label("receiver_name"),
        receiver.profile_pic.label("receiver_pic")
    ).join(
        initiator, models.CallLog.initiator_id == initiator.id
    ).join(
        receiver, models.CallLog.receiver_id == receiver.id
    ).filter(
        or_(
            models.CallLog.initiator_id == user.id,
            models.CallLog.receiver_id == user.id
        )
    )

    if contact_id is not None:
        query = query.filter(
            or_(
                and_(
                    models.CallLog.initiator_id == user.id,
                    models.CallLog.receiver_id == contact_id
                ),
                and_(
                    models.CallLog.initiator_id == contact_id,
                    models.CallLog.receiver_id == user.id
                )
            )
        )

    results = query.order_by(
        models.CallLog.started_at.desc()
    ).limit(limit).offset(offset).all()

    logs = []
    for call, ini_name, ini_pic, rec_name, rec_pic in results:
        resp = schemas.CallLogResponse.model_validate(call)
        resp.initiator_name = ini_name
        resp.initiator_pic = ini_pic
        resp.receiver_name = rec_name
        resp.receiver_pic = rec_pic
        logs.append(resp)

    return logs


@router.post(
    "/calls",
    response_model=schemas.CallLogResponse,
    tags=[settings.CALL_TAG]
)
def create_call_log(
    payload: schemas.CallLogCreate,
    request: Request,
    db: deps.db_session
):
    user = deps.get_current_user(request, db)

    if payload.call_type not in VALID_CALL_TYPES:
        raise HTTPException(status_code=400, detail="Invalid call type")

    new_call = models.CallLog(
        initiator_id=user.id,
        receiver_id=payload.receiver_id,
        started_by_id=user.id,
        call_type=payload.call_type,
        final_call_type=payload.call_type,
        status="initiated"
    )
    db.add(new_call)
    db.commit()
    db.refresh(new_call)
    return new_call


@router.patch(
    "/calls/{call_id}",
    response_model=schemas.CallLogResponse,
    tags=[settings.CALL_TAG]
)
def update_call_log(
    call_id: int,
    payload: schemas.CallLogUpdate,
    request: Request,
    db: deps.db_session
):
    user = deps.get_current_user(request, db)
    call = db.query(models.CallLog).filter(
        models.CallLog.id == call_id,
        or_(
            models.CallLog.initiator_id == user.id,
            models.CallLog.receiver_id == user.id
        )
    ).first()

    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    now_utc = datetime.now(timezone.utc)

    if payload.final_call_type is not None:
        if payload.final_call_type not in VALID_CALL_TYPES:
            raise HTTPException(status_code=400, detail="Invalid call type")
        call.final_call_type = payload.final_call_type

    if payload.status is not None:
        if payload.status not in VALID_CALL_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid call status")

        call.status = payload.status

        if payload.status == "accepted":
            if call.answered_at is None:
                call.answered_at = now_utc
            if call.accepted_by_id is None:
                call.accepted_by_id = user.id
        elif payload.status in {"ended", "missed", "rejected"}:
            if call.ended_at is None:
                call.ended_at = now_utc
            call.ended_by_id = user.id
            if call.answered_at is not None:
                answered_at = call.answered_at
                if answered_at.tzinfo is None:
                    answered_at = answered_at.replace(tzinfo=timezone.utc)
                call.duration_seconds = max(
                    0,
                    int((now_utc - answered_at).total_seconds())
                )

    db.commit()
    db.refresh(call)
    return call


# --- WebAuthn (Biometric) Endpoints ---


@router.get("/auth/webauthn/register/options", tags=[settings.AUTH_TAG])
def webauthn_register_options(request: Request, db: deps.db_session):
    user = deps.get_current_user(request, db)
    options = webauthn_utils.get_registration_options(user.id, user.email)
    
    # STORE IN REDIS: This is where we use Redis to keep the challenge for 5 minutes
    redis_client.store_webauthn_challenge(str(user.id), options["challenge"], "register")
    
    return options


@router.post("/auth/webauthn/register/verify", tags=[settings.AUTH_TAG])
def webauthn_register_verify(
    verify_data: schemas.WebAuthnRegisterVerifyRequest,
    request: Request,
    db: deps.db_session
):
    user = deps.get_current_user(request, db)
    
    # GET FROM REDIS: We fetch the original challenge to make sure it matches the browser signature
    challenge = redis_client.get_webauthn_challenge(str(user.id), "register")
    if not challenge:
        raise HTTPException(status_code=400, detail="Registration session expired")
    
    try:
        verification = webauthn_utils.verify_registration(
            {"challenge": challenge},
            verify_data.credential
        )
        
        # Save authenticator to DB
        new_auth = models.UserAuthenticator(
            user_id=user.id,
            credential_id=verify_data.credential.id,
            public_key=verification.credential_public_key,
            sign_count=verification.sign_count,
            encrypted_dek_prf=verify_data.encrypted_dek_prf,
            dek_iv_prf=verify_data.dek_iv_prf
        )
        db.add(new_auth)
        db.commit()
        
        # Cleanup Redis
        redis_client.delete_webauthn_challenge(str(user.id), "register")
        
        return {"msg": "Success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/auth/webauthn/login/options", tags=[settings.AUTH_TAG])
def webauthn_login_options(login_data: schemas.WebAuthnLoginOptionsRequest, db: deps.db_session):
    user = db.query(models.User).filter(models.User.mobile_number == login_data.mobile_number).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get user's enrolled credentials
    allowed_credentials = [
        {"id": auth.credential_id, "type": "public-key"} 
        for auth in user.authenticators
    ]
    
    options = webauthn_utils.get_authentication_options(allowed_credentials)
    
    # STORE IN REDIS: Saving the login challenge
    redis_client.store_webauthn_challenge(str(user.id), options["challenge"], "login")
    
    return options


@router.post("/auth/webauthn/login/verify", tags=[settings.AUTH_TAG])
def webauthn_login_verify(
    verify_data: schemas.WebAuthnLoginVerifyRequest,
    response: Response,
    db: deps.db_session
):
    user = db.query(models.User).filter(models.User.mobile_number == verify_data.mobile_number).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # GET FROM REDIS: Fetching the challenge to verify the login signature
    challenge = redis_client.get_webauthn_challenge(str(user.id), "login")
    if not challenge:
        raise HTTPException(status_code=400, detail="Login session expired")
    
    # Find the specific authenticator used
    authenticator = db.query(models.UserAuthenticator).filter(
        models.UserAuthenticator.credential_id == verify_data.credential.id
    ).first()
    
    if not authenticator:
        raise HTTPException(status_code=404, detail="Authenticator not found")

    try:
        verification = webauthn_utils.verify_authentication(
            {"challenge": challenge},
            verify_data.credential,
            authenticator.public_key,
            authenticator.sign_count
        )
        
        # Update sign count
        authenticator.sign_count = verification.new_sign_count
        db.commit()
        
        # Cleanup Redis
        redis_client.delete_webauthn_challenge(str(user.id), "login")
        
        # Issue JWT
        token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = auth.create_access_token(
            data={"sub": str(user.id)}, expires_delta=token_expires
        )
        
        response.set_cookie(
            key="access_token", 
            value=f"Bearer {access_token}", 
            httponly=True,
            samesite="lax",
            secure=True
        )
        
        return {
            "access_token": access_token,
            "user_id": user.id,
            "encrypted_dek_prf": authenticator.encrypted_dek_prf,
            "dek_iv_prf": authenticator.dek_iv_prf
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/auth/webauthn/authenticators", tags=[settings.PROFILE_TAG])
def list_authenticators(request: Request, db: deps.db_session):
    user = deps.get_current_user(request, db)
    return user.authenticators


@router.delete("/auth/webauthn/authenticators/{auth_id}", tags=[settings.PROFILE_TAG])
def delete_authenticator(auth_id: int, request: Request, db: deps.db_session):
    user = deps.get_current_user(request, db)
    db.query(models.UserAuthenticator).filter(
        models.UserAuthenticator.id == auth_id,
        models.UserAuthenticator.user_id == user.id
    ).delete()
    db.commit()
    return {"msg": "Authenticator removed"}
