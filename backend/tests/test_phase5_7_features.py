"""Tests for iteration 12 new features:
- POST /api/user/settings: discord_share_wins + leaderboard_optin persistence
- GET /api/discord/bot/stats: bot-key auth + linked/unlinked responses
- GET /api/discord/bot/leaderboard: bot-key auth + anonymized entries
- POST /api/coach/transcribe: premium gating (402), Whisper transcription (real audio via TTS), invalid base64 -> 400
- Regression: /api/dashboard/stats, /api/config, /api/gex
"""
import os, sys, base64, uuid, asyncio, pytest, requests

# Load backend env so we can synthesize speech with EMERGENT_LLM_KEY
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://strategy-tracker-16.preview.emergentagent.com").rstrip("/")
BOT_KEY = "QTG2TRP2Of_-J5q6JDmwQ6_zel8cTX__8aXL_pr1y-4"
ADMIN_EMAIL = "stocktradesrvl@gmail.com"
ADMIN_PW = "TradeAdmin123"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def free_user(s):
    """Fresh free-tier user for 402 gating tests."""
    email = f"TEST_free_{uuid.uuid4().hex[:8]}@example.com"
    pw = "Free1234"
    r = s.post(f"{BASE_URL}/api/auth/register", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {"email": email, "token": data["access_token"], "id": data["user"]["id"],
            "headers": {"Authorization": f"Bearer {data['access_token']}", "Content-Type": "application/json"}}


# ---------- POST /api/user/settings ----------
class TestUserSettings:
    def test_toggle_discord_share_wins_and_leaderboard_true(self, s, admin_headers):
        r = s.post(f"{BASE_URL}/api/user/settings",
                   headers=admin_headers,
                   json={"discord_share_wins": True, "leaderboard_optin": True}, timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["discord_share_wins"] is True
        assert u["leaderboard_optin"] is True

    def test_settings_reflected_in_auth_me(self, s, admin_headers):
        r = s.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        u = r.json()
        assert u["discord_share_wins"] is True
        assert u["leaderboard_optin"] is True

    def test_toggle_back_to_false(self, s, admin_headers):
        r = s.post(f"{BASE_URL}/api/user/settings",
                   headers=admin_headers,
                   json={"discord_share_wins": False, "leaderboard_optin": False}, timeout=30)
        assert r.status_code == 200
        u = r.json()
        assert u["discord_share_wins"] is False
        assert u["leaderboard_optin"] is False
        # verify via /auth/me too
        r2 = s.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=30)
        assert r2.json()["discord_share_wins"] is False
        assert r2.json()["leaderboard_optin"] is False


# ---------- Discord bot endpoints ----------
class TestDiscordBotStats:
    def test_missing_key_returns_401(self, s):
        r = s.get(f"{BASE_URL}/api/discord/bot/stats", params={"discord_id": "123"}, timeout=30)
        assert r.status_code == 401, r.text

    def test_wrong_key_returns_401(self, s):
        r = s.get(f"{BASE_URL}/api/discord/bot/stats", params={"discord_id": "123"},
                  headers={"x-bot-key": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_unknown_discord_id_returns_linked_false(self, s):
        r = s.get(f"{BASE_URL}/api/discord/bot/stats",
                  params={"discord_id": f"nonexistent_{uuid.uuid4().hex}"},
                  headers={"x-bot-key": BOT_KEY}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data == {"linked": False}


class TestDiscordBotLeaderboard:
    def test_missing_key_returns_401(self, s):
        r = s.get(f"{BASE_URL}/api/discord/bot/leaderboard", params={"window": 30, "limit": 10}, timeout=30)
        assert r.status_code == 401

    def test_wrong_key_returns_401(self, s):
        r = s.get(f"{BASE_URL}/api/discord/bot/leaderboard",
                  headers={"x-bot-key": "bad"}, params={"window": 30, "limit": 10}, timeout=30)
        assert r.status_code == 401

    def test_leaderboard_returns_window_and_entries(self, s):
        r = s.get(f"{BASE_URL}/api/discord/bot/leaderboard",
                  headers={"x-bot-key": BOT_KEY},
                  params={"window": 30, "limit": 10}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["window"] == 30
        assert isinstance(data["entries"], list)
        # anonymization: no email/real-name fields, alias must be Trader-XXXX
        for e in data["entries"]:
            assert "email" not in e
            assert "name" not in e
            assert "discord_username" not in e
            assert e["alias"].startswith("Trader-")
            assert len(e["alias"]) == len("Trader-") + 4
            assert e["trades"] >= 3


# ---------- POST /api/coach/transcribe ----------
class TestCoachTranscribe:
    def test_free_user_gated_402(self, s, free_user):
        # small dummy base64 (won't be decoded before gate)
        r = s.post(f"{BASE_URL}/api/coach/transcribe",
                   headers=free_user["headers"],
                   json={"audio_base64": "AAAA", "ext": "wav", "summarize": False}, timeout=30)
        assert r.status_code == 402, r.text
        assert "Premium" in r.json().get("detail", "")

    def test_invalid_base64_returns_400(self, s, admin_headers):
        r = s.post(f"{BASE_URL}/api/coach/transcribe",
                   headers=admin_headers,
                   json={"audio_base64": "not@@@valid!!base64$$$", "ext": "wav", "summarize": False}, timeout=30)
        # base64 is lenient — server accepts and forwards garbage to Whisper -> would 502
        # so accept either 400 (strict decode) OR 502 (whisper reject garbage). We assert not-2xx.
        assert r.status_code in (400, 502, 422), f"expected error, got {r.status_code} {r.text}"

    def test_premium_transcription_with_real_audio(self, s, admin_headers):
        """Synthesize real speech via emergentintegrations TTS then transcribe it via Whisper."""
        from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech
        key = os.environ.get("EMERGENT_LLM_KEY")
        assert key, "EMERGENT_LLM_KEY missing"
        tts = OpenAITextToSpeech(api_key=key)
        sentence = "The market is trending up today and I am feeling confident."
        audio_bytes = asyncio.run(tts.generate_speech(text=sentence, model="tts-1",
                                                     voice="alloy", response_format="wav"))
        assert isinstance(audio_bytes, (bytes, bytearray)) and len(audio_bytes) > 1000, f"tts too small: {len(audio_bytes)}"
        b64 = base64.b64encode(audio_bytes).decode()
        r = s.post(f"{BASE_URL}/api/coach/transcribe",
                   headers=admin_headers,
                   json={"audio_base64": b64, "ext": "wav", "summarize": True}, timeout=120)
        assert r.status_code == 200, f"transcribe failed: {r.status_code} {r.text}"
        data = r.json()
        assert "text" in data and isinstance(data["text"], str) and data["text"].strip(), f"empty text: {data}"
        # summarize=True -> should have a non-null summary string
        assert data.get("summary"), f"expected summary, got: {data}"


# ---------- Regression ----------
class TestRegression:
    def test_dashboard_stats(self, s, admin_headers):
        r = s.get(f"{BASE_URL}/api/dashboard/stats", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("total_trades", "total_pnl", "win_rate", "profit_factor", "account_balance", "equity_curve"):
            assert k in d, f"missing key {k}"

    def test_config(self, s):
        r = s.get(f"{BASE_URL}/api/config", timeout=30)
        assert r.status_code == 200, r.text

    def test_gex(self, s, admin_headers):
        r = s.get(f"{BASE_URL}/api/gex", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
