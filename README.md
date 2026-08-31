# MK Chats

<p align="center">
  <img src="app/static/branding/mk-chats-logo.svg" alt="MK Chats Logo" width="180">
</p>

<p align="center">
  A secure, real-time chat application built with FastAPI, Socket.IO, WebRTC, Redis, and PostgreSQL.
</p>

<p align="center">
  <a href="https://github.com/MayurMathavadiya/chat-app">GitHub</a>
</p>

---

## About

**MK Chats** is a modern real-time chat application built with **FastAPI**.

It provides secure authentication, real-time messaging, End-to-End Encryption (E2EE), file and image sharing, presence indicators, typing indicators, message replies, read receipts, contact management, blocking, and audio/video calling using WebRTC.

The application uses **Socket.IO** for real-time communication and **Redis** for presence and message/event coordination.

---

## ✨ Features

### 🔐 Authentication & Security

* User registration and login
* Cookie-based authentication
* Bearer token authentication support
* Password change
* Email-based password reset
* Content Security Policy (CSP) middleware
* Privacy Policy and Terms & Conditions pages

### 💬 Real-Time Messaging

* Real-time one-to-one messaging
* Socket.IO-powered communication
* Typing indicators
* Online/offline presence
* Read receipts
* Message editing
* Message deletion
* Message replies
* Unread message counts
* Message history
* Clear chat functionality
* Background cleanup of cleared messages

### 🔒 End-to-End Encryption

* End-to-End Encryption (E2EE) for text messages
* Encrypted file and image transfers
* Client-side cryptographic key handling
* DEK/KEK-based encryption architecture
* Encryption keys stored securely on the server

### 📎 Files & Media

* Image messages
* File messages
* Encrypted file transfers
* Reply to messages containing files/images

### 📞 Audio & Video Calls

* Audio calling
* Video calling
* WebRTC peer-to-peer connections
* Socket.IO-based WebRTC signaling
* Upgrade audio calls to video
* Call history
* Call session management

### 👥 Contacts

* Contact list
* Contact search
* Latest message preview
* Unread message counts
* Block contacts
* Unblock contacts

---

## 🛠️ Tech Stack

| Technology     | Purpose                             |
| -------------- | ----------------------------------- |
| **Python**     | Programming language                |
| **FastAPI**    | Backend web framework               |
| **SQLAlchemy** | ORM / database interaction          |
| **Alembic**    | Database migrations                 |
| **PostgreSQL** | Primary database                    |
| **Redis**      | Presence and real-time coordination |
| **Socket.IO**  | Real-time communication             |
| **Jinja2**     | Server-side HTML rendering          |
| **WebRTC**     | Peer-to-peer audio/video calls      |
| **Pytest**     | Automated testing                   |

---

## 📁 Project Structure

```text
chat-app/
│
├── app/
│   ├── routers.py             # Root API router
│   ├── api_user.py            # Authentication and profile logic
│   ├── api_contact.py         # Contacts and blocking logic
│   ├── api_message.py         # Messaging and chat logic
│   ├── api_call.py            # Call history logic
│   ├── main.py                # FastAPI application setup
│   ├── models.py              # SQLAlchemy models
│   ├── schemas.py             # Pydantic schemas
│   ├── web_page.py            # Web page routes
│   ├── socket_events.py       # Socket.IO event handlers
│   │
│   ├── core/
│   │   └── ...                # Database, authentication and core utilities
│   │
│   ├── services/
│   │   └── ...                # Background tasks and services
│   │
│   ├── static/
│   │   └── ...                # CSS, JavaScript, images and branding
│   │
│   └── templates/
│       └── ...                # Jinja2 templates
│
├── alembic/
│   └── ...                    # Database migrations
│
├── test/
│   └── ...                    # Automated tests
│
├── requirements.txt
└── README.md
```

---

## 📋 Prerequisites

Before running the application, make sure you have:

* Python **3.11+**
* PostgreSQL
* Redis
* SMTP credentials for password reset emails

---

## 🚀 Installation

### 1. Clone the repository

```bash
git clone https://github.com/MayurMathavadiya/chat-app.git
cd chat-app
```

### 2. Create a virtual environment

```bash
python -m venv .venv
```

Activate it:

**Linux / macOS**

```bash
source .venv/bin/activate
```

**Windows**

```powershell
.venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

---

## ⚙️ Environment Variables

Create a `.env` file in the project root:

```env
SQLALCHEMY_DATABASE_URL=postgresql://username:password@localhost:5432/mk_chats

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

> **Important:** Never commit your `.env` file, passwords, API keys, SMTP credentials, or other secrets to GitHub.

---

## 🗄️ Database Setup

Make sure PostgreSQL is running and your database exists.

Then run the Alembic migrations:

```bash
alembic upgrade head
```

---

## 🔴 Start Redis

Make sure Redis is running:

```bash
redis-server
```

Or, if Redis is already installed as a system service:

```bash
sudo systemctl start redis
```

---

## ▶️ Run the Application

Start the FastAPI development server:

```bash
uvicorn app.main:app --reload
```

The application will be available at:

```text
http://127.0.0.1:8000
```

---

## 🌐 Web Routes

| Route              | Description            |
| ------------------ | ---------------------- |
| `/`                | Chat application       |
| `/login`           | Login page             |
| `/register`        | Registration page      |
| `/forgot-password` | Password reset request |
| `/reset-password`  | Password reset         |
| `/privacy`         | Privacy Policy         |
| `/terms`           | Terms & Conditions     |

---

## 🔌 REST API

### Authentication & Profile

```text
POST   /api/register
POST   /api/login
POST   /api/logout
POST   /api/forgot-password
POST   /api/reset-password

GET    /api/profile
PATCH  /api/profile
POST   /api/profile/password
```

### Contacts

```text
GET    /api/contacts
POST   /api/contacts/block
POST   /api/contacts/unblock
```

### Messages

```text
GET    /api/messages/{contact_id}
POST   /api/messages/clear/{contact_id}
```

### Calls

```text
GET    /api/calls/history
POST   /api/calls
PATCH  /api/calls/{call_id}
```

---

## ⚡ Socket.IO

MK Chats uses **Socket.IO** for real-time communication between clients and the server.

### Messaging Events

| Event       | Description                     |
| ----------- | ------------------------------- |
| `send`      | Send a message                  |
| `edit`      | Edit an existing message        |
| `delete`    | Delete a message                |
| `typing`    | Broadcast typing status         |
| `mark_read` | Mark messages as read           |
| `presence`  | Broadcast online/offline status |

The `send` event supports features such as:

```text
reply_to_id
file_data
```

---

## 📞 WebRTC Signaling

Audio and video calls use **WebRTC** for peer-to-peer media communication.

Socket.IO is used for signaling.

### Signaling Events

```text
webrtc_offer
webrtc_answer
webrtc_ice_candidate

webrtc_upgrade_request
webrtc_upgrade_response

webrtc_end
```

The actual audio/video media connection is established using WebRTC peer connections.

---

## 🔐 Authentication

Authentication can be performed using an `access_token` cookie or an HTTP Authorization header.

Example:

```http
Authorization: Bearer <access_token>
```

The application supports long-lived access tokens using the configured:

```env
ACCESS_TOKEN_EXPIRE_MINUTES=10080
```

---

## 🔒 End-to-End Encryption

MK Chats is designed around an End-to-End Encryption architecture.

Cryptographic keys are derived and handled on the client, while encrypted key material can be stored by the server.

The goal is to prevent the server from directly accessing the plaintext contents of encrypted messages and files.

> **Security Note:** E2EE security depends on the complete client-side cryptographic implementation, key management, authentication, and deployment configuration. Review the implementation carefully before using this project for sensitive or production communication.

---

## 🧪 Testing

Run the test suite with:

```bash
pytest
```

For more detailed output:

```bash
pytest -v
```

---

## 🏗️ Architecture

At a high level, MK Chats works like this:

```text
                    ┌──────────────────┐
                    │      Browser     │
                    │                  │
                    │  Jinja2 + JS     │
                    │  WebRTC Client   │
                    └────────┬─────────┘
                             │
                    HTTP / Socket.IO
                             │
                             ▼
                    ┌──────────────────┐
                    │     FastAPI      │
                    │                  │
                    │ REST API         │
                    │ Authentication   │
                    │ Socket.IO        │
                    │ WebRTC Signaling │
                    └───────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │PostgreSQL│  │  Redis   │  │  SMTP    │
        │          │  │          │  │          │
        │  Data    │  │ Presence │  │  Email   │
        │  Storage │  │  Events  │  │  Reset   │
        └──────────┘  └──────────┘  └──────────┘
```

For audio/video calls:

```text
       User A                         User B
          │                              │
          │        Socket.IO             │
          │◄────── Signaling ───────────►│
          │                              │
          │                              │
          └──────── WebRTC ──────────────┘
                Peer-to-Peer Media
```

---

## 📌 Development Notes

* Socket.IO uses Redis for real-time coordination and presence.
* WebRTC handles peer-to-peer audio/video communication.
* Jinja2 is used for server-rendered pages.
* PostgreSQL stores application data.
* Alembic manages database schema migrations.
* Background services handle cleanup-related tasks.
* CSP middleware provides additional browser-side security.
* Authentication supports both cookies and Bearer tokens.

---

## ⚠️ Production Considerations

Before deploying MK Chats to production:

* Use a strong randomly generated `SECRET_KEY`.
* Never expose `.env` or credentials.
* Use HTTPS.
* Configure secure cookies.
* Use a production PostgreSQL instance.
* Use a secured Redis instance.
* Configure a proper SMTP provider.
* Review WebRTC/STUN/TURN configuration.
* Review the E2EE implementation and key-management model.
* Run the application behind a production ASGI server/reverse proxy.
* Configure appropriate CORS and CSP policies.

---

## 📄 License

Add your preferred open-source license to the repository, such as **MIT**, before publishing the project for reuse.

---

## 👨‍💻 Author

**Mayur Mathavadiya**

GitHub:
https://github.com/MayurMathavadiya

---

<p align="center">
  Built with ❤️ using FastAPI, Python, Socket.IO, WebRTC, Redis and PostgreSQL.
</p>
