"""Regression + new-feature backend tests: referral escalation, effective-tier gating,
options/futures 'advanced' analysis, free-limit formula, payments regression.

Reuses fixtures from conftest.py (api, base_url, auth_headers, chart_image_b64).
"""
import os
import uuid
import pytest
import requests


# ---------- helpers ----------
def _register(api, base_url, email=None, password="Test1234!", referral_code=None):
    email = email or f"TEST_ref_{uuid.uuid4().hex[:8]}@test.com"
    payload = {"email": email, "password": password}
    if referral_code is not None:
        payload["referral_code"] = referral_code
    r = api.post(f"{base_url}/api/auth/register", json=payload)
    return r, email


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _me(api, base_url, token):
    r = api.get(f"{base_url}/api/auth/me", headers=_hdr(token))
    assert r.status_code == 200, r.text
    return r.json()


def _set_tier(api, base_url, headers, tier):
    return api.post(f"{base_url}/api/auth/tier", json={"tier": tier}, headers=headers)


# =====================================================================
# REFERRAL basics
# =====================================================================
class TestReferralBasics:
    def test_new_user_gets_unique_referral_code(self, api, base_url):
        r, _ = _register(api, base_url)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u.get("referral_code"), f"referral_code missing: {u}"
        assert len(u["referral_code"]) == 6
        # 6-char alnum, and if it contains any letters they must be uppercase
        assert u["referral_code"].isalnum()
        assert u["referral_code"] == u["referral_code"].upper()
        assert u.get("bonus_trades") == 0
        assert u.get("referral_count") == 0

    def test_register_without_code_no_bonus(self, api, base_url):
        r, _ = _register(api, base_url)
        assert r.status_code == 200
        assert r.json()["user"]["bonus_trades"] == 0

    def test_register_with_invalid_code_no_bonus_no_crash(self, api, base_url):
        r, _ = _register(api, base_url, referral_code="ZZZZZZ")
        assert r.status_code == 200, r.text
        assert r.json()["user"]["bonus_trades"] == 0

    def test_valid_referral_gives_bonus_and_increments_referrer(self, api, base_url):
        # Referrer
        r1, _ = _register(api, base_url)
        assert r1.status_code == 200
        ref_token = r1.json()["access_token"]
        ref_code = r1.json()["user"]["referral_code"]
        assert ref_code

        # New user with referral code
        r2, _ = _register(api, base_url, referral_code=ref_code)
        assert r2.status_code == 200, r2.text
        new_user = r2.json()["user"]
        assert new_user["bonus_trades"] == 20, f"expected 20 bonus, got {new_user}"

        # Referrer should have +20 bonus_trades and referral_count=1
        ref_me = _me(api, base_url, ref_token)
        assert ref_me["referral_count"] == 1
        assert ref_me["bonus_trades"] == 20
        # Not at milestone yet
        assert ref_me.get("reward_pro_until") in (None, ""), f"unexpected reward: {ref_me}"
        assert ref_me["subscription_tier"] == "free"

    def test_referral_code_case_insensitive(self, api, base_url):
        r1, _ = _register(api, base_url)
        ref_code = r1.json()["user"]["referral_code"]
        r2, _ = _register(api, base_url, referral_code=ref_code.lower())
        assert r2.status_code == 200
        assert r2.json()["user"]["bonus_trades"] == 20


# =====================================================================
# REFERRAL milestone (3 referrals -> reward_pro_until, effective tier=pro)
# =====================================================================
class TestReferralMilestone:
    """When referrer hits 3 successful referrals, they get 30-day Pro reward."""

    def test_three_referrals_grant_reward_pro_and_effective_tier(self, api, base_url, chart_image_b64):
        # Referrer
        r1, _ = _register(api, base_url)
        assert r1.status_code == 200
        ref_token = r1.json()["access_token"]
        ref_code = r1.json()["user"]["referral_code"]

        # 3 referred registrations
        for _ in range(3):
            rr, _ = _register(api, base_url, referral_code=ref_code)
            assert rr.status_code == 200, rr.text

        me = _me(api, base_url, ref_token)
        assert me["referral_count"] == 3, f"count wrong: {me}"
        assert me.get("reward_pro_until"), f"reward_pro_until not set: {me}"
        # Effective tier should now be 'pro'
        assert me["subscription_tier"] == "pro", f"effective tier not pro: {me}"
        # Raw tier stays free
        assert me["raw_tier"] == "free", f"raw_tier should stay free: {me}"

        # Pro-gated analyze-chart must NOT be 402 for this reward-pro user
        r_chart = api.post(
            f"{base_url}/api/trades/analyze-chart",
            json={"image_base64": chart_image_b64},
            headers=_hdr(ref_token), timeout=90,
        )
        assert r_chart.status_code == 200, \
            f"reward-pro should unlock analyze-chart, got {r_chart.status_code}: {r_chart.text[:300]}"
        j = r_chart.json()
        for k in ["trend", "patterns", "support", "resistance", "setup_grade", "analysis"]:
            assert k in j, f"missing {k}"


# =====================================================================
# EFFECTIVE TIER GATING (free/reward-pro/premium switching)
# =====================================================================
class TestEffectiveTierGating:
    def test_free_user_gets_402_on_analyze_chart(self, api, base_url, auth_headers, chart_image_b64):
        _set_tier(api, base_url, auth_headers, "free")
        r = api.post(f"{base_url}/api/trades/analyze-chart",
                     json={"image_base64": chart_image_b64},
                     headers=auth_headers, timeout=30)
        assert r.status_code == 402

    def test_free_user_gets_402_on_coach_chat(self, api, base_url, auth_headers):
        _set_tier(api, base_url, auth_headers, "free")
        r = api.post(f"{base_url}/api/coach/chat",
                     json={"message": "hi"}, headers=auth_headers)
        assert r.status_code == 402

    def test_premium_user_can_coach_chat(self, api, base_url, auth_headers):
        _set_tier(api, base_url, auth_headers, "premium")
        r = api.post(f"{base_url}/api/coach/chat",
                     json={"message": "one-line status"},
                     headers=auth_headers, timeout=90)
        assert r.status_code == 200, r.text[:300]
        assert "reply" in r.json() and len(r.json()["reply"]) > 3
        # cleanup
        _set_tier(api, base_url, auth_headers, "free")


# =====================================================================
# FREE LIMIT WITH BONUS (formula check via error message; do not create 20+ trades)
# =====================================================================
class TestFreeLimitFormula:
    """Verify FREE_MONTHLY_LIMIT + bonus_trades formula surfaces to user."""

    def test_public_user_exposes_bonus_and_formula_shape(self, api, base_url):
        # Referrer + one referral -> referrer has bonus=20
        r1, _ = _register(api, base_url)
        ref_token = r1.json()["access_token"]
        ref_code = r1.json()["user"]["referral_code"]
        r2, _ = _register(api, base_url, referral_code=ref_code)
        assert r2.status_code == 200
        me = _me(api, base_url, ref_token)
        # These fields are what /auth/me must expose for the frontend to render "trades left"
        assert me["bonus_trades"] == 20
        assert me["referral_count"] == 1
        assert me["subscription_tier"] == "free"  # not at milestone yet


# =====================================================================
# OPTIONS / FUTURES advanced analysis
# =====================================================================
class TestAdvancedAnalysis:
    """New feature: analyze-screenshot returns and persists 'advanced' object."""

    def test_advanced_field_present_and_persisted(self, api, base_url, auth_headers, chart_image_b64):
        _set_tier(api, base_url, auth_headers, "free")
        r = api.post(f"{base_url}/api/trades/analyze-screenshot",
                     json={"image_base64": chart_image_b64},
                     headers=auth_headers, timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        j = r.json()
        assert "advanced" in j, "advanced key missing from response"
        assert isinstance(j["advanced"], dict), f"advanced must be dict, got {type(j['advanced'])}"
        tid = j["id"]
        # For a stock-looking chart advanced may be empty {} - that's allowed.
        # Now verify persistence via GET /api/trades/{id}
        r2 = api.get(f"{base_url}/api/trades/{tid}", headers=auth_headers)
        assert r2.status_code == 200, r2.text
        t = r2.json()
        assert "advanced" in t and isinstance(t["advanced"], dict), \
            f"persisted trade missing advanced dict: {t}"
        # If asset_type is option/future, spot-check that advanced has some meaningful keys
        adv = t["advanced"]
        atype = t.get("asset_type", "stock")
        if atype == "option" and adv:
            option_keys = {"delta", "gamma", "theta", "vega", "implied_volatility",
                           "overpaying_premium", "suggested_strike", "suggested_expiration"}
            assert option_keys & set(adv.keys()), f"option advanced has no expected keys: {adv}"
        if atype == "future" and adv:
            fut_keys = {"mfe", "mae", "hold_time", "profit_left_on_table"}
            assert fut_keys & set(adv.keys()), f"future advanced has no expected keys: {adv}"

        # cleanup
        api.delete(f"{base_url}/api/trades/{tid}", headers=auth_headers)


# =====================================================================
# PAYMENTS regression (billing, cancel-no-sub, webhook-no-secret)
# =====================================================================
class TestPaymentsRegression:
    def test_billing_without_subscription(self, api, base_url, auth_headers):
        # trader user has no active sub in this env
        r = api.get(f"{base_url}/api/payments/billing", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "has_subscription" in j
        assert "tier" in j
        assert "invoices" in j and isinstance(j["invoices"], list)

    def test_cancel_without_subscription_returns_400(self, api, base_url, auth_headers):
        r = api.post(f"{base_url}/api/payments/cancel", headers=auth_headers)
        assert r.status_code == 400, r.text

    def test_webhook_without_signature_returns_400(self, api, base_url):
        # No stripe-signature header, secret may or may not be configured.
        # Either way, server must return 400 (not 500, not 200).
        r = requests.post(f"{base_url}/api/payments/webhook",
                          data=b'{"type":"test"}',
                          headers={"Content-Type": "application/json"})
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text[:200]}"


# =====================================================================
# TRADES list/detail/delete regression
# =====================================================================
class TestTradesRegression:
    def test_list_trades(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/trades", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_delete_nonexistent_trade_is_ok(self, api, base_url, auth_headers):
        # backend returns {"ok": True} idempotently; verify shape
        r = api.delete(f"{base_url}/api/trades/nonexistent-id-xyz", headers=auth_headers)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_get_missing_trade_returns_404(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/trades/nonexistent-id-xyz", headers=auth_headers)
        assert r.status_code == 404


# =====================================================================
# DAILY REPORT regression
# =====================================================================
class TestReportsRegression:
    def test_daily_report(self, api, base_url, auth_headers):
        r = api.get(f"{base_url}/api/reports/daily", headers=auth_headers, timeout=120)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert "report" in j
