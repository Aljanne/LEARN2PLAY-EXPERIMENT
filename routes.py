import os
import re
import uuid
from pathlib import Path

from flask import (
    Blueprint,
    current_app,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from flask_login import (
    current_user,
    login_required,
    login_user,
    logout_user,
)
from flask_wtf.csrf import generate_csrf
from sqlalchemy.exc import IntegrityError
from werkzeug.utils import secure_filename

from extensions import db
from models import Credential, RoleApplication, User, utcnow


# All routes in this blueprint will be registered under these URLs.
main = Blueprint("main", __name__)

# ---------- registration rules ----------
ALLOWED_ROLES = {"student", "mentor", "coach"}   # "mentor" is shown as "Teacher"
VERIFIED_ROLES = {"mentor", "coach"}             # need admin approval

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
LINK_RE = re.compile(r"^https?://\S+\.\S+$", re.I)

MAX_FILES = 5
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_LINKS = 5
# extension -> bytes the file must actually start with
FILE_SIGNATURES = {
    "pdf": (b"%PDF-",),
    "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",),
    "png": (b"\x89PNG\r\n\x1a\n",),
}


# ---------- helpers ----------
def user_data(user):
    """Consistent user response for the frontend."""
    return {
        "id": user.id,
        "name": user.display_name,
        "email": user.email,
        "roles": user.roles,
        "is_admin": user.is_admin,
        "bio": user.bio or "",
        "profile_picture": user.profile_picture,
        "topics": getattr(user, "topics", []),
        # Actual dynamic activity stats (starts at 0)
        "stats": {
            "sessions_count": 0,
            "mentors_count": 0,
            "hours_count": 0,
            "avg_rating": 0.0,
        },
    }

def error(message, status=400, field=None):
    return jsonify({"ok": False, "message": message, "field": field}), status


def credentials_folder(user_id):
    # Lives in the instance folder (NOT /static) so proofs are never public.
    return Path(current_app.instance_path) / "credentials" / str(user_id)


def check_upload(file):
    """Return (extension, None) if the file is fine, else (None, message)."""
    name = secure_filename(file.filename or "")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""

    if ext not in FILE_SIGNATURES:
        return None, f'"{file.filename}" is not supported. Use PDF, JPG or PNG.'

    head = file.stream.read(8)
    file.stream.seek(0, os.SEEK_END)
    size = file.stream.tell()
    file.stream.seek(0)

    if not any(head.startswith(sig) for sig in FILE_SIGNATURES[ext]):
        return None, f'"{file.filename}" does not look like a real {ext.upper()} file.'
    if size == 0:
        return None, f'"{file.filename}" is empty.'
    if size > MAX_FILE_BYTES:
        return None, f'"{file.filename}" is over 5 MB.'

    return ext, None


def admin_required(view):
    from functools import wraps

    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not current_user.is_admin:
            return error("Administrator access required.", 403)
        return view(*args, **kwargs)

    return wrapped


# ---------- pages ----------
@main.route("/")
def home():
    return redirect(url_for("main.auth_page"))


# Log in page (login only).
@main.route("/auth")
def auth_page():
    return render_template("auth.html")


# Registration page (separate from login).
@main.route("/register")
def register_page():
    return render_template("register.html")


# Get a CSRF token before sending POST requests.
@main.route("/api/csrf-token", methods=["GET"])
def csrf_token():
    return jsonify({"csrf_token": generate_csrf()})


# ---------- register ----------
# Accepts multipart/form-data so teachers and coaches can upload proof.
@main.route("/api/auth/register", methods=["POST"])
def register():
    form = request.form

    name = (form.get("name") or "").strip()
    email = (form.get("email") or "").strip().lower()
    password = form.get("password") or ""
    confirm = form.get("confirm_password") or ""
    roles = set(form.getlist("roles"))

    # --- common fields ---
    if not roles or not roles <= ALLOWED_ROLES:
        return error("Choose at least one valid role.", field="roles")

    if not 2 <= len(name) <= 80:
        return error("Enter your full name (2 to 80 characters).", field="name")

    if not EMAIL_RE.match(email):
        return error("Enter a valid email address.", field="email")

    if len(email) > 120:
        return error("Email must not exceed 120 characters.", field="email")

    if (
        len(password) < 8
        or not re.search(r"[a-z]", password)
        or not re.search(r"[A-Z]", password)
        or not re.search(r"\d", password)
    ):
        return error(
            "Use at least 8 characters, with upper and lower case letters and a number.",
            field="password",
        )

    if password != confirm:
        return error("Passwords don't match.", field="confirmPassword")

    if form.get("acknowledged") != "true":
        return error(
            "Confirm that you understand the review before you continue.",
            field="ack",
        )

    if User.query.filter_by(email=email).first():
        return error(
            "That email is already registered. Try logging in instead.",
            409,
            field="email",
        )

    # --- teacher / coach credentials ---
    needs_review = bool(roles & VERIFIED_ROLES)
    bio, links, checked_files = "", [], []

    if needs_review:
        bio = (form.get("bio") or "").strip()
        links = [link.strip() for link in form.getlist("links") if link.strip()]
        uploads = [f for f in request.files.getlist("proofs") if f and f.filename]

        if not uploads:
            return error(
                "Upload at least one certificate, license, diploma or award.",
                field="proofs",
            )
        if len(uploads) > MAX_FILES:
            return error(f"You can upload up to {MAX_FILES} files.", field="proofs")
        if not 50 <= len(bio) <= 1500:
            return error("Describe your experience in 50 to 1500 characters.", field="bio")
        if len(links) > MAX_LINKS or any(
            not LINK_RE.match(link) or len(link) > 300 for link in links
        ):
            return error(
                f"Links must start with http:// or https:// (max {MAX_LINKS}).",
                field="links",
            )

        for f in uploads:
            ext, problem = check_upload(f)
            if problem:
                return error(problem, field="proofs")
            checked_files.append((f, ext))

    # --- save everything together ---
    saved_paths = []
    try:
        # Only roles that need no review are active right away.
        active_roles = sorted(roles - VERIFIED_ROLES)

        user = User(display_name=name, email=email)
        user.set_password(password)
        user.roles = active_roles

        db.session.add(user)
        db.session.flush()  # gives us user.id

        if needs_review:
            folder = credentials_folder(user.id)
            folder.mkdir(parents=True, exist_ok=True)

            for f, ext in checked_files:
                stored = f"{uuid.uuid4().hex}.{ext}"
                f.save(folder / stored)
                saved_paths.append(folder / stored)
                db.session.add(Credential(
                    user_id=user.id,
                    original_name=secure_filename(f.filename)[:255],
                    stored_name=stored,
                ))

            for role in sorted(roles & VERIFIED_ROLES):
                db.session.add(RoleApplication(
                    user_id=user.id,
                    role=role,
                    bio=bio,
                    links="\n".join(links),
                    status="pending",
                ))

        db.session.commit()

    except IntegrityError:
        db.session.rollback()
        for path in saved_paths:
            path.unlink(missing_ok=True)
        return error(
            "That email is already registered. Try logging in instead.",
            409,
            field="email",
        )

    except Exception:
        db.session.rollback()
        for path in saved_paths:
            path.unlink(missing_ok=True)
        current_app.logger.exception("Registration failed")
        return error("We couldn't create your account. Please try again.", 500)

    # --- response ---
    if not needs_review:
        login_user(user)
        return jsonify({
            "ok": True,
            "pending": False,
            "message": "Your student account is active. Welcome to Learn2Play!",
            "redirect": url_for("main.dashboard"),
            "user": user_data(user),
        }), 201

    if active_roles:  # e.g. Student + Teacher: use the site as a student meanwhile
        login_user(user)
        return jsonify({
            "ok": True,
            "pending": True,
            "message": (
                "Your registration is pending admin review. We'll verify your "
                "credentials and activate your teacher/coach role once approved. "
                "You can use your account as a student in the meantime."
            ),
            "redirect": url_for("main.dashboard"),
            "user": user_data(user),
        }), 201

    return jsonify({
        "ok": True,
        "pending": True,
        "message": (
            "Your registration is pending admin review. We'll verify your "
            "credentials and email you once your teacher/coach role is approved."
        ),
        "redirect": url_for("main.auth_page"),
    }), 201


@main.app_errorhandler(413)
def upload_too_large(_error):
    return error("Your upload is too large. Keep each file under 5 MB.", 413, field="proofs")


# ---------- login ----------
@main.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}

    email = data.get("email", "")
    password = data.get("password", "")
    remember = data.get("remember", False)

    if not isinstance(email, str) or not isinstance(password, str):
        return error("Please enter your email and password.")

    email = email.strip().lower()
    user = User.query.filter_by(email=email).first()

    if not user or not user.check_password(password):
        return error("Incorrect email or password.", 401)

    if not user.is_active:
        return error("This account is inactive.", 403)

    # Teacher/coach-only accounts have no active role until an admin approves.
    if not user.roles:
        pending = RoleApplication.query.filter_by(user_id=user.id, status="pending").first()
        if pending:
            return error(
                "Your registration is still pending admin review. "
                "We'll let you know once it's approved.",
                403,
            )
        return error("Your teacher/coach application was not approved.", 403)

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
    return jsonify({"ok": True, "message": "Logged out successfully."})


# Check whether a user is logged in.
@main.route("/api/me", methods=["GET"])
def get_current_user():
    if not current_user.is_authenticated:
        return error("You are not logged in.", 401)

    return jsonify({"ok": True, "user": user_data(current_user)})


# ---------- admin: review teacher / coach applications ----------
@main.route("/api/admin/applications", methods=["GET"])
@admin_required
def list_applications():
    status = request.args.get("status", "pending")
    rows = (
        RoleApplication.query.filter_by(status=status)
        .order_by(RoleApplication.created_at.asc())
        .all()
    )

    items = []
    for app_row in rows:
        user = db.session.get(User, app_row.user_id)
        creds = Credential.query.filter_by(user_id=app_row.user_id).all()
        items.append({
            "id": app_row.id,
            "role": app_row.role,
            "status": app_row.status,
            "bio": app_row.bio,
            "links": [l for l in (app_row.links or "").split("\n") if l],
            "submitted_at": app_row.created_at.isoformat(),
            "user": {"id": user.id, "name": user.display_name, "email": user.email},
            "credentials": [
                {
                    "id": c.id,
                    "name": c.original_name,
                    "url": url_for("main.download_credential", credential_id=c.id),
                }
                for c in creds
            ],
        })

    return jsonify({"ok": True, "applications": items})


@main.route("/api/admin/applications/<int:application_id>/<action>", methods=["POST"])
@admin_required
def review_application(application_id, action):
    if action not in {"approve", "reject"}:
        return error("Unknown action.", 404)

    app_row = db.session.get(RoleApplication, application_id)
    if not app_row:
        return error("Application not found.", 404)
    if app_row.status != "pending":
        return error("This application was already reviewed.", 409)

    user = db.session.get(User, app_row.user_id)

    if action == "approve":
        app_row.status = "approved"
        user.roles = sorted(set(user.roles) | {app_row.role})
    else:
        app_row.status = "rejected"
        reason = (request.get_json(silent=True) or {}).get("reason", "")
        app_row.review_note = str(reason).strip()[:500] or None

    app_row.reviewed_by = current_user.id
    app_row.reviewed_at = utcnow()
    db.session.commit()

    return jsonify({"ok": True, "message": f"Application {app_row.status}."})


# Admin-only download of submitted proof.
@main.route("/admin/credentials/<int:credential_id>")
@admin_required
def download_credential(credential_id):
    cred = db.session.get(Credential, credential_id)
    if not cred:
        return error("File not found.", 404)

    return send_from_directory(
        credentials_folder(cred.user_id),
        cred.stored_name,
        download_name=cred.original_name,
    )

# ============================================================
# ---------- settings & account management APIs --------------
# ============================================================
@main.route("/api/profile", methods=["POST"])
@login_required
def update_profile():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    bio = data.get("bio")
    topics = data.get("topics")

    if not (2 <= len(name) <= 80):
        return error("Enter your full name (2 to 80 characters).", field="name")

    try:
        current_user.display_name = name
        if bio is not None:
            current_user.bio = str(bio).strip()
        if topics is not None:
            current_user.topics = topics

        # Only touch profile_picture if specifically sent
        if "profile_picture" in data and data["profile_picture"] is not None:
            pic = str(data["profile_picture"]).strip()
            current_user.profile_picture = pic if pic else None

        db.session.commit()
        return jsonify({
            "ok": True,
            "message": "Profile updated successfully.",
            "user": user_data(current_user),
        })
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Profile update error")
        return error("Failed to save changes. Please try again.", 500)

import os
import uuid
from werkzeug.utils import secure_filename

# Upload endpoint for cropped profile pictures
@main.route("/api/profile/avatar", methods=["POST"])
@login_required
def upload_avatar():
    if "avatar" not in request.files:
        return error("No image file provided.")

    file = request.files["avatar"]
    if not file or not file.filename:
        return error("Please select an image.")

    # Validate image extension
    allowed = {"jpg", "jpeg", "png", "webp"}
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in allowed:
        return error("Only JPG, PNG, and WebP images are allowed.")

    try:
        # Create static/uploads/avatars directory if it doesn't exist
        upload_dir = Path(current_app.static_folder) / "uploads" / "avatars"
        upload_dir.mkdir(parents=True, exist_ok=True)

        # Unique file name (e.g. user_2_a1b2c3d4.jpg)
        filename = f"user_{current_user.id}_{uuid.uuid4().hex[:8]}.{ext}"
        filepath = upload_dir / filename
        file.save(filepath)

        # Save relative URL to database (e.g. /static/uploads/avatars/user_2_abc.jpg)
        avatar_url = url_for("static", filename=f"uploads/avatars/{filename}")
        current_user.profile_picture = avatar_url
        db.session.commit()

        return jsonify({
            "ok": True,
            "message": "Avatar uploaded successfully.",
            "profile_picture": avatar_url
        })
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Avatar upload failed")
        return error("Failed to save avatar image.", 500)

# 2. Update password
@main.route("/api/account/password", methods=["POST"])
@login_required
def update_password():
    data = request.get_json(silent=True) or {}
    current_pw = data.get("current_password") or ""
    new_pw = data.get("new_password") or ""

    if not current_pw or not new_pw:
        return error("Please provide both your current and new password.")

    # Check old password using User model's check_password()
    if not current_user.check_password(current_pw):
        return error("Your current password is incorrect.", 403, field="currentPassword")

    # Password complexity validation (same rules as your registration)
    if (
        len(new_pw) < 8
        or not re.search(r"[a-z]", new_pw)
        or not re.search(r"[A-Z]", new_pw)
        or not re.search(r"\d", new_pw)
    ):
        return error(
            "Use at least 8 characters, with upper and lower case letters and a number.",
            field="newPassword",
        )

    if current_pw == new_pw:
        return error("New password must be different from your current password.", field="newPassword")

    try:
        current_user.set_password(new_pw)
        db.session.commit()
        return jsonify({
            "ok": True,
            "message": "Your password has been updated successfully.",
        })
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Password update error")
        return error("Failed to update password. Please try again.", 500)


# 3. Export Personal Data (for the Download Archive button)
@main.route("/api/account/export", methods=["GET"])
@login_required
def export_user_data():
    apps = RoleApplication.query.filter_by(user_id=current_user.id).all()
    creds = Credential.query.filter_by(user_id=current_user.id).all()

    payload = {
        "account": user_data(current_user),
        "applications": [
            {
                "role": a.role,
                "status": a.status,
                "submitted_at": a.created_at.isoformat(),
            }
            for a in apps
        ],
        "uploaded_credentials": [c.original_name for c in creds],
        "exported_at": utcnow().isoformat(),
    }

    response = jsonify(payload)
    response.headers["Content-Disposition"] = "attachment; filename=learn2play_data.json"
    return response


# 4. Deactivate Account
@main.route("/api/account/deactivate", methods=["POST"])
@login_required
def deactivate_account():
    try:
        current_user.is_active = False
        db.session.commit()
        logout_user()
        return jsonify({
            "ok": True,
            "message": "Account deactivated.",
            "redirect": url_for("main.auth_page"),
        })
    except Exception:
        db.session.rollback()
        return error("Failed to deactivate account.", 500)

# ---------- app pages ----------
@main.route("/dashboard", methods=["GET"])
@login_required
def dashboard():
    return render_template("dashboard.html")


@main.route("/profile")
@login_required
def profile():
    return render_template("profile.html")


@main.route("/sessions")
@login_required
def sessions():
    return render_template("sessions.html")


@main.route("/settings")
@login_required
def settings():
    return render_template("settings.html")


@main.route("/help")
def help():
    return render_template("help.html")