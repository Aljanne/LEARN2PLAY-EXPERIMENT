from flask import Flask
from flask_login import current_user
from flask_migrate import Migrate
from sqlalchemy import text

from config import Config
from errors import register_error_handlers
from extensions import db, login_manager, csrf

# Create Migrate instance
migrate = Migrate()


def create_app():
    app = Flask(__name__)

    # Load application settings
    app.config.from_object(Config)

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    csrf.init_app(app)

    # Import models so SQLAlchemy knows about them
    from models import User

    # Tell Flask-Login how to find a user by ID
    @login_manager.user_loader
    def load_user(user_id):
        try:
            return db.session.get(User, int(user_id))
        except (ValueError, TypeError):
            return None

    # Register application routes
    from routes import main
    app.register_blueprint(main)

    register_error_handlers(app)

    # Create database tables & auto-add topics column if missing
    with app.app_context():
        db.create_all()
        try:
            db.session.execute(text("ALTER TABLE users ADD COLUMN topics_json TEXT DEFAULT '[]'"))
            db.session.commit()
        except Exception:
            db.session.rollback()  # Column already exists, safe to ignore

    return app