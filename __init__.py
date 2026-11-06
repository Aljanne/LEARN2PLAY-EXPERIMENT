from flask import Flask

if __package__:
    from .config import Config
    from .errors import register_error_handlers
    from .extensions import csrf, db, login_manager, migrate
else:
    from config import Config
    from errors import register_error_handlers
    from extensions import csrf, db, login_manager, migrate


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
    if __package__:
        from .models import Appointment, Credential, MentorAvailability, MentorUnavailableDate, Message, Report, RoleApplication, User
    else:
        from models import Appointment, Credential, MentorAvailability, MentorUnavailableDate, Message, Report, RoleApplication, User

    # Tell Flask-Login how to find a user by ID
    @login_manager.user_loader
    def load_user(user_id):
        try:
            user = db.session.get(User, int(user_id))
            # Flask-Login reloads this on each request. Returning None immediately
            # invalidates sessions for accounts deactivated since the last login.
            return user if user and user.is_active else None
        except (ValueError, TypeError):
            return None

    # Register application routes
    if __package__:
        from .routes import main
    else:
        from routes import main
    app.register_blueprint(main)

    register_error_handlers(app)

    return app
