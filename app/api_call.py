from sqlalchemy import or_, and_
from datetime import datetime, timezone
from fastapi import Request, HTTPException

from app.core import deps
from app import models, schemas
from app.core.config import VALID_CALL_TYPES, VALID_CALL_STATUSES


def get_call_history(
    request: Request,
    db: deps.db_session,
    contact_id: int | None = None,
    limit: int = 20,
    offset: int = 0
):
    user = deps.get_current_user(request, db)
    limit = min(limit, 100)

    # Check for clears
    # 1. Global clear (contact_id is NULL)
    global_clear = db.query(models.CallClear).filter(
        models.CallClear.user_id == user.id,
        models.CallClear.contact_id.is_(None)
    ).order_by(models.CallClear.cleared_at.desc()).first()

    query = db.query(models.CallLog).filter(
        or_(
            models.CallLog.initiator_id == user.id,
            models.CallLog.receiver_id == user.id
        )
    )

    if global_clear:
        query = query.filter(models.CallLog.started_at > global_clear.cleared_at)

    if contact_id is not None:
        # Check for specific contact clear
        contact_clear = db.query(models.CallClear).filter(
            models.CallClear.user_id == user.id,
            models.CallClear.contact_id == contact_id
        ).order_by(models.CallClear.cleared_at.desc()).first()

        if contact_clear:
            query = query.filter(models.CallLog.started_at > contact_clear.cleared_at)

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

    return query.order_by(
        models.CallLog.started_at.desc()
    ).limit(limit).offset(offset).all()


def clear_call_history(
    request: Request,
    db: deps.db_session,
    contact_id: int | None = None
):
    user = deps.get_current_user(request, db)
    now_utc = datetime.now(timezone.utc)

    # We add a new record to mark the clear point
    clear_record = models.CallClear(
        user_id=user.id,
        contact_id=contact_id,
        cleared_at=now_utc
    )
    db.add(clear_record)
    db.commit()

    return {"msg": "Call history cleared"}


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