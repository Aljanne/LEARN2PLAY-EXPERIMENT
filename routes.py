import os
import re
import uuid
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path

from flask import (
    Blueprint,
    abort,
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

if __package__:
    from .extensions import db
    from .models import Appointment, Credential, RoleApplication, User, utcnow
else:
    from extensions import db
    from models import Appointment, Credential, RoleApplication, User, utcnow

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
        return view(*args, **kwargs)
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


def credentials_folder(user_id):
    return Path(current_app.instance_path) / "credentials" / str(user_id)


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

    saved_paths = []
    try:
        active_roles = sorted(roles - VERIFIED_ROLES)
        user = User(display_name=name, email=email)
        user.set_password(password)
        user.roles = active_roles

        db.session.add(user)
        db.session.flush()

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
        return error("That email is already registered. Try logging in instead.", 409, field="email")

    except Exception:
        db.session.rollback()
        for path in saved_paths:
            path.unlink(missing_ok=True)
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
    return jsonify({
        "ok": True,
        "message": "Logged in successfully.",
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
    return send_from_directory(
        credentials_folder(cred.user_id),
        cred.stored_name,
        download_name=cred.original_name,
    )


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
            "is_upcoming": appt.status == "scheduled" and appt.start_time >= now,
        })

    return jsonify({"ok": True, "appointments": items, "timezone": "Philippine Time (PHT, UTC+8)"})


# ---------- Frontend View Routes ----------
@main.route("/dashboard", methods=["GET"])
@login_required
def dashboard():
    next_session = None
    prev_session = None

    if any(r in current_user.roles for r in ("mentor", "coach")):
        now = utcnow()
        # Actual upcoming session
        next_session = (
            Appointment.query.filter_by(provider_id=current_user.id, status="scheduled")
            .filter(Appointment.start_time >= now)
            .order_by(Appointment.start_time.asc())
            .first()
        )
        # Actual previous session
        prev_session = (
            Appointment.query.filter_by(provider_id=current_user.id)
            .filter((Appointment.status == "completed") | ((Appointment.status == "scheduled") & (Appointment.start_time < now)))
            .order_by(Appointment.start_time.desc())
            .first()
        )

    return render_template(
        "dashboard.html",
        next_session=next_session,
        prev_session=prev_session,
        format_dt_pht=format_dt_pht,
    )


@main.route("/schedule")
@provider_required
def schedule():
    now = utcnow()

    # Nearest upcoming scheduled sessions
    upcoming = (
        Appointment.query.filter_by(provider_id=current_user.id, status="scheduled")
        .filter(Appointment.start_time >= now)
        .order_by(Appointment.start_time.asc())
        .all()
    )

    # Past completed sessions or past scheduled sessions
    past = (
        Appointment.query.filter_by(provider_id=current_user.id)
        .filter(
            (Appointment.status == "completed")
            | ((Appointment.status == "scheduled") & (Appointment.start_time < now))
        )
        .order_by(Appointment.start_time.desc())
        .all()
    )

    # Cancelled sessions
    cancelled = (
        Appointment.query.filter_by(provider_id=current_user.id, status="cancelled")
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


@main.route("/messages")
@login_required
def messages():
    return render_template("messages.html")
