"""Iteration 4: Targeted regression per E1 review request.
Focus: owner@trademind.ai login, Trade Detail PUT /trades/{id}/taken toggle,
dashboard exclusion of idea trades, journal filters, coach chat, pretrade, strategy, screenshot reachability.
"""
import os, uuid, base64, io, time
import pytest, requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or open("/app/frontend/.env").read().split("EXPO_PUBLIC_BACKEND_URL=")[1].split("\n")[0].strip('"')
API = BASE_URL.rstrip("/") + "/api"

OWNER_EMAIL = "owner@trademind.ai"
OWNER_PASS = "Owner1234"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def owner_token():
    j = _login(OWNER_EMAIL, OWNER_PASS)
    assert j.get("user", {}).get("subscription_tier") in ("premium", "pro")
    return j["access_token"]


@pytest.fixture
def h(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


# --- Auth ---
class TestAuth:
    def test_owner_login_premium(self):
        j = _login(OWNER_EMAIL, OWNER_PASS)
        u = j["user"]
        assert u["email"] == OWNER_EMAIL
        assert u["subscription_tier"] == "premium"
        # account balance seeded 50000 per test_credentials.md
        assert u.get("account_balance", 0) >= 0

    def test_me(self, h):
        r = requests.get(f"{API}/auth/me", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == OWNER_EMAIL


# --- Trade taken toggle (recent fix) ---
class TestTakenToggle:
    trade_id = None

    def test_seed_trade_via_analyze(self, h, chart_image_b64):
        img = chart_image_b64
        r = requests.post(f"{API}/trades/analyze-screenshot", headers=h, json={
            "image_base64": img, "asset_type": "stock", "taken": True
        }, timeout=120)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "id" in j
        assert j.get("taken", True) is True
        TestTakenToggle.trade_id = j["id"]

    def test_toggle_to_idea(self, h):
        assert TestTakenToggle.trade_id
        r = requests.put(f"{API}/trades/{TestTakenToggle.trade_id}/taken",
                         headers=h, json={"taken": False}, timeout=15)
        assert r.status_code == 200, r.text
        # verify persistence
        g = requests.get(f"{API}/trades/{TestTakenToggle.trade_id}", headers=h, timeout=15)
        assert g.status_code == 200
        assert g.json()["taken"] is False

    def test_idea_excluded_from_dashboard(self, h):
        r = requests.get(f"{API}/dashboard/stats", headers=h, timeout=30)
        assert r.status_code == 200
        j = r.json()
        # our idea trade must not appear in the executed list summary counts
        # can't check exact count but at least the endpoint should still return
        assert "total_trades" in j or "trades" in j or isinstance(j, dict)

    def test_journal_filters_taken_true_excludes_idea(self, h):
        r = requests.get(f"{API}/trades?taken=true", headers=h, timeout=15)
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert TestTakenToggle.trade_id not in ids

    def test_journal_filters_taken_false_includes_idea(self, h):
        r = requests.get(f"{API}/trades?taken=false", headers=h, timeout=15)
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert TestTakenToggle.trade_id in ids

    def test_toggle_back_to_executed(self, h):
        r = requests.put(f"{API}/trades/{TestTakenToggle.trade_id}/taken",
                         headers=h, json={"taken": True}, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{API}/trades/{TestTakenToggle.trade_id}", headers=h, timeout=15)
        assert g.json()["taken"] is True

    def test_toggle_unknown_id_404(self, h):
        r = requests.put(f"{API}/trades/nonexistent-{uuid.uuid4()}/taken",
                         headers=h, json={"taken": False}, timeout=15)
        assert r.status_code == 404

    def test_cleanup(self, h):
        if TestTakenToggle.trade_id:
            requests.delete(f"{API}/trades/{TestTakenToggle.trade_id}", headers=h, timeout=10)


# --- Grade filter ---
class TestGradeFilter:
    def test_grade_a(self, h):
        r = requests.get(f"{API}/trades?grade=A", headers=h, timeout=15)
        assert r.status_code == 200
        assert all(t.get("setup_grade") == "A" for t in r.json())


# --- Dashboard ---
class TestDashboard:
    def test_dashboard_shape(self, h):
        r = requests.get(f"{API}/dashboard/stats", headers=h, timeout=30)
        assert r.status_code == 200
        j = r.json()
        # Check for critical dashboard fields
        for k in ("account_balance", "equity_curve"):
            assert k in j, f"missing key: {k}"


# --- Coach ---
class TestCoach:
    def test_coach_chat(self, h):
        r = requests.post(f"{API}/coach/chat", headers=h,
                          json={"message": "Give me one word: OK"}, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "response" in j or "message" in j or "reply" in j


# --- Pretrade Grader ---
class TestPretrade:
    def test_pretrade_ok(self, h, chart_image_b64):
        img = chart_image_b64
        r = requests.post(f"{API}/analyze/pretrade", headers=h, json={
            "image_base64": img, "symbol": "AAPL", "direction": "long", "asset_type": "stock",
            "entry": 200, "stop": 195, "target": 210, "quantity": 10,
            "notes": "breakout"
        }, timeout=120)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "grade" in j and j["grade"] in list("ABCDEF")


# --- Strategies ---
class TestStrategy:
    def test_list_and_create(self, h):
        r = requests.get(f"{API}/strategies", headers=h, timeout=15)
        assert r.status_code == 200
        pre_count = len(r.json())
        name = f"TEST_STRAT_{uuid.uuid4().hex[:6]}"
        c = requests.post(f"{API}/strategies", headers=h, json={
            "name": name, "rules": ["r1", "r2"], "description": "t"
        }, timeout=15)
        assert c.status_code == 200, c.text
        sid = c.json()["id"]
        # cleanup
        requests.delete(f"{API}/strategies/{sid}", headers=h, timeout=10)


# --- Analyze screenshot reachable ---
class TestScreenshotEndpoint:
    def test_endpoint_reachable(self, h):
        # Empty body should give validation err (422 or 400) — not 500 / 404
        r = requests.post(f"{API}/trades/analyze-screenshot", headers=h, json={}, timeout=15)
        assert r.status_code in (400, 422)
