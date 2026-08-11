"""Tests for new POST /api/coach/analyze-image endpoint + regression on core coach/other endpoints
after root-layout change (ShareIntentProvider/Handler)."""
import os
import uuid
import time
import base64
import io
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://strategy-tracker-16.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "stocktradesrvl@gmail.com"
ADMIN_PASSWORD = "TradeAdmin123"


# ---------- helpers ----------
def _tiny_png_b64():
    img = Image.new("RGB", (64, 64), (20, 24, 32))
    for x in range(0, 64, 8):
        for y in range(0, 64, 8):
            img.putpixel((x, y), (46, 204, 113))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _register_free_user():
    """Create a throwaway free-tier user (default tier is 'free')."""
    email = f"TEST_shareintent_{uuid.uuid4().hex[:10]}@example.com"
    pw = "TestPass1234"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], email


def _login_admin():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login_admin()


@pytest.fixture(scope="module")
def free_token():
    tok, _ = _register_free_user()
    return tok


@pytest.fixture(scope="module")
def tiny_png_b64():
    return _tiny_png_b64()


# ---------- POST /api/coach/analyze-image ----------
class TestAnalyzeImageAuth:
    def test_no_auth_returns_401(self, tiny_png_b64):
        r = requests.post(f"{BASE_URL}/api/coach/analyze-image", json={"image_base64": tiny_png_b64}, timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"


class TestAnalyzeImageTierGating:
    def test_free_user_gets_402(self, free_token, tiny_png_b64):
        r = requests.post(
            f"{BASE_URL}/api/coach/analyze-image",
            headers={"Authorization": f"Bearer {free_token}", "Content-Type": "application/json"},
            json={"image_base64": tiny_png_b64},
            timeout=30,
        )
        assert r.status_code == 402, f"expected 402 for free tier, got {r.status_code}: {r.text}"
        assert "premium" in r.text.lower() or "upgrade" in r.text.lower()


class TestAnalyzeImagePremiumSuccess:
    def test_premium_user_analyze_and_persist(self, admin_token, tiny_png_b64):
        # Snapshot chat history length BEFORE
        before = requests.get(
            f"{BASE_URL}/api/coach/history",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30,
        )
        assert before.status_code == 200
        before_len = len(before.json())

        # Send image
        r = requests.post(
            f"{BASE_URL}/api/coach/analyze-image",
            headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
            json={"image_base64": tiny_png_b64},
            timeout=90,   # LLM call
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert "reply" in body and isinstance(body["reply"], str) and len(body["reply"]) > 0
        assert "suggestions" in body and isinstance(body["suggestions"], list)

        # Verify persistence: history now contains a user '📷 Shared a screenshot' message + an assistant reply
        time.sleep(1)
        after = requests.get(
            f"{BASE_URL}/api/coach/history",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30,
        )
        assert after.status_code == 200
        msgs = after.json()
        assert len(msgs) >= before_len + 2, f"history should grow by >=2 (user+assistant); before={before_len}, after={len(msgs)}"
        # look at the last few messages
        tail_contents = " || ".join(m["content"] for m in msgs[-4:])
        assert "Shared a screenshot" in tail_contents, f"expected 'Shared a screenshot' user message; tail={tail_contents!r}"
        # last message should be assistant
        assert msgs[-1]["role"] == "assistant"
        assert isinstance(msgs[-1]["content"], str) and len(msgs[-1]["content"]) > 0


# ---------- REGRESSION: core endpoints unaffected ----------
class TestRegressionCoreEndpoints:
    def test_config(self):
        r = requests.get(f"{BASE_URL}/api/config", timeout=30)
        assert r.status_code == 200, f"/api/config failed: {r.status_code} {r.text}"
        data = r.json()
        # sanity: should be a dict with something inside
        assert isinstance(data, dict)

    def test_dashboard_stats(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/dashboard/stats",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30,
        )
        assert r.status_code == 200, f"/api/dashboard/stats failed: {r.status_code} {r.text}"
        assert isinstance(r.json(), dict)

    def test_coach_history(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/coach/history",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=30,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_coach_chat_still_works(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/coach/chat",
            headers={"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"},
            json={"message": "TEST: In one short sentence, how do I improve consistency?"},
            timeout=90,
        )
        assert r.status_code == 200, f"/api/coach/chat failed: {r.status_code} {r.text}"
        body = r.json()
        assert "reply" in body and isinstance(body["reply"], str) and len(body["reply"]) > 0
        assert "suggestions" in body and isinstance(body["suggestions"], list)
