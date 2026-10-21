
import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


def _load_local_env():
    """Load simple KEY=VALUE settings from the local, git-ignored .env file."""
    env_path = os.path.join(BASE_DIR, ".env")
    if not os.path.isfile(env_path):
        return

    with open(env_path, encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_local_env()


class Config:
    # Security
    SECRET_KEY = os.environ.get("SECRET_KEY") or "dev-key-change-this"

    # Database
    database_url = os.environ.get("DATABASE_URL")
    if database_url and database_url.startswith("postgres://"):
        # Accept legacy PostgreSQL URLs as well as current Supabase URLs.
        database_url = database_url.replace("postgres://", "postgresql://", 1)

    SQLALCHEMY_DATABASE_URI = database_url or (
        "sqlite:///" + os.path.join(BASE_DIR, "learn2play.db")
    )
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Google OpenID Connect
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
    GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI")
