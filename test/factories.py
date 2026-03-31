import factory
from datetime import datetime, timedelta, timezone
from factory.alchemy import SQLAlchemyModelFactory

from app import models
from app.core.auth import get_password_hash


class BaseFactory(SQLAlchemyModelFactory):
    class Meta:
        abstract = True
        sqlalchemy_session = None
        sqlalchemy_session_persistence = "flush"


class UserFactory(BaseFactory):
    class Meta:
        model = models.User

    mobile_number = factory.Sequence(lambda n: f"+91000000{n:04d}")
    email = factory.Sequence(lambda n: f"user{n}@example.com")
    first_name = factory.Faker("first_name")
    last_name = factory.Faker("last_name")
    password_hash = factory.LazyFunction(lambda: get_password_hash("secret123"))
    public_key = factory.Sequence(lambda n: f"public-key-{n}")
    encrypted_private_key = factory.Sequence(lambda n: f"encrypted-private-key-{n}")
    encrypted_dek = factory.Sequence(lambda n: f"encrypted-dek-{n}")
    keys_salt = factory.Sequence(lambda n: f"keys-salt-{n}")
    dek_iv = factory.Sequence(lambda n: f"dek-iv-{n}")
    priv_key_iv = factory.Sequence(lambda n: f"priv-key-iv-{n}")
    profile_pic = None
    is_online = False
    is_active = True
    is_deleted = False
    socket_sid = None


class MessageFactory(BaseFactory):
    class Meta:
        model = models.Message

    sender = factory.SubFactory(UserFactory)
    receiver = factory.SubFactory(UserFactory)
    content = factory.Sequence(lambda n: f"message-{n}")
    file_data = None
    file_type = None
    is_read = False
    is_deleted = False
    is_edited = False
    edited_at = None
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


class ChatClearFactory(BaseFactory):
    class Meta:
        model = models.ChatClear

    user_id = factory.LazyFunction(lambda: UserFactory().id)
    contact_id = factory.LazyFunction(lambda: UserFactory().id)
    cleared_at = factory.LazyFunction(lambda: datetime.now(timezone.utc) - timedelta(minutes=5))


class BlockedUserFactory(BaseFactory):
    class Meta:
        model = models.BlockedUser

    user_id = factory.LazyFunction(lambda: UserFactory().id)
    blocked_contact_id = factory.LazyFunction(lambda: UserFactory().id)
