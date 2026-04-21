from typing import Optional
from datetime import datetime
from pydantic import BaseModel, EmailStr, ConfigDict


# --- User Base Models ---


class UserCreate(BaseModel):
    mobile_number: str
    email: EmailStr
    first_name: str
    last_name: str
    password: str
    public_key: str
    encrypted_private_key: str
    encrypted_dek: str
    keys_salt: str
    dek_iv: str
    priv_key_iv: str


class UserUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    profile_pic: Optional[str] = None


class UserLogin(BaseModel):
    mobile_number: str
    password: str


class UserResponse(BaseModel):
    id: int
    mobile_number: str
    email: str
    first_name: str
    last_name: str
    public_key: Optional[str] = None
    encrypted_private_key: Optional[str] = None
    encrypted_dek: Optional[str] = None
    keys_salt: Optional[str] = None
    dek_iv: Optional[str] = None
    priv_key_iv: Optional[str] = None
    profile_pic: Optional[str] = None
    last_seen: Optional[datetime] = None
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


# --- Password Base Model ---


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
    public_key: str
    encrypted_private_key: str
    encrypted_dek: str
    keys_salt: str
    dek_iv: str
    priv_key_iv: str


class UserUpdatePassword(BaseModel):
    old_password: str
    new_password: str
    encrypted_dek: str
    dek_iv: str
    keys_salt: str


# --- Contact Base Model ---


class ContactResponse(BaseModel):
    id: int
    first_name: str
    last_name: str
    mobile_number: str
    profile_pic: Optional[str] = None
    last_message: Optional[str] = None
    last_message_at: Optional[datetime] = None
    public_key: Optional[str] = None
    blocked_by_me: bool = False
    blocked_me: bool = False
    unread_count: int = 0

    model_config = ConfigDict(from_attributes=True)


# --- Token Base Model ---


class Token(BaseModel):
    access_token: str
    token_type: str


# --- Message Base Model ---


class MessageBase(BaseModel):
    content: Optional[str] = None
    file_data: Optional[str] = None
    file_type: Optional[str] = None
    reply_to_id: Optional[int] = None


class MessageCreate(MessageBase):
    receiver_id: int


class MessageUpdate(BaseModel):
    content: str


class MessageResponse(MessageBase):
    id: int
    sender_id: int
    receiver_id: int
    is_deleted: Optional[bool] = False
    is_edited: Optional[bool] = False
    is_read: Optional[bool] = False
    edited_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)


class ReadReceiptResponse(BaseModel):
    contact_id: int
    message_ids: list[int]


class PresenceResponse(BaseModel):
    online_user_ids: list[int]


# --- Call Base Model ---


class CallLogCreate(BaseModel):
    receiver_id: int
    call_type: str


class CallLogUpdate(BaseModel):
    status: Optional[str] = None
    final_call_type: Optional[str] = None


class CallLogResponse(BaseModel):
    id: int
    initiator_id: int
    receiver_id: int
    started_by_id: int
    accepted_by_id: Optional[int] = None
    ended_by_id: Optional[int] = None
    call_type: str
    final_call_type: str
    status: str
    started_at: datetime
    answered_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    duration_seconds: int

    model_config = ConfigDict(from_attributes=True)


# --- Block User Base Model ---


class BlockUserRequest(BaseModel):
    blocked_contact_id: int

    model_config = ConfigDict(from_attributes=True)
