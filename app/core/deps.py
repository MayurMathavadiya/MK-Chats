from typing import Annotated
from sqlalchemy.orm import Session
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
