import os
from pydantic import ConfigDict
from pydantic_settings import BaseSettings
from fastapi.templating import Jinja2Templates


class Settings(BaseSettings):
    SQLALCHEMY_DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int
    SMTP_SERVER: str
    SMTP_PORT: int = 587
    SMTP_USERNAME: str
    SMTP_PASSWORD: str
    SMTP_FROM_EMAIL: str

    model_config = ConfigDict(
        env_file=".env"
    )


settings = Settings()


# Setup Templates
parent_path = os.path.dirname(os.path.dirname(__file__))
templates_dir = os.path.join(parent_path, "templates")
templates = Jinja2Templates(directory=templates_dir)

