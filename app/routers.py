from typing import List
from datetime import datetime
from fastapi import APIRouter, Request, Response, BackgroundTasks

from app import schemas
from app.core import deps
from app.core.config import settings
from app import api_user, api_contact, api_message, api_call


router = APIRouter(prefix="/api")


# --- Auth Endpoint ---


@router.post(
    "/register", 
    response_model=schemas.UserResponse, 
    tags=[settings.AUTH_TAG]
)
def register(
    user: schemas.UserCreate, 
    response: Response, 
    db: deps.db_session
):
    
    return api_user.register(
        user=user, 
        response=response, 
        db=db
    )


@router.post("/login", tags=[settings.AUTH_TAG])
def login(
    login_data: schemas.UserLogin, 
    response: Response, 
    db: deps.db_session
):
    return api_user.login(
        login_data=login_data, 
        response=response, 
        db=db
    )


@router.post("/logout", tags=[settings.AUTH_TAG])
def logout(request: Request, response: Response, db: deps.db_session):
    return api_user.logout(request=request, response=response, db=db)


# --- Forgot Password Endpoints ---


@router.post("/forgot-password", tags=[settings.AUTH_TAG])
async def forgot_password(
    req: schemas.ForgotPasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: deps.db_session
):
    return await api_user.forgot_password(
        req=req, 
        request=request, 
        background_tasks=background_tasks, 
        db=db
    )


@router.post("/reset-password", tags=[settings.AUTH_TAG])
async def reset_password(
    req: schemas.ResetPasswordRequest,
    db: deps.db_session
):
    return await api_user.reset_password(req=req, db=db)


# --- Profile and User Search Endpoints ---


@router.get(
    "/profile", 
    response_model=schemas.UserResponse, 
    tags=[settings.PROFILE_TAG]
)
def get_profile(request: Request, db: deps.db_session):
    return api_user.get_profile(request=request, db=db)


@router.patch(
    "/profile", 
    response_model=schemas.UserResponse, 
    tags=[settings.PROFILE_TAG]
)
def update_profile(
    user_update: schemas.UserUpdate, 
    request: Request, 
    db: deps.db_session
):
    return api_user.update_profile(
        user_update=user_update, 
        request=request, 
        db=db
    )


@router.post("/profile/password", tags=[settings.PROFILE_TAG])
def update_password(
    pw_update: schemas.UserUpdatePassword, 
    request: Request, 
    db: deps.db_session
):
    return api_user.update_password(
        pw_update=pw_update, 
        request=request, 
        db=db
    )


# --- Contacts Endpoint ---


@router.get(
    "/contacts", 
    response_model=List[schemas.ContactResponse], 
    tags=[settings.CONTACT_TAG]
)
def get_contacts(
    request: Request,
    db: deps.db_session,
    query: str | None = None,
    limit: int = 20,
    offset: int = 0
):
    return api_contact.get_contacts(
        request=request, 
        db=db, 
        query=query, 
        limit=limit, 
        offset=offset
    )


@router.post("/contacts/block", tags=[settings.CONTACT_TAG])
def block_user(
    block_req: schemas.BlockUserRequest, 
    request: Request, 
    db: deps.db_session
):
    return api_contact.block_user(
        block_req=block_req, 
        request=request, 
        db=db
    )


@router.post("/contacts/unblock", tags=[settings.CONTACT_TAG])
def unblock_user(
    block_req: schemas.BlockUserRequest, 
    request: Request, 
    db: deps.db_session
):
    return api_contact.unblock_user(
        block_req=block_req, 
        request=request, 
        db=db
    )


# --- Messages Endpoint ---


@router.get(
    "/messages/{contact_id}", 
    response_model=List[schemas.MessageResponse], 
    tags=[settings.MESSAGE_TAG]
)
def get_messages(
    contact_id: int, 
    request: Request, 
    db: deps.db_session,
    limit: int = 50,
    offset: int = 0
):
    return api_message.get_messages(
        contact_id=contact_id, 
        request=request, 
        db=db, 
        limit=limit, 
        offset=offset
    )


@router.post(
    "/messages/clear/{contact_id}", 
    tags=[settings.MESSAGE_TAG]
)
def clear_chat(
    contact_id: int, 
    request: Request, 
    db: deps.db_session,
    background_tasks: BackgroundTasks,
):
    return api_message.clear_chat(
        contact_id=contact_id, 
        request=request, 
        db=db, 
        background_tasks=background_tasks
    )


# --- Calls Endpoint ---


@router.get(
    "/calls/history",
    response_model=List[schemas.CallLogResponse],
    tags=[settings.CALL_TAG]
)
def get_call_history(
    request: Request,
    db: deps.db_session,
    contact_id: int | None = None,
    limit: int = 20,
    offset: int = 0
):
    return api_call.get_call_history(
        request=request, 
        db=db, 
        contact_id=contact_id, 
        limit=limit, 
        offset=offset
    )


@router.post(
    "/calls",
    response_model=schemas.CallLogResponse,
    tags=[settings.CALL_TAG]
)
def create_call_log(
    payload: schemas.CallLogCreate,
    request: Request,
    db: deps.db_session
):
    return api_call.create_call_log(
        payload=payload, 
        request=request, 
        db=db
    )


@router.patch(
    "/calls/{call_id}",
    response_model=schemas.CallLogResponse,
    tags=[settings.CALL_TAG]
)
def update_call_log(
    call_id: int,
    payload: schemas.CallLogUpdate,
    request: Request,
    db: deps.db_session
):
    return api_call.update_call_log(
        call_id=call_id, 
        payload=payload, 
        request=request, 
        db=db
    )
