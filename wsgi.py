"""WSGI entry point used by Flask's default app discovery."""

if __package__:
    from .app import app
else:
    from app import app
