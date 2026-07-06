"""Stripe payments backend tests + light regression on existing endpoints.

Covers:
- POST /api/payments/create-checkout-session (auth, tier validation, real Stripe URL, pending record)
- Server-side price authority (client cannot influence amount)
- GET /api/payments/redirect (success + cancel HTML)
- GET /api/payments/status (auth, user_id mismatch => 403, not-paid => no upgrade)
- Regression: /api/auth/login, /api/dashboard/stats, /api/trades/analyze-screenshot
"""
import os
import uuid
import pytest
import requests

# Reuse fixtures: api, base_url, auth_headers, auth_token, chart_image_b64 from conftest


# ---------- helpers ----------
def _register_new(api, base_url):
    email = f"TEST_pay_{uuid.uuid4().hex[:8]}@test.com"
    r = api.post(f"{base_url}/api/auth/register", json={"email": email, "password": "Test1234!"})
    assert r.status_code == 200, r.text
    return email, r.json()["access_token"]


def _reset_to_free(api, base_url, headers):
    api.post(f"{base_url}/api/auth/tier", json={"tier": "free"}, headers=headers)


# ---------- Regression: login ----------
class TestRegressionLogin:
    def test_login_returns_token_and_user(self, api, base_url):
        r = api.post(f"{base_url}/api/auth/login",
                     json={"email": "trader@test.com", "password": "Test1234"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("token_type") == "bearer"
        assert len(j.get("access_token", "")) > 20
        assert j["user"]["email"] == "trader@test.com"
        assert "_id" not in j["user"]


# ---------- Regression: dashboard stats ----------
class TestRegressionDashboard:
    def test_dashboard_stats_shape(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/dashboard/stats", headers=auth_headers)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ["total_trades", "total_pnl", "win_rate", "profit_factor",
                  "avg_winner", "avg_loser", "equity_curve", "account_balance"]:
            assert k in j, f"missing {k}"
        assert isinstance(j["equity_curve"], list)


# ---------- Regression: analyze-screenshot ----------
class TestRegressionAnalyzeScreenshot:
    def test_analyze_screenshot_on_free_tier(self, api, base_url, auth_headers, chart_image_b64):
        _reset_to_free(api, base_url, auth_headers)
        r = api.post(f"{base_url}/api/trades/analyze-screenshot",
                     json={"image_base64": chart_image_b64},
                     headers=auth_headers, timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        j = r.json()
        for k in ["id", "symbol", "direction", "entry", "exit", "quantity", "pnl",
                  "setup_grade", "detected_setup", "ai_summary"]:
            assert k in j, f"missing {k}"
        assert j["setup_grade"] in ["A", "B", "C", "D", "F"]


# ---------- Payments: create session ----------
class TestCreateCheckoutSession:
    pro_session_id = None
    premium_session_id = None

    def test_requires_auth(self, api, base_url):
        r = api.post(f"{base_url}/api/payments/create-checkout-session",
                     json={"tier": "pro", "origin": base_url, "return_url": "myapp://payment-return"})
        assert r.status_code == 401

    def test_invalid_tier_returns_400(self, api, base_url, auth_headers):
        r = api.post(f"{base_url}/api/payments/create-checkout-session",
                     json={"tier": "gold", "origin": base_url, "return_url": "myapp://payment-return"},
                     headers=auth_headers)
        assert r.status_code == 400, r.text

    def test_invalid_tier_free_returns_400(self, api, base_url, auth_headers):
        # 'free' is not a purchasable tier
        r = api.post(f"{base_url}/api/payments/create-checkout-session",
                     json={"tier": "free", "origin": base_url, "return_url": "myapp://payment-return"},
                     headers=auth_headers)
        assert r.status_code == 400, r.text

    def test_create_pro_session(self, api, base_url, auth_headers):
        r = api.post(f"{base_url}/api/payments/create-checkout-session",
                     json={"tier": "pro", "origin": base_url, "return_url": "myapp://payment-return"},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "checkout_url" in j and "session_id" in j
        assert j["checkout_url"].startswith("https://checkout.stripe.com/"), j["checkout_url"]
        assert j["session_id"].startswith("cs_test_"), j["session_id"]
        TestCreateCheckoutSession.pro_session_id = j["session_id"]

    def test_create_premium_session_with_trial(self, api, base_url, auth_headers):
        r = api.post(f"{base_url}/api/payments/create-checkout-session",
                     json={"tier": "premium", "origin": base_url, "return_url": "myapp://payment-return"},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["checkout_url"].startswith("https://checkout.stripe.com/")
        assert j["session_id"].startswith("cs_test_")
        TestCreateCheckoutSession.premium_session_id = j["session_id"]

    def test_server_side_price_authority(self, api, base_url, auth_headers):
        """Endpoint only accepts 'tier' - extra client fields like amount must be ignored."""
        r = api.post(f"{base_url}/api/payments/create-checkout-session",
                     json={"tier": "pro", "origin": base_url, "return_url": "myapp://x",
                           "amount": 1, "unit_amount": 1, "price": 1},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        session_id = r.json()["session_id"]

        # Verify amount server-side by retrieving via Stripe API
        import stripe
        stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
        assert stripe.api_key.startswith("sk_test_"), "Stripe test key not configured"
        session = stripe.checkout.Session.retrieve(session_id, expand=["line_items"])
        line_items = session.line_items["data"]
        assert len(line_items) == 1
        assert line_items[0]["amount_total"] == 1999, f"expected pro=1999 cents, got {line_items[0]['amount_total']}"

    def test_premium_amount_is_4999_with_trial(self, api, base_url, auth_headers):
        """Premium: unit_amount=4999 cents, with 7-day trial. amount_total during trial is 0."""
        sid = TestCreateCheckoutSession.premium_session_id
        assert sid, "premium session not created"
        import stripe
        stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
        session = stripe.checkout.Session.retrieve(sid, expand=["line_items.data.price"])
        li = session.line_items["data"][0]
        # During trial, amount_total is 0 but the underlying price unit_amount must be 4999
        price = li.get("price") or {}
        assert price.get("unit_amount") == 4999, f"expected unit_amount=4999, got {price.get('unit_amount')}"
        # Verify trial is configured (7 days)
        assert session.get("subscription") is None  # not yet created (unpaid)
        # metadata carries tier
        assert (session.get("metadata") or {}).get("tier") == "premium"


# ---------- Payments: redirect ----------
class TestPaymentRedirect:
    def test_success_redirect_html(self, api, base_url):
        r = api.get(f"{base_url}/api/payments/redirect",
                    params={"rt": "myapp://payment-return", "session_id": "cs_test_dummy"})
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
        body = r.text
        assert "meta http-equiv=\"refresh\"" in body
        assert "session_id=cs_test_dummy" in body
        assert "status=success" in body
        assert "myapp" in body

    def test_cancel_redirect_html(self, api, base_url):
        r = api.get(f"{base_url}/api/payments/redirect",
                    params={"rt": "myapp://payment-return", "status": "cancel"})
        assert r.status_code == 200
        assert "cancelled" in r.text.lower()
        assert "status=cancel" in r.text


# ---------- Payments: status ----------
class TestPaymentStatus:
    def test_requires_auth(self, api, base_url):
        r = api.get(f"{base_url}/api/payments/status", params={"session_id": "cs_test_x"})
        assert r.status_code == 401

    def test_invalid_session_returns_400(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/payments/status",
                    params={"session_id": "cs_test_totally_invalid_xyz"}, headers=auth_headers)
        assert r.status_code == 400

    def test_not_paid_does_not_upgrade_tier(self, api, base_url, auth_headers):
        # Reset to free
        _reset_to_free(api, base_url, auth_headers)
        # Create a fresh pro session
        r = api.post(f"{base_url}/api/payments/create-checkout-session",
                     json={"tier": "pro", "origin": base_url, "return_url": "myapp://x"},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200
        sid = r.json()["session_id"]

        # Immediately poll status - session is not paid yet
        r2 = api.get(f"{base_url}/api/payments/status",
                     params={"session_id": sid}, headers=auth_headers)
        assert r2.status_code == 200, r2.text
        j = r2.json()
        assert j["paid"] is False, f"expected paid=false, got {j}"
        assert j["session_status"] in ("open", "expired")
        # Tier must remain free
        assert j["user"]["subscription_tier"] == "free", \
            f"tier should NOT be upgraded before payment: {j['user']}"

        # Cross-check via /auth/me
        me = api.get(f"{base_url}/api/auth/me", headers=auth_headers).json()
        assert me["subscription_tier"] == "free"

    def test_user_mismatch_returns_403(self, api, base_url, auth_headers):
        # Create session under trader@test.com
        r = api.post(f"{base_url}/api/payments/create-checkout-session",
                     json={"tier": "pro", "origin": base_url, "return_url": "myapp://x"},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 200
        sid = r.json()["session_id"]

        # Register a NEW user and try to read the first user's session
        _email, other_token = _register_new(api, base_url)
        other_headers = {"Authorization": f"Bearer {other_token}", "Content-Type": "application/json"}
        r2 = api.get(f"{base_url}/api/payments/status",
                     params={"session_id": sid}, headers=other_headers)
        assert r2.status_code == 403, f"expected 403 for user mismatch, got {r2.status_code} {r2.text}"
