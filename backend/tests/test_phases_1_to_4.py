"""
Backend tests for Blue Collar Alpha — Phases 1-4 (backend only):
  Phase 1: Multi-broker balances + cash-adjustments ledger + login reconciliation flag
  Phase 2: Market Sentiment (Premium)
  Phase 4: AI Coaching — game plan, emotion insights, rule streak
Regression: /api/config, /api/gex (premium existing)
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL",
                          "https://strategy-tracker-16.preview.emergentagent.com").rstrip("/")

PREMIUM_EMAIL = "stocktradesrvl@gmail.com"
PREMIUM_PASSWORD = "TradeAdmin123"


# ---------- Helpers ----------
def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=20)
    return r


def _register(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": password}, timeout=20)
    return r


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def premium_headers():
    r = _login(PREMIUM_EMAIL, PREMIUM_PASSWORD)
    assert r.status_code == 200, f"premium login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("user", {}).get("subscription_tier") == "premium", \
        f"expected premium tier, got {data.get('user')}"
    return {"Authorization": f"Bearer {data['access_token']}",
            "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def free_headers():
    email = f"TEST_free_{uuid.uuid4().hex[:8]}@example.com"
    pw = "FreeUser1234!"
    r = _register(email, pw)
    assert r.status_code == 200, f"free register failed: {r.status_code} {r.text}"
    data = r.json()
    # new users should default to free
    tier = data.get("user", {}).get("subscription_tier")
    assert tier == "free", f"expected free tier for fresh register, got {tier}"
    return {"Authorization": f"Bearer {data['access_token']}",
            "Content-Type": "application/json"}


# ---------- Phase 1: Brokers ----------
class TestBrokers:
    created_ids = []

    def test_list_brokers_initial(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/brokers", headers=premium_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "accounts" in j and isinstance(j["accounts"], list)
        assert "total" in j and isinstance(j["total"], (int, float))
        assert "needs_reconcile" in j and isinstance(j["needs_reconcile"], bool)

    def test_create_broker(self, premium_headers):
        payload = {"name": f"TEST_BrokerA_{uuid.uuid4().hex[:5]}", "balance": 12500.55}
        r = requests.post(f"{BASE_URL}/api/brokers", json=payload,
                          headers=premium_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("id")
        assert j.get("name") == payload["name"]
        assert abs(j.get("balance", 0) - 12500.55) < 0.01
        TestBrokers.created_ids.append(j["id"])

    def test_create_second_broker(self, premium_headers):
        payload = {"name": f"TEST_BrokerB_{uuid.uuid4().hex[:5]}", "balance": 5000}
        r = requests.post(f"{BASE_URL}/api/brokers", json=payload,
                          headers=premium_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        TestBrokers.created_ids.append(j["id"])

    def test_list_after_create_persists(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/brokers", headers=premium_headers, timeout=15)
        assert r.status_code == 200
        j = r.json()
        ids = {a["id"] for a in j["accounts"]}
        for bid in TestBrokers.created_ids:
            assert bid in ids, f"broker {bid} not persisted"

    def test_update_broker(self, premium_headers):
        assert TestBrokers.created_ids, "no brokers to update"
        bid = TestBrokers.created_ids[0]
        r = requests.put(f"{BASE_URL}/api/brokers/{bid}",
                         json={"name": "TEST_RenamedA", "balance": 13000},
                         headers=premium_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["name"] == "TEST_RenamedA"
        assert abs(j["balance"] - 13000) < 0.01
        # verify via GET
        g = requests.get(f"{BASE_URL}/api/brokers", headers=premium_headers, timeout=15).json()
        found = next(a for a in g["accounts"] if a["id"] == bid)
        assert found["name"] == "TEST_RenamedA"
        assert abs(found["balance"] - 13000) < 0.01

    def test_update_broker_not_found(self, premium_headers):
        r = requests.put(f"{BASE_URL}/api/brokers/does-not-exist",
                         json={"name": "X"}, headers=premium_headers, timeout=15)
        assert r.status_code == 404, r.text


# ---------- Phase 1: Reconcile + Cash Adjustments ----------
class TestReconcileAndCash:
    def test_reconcile_with_win_and_no_classification(self, premium_headers):
        # Ensure we have 2 brokers - fetch current
        r = requests.get(f"{BASE_URL}/api/brokers", headers=premium_headers, timeout=15)
        assert r.status_code == 200
        accts = r.json()["accounts"]
        # Filter to our TEST_ brokers so we know starting balances
        test_accts = [a for a in accts if a["name"].startswith("TEST_")]
        assert len(test_accts) >= 2, "expected at least 2 TEST_ brokers from prior test"
        a0, a1 = test_accts[0], test_accts[1]
        new_bal_0 = round(a0["balance"] + 250.0, 2)  # +250 win
        new_bal_1 = round(a1["balance"] - 100.0, 2)  # -100, no classification -> defaults 'other'

        items = [
            {"id": a0["id"], "new_balance": new_bal_0,
             "classification": "win", "note": "TEST_reconcile_win"},
            {"id": a1["id"], "new_balance": new_bal_1,
             "note": "TEST_reconcile_no_class"},  # no classification key -> None -> other
        ]
        r = requests.post(f"{BASE_URL}/api/brokers/reconcile", json={"items": items},
                          headers=premium_headers, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert isinstance(j.get("adjustments"), list)
        assert len(j["adjustments"]) == 2, f"expected 2 adjustments logged, got {j}"

        types = {adj["type"] for adj in j["adjustments"]}
        # win present, and 'other' fallback present
        assert "win" in types
        assert "other" in types

    def test_needs_reconcile_flag_flips_false(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/brokers", headers=premium_headers, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["needs_reconcile"] is False, \
            f"needs_reconcile should be False after reconcile, got {j}"

    def test_cash_adjustments_lists_and_summary(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/cash-adjustments",
                         headers=premium_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "adjustments" in j and isinstance(j["adjustments"], list)
        assert len(j["adjustments"]) >= 2
        summ = j.get("summary", {})
        for k in ("win", "loss", "other"):
            assert k in summ, f"summary missing key {k}: {summ}"
            assert isinstance(summ[k], (int, float))
        assert "net" in j and isinstance(j["net"], (int, float))
        # net should approximately match sum of amounts
        s = round(sum(a["amount"] for a in j["adjustments"]), 2)
        assert abs(s - j["net"]) < 0.01, f"net mismatch: sum={s} net={j['net']}"

    def test_reconcile_no_change_logs_nothing(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/brokers", headers=premium_headers, timeout=15)
        accts = [a for a in r.json()["accounts"] if a["name"].startswith("TEST_")]
        assert accts
        a = accts[0]
        items = [{"id": a["id"], "new_balance": a["balance"], "classification": "other"}]
        r = requests.post(f"{BASE_URL}/api/brokers/reconcile", json={"items": items},
                          headers=premium_headers, timeout=20)
        assert r.status_code == 200
        assert r.json().get("adjustments") == [], "no-change reconcile should log nothing"


# ---------- Cleanup brokers after reconcile/cash tests ----------
class TestBrokerDeleteCleanup:
    def test_delete_all_test_brokers(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/brokers", headers=premium_headers, timeout=15)
        accts = [a for a in r.json()["accounts"]
                 if a["name"].startswith("TEST_") or a["name"] == "TEST_RenamedA"]
        for a in accts:
            d = requests.delete(f"{BASE_URL}/api/brokers/{a['id']}",
                                headers=premium_headers, timeout=15)
            assert d.status_code == 200, d.text
            assert d.json().get("ok") is True
        # verify all removed
        r = requests.get(f"{BASE_URL}/api/brokers", headers=premium_headers, timeout=15)
        remaining = [a for a in r.json()["accounts"]
                     if a["name"].startswith("TEST_") or a["name"] == "TEST_RenamedA"]
        assert remaining == [], f"still remaining: {remaining}"


# ---------- Phase 2: Sentiment ----------
class TestSentiment:
    def test_sentiment_premium_ok(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/sentiment", headers=premium_headers, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "cards" in j and isinstance(j["cards"], list)
        assert "as_of" in j
        # up to 4 cards; may be fewer if a live source is down
        assert 0 <= len(j["cards"]) <= 4
        allowed_cls = {"Stocks", "Options", "Futures", "Crypto"}
        for c in j["cards"]:
            for key in ("cls", "label", "score", "detail"):
                assert key in c, f"card missing {key}: {c}"
            assert c["cls"] in allowed_cls
            assert c["label"] in ("Bullish", "Bearish", "Neutral")
            assert isinstance(c["score"], (int, float))
            assert isinstance(c["detail"], str)

    def test_sentiment_free_402(self, free_headers):
        r = requests.get(f"{BASE_URL}/api/sentiment", headers=free_headers, timeout=15)
        assert r.status_code == 402, f"expected 402 for free, got {r.status_code} {r.text}"


# ---------- Phase 4: AI Coach + Insights ----------
class TestCoachAndInsights:
    def test_game_plan_premium(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/coach/game-plan",
                         headers=premium_headers, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert isinstance(j.get("game_plan"), str) and len(j["game_plan"].strip()) > 0
        assert "has_data" in j and isinstance(j["has_data"], bool)
        assert "gex_levels" in j and isinstance(j["gex_levels"], list)

    def test_game_plan_free_402(self, free_headers):
        r = requests.get(f"{BASE_URL}/api/coach/game-plan",
                         headers=free_headers, timeout=15)
        assert r.status_code == 402

    def test_emotion_insights(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/insights/emotion",
                         headers=premium_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "by_emotion" in j and isinstance(j["by_emotion"], list)
        assert "has_data" in j and isinstance(j["has_data"], bool)
        for row in j["by_emotion"]:
            for key in ("emotion", "trades", "pnl", "win_rate", "avg_pnl"):
                assert key in row, f"row missing {key}: {row}"
            assert isinstance(row["trades"], int)
            assert isinstance(row["pnl"], (int, float))
            assert isinstance(row["win_rate"], (int, float))
            assert isinstance(row["avg_pnl"], (int, float))

    def test_rule_streak(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/insights/streak",
                         headers=premium_headers, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        for key in ("current_streak", "best_streak", "total"):
            assert key in j, f"missing {key}"
            assert isinstance(j[key], int), f"{key} must be int, got {type(j[key])}"
        assert j["current_streak"] >= 0
        assert j["best_streak"] >= j["current_streak"] or j["best_streak"] >= 0


# ---------- Regressions ----------
class TestRegressions:
    def test_config(self):
        r = requests.get(f"{BASE_URL}/api/config", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "promo_active" in j and isinstance(j["promo_active"], bool)
        assert "discord_enabled" in j and isinstance(j["discord_enabled"], bool)

    def test_gex_premium(self, premium_headers):
        r = requests.get(f"{BASE_URL}/api/gex", headers=premium_headers, timeout=15)
        assert r.status_code == 200, r.text
        # accepts either a list or dict-with-snapshots
        j = r.json()
        assert isinstance(j, (list, dict))
