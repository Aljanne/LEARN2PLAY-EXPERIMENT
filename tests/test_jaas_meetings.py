import json
import re
import unittest
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from __init__ import create_app
from extensions import db
from models import Appointment, User


class JaasMeetingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.private_pem = cls.private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("ascii")
        cls.public_key = cls.private_key.public_key()

    def setUp(self):
        self.app = create_app()
        self.app.config.update(
            TESTING=True,
            WTF_CSRF_ENABLED=False,
            SQLALCHEMY_DATABASE_URI="sqlite://",
            JAAS_APP_ID="vpaas-magic-cookie-testapp",
            JAAS_API_KEY_ID="test-key-id",
            JAAS_PRIVATE_KEY=self.private_pem,
        )
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()

        self.provider = User(
            display_name="Assigned Provider", email="provider@example.test", password_hash="test",
            roles_json='["mentor"]',
        )
        self.student = User(
            display_name="Assigned Student", email="student@example.test", password_hash="test",
            roles_json='["student"]',
        )
        self.unrelated = User(
            display_name="Other Student", email="other@example.test", password_hash="test",
            roles_json='["student"]',
        )
        db.session.add_all([self.provider, self.student, self.unrelated])
        db.session.flush()
        self.appointment = Appointment(
            provider_id=self.provider.id,
            student_id=self.student.id,
            role="mentor",
            topic="Test session",
            start_time=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1),
            duration_minutes=60,
            status="accepted",
            meeting_room="l2-test-room",
        )
        db.session.add(self.appointment)
        db.session.commit()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def _login_as(self, user):
        with self.client.session_transaction() as session:
            session["_user_id"] = str(user.id)
            session["_fresh"] = True

    def _meeting_token(self, user):
        self._login_as(user)
        response = self.client.get(f"/sessions/{self.appointment.id}/meeting")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        match = re.search(r"const participantToken = (\".*?\");", html)
        self.assertIsNotNone(match)
        return json.loads(match.group(1))

    def _decode(self, token):
        claims = jwt.decode(
            token,
            self.public_key,
            algorithms=["RS256"],
            audience="jitsi",
            issuer="chat",
        )
        return claims, jwt.get_unverified_header(token)

    def test_assigned_provider_receives_moderator_token_for_exact_room(self):
        token = self._meeting_token(self.provider)
        claims, header = self._decode(token)
        self.assertEqual(header["alg"], "RS256")
        self.assertEqual(header["typ"], "JWT")
        self.assertEqual(header["kid"], "vpaas-magic-cookie-testapp/test-key-id")
        self.assertEqual(claims["sub"], "vpaas-magic-cookie-testapp")
        self.assertEqual(claims["room"], "l2-test-room")
        self.assertFalse(claims["context"]["room"]["regex"])
        self.assertEqual(claims["context"]["user"]["id"], str(self.provider.id))
        self.assertEqual(claims["context"]["user"]["name"], self.provider.display_name)
        self.assertEqual(claims["context"]["user"]["moderator"], "true")

    def test_assigned_student_receives_non_moderator_token(self):
        token = self._meeting_token(self.student)
        claims, _ = self._decode(token)
        self.assertEqual(claims["context"]["user"]["moderator"], "false")
        self.assertEqual(claims["room"], self.appointment.meeting_room)

    def test_unrelated_user_is_rejected(self):
        self._login_as(self.unrelated)
        self.assertEqual(self.client.get(f"/api/sessions/{self.appointment.id}/join").status_code, 404)
        self.assertEqual(self.client.get(f"/sessions/{self.appointment.id}/meeting").status_code, 404)

    def test_pending_booking_is_rejected(self):
        self.appointment.status = "pending"
        db.session.commit()
        self._login_as(self.student)
        self.assertEqual(self.client.get(f"/api/sessions/{self.appointment.id}/join").status_code, 403)
        self.assertEqual(self.client.get(f"/sessions/{self.appointment.id}/meeting").status_code, 403)

    def test_join_endpoint_returns_learn2play_meeting_page(self):
        self._login_as(self.student)
        response = self.client.get(f"/api/sessions/{self.appointment.id}/join")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json()["url"],
            f"/sessions/{self.appointment.id}/meeting",
        )

    def test_missing_jaas_configuration_fails_safely(self):
        self.app.config["JAAS_PRIVATE_KEY"] = ""
        self._login_as(self.student)
        response = self.client.get(f"/sessions/{self.appointment.id}/meeting")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json()["message"],
            "Video meetings are temporarily unavailable. Please contact support.",
        )
        self.assertNotIn(self.private_pem, response.get_data(as_text=True))

    def test_complete_key_id_is_not_prefixed_twice(self):
        self.app.config["JAAS_API_KEY_ID"] = "vpaas-magic-cookie-testapp/existing-key-id"
        claims, header = self._decode(self._meeting_token(self.provider))
        self.assertEqual(header["kid"], "vpaas-magic-cookie-testapp/existing-key-id")
        self.assertEqual(claims["context"]["user"]["moderator"], "true")


if __name__ == "__main__":
    unittest.main()
