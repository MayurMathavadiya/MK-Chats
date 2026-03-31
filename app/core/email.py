import aiosmtplib
from email.message import EmailMessage

from app.core.config import settings


async def send_password_reset_email(to_email: str, token: str, request_host: str):
    """
    Sends an beautifully styled HTML email to the user with a password reset link.
    """
    reset_link = f"{request_host}/reset-password?token={token}"
    
    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset your GapShap Password</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #0f172a; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0f172a; width: 100%;">
            <tr>
                <td align="center" style="padding: 40px 20px;">
                    <!-- Main Container -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #1e293b; border-radius: 24px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                        <tr>
                            <td align="center" style="padding: 40px 30px;">
                                <!-- Logo Placeholder -->
                                <table border="0" cellpadding="0" cellspacing="0" style="background-color: #334155; border-radius: 16px; margin-bottom: 24px; border: 1px solid #475569;">
                                    <tr>
                                        <td align="center" valign="middle" width="56" height="56">
                                            <span style="color: #ffffff; font-weight: bold; font-size: 24px; display: block; line-height: 56px;">GS</span>
                                        </td>
                                    </tr>
                                </table>
                                
                                <h1 style="margin: 0 0 16px 0; font-size: 24px; color: #ffffff; font-weight: 700;">Reset Your Password</h1>
                                
                                <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 1.6; color: #cbd5e1;">
                                    We received a request to reset your GapShap password. Click the button below to choose a new password and securely regenerate your End-to-End keys.
                                </p>
                                
                                <!-- Warning Box -->
                                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #450a0a; border: 1px solid #7f1d1d; border-radius: 12px; margin-bottom: 32px;">
                                    <tr>
                                        <td style="padding: 16px; text-align: left;">
                                            <div style="color: #fca5a5; font-size: 12px; font-weight: bold; text-transform: uppercase; margin-bottom: 8px;">Important Security Notice</div>
                                            <div style="margin: 0; font-size: 13px; color: #f8fafc; line-height: 1.5;">Because GapShap uses true End-to-End Encryption, resetting your password means you will generate entirely new encryption keys. Your previous chat history will become permanently unreadable.</div>
                                        </td>
                                    </tr>
                                </table>
                                
                                <!-- Button -->
                                <table border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 32px;">
                                    <tr>
                                        <td align="center" bgcolor="#6366f1" style="border-radius: 9999px;">
                                            <a href="{reset_link}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 15px; color: #ffffff; font-weight: bold; text-decoration: none; border-radius: 9999px; border: 1px solid #6366f1;">Reset Password</a>
                                        </td>
                                    </tr>
                                </table>
                                
                                <!-- Footer -->
                                <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                                    If you did not request a password reset, you can safely ignore this email.<br>
                                    This link will expire in 15 minutes.
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    """

    msg = EmailMessage()
    msg["Subject"] = "Reset your GapShap password"
    msg["From"] = settings.SMTP_FROM_EMAIL
    msg["To"] = to_email
    
    # Text fallback
    msg.set_content(f"Visit this link to reset your GapShap password: {reset_link}\n\nWarning: Resetting your password will regenerate your encryption keys and make past messages unreadable.")
    
    # HTML Content
    msg.add_alternative(html_content, subtype="html")

    # If SMTP isn't fully configured, log the email link for dev purposes
    if not settings.SMTP_SERVER or not settings.SMTP_USERNAME:
        return

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_SERVER,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USERNAME,
            password=settings.SMTP_PASSWORD,
            use_tls=True if settings.SMTP_PORT == 465 else False,
            start_tls=True if settings.SMTP_PORT == 587 else False,
        )

    except Exception as e:
        # Re-raise so backend can handle failure
        raise e
