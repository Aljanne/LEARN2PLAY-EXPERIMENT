
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_wtf.csrf import CSRFProtect

# Database
db = SQLAlchemy()

# User login sessions
login_manager = LoginManager()
login_manager.login_view = "main.login"

# CSRF protection for forms
csrf = CSRFProtect()
