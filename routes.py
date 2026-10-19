
from flask import Blueprint, jsonify, request, render_template, redirect, url_for
from flask_login import (
    current_user,
    login_user,
    logout_user,
    login_required,
)
from flask_wtf.csrf import generate_csrf
from urllib.parse import urlparse

from extensions import db
from models import User


# All routes in this blueprint will be registered under these URLs.
main = Blueprint("main", __name__)

@main.route("/")
def home():
    return redirect(url_for("main.auth_page"))

@main.route("/auth")
def auth_page():
    return render_template("auth.html")


# Get a consistent user response for the frontend.
def user_data(user):
    return {
        "id": user.id,
        "name": user.display_name,
        "email": user.email,
        "roles": user.roles,
        "is_admin": user.is_admin,
        "bio": user.bio,
        "profile_picture": user.profile_picture,
    }


# Get a CSRF token before sending POST requests.
@main.route("/api/csrf-token", methods=["GET"])
def csrf_token():
    return jsonify({"csrf_token": generate_csrf()})


# Register a new account.
@main.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}

    name = data.get("name", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    roles = data.get("roles", [])

    # Check the submitted information.
    if not name or len(name) < 2 or len(name) > 80:
        return jsonify({
            "ok": False,
            "message": "Name must be between 2 and 80 characters."
        }), 400

    if not isinstance(email, str) or "@" not in email:
        return jsonify({
            "ok": False,
            "message": "Please enter a valid email address."
        }), 400

    if len(email) > 120:
        return jsonify({
            "ok": False,
            "message": "Email must not exceed 120 characters."
        }), 400

    if not isinstance(password, str) or len(password) < 6:
        return jsonify({
            "ok": False,
            "message": "Password must contain at least 6 characters."
        }), 400

    allowed_roles = {"student", "mentor", "coach"}

    if (
        not isinstance(roles, list)
        or not roles
        or any(role not in allowed_roles for role in roles)
    ):
        return jsonify({
            "ok": False,
            "message": "Please select at least one valid role."
        }), 400

    # Prevent duplicate accounts.
    if User.query.filter_by(email=email).first():
        return jsonify({
            "ok": False,
            "message": "That email is already registered."
        }), 409

    # Create and save the account.
    user = User(
        display_name=name,
        email=email,
    )
    user.set_password(password)
    user.roles = roles

    db.session.add(user)
    db.session.commit()

    # Log in the user after successful registration.
    login_user(user)

    return jsonify({
        "ok": True,
        "message": "Account created successfully.",
        "user": user_data(user),
    }), 201


# Log in an existing account.
@main.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}

    email = data.get("email", "")
    password = data.get("password", "")
    remember = data.get("remember", False)

    if not isinstance(email, str) or not isinstance(password, str):
        return jsonify({
            "ok": False,
            "message": "Please enter your email and password."
        }), 400

    email = email.strip().lower()

    user = User.query.filter_by(email=email).first()

    if not user or not user.check_password(password):
        return jsonify({
            "ok": False,
            "message": "Incorrect email or password."
        }), 401

    if not user.is_active:
        return jsonify({
            "ok": False,
            "message": "This account is inactive."
        }), 403

    login_user(user, remember=remember is True)

    return jsonify({
        "ok": True,
        "message": "Logged in successfully.",
        "user": user_data(user),
    })


# Log out the current user.
@main.route("/api/auth/logout", methods=["POST"])
@login_required
def logout():
    logout_user()

    return jsonify({
        "ok": True,
        "message": "Logged out successfully."
    })


# Check whether a user is logged in.
@main.route("/api/me", methods=["GET"])
def get_current_user():
    if not current_user.is_authenticated:
        return jsonify({
            "ok": False,
            "message": "You are not logged in."
        }), 401

    return jsonify({
        "ok": True,
        "user": user_data(current_user),
    })


@main.route("/api/profile", methods=["POST"])
@login_required
def update_profile():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"ok": False, "message": "Please submit profile details."}), 400

    name = data.get("name")
    bio = data.get("bio", "")
    picture = data.get("profile_picture", "")
    if not all(isinstance(value, str) for value in (name, bio, picture)):
        return jsonify({"ok": False, "message": "Profile fields must be text."}), 400

    name, bio, picture = name.strip(), bio.strip(), picture.strip()
    if not 2 <= len(name) <= 80:
        return jsonify({"ok": False, "message": "Name must be between 2 and 80 characters."}), 400
    if len(bio) > 500:
        return jsonify({"ok": False, "message": "Introduction must not exceed 500 characters."}), 400
    if len(picture) > 255:
        return jsonify({"ok": False, "message": "Profile picture URL is too long."}), 400
    if picture:
        parsed = urlparse(picture)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return jsonify({"ok": False, "message": "Profile picture must be an HTTP or HTTPS URL."}), 400

    current_user.display_name = name
    current_user.bio = bio or None
    current_user.profile_picture = picture or None
    db.session.commit()
    return jsonify({"ok": True, "message": "Profile updated.", "user": user_data(current_user)})


@main.route("/api/account/password", methods=["POST"])
@login_required
def change_password():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"ok": False, "message": "Please submit your password details."}), 400

    current_password = data.get("current_password")
    new_password = data.get("new_password")
    if not isinstance(current_password, str) or not isinstance(new_password, str):
        return jsonify({"ok": False, "message": "Enter your current and new password."}), 400
    if not current_user.check_password(current_password):
        return jsonify({"ok": False, "message": "Your current password is incorrect."}), 400
    if len(new_password) < 6 or len(new_password) > 128:
        return jsonify({"ok": False, "message": "New password must be 6 to 128 characters."}), 400

    current_user.set_password(new_password)
    db.session.commit()
    return jsonify({"ok": True, "message": "Password updated successfully."})


# Example protected dashboard page.
# This assumes dashboard.html is inside the templates folder.
@main.route("/dashboard", methods=["GET"])
@login_required
def dashboard():
    return render_template("dashboard.html")


# View profile page
@main.route("/profile")
@login_required
def profile():
    return render_template("profile.html")


# Sessions page
@main.route("/sessions")
@login_required
def sessions():
    return render_template("sessions.html")


# Settings page
@main.route("/settings")
@login_required
def settings():
    return render_template("settings.html")


# Help and support page
@main.route("/help")
def help():
    return render_template("help.html")

