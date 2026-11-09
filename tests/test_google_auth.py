import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from __init__ import create_app
from extensions import db
from models import User


class GoogleAuthTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config.update(
            TESTING=True,
            WTF_CSRF_ENABLED=False,
            SQLALCHEMY_DATABASE_URI="sqlite://",
            SUPABASE_URL="https://project.supabase.co",
            SUPABASE_ANON_KEY="test-anon-key",
        )
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def test_google_login_redirects_to_supabase_authorize(self):
        response = self.client.get("/auth/google")

        self.assertEqual(response.status_code, 302)
        parsed = urlparse(response.headers["Location"])
        self.assertEqual(parsed.path, "/auth/v1/authorize")
        query = parse_qs(parsed.query)
        self.assertEqual(query["provider"], ["google"])
        self.assertEqual(query["apikey"], ["test-anon-key"])
        self.assertTrue(query["redirect_to"][0].endswith("/auth"))

    @patch("routes.create_client")
    def test_google_callback_verifies_token_and_creates_student(self, create_client):
        supabase_user = SimpleNamespace(
            email="newuser@example.test",
            email_confirmed_at="2026-01-01T00:00:00Z",
            user_metadata={"full_name": "New Google User"},
        )
        create_client.return_value.auth.get_user.return_value.user = supabase_user

        response = self.client.post(
            "/api/auth/google",
            json={"access_token": "verified-access-token"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["user"]["name"], "New Google User")
        user = User.query.filter_by(email="newuser@example.test").one()
        self.assertEqual(user.roles, ["student"])
        create_client.return_value.auth.get_user.assert_called_once_with(
            "verified-access-token"
        )
        self.assertEqual(self.client.get("/api/me").status_code, 200)

    def test_google_callback_rejects_missing_token(self):
        response = self.client.post("/api/auth/google", json={})

        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.get_json()["ok"])
