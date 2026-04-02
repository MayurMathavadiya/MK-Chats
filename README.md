# MK Chats

MK Chats is a FastAPI-based real-time chat application with server-rendered pages, REST APIs, and Socket.IO events for live messaging. The project includes authentication, profile management, contact search, message history, chat clearing, blocking, password reset, and presence updates.

## Tech Stack

- Python
- FastAPI
- SQLAlchemy
- Alembic
- Jinja2 templates
- Socket.IO
- PostgreSQL
- Pytest

## Features

- User registration and login with cookie-based authentication
- Profile view and profile update endpoints
- Password change and email-based password reset flow
- Real-time messaging over Socket.IO
- Presence and typing indicators
- Read receipts
- Edit and delete message support with a 1-hour limit
- Contact list with latest message, unread counts, and search
- Chat clear flow with background cleanup
- Block and unblock contacts
- CSP middleware for stronger browser-side script protections

## Project Structure

```text
app/
  api_router.py        REST API endpoints
  main.py              FastAPI app setup and middleware
  models.py            SQLAlchemy models
  schemas.py           Pydantic schemas
  web_page.py          HTML page routes
  ws.py                Socket.IO event handlers
  core/
    auth.py            Auth helpers
    config.py          Settings and template config
    database.py        Engine and DB session setup
    deps.py            Dependency helpers
    email.py           Password reset email sending
  services/
    backgound_jobs.py  Async cleanup/background tasks
  templates/           Jinja templates for auth and chat pages
test/                  Automated tests
alembic/               Database migrations
```

## Prerequisites

- Python 3.11 or newer recommended
- PostgreSQL database
- SMTP credentials for password reset emails

## Environment Variables

Create a `.env` file in the project root with the following values:

```env
SQLALCHEMY_DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB_NAME
SECRET_KEY=your-secret-key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@example.com
SMTP_PASSWORD=your-email-password-or-app-password
SMTP_FROM_EMAIL=your-email@example.com
```

## Installation

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Database Setup

Run migrations before starting the app:

```bash
alembic upgrade head
```

## Running the App

Start the development server with:

```bash
uvicorn app.main:app --reload
```

Open the app in your browser:

```text
http://127.0.0.1:8000
```

Useful routes:

- `/` - chat page
- `/login` - login page
- `/register` - registration page
- `/forgot-password` - password reset request page
- `/reset-password` - password reset page

## REST API Overview

### Auth and Profile

- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `POST /api/forgot-password`
- `POST /api/reset-password`
- `GET /api/profile`
- `PATCH /api/profile`
- `POST /api/profile/password`

### Contacts

- `GET /api/contacts`
- `GET /api/contacts?query=...`
- `POST /api/contacts/block`
- `POST /api/contacts/unblock`

### Messages

- `GET /api/messages/{contact_id}`
- `DELETE /api/messages/{message_id}`
- `POST /api/messages/clear/{contact_id}`

## Socket.IO Events

The app mounts the Socket.IO ASGI app at `/` and uses live events for chat updates.

Incoming events handled by the server:

- `connect`
- `disconnect`
- `send`
- `mark_read`
- `edit`
- `delete`
- `typing`

Common emitted event names:

- `presence`
- `receive_message`
- `read_receipt`
- `edit`
- `delete`
- `typing`
- `error`

## Testing

Run the test suite with:

```bash
pytest
```

## Notes

- Authentication is stored in an `access_token` cookie.
- Some cookie settings in the code are currently development-friendly and should be hardened for production.
- The application expects valid SMTP credentials if you want the forgot-password flow to send email successfully.
