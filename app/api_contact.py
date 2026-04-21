from fastapi import Request
from sqlalchemy.orm import aliased
from datetime import datetime, timezone
from sqlalchemy import case, func, or_, and_

from app.core import deps
from app import models, schemas


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
        (
            models.Message.sender_id == current_user.id, 
            models.Message.receiver_id
        ),
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
                last_message=last_msg,
                last_message_at=last_time,
                public_key=user.public_key,
                blocked_by_me=by_me_flag,
                blocked_me=me_flag,
                unread_count=unread_cnt
            )
        )

    return contacts


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

