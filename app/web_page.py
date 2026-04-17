from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app import models
from app.core import auth, deps
from app.core.config import templates, settings


router = APIRouter(tags=[settings.WEB_TAG])


@router.get("/", response_class=HTMLResponse)
def read_root(request: Request, db: deps.db_session):
    """Render the Home page for authenticated users or redirect to login."""
    user_id = auth.get_current_user_id(request)
    if not user_id:
        return RedirectResponse(url="/login")
    
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        response = RedirectResponse(url="/login")
        response.delete_cookie("access_token")
        return response
    
    return templates.TemplateResponse(request, "chat.html",{"user": user})
    


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request, db: deps.db_session):
    """Render the login page, redirecting authenticated users to the Home page."""
    user_id = auth.get_current_user_id(request)
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
    """Render the registration page, redirecting authenticated users to the Home page."""
    user_id = auth.get_current_user_id(request)
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

@router.get("/forgot-password", response_class=HTMLResponse)
def forgot_password_page(request: Request):
    """Render the forgot-password page."""
    return templates.TemplateResponse(request, "forgot_password.html")


@router.get("/reset-password", response_class=HTMLResponse)
def reset_password_page(request: Request):
    """Render the password reset page."""
    return templates.TemplateResponse(request, "reset_password.html")
