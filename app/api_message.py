from sqlalchemy import or_, and_
from sqlalchemy.orm import aliased
from datetime import datetime, timezone
from fastapi import Request, BackgroundTasks

from app import models
from app.core import deps
from app.services import background_jobs


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
        background_jobs.delete_cleared_messages,
        contact_id, user.id, now_utc # Parameters
    )
    
    return {"msg": "Chat cleared"}