from typing import Annotated
from sqlalchemy.orm import Session
from http.cookies import SimpleCookie
from fastapi import status, Depends, Request, HTTPException

from app import models
from app.core import auth
from app.core.database import get_db


db_session = Annotated[Session, Depends(get_db)]


def get_current_user(request: Request, db: db_session):
    user_id = auth.get_current_user_id(request)
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
    auth_header = environ.get("HTTP_AUTHORIZATION")
    if auth_header:
        return auth.decode_user_id_from_token(auth_header)

    cookie_header = environ.get("HTTP_COOKIE", "")
    if not cookie_header:
        return None

    cookie = SimpleCookie(cookie_header)
    access_token_morsel = cookie.get("access_token")
    if not access_token_morsel:
        return None

    return auth.decode_user_id_from_token(
        access_token_morsel.value
    )


def get_current_websocket_user_id(environ, socket_auth=None):
    token = None
    if isinstance(socket_auth, dict):
        token = socket_auth.get("token") or socket_auth.get("access_token")
        if not token:
            token = socket_auth.get("Authorization") or socket_auth.get("authorization")
    
    if token:
        return auth.decode_user_id_from_token(token)

    user_id = get_user_id_from_environ(environ)

    return user_id