# MK Chats

MK Chats is a FastAPI-based chat application with server-rendered pages, REST APIs, HTTP polling for message and presence updates, and Supabase Realtime signaling for WebRTC calls. The project includes authentication, profile management, contact search, message history, chat clearing, blocking, password reset, and presence updates.

## Tech Stack

- Python
- FastAPI
- SQLAlchemy
- Alembic
- Jinja2 templates
- PostgreSQL
- Pytest

## Features

- User registration and login with cookie-based authentication
- Profile view and profile update endpoints
- Password change and email-based password reset flow
- Polling-based messaging that works on Vercel serverless hosting
- Presence updates based on recent activity
- Supabase Realtime signaling for audio/video calls
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
SQLALCHEMY_DATABASE_URL=your-database-your
SECRET_KEY=your-secret-key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@example.com
SMTP_PASSWORD=your-email-password-or-app-password
SMTP_FROM_EMAIL=your-email@example.com
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key

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
- `GET /api/sync/messages`
- `DELETE /api/messages/{message_id}`
- `POST /api/messages/clear/{contact_id}`
- `POST /api/presence/ping`

## Testing

Run the test suite with:

```bash
pytest
```

## Notes

- Authentication is stored in an `access_token` cookie or in Header Authorization `bearer <token>`.
- Message delivery uses HTTP polling.
- Audio/video media uses WebRTC peer connections, while Supabase Realtime is used only for call signaling.
