from typing import Annotated
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
from fastapi import status, Depends, Request, HTTPException

from app import models
from app.core import auth
from app.core.database import get_db
from app.core.config import ONLINE_WINDOW


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


def is_user_online(user: models.User, now_utc: datetime | None = None) -> bool:
    if not user.last_seen:
        return False

    now_utc = now_utc or datetime.now(timezone.utc)
    last_seen = user.last_seen
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)

    return (now_utc - last_seen) <= ONLINE_WINDOW