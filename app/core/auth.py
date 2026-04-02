from fastapi import Request
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone

from app.core.config import settings


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password):
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode, 
        settings.SECRET_KEY, 
        algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def normalize_bearer_token(token: Optional[str]) -> Optional[str]:
    if not token:
        return None

    token = token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()

    return token or None


def decode_user_id_from_token(token: Optional[str]) -> Optional[int]:
    token = normalize_bearer_token(token)
    if not token:
        return None

    try:
        payload = jwt.decode(
            token, 
            settings.SECRET_KEY, 
            algorithms=[settings.ALGORITHM]
        )
        
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
        
        return int(user_id)
    
    except JWTError:
        return None


def get_current_user_id(request: Request) -> Optional[int]:
    access_token = (
        request.headers.get("Authorization") or request.cookies.get("access_token")
    )
    
    return decode_user_id_from_token(access_token)

