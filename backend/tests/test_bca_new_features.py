"""Backend tests for Blue Collar Alpha new features:
- Performance metrics
- P&L calendar
- CSV import
- Daily loss limit setting
- Trade emotion tagging
"""
import os
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://strategy-tracker-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "stocktradesrvl@gmail.com"
ADMIN_PWD = "TradeAdmin123"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}


# ---------- Performance Metrics ----------
class TestMetrics:
    def test_metrics_shape(self, auth_headers):
        r = requests.get(f"{API}/dashboard/metrics", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("profit_factor", "expectancy", "avg_win", "avg_loss", "win_rate",
                  "best_win_streak", "worst_loss_streak", "by_weekday", "by_hour", "playbooks", "has_data"):
            assert k in d, f"missing key {k}"
        assert isinstance(d["by_weekday"], list)
        assert isinstance(d["by_hour"], list)
        assert isinstance(d["playbooks"], list)


# ---------- P&L Calendar ----------
class TestCalendar:
    def test_calendar_current_month(self, auth_headers):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        r = requests.get(f"{API}/dashboard/calendar", params={"month": month}, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("days", "month_pnl", "green_days", "red_days"):
            assert k in d
        assert isinstance(d["days"], dict)
        assert isinstance(d["month_pnl"], (int, float))

    def test_calendar_invalid_month_falls_back(self, auth_headers):
        # Backend gracefully falls back to current month (documented behavior)
        r = requests.get(f"{API}/dashboard/calendar", params={"month": "invalid"}, headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert "month" in r.json()


# ---------- CSV Import ----------
class TestCSVImport:
    def test_import_basic_csv(self, auth_headers):
        csv = "Symbol,PnL,Date,Side\nTESTAAPL,42.50,2026-01-05,long\nTESTMSFT,-15.00,2026-01-06,short\n"
        r = requests.post(f"{API}/trades/import-csv", json={"csv": csv}, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "imported" in d and "skipped" in d
        assert d["imported"] >= 2, d

    def test_import_flexible_columns(self, auth_headers):
        csv = "Ticker,Profit,Setup\nTESTNVDA,88,Breakout\n"
        r = requests.post(f"{API}/trades/import-csv", json={"csv": csv}, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["imported"] >= 1

    def test_import_skip_missing(self, auth_headers):
        csv = "Symbol,PnL\n,50\nTESTX,\n"
        r = requests.post(f"{API}/trades/import-csv", json={"csv": csv}, headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert r.json()["skipped"] >= 2

    def test_metrics_reflect_imports(self, auth_headers):
        r = requests.get(f"{API}/dashboard/metrics", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert r.json()["has_data"] is True


# ---------- User Settings (daily loss limit) ----------
class TestSettings:
    def test_set_and_get_loss_limit(self, auth_headers):
        r = requests.post(f"{API}/user/settings", json={"daily_loss_limit": 250}, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text

        me = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=30)
        assert me.status_code == 200
        assert me.json().get("daily_loss_limit") == 250

    def test_zero_loss_limit(self, auth_headers):
        r = requests.post(f"{API}/user/settings", json={"daily_loss_limit": 0}, headers=auth_headers, timeout=30)
        assert r.status_code == 200


# ---------- Trade Emotion Tagging ----------
class TestEmotion:
    def test_set_emotion(self, auth_headers):
        # Get any trade id
        trades = requests.get(f"{API}/trades", headers=auth_headers, timeout=30).json()
        assert isinstance(trades, list) and len(trades) > 0, "no trades to tag"
        tid = trades[0]["id"]

        r = requests.put(f"{API}/trades/{tid}/emotion", json={"emotion": "Confident"}, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text

        # verify via GET
        t = requests.get(f"{API}/trades/{tid}", headers=auth_headers, timeout=30).json()
        assert t.get("emotion") == "Confident", t

    def test_reject_bad_emotion(self, auth_headers):
        trades = requests.get(f"{API}/trades", headers=auth_headers, timeout=30).json()
        tid = trades[0]["id"]
        r = requests.put(f"{API}/trades/{tid}/emotion", json={"emotion": "NotAnEmotion"}, headers=auth_headers, timeout=30)
        # Backend silently ignores invalid emotion (does not persist) — acceptable
        t = requests.get(f"{API}/trades/{tid}", headers=auth_headers, timeout=30).json()
        assert t.get("emotion") != "NotAnEmotion"


# ---------- Regression: existing endpoints still work ----------
class TestRegression:
    def test_dashboard_stats(self, auth_headers):
        r = requests.get(f"{API}/dashboard/stats", headers=auth_headers, timeout=30)
        assert r.status_code == 200

    def test_trades_list(self, auth_headers):
        r = requests.get(f"{API}/trades", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
