"""Backend security-fix verification tests for iteration 13.

Covers:
  SEC-001 tier lockdown (POST /api/auth/tier)
  SEC-004 safe redirect (GET /api/payments/redirect, discord callback helper)
  SEC-003 JWT fail-closed (login + /api/auth/me work with strong secret)
  Seed admin account (stocktradesrvl@gmail.com premium)
  Constant-time key checks (GEX_INGEST_KEY, DISCORD_BOT_KEY)
  Regression core flows
  CORS allow_credentials=False -- normal API still works
"""
import os
import re
import uuid
import pytest
import requests
from urllib.parse import quote
from dotenv import dotenv_values

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL",
                          "https://strategy-tracker-16.preview.emergentagent.com").rstrip("/")

_ENV = dotenv_values("/app/backend/.env")
GEX_INGEST_KEY = _ENV.get("GEX_INGEST_KEY", "").strip('"')
DISCORD_BOT_KEY = _ENV.get("DISCORD_BOT_KEY", "").strip('"')

ADMIN_EMAIL = "stocktradesrvl@gmail.com"
ADMIN_PASSWORD = "TradeAdmin123"


# ---------------- shared fixtures ----------------
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def throwaway_user(api):
    """Register a fresh @example.com user for the tier=free 200 test."""
    email = f"TEST_free_{uuid.uuid4().hex[:8]}@example.com"
    password = "Throwaway123"
    r = api.post(f"{BASE_URL}/api/auth/register",
                 json={"email": email, "password": password})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    return {"email": email, "password": password, "token": tok}


# ==================== SEC-003: JWT fail-closed & auth works ====================
class TestJWTFailClosed:
    def test_admin_login_returns_token(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body and len(body["access_token"]) > 20
        assert body.get("user", {}).get("email") == ADMIN_EMAIL

    def test_me_works_with_token(self, api, admin_headers):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=admin_headers)
        assert r.status_code == 200
        assert r.json().get("email") == ADMIN_EMAIL


# ==================== Seed accounts from env ====================
class TestSeedAccounts:
    def test_admin_is_premium(self, api, admin_headers):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=admin_headers)
        assert r.status_code == 200
        j = r.json()
        # effective tier OR raw tier should be premium
        assert j.get("subscription_tier") == "premium" or j.get("raw_tier") == "premium", j


# ==================== SEC-001: tier lockdown ====================
class TestTierLockdown:
    def test_premium_blocked(self, api, throwaway_user):
        h = {"Authorization": f"Bearer {throwaway_user['token']}",
             "Content-Type": "application/json"}
        r = api.post(f"{BASE_URL}/api/auth/tier", headers=h, json={"tier": "premium"})
        assert r.status_code == 403, f"premium should be 403, got {r.status_code}: {r.text}"

    def test_pro_blocked(self, api, throwaway_user):
        h = {"Authorization": f"Bearer {throwaway_user['token']}",
             "Content-Type": "application/json"}
        r = api.post(f"{BASE_URL}/api/auth/tier", headers=h, json={"tier": "pro"})
        assert r.status_code == 403, f"pro should be 403, got {r.status_code}: {r.text}"

    def test_free_allowed_on_throwaway(self, api, throwaway_user):
        h = {"Authorization": f"Bearer {throwaway_user['token']}",
             "Content-Type": "application/json"}
        r = api.post(f"{BASE_URL}/api/auth/tier", headers=h, json={"tier": "free"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("subscription_tier") == "free"

    def test_premium_blocked_for_admin_too(self, api, admin_headers):
        """Even authed admin cannot self-promote back to premium via /auth/tier."""
        r = api.post(f"{BASE_URL}/api/auth/tier", headers=admin_headers,
                     json={"tier": "premium"})
        assert r.status_code == 403


# ==================== SEC-004: safe redirect helper ====================
class TestSafeRedirect:
    """/api/payments/redirect exercises _safe_redirect_response.
    Rules:
      - unsafe rt (javascript:, http(s) to non-allowed hosts) => plain page, NO
        window.location.href=<something> script.
      - allowed rt (frontend://, https://*.emergentagent.com) => redirect page with
        JSON-encoded target inside the <script>.
      - </script><script> style payloads on an ALLOWED scheme => must appear \\u003c-escaped."""

    def _get(self, api, rt):
        return api.get(f"{BASE_URL}/api/payments/redirect",
                       params={"rt": rt, "session_id": "x", "status": "success"})

    def test_javascript_scheme_is_unsafe(self, api):
        r = self._get(api, "javascript:alert(1)//")
        assert r.status_code == 200
        html = r.text
        # unsafe -> plain page, no location.href script reflected
        assert "window.location.href=" not in html
        assert "javascript:alert(1)" not in html
        assert "close this window" in html.lower() or "return to the app" in html.lower()

    def test_https_evil_host_is_unsafe(self, api):
        r = self._get(api, "https://evil.com/attack")
        assert r.status_code == 200
        html = r.text
        assert "window.location.href=" not in html
        assert "evil.com" not in html

    def test_frontend_scheme_allowed(self, api):
        r = self._get(api, "frontend://paywall")
        assert r.status_code == 200
        html = r.text
        # Must be a redirect page (script tag present + JSON-encoded target).
        assert "window.location.href=" in html
        # The rt value must appear (allowed target) - JSON encoded, so still contains
        # "frontend://paywall" verbatim inside the JSON string literal.
        assert "frontend://paywall" in html

    def test_emergentagent_host_allowed(self, api):
        r = self._get(api, "https://something.emergentagent.com/x")
        assert r.status_code == 200
        html = r.text
        assert "window.location.href=" in html
        assert "something.emergentagent.com" in html

    def test_script_tag_injection_is_escaped(self, api):
        """rt on ALLOWED scheme with </script><script> payload must be \\u003c-escaped
        in the JS string; the literal </script><script> must NOT appear unescaped."""
        payload = "frontend://paywall?evil=</script><script>alert(1)</script>"
        r = self._get(api, payload)
        assert r.status_code == 200
        html = r.text
        # Isolate the JS string literal our template produced:
        # <script>window.location.href=<JSON>;</script>
        m = re.search(r"window\.location\.href=(.*?);</script>", html, re.DOTALL)
        assert m, "expected our own redirect <script> block in output"
        js_literal = m.group(1)
        # The user's raw </script> and <script> MUST NOT appear inside the JS literal.
        assert "</script>" not in js_literal, (
            f"Unescaped </script> in JS string literal: {js_literal!r}")
        assert "<script>" not in js_literal, (
            f"Unescaped <script> in JS string literal: {js_literal!r}")
        # Escaped form must be present.
        assert "\\u003c/script\\u003e" in js_literal
        assert "\\u003cscript\\u003ealert(1)" in js_literal
        # And no executable alert() anywhere in the raw HTML.
        assert "<script>alert(1)" not in html


# ==================== Constant-time key checks still work ====================
class TestConstantTimeKeys:
    def test_gex_ingest_correct_key(self, api):
        assert GEX_INGEST_KEY, "GEX_INGEST_KEY not loaded from .env"
        payload = {
            "symbol": "SPY",
            "spot": 500.0,
            "levels": [
                {"strike": 500.0, "gex": 1e9, "type": "call"},
                {"strike": 500.0, "gex": -5e8, "type": "put"},
            ],
        }
        r = api.post(f"{BASE_URL}/api/ingest/gex",
                     headers={"X-Ingest-Key": GEX_INGEST_KEY,
                              "Content-Type": "application/json"},
                     json=payload)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        body = r.json()
        assert body.get("ok") is True or "symbol" in body or "id" in body

    def test_gex_ingest_wrong_key(self, api):
        r = api.post(f"{BASE_URL}/api/ingest/gex",
                     headers={"X-Ingest-Key": "definitely-wrong-key",
                              "Content-Type": "application/json"},
                     json={"symbol": "SPY", "spot": 500.0, "levels": []})
        assert r.status_code == 401

    def test_discord_bot_leaderboard_correct_key(self, api):
        assert DISCORD_BOT_KEY, "DISCORD_BOT_KEY not loaded from .env"
        r = api.get(f"{BASE_URL}/api/discord/bot/leaderboard",
                    headers={"X-Bot-Key": DISCORD_BOT_KEY})
        assert r.status_code == 200, r.text
        j = r.json()
        assert "entries" in j

    def test_discord_bot_leaderboard_wrong_key(self, api):
        r = api.get(f"{BASE_URL}/api/discord/bot/leaderboard",
                    headers={"X-Bot-Key": "bad"})
        assert r.status_code == 401


# ==================== Regression: core flows (admin premium token) ====================
class TestCoreRegression:
    def test_config(self, api):
        r = api.get(f"{BASE_URL}/api/config")
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j, dict) and len(j) > 0

    def test_dashboard_stats(self, api, admin_headers):
        r = api.get(f"{BASE_URL}/api/dashboard/stats", headers=admin_headers)
        assert r.status_code == 200
        # ensure at least basic shape
        assert isinstance(r.json(), dict)

    def test_gex(self, api, admin_headers):
        r = api.get(f"{BASE_URL}/api/gex", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))

    def test_gex_scorecard(self, api, admin_headers):
        r = api.get(f"{BASE_URL}/api/gex/scorecard", headers=admin_headers)
        assert r.status_code == 200

    def test_user_settings_toggle(self, api, admin_headers):
        # toggle discord_share_wins on then off
        for val in (True, False):
            r = api.post(f"{BASE_URL}/api/user/settings", headers=admin_headers,
                         json={"discord_share_wins": val})
            assert r.status_code == 200, r.text

    def test_trades_list(self, api, admin_headers):
        r = api.get(f"{BASE_URL}/api/trades", headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))


# ==================== CORS: allow_credentials=False, normal call still works ====================
class TestCORS:
    def test_no_credentials_call_ok(self, api):
        """A plain unauthenticated public call should still succeed with
        allow_credentials=False. /api/config is public."""
        r = api.get(f"{BASE_URL}/api/config",
                    headers={"Origin": "https://example.com"})
        assert r.status_code == 200
        # If Access-Control-Allow-Credentials is set, it must NOT be 'true'.
        acac = r.headers.get("access-control-allow-credentials")
        if acac is not None:
            assert acac.lower() != "true", f"allow_credentials should be False; got {acac}"

    def test_preflight_ok(self, api):
        r = api.options(f"{BASE_URL}/api/config",
                        headers={"Origin": "https://example.com",
                                 "Access-Control-Request-Method": "GET"})
        # CORSMiddleware answers preflights 200
        assert r.status_code in (200, 204)
        acac = r.headers.get("access-control-allow-credentials")
        if acac is not None:
            assert acac.lower() != "true"
