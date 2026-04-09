import os
import secrets
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.api_router import router as api_router
from app.web_page import router as web_page_router


OPENAPI_TAGS = [
    {
        "name": f"{settings.AUTH_TAG}",
        "description": "Authentication and account recovery operations such as register, login, logout, and password reset.",
    },
    {
        "name": f"{settings.PROFILE_TAG}",
        "description": "Endpoints for reading and updating the authenticated user's profile and password.",
    },
    {
        "name": f"{settings.CONTACT_TAG}",
        "description": "Contact list, filtering, and contact blocking management for the authenticated user.",
    },
    {
        "name": f"{settings.MESSAGE_TAG}",
        "description": "Message history, deletion, and chat-clearing operations.",
    },
    {
        "name": f"{settings.CALL_TAG}",
        "description": "Call history and call lifecycle operations for audio and video sessions.",
    },
    {
        "name": f"{settings.WEB_TAG}",
        "description": "Server-rendered HTML pages for the web application interface.",
    },
]


app = FastAPI(title="MK Chats", openapi_tags=OPENAPI_TAGS, docs_url=None)


"""Content Security Policy (CSP) using cryptographic nonces.
This guarantees that no unapproved scripts can execute, 
entirely neutralizing Cross-Site Scripting (XSS) threats."""
class CSPMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        nonce = secrets.token_urlsafe(16)
        request.state.nonce = nonce
        response = await call_next(request)

        docs_paths = {"/redoc", "/openapi.json"}
        if request.url.path not in docs_paths:

            csp = (
                f"default-src 'self'; "
                f"script-src 'self' 'nonce-{nonce}' https://cdn.tailwindcss.com \
                    https://cdn.socket.io https://cdn.jsdelivr.net; "
                f"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                f"font-src 'self' https://fonts.gstatic.com; "
                f"img-src 'self' data: http: https: blob:; "
                f"connect-src 'self' ws: wss: http: https:; "
                f"media-src 'self' data: http: https: blob:;"
            )

            response.headers["Content-Security-Policy"] = csp

            content_type = response.headers.get("content-type", "")
            if "text/html" in content_type:
                response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
                response.headers["Pragma"] = "no-cache"
                response.headers["Expires"] = "0"

        return response


app.add_middleware(CSPMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")


app.include_router(api_router)
app.include_router(web_page_router)

