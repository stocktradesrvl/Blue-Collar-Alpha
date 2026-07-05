"""Backend tests for TradeMind AI API"""
import time, uuid, pytest, requests


# --- Health ---
def test_root(api, base_url):
    r = api.get(f"{base_url}/api/")
    assert r.status_code == 200
    assert "message" in r.json()


# --- Auth ---
class TestAuth:
    def test_login_or_register_returns_token(self, auth_token):
        assert auth_token and len(auth_token) > 20

    def test_me(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["email"] == "trader@test.com"
        assert j["subscription_tier"] in ("free", "pro", "premium")
        assert "account_balance" in j

    def test_me_no_token(self, api, base_url):
        r = api.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_login_bad_password(self, api, base_url):
        r = api.post(f"{base_url}/api/auth/login", json={"email": "trader@test.com", "password": "WrongPW"})
        assert r.status_code == 401

    def test_register_duplicate(self, api, base_url):
        r = api.post(f"{base_url}/api/auth/register", json={"email": "trader@test.com", "password": "Test1234"})
        assert r.status_code == 400


# --- Tier switching ---
class TestTier:
    def test_set_tier_invalid(self, api, base_url, auth_headers):
        r = api.post(f"{base_url}/api/auth/tier", json={"tier": "gold"}, headers=auth_headers)
        assert r.status_code == 400

    def test_set_tier_free_then_pro_then_premium(self, api, base_url, auth_headers):
        for t in ["free", "pro", "premium", "free"]:
            r = api.post(f"{base_url}/api/auth/tier", json={"tier": t}, headers=auth_headers)
            assert r.status_code == 200, r.text
            assert r.json()["subscription_tier"] == t


# --- Strategies ---
class TestStrategies:
    strategy_id = None

    def test_create_and_get(self, api, base_url, auth_headers):
        payload = {"name": "TEST_ORB", "risk_pct": 1.5, "rules": ["No revenge", "Set stop"]}
        r = api.post(f"{base_url}/api/strategies", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["name"] == "TEST_ORB" and j["risk_pct"] == 1.5
        assert "id" in j and "_id" not in j
        TestStrategies.strategy_id = j["id"]
        # verify in list
        r2 = api.get(f"{base_url}/api/strategies", headers=auth_headers)
        assert r2.status_code == 200
        ids = [s["id"] for s in r2.json()]
        assert TestStrategies.strategy_id in ids

    def test_update(self, api, base_url, auth_headers):
        sid = TestStrategies.strategy_id
        r = api.put(f"{base_url}/api/strategies/{sid}",
                    json={"name": "TEST_ORB_v2", "risk_pct": 2.0, "rules": ["A"]},
                    headers=auth_headers)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "TEST_ORB_v2"

    def test_delete(self, api, base_url, auth_headers):
        sid = TestStrategies.strategy_id
        r = api.delete(f"{base_url}/api/strategies/{sid}", headers=auth_headers)
        assert r.status_code == 200


# --- Screenshot analysis (Claude vision) ---
class TestTradeAnalysis:
    trade_id = None

    def test_ensure_free_then_analyze_screenshot(self, api, base_url, auth_headers, chart_image_b64):
        # ensure free tier at start
        r0 = api.post(f"{base_url}/api/auth/tier", json={"tier": "free"}, headers=auth_headers)
        assert r0.status_code == 200
        r = api.post(f"{base_url}/api/trades/analyze-screenshot",
                     json={"image_base64": chart_image_b64}, headers=auth_headers, timeout=90)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        j = r.json()
        # required keys
        for k in ["id", "symbol", "direction", "entry", "exit", "quantity", "pnl",
                  "setup_grade", "rule_violations", "detected_setup", "ai_summary"]:
            assert k in j, f"missing {k}"
        assert j["setup_grade"] in ["A", "B", "C", "D", "F"]
        assert isinstance(j["rule_violations"], list)
        assert "_id" not in j
        TestTradeAnalysis.trade_id = j["id"]

    def test_list_trades_and_persistence(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/trades", headers=auth_headers)
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert TestTradeAnalysis.trade_id in ids
        # image_base64 should be stripped in list
        assert all("image_base64" not in t for t in r.json())

    def test_get_single_trade(self, api, base_url, auth_headers):
        tid = TestTradeAnalysis.trade_id
        r = api.get(f"{base_url}/api/trades/{tid}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["id"] == tid

    def test_filter_by_grade(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/trades", headers=auth_headers, params={"grade": "A"})
        assert r.status_code == 200
        for t in r.json():
            assert t["setup_grade"] == "A"


# --- Chart analysis (Pro-gated) ---
class TestChartAnalysis:
    def test_free_gets_402(self, api, base_url, auth_headers, chart_image_b64):
        api.post(f"{base_url}/api/auth/tier", json={"tier": "free"}, headers=auth_headers)
        r = api.post(f"{base_url}/api/trades/analyze-chart",
                     json={"image_base64": chart_image_b64}, headers=auth_headers, timeout=30)
        assert r.status_code == 402

    def test_pro_can_analyze(self, api, base_url, auth_headers, chart_image_b64):
        api.post(f"{base_url}/api/auth/tier", json={"tier": "pro"}, headers=auth_headers)
        r = api.post(f"{base_url}/api/trades/analyze-chart",
                     json={"image_base64": chart_image_b64}, headers=auth_headers, timeout=90)
        assert r.status_code == 200, r.text[:400]
        j = r.json()
        for k in ["trend", "patterns", "support", "resistance", "setup_grade", "analysis"]:
            assert k in j, f"missing {k}"


# --- Dashboard ---
class TestDashboard:
    def test_stats(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/dashboard/stats", headers=auth_headers)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ["total_trades", "total_pnl", "win_rate", "profit_factor",
                  "avg_winner", "avg_loser", "equity_curve", "best_setup", "best_hour"]:
            assert k in j
        assert isinstance(j["equity_curve"], list)
        assert j["total_trades"] >= 1


# --- Daily report ---
class TestDailyReport:
    def test_daily_report(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/reports/daily", headers=auth_headers, timeout=90)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert "report" in j and isinstance(j["report"], str)
        assert len(j["report"]) > 5


# --- Coach chat (Premium-gated) ---
class TestCoach:
    def test_free_gets_402(self, api, base_url, auth_headers):
        api.post(f"{base_url}/api/auth/tier", json={"tier": "free"}, headers=auth_headers)
        r = api.post(f"{base_url}/api/coach/chat", json={"message": "How am I doing?"}, headers=auth_headers)
        assert r.status_code == 402

    def test_pro_gets_402(self, api, base_url, auth_headers):
        api.post(f"{base_url}/api/auth/tier", json={"tier": "pro"}, headers=auth_headers)
        r = api.post(f"{base_url}/api/coach/chat", json={"message": "hi"}, headers=auth_headers)
        assert r.status_code == 402

    def test_premium_can_chat(self, api, base_url, auth_headers):
        api.post(f"{base_url}/api/auth/tier", json={"tier": "premium"}, headers=auth_headers)
        r = api.post(f"{base_url}/api/coach/chat",
                    json={"message": "What was my biggest mistake so far?"},
                    headers=auth_headers, timeout=90)
        assert r.status_code == 200, r.text[:300]
        assert "reply" in r.json() and len(r.json()["reply"]) > 5

    def test_history(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/coach/history", headers=auth_headers)
        assert r.status_code == 200
        msgs = r.json()
        assert isinstance(msgs, list) and len(msgs) >= 2
        roles = {m["role"] for m in msgs}
        assert "user" in roles and "assistant" in roles


# --- Cleanup: trade deletion ---
class TestTradeCleanup:
    def test_delete_trade(self, api, base_url, auth_headers):
        tid = TestTradeAnalysis.trade_id
        if not tid:
            pytest.skip("no trade created")
        r = api.delete(f"{base_url}/api/trades/{tid}", headers=auth_headers)
        assert r.status_code == 200
        r2 = api.get(f"{base_url}/api/trades/{tid}", headers=auth_headers)
        assert r2.status_code == 404
