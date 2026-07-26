"""
Tests for Discord OAuth2 login/link feature and regression on core auth + webhook.
"""
import os
import uuid
import pytest
import requests
from urllib.parse import urlparse, parse_qs

# Backend base URL – read from EXPO_PUBLIC_BACKEND_URL (frontend/.env) or EXPO_BACKEND_URL
BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://strategy-tracker-16.preview.emergentagent.com"
).rstrip("/")

PREMIUM_EMAIL = "stocktradesrvl@gmail.com"
PREMIUM_PASSWORD = "TradeAdmin123"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def premium_token(session):
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"email": PREMIUM_EMAIL, "password": PREMIUM_PASSWORD})
    assert r.status_code == 200, f"Premium login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def new_user(session):
    """Create a fresh free-tier user for auth-gated tests."""
    email = f"TEST_disc_{uuid.uuid4().hex[:8]}@example.com"
    r = session.post(f"{BASE_URL}/api/auth/register",
                     json={"email": email, "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    body = r.json()
    return {"email": email, "token": body["access_token"], "user": body["user"]}


# ---------- /api/config ----------
class TestConfig:
    def test_config_flags(self, session):
        r = session.get(f"{BASE_URL}/api/config")
        assert r.status_code == 200
        data = r.json()
        assert "discord_enabled" in data
        assert data["discord_enabled"] is True, f"discord_enabled should be True: {data}"
        assert "promo_active" in data
        assert isinstance(data["promo_active"], bool)


# ---------- Discord login-url (PUBLIC) ----------
class TestDiscordLoginUrl:
    def test_login_url_returns_valid_authorize_url(self, session):
        origin = BASE_URL
        return_url = "bca://discord-login"
        r = session.get(
            f"{BASE_URL}/api/auth/discord/login-url",
            params={"origin": origin, "return_url": return_url},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "url" in body
        url = body["url"]
        assert url.startswith("https://discord.com/api/oauth2/authorize")
        parsed = urlparse(url)
        q = parse_qs(parsed.query)
        assert "client_id" in q and q["client_id"][0], "client_id missing"
        assert q.get("scope", [""])[0] == "identify"
        assert q.get("response_type", [""])[0] == "code"
        assert q["redirect_uri"][0].endswith("/api/auth/discord/callback")
        assert q["redirect_uri"][0] == f"{origin}/api/auth/discord/callback"
        state = q.get("state", [""])[0]
        assert state and state.count(".") == 2, "state must be a signed JWT"

    def test_login_url_missing_params_returns_422(self, session):
        r = session.get(f"{BASE_URL}/api/auth/discord/login-url")
        # FastAPI returns 422 on missing required query params
        assert r.status_code in (422, 400), r.status_code


# ---------- Discord link-url (AUTHENTICATED) ----------
class TestDiscordLinkUrl:
    def test_link_url_unauth_returns_401(self, session):
        r = session.post(f"{BASE_URL}/api/auth/discord/link-url",
                         json={"origin": BASE_URL, "return_url": "bca://discord-link"})
        assert r.status_code == 401, f"expected 401 got {r.status_code} {r.text}"

    def test_link_url_authenticated(self, session, new_user):
        r = session.post(
            f"{BASE_URL}/api/auth/discord/link-url",
            json={"origin": BASE_URL, "return_url": "bca://discord-link"},
            headers={"Authorization": f"Bearer {new_user['token']}"},
        )
        assert r.status_code == 200, r.text
        url = r.json()["url"]
        parsed = urlparse(url)
        q = parse_qs(parsed.query)
        assert url.startswith("https://discord.com/api/oauth2/authorize")
        assert q.get("scope", [""])[0] == "identify"
        assert q["redirect_uri"][0].endswith("/api/auth/discord/callback")
        # signed state
        assert q.get("state", [""])[0].count(".") == 2


# ---------- Discord callback ----------
class TestDiscordCallback:
    def test_callback_invalid_state_returns_html_no_crash(self, session):
        r = session.get(f"{BASE_URL}/api/auth/discord/callback",
                        params={"state": "garbage-not-a-jwt", "code": "anything"},
                        allow_redirects=False)
        assert r.status_code == 200, f"got {r.status_code} {r.text[:200]}"
        ct = r.headers.get("content-type", "")
        assert "text/html" in ct.lower()
        # No 500 - should render error HTML page
        # It's fine if it shows generic 'Discord linked' fallback for missing rt.
        assert "<html" in r.text.lower() or "<body" in r.text.lower()

    def test_callback_no_params(self, session):
        r = session.get(f"{BASE_URL}/api/auth/discord/callback",
                        allow_redirects=False)
        # With no state -> invalid -> HTML 200
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "").lower()

    def test_callback_error_query_still_renders(self, session):
        r = session.get(f"{BASE_URL}/api/auth/discord/callback",
                        params={"error": "access_denied", "state": "bad"},
                        allow_redirects=False)
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "").lower()


# ---------- Discord unlink ----------
class TestDiscordUnlink:
    def test_unlink_unauth_returns_401(self, session):
        r = session.post(f"{BASE_URL}/api/auth/discord/unlink")
        assert r.status_code == 401, r.status_code

    def test_unlink_authenticated_returns_public_user(self, session, new_user):
        r = session.post(f"{BASE_URL}/api/auth/discord/unlink",
                         headers={"Authorization": f"Bearer {new_user['token']}"})
        assert r.status_code == 200, r.text
        body = r.json()
        # public user shape
        assert body.get("id") and body.get("email")
        assert "subscription_tier" in body
        assert "discord_id" in body and "discord_username" in body
        assert body["discord_id"] is None
        assert body["discord_username"] is None


# ---------- /api/auth/me includes discord fields ----------
class TestAuthMeDiscordFields:
    def test_me_includes_discord_keys_new_user(self, session, new_user):
        r = session.get(f"{BASE_URL}/api/auth/me",
                        headers={"Authorization": f"Bearer {new_user['token']}"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "discord_id" in data
        assert "discord_username" in data
        # values null for a brand-new user
        assert data["discord_id"] is None
        assert data["discord_username"] is None

    def test_me_premium_seeded_account(self, session, premium_token):
        r = session.get(f"{BASE_URL}/api/auth/me",
                        headers={"Authorization": f"Bearer {premium_token}"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["email"] == PREMIUM_EMAIL
        assert data["subscription_tier"] == "premium"
        assert "discord_id" in data
        # discord_id may be null since not yet linked
        assert data["discord_id"] is None or isinstance(data["discord_id"], str)


# ---------- Regression: core auth ----------
class TestCoreAuthRegression:
    def test_register_login_flow(self, session):
        email = f"TEST_reg_{uuid.uuid4().hex[:8]}@example.com"
        pw = "Passw0rd!"
        r = session.post(f"{BASE_URL}/api/auth/register",
                         json={"email": email, "password": pw})
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        # login again
        r = session.post(f"{BASE_URL}/api/auth/login",
                         json={"email": email, "password": pw})
        assert r.status_code == 200, r.text
        # /me
        r = session.get(f"{BASE_URL}/api/auth/me",
                        headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["email"] == email.lower()

    def test_login_wrong_password_401(self, session):
        r = session.post(f"{BASE_URL}/api/auth/login",
                         json={"email": PREMIUM_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_me_without_token_401(self, session):
        r = session.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401


# ---------- Regression: Stripe webhook returns 400 when not configured ----------
class TestStripeWebhookRegression:
    def test_webhook_no_secret_returns_400(self, session):
        # STRIPE_WEBHOOK_SECRET is empty per backend/.env -> should return 400
        r = session.post(f"{BASE_URL}/api/payments/webhook",
                         data=b"{}",
                         headers={"stripe-signature": "t=1,v1=deadbeef",
                                  "Content-Type": "application/json"})
        assert r.status_code == 400, f"got {r.status_code} {r.text}"
        # Body should mention webhook / signature
        assert "webhook" in r.text.lower() or "signature" in r.text.lower()
