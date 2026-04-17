# MK Chats

MK Chats is a FastAPI-based chat application with server-rendered pages, REST APIs, real-time messaging using Socket.IO, and WebRTC signaling for audio/video calls. The project includes authentication, profile management, contact search, message history, chat clearing, blocking, password reset, and real-time presence/typing indicators.

## Tech Stack

- Python
- FastAPI
- SQLAlchemy
- Alembic
- Redis (for presence and Socket.IO)
- Socket.IO (for real-time events and signaling)
- Jinja2 templates
- PostgreSQL
- Pytest

## Features

- User registration and login with cookie-based authentication
- Profile view and profile update endpoints
- Password change and email-based password reset flow
- Real-time messaging using Socket.IO (with fallback support)
- Real-time presence updates and typing indicators
- WebRTC signaling for audio/video calls via Socket.IO
- Read receipts with real-time sync across devices
- Edit and delete message support with a 1-hour limit
- Message replies and file/image message support
- Contact list with latest message, unread counts, and search
- Call history for audio and video calls
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
  socket_events.py     Socket.IO event handlers
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
- Redis server
- SMTP credentials for password reset emails

## Environment Variables

Create a `.env` file in the project root with the following values:

```env
SQLALCHEMY_DATABASE_URL=your-database-url
REDIS_URL=redis://localhost:6379/0
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
- `POST /api/presence/ping`

### Messages

- `GET /api/messages/{contact_id}`
- `GET /api/sync/messages`
- `DELETE /api/messages/{message_id}`
- `POST /api/messages/clear/{contact_id}`

### Calls

- `GET /api/calls/history`
- `POST /api/calls`
- `PATCH /api/calls/{call_id}`

## Socket.IO Events

The application uses Socket.IO for real-time interactions.

### Core Events

- `send`: Send a new message (supports `reply_to_id`, `file_data`).
- `edit`: Edit an existing message.
- `delete`: Delete a message.
- `typing`: Broadcast typing status to a contact.
- `mark_read`: Mark messages as read and notify the sender.
- `presence`: Broadcast online/offline status.

### WebRTC Signaling

- `webrtc_offer`, `webrtc_answer`, `webrtc_ice_candidate`: Peer-to-peer connection negotiation.
- `webrtc_upgrade_request`, `webrtc_upgrade_response`: Upgrading audio calls to video.
- `webrtc_end`: Ending a call session.

## Testing

Run the test suite with:

```bash
pytest
```

## Notes

- Authentication is stored in an `access_token` cookie or in Header Authorization `bearer <token>`.
- Real-time updates use Socket.IO with Redis as the message broker.
- Audio/video media uses WebRTC peer connections facilitated by Socket.IO signaling.
