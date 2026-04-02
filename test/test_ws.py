import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from app import models, ws
from test.factories import BlockedUserFactory, MessageFactory, UserFactory


def test_connect_and_disconnect_update_presence(db_session, monkeypatch, testing_session_factory):
    user = UserFactory()
    db_session.commit()
    emitted = []
    session_store = {}

    @asynccontextmanager
    async def fake_session(sid):
        session = session_store.setdefault(sid, {})
        yield session

    async def fake_emit(event, payload, to=None):
        emitted.append((event, payload, to))

    async def fake_get_session(sid):
        return session_store[sid]

    monkeypatch.setattr(ws.deps, "get_user_id_from_environ", lambda environ: user.id)
    monkeypatch.setattr(ws, "SessionLocal", testing_session_factory)
    monkeypatch.setattr(ws.sio, "session", fake_session)
    monkeypatch.setattr(ws.sio, "emit", fake_emit)    

    monkeypatch.setattr(ws.sio, "get_session", fake_get_session)

    asyncio.run(ws.connect("sid-1", {}))
    asyncio.run(ws.disconnect("sid-1"))
    
    db_session.expire_all()
    refreshed_user = db_session.query(models.User).filter_by(id=user.id).first()

    assert refreshed_user.is_online is False
    assert refreshed_user.socket_sid is None
    assert emitted[0][0] == "presence"
    assert emitted[1][0] == "presence"


def test_connect_accepts_token_from_socket_auth(db_session, monkeypatch, testing_session_factory):
    user = UserFactory()
    db_session.commit()
    emitted = []
    session_store = {}

    @asynccontextmanager
    async def fake_session(sid):
        session = session_store.setdefault(sid, {})
        yield session

    async def fake_emit(event, payload, to=None):
        emitted.append((event, payload, to))

    monkeypatch.setattr(ws, "SessionLocal", testing_session_factory)
    monkeypatch.setattr(ws.sio, "session", fake_session)
    monkeypatch.setattr(ws.sio, "emit", fake_emit)

    asyncio.run(ws.connect("sid-auth", {}, {"token": f"Bearer invalid"}))
    user_token = ws.deps.auth.create_access_token({'sub': str(user.id)})
    rejected = asyncio.run(ws.connect("sid-2", {}, {"token": f"Bearer {user_token}"}))

    db_session.expire_all()
    refreshed_user = db_session.query(models.User).filter_by(id=user.id).first()

    assert rejected is None
    assert refreshed_user.is_online is True
    assert session_store["sid-2"]["user_id"] == user.id
    assert emitted[-1][0] == "presence"


def test_send_emits_error_when_users_are_blocked(db_session, monkeypatch, testing_session_factory):
    sender = UserFactory(socket_sid="sender-sid")
    receiver = UserFactory(socket_sid="receiver-sid")
    BlockedUserFactory(user_id=sender.id, blocked_contact_id=receiver.id)
    db_session.commit()
    emitted = []

    async def fake_emit(event, payload, to=None):
        emitted.append((event, payload, to))

    async def fake_get_session(sid):
        return {"user_id": sender.id}

    monkeypatch.setattr(ws, "SessionLocal", testing_session_factory)
    monkeypatch.setattr(ws.sio, "emit", fake_emit)
    monkeypatch.setattr(ws.sio, "get_session", fake_get_session)

    asyncio.run(
        ws.send(
            "sender-sid",
            {"receiver_id": receiver.id, "content": "blocked message"},
        )
    )

    assert emitted == [
        (
            "error",
            {
                "action": "error", 
                "message": "Message blocked. Unblock to continue."
            },
            "sender-sid",
        )
    ]


def test_edit_emits_error_after_one_hour(db_session, monkeypatch, testing_session_factory):
    sender = UserFactory(socket_sid="sender-sid")
    receiver = UserFactory(socket_sid="receiver-sid")
    stale_message = MessageFactory(
        sender=sender,
        receiver=receiver,
        created_at=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    db_session.commit()
    emitted = []

    async def fake_emit(event, payload, to=None):
        emitted.append((event, payload, to))

    async def fake_get_session(sid):
        return {"user_id": sender.id}

    monkeypatch.setattr(ws, "SessionLocal", testing_session_factory)
    monkeypatch.setattr(ws.sio, "emit", fake_emit)
    monkeypatch.setattr(ws.sio, "get_session", fake_get_session)

    asyncio.run(ws.edit("sender-sid", {"id": stale_message.id, "content": "new"}))

    assert emitted == [
        (
            "error",
            {
                "action": "error", 
                "message": "Cannot edit message after 1 hour"
            },
            "sender-sid",
        )
    ]
