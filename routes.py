import os
import re
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps
from io import BytesIO
from pathlib import Path

from flask import (
    Blueprint,
    abort,
    current_app,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
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
from supabase import create_client
from werkzeug.utils import secure_filename

if __package__:
    from .extensions import db
    from .models import Appointment, Credential, MentorAvailability, MentorUnavailableDate, Message, Report, RoleApplication, User, utcnow
else:
    from extensions import db
    from models import Appointment, Credential, MentorAvailability, MentorUnavailableDate, Message, Report, RoleApplication, User, utcnow

main = Blueprint("main", __name__)

# ---------- Application Configuration & Central Currency ----------
ALLOWED_ROLES = {"student", "mentor", "coach"}   # "mentor" is displayed to users as "Teacher"
VERIFIED_ROLES = {"mentor", "coach"}            # activation requires admin approval

CURRENCY_CODE = "PHP"
CURRENCY_SYMBOL = "₱"

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
LINK_RE = re.compile(r"^https?://\S+\.\S+$", re.I)

MAX_FILES = 5
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_LINKS = 5

FILE_SIGNATURES = {
    "pdf": (b"%PDF-",),
    "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",),
    "png": (b"\x89PNG\r\n\x1a\n",),
}

CREDENTIALS_BUCKET = "credentials"
CREDENTIAL_MIME_TYPES = {
    "pdf": "application/pdf",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
}


# ---------- Rate & Timezone Helpers ----------
def parse_rate(raw_value):
    """
    Parses rate input:
    - None or "" -> None (Rate not set)
    - Valid number -> Decimal rounded to 2 places
    Raises ValueError on negative, non-finite, or excessively large amounts (> 50,000).
    """
    if raw_value is None or str(raw_value).strip() == "":
        return None
    try:
        val = Decimal(str(raw_value).strip())
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError("Rate must be a valid number.")

    if not val.is_finite():
        raise ValueError("Rate must be a finite number.")
    if val < 0:
        raise ValueError("Rate cannot be negative.")
    if val > Decimal("50000"):
        raise ValueError("Rate cannot exceed ₱50,000 per hour.")

    return val.quantize(Decimal("0.01"))


def format_dt_pht(dt):
    """Formats UTC datetime into Philippine Standard Time (PHT, UTC+8)."""
    if not dt:
        return ""
    pht = dt + timedelta(hours=8)
    return pht.strftime("%b %d, %Y at %I:%M %p")


def format_time_range_pht(dt, duration_minutes):
    """Formats start time to end time range in PHT."""
    if not dt:
        return ""
    start_pht = dt + timedelta(hours=8)
    end_pht = start_pht + timedelta(minutes=duration_minutes or 60)
    return f"{start_pht.strftime('%I:%M %p')} – {end_pht.strftime('%I:%M %p')}"


# ---------- Decorators ----------
def admin_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not current_user.is_admin:
            return error("Administrator access required.", 403)
        response = current_app.make_response(view(*args, **kwargs))
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
    return wrapped


def provider_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not any(r in current_user.roles for r in ("mentor", "coach")):
            if request.is_json or request.path.startswith("/api/"):
                return error("Teacher or Coach role required.", 403)
            abort(403)
        return view(*args, **kwargs)
    return wrapped


# ---------- User Serializer ----------
def user_data(user):
    """Consistent user response for frontend consumption."""
    # Compute real dynamic statistics from database appointments
    sessions_count = 0
    total_minutes = 0
    mentors_met = set()

    try:
        completed_provided = Appointment.query.filter_by(provider_id=user.id, status="completed").all()
        completed_attended = Appointment.query.filter_by(student_id=user.id, status="completed").all()
        sessions_count = len(completed_provided) + len(completed_attended)
        total_minutes = sum(a.duration_minutes for a in completed_provided + completed_attended)
        mentors_met = {a.provider_id for a in completed_attended}
    except Exception:
        pass

    return {
        "id": user.id,
        "name": user.display_name,
        "email": user.email,
        "roles": user.roles,
        "is_admin": user.is_admin,
        "bio": user.bio or "",
        "profile_picture": user.profile_picture,
        "topics": getattr(user, "topics", []),
        "teaching_rate": float(user.teaching_rate) if user.teaching_rate is not None else None,
        "coaching_rate": float(user.coaching_rate) if user.coaching_rate is not None else None,
        "hourly_rate": float(user.teaching_rate if user.teaching_rate is not None else (user.coaching_rate if user.coaching_rate is not None else (user.hourly_rate or 300))),
        "currency": CURRENCY_CODE,
        "currency_symbol": CURRENCY_SYMBOL,
        "stats": {
            "sessions_count": sessions_count,
            "mentors_count": len(mentors_met),
            "hours_count": round(total_minutes / 60, 1),
            "avg_rating": 5.0 if sessions_count > 0 else 0.0,
        },
    }


def error(message, status=400, field=None):
    return jsonify({"ok": False, "message": message, "field": field}), status


def credentials_bucket():
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise RuntimeError("Supabase Storage credentials are not configured.")

    client = create_client(supabase_url, service_role_key)
    return client.storage.from_(CREDENTIALS_BUCKET)


def cleanup_credential_objects(object_paths):
    if not object_paths:
        return
    try:
        credentials_bucket().remove(object_paths)
    except Exception:
        current_app.logger.exception("Failed to clean up credential objects in Storage")


def check_upload(file):
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


# ---------- Static & Auth Pages ----------
@main.route("/")
def home():
    if current_user.is_authenticated:
        if current_user.is_admin:
            return redirect(url_for("main.admin_dashboard"))

        return redirect(url_for("main.dashboard"))

    return render_template("landing.html")


@main.route("/auth")
def auth_page():
    return render_template("auth.html")


@main.route("/register")
def register_page():
    return render_template("register.html")


@main.route("/api/csrf-token", methods=["GET"])
def csrf_token():
    return jsonify({"csrf_token": generate_csrf()})


# ---------- Register & Login API ----------
@main.route("/api/auth/register", methods=["POST"])
def register():
    form = request.form

    name = (form.get("name") or "").strip()
    email = (form.get("email") or "").strip().lower()
    password = form.get("password") or ""
    confirm = form.get("confirm_password") or ""
    roles = set(form.getlist("roles"))

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
        return error("Confirm that you understand the review before you continue.", field="ack")
    if User.query.filter_by(email=email).first():
        return error("That email is already registered. Try logging in instead.", 409, field="email")

    needs_review = bool(roles & VERIFIED_ROLES)
    bio, links, checked_files = "", [], []

    if needs_review:
        bio = (form.get("bio") or "").strip()
        links = [link.strip() for link in form.getlist("links") if link.strip()]
        uploads = [f for f in request.files.getlist("proofs") if f and f.filename]

        if not uploads:
            return error("Upload at least one certificate, license, diploma or award.", field="proofs")
        if len(uploads) > MAX_FILES:
            return error(f"You can upload up to {MAX_FILES} files.", field="proofs")
        if not 50 <= len(bio) <= 1500:
            return error("Describe your experience in 50 to 1500 characters.", field="bio")
        if len(links) > MAX_LINKS or any(not LINK_RE.match(link) or len(link) > 300 for link in links):
            return error(f"Links must start with http:// or https:// (max {MAX_LINKS}).", field="links")

        for f in uploads:
            ext, problem = check_upload(f)
            if problem:
                return error(problem, field="proofs")
            checked_files.append((f, ext))

    uploaded_object_paths = []
    try:
        active_roles = sorted(roles - VERIFIED_ROLES)
        user = User(display_name=name, email=email)
        user.set_password(password)
        user.roles = active_roles

        db.session.add(user)
        db.session.flush()

        if needs_review:
            bucket = credentials_bucket()
            for f, ext in checked_files:
                stored = f"{user.id}/{uuid.uuid4().hex}.{ext}"
                bucket.upload(
                    path=stored,
                    file=f.read(),
                    file_options={
                        "content-type": CREDENTIAL_MIME_TYPES[ext],
                        "upsert": "false",
                    },
                )
                uploaded_object_paths.append(stored)
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
        cleanup_credential_objects(uploaded_object_paths)
        return error("That email is already registered. Try logging in instead.", 409, field="email")

    except Exception:
        db.session.rollback()
        cleanup_credential_objects(uploaded_object_paths)
        current_app.logger.exception("Registration failed")
        return error("We couldn't create your account. Please try again.", 500)

    if not needs_review:
        login_user(user)
        return jsonify({
            "ok": True,
            "pending": False,
            "message": "Your student account is active. Welcome to Learn2Play!",
            "redirect": url_for("main.dashboard"),
            "user": user_data(user),
        }), 201

    if active_roles:
        login_user(user)
        return jsonify({
            "ok": True,
            "pending": True,
            "message": "Your registration is pending admin review. You can use your account as a student in the meantime.",
            "redirect": url_for("main.dashboard"),
            "user": user_data(user),
        }), 201

    return jsonify({
        "ok": True,
        "pending": True,
        "message": "Your registration is pending admin review. We'll verify your credentials and email you once approved.",
        "redirect": url_for("main.auth_page"),
    }), 201


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

    if not user.roles:
        pending = RoleApplication.query.filter_by(user_id=user.id, status="pending").first()
        if pending:
            return error("Your registration is still pending admin review.", 403)
        return error("Your teacher/coach application was not approved.", 403)

    login_user(user, remember=remember is True)

# Redirect admins and regular users to their respective dashboards
    redirect_url = (
        url_for("main.admin_dashboard")
        if user.is_admin
        else url_for("main.dashboard")
    )

    return jsonify({
        "ok": True,
        "message": "Logged in successfully.",
        "redirect": redirect_url,
        "user": user_data(user),
    })

@main.route("/api/auth/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    return jsonify({"ok": True, "message": "Logged out successfully."})


@main.route("/api/me", methods=["GET"])
def get_current_user():
    if not current_user.is_authenticated:
        return error("You are not logged in.", 401)
    return jsonify({"ok": True, "user": user_data(current_user)})


# ---------- Admin Endpoints ----------
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


@main.route("/admin/credentials/<int:credential_id>")
@admin_required
def download_credential(credential_id):
    cred = db.session.get(Credential, credential_id)
    if not cred:
        return error("File not found.", 404)
    try:
        file_bytes = credentials_bucket().download(cred.stored_name)
        extension = (
            cred.original_name.rsplit(".", 1)[-1].lower()
            if "." in cred.original_name
            else ""
        )
        mimetype = CREDENTIAL_MIME_TYPES.get(extension, "application/octet-stream")
        return send_file(
            BytesIO(file_bytes),
            mimetype=mimetype,
            as_attachment=True,
            download_name=cred.original_name,
        )
    except Exception:
        current_app.logger.exception("Credential download from Storage failed")
        return error("Unable to retrieve the credential file.", 500)


# ---------- Profile Management APIs (Requirements 2 & 3) ----------
@main.route("/api/profile", methods=["POST"])
@login_required
def update_profile():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    bio = data.get("bio")
    topics = data.get("topics")

    if not (2 <= len(name) <= 80):
        return error("Enter your full name (2 to 80 characters).", field="name")

    is_mentor = "mentor" in current_user.roles
    is_coach = "coach" in current_user.roles

    # Validate and handle rates
    parsed_teaching_rate = None
    has_teaching_rate = "teaching_rate" in data

    if has_teaching_rate:
        if not is_mentor:
            return error("Only approved Teachers can set a teaching rate.", 403, field="teaching_rate")
        try:
            parsed_teaching_rate = parse_rate(data["teaching_rate"])
        except ValueError as ex:
            return error(str(ex), 400, field="teaching_rate")

    parsed_coaching_rate = None
    has_coaching_rate = "coaching_rate" in data

    if has_coaching_rate:
        if not is_coach:
            return error("Only approved Coaches can set a coaching rate.", 403, field="coaching_rate")
        try:
            parsed_coaching_rate = parse_rate(data["coaching_rate"])
        except ValueError as ex:
            return error(str(ex), 400, field="coaching_rate")

    # Legacy rate parameter compatibility
    if "hourly_rate" in data and not has_teaching_rate and not has_coaching_rate:
        if not (is_mentor or is_coach):
            return error("Only teachers and coaches can set hourly rates.", 403, field="hourly_rate")
        try:
            legacy_val = parse_rate(data["hourly_rate"])
            if is_mentor:
                parsed_teaching_rate = legacy_val
                has_teaching_rate = True
            if is_coach:
                parsed_coaching_rate = legacy_val
                has_coaching_rate = True
        except ValueError as ex:
            return error(str(ex), 400, field="hourly_rate")

    try:
        current_user.display_name = name

        if bio is not None:
            current_user.bio = str(bio).strip()[:500]
        if topics is not None:
            current_user.topics = topics

        if has_teaching_rate:
            current_user.teaching_rate = parsed_teaching_rate
            if parsed_teaching_rate is not None:
                current_user.hourly_rate = int(parsed_teaching_rate)

        if has_coaching_rate:
            current_user.coaching_rate = parsed_coaching_rate
            if parsed_coaching_rate is not None and not has_teaching_rate:
                current_user.hourly_rate = int(parsed_coaching_rate)

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
        current_app.logger.exception("Failed to update profile")
        return error("Failed to save changes. Please try again.", 500)


@main.route("/api/profile/avatar", methods=["POST"])
@login_required
def upload_avatar():
    if "avatar" not in request.files:
        return error("No image file provided.")

    file = request.files["avatar"]
    if not file or not file.filename:
        return error("Please select an image.")

    allowed = {"jpg", "jpeg", "png", "webp"}
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in allowed:
        return error("Only JPG, PNG, and WebP images are allowed.")

    try:
        upload_dir = Path(current_app.static_folder) / "uploads" / "avatars"
        upload_dir.mkdir(parents=True, exist_ok=True)

        filename = f"user_{current_user.id}_{uuid.uuid4().hex[:8]}.{ext}"
        filepath = upload_dir / filename
        file.save(filepath)

        avatar_url = url_for("static", filename=f"uploads/avatars/{filename}")
        current_user.profile_picture = avatar_url
        db.session.commit()

        return jsonify({
            "ok": True,
            "message": "Avatar uploaded successfully.",
            "profile_picture": avatar_url,
        })
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Avatar upload failed")
        return error("Failed to save avatar image.", 500)


@main.route("/api/account/password", methods=["POST"])
@login_required
def update_password():
    data = request.get_json(silent=True) or {}
    current_pw = data.get("current_password") or ""
    new_pw = data.get("new_password") or ""

    if not current_pw or not new_pw:
        return error("Please provide both your current and new password.")
    if not current_user.check_password(current_pw):
        return error("Your current password is incorrect.", 403, field="currentPassword")
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
        return jsonify({"ok": True, "message": "Your password has been updated successfully."})
    except Exception:
        db.session.rollback()
        return error("Failed to update password. Please try again.", 500)


# ---------- Provider Directory API ----------
@main.route("/api/tutors", methods=["GET"])
def get_registered_tutors():
    users = User.query.filter_by(is_active=True).all()
    tutors = []

    for u in users:
        roles = u.roles
        is_mentor = "mentor" in roles
        is_coach = "coach" in roles

        if is_mentor or is_coach:
            category = "academic" if is_mentor and not is_coach else ("gaming" if is_coach and not is_mentor else "both")
            role_label = "Academic Teacher" if is_mentor and not is_coach else ("Gaming Coach" if is_coach and not is_mentor else "Teacher & Coach")

            display_rate = None
            if is_mentor and u.teaching_rate is not None:
                display_rate = float(u.teaching_rate)
            elif is_coach and u.coaching_rate is not None:
                display_rate = float(u.coaching_rate)
            elif u.hourly_rate is not None:
                display_rate = float(u.hourly_rate)

            tutors.append({
                "id": u.id,
                "name": u.display_name,
                "category": category,
                "role_label": role_label,
                "bio": u.bio or "Verified Learn2Play educator in Naga City.",
                "topics": u.topics if hasattr(u, "topics") else [],
                "profile_picture": u.profile_picture,
                "teaching_rate": float(u.teaching_rate) if u.teaching_rate is not None else None,
                "coaching_rate": float(u.coaching_rate) if u.coaching_rate is not None else None,
                "price": display_rate if display_rate is not None else 300,
                "currency": CURRENCY_CODE,
                "currency_symbol": CURRENCY_SYMBOL,
                "rating": 5.0,
                "reviews": 0,
            })

    return jsonify({"ok": True, "tutors": tutors})


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


# ---------- Provider Schedule API (Requirement 4) ----------
@main.route("/api/schedule", methods=["GET"])
@provider_required
def get_provider_schedule_api():
    now = utcnow()
    appointments = (
        Appointment.query.filter_by(provider_id=current_user.id)
        .order_by(Appointment.start_time.asc())
        .all()
    )

    items = []
    for appt in appointments:
        student = appt.student
        items.append({
            "id": appt.id,
            "student_id": appt.student_id,
            "student_name": student.display_name if student else "Student",
            "student_avatar": student.profile_picture if student else None,
            "topic": appt.topic,
            "role": appt.role,
            "role_label": "Academic" if appt.role == "mentor" else "Gaming",
            "status": appt.status,
            "start_time_iso": appt.start_time.isoformat(),
            "start_time_formatted": format_dt_pht(appt.start_time),
            "time_range": format_time_range_pht(appt.start_time, appt.duration_minutes),
            "duration_minutes": appt.duration_minutes,
            "price": float(appt.price) if appt.price is not None else None,
            "currency": appt.currency or CURRENCY_CODE,
            "location_type": appt.location_type or "Online",
            "meeting_link": appt.meeting_link or "",
            "notes": appt.notes or "",
            "is_upcoming": appt.status in ("accepted", "scheduled") and appt.start_time >= now,
        })

    return jsonify({"ok": True, "appointments": items, "timezone": "Philippine Time (PHT, UTC+8)"})


@main.route("/api/tutors/<int:user_id>/availability", methods=["GET"])
@login_required
def tutor_availability(user_id):
    mentor = db.session.get(User, user_id)
    if not mentor or not mentor.is_active or not any(r in mentor.roles for r in ("mentor", "coach")):
        return error("Mentor not found.", 404)
    day_text = request.args.get("date", "")
    try:
        selected = date.fromisoformat(day_text)
    except ValueError:
        return error("Choose a valid date.")
    today = utcnow() + timedelta(hours=8)
    if selected < today.date() or selected > today.date() + timedelta(days=60):
        return jsonify({"ok": True, "slots": []})
    if MentorUnavailableDate.query.filter_by(mentor_id=user_id, unavailable_date=selected).first():
        return jsonify({"ok": True, "slots": []})
    windows = MentorAvailability.query.filter_by(mentor_id=user_id, weekday=selected.weekday()).all()
    slots = []
    booked = Appointment.query.filter(Appointment.status.in_(["pending", "accepted", "scheduled"]),
        ((Appointment.provider_id == user_id) | (Appointment.student_id == current_user.id))).all()
    for window in windows:
        start = datetime.combine(selected, time.fromisoformat(window.start_time))
        end = datetime.combine(selected, time.fromisoformat(window.end_time))
        while start + timedelta(hours=1) <= end:
            utc_start = start - timedelta(hours=8)
            conflict = any(a.start_time < utc_start + timedelta(hours=1) and
                a.start_time + timedelta(minutes=a.duration_minutes or 60) > utc_start for a in booked)
            if not conflict and start > today:
                slots.append(start.strftime("%H:%M"))
            start += timedelta(hours=1)
    return jsonify({"ok": True, "slots": slots, "timezone": "Asia/Manila"})


@main.route("/api/availability", methods=["GET", "POST", "DELETE"])
@provider_required
def manage_availability():
    if request.method == "GET":
        rows = MentorAvailability.query.filter_by(mentor_id=current_user.id).order_by(
            MentorAvailability.weekday, MentorAvailability.start_time
        ).all()
        return jsonify({"ok": True, "availability": [
            {"id": r.id, "weekday": r.weekday, "start_time": r.start_time, "end_time": r.end_time}
            for r in rows
        ]})
    data = request.get_json(silent=True) or {}
    if request.method == "DELETE":
        row = MentorAvailability.query.filter_by(id=data.get("id"), mentor_id=current_user.id).first()
        if not row:
            return error("Availability window not found.", 404)
        db.session.delete(row)
        db.session.commit()
        return jsonify({"ok": True})
    try:
        weekday = int(data.get("weekday"))
        start = time.fromisoformat(str(data.get("start_time", "")))
        end = time.fromisoformat(str(data.get("end_time", "")))
    except (ValueError, TypeError):
        return error("Choose a weekday and valid start and end times.")
    if weekday not in range(7) or start >= end or start.minute % 60 or end.minute % 60:
        return error("Availability must use whole-hour slots with the end after the start.")
    row = MentorAvailability(mentor_id=current_user.id, weekday=weekday,
                             start_time=start.strftime("%H:%M"), end_time=end.strftime("%H:%M"))
    db.session.add(row)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return error("That availability window already exists.")
    return jsonify({"ok": True, "id": row.id}), 201


@main.route("/api/unavailable-dates", methods=["GET", "POST", "DELETE"])
@provider_required
def manage_unavailable_dates():
    if request.method == "GET":
        rows = MentorUnavailableDate.query.filter_by(mentor_id=current_user.id).order_by(
            MentorUnavailableDate.unavailable_date
        ).all()
        return jsonify({"ok": True, "dates": [{"id": r.id, "date": r.unavailable_date.isoformat()} for r in rows]})
    data = request.get_json(silent=True) or {}
    if request.method == "DELETE":
        row = MentorUnavailableDate.query.filter_by(id=data.get("id"), mentor_id=current_user.id).first()
        if not row:
            return error("Unavailable date not found.", 404)
        db.session.delete(row)
        db.session.commit()
        return jsonify({"ok": True})
    try:
        selected = date.fromisoformat(data.get("date", ""))
    except (ValueError, TypeError):
        return error("Choose a valid date.")
    today = (utcnow() + timedelta(hours=8)).date() + timedelta(days=1)
    if selected < today or selected > today + timedelta(days=365):
        return error("Unavailable dates must be within the next year.")
    row = MentorUnavailableDate(mentor_id=current_user.id, unavailable_date=selected)
    db.session.add(row)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return error("That date is already marked unavailable.")
    return jsonify({"ok": True}), 201


@main.route("/api/bookings", methods=["POST"])
@login_required
def create_booking():
    if "student" not in current_user.roles or current_user.is_admin:
        return error("Only student accounts can request a session.", 403)
    data = request.get_json(silent=True) or {}
    try:
        mentor_id = int(data.get("mentor_id"))
    except (TypeError, ValueError):
        return error("Mentor not found.", 404)
    mentor = db.session.get(User, mentor_id)
    topic = (data.get("topic") or "").strip()[:120]
    message = (data.get("message") or "").strip()[:1000]
    try:
        day = date.fromisoformat(data.get("date", ""))
        slot = time.fromisoformat(data.get("time", ""))
    except (TypeError, ValueError):
        return error("Choose an available date and time.")
    if not mentor or not mentor.is_active or not any(r in mentor.roles for r in ("mentor", "coach")):
        return error("Mentor not found.", 404)
    if not topic:
        return error("Enter a subject or session topic.", field="topic")
    if slot.minute or slot.second or slot.microsecond:
        return error("Choose a whole-hour available slot.")
    if MentorUnavailableDate.query.filter_by(mentor_id=mentor.id, unavailable_date=day).first():
        return error("The mentor is unavailable on that date.")
    window = MentorAvailability.query.filter_by(mentor_id=mentor.id, weekday=day.weekday()).filter(
        MentorAvailability.start_time <= slot.strftime("%H:%M"),
        MentorAvailability.end_time >= (datetime.combine(day, slot) + timedelta(hours=1)).strftime("%H:%M"),
    ).first()
    start_utc = datetime.combine(day, slot) - timedelta(hours=8)
    now_utc = utcnow()
    if not window or start_utc <= now_utc or start_utc > now_utc + timedelta(days=60):
        return error("That time is outside the mentor's available schedule.")
    booked = Appointment.query.filter(Appointment.status.in_(["pending", "accepted", "scheduled"]),
        ((Appointment.provider_id == mentor.id) | (Appointment.student_id == current_user.id))).all()
    clash = any(a.start_time < start_utc + timedelta(hours=1) and
        a.start_time + timedelta(minutes=a.duration_minutes or 60) > start_utc for a in booked)
    if clash:
        return error("That time was just booked. Please choose another slot.", 409)
    role = "mentor" if "mentor" in mentor.roles else "coach"
    rate = mentor.teaching_rate if role == "mentor" else mentor.coaching_rate
    if rate is None:
        rate = mentor.hourly_rate
    appt = Appointment(provider_id=mentor.id, student_id=current_user.id, role=role,
        topic=topic, start_time=start_utc, duration_minutes=60, status="pending",
        price=rate, currency="PHP", location_type="Online", notes=message)
    db.session.add(appt)
    db.session.commit()
    return jsonify({"ok": True, "booking_id": appt.id, "message": "Booking request sent to the mentor."}), 201


@main.route("/api/bookings", methods=["GET"])
@login_required
def list_my_bookings():
    rows = Appointment.query.filter(
        (Appointment.student_id == current_user.id) | (Appointment.provider_id == current_user.id)
    ).order_by(Appointment.start_time.asc()).all()
    return jsonify({"ok": True, "bookings": [{
        "id": a.id, "student_id": a.student_id, "provider_id": a.provider_id,
        "student": a.student.display_name if a.student else "Student",
        "mentor": a.provider.display_name if a.provider else "Mentor",
        "topic": a.topic, "status": a.status, "start_time": a.start_time.isoformat(),
        "formatted": format_dt_pht(a.start_time), "duration": a.duration_minutes,
        "price": float(a.price) if a.price is not None else None, "notes": a.notes or "",
        "meeting_room": bool(a.meeting_room)
    } for a in rows]})


@main.route("/api/bookings/<int:booking_id>/<action>", methods=["POST"])
@login_required
def update_booking(booking_id, action):
    appt = db.session.get(Appointment, booking_id)
    if not appt:
        return error("Booking not found.", 404)
    if action in ("accept", "reject"):
        if appt.provider_id != current_user.id or appt.status != "pending":
            return error("You cannot update this booking.", 403)
        if action == "reject":
            appt.status = "rejected"
        else:
            appt.status = "accepted"
            appt.meeting_room = appt.meeting_room or "l2-" + secrets.token_urlsafe(18)
    elif action == "cancel":
        if current_user.id not in (appt.student_id, appt.provider_id) or appt.status not in ("pending", "accepted", "scheduled"):
            return error("You cannot cancel this booking.", 403)
        appt.status = "cancelled"
    elif action == "complete":
        if appt.provider_id != current_user.id or appt.status not in ("accepted", "scheduled"):
            return error("You cannot complete this session.", 403)
        if appt.start_time + timedelta(minutes=appt.duration_minutes or 60) > utcnow():
            return error("A session can be completed after its scheduled end time.")
        appt.status = "completed"
    else:
        return error("Unsupported booking action.")
    db.session.commit()
    return jsonify({"ok": True, "status": appt.status})


@main.route("/api/sessions/<int:booking_id>/join", methods=["GET"])
@login_required
def join_session(booking_id):
    appt = db.session.get(Appointment, booking_id)
    if not appt or (appt.student_id != current_user.id and appt.provider_id != current_user.id):
        return error("Session not found.", 404)
    if appt.status not in ("accepted", "scheduled") or not appt.meeting_room:
        return error("The mentor has not confirmed this session.", 403)
    return jsonify({"ok": True, "url": "https://meet.jit.si/" + appt.meeting_room})


# ---------- Frontend View Routes ----------
@main.route("/dashboard", methods=["GET"])
@login_required
def dashboard():

    if current_user.is_admin:
        return redirect(url_for("main.admin_dashboard"))
    
    next_session = None
    prev_session = None

    if any(r in current_user.roles for r in ("mentor", "coach")):
        now = utcnow()
        # Actual upcoming session
        next_session = (
            Appointment.query.filter(Appointment.provider_id == current_user.id, Appointment.status.in_(["accepted", "scheduled"]))
            .filter(Appointment.start_time >= now)
            .order_by(Appointment.start_time.asc())
            .first()
        )
        # Actual previous session
        prev_session = (
            Appointment.query.filter_by(provider_id=current_user.id)
            .filter((Appointment.status == "completed") | (Appointment.status.in_(["accepted", "scheduled"]) & (Appointment.start_time < now)))
            .order_by(Appointment.start_time.desc())
            .first()
        )

    # Pending provider roles: applied but not yet approved
    pending_provider_roles = []
    if current_user.is_authenticated:
        apps = RoleApplication.query.filter_by(user_id=current_user.id, status="pending").all()
        pending_provider_roles = [a.role for a in apps]

    return render_template(
        "dashboard.html",
        next_session=next_session,
        prev_session=prev_session,
        format_dt_pht=format_dt_pht,
        pending_provider_roles=pending_provider_roles,
    )


@main.route("/schedule")
@provider_required
def schedule():
    now = utcnow()

    # Nearest upcoming scheduled sessions
    upcoming = (
        Appointment.query.filter(Appointment.provider_id == current_user.id, Appointment.status.in_(["accepted", "scheduled"]))
        .filter(Appointment.start_time >= now)
        .order_by(Appointment.start_time.asc())
        .all()
    )

    # Past completed sessions or past scheduled sessions
    past = (
        Appointment.query.filter_by(provider_id=current_user.id)
        .filter(
            (Appointment.status == "completed")
            | (Appointment.status.in_(["accepted", "scheduled"]) & (Appointment.start_time < now))
        )
        .order_by(Appointment.start_time.desc())
        .all()
    )

    # Cancelled sessions
    cancelled = (
        Appointment.query.filter(Appointment.provider_id == current_user.id, Appointment.status.in_(["cancelled", "rejected"]))
        .order_by(Appointment.start_time.desc())
        .all()
    )

    return render_template(
        "schedule.html",
        upcoming=upcoming,
        past=past,
        cancelled=cancelled,
        total_count=len(upcoming) + len(past) + len(cancelled),
        format_dt_pht=format_dt_pht,
        format_time_range_pht=format_time_range_pht,
        timezone_label="Philippine Time (PHT, UTC+8)",
    )

@main.route("/tutors/<int:user_id>")
@login_required
def view_tutor_profile(user_id):
    tutor = db.session.get(User, user_id)
    # Ensure user exists, is active, and is actually a teacher or coach
    if not tutor or not tutor.is_active or not any(r in tutor.roles for r in ("mentor", "coach")):
        abort(404)

    is_mentor = "mentor" in tutor.roles
    is_coach = "coach" in tutor.roles
    role_label = (
        "Academic Teacher & Gaming Coach" if is_mentor and is_coach
        else ("Academic Teacher" if is_mentor else "Gaming Coach")
    )

    return render_template(
        "tutor_profile.html",
        tutor=tutor,
        role_label=role_label,
        is_mentor=is_mentor,
        is_coach=is_coach,
        availability=MentorAvailability.query.filter_by(mentor_id=tutor.id).order_by(
            MentorAvailability.weekday, MentorAvailability.start_time
        ).all(),
    )

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


# messages route moved to messages_page() below

# ============================================================
# ROUTES ADDITION — Admin pages, Reports API, Messages API,
# Verification-status API, and pending-provider guard.
# Paste/append this block at the END of routes.py, before
# or after the existing @main.route("/messages") handler
# (replace the stub messages route entirely).
# ============================================================

# Update the import at the top of routes.py to include Report and Message:
# from .models import Appointment, Credential, Message, Report, RoleApplication, User, utcnow

# ---------- Pending-provider helper ----------

def get_pending_roles(user):
    """Return the list of roles the user has applied for but not yet been approved."""
    apps = RoleApplication.query.filter_by(user_id=user.id, status="pending").all()
    return [a.role for a in apps]


# ---------- Admin Stats API ----------

@main.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_stats():
    pending_count = RoleApplication.query.filter_by(status="pending").count()
    total_users = User.query.count()
    all_users = User.query.all()
    total_mentors = sum(1 for u in all_users if "mentor" in u.roles)
    total_coaches = sum(1 for u in all_users if "coach" in u.roles)
    total_students = sum(1 for u in all_users if "student" in u.roles)
    total_sessions = Appointment.query.count()
    pending_bookings = Appointment.query.filter_by(status="pending").count()
    now = utcnow()
    upcoming = Appointment.query.filter(Appointment.status.in_(["accepted", "scheduled"]), Appointment.start_time >= now).count()
    recent = Appointment.query.order_by(Appointment.created_at.desc()).limit(8).all()
    open_reports = Report.query.filter_by(status="open").count()
    return jsonify({
        "ok": True,
        "pending_verifications": pending_count,
        "total_users": total_users,
        "total_mentors": total_mentors,
        "total_coaches": total_coaches,
        "total_students": total_students,
        "total_sessions": total_sessions,
        "total_bookings": total_sessions,
        "pending_bookings": pending_bookings,
        "upcoming_sessions": upcoming,
        "recent_activity": [{"student": a.student.display_name if a.student else "Student",
            "mentor": a.provider.display_name if a.provider else "Mentor", "topic": a.topic,
            "status": a.status, "created_at": format_dt_pht(a.created_at)} for a in recent],
        "open_reports": open_reports,
    })


# ---------- Admin User Management API ----------

@main.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_list_users():
    users = User.query.order_by(User.id.asc()).all()
    items = []
    for u in users:
        pending = RoleApplication.query.filter_by(user_id=u.id, status="pending").all()
        items.append({
            "id": u.id,
            "name": u.display_name,
            "email": u.email,
            "roles": u.roles,
            "is_admin": u.is_admin,
            "is_active": u.is_active,
            "pending_roles": [a.role for a in pending],
        })
    return jsonify({"ok": True, "users": items})


@main.route("/api/admin/users/<int:user_id>/toggle-active", methods=["POST"])
@admin_required
def admin_toggle_user_active(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return error("User not found.", 404)
    if user.id == current_user.id:
        return error("You cannot deactivate your own account.", 400)
    user.is_active = not user.is_active
    db.session.commit()
    state = "activated" if user.is_active else "deactivated"
    return jsonify({"ok": True, "message": f"User {state}.", "is_active": user.is_active})


@main.route("/api/admin/users/<int:user_id>/set-admin", methods=["POST"])
@admin_required
def admin_set_admin(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return error("User not found.", 404)
    if user.id == current_user.id:
        return error("You cannot change your own admin status.", 400)
    data = request.get_json(silent=True) or {}
    user.is_admin = bool(data.get("is_admin", False))
    db.session.commit()
    return jsonify({"ok": True, "message": "Admin status updated.", "is_admin": user.is_admin})


# ---------- Reports API ----------

REPORT_REASONS = [
    "Harassment",
    "Inappropriate content",
    "Cheating / unfair play",
    "No-show / missed session",
    "Unprofessional conduct",
    "Fake credentials",
    "Spam",
    "Other",
]


@main.route("/api/reports", methods=["POST"])
@login_required
def submit_report():
    data = request.get_json(silent=True) or {}
    reported_id = data.get("reported_id")
    reason = (data.get("reason") or "").strip()
    details = (data.get("details") or "").strip()
    appointment_id = data.get("appointment_id")  # optional

    if not reported_id:
        return error("Please specify who you are reporting.", field="reported_id")
    if reported_id == current_user.id:
        return error("You cannot report yourself.")
    reported_user = db.session.get(User, reported_id)
    if not reported_user or not reported_user.is_active:
        return error("That user does not exist.", 404)
    if reason not in REPORT_REASONS:
        return error("Please select a valid reason.", field="reason")
    if details and len(details) > 2000:
        return error("Details must not exceed 2000 characters.", field="details")

    appt = None
    if appointment_id:
        appt = db.session.get(Appointment, appointment_id)
        if not appt or (appt.student_id != current_user.id and appt.provider_id != current_user.id):
            return error("Invalid session reference.", field="appointment_id")

    try:
        report = Report(
            reporter_id=current_user.id,
            reported_id=reported_id,
            appointment_id=appt.id if appt else None,
            reason=reason,
            details=details or None,
        )
        db.session.add(report)
        db.session.commit()
        return jsonify({"ok": True, "message": "Your report has been submitted. We'll review it shortly."}), 201
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Failed to save report")
        return error("Failed to submit report. Please try again.", 500)


@main.route("/api/admin/reports", methods=["GET"])
@admin_required
def admin_list_reports():
    status_filter = request.args.get("status", "open")
    query = Report.query
    if status_filter != "all":
        query = query.filter_by(status=status_filter)
    reports = query.order_by(Report.created_at.desc()).all()

    items = []
    for r in reports:
        reporter = db.session.get(User, r.reporter_id)
        reported = db.session.get(User, r.reported_id)
        items.append({
            "id": r.id,
            "reason": r.reason,
            "details": r.details or "",
            "status": r.status,
            "admin_note": r.admin_note or "",
            "created_at": r.created_at.isoformat(),
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            "reporter": {"id": reporter.id, "name": reporter.display_name, "email": reporter.email} if reporter else None,
            "reported": {"id": reported.id, "name": reported.display_name, "email": reported.email} if reported else None,
            "appointment_id": r.appointment_id,
        })
    return jsonify({"ok": True, "reports": items})


@main.route("/api/admin/reports/<int:report_id>/<action>", methods=["POST"])
@admin_required
def admin_review_report(report_id, action):
    if action not in {"reviewed", "dismissed"}:
        return error("Unknown action.", 404)
    report = db.session.get(Report, report_id)
    if not report:
        return error("Report not found.", 404)
    data = request.get_json(silent=True) or {}
    report.status = action
    report.admin_note = str(data.get("note") or "").strip()[:1000] or None
    report.reviewed_by = current_user.id
    report.reviewed_at = utcnow()
    db.session.commit()
    return jsonify({"ok": True, "message": f"Report marked as {action}."})


@main.route("/api/report-reasons", methods=["GET"])
@login_required
def report_reasons():
    return jsonify({"ok": True, "reasons": REPORT_REASONS})


# ---------- Verification Status API ----------

@main.route("/api/me/verification-status", methods=["GET"])
@login_required
def verification_status():
    pending = RoleApplication.query.filter_by(user_id=current_user.id, status="pending").all()
    approved = RoleApplication.query.filter_by(user_id=current_user.id, status="approved").all()
    rejected = RoleApplication.query.filter_by(user_id=current_user.id, status="rejected").all()
    return jsonify({
        "ok": True,
        "pending_roles": [a.role for a in pending],
        "approved_roles": [a.role for a in approved],
        "rejected_roles": [a.role for a in rejected],
    })


# ---------- Messages / Chat API ----------

@main.route("/api/messages/threads", methods=["GET"])
@login_required
def message_threads():
    """Return all conversation threads for the current user, split by type."""
    uid = current_user.id

    # Peer-to-peer threads (appointment_id IS NULL)
    p2p_raw = Message.query.filter(
        Message.appointment_id == None,  # noqa: E711
        (Message.sender_id == uid) | (Message.recipient_id == uid),
    ).order_by(Message.created_at.desc()).all()

    # Group by the other user
    p2p_map = {}
    for msg in p2p_raw:
        other_id = msg.recipient_id if msg.sender_id == uid else msg.sender_id
        if other_id not in p2p_map:
            other = db.session.get(User, other_id)
            unread = Message.query.filter_by(
                sender_id=other_id, recipient_id=uid, appointment_id=None, is_read=False
            ).count()
            p2p_map[other_id] = {
                "type": "peer",
                "other_user": {"id": other.id, "name": other.display_name, "avatar": other.profile_picture} if other else None,
                "last_message": msg.body[:100],
                "last_at": msg.created_at.isoformat(),
                "unread": unread,
            }

    # Session threads (appointment_id IS NOT NULL)
    session_raw = Message.query.filter(
        Message.appointment_id != None,  # noqa: E711
        (Message.sender_id == uid) | (Message.recipient_id == uid),
    ).order_by(Message.created_at.desc()).all()

    session_map = {}
    for msg in session_raw:
        aid = msg.appointment_id
        if aid not in session_map:
            appt = db.session.get(Appointment, aid)
            other_id = appt.student_id if appt and appt.provider_id == uid else (appt.provider_id if appt else None)
            other = db.session.get(User, other_id) if other_id else None
            unread = Message.query.filter_by(appointment_id=aid, recipient_id=uid, is_read=False).count()
            session_map[aid] = {
                "type": "session",
                "appointment_id": aid,
                "topic": appt.topic if appt else "Session",
                "other_user": {"id": other.id, "name": other.display_name, "avatar": other.profile_picture} if other else None,
                "last_message": msg.body[:100],
                "last_at": msg.created_at.isoformat(),
                "unread": unread,
            }

    return jsonify({
        "ok": True,
        "peer_threads": list(p2p_map.values()),
        "session_threads": list(session_map.values()),
    })


@main.route("/api/messages/thread/<int:other_user_id>", methods=["GET"])
@login_required
def peer_thread(other_user_id):
    """Fetch all peer-to-peer messages between current_user and other_user_id."""
    other = db.session.get(User, other_user_id)
    if not other or not other.is_active:
        return error("User not found.", 404)

    uid = current_user.id
    msgs = Message.query.filter(
        Message.appointment_id == None,  # noqa: E711
        ((Message.sender_id == uid) & (Message.recipient_id == other_user_id)) |
        ((Message.sender_id == other_user_id) & (Message.recipient_id == uid)),
    ).order_by(Message.created_at.asc()).all()

    # Mark incoming as read
    for m in msgs:
        if m.recipient_id == uid and not m.is_read:
            m.is_read = True
    db.session.commit()

    return jsonify({
        "ok": True,
        "messages": [
            {
                "id": m.id,
                "sender_id": m.sender_id,
                "body": m.body,
                "created_at": m.created_at.isoformat(),
                "is_read": m.is_read,
            }
            for m in msgs
        ],
        "other_user": {"id": other.id, "name": other.display_name, "avatar": other.profile_picture},
    })


@main.route("/api/messages/session/<int:appointment_id>", methods=["GET"])
@login_required
def session_thread(appointment_id):
    """Fetch messages for a specific booked session thread."""
    appt = db.session.get(Appointment, appointment_id)
    if not appt:
        return error("Session not found.", 404)
    uid = current_user.id
    if appt.student_id != uid and appt.provider_id != uid:
        return error("Access denied.", 403)

    msgs = Message.query.filter_by(appointment_id=appointment_id).order_by(Message.created_at.asc()).all()

    for m in msgs:
        if m.recipient_id == uid and not m.is_read:
            m.is_read = True
    db.session.commit()

    return jsonify({
        "ok": True,
        "appointment": {"id": appt.id, "topic": appt.topic, "status": appt.status},
        "messages": [
            {
                "id": m.id,
                "sender_id": m.sender_id,
                "body": m.body,
                "created_at": m.created_at.isoformat(),
                "is_read": m.is_read,
            }
            for m in msgs
        ],
    })


@main.route("/api/messages/send", methods=["POST"])
@login_required
def send_message_api():
    data = request.get_json(silent=True) or {}
    recipient_id = data.get("recipient_id")
    body = (data.get("body") or "").strip()
    appointment_id = data.get("appointment_id")  # optional

    if not recipient_id:
        return error("No recipient specified.", field="recipient_id")
    if not body:
        return error("Message cannot be empty.", field="body")
    if len(body) > 3000:
        return error("Message is too long (max 3000 characters).", field="body")
    if recipient_id == current_user.id:
        return error("You cannot message yourself.")

    recipient = db.session.get(User, recipient_id)
    if not recipient or not recipient.is_active:
        return error("Recipient not found.", 404)

    # Peer-to-peer: only students can initiate P2P (appointment_id=None)
    if not appointment_id:
        if "student" not in current_user.roles and not current_user.is_admin:
            return error("Only students can send peer-to-peer messages.", 403)
        if "student" not in recipient.roles and not recipient.is_admin:
            return error("You can only send peer messages to fellow students.", 403)

    appt = None
    if appointment_id:
        appt = db.session.get(Appointment, appointment_id)
        if not appt:
            return error("Session not found.", 404)
        uid = current_user.id
        if appt.student_id != uid and appt.provider_id != uid:
            return error("You are not part of this session.", 403)
        expected_recipient = appt.provider_id if uid == appt.student_id else appt.student_id
        if recipient_id != expected_recipient:
            return error("Session messages can only be sent to the other participant.", 403)

    try:
        msg = Message(
            sender_id=current_user.id,
            recipient_id=recipient_id,
            appointment_id=appt.id if appt else None,
            body=body,
        )
        db.session.add(msg)
        db.session.commit()
        return jsonify({
            "ok": True,
            "message": {
                "id": msg.id,
                "sender_id": msg.sender_id,
                "body": msg.body,
                "created_at": msg.created_at.isoformat(),
                "is_read": msg.is_read,
            },
        }), 201
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Failed to send message")
        return error("Failed to send message. Please try again.", 500)


# ---------- Admin Page Routes ----------

@main.route("/admin")
@main.route("/admin/dashboard")
@admin_required
def admin_dashboard():
    return render_template("admin/dashboard.html")


@main.route("/admin/verification")
@admin_required
def admin_verification():
    return render_template("admin/verification.html")


@main.route("/admin/reports")
@admin_required
def admin_reports_page():
    return render_template("admin/reports.html")


@main.route("/admin/users")
@admin_required
def admin_users():
    return render_template("admin/users.html")


@main.route("/admin/settings")
@admin_required
def admin_settings():
    return render_template("admin/settings.html")


# ---------- Replace stub messages route ----------
# (Delete or comment out the old /messages route and use this one)

@main.route("/messages")
@login_required
def messages_page():
    return render_template("messages.html")

# Peer user search — returns students the current user can start a P2P chat with
@main.route("/api/messages/peer-users", methods=["GET"])
@login_required
def peer_user_search():
    q = (request.args.get("q") or "").strip().lower()
    if not q or len(q) < 2:
        return jsonify({"ok": True, "users": []})
    all_users = User.query.filter_by(is_active=True).all()
    results = []
    for u in all_users:
        if u.id == current_user.id:
            continue
        if "student" not in u.roles:
            continue
        if q in u.display_name.lower() or q in u.email.lower():
            results.append({
                "id": u.id,
                "name": u.display_name,
                "avatar": u.profile_picture,
            })
        if len(results) >= 10:
            break
    return jsonify({"ok": True, "users": results})
