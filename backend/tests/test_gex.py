"""GEX Tracker & Options Heatmap - backend endpoint tests.

Covers:
- POST /api/ingest/gex (ingest-key auth, symbol validation, upsert)
- GET /api/gex (premium gating, no _id leak)
- GET /api/gex/{symbol} (premium gating, 404, 401)
- /api/config regression (discord_enabled, promo_active)
- Core auth regression (login for premium)
"""
import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import dotenv_values

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to frontend/.env public url
    fe = dotenv_values(Path("/app/frontend/.env"))
    BASE_URL = (fe.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")

# Load GEX_INGEST_KEY from backend/.env
_be = dotenv_values(Path("/app/backend/.env"))
GEX_KEY = _be.get("GEX_INGEST_KEY", "")

PREMIUM_EMAIL = "stocktradesrvl@gmail.com"
PREMIUM_PASS = "TradeAdmin123"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def premium_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": PREMIUM_EMAIL, "password": PREMIUM_PASS})
    assert r.status_code == 200, f"Premium login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("user", {}).get("subscription_tier") == "premium", data
    return data["access_token"]


@pytest.fixture(scope="module")
def free_token(api):
    email = f"TEST_gexfree_{uuid.uuid4().hex[:8]}@example.com"
    r = api.post(f"{BASE_URL}/api/auth/register",
                 json={"email": email, "password": "TestPass123"})
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


SPY_PAYLOAD = {
    "symbol": "SPY",
    "spot": 512.34,
    "net_gex": -1_230_000_000,
    "flip_point": 508.0,
    "call_wall": 515.0,
    "put_wall": 505.0,
    "strikes": [
        {"strike": 500, "gex": -250_000_000, "call_oi": 12000, "put_oi": 30000},
        {"strike": 505, "gex": -100_000_000, "call_oi": 15000, "put_oi": 40000},
        {"strike": 510, "gex": 50_000_000, "call_oi": 20000, "put_oi": 25000},
    ],
}


# ---------- POST /api/ingest/gex ----------
class TestIngestAuth:
    def test_ingest_missing_header_401(self, api):
        r = api.post(f"{BASE_URL}/api/ingest/gex", json=SPY_PAYLOAD)
        assert r.status_code == 401, r.text

    def test_ingest_wrong_key_401(self, api):
        r = api.post(f"{BASE_URL}/api/ingest/gex", json=SPY_PAYLOAD,
                     headers={"X-Ingest-Key": "wrong-key"})
        assert r.status_code == 401, r.text

    def test_ingest_valid_returns_ok_and_strike_count(self, api):
        r = api.post(f"{BASE_URL}/api/ingest/gex", json=SPY_PAYLOAD,
                     headers={"X-Ingest-Key": GEX_KEY})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("symbol") == "SPY"
        assert j.get("strikes") == len(SPY_PAYLOAD["strikes"])

    def test_ingest_unsupported_symbol_400(self, api):
        bad = {**SPY_PAYLOAD, "symbol": "QQQ"}
        r = api.post(f"{BASE_URL}/api/ingest/gex", json=bad,
                     headers={"X-Ingest-Key": GEX_KEY})
        assert r.status_code == 400, r.text


class TestIngestUpsert:
    def test_ingest_is_upsert(self, api, premium_token):
        # push initial value
        p1 = {**SPY_PAYLOAD, "net_gex": -1_111_111_111}
        r1 = api.post(f"{BASE_URL}/api/ingest/gex", json=p1,
                      headers={"X-Ingest-Key": GEX_KEY})
        assert r1.status_code == 200
        # push updated value
        p2 = {**SPY_PAYLOAD, "net_gex": 2_222_222_222}
        r2 = api.post(f"{BASE_URL}/api/ingest/gex", json=p2,
                      headers={"X-Ingest-Key": GEX_KEY})
        assert r2.status_code == 200
        # GET should return only the latest
        rg = api.get(f"{BASE_URL}/api/gex/SPY",
                     headers={"Authorization": f"Bearer {premium_token}"})
        assert rg.status_code == 200, rg.text
        snap = rg.json()
        assert snap["net_gex"] == 2_222_222_222, snap

        # Also make sure /api/gex returns SPY only once
        rall = api.get(f"{BASE_URL}/api/gex",
                       headers={"Authorization": f"Bearer {premium_token}"})
        assert rall.status_code == 200
        snaps = rall.json().get("snapshots", [])
        spy_snaps = [s for s in snaps if s.get("symbol") == "SPY"]
        assert len(spy_snaps) == 1, spy_snaps


# ---------- GET /api/gex gating ----------
class TestGexGating:
    def test_free_user_402(self, api, free_token):
        r = api.get(f"{BASE_URL}/api/gex",
                    headers={"Authorization": f"Bearer {free_token}"})
        assert r.status_code == 402, r.text

    def test_no_auth_401(self, api):
        r = api.get(f"{BASE_URL}/api/gex/SPY")
        assert r.status_code == 401, r.text

    def test_free_user_symbol_402(self, api, free_token):
        r = api.get(f"{BASE_URL}/api/gex/SPY",
                    headers={"Authorization": f"Bearer {free_token}"})
        assert r.status_code == 402, r.text


class TestGexPremium:
    def test_premium_gets_all(self, api, premium_token):
        # ensure SPY exists first
        api.post(f"{BASE_URL}/api/ingest/gex", json=SPY_PAYLOAD,
                 headers={"X-Ingest-Key": GEX_KEY})
        r = api.get(f"{BASE_URL}/api/gex",
                    headers={"Authorization": f"Bearer {premium_token}"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("symbols") == ["SPY", "SPX", "XSP"]
        snaps = data.get("snapshots", [])
        assert isinstance(snaps, list)
        for s in snaps:
            assert "_id" not in s, f"Mongo _id leaked: {s.keys()}"
            assert "symbol" in s
        # At least SPY should be present
        assert any(s.get("symbol") == "SPY" for s in snaps)

    def test_premium_gets_spy_snapshot(self, api, premium_token):
        r = api.get(f"{BASE_URL}/api/gex/SPY",
                    headers={"Authorization": f"Bearer {premium_token}"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("symbol") == "SPY"
        assert "_id" not in d
        assert isinstance(d.get("strikes"), list)
        assert len(d["strikes"]) >= 1
        strike = d["strikes"][0]
        assert "strike" in strike and "gex" in strike

    def test_unknown_symbol_404(self, api, premium_token):
        r = api.get(f"{BASE_URL}/api/gex/QQQ",
                    headers={"Authorization": f"Bearer {premium_token}"})
        assert r.status_code == 404, r.text


# ---------- Regression ----------
class TestRegression:
    def test_config_endpoint(self, api):
        r = api.get(f"{BASE_URL}/api/config")
        assert r.status_code == 200
        j = r.json()
        assert "discord_enabled" in j
        assert "promo_active" in j

    def test_core_auth_login(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": PREMIUM_EMAIL, "password": PREMIUM_PASS})
        assert r.status_code == 200
        j = r.json()
        assert "access_token" in j
        assert j.get("user", {}).get("email") == PREMIUM_EMAIL
