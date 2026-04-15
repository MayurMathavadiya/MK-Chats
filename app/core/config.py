import os
from fastapi.templating import Jinja2Templates
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):

    # Database
    SQLALCHEMY_DATABASE_URL: str

    # Supabase call signaling
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    
    # Auth
    SECRET_KEY: str
    ALGORITHM: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int

    # Email
    SMTP_SERVER: str
    SMTP_PORT: int = 587
    SMTP_USERNAME: str
    SMTP_PASSWORD: str
    SMTP_FROM_EMAIL: str

    # Tags
    AUTH_TAG: str = "Auth"
    PROFILE_TAG: str = "Profile"
    CONTACT_TAG: str = "Contacts"
    MESSAGE_TAG: str = "Messages"
    CALL_TAG: str = "Calls"
    WEB_TAG: str = "Web Pages"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()


# Setup Templates
parent_path = os.path.dirname(os.path.dirname(__file__))
templates_dir = os.path.join(parent_path, "templates")
templates = Jinja2Templates(directory=templates_dir)
