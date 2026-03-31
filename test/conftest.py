
import pytest
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.main import app
from app.core import auth
from app.core.database import Base, get_db

from test import factories


TEST_DB_PATH = Path(__file__).resolve().parent / "test.sqlite3"
TEST_DATABASE_URL = f"sqlite:///{TEST_DB_PATH}"


engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
)


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


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
    )
    for factory_class in factory_classes:
        factory_class._meta.sqlalchemy_session = db_session
    yield
    for factory_class in factory_classes:
        factory_class._meta.sqlalchemy_session = None


@pytest.fixture
def client():
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


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
