from datetime import datetime, timezone
from sqlalchemy.orm import relationship
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text, DateTime

from app.core.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    mobile_number = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    public_key = Column(Text, nullable=True) # Public key for E2EE text
    encrypted_private_key = Column(Text, nullable=True) # Private key encrypted by DEK
    encrypted_dek = Column(Text, nullable=True) # DEK encrypted by KEK
    keys_salt = Column(String, nullable=True) # Salt for PBKDF2 (deriving KEK)
    dek_iv = Column(String, nullable=True) # IV for DEK encryption
    priv_key_iv = Column(String, nullable=True) # IV for Private Key encryption
    profile_pic = Column(Text, nullable=True) # Base64 encoded or URL
    last_seen = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    is_active = Column(Boolean, default=True)
    is_deleted = Column(Boolean, default=False)
    socket_sid = Column(String, nullable=True)

    # Relationships
    messages_sent = relationship(
        "Message", 
        foreign_keys="Message.sender_id", 
        back_populates="sender"
    )
    
    messages_received = relationship(
        "Message", 
        foreign_keys="Message.receiver_id", 
        back_populates="receiver"
    )

class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    content = Column(Text, nullable=True) # Encrypted string if text
    file_data = Column(Text, nullable=True) # Encrypted Base64 string
    file_type = Column(String, nullable=True) # MIME type
    
    is_read = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)
    is_edited = Column(Boolean, default=False)
    edited_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    
    reply_to_id = Column(Integer, ForeignKey("messages.id"), nullable=True)

    # Relationships
    sender = relationship(
        "User", 
        foreign_keys=[sender_id], 
        back_populates="messages_sent"
    )
    
    receiver = relationship(
        "User", 
        foreign_keys=[receiver_id], 
        back_populates="messages_received"
    )

    reply_to = relationship(
        "Message", 
        remote_side=[id]
    )


class ChatClear(Base):
    __tablename__ = "chat_clears"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    contact_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    cleared_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class BlockedUser(Base):
    __tablename__ = "blocked_users"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    blocked_contact_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class CallLog(Base):
    __tablename__ = "call_logs"

    id = Column(Integer, primary_key=True, index=True)
    initiator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    started_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    accepted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    ended_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    call_type = Column(String, nullable=False, default="audio")
    final_call_type = Column(String, nullable=False, default="audio")
    status = Column(String, nullable=False, default="initiated")
    started_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    answered_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=False, default=0)
