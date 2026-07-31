"""Tests for POST /api/user/delete-account (Play Store required in-app account deletion).

Coverage:
- Requires auth (401 without token)
- Wrong password -> 400
- Missing password -> 400
- Correct password -> {ok: true}, user + associated data purged, login now fails
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://strategy-tracker-16.preview.emergentagent.com").rstrip("/")


def _register(email: str, password: str = "TestPass123!"):
    r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"register failed {r.status_code} {r.text}"
    return r.json()["access_token"]


def _login(email: str, password: str):
    return requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)


def _uniq_email():
    return f"TEST_del_{uuid.uuid4().hex[:10]}@example.com"


class TestDeleteAccount:
    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/user/delete-account", json={"password": "x"}, timeout=15)
        assert r.status_code == 401, f"expected 401 without auth, got {r.status_code}"

    def test_wrong_password_400(self):
        email = _uniq_email()
        pw = "GoodPass123!"
        token = _register(email, pw)
        r = requests.post(
            f"{BASE_URL}/api/user/delete-account",
            json={"password": "WrongPass999"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert r.status_code == 400
        # cleanup - actually delete
        requests.post(
            f"{BASE_URL}/api/user/delete-account",
            json={"password": pw},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )

    def test_missing_password_400(self):
        email = _uniq_email()
        pw = "GoodPass123!"
        token = _register(email, pw)
        r = requests.post(
            f"{BASE_URL}/api/user/delete-account",
            json={},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert r.status_code == 400
        # cleanup
        requests.post(
            f"{BASE_URL}/api/user/delete-account",
            json={"password": pw},
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )

    def test_delete_account_success_purges_data(self):
        email = _uniq_email()
        pw = "GoodPass123!"
        token = _register(email, pw)
        headers = {"Authorization": f"Bearer {token}"}

        # create a strategy to verify purge
        sr = requests.post(
            f"{BASE_URL}/api/strategies",
            json={"name": "TEST_del_strat", "risk_pct": 1.0, "rules": ["r1"]},
            headers=headers,
            timeout=15,
        )
        assert sr.status_code == 200, f"strategy create failed {sr.status_code} {sr.text}"
        strat_id = sr.json()["id"]
        assert strat_id

        # verify strategy exists
        ls = requests.get(f"{BASE_URL}/api/strategies", headers=headers, timeout=15)
        assert ls.status_code == 200
        assert any(s.get("id") == strat_id for s in ls.json())

        # delete account
        dr = requests.post(
            f"{BASE_URL}/api/user/delete-account",
            json={"password": pw},
            headers=headers,
            timeout=20,
        )
        assert dr.status_code == 200, f"delete failed {dr.status_code} {dr.text}"
        body = dr.json()
        assert body.get("ok") is True

        # login should now fail (user gone)
        lr = _login(email, pw)
        assert lr.status_code == 401, f"expected 401 after deletion, got {lr.status_code}"

        # old token should no longer resolve to a user
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15)
        assert me.status_code == 401

        # strategies list with old token should be 401 (user_not_found path)
        ls2 = requests.get(f"{BASE_URL}/api/strategies", headers=headers, timeout=15)
        assert ls2.status_code == 401

    def test_admin_account_not_touched_by_test_suite(self):
        """Sanity: seeded admin still logs in — we never delete this account."""
        r = _login("stocktradesrvl@gmail.com", "TradeAdmin123")
        assert r.status_code == 200, f"admin login broken: {r.status_code} {r.text}"
        assert r.json().get("user", {}).get("email") == "stocktradesrvl@gmail.com"
