import asyncio

from app.core import email


def test_send_password_reset_email_skips_smtp_when_not_configured(monkeypatch):
    send_calls = []

    async def fake_send(*args, **kwargs):
        send_calls.append((args, kwargs))

    monkeypatch.setattr(email.aiosmtplib, "send", fake_send)
    monkeypatch.setattr(email.settings, "SMTP_SERVER", "")
    monkeypatch.setattr(email.settings, "SMTP_USERNAME", "")

    asyncio.run(
        email.send_password_reset_email(
            "person@example.com",
            "token-123",
            "http://testserver",
        )
    )

    assert send_calls == []


def test_send_password_reset_email_uses_smtp_when_configured(monkeypatch):
    send_calls = []

    async def fake_send(*args, **kwargs):
        send_calls.append((args, kwargs))

    monkeypatch.setattr(email.aiosmtplib, "send", fake_send)
    monkeypatch.setattr(email.settings, "SMTP_SERVER", "smtp.example.com")
    monkeypatch.setattr(email.settings, "SMTP_USERNAME", "user")
    monkeypatch.setattr(email.settings, "SMTP_PASSWORD", "pass")
    monkeypatch.setattr(email.settings, "SMTP_PORT", 587)
    monkeypatch.setattr(email.settings, "SMTP_FROM_EMAIL", "noreply@example.com")

    asyncio.run(
        email.send_password_reset_email(
            "person@example.com",
            "token-123",
            "http://testserver",
        )
    )

    assert len(send_calls) == 1
