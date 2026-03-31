from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app import models
from app.core import auth, deps
from app.core.config import templates


router = APIRouter()


@router.get("/", response_class=HTMLResponse)
def read_root(request: Request, db: deps.db_session):
    user_id = auth.get_current_user_id_from_cookie(request)
    if not user_id:
        return RedirectResponse(url="/login")
    
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        response = RedirectResponse(url="/login")
        response.delete_cookie("access_token")
        return response
    
    return templates.TemplateResponse(request, "chat.html", {"user": user})


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request, db: deps.db_session):
    user_id = auth.get_current_user_id_from_cookie(request)
    if user_id:
        
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user:
            return RedirectResponse(url="/")
        
        else:
            # Clear cookie if user not found to avoid loop
            response = templates.TemplateResponse(request, "login.html")
            response.delete_cookie("access_token")
            return response
    
    return templates.TemplateResponse(request, "login.html")


@router.get("/register", response_class=HTMLResponse)
def register_page(request: Request, db: deps.db_session):
    user_id = auth.get_current_user_id_from_cookie(request)
    if user_id:
        
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user:
            return RedirectResponse(url="/")
        
        else:
            # Clear cookie if user not found to avoid loop
            response = templates.TemplateResponse(request, "register.html")
            response.delete_cookie("access_token")
            return response
    
    return templates.TemplateResponse(request, "register.html")


@router.get("/logout")
def logout_get():
    response = RedirectResponse(url="/login")
    response.delete_cookie("access_token")
    return response


@router.get("/forgot-password", response_class=HTMLResponse)
def forgot_password_page(request: Request):
    return templates.TemplateResponse(request, "forgot_password.html")


@router.get("/reset-password", response_class=HTMLResponse)
def reset_password_page(request: Request):
    return templates.TemplateResponse(request, "reset_password.html")
