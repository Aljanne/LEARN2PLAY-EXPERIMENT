
import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    # Security
    SECRET_KEY = os.environ.get("SECRET_KEY") or "dev-key-change-this"

    # Database
    SQLALCHEMY_DATABASE_URI = (
        os.environ.get("DATABASE_URL")
        or "sqlite:///" + os.path.join(BASE_DIR, "learn2play.db")
    )

    SQLALCHEMY_TRACK_MODIFICATIONS = False
