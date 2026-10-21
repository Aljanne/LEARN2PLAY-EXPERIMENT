from flask import Flask
from flask_login import current_user
from flask_migrate import Migrate
from sqlalchemy import text
from werkzeug.middleware.proxy_fix import ProxyFix

if __package__:
    from .config import Config
    from .errors import register_error_handlers
    from .extensions import csrf, db, login_manager
else:
    from config import Config
    from errors import register_error_handlers
    from extensions import csrf, db, login_manager

migrate = Migrate()


def create_app():
    app = Flask(__name__)

    # Vercel terminates HTTPS before forwarding requests to the Flask
    # function. Trust the forwarded host and scheme so external URLs,
    # especially the Google OAuth callback, use the public HTTPS URL.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    # Load application settings
    app.config.from_object(Config)

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    csrf.init_app(app)

    # Import models so SQLAlchemy knows about them
    if __package__:
        from .models import Appointment, Credential, RoleApplication, User
    else:
        from models import Appointment, Credential, RoleApplication, User

    # Tell Flask-Login how to find a user by ID
    @login_manager.user_loader
    def load_user(user_id):
        try:
            return db.session.get(User, int(user_id))
        except (ValueError, TypeError):
            return None

    # Register application routes
    if __package__:
        from .routes import main
    else:
        from routes import main
    app.register_blueprint(main)

    register_error_handlers(app)

    # Non-destructive schema migration
    with app.app_context():
        # Creates appointments table and any missing tables safely
        db.create_all()

        # Add topics_json column if missing
        try:
            db.session.execute(text("ALTER TABLE users ADD COLUMN topics_json TEXT DEFAULT '[]'"))
            db.session.commit()
        except Exception:
            db.session.rollback()

        # Add legacy hourly_rate column if missing
        try:
            db.session.execute(text("ALTER TABLE users ADD COLUMN hourly_rate INTEGER DEFAULT 300"))
            db.session.commit()
        except Exception:
            db.session.rollback()

        # Add separate teaching_rate column if missing
        try:
            db.session.execute(text("ALTER TABLE users ADD COLUMN teaching_rate NUMERIC(10, 2)"))
            db.session.commit()
        except Exception:
            db.session.rollback()

        # Add separate coaching_rate column if missing
        try:
            db.session.execute(text("ALTER TABLE users ADD COLUMN coaching_rate NUMERIC(10, 2)"))
            db.session.commit()
        except Exception:
            db.session.rollback()

        # Non-destructive backfill: initialize from existing hourly_rate for approved mentors and coaches
        try:
            db.session.execute(text("""
                UPDATE users 
                SET teaching_rate = hourly_rate 
                WHERE teaching_rate IS NULL AND hourly_rate IS NOT NULL AND roles_json LIKE '%"mentor"%'
            """))
            db.session.execute(text("""
                UPDATE users 
                SET coaching_rate = hourly_rate 
                WHERE coaching_rate IS NULL AND hourly_rate IS NOT NULL AND roles_json LIKE '%"coach"%'
            """))
            db.session.commit()
        except Exception:
            db.session.rollback()

    return app
