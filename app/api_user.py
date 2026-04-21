from jose import jwt
from datetime import timedelta
from fastapi import status, Request, \
    Response, HTTPException, BackgroundTasks

from app import models, schemas
from app.core import auth, deps
from app.core.config import settings
from app.core.email import send_password_reset_email


# --- Auth Endpoints ---


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
        secure=True
    )
    
    return new_user


def login(
    login_data: schemas.UserLogin, 
    response: Response, 
    db: deps.db_session
):
    user = db.query(models.User).filter(
        models.User.mobile_number == login_data.mobile_number
    ).first()
    if not user or not auth.verify_password(
        login_data.password, user.password_hash
    ):
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
        secure=True
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
        secure=True
    )
    return {"msg": "Successfully logged out"}


# --- Forgot Password Endpoints ---


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
        background_tasks.add_task(
            send_password_reset_email, 
            user.email, token, host # Parameters
        )
        return {'msg': "Password reset link sent."}
    
    else:
        return {"msg": "Your email is not registered."}


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
        raise HTTPException(
            status_code=400, 
            detail="Invalid or expired reset token."
        )

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


def get_profile(request: Request, db: deps.db_session):
    user = deps.get_current_user(request, db)
    return schemas.UserResponse.model_validate(user)


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
    return schemas.UserResponse.model_validate(user)


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

