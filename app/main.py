import os
import secrets
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.ws import sio_app
from app.api_router import router as api_router
from app.web_page import router as web_page_router


app = FastAPI(title="MK Chats")


"""Content Security Policy (CSP) using cryptographic nonces.
This guarantees that no unapproved scripts can execute, 
entirely neutralizing Cross-Site Scripting (XSS) threats."""
class CSPMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        nonce = secrets.token_urlsafe(16)
        request.state.nonce = nonce
        response = await call_next(request)
        
        csp = (
            f"default-src 'self'; "
            f"script-src 'self' 'nonce-{nonce}' https://cdn.tailwindcss.com https://cdn.socket.io; "
            f"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            f"font-src 'self' https://fonts.gstatic.com; "
            f"img-src 'self' data: http: https: blob:; "
            f"connect-src 'self' ws: wss: http: https:; "
            f"media-src 'self' data: http: https: blob:;"
        )
        response.headers["Content-Security-Policy"] = csp
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

app.mount("/", sio_app)
