from typing import Annotated
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from http.cookies import SimpleCookie
from fastapi import status, Depends, Request, HTTPException

from app import models
from app.core import auth
from app.core.config import settings
from app.core.database import get_db


db_session = Annotated[Session, Depends(get_db)]


def get_current_user(request: Request, db: db_session):
    user_id = auth.get_current_user_id_from_cookie(request)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Not authenticated"
        )
    
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.is_active or user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="User not found or inactive"
        )
    
    return user


def get_user_id_from_environ(environ):
    cookie_header = environ.get('HTTP_COOKIE', '')
    if not cookie_header:
        return None
        
    cookie = SimpleCookie(cookie_header)
    access_token_morsel = cookie.get("access_token")
    if not access_token_morsel:
        return None
        
    token = access_token_morsel.value
    if token.startswith("Bearer "):
        token = token[7:]
    
    try:
        payload = jwt.decode(
            token, 
            settings.SECRET_KEY, 
            algorithms=[settings.ALGORITHM]
        )
        user_id = payload.get("sub")
        if user_id:
            return int(user_id)
    except JWTError:
        pass
    
    return None