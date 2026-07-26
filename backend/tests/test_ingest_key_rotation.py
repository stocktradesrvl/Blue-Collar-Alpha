"""Verification: POST /api/ingest/gex key rotation.

Confirms the endpoint is healthy after the GEX_INGEST_KEY rotation:
- CURRENT key (from /app/backend/.env)  -> 200 ok
- OLD retired key                       -> 401
- WRONG random key                      -> 401
- MISSING X-Ingest-Key header           -> 401
- Upsert reflects via GET /api/gex/SPY as premium
- Regression: GET /api/gex as premium returns SPY/SPX/XSP snapshots
"""
import os
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

_be = dotenv_values(Path("/app/backend/.env"))
_fe = dotenv_values(Path("/app/frontend/.env"))

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or _fe.get("EXPO_PUBLIC_BACKEND_URL")
    or ""
).rstrip("/")

CURRENT_KEY = _be.get("GEX_INGEST_KEY", "")
OLD_KEY = "iVThhbQTfE_gz61S32MHkzUJYgB7ErCuZqRLGMQQcx0"

PREMIUM_EMAIL = "stocktradesrvl@gmail.com"
PREMIUM_PASS = "TradeAdmin123"

SPY_PAYLOAD = {
    "symbol": "SPY",
    "spot": 512.34,
    "net_gex": -1_234_567_890,
    "flip_point": 508.0,
    "call_wall": 515.0,
    "put_wall": 505.0,
    "strikes": [
        {"strike": 500, "gex": -250_000_000, "call_oi": 12000, "put_oi": 30000},
        {"strike": 505, "gex": -100_000_000, "call_oi": 15000, "put_oi": 40000},
        {"strike": 510, "gex": 50_000_000,  "call_oi": 20000, "put_oi": 25000},
        {"strike": 515, "gex": 120_000_000, "call_oi": 18000, "put_oi": 15000},
    ],
}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def premium_token(api):
    r = api.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": PREMIUM_EMAIL, "password": PREMIUM_PASS},
    )
    assert r.status_code == 200, f"Premium login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


# ---------- Environment sanity ----------
def test_env_key_loaded():
    assert CURRENT_KEY, "GEX_INGEST_KEY missing from /app/backend/.env"
    assert CURRENT_KEY == "xnLvU3db1XiPxN6bfYs2U7Xc-Uczt1BCgpeIQXY4Vzw", (
        f"Unexpected CURRENT key value in .env: {CURRENT_KEY!r}"
    )
    assert CURRENT_KEY != OLD_KEY, "CURRENT key must not equal OLD retired key"


# ---------- Auth matrix for /api/ingest/gex ----------
class TestIngestKeyMatrix:
    def test_current_key_returns_200(self, api):
        r = api.post(
            f"{BASE_URL}/api/ingest/gex",
            json=SPY_PAYLOAD,
            headers={"X-Ingest-Key": CURRENT_KEY},
        )
        assert r.status_code == 200, f"Expected 200 with CURRENT key, got {r.status_code}: {r.text}"
        j = r.json()
        assert j.get("ok") is True, j
        assert j.get("symbol") == "SPY", j
        assert j.get("strikes") == len(SPY_PAYLOAD["strikes"]), j

    def test_old_retired_key_returns_401(self, api):
        r = api.post(
            f"{BASE_URL}/api/ingest/gex",
            json=SPY_PAYLOAD,
            headers={"X-Ingest-Key": OLD_KEY},
        )
        assert r.status_code == 401, (
            f"Expected 401 with OLD retired key, got {r.status_code}: {r.text}"
        )

    def test_random_wrong_key_returns_401(self, api):
        r = api.post(
            f"{BASE_URL}/api/ingest/gex",
            json=SPY_PAYLOAD,
            headers={"X-Ingest-Key": "totally-random-bogus-key-1234567890"},
        )
        assert r.status_code == 401, r.text

    def test_missing_header_returns_401(self, api):
        r = api.post(f"{BASE_URL}/api/ingest/gex", json=SPY_PAYLOAD)
        assert r.status_code == 401, r.text


# ---------- Upsert + premium read ----------
class TestUpsertAndRead:
    def test_upsert_reflects_in_gex_symbol_endpoint(self, api, premium_token):
        # Push a unique net_gex so we can verify the freshly-written row
        marker = -987_654_321
        payload = {**SPY_PAYLOAD, "net_gex": marker}
        r = api.post(
            f"{BASE_URL}/api/ingest/gex",
            json=payload,
            headers={"X-Ingest-Key": CURRENT_KEY},
        )
        assert r.status_code == 200, r.text

        rg = api.get(
            f"{BASE_URL}/api/gex/SPY",
            headers={"Authorization": f"Bearer {premium_token}"},
        )
        assert rg.status_code == 200, rg.text
        snap = rg.json()
        assert snap.get("symbol") == "SPY"
        assert snap.get("net_gex") == marker, snap
        # net_gex_history array present (per feature list)
        assert "net_gex_history" in snap, f"net_gex_history missing: keys={list(snap.keys())}"
        assert isinstance(snap["net_gex_history"], list), snap["net_gex_history"]
        assert "_id" not in snap, "Mongo _id must not leak"

    def test_premium_gex_list_returns_symbols(self, api, premium_token):
        r = api.get(
            f"{BASE_URL}/api/gex",
            headers={"Authorization": f"Bearer {premium_token}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("symbols") == ["SPY", "SPX", "XSP"], data.get("symbols")
        snaps = data.get("snapshots", [])
        assert isinstance(snaps, list)
        for s in snaps:
            assert "_id" not in s
