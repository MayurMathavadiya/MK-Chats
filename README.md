# MK Chats

<p align="center">
  <img src="app/static/branding/mk-chats-logo.svg" alt="MK Chats Logo" width="180">
</p>

<p align="center">
  <strong>A secure, real-time chat application built with FastAPI, Socket.IO, WebRTC, Redis, and PostgreSQL.</strong>
</p>

<p align="center">
  <a href="https://github.com/MayurMathavadiya/MK-Chats">GitHub</a>
  •
  <a href="https://github.com/MayurMathavadiya/MK-Chats/issues">Issues</a>
  •
  <a href="https://github.com/MayurMathavadiya/MK-Chats/pulls">Pull Requests</a>
</p>

---

## 📖 About

**MK Chats** is a modern real-time chat application built with **FastAPI**.

It is designed to provide a complete communication experience with real-time messaging, End-to-End Encryption (E2EE), file and image sharing, online presence, typing indicators, message replies, read receipts, contact management, blocking, and audio/video calling using WebRTC.

The application uses **Socket.IO** for real-time communication and **Redis** for presence and event coordination.

The project is also open to community participation. Developers can report bugs, suggest improvements, discuss ideas, and contribute code through GitHub Issues and Pull Requests.

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
* Encrypted key material storage
* Client-side encryption and decryption flow

> **Security Note:** E2EE implementations should always be carefully reviewed before being used for sensitive or production communication.

### 📎 Files & Media

* Image messages
* File messages
* Encrypted file transfers
* Reply to messages containing files/images
* Media sharing through real-time messaging

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

| Technology     | Purpose                                |
| -------------- | -------------------------------------- |
| **Python**     | Programming language                   |
| **FastAPI**    | Backend web framework                  |
| **SQLAlchemy** | ORM / database interaction             |
| **Alembic**    | Database migrations                    |
| **PostgreSQL** | Primary database                       |
| **Redis**      | Presence and real-time coordination    |
| **Socket.IO**  | Real-time communication                |
| **Jinja2**     | Server-side HTML rendering             |
| **WebRTC**     | Peer-to-peer audio/video communication |
| **Pytest**     | Automated testing                      |

---

## 📁 Project Structure

```text
MK-Chats/
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
├── .env.example
├── .gitignore
├── alembic.ini
├── pytest.ini
├── requirements.txt
└── README.md
```

---

## 📋 Prerequisites

Before running MK Chats, make sure you have:

* Python **3.11+**
* PostgreSQL
* Redis
* SMTP credentials for password reset emails
* Git

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/MayurMathavadiya/MK-Chats.git
cd MK-Chats
```

### 2. Create a Virtual Environment

```bash
python -m venv .venv
```

Activate the environment.

#### Linux / macOS

```bash
source .venv/bin/activate
```

#### Windows

```powershell
.venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

---

## ⚙️ Environment Variables

Create a `.env` file in the project root.

Example:

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

Make sure PostgreSQL is running and the `mk_chats` database exists.

Then run the Alembic migrations:

```bash
alembic upgrade head
```

---

## 🔴 Start Redis

Make sure Redis is running.

```bash
redis-server
```

Or, if Redis is installed as a system service:

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

The application supports long-lived access tokens using:

```env
ACCESS_TOKEN_EXPIRE_MINUTES=10080
```

---

## 🔒 End-to-End Encryption

MK Chats is designed around an **End-to-End Encryption architecture**.

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

### WebRTC Call Flow

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

* Socket.IO is used for real-time communication.
* Redis is used for presence and real-time coordination.
* WebRTC handles peer-to-peer audio/video communication.
* Jinja2 is used for server-rendered pages.
* PostgreSQL stores application data.
* SQLAlchemy handles database interaction.
* Alembic manages database schema migrations.
* Background services handle cleanup-related tasks.
* CSP middleware provides additional browser-side security.
* Authentication supports both cookies and Bearer tokens.

---

## 🤝 Contributing

Contributions are welcome!

If you have an idea, bug fix, improvement, optimization, security improvement, UI enhancement, or new feature, feel free to contribute.

### 💡 Ways You Can Contribute

You can contribute by:

* Reporting bugs
* Suggesting new features
* Improving existing features
* Improving UI/UX
* Improving performance
* Improving security
* Adding tests
* Improving documentation
* Fixing typos
* Refactoring code
* Improving error handling
* Adding useful integrations
* Reviewing Pull Requests

---

## 🐛 Reporting Issues

Found a bug or unexpected behavior?

Please open an issue on GitHub:

https://github.com/MayurMathavadiya/MK-Chats/issues

When creating an issue, try to include:

* A clear description of the problem
* Steps to reproduce the issue
* Expected behavior
* Actual behavior
* Python version
* Operating system
* Relevant error messages or logs
* Screenshots, if applicable

Please avoid posting passwords, API keys, tokens, `.env` values, private messages, or other sensitive information.

---

## 💭 Feature Requests

Have an idea for improving MK Chats?

You can open a GitHub Issue and describe:

1. What feature you would like to see
2. Why it would be useful
3. How you think it could work
4. Any examples or references that may help

Feature discussions are welcome before starting large changes.

---

## 🔧 Pull Requests

If you would like to contribute code:

### 1. Fork the Repository

Fork the repository from GitHub:

https://github.com/MayurMathavadiya/MK-Chats

### 2. Clone Your Fork

```bash
git clone https://github.com/YOUR_USERNAME/MK-Chats.git
cd MK-Chats
```

### 3. Create a Branch

Create a descriptive branch for your change:

```bash
git checkout -b feature/add-new-feature
```

Examples:

```text
feature/video-call-improvement
feature/message-search
fix/socket-disconnect
fix/encryption-error
docs/update-readme
refactor/message-service
```

### 4. Make Your Changes

Implement your changes while keeping the existing project structure and coding style in mind.

### 5. Run Tests

Before creating a Pull Request:

```bash
pytest
```

You can also run:

```bash
pytest -v
```

### 6. Commit Your Changes

Use a clear commit message:

```bash
git add .
git commit -m "Add message search functionality"
```

### 7. Push Your Branch

```bash
git push origin feature/add-new-feature
```

### 8. Open a Pull Request

Open a Pull Request against the main repository:

https://github.com/MayurMathavadiya/MK-Chats/pulls

Please explain:

* What you changed
* Why you changed it
* How you tested it
* Any additional configuration required

---

## 🧹 Contribution Guidelines

To keep the project maintainable:

* Keep changes focused and relevant.
* Avoid unnecessary modifications to unrelated files.
* Follow the existing project structure.
* Write clear and maintainable Python code.
* Add or update tests when appropriate.
* Update documentation when behavior changes.
* Do not commit secrets or credentials.
* Do not commit `.env` files.
* Test your changes before submitting a Pull Request.
* Keep Pull Requests reasonably small when possible.

---

## 🔐 Security Issues

If you discover a potential security vulnerability, please avoid publicly exposing sensitive technical details in a GitHub Issue.

Instead, contact the repository maintainer privately through the contact method available on the GitHub profile.

GitHub Profile:

https://github.com/MayurMathavadiya

---

## ⚠️ Production Considerations

Before deploying MK Chats to production:

* Use a strong, randomly generated `SECRET_KEY`.
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
* Monitor application logs and system resources.
* Keep dependencies updated.

---

## 🌱 Community

MK Chats is intended to be a project that can grow through community involvement.

Whether you are:

* A beginner learning FastAPI
* A Python developer
* A backend developer
* A frontend developer
* A WebRTC developer
* A security enthusiast
* A database developer
* Someone interested in real-time applications

you are welcome to explore the project, report issues, suggest improvements, and participate in development.

Every useful contribution is appreciated.

---

## 🆓 Project Status

MK Chats is a **public GitHub project** and development is ongoing.

The repository currently does not include a software license. Contributions and community participation are welcome through GitHub Issues and Pull Requests.

---

## 👨‍💻 Author

**Mayur Mathavadiya**

GitHub:

https://github.com/MayurMathavadiya

---

<p align="center">
  Built with ❤️ using FastAPI, Python, Socket.IO, WebRTC, Redis and PostgreSQL.
</p>

---

## ⭐ Star History

<a href="https://www.star-history.com/?type=date&repos=MayurMathavadiya%2FMK-Chats">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset="https://api.star-history.com/chart?repos=MayurMathavadiya/MK-Chats&type=date&theme=dark&legend=top-left"
    />
    <source
      media="(prefers-color-scheme: light)"
      srcset="https://api.star-history.com/chart?repos=MayurMathavadiya/MK-Chats&type=date&legend=top-left"
    />
    <img
      alt="Star History Chart"
      src="https://api.star-history.com/chart?repos=MayurMathavadiya/MK-Chats&type=date&legend=top-left"
    />
  </picture>
</a>
```

### One thing I'd change from your current README

Your GitHub repository currently still has the old **License** section saying *“Add your preferred open-source license...”* at the bottom.

Delete that entire section. The new README above deliberately has **no `LICENSE` section**.

Also, because you specifically want people to **raise issues and contribute**, the new README makes that very clear without claiming that everyone automatically has legal permission to reuse the code.
