from datetime import datetime, timedelta, timezone

from app import models
from app.services import background_jobs
from test.factories import ChatClearFactory, MessageFactory, UserFactory


def test_delete_cleared_messages_removes_mutually_cleared_history(
    db_session,
    monkeypatch,
    testing_session_factory,
):
    user = UserFactory()
    contact = UserFactory()
    old_message = MessageFactory(
        sender=user,
        receiver=contact,
        created_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    new_message = MessageFactory(
        sender=contact,
        receiver=user,
        created_at=datetime.now(timezone.utc),
    )
    ChatClearFactory(
        user_id=contact.id,
        contact_id=user.id,
        cleared_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    old_message_id = old_message.id
    new_message_id = new_message.id
    db_session.commit()

    monkeypatch.setattr(background_jobs, "SessionLocal", testing_session_factory)

    background_jobs.delete_cleared_messages(
        contact_id=contact.id,
        user_id=user.id,
        now_utc=datetime.now(timezone.utc),
    )

    remaining_messages = db_session.query(models.Message).all()

    assert len(remaining_messages) == 1
    assert remaining_messages[0].id == new_message_id
    assert remaining_messages[0].id != old_message_id
