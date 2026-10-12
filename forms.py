
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, BooleanField, SelectMultipleField, SubmitField
from wtforms.validators import (
    DataRequired,
    Email,
    Length,
    EqualTo,
    ValidationError,
)

from models import User


ALLOWED_ROLES = {"student", "mentor", "coach"}


class RegistrationForm(FlaskForm):
    name = StringField(
        "Display Name",
        validators=[
            DataRequired(),
            Length(min=2, max=80),
        ],
    )

    email = StringField(
        "Email",
        validators=[
            DataRequired(),
            Email(),
            Length(max=120),
        ],
    )

    password = PasswordField(
        "Password",
        validators=[
            DataRequired(),
            Length(min=6, max=128),
        ],
    )

    confirm_password = PasswordField(
        "Confirm Password",
        validators=[
            DataRequired(),
            EqualTo("password", message="Passwords must match."),
        ],
    )

    roles = SelectMultipleField(
        "Roles",
        choices=[
            ("student", "Student"),
            ("mentor", "Mentor"),
            ("coach", "Coach"),
        ],
        validators=[DataRequired()],
    )

    submit = SubmitField("Create Account")

    def validate_email(self, field):
        email = field.data.strip().lower()

        if User.query.filter_by(email=email).first():
            raise ValidationError("That email is already registered.")

    def validate_roles(self, field):
        if not field.data:
            raise ValidationError("Please choose at least one role.")

        if any(role not in ALLOWED_ROLES for role in field.data):
            raise ValidationError("One or more selected roles are invalid.")


class LoginForm(FlaskForm):
    email = StringField(
        "Email",
        validators=[
            DataRequired(),
            Email(),
            Length(max=120),
        ],
    )

    password = PasswordField(
        "Password",
        validators=[DataRequired()],
    )

    remember = BooleanField("Remember Me")

    submit = SubmitField("Log In")
