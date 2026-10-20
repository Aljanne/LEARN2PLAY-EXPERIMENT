
import json

from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db
from datetime import datetime, timezone
from extensions import db
 
 
def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)

class User(UserMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)

    # Account information
    display_name = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False)

    # Roles: student, mentor, and/or coach
    roles_json = db.Column(db.Text, nullable=False, default='["student"]')

    # Profile information
    bio = db.Column(db.Text, nullable=True)
    profile_picture = db.Column(db.String(255), nullable=True)
    topics_json = db.Column(db.Text, nullable=True, default='[]')

    # Administrative access is separate from user-selected roles
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    @property
    def roles(self):
        return json.loads(self.roles_json)

    @property
    def topics(self):
        try:
            return json.loads(self.topics_json) if self.topics_json else []
        except Exception:
            return []
    @topics.setter
    def topics(self, value):
        if isinstance(value, list):
            self.topics_json = json.dumps(list(dict.fromkeys([t.strip() for t in value if t.strip()])))
        elif isinstance(value, str):
            items = [t.strip() for t in value.split(",") if t.strip()]
            self.topics_json = json.dumps(list(dict.fromkeys(items)))
        else:
            self.topics_json = '[]'

    @roles.setter
    def roles(self, value):
        allowed_roles = {"student", "mentor", "coach"}

        if not isinstance(value, list):
            raise ValueError("Roles must be a list.")

        if not value or any(role not in allowed_roles for role in value):
            raise ValueError("Please select at least one valid role.")

        self.roles_json = json.dumps(list(dict.fromkeys(value)))

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f"<User {self.email}>"

class RoleApplication(db.Model):
    """A request for a role that needs admin approval (mentor/teacher or coach)."""
    __tablename__ = "role_applications"
 
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    role = db.Column(db.String(20), nullable=False)              # mentor | coach
    bio = db.Column(db.Text, nullable=False)
    links = db.Column(db.Text, default="")                       # one URL per line
    status = db.Column(db.String(20), nullable=False, default="pending")  # pending | approved | rejected
    review_note = db.Column(db.String(500))
    reviewed_by = db.Column(db.Integer)
    reviewed_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
 
    __table_args__ = (db.UniqueConstraint("user_id", "role"),)
 
 
class Credential(db.Model):
    """An uploaded proof file (certificate, license, diploma, award)."""
    __tablename__ = "credentials"
 
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    original_name = db.Column(db.String(255), nullable=False)
    stored_name = db.Column(db.String(64), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
