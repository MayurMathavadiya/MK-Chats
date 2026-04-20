
import pytest
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.main import app
from app.core import auth
from app.core.database import Base

from test import factories

from sqlalchemy.pool import StaticPool

TEST_DATABASE_URL = "sqlite://"


engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def global_db_monkeypatch(monkeypatch, db_session):
    """
    Globally monkeypatch SessionLocal and engine in all relevant modules.
    This ensures all parts of the app use the same test session and engine.
    """
    from app.core import database, auth
    from app import socket_events, api_router
    
    # We use a context manager factory that returns the existing db_session
    class DBContextManager:
        def __init__(self, session):
            self.session = session
        def __enter__(self):
            return self.session
        def __exit__(self, exc_type, exc_val, exc_tb):
            pass # Don't close the shared test session
        def close(self):
            pass # Satisfy FastAPI get_db teardown
        def __getattr__(self, name):
            return getattr(self.session, name)
            
    # List of targets to monkeypatch
    targets = [database, auth, socket_events, api_router]
    
    for target in targets:
        if hasattr(target, "SessionLocal"):
            monkeypatch.setattr(target, "SessionLocal", lambda: DBContextManager(db_session))
        if hasattr(target, "engine"):
            monkeypatch.setattr(target, "engine", engine)
            
    yield


@pytest.fixture
def testing_session_factory():
    return TestingSessionLocal


@pytest.fixture
def db_session():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def bind_factories(db_session):
    factory_classes = (
        factories.UserFactory,
        factories.MessageFactory,
        factories.ChatClearFactory,
        factories.BlockedUserFactory,
        factories.CallLogFactory,
    )
    for factory_class in factory_classes:
        factory_class._meta.sqlalchemy_session = db_session
    yield
    for factory_class in factory_classes:
        factory_class._meta.sqlalchemy_session = None


@pytest.fixture
def client():
    # We don't need override_get_db anymore because of global monkeypatch,
    # but the fixture still needs to return a TestClient
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def access_token():
    def _make_access_token(user_id: int) -> str:
        return auth.create_access_token({"sub": str(user_id)})

    return _make_access_token


@pytest.fixture
def auth_cookie(access_token):
    def _auth_cookie(user_id: int) -> str:
        return f"Bearer {access_token(user_id)}"

    return _auth_cookie


@pytest.fixture
def mock_sio(monkeypatch):
    from unittest.mock import AsyncMock, MagicMock
    mock = MagicMock()
    mock.enter_room = AsyncMock()
    mock.leave_room = AsyncMock()
    mock.emit = AsyncMock()
    mock.get_session = AsyncMock()
    mock.save_session = AsyncMock()
    
    # Context manager for sio.session(sid)
    class AsyncSessionManager:
        def __init__(self, session_data):
            self.session_data = session_data
        async def __aenter__(self):
            return self.session_data
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass
            
    mock.session_data = {}
    mock.session.side_effect = lambda sid: AsyncSessionManager(mock.session_data)
    mock.get_session.side_effect = lambda sid: mock.session_data

    from app import socket_events
    monkeypatch.setattr(socket_events, "sio", mock)
    
    return mock


@pytest.fixture
def mock_redis(monkeypatch):
    import fakeredis.aioredis
    server = fakeredis.FakeServer()
    client = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
    
    from app import socket_events
    monkeypatch.setattr(socket_events, "redis_client", client)
    return client
