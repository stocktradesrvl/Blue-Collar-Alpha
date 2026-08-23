from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Header, Query
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, json, uuid, re, httpx, hashlib, asyncio, base64, tempfile, hmac, html as _html, time, secrets
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from collections import defaultdict, deque
import bcrypt
from jose import jwt, JWTError
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech
from discord_bot import build_client as _build_discord_client

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
JWT_SECRET = os.environ.get('JWT_SECRET') or ''
if not JWT_SECRET or len(JWT_SECRET) < 16:
    raise RuntimeError("JWT_SECRET is missing or too weak. Set a strong JWT_SECRET in the environment.")
import stripe
from fastapi import Request
from fastapi.responses import HTMLResponse
from urllib.parse import quote, urlencode, urlparse
stripe.api_key = os.environ.get('STRIPE_SECRET_KEY', '')
BACKEND_URL = os.environ.get('EXPO_BACKEND_URL') or ''

# ---------- Discord config ----------
DISCORD_CLIENT_ID = os.environ.get('DISCORD_CLIENT_ID', '')
DISCORD_CLIENT_SECRET = os.environ.get('DISCORD_CLIENT_SECRET', '')
DISCORD_BOT_TOKEN = os.environ.get('DISCORD_BOT_TOKEN', '')
DISCORD_GUILD_ID = os.environ.get('DISCORD_GUILD_ID', '')
DISCORD_ROLE_ID = os.environ.get('DISCORD_ROLE_ID', '')
DISCORD_WINS_CHANNEL_ID = os.environ.get('DISCORD_WINS_CHANNEL_ID', '')
DISCORD_BOT_KEY = os.environ.get('DISCORD_BOT_KEY', '')
DISCORD_API = "https://discord.com/api/v10"
DISCORD_OAUTH_AUTHORIZE = "https://discord.com/api/oauth2/authorize"

# ---------- GEX ingest config ----------
GEX_INGEST_KEY = os.environ.get('GEX_INGEST_KEY', '')
GEX_SYMBOLS = ["SPY", "SPX", "XSP"]

# ---------- Resend (weekly digest emails) ----------
import resend
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
RESEND_FROM_EMAIL = os.environ.get('RESEND_FROM_EMAIL', '')
PUBLIC_APP_URL = os.environ.get('PUBLIC_APP_URL', '').rstrip('/')
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY
# Fixed server-side pricing (never trust client amounts). Amounts in cents.
# Launch promo: discounted first month via a one-time Stripe coupon.
# Promo auto-expires at the end of Aug 10, 2026 (UTC).
PROMO_END = datetime(2026, 8, 11, 0, 0, 0, tzinfo=timezone.utc)

def promo_active() -> bool:
    return datetime.now(timezone.utc) < PROMO_END

# ---------- Safe redirect (prevents reflected XSS / open redirect on return pages) ----------
_APP_SCHEME = (os.environ.get('APP_SCHEME') or 'frontend').lower()
_BLOCKED_SCHEMES = {"javascript", "data", "vbscript", "file"}

def _redirect_target_ok(url: str) -> bool:
    """Allow only safe return targets: the app's own deep-link scheme, exp(s)://,
    or http(s):// pointing at our own known host. Blocks javascript:/data: etc."""
    try:
        p = urlparse(url)
    except Exception:
        return False
    scheme = (p.scheme or "").lower()
    if not scheme or scheme in _BLOCKED_SCHEMES:
        return False
    if scheme in (_APP_SCHEME, "exp", "exps"):
        return True
    if scheme in ("http", "https"):
        host = (p.hostname or "").lower()
        allowed = set()
        for src in (PUBLIC_APP_URL, BACKEND_URL):
            if src:
                h = urlparse(src).hostname
                if h:
                    allowed.add(h.lower())
        # Allow Emergent preview/app hosts by suffix so the web preview keeps working.
        if host in allowed or host.endswith(".emergentagent.com") or host.endswith(".emergent.host"):
            return True
        return False
    return False

def _safe_redirect_response(rt: str, params: dict, ok_msg: str, accent: str = "#5865F2") -> HTMLResponse:
    """Build a redirect page with the target properly encoded for both HTML and JS
    contexts. Falls back to a plain 'return to the app' page for unsafe targets."""
    if not rt or not _redirect_target_ok(rt):
        return HTMLResponse(
            "<html><body style='background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding-top:80px'>"
            f"<p>{_html.escape(ok_msg)} You can close this window and return to the app.</p></body></html>")
    sep = "&" if "?" in rt else "?"
    target = rt + sep + urlencode(params)
    attr = _html.escape(target, quote=True)          # safe inside HTML attributes
    js = (json.dumps(target).replace("<", "\\u003c")  # safe inside a <script> JS string
          .replace(">", "\\u003e").replace("&", "\\u0026"))
    return HTMLResponse(f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url={attr}"><title>Redirecting…</title></head>
<body style="background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding-top:80px">
<p>{_html.escape(ok_msg)} Returning to the app…</p>
<a href="{attr}" style="color:{accent}">Tap here if not redirected</a>
<script>window.location.href={js};</script></body></html>""")


STRIPE_PACKAGES = {
    "pro": {"name": "Blue Collar Alpha Pro", "amount": 1499, "promo_amount": 999, "trial_days": 0, "interval": "month", "base": "pro"},
    "premium": {"name": "Blue Collar Alpha Premium", "amount": 2499, "promo_amount": 1999, "trial_days": 7, "interval": "month", "base": "premium"},
    "pro_annual": {"name": "Blue Collar Alpha Pro (Annual)", "amount": 16489, "trial_days": 0, "interval": "year", "base": "pro"},
    "premium_annual": {"name": "Blue Collar Alpha Premium (Annual)", "amount": 27489, "trial_days": 7, "interval": "year", "base": "premium"},
}
_promo_coupons: dict = {}  # cache: off_cents -> coupon id
ALGO = "HS256"
TIER_LEVEL = {"free": 0, "pro": 1, "premium": 2}
FREE_MONTHLY_LIMIT = 20
REFERRAL_MILESTONE = 3          # invite 3 friends -> free month of Pro
REWARD_PRO_DAYS = 30
REFERRAL_TIERS = {3: 30, 5: 60, 10: 120}   # invites -> days of free Pro (escalating)
TRIAL_DAYS = 7               # self-serve free Premium trial length
UPSELL_MIN_MONTHS = 2        # months on monthly billing before the annual upsell shows

app = FastAPI()
api = APIRouter(prefix="/api")


@app.get("/health")
async def health():
    """Unauthenticated liveness probe for the deployment platform (K8s)."""
    return {"status": "ok"}

oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# ---------- Auth helpers ----------
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def make_token(uid: str) -> str:
    payload = {"sub": uid, "exp": datetime.now(timezone.utc) + timedelta(days=30)}
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGO)

async def get_current_user(token: str = Depends(oauth2)):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGO])
        uid = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.users.find_one({"id": uid})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ---------- Lightweight in-memory rate limiter (single-worker) ----------
_rl_hits: dict = defaultdict(deque)

def _rate_ok(key: str, max_hits: int, window: int) -> bool:
    now = time.monotonic()
    dq = _rl_hits[key]
    while dq and now - dq[0] > window:
        dq.popleft()
    if not dq and key in _rl_hits:
        # keep the map from growing unbounded once a bucket goes idle
        pass
    if len(dq) >= max_hits:
        return False
    dq.append(now)
    return True

def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

async def auth_rate_limit(request: Request):
    """Brute-force guard on auth endpoints: max 20 attempts / 5 min per IP."""
    if not _rate_ok(f"auth:{_client_ip(request)}", 20, 300):
        raise HTTPException(status_code=429, detail="Too many attempts. Please wait a minute and try again.")

def enforce_ai_limit(user: dict):
    """Cost/abuse guard on AI endpoints: max 40 requests / min per user."""
    if not _rate_ok(f"ai:{user['id']}", 40, 60):
        raise HTTPException(status_code=429, detail="You're going a bit fast — please wait a moment and try again.")

def effective_tier(u: dict) -> str:
    base = u.get("subscription_tier", "free")
    now = datetime.now(timezone.utc)
    rp = u.get("reward_pro_until")
    if rp:
        try:
            if datetime.fromisoformat(rp) > now and TIER_LEVEL[base] < 1:
                base = "pro"
        except Exception:
            pass
    # Self-serve free Premium trial (no card) — grants Premium until it expires, then auto-downgrades.
    tp = u.get("trial_premium_until")
    if tp:
        try:
            if datetime.fromisoformat(tp) > now and TIER_LEVEL[base] < 2:
                base = "premium"
        except Exception:
            pass
    return base

def public_user(u: dict) -> dict:
    return {"id": u["id"], "email": u["email"], "subscription_tier": effective_tier(u),
            "raw_tier": u.get("subscription_tier", "free"),
            "account_balance": u.get("account_balance", 10000),
            "referral_code": u.get("referral_code"), "bonus_trades": u.get("bonus_trades", 0),
            "referral_count": u.get("referral_count", 0), "reward_pro_until": u.get("reward_pro_until"),
            "trial_premium_until": u.get("trial_premium_until"), "trial_used": bool(u.get("trial_used", False)),
            "daily_loss_limit": u.get("daily_loss_limit", 0),
            "weekly_digest_enabled": u.get("weekly_digest_enabled", True),
            "discord_share_wins": u.get("discord_share_wins", False),
            "leaderboard_optin": u.get("leaderboard_optin", False),
            "discord_id": u.get("discord_id"), "discord_username": u.get("discord_username")}

def gen_referral_code() -> str:
    return uuid.uuid4().hex[:6].upper()

REFERRAL_BONUS = 20

# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    referral_code: Optional[str] = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class StrategyIn(BaseModel):
    name: str
    risk_pct: float = 1.0
    rules: List[str] = []

class TierIn(BaseModel):
    tier: str

class ScreenshotIn(BaseModel):
    image_base64: str
    strategy_id: Optional[str] = None
    strategy_ids: Optional[List[str]] = None
    taken: bool = True
    pending: bool = False
    preview: bool = False   # analyze only, don't save (used by the share-to-notify flow)

class PreTradeIn(BaseModel):
    image_base64: str
    strategy_ids: Optional[List[str]] = None

class ChatIn(BaseModel):
    message: str

class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str

class BalanceIn(BaseModel):
    balance: float

class TakenIn(BaseModel):
    taken: bool

# ---------- LLM helpers ----------
def llm(system: str, session_id: str, max_tokens: int = 1500):
    return LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id,
                   system_message=system).with_model("anthropic", "claude-sonnet-4-6").with_params(max_tokens=max_tokens)

def extract_json(text: str):
    text = text.strip()
    m = re.search(r'\{.*\}', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return None

# ---------- Auth routes ----------
@api.post("/auth/register")
async def register(inp: RegisterIn, _rl=Depends(auth_rate_limit)):
    if await db.users.find_one({"email": inp.email.lower()}):
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = str(uuid.uuid4())
    bonus = 0
    referred_by = None
    if inp.referral_code:
        code = inp.referral_code.strip().upper()
        referrer = await db.users.find_one({"referral_code": code})
        if referrer:
            bonus = REFERRAL_BONUS
            referred_by = referrer["id"]
            new_count = referrer.get("referral_count", 0) + 1
            upd = {"$inc": {"bonus_trades": REFERRAL_BONUS, "referral_count": 1}}
            # Tiered milestones: escalating free Pro time as they invite more friends.
            if new_count in REFERRAL_TIERS:
                until = datetime.now(timezone.utc) + timedelta(days=REFERRAL_TIERS[new_count])
                upd["$set"] = {"reward_pro_until": until.isoformat()}
            await db.users.update_one({"id": referrer["id"]}, upd)
    doc = {"id": uid, "email": inp.email.lower(), "password_hash": hash_pw(inp.password),
           "subscription_tier": "free", "account_balance": 10000,
           "referral_code": gen_referral_code(), "bonus_trades": bonus,
           "referral_count": 0, "referred_by": referred_by,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.users.insert_one(doc)
    return {"access_token": make_token(uid), "token_type": "bearer", "user": public_user(doc)}

@api.post("/auth/login")
async def login(inp: LoginIn, _rl=Depends(auth_rate_limit)):
    u = await db.users.find_one({"email": inp.email.lower()})
    if not u or not verify_pw(inp.password, u["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"access_token": make_token(u["id"]), "token_type": "bearer", "user": public_user(u)}

@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    if not user.get("referral_code"):
        code = gen_referral_code()
        await db.users.update_one({"id": user["id"]}, {"$set": {"referral_code": code}})
        user["referral_code"] = code
    return public_user(user)

@api.post("/auth/tier")
async def set_tier(inp: TierIn, user=Depends(get_current_user)):
    # Users may only DOWNGRADE to free here. Paid tiers are granted exclusively by
    # verified Stripe events (/payments/status + webhook) — never by client request.
    if inp.tier != "free":
        raise HTTPException(status_code=403, detail="Paid tiers can only be activated through checkout.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"subscription_tier": "free"}})
    u = await db.users.find_one({"id": user["id"]})
    return public_user(u)

@api.post("/auth/change-password")
async def change_password(inp: ChangePasswordIn, user=Depends(get_current_user)):
    if not verify_pw(inp.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(inp.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    if inp.current_password == inp.new_password:
        raise HTTPException(status_code=400, detail="New password must be different from current")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_pw(inp.new_password)}})
    return {"ok": True}

# ---------- Forgot / reset password (opaque single-use code, emailed via Resend) ----------
class ResetRequestIn(BaseModel):
    email: EmailStr

class ResetConfirmIn(BaseModel):
    email: EmailStr
    code: str
    new_password: str

def _code_digest(email: str, code: str) -> str:
    return hashlib.sha256(f"{email.lower()}:{code.upper()}".encode()).hexdigest()

@api.post("/auth/password-reset/request", status_code=202)
async def password_reset_request(inp: ResetRequestIn, request: Request):
    # Rate-limit by IP to prevent abuse; always return the same response (no enumeration).
    if not _rate_ok(f"pwreset:{_client_ip(request)}", 10, 900):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait a few minutes.")
    email = inp.email.lower().strip()
    generic = {"message": "If an account exists for that email, a reset code has been sent."}
    user = await db.users.find_one({"email": email})
    if not user or not (RESEND_API_KEY and RESEND_FROM_EMAIL):
        return generic
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    await db.password_resets.delete_many({"user_id": user["id"]})
    await db.password_resets.insert_one({
        "user_id": user["id"], "email": email, "code_hash": _code_digest(email, code),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat()})
    try:
        resend.Emails.send({
            "from": RESEND_FROM_EMAIL, "to": [email],
            "subject": "Your Blue Collar Alpha password reset code",
            "html": (f"<p>Your password reset code is:</p>"
                     f"<p style='font-size:28px;font-weight:bold;letter-spacing:4px'>{code}</p>"
                     f"<p>Enter it in the app to set a new password. It expires in 20 minutes.</p>"
                     f"<p>If you didn't request this, you can ignore this email.</p>")})
    except Exception as e:
        logger.error(f"password reset email err {e}")
    return generic

@api.post("/auth/password-reset/confirm")
async def password_reset_confirm(inp: ResetConfirmIn):
    if len(inp.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    email = inp.email.lower().strip()
    rec = await db.password_resets.find_one_and_delete({
        "email": email, "code_hash": _code_digest(email, inp.code.strip()),
        "expires_at": {"$gt": datetime.now(timezone.utc).isoformat()}})
    if not rec:
        raise HTTPException(status_code=400, detail="Invalid or expired reset code")
    await db.users.update_one({"id": rec["user_id"]}, {"$set": {"password_hash": hash_pw(inp.new_password)}})
    return {"ok": True}

@api.post("/user/balance")
async def set_balance(inp: BalanceIn, user=Depends(get_current_user)):
    if inp.balance < 0:
        raise HTTPException(status_code=400, detail="Balance cannot be negative")
    await db.users.update_one({"id": user["id"]}, {"$set": {"account_balance": inp.balance}})
    u = await db.users.find_one({"id": user["id"]})
    return public_user(u)

@api.post("/user/start-trial")
async def start_premium_trial(user=Depends(get_current_user)):
    """One-time, card-free 7-day Premium trial. Auto-downgrades when it expires
    (handled in effective_tier)."""
    if user.get("trial_used"):
        raise HTTPException(status_code=400, detail="You've already used your free Premium trial.")
    if user.get("subscription_tier", "free") != "free":
        raise HTTPException(status_code=400, detail="You're already on a paid plan.")
    until = datetime.now(timezone.utc) + timedelta(days=TRIAL_DAYS)
    await db.users.update_one({"id": user["id"]},
        {"$set": {"trial_premium_until": until.isoformat(), "trial_used": True}})
    u = await db.users.find_one({"id": user["id"]})
    if u.get("discord_id"):
        try:
            await grant_role_if_linked(user["id"])
        except Exception:
            pass
    return {"ok": True, "trial_days": TRIAL_DAYS, "trial_premium_until": until.isoformat(), "user": public_user(u)}

class DeleteAccountIn(BaseModel):
    password: Optional[str] = None

@api.post("/user/delete-account")
async def delete_account(inp: DeleteAccountIn, user=Depends(get_current_user)):
    """Permanently delete the user's account and all associated data (Play/App Store
    requirement for apps with account creation)."""
    # Discord-login-only accounts have a random password they never set, so skip the
    # password check for them; everyone else must confirm with their password.
    is_discord_only = (user.get("email") or "").endswith("@bca.local")
    if not is_discord_only:
        if not inp.password or not verify_pw(inp.password, user.get("password_hash", "")):
            raise HTTPException(status_code=400, detail="Password is incorrect")
    uid = user["id"]
    sub_id = user.get("stripe_subscription_id")
    if sub_id:
        try:
            stripe.Subscription.cancel(sub_id)
        except Exception as e:
            logger.error(f"delete-account stripe cancel err {e}")
    if user.get("discord_id"):
        try:
            await discord_set_role(user["discord_id"], False)
        except Exception as e:
            logger.error(f"delete-account discord revoke err {e}")
    for coll in (db.trades, db.strategies, db.chat_messages, db.payments,
                 db.broker_accounts, db.cash_adjustments):
        try:
            await coll.delete_many({"user_id": uid})
        except Exception as e:
            logger.error(f"delete-account purge err {e}")
    await db.users.delete_one({"id": uid})
    return {"ok": True}

# ---------- Discord OAuth + role management ----------
def _discord_configured() -> bool:
    return bool(DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET and DISCORD_BOT_TOKEN
                and DISCORD_GUILD_ID and DISCORD_ROLE_ID)

def _make_discord_state(data: dict) -> str:
    payload = {**data, "exp": datetime.now(timezone.utc) + timedelta(minutes=15)}
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGO)

def _discord_authorize_url(redirect_uri: str, state: str) -> str:
    q = urlencode({"client_id": DISCORD_CLIENT_ID, "redirect_uri": redirect_uri,
                   "response_type": "code", "scope": "identify", "state": state})
    return f"{DISCORD_OAUTH_AUTHORIZE}?{q}"

async def discord_exchange_code(code: str, redirect_uri: str):
    data = {"client_id": DISCORD_CLIENT_ID, "client_secret": DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            tr = await c.post(f"{DISCORD_API}/oauth2/token", data=data,
                              headers={"Content-Type": "application/x-www-form-urlencoded"})
            if tr.status_code != 200:
                logger.error(f"discord token err {tr.status_code} {tr.text}")
                return None
            access = tr.json().get("access_token")
            ur = await c.get(f"{DISCORD_API}/users/@me",
                             headers={"Authorization": f"Bearer {access}"})
            if ur.status_code != 200:
                logger.error(f"discord user err {ur.status_code} {ur.text}")
                return None
            return ur.json()
    except Exception as e:
        logger.error(f"discord exchange err {e}")
        return None

async def discord_set_role(discord_id: str, grant: bool) -> bool:
    if not (_discord_configured() and discord_id):
        return False
    url = f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members/{discord_id}/roles/{DISCORD_ROLE_ID}"
    headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await (c.put(url, headers=headers) if grant else c.delete(url, headers=headers))
        ok = r.status_code in (200, 201, 204)
        if not ok:
            logger.error(f"discord role {'grant' if grant else 'revoke'} err {r.status_code} {r.text}")
        return ok
    except Exception as e:
        logger.error(f"discord role err {e}")
        return False

async def discord_dm(discord_id: str, content: str) -> bool:
    if not (DISCORD_BOT_TOKEN and discord_id):
        return False
    headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            ch = await c.post(f"{DISCORD_API}/users/@me/channels", headers=headers,
                              json={"recipient_id": str(discord_id)})
            if ch.status_code not in (200, 201):
                logger.error(f"discord dm channel err {ch.status_code} {ch.text}")
                return False
            cid = ch.json().get("id")
            m = await c.post(f"{DISCORD_API}/channels/{cid}/messages", headers=headers,
                             json={"content": content})
            return m.status_code in (200, 201)
    except Exception as e:
        logger.error(f"discord dm err {e}")
        return False

async def discord_channel_message(channel_id: str, content: str = "", embed: dict = None) -> bool:
    if not (DISCORD_BOT_TOKEN and channel_id):
        return False
    headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}", "Content-Type": "application/json"}
    payload: dict = {}
    if content:
        payload["content"] = content
    if embed:
        payload["embeds"] = [embed]
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{DISCORD_API}/channels/{channel_id}/messages", headers=headers, json=payload)
            ok = r.status_code in (200, 201)
            if not ok:
                logger.error(f"discord channel msg err {r.status_code} {r.text}")
            return ok
    except Exception as e:
        logger.error(f"discord channel msg err {e}")
        return False

def anon_alias(u: dict) -> str:
    """Stable anonymized handle for leaderboard display (e.g. 'Trader-4F2A')."""
    seed = str(u.get("discord_id") or u.get("id") or "")
    h = hashlib.sha256(seed.encode()).hexdigest()[:4].upper()
    return f"Trader-{h}"

async def post_win_to_discord(user_id: str, trade: dict):
    """Post an opted-in winning trade to the community #wins channel."""
    try:
        if not (DISCORD_WINS_CHANNEL_ID and trade.get("pnl", 0) > 0):
            return
        u = await db.users.find_one({"id": user_id})
        if not (u and u.get("discord_id") and u.get("discord_share_wins")):
            return
        name = u.get("discord_username") or "A trader"
        sym = trade.get("symbol", "N/A")
        pnl = trade.get("pnl", 0)
        setup = trade.get("detected_setup") or "a setup"
        grade = trade.get("setup_grade", "")
        embed = {
            "title": f"🟢 {sym} · +${pnl:,.2f}",
            "description": f"**{name}** just logged a win on **{setup}**" + (f" · Setup grade **{grade}**" if grade else ""),
            "color": 3066993,
            "footer": {"text": "Blue Collar Alpha · shared with consent"},
        }
        await discord_channel_message(DISCORD_WINS_CHANNEL_ID, embed=embed)
    except Exception as e:
        logger.error(f"post_win_to_discord err {e}")

def _welcome_msg(tier: str) -> str:
    t = "Premium" if tier == "premium" else "Pro"
    return (f"🎉 **Welcome to Blue Collar Alpha {t}!**\n"
            f"Your subscriber role has been granted — you now have access to the community and your "
            f"premium features in the app. Trade smart out there. 📈")

async def grant_role_if_linked(uid: str):
    u = await db.users.find_one({"id": uid})
    if u and u.get("discord_id"):
        await discord_set_role(u["discord_id"], True)
        if not u.get("discord_welcomed"):
            if await discord_dm(u["discord_id"], _welcome_msg(effective_tier(u))):
                await db.users.update_one({"id": uid}, {"$set": {"discord_welcomed": True}})

async def revoke_role_by_query(query: dict):
    u = await db.users.find_one(query)
    if u and u.get("discord_id"):
        await discord_set_role(u["discord_id"], False)
        await db.users.update_one({"id": u["id"]}, {"$unset": {"discord_welcomed": ""}})

def _discord_app_redirect(rt: str, params: dict) -> HTMLResponse:
    return _safe_redirect_response(rt, params, "Discord connected.", accent="#5865F2")

class DiscordLinkIn(BaseModel):
    origin: str
    return_url: str

@api.post("/auth/discord/link-url")
async def discord_link_url(inp: DiscordLinkIn, user=Depends(get_current_user)):
    if not _discord_configured():
        raise HTTPException(status_code=503, detail="Discord not configured")
    redirect_uri = f"{inp.origin}/api/auth/discord/callback"
    state = _make_discord_state({"mode": "link", "uid": user["id"],
                                 "rt": inp.return_url, "redirect": redirect_uri})
    return {"url": _discord_authorize_url(redirect_uri, state)}

@api.get("/auth/discord/login-url")
async def discord_login_url(origin: str, return_url: str):
    if not _discord_configured():
        raise HTTPException(status_code=503, detail="Discord not configured")
    redirect_uri = f"{origin}/api/auth/discord/callback"
    state = _make_discord_state({"mode": "login", "rt": return_url, "redirect": redirect_uri})
    return {"url": _discord_authorize_url(redirect_uri, state)}

@api.get("/auth/discord/callback", response_class=HTMLResponse)
async def discord_callback(code: str = "", state: str = "", error: str = ""):
    try:
        st = jwt.decode(state, JWT_SECRET, algorithms=[ALGO])
    except Exception:
        return _discord_app_redirect("", {"discord": "error"})
    rt = st.get("rt", "")
    if error or not code:
        return _discord_app_redirect(rt, {"discord": "cancelled"})
    redirect_uri = st.get("redirect")
    duser = await discord_exchange_code(code, redirect_uri)
    if not duser or not duser.get("id"):
        return _discord_app_redirect(rt, {"discord": "error"})
    discord_id = str(duser["id"])
    username = duser.get("global_name") or duser.get("username")
    mode = st.get("mode")
    if mode == "link":
        uid = st.get("uid")
        existing = await db.users.find_one({"discord_id": discord_id})
        if existing and existing.get("id") != uid:
            return _discord_app_redirect(rt, {"discord": "conflict"})
        await db.users.update_one({"id": uid},
            {"$set": {"discord_id": discord_id, "discord_username": username}})
        u = await db.users.find_one({"id": uid})
        if u and effective_tier(u) != "free":
            await discord_set_role(discord_id, True)
        return _discord_app_redirect(rt, {"discord": "linked"})
    # login mode
    u = await db.users.find_one({"discord_id": discord_id})
    if not u:
        uid = str(uuid.uuid4())
        u = {"id": uid, "email": f"discord_{discord_id}@bca.local",
             "password_hash": hash_pw(uuid.uuid4().hex),
             "subscription_tier": "free", "account_balance": 10000,
             "referral_code": gen_referral_code(), "bonus_trades": 0,
             "referral_count": 0, "referred_by": None,
             "discord_id": discord_id, "discord_username": username,
             "created_at": datetime.now(timezone.utc).isoformat()}
        await db.users.insert_one(u)
    token = make_token(u["id"])
    return _discord_app_redirect(rt, {"discord": "login", "token": token})

@api.post("/auth/discord/unlink")
async def discord_unlink(user=Depends(get_current_user)):
    if user.get("discord_id"):
        await discord_set_role(user["discord_id"], False)
    await db.users.update_one({"id": user["id"]},
        {"$unset": {"discord_id": "", "discord_username": "", "discord_welcomed": ""}})
    u = await db.users.find_one({"id": user["id"]})
    return public_user(u)

# ---------- Discord bot integration (slash commands / leaderboard) ----------
def _require_bot_key(x_bot_key: str):
    if not DISCORD_BOT_KEY or not hmac.compare_digest(x_bot_key, DISCORD_BOT_KEY):
        raise HTTPException(status_code=401, detail="Invalid bot key")

@api.get("/discord/bot/stats")
async def discord_bot_stats(discord_id: str, x_bot_key: str = Header(default="")):
    """Called by the Discord bot's /stats slash command to fetch a member's stats."""
    _require_bot_key(x_bot_key)
    u = await db.users.find_one({"discord_id": str(discord_id)})
    if not u:
        return {"linked": False}
    s = await _compute_stats(u["id"], u.get("account_balance", 10000))
    return {
        "linked": True,
        "tier": effective_tier(u),
        "total_trades": s["total_trades"],
        "win_rate": s["win_rate"],
        "total_pnl": s["total_pnl"],
        "profit_factor": s["profit_factor"],
        "avg_winner": s["avg_winner"],
        "avg_loser": s["avg_loser"],
        "best_setup": s["best_setup"],
    }

@api.get("/discord/bot/leaderboard")
async def discord_bot_leaderboard(window: int = 30, limit: int = 10, x_bot_key: str = Header(default="")):
    """Anonymized, opt-in leaderboard ranked by realized P&L over the window (days)."""
    _require_bot_key(x_bot_key)
    return await _compute_leaderboard(window, limit)

async def _compute_leaderboard(window: int = 30, limit: int = 10) -> dict:
    users = await db.users.find({"leaderboard_optin": True}).to_list(5000)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, window))).isoformat()
    rows = []
    for u in users:
        trades = await db.trades.find({"user_id": u["id"], "created_at": {"$gte": cutoff}}).to_list(1000)
        ex = [t for t in trades if t.get("taken", True) is not False and not t.get("pending")]
        n = len(ex)
        if n < 3:
            continue
        wins = [t for t in ex if t.get("pnl", 0) > 0]
        pnl = round(sum(t.get("pnl", 0) for t in ex), 2)
        rows.append({
            "alias": anon_alias(u),
            "trades": n,
            "win_rate": round(len(wins) / n * 100, 1),
            "pnl": pnl,
        })
    rows.sort(key=lambda r: r["pnl"], reverse=True)
    return {"window": window, "entries": rows[:max(1, min(limit, 50))]}

# ---------- Strategy routes ----------
@api.get("/strategies")
async def list_strategies(user=Depends(get_current_user)):
    items = await db.strategies.find({"user_id": user["id"]}).to_list(200)
    return [{k: v for k, v in s.items() if k != "_id"} for s in items]

@api.post("/strategies")
async def create_strategy(inp: StrategyIn, user=Depends(get_current_user)):
    doc = {"id": str(uuid.uuid4()), "user_id": user["id"], "name": inp.name,
           "risk_pct": inp.risk_pct, "rules": inp.rules,
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.strategies.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/strategies/{sid}")
async def update_strategy(sid: str, inp: StrategyIn, user=Depends(get_current_user)):
    res = await db.strategies.update_one({"id": sid, "user_id": user["id"]},
        {"$set": {"name": inp.name, "risk_pct": inp.risk_pct, "rules": inp.rules}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    s = await db.strategies.find_one({"id": sid})
    return {k: v for k, v in s.items() if k != "_id"}

@api.delete("/strategies/{sid}")
async def delete_strategy(sid: str, user=Depends(get_current_user)):
    await db.strategies.delete_one({"id": sid, "user_id": user["id"]})
    return {"ok": True}

# ---------- Trades ----------
def clean_trade(t: dict) -> dict:
    return {k: v for k, v in t.items() if k != "_id"}

@api.post("/trades/analyze-screenshot")
async def analyze_screenshot(inp: ScreenshotIn, user=Depends(get_current_user)):
    enforce_ai_limit(user)
    # Free tier monthly limit
    if effective_tier(user) == "free":
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        cnt = await db.trades.count_documents({"user_id": user["id"], "created_at": {"$gte": month_start.isoformat()}})
        limit = FREE_MONTHLY_LIMIT + user.get("bonus_trades", 0)
        if cnt >= limit:
            raise HTTPException(status_code=402, detail=f"Free tier limit reached ({limit} trades/month). Upgrade to Pro or invite friends for bonus trades.")

    # Resolve selected strategies (supports multiple)
    sel_ids = inp.strategy_ids or ([inp.strategy_id] if inp.strategy_id else [])
    strategies = []
    if sel_ids:
        strategies = await db.strategies.find({"id": {"$in": sel_ids}, "user_id": user["id"]}).to_list(50)
    rules_txt = ""
    if strategies:
        parts = []
        for s in strategies:
            parts.append(f"Strategy '{s['name']}' rules:\n" + "\n".join(f"- {r}" for r in s.get("rules", [])))
        rules_txt = "\nThe trader follows these strategies. Check the trade against ALL of them:\n" + "\n".join(parts)

    system = ("You are an expert trading analyst. You analyze a screenshot of a broker order/position or a trading chart "
              "and extract the trade details, then grade the execution. "
              "Respond ONLY with a single valid JSON object, no markdown, no prose.")
    prompt = (f"Analyze this trading screenshot and return JSON with keys: "
              f"symbol (string), asset_type (one of stock/option/future/crypto/forex), direction (long or short), "
              f"entry (number), exit (number or null), quantity (number), pnl (number, profit/loss in dollars, negative if loss), "
              f"trade_time (string like '10:32 AM' or null), setup_grade (one of A,B,C,D,F), "
              f"strategy_followed (boolean), rule_violations (array of short strings), "
              f"detected_setup (short string e.g. 'Opening Range Breakout'), "
              f"ai_summary (2-3 sentence coaching insight on this specific trade), "
              f"advanced (object with asset-type-specific analysis). "
              f"For OPTIONS include in advanced: delta, gamma, theta, vega (numbers), implied_volatility (number, percent), "
              f"overpaying_premium (boolean), suggested_strike (string), suggested_expiration (string), notes (string). "
              f"For FUTURES include in advanced: mfe (max favorable excursion in $), mae (max adverse excursion in $), "
              f"hold_time (string e.g. '12 min'), profit_left_on_table (string), entry_quality (string). "
              f"For stocks/crypto/forex, advanced can be an empty object {{}}. Estimate reasonably from the screenshot. "
              f"If a value is unreadable, make a reasonable estimate.{rules_txt}")
    chat = llm(system, f"extract-{user['id']}-{uuid.uuid4()}")
    try:
        resp = await chat.send_message(UserMessage(text=prompt, file_contents=[ImageContent(image_base64=inp.image_base64)]))
    except Exception as e:
        logger.error(f"LLM extract error: {e}")
        raise HTTPException(status_code=502, detail="AI analysis failed. Please try again.")
    data = extract_json(resp)
    if not data:
        raise HTTPException(status_code=422, detail="Could not read trade from screenshot. Try a clearer image.")

    def num(v, d=0):
        try:
            return float(v)
        except Exception:
            return d

    def sstr(v, d=""):
        if isinstance(v, str):
            return v
        if isinstance(v, list):
            return " ".join(sstr(x) for x in v)
        if isinstance(v, (int, float, bool)):
            return str(v)
        if v is None:
            return d
        return str(v)

    grade = sstr(data.get("setup_grade", "C")).strip().upper()[:1]
    if grade not in ("A", "B", "C", "D", "F"):
        grade = "C"
    rv = data.get("rule_violations", [])
    rule_violations = [sstr(x) for x in rv if x] if isinstance(rv, list) else ([sstr(rv)] if rv else [])
    adv = data.get("advanced") or {}
    if not isinstance(adv, dict):
        adv = {}
    # Flatten any nested values so the client never renders raw objects.
    advanced = {sstr(k): (v if isinstance(v, (str, int, float, bool)) else sstr(v)) for k, v in adv.items()}

    # Preview mode: return the read WITHOUT saving (used by share-to-notification).
    if inp.preview:
        return {"preview": True,
                "symbol": sstr(data.get("symbol"), "N/A").upper(),
                "direction": sstr(data.get("direction"), "long"),
                "pnl": num(data.get("pnl")),
                "setup_grade": grade,
                "detected_setup": sstr(data.get("detected_setup"), "Setup"),
                "ai_summary": sstr(data.get("ai_summary"))}

    doc = {
        "id": str(uuid.uuid4()), "user_id": user["id"],
        "symbol": sstr(data.get("symbol"), "N/A").upper(),
        "asset_type": sstr(data.get("asset_type"), "stock"),
        "direction": sstr(data.get("direction"), "long"),
        "entry": num(data.get("entry")), "exit": num(data.get("exit")),
        "quantity": num(data.get("quantity"), 1), "pnl": num(data.get("pnl")),
        "trade_time": sstr(data.get("trade_time")) or None,
        "setup_grade": grade,
        "strategy_followed": bool(data.get("strategy_followed", True)),
        "rule_violations": rule_violations,
        "detected_setup": sstr(data.get("detected_setup"), "Unknown"),
        "ai_summary": sstr(data.get("ai_summary")),
        "advanced": advanced,
        "taken": inp.taken,
        "pending": inp.pending,
        "strategy_ids": [s["id"] for s in strategies],
        "strategy_names": [s["name"] for s in strategies],
        "strategy_id": strategies[0]["id"] if strategies else None,
        "strategy_name": strategies[0]["name"] if strategies else None,
        "image_base64": inp.image_base64,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.trades.insert_one(doc)
    if doc.get("taken", True) and doc.get("pnl", 0) > 0:
        asyncio.create_task(post_win_to_discord(user["id"], doc))
    return clean_trade(doc)

@api.put("/trades/{tid}/taken")
async def set_trade_taken(tid: str, inp: TakenIn, user=Depends(get_current_user)):
    res = await db.trades.update_one({"id": tid, "user_id": user["id"]}, {"$set": {"taken": inp.taken}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    t = await db.trades.find_one({"id": tid})
    return clean_trade(t)

class CloseTradeIn(BaseModel):
    pnl: float

@api.put("/trades/{tid}/close")
async def close_trade(tid: str, inp: CloseTradeIn, user=Depends(get_current_user)):
    """Record the outcome of an open/pending trade so it counts toward stats."""
    res = await db.trades.update_one({"id": tid, "user_id": user["id"]},
        {"$set": {"pnl": round(inp.pnl, 2), "pending": False, "taken": True}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    t = await db.trades.find_one({"id": tid})
    if t.get("pnl", 0) > 0:
        asyncio.create_task(post_win_to_discord(user["id"], t))
    return clean_trade(t)
DEBRIEF_TAGS = ["FOMO", "Chased Entry", "No Stop", "Oversized", "Revenge Trade",
                "Cut Winner Early", "Held Loser", "Overtraded", "Hesitated", "Good Discipline"]

@api.get("/dashboard/last-trade")
async def last_executed_trade(user=Depends(get_current_user)):
    t = await db.trades.find_one({"user_id": user["id"], "taken": True}, sort=[("created_at", -1)])
    if not t:
        return {"has_trade": False}
    return {"has_trade": True, "trade": {k: v for k, v in t.items() if k not in ("_id", "image_base64")}}

@api.post("/trades/{tid}/debrief")
async def trade_debrief(tid: str, regenerate: bool = False, user=Depends(get_current_user)):
    enforce_ai_limit(user)
    t = await db.trades.find_one({"id": tid, "user_id": user["id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Trade not found")
    if t.get("debrief") and not regenerate:
        return t["debrief"]

    ctx = {
        "symbol": t.get("symbol"), "asset_type": t.get("asset_type"),
        "direction": t.get("direction"), "entry": t.get("entry"), "exit": t.get("exit"),
        "quantity": t.get("quantity"), "pnl": t.get("pnl"), "trade_time": t.get("trade_time"),
        "setup": t.get("detected_setup"), "grade": t.get("setup_grade"),
        "strategy_names": t.get("strategy_names"), "strategy_followed": t.get("strategy_followed"),
        "rule_violations": t.get("rule_violations"), "advanced": t.get("advanced"),
        "emotion": t.get("emotion"),
        "prior_summary": t.get("ai_summary"),
    }
    system = ("You are an elite trading coach doing a focused debrief on ONE trade. "
              "Respond ONLY with a single valid JSON object, no markdown, no prose. "
              f"mistake_tags MUST be chosen ONLY from this exact list: {json.dumps(DEBRIEF_TAGS)}. "
              "If the trade was well executed with no clear mistakes, use ['Good Discipline'].")
    prompt = (f"Here is one trade: {json.dumps(ctx)}. Return JSON with keys: "
              "went_right (array of 1-3 short bullet strings), "
              "watch_out (array of 1-3 short bullet strings — concrete, actionable improvements), "
              "mistake_tags (array of 1-3 tags from the allowed list), "
              "summary (one punchy coaching sentence, under 25 words). "
              "Be specific and cite numbers from the trade where relevant.")
    chat = llm(system, f"debrief-{user['id']}-{tid}", max_tokens=700)
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.error(f"debrief err {e}")
        raise HTTPException(status_code=502, detail="AI debrief failed. Please try again.")
    data = extract_json(resp)
    if not data:
        raise HTTPException(status_code=422, detail="Could not generate debrief. Try again.")

    def slist(v, n=3):
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()][:n]
        if v:
            return [str(v).strip()]
        return []

    tags = [x for x in slist(data.get("mistake_tags")) if x in DEBRIEF_TAGS]
    if not tags:
        clean = (t.get("pnl") or 0) >= 0 and not t.get("rule_violations")
        tags = ["Good Discipline"] if clean else []
    debrief = {
        "went_right": slist(data.get("went_right")),
        "watch_out": slist(data.get("watch_out")),
        "mistake_tags": tags,
        "summary": str(data.get("summary") or "").strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.trades.update_one({"id": tid, "user_id": user["id"]}, {"$set": {"debrief": debrief}})
    return debrief

@api.get("/dashboard/mistake-trends")
async def mistake_trends(window: str = "all", user=Depends(get_current_user)):
    q = {"user_id": user["id"], "debrief": {"$exists": True}}
    if window == "30":
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        q["created_at"] = {"$gte": cutoff}
    trades = await db.trades.find(q).to_list(2000)
    agg = {}  # tag -> {count, pnl}
    good = 0
    for t in trades:
        d = t.get("debrief") or {}
        tags = d.get("mistake_tags") or []
        pnl = t.get("pnl") or 0
        seen = set()
        for tag in tags:
            if tag == "Good Discipline":
                good += 1
                continue
            if tag in seen:
                continue
            seen.add(tag)
            a = agg.setdefault(tag, {"count": 0, "pnl": 0.0})
            a["count"] += 1
            a["pnl"] += pnl
    ranked = sorted(
        [{"tag": k, "count": v["count"], "pnl": round(v["pnl"], 2)} for k, v in agg.items()],
        key=lambda x: (-x["count"], x["pnl"]),
    )
    return {"window": window, "total_debriefed": len(trades), "good_count": good, "tags": ranked}

@api.post("/trades/analyze-chart")
async def analyze_chart(inp: ScreenshotIn, user=Depends(get_current_user)):
    enforce_ai_limit(user)
    if TIER_LEVEL.get(effective_tier(user), 0) < 1:
        raise HTTPException(status_code=402, detail="Chart analysis is a Pro feature. Upgrade to unlock.")
    system = ("You are an expert technical analyst. Analyze the chart screenshot and respond ONLY with a valid JSON object.")
    prompt = ("Analyze this trading chart. Return JSON with keys: "
              "trend (uptrend/downtrend/sideways), patterns (array of candlestick/chart patterns detected), "
              "support (array of price levels as strings), resistance (array of price levels as strings), "
              "setup_grade (A-F), analysis (3-4 sentence read of the chart and whether it's a good setup).")
    chat = llm(system, f"chart-{user['id']}-{uuid.uuid4()}")
    try:
        resp = await chat.send_message(UserMessage(text=prompt, file_contents=[ImageContent(image_base64=inp.image_base64)]))
    except Exception as e:
        logger.error(f"chart err {e}")
        raise HTTPException(status_code=502, detail="AI analysis failed.")
    data = extract_json(resp) or {"analysis": resp, "trend": "unknown", "patterns": [], "support": [], "resistance": [], "setup_grade": "C"}
    return data

DISCLAIMER = ("This is an educational analysis of how a potential setup aligns with your own rules. "
              "It is NOT financial advice, a recommendation, or a prediction. Trading involves substantial "
              "risk of loss. You are solely responsible for your decisions.")

@api.post("/analyze/pretrade")
async def analyze_pretrade(inp: PreTradeIn, user=Depends(get_current_user)):
    enforce_ai_limit(user)
    if TIER_LEVEL.get(effective_tier(user), 0) < 1:
        raise HTTPException(status_code=402, detail="The Pre-Trade Grader is a Pro feature. Upgrade to unlock.")
    # Pull the user's strategies (selected, or all if none chosen) so the AI can pick the best fit.
    if inp.strategy_ids:
        strategies = await db.strategies.find({"id": {"$in": inp.strategy_ids}, "user_id": user["id"]}).to_list(50)
    else:
        strategies = await db.strategies.find({"user_id": user["id"]}).to_list(50)
    strat_txt = "\n".join(f"Strategy '{s['name']}' rules:\n" + "\n".join(f"- {r}" for r in s.get("rules", [])) for s in strategies) or "No strategies defined."
    system = ("You are an expert trading coach evaluating a POTENTIAL (not-yet-taken) trade setup from a chart against the "
              "trader's own strategy rules. You are strictly educational and must NOT give financial advice or predictions. "
              "Respond ONLY with a single valid JSON object.")
    prompt = (f"Here are the trader's strategies:\n{strat_txt}\n\n"
              f"Analyze the attached chart as a POSSIBLE trade. Return JSON with keys: "
              f"grade (A-F, how well this potential setup fits the trader's rules), "
              f"best_matching_strategy (the name of the strategy it fits best, or 'None' if it fits none well), "
              f"rules_met (array of short strings), rules_violated (array of short strings), "
              f"trend (uptrend/downtrend/sideways), patterns (array), "
              f"reasoning (3-4 sentences on the fit, framed as education not advice), "
              f"considerations (array of 2-3 risk/entry considerations to think about). "
              f"Do NOT tell the user to buy or sell.")
    chat = llm(system, f"pretrade-{user['id']}-{uuid.uuid4()}")
    try:
        resp = await chat.send_message(UserMessage(text=prompt, file_contents=[ImageContent(image_base64=inp.image_base64)]))
    except Exception as e:
        logger.error(f"pretrade err {e}")
        raise HTTPException(status_code=502, detail="AI analysis failed. Please try again.")
    data = extract_json(resp) or {"grade": "C", "reasoning": resp, "best_matching_strategy": "None",
                                  "rules_met": [], "rules_violated": [], "patterns": [], "trend": "unknown", "considerations": []}
    data["disclaimer"] = DISCLAIMER
    return data

@api.get("/trades")
async def list_trades(strategy_id: Optional[str] = None, grade: Optional[str] = None,
                     taken: Optional[bool] = None, user=Depends(get_current_user)):
    q = {"user_id": user["id"]}
    if strategy_id:
        q["strategy_ids"] = strategy_id
    if grade:
        q["setup_grade"] = grade
    if taken is not None:
        if taken:
            q["taken"] = {"$ne": False}
        else:
            q["taken"] = False
    items = await db.trades.find(q).sort("created_at", -1).to_list(500)
    return [{k: v for k, v in t.items() if k not in ("_id", "image_base64")} for t in items]

@api.get("/trades/{tid}")
async def get_trade(tid: str, user=Depends(get_current_user)):
    t = await db.trades.find_one({"id": tid, "user_id": user["id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    return clean_trade(t)

@api.delete("/trades/{tid}")
async def delete_trade(tid: str, user=Depends(get_current_user)):
    await db.trades.delete_one({"id": tid, "user_id": user["id"]})
    return {"ok": True}

# ---------- Dashboard stats ----------
async def _compute_stats(uid: str, balance: float) -> dict:
    all_trades = await db.trades.find({"user_id": uid}).sort("created_at", 1).to_list(1000)
    # Only executed trades count toward performance stats.
    trades = [t for t in all_trades if t.get("taken", True) is not False and not t.get("pending")]
    total = len(trades)
    if total == 0:
        return {"total_trades": 0, "total_pnl": 0, "daily_pnl": 0, "win_rate": 0,
                "profit_factor": 0, "avg_winner": 0, "avg_loser": 0, "account_balance": balance,
                "equity_curve": [], "best_setup": None, "worst_setup": None, "best_hour": None, "worst_hour": None}
    wins = [t for t in trades if t.get("pnl", 0) > 0]
    losses = [t for t in trades if t.get("pnl", 0) < 0]
    total_pnl = sum(t.get("pnl", 0) for t in trades)
    gross_win = sum(t.get("pnl", 0) for t in wins)
    gross_loss = abs(sum(t.get("pnl", 0) for t in losses))
    today = datetime.now(timezone.utc).date().isoformat()
    daily_pnl = sum(t.get("pnl", 0) for t in trades if t.get("created_at", "").startswith(today))
    # equity curve
    bal = balance
    eq = []
    run = bal
    for t in trades:
        run += t.get("pnl", 0)
        eq.append(round(run, 2))
    eq = [round(bal, 2)] + eq
    # best/worst setup by total pnl
    setup_pnl = defaultdict(float)
    for t in trades:
        setup_pnl[t.get("detected_setup") or "Unknown"] += t.get("pnl", 0)
    best_setup = max(setup_pnl, key=setup_pnl.get) if setup_pnl else None
    worst_setup = min(setup_pnl, key=setup_pnl.get) if setup_pnl else None
    # best/worst hour
    hour_pnl = defaultdict(float)
    for t in trades:
        tt = t.get("trade_time")
        if tt:
            hour_pnl[tt] += t.get("pnl", 0)
    best_hour = max(hour_pnl, key=hour_pnl.get) if hour_pnl else None
    worst_hour = min(hour_pnl, key=hour_pnl.get) if hour_pnl else None
    return {
        "total_trades": total,
        "total_pnl": round(total_pnl, 2),
        "daily_pnl": round(daily_pnl, 2),
        "win_rate": round(len(wins) / total * 100, 1),
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else round(gross_win, 2),
        "avg_winner": round(gross_win / len(wins), 2) if wins else 0,
        "avg_loser": round(-gross_loss / len(losses), 2) if losses else 0,
        "account_balance": round(bal + total_pnl, 2),
        "equity_curve": eq,
        "best_setup": best_setup, "worst_setup": worst_setup,
        "best_hour": best_hour, "worst_hour": worst_hour,
    }

@api.get("/dashboard/stats")
async def dashboard(user=Depends(get_current_user)):
    return await _compute_stats(user["id"], user.get("account_balance", 10000))

# ---------- Weekly recap ----------
@api.get("/dashboard/weekly")
async def weekly_recap(user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    two_weeks = (now - timedelta(days=14)).isoformat()
    trades = await db.trades.find({"user_id": user["id"]}).to_list(2000)
    taken = [t for t in trades if t.get("taken", True) is not False and not t.get("pending")]

    def bucket(start, end):
        return [t for t in taken if start <= t.get("created_at", "") < end]
    this_week = bucket(week_ago, now.isoformat() + "z")
    last_week = bucket(two_weeks, week_ago)

    def summarize(ts):
        n = len(ts)
        pnl = round(sum(t.get("pnl", 0) for t in ts), 2)
        wins = [t for t in ts if t.get("pnl", 0) > 0]
        wr = round(len(wins) / n * 100, 1) if n else 0
        return {"trades": n, "pnl": pnl, "win_rate": wr}

    tw, lw = summarize(this_week), summarize(last_week)
    if tw["trades"] == 0:
        return {"has_data": False, "this_week": tw, "last_week": lw, "pnl_change": 0, "wr_change": 0,
                "takeaway": "No trades logged this week yet. Upload a screenshot to start your weekly review."}

    pnl_change = round(tw["pnl"] - lw["pnl"], 2)
    wr_change = round(tw["win_rate"] - lw["win_rate"], 1)
    setup_pnl = defaultdict(float)
    for t in this_week:
        setup_pnl[t.get("detected_setup") or "Unknown"] += t.get("pnl", 0)
    best = max(setup_pnl, key=setup_pnl.get) if setup_pnl else None
    worst = min(setup_pnl, key=setup_pnl.get) if setup_pnl else None
    violations = sum(1 for t in this_week if not t.get("strategy_followed", True))

    parts = [f"You're up ${tw['pnl']:.0f} this week" if tw["pnl"] >= 0 else f"You're down ${abs(tw['pnl']):.0f} this week"]
    if lw["trades"] > 0:
        parts.append(f"win rate {'improved' if wr_change >= 0 else 'dropped'} {abs(wr_change):.0f}pts vs last week")
    if best and setup_pnl[best] > 0:
        parts.append(f"{best} was your top setup")
    if violations > 0:
        parts.append(f"but {violations} trade{'s' if violations != 1 else ''} broke your rules")
    takeaway = ". ".join(parts[:3]) + "."

    return {"has_data": True, "this_week": tw, "last_week": lw, "pnl_change": pnl_change,
            "wr_change": wr_change, "best_setup": best, "worst_setup": worst, "takeaway": takeaway}

# ---------- Weekly digest email (Resend) ----------
async def _compute_weekly_summary(uid: str):
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    two_weeks = (now - timedelta(days=14)).isoformat()
    trades = await db.trades.find({"user_id": uid}).to_list(2000)
    taken = [t for t in trades if t.get("taken", True) is not False and not t.get("pending")]
    this_week = [t for t in taken if week_ago <= t.get("created_at", "") < now.isoformat() + "z"]
    last_week = [t for t in taken if two_weeks <= t.get("created_at", "") < week_ago]
    if not this_week:
        return None
    def summ(ts):
        n = len(ts); pnl = round(sum(t.get("pnl", 0) for t in ts), 2)
        wins = [t for t in ts if t.get("pnl", 0) > 0]
        return {"trades": n, "pnl": pnl, "win_rate": round(len(wins) / n * 100, 1) if n else 0,
                "best": round(max((t.get("pnl", 0) for t in ts), default=0), 2),
                "worst": round(min((t.get("pnl", 0) for t in ts), default=0), 2)}
    tw, lw = summ(this_week), summ(last_week)
    setup_pnl = defaultdict(float)
    for t in this_week:
        setup_pnl[t.get("detected_setup") or "Unknown"] += t.get("pnl", 0)
    best_setup = max(setup_pnl, key=setup_pnl.get) if setup_pnl else None
    violations = sum(1 for t in this_week if not t.get("strategy_followed", True))
    # Dominant mood from voice notes in the last 7 days + that mood's avg day P&L.
    mood = None; mood_pnl = 0.0; mood_count = 0
    vn = await db.voice_notes.find({"user_id": uid, "date": {"$gte": week_ago[:10]}}).to_list(500)
    if vn:
        from collections import Counter
        mood = Counter(n["emotion"] for n in vn).most_common(1)[0][0]
        dmap = await _day_pnl_map(uid)
        mvals = [dmap.get(n.get("date", ""), 0) for n in vn if n["emotion"] == mood]
        mood_count = len(mvals)
        mood_pnl = sum(mvals) / mood_count if mood_count else 0.0
    return {"tw": tw, "lw": lw, "best_setup": best_setup,
            "best_setup_pnl": round(setup_pnl.get(best_setup, 0), 2) if best_setup else 0,
            "violations": violations, "mood": mood, "mood_pnl": round(mood_pnl, 2), "mood_count": mood_count}

def _digest_html(s: dict, unsub_url: str = "") -> str:
    tw = s["tw"]; lw = s["lw"]
    pnl_color = "#22C55E" if tw["pnl"] >= 0 else "#EF4444"
    pnl_str = ("+$" + f"{tw['pnl']:,.2f}") if tw["pnl"] >= 0 else ("-$" + f"{abs(tw['pnl']):,.2f}")
    wr_delta = round(tw["win_rate"] - lw["win_rate"], 1) if lw["trades"] else None
    delta_txt = ""
    if wr_delta is not None:
        arrow = "▲" if wr_delta >= 0 else "▼"
        delta_txt = f"<span style='color:{'#22C55E' if wr_delta>=0 else '#EF4444'};font-size:13px'>&nbsp;{arrow} {abs(wr_delta)}pts vs last week</span>"
    setup_row = ""
    if s["best_setup"] and s["best_setup_pnl"] > 0:
        setup_row = f"<tr><td style='padding:6px 0;color:#9CA3AF'>Top setup</td><td style='padding:6px 0;text-align:right;color:#E5E7EB'><b>{s['best_setup']}</b> (+${s['best_setup_pnl']:,.0f})</td></tr>"
    viol_row = ""
    if s["violations"] > 0:
        viol_row = f"<tr><td style='padding:6px 0;color:#9CA3AF'>Rule breaks</td><td style='padding:6px 0;text-align:right;color:#F59E0B'><b>{s['violations']}</b></td></tr>"
    mood_row = ""
    if s.get("mood"):
        mp = s.get("mood_pnl", 0)
        mcol = "#22C55E" if mp >= 0 else "#EF4444"
        mood_row = f"<tr><td style='padding:6px 0;color:#9CA3AF'>Dominant mood</td><td style='padding:6px 0;text-align:right;color:#E5E7EB'><b>{s['mood']}</b> <span style='color:{mcol}'>(avg ${mp:,.0f}/day)</span></td></tr>"
    return f"""<!DOCTYPE html><html><body style="margin:0;background:#0A0A0A;font-family:Arial,Helvetica,sans-serif;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#141414;border:1px solid #262626;border-radius:16px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#1E3A8A,#2563EB);padding:24px 28px">
    <h1 style="margin:0;color:#fff;font-size:20px;letter-spacing:0.3px">Your Weekly Trading Recap</h1>
    <p style="margin:4px 0 0;color:#DBEAFE;font-size:13px">Blue Collar Alpha · last 7 days</p>
  </div>
  <div style="padding:28px">
    <div style="text-align:center;margin-bottom:20px">
      <div style="color:#9CA3AF;font-size:13px;text-transform:uppercase;letter-spacing:1px">Weekly P&amp;L</div>
      <div style="color:{pnl_color};font-size:38px;font-weight:bold;margin-top:4px">{pnl_str}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#9CA3AF">Trades</td><td style="padding:6px 0;text-align:right;color:#E5E7EB"><b>{tw['trades']}</b></td></tr>
      <tr><td style="padding:6px 0;color:#9CA3AF">Win rate</td><td style="padding:6px 0;text-align:right;color:#E5E7EB"><b>{tw['win_rate']}%</b>{delta_txt}</td></tr>
      <tr><td style="padding:6px 0;color:#9CA3AF">Best trade</td><td style="padding:6px 0;text-align:right;color:#22C55E"><b>+${tw['best']:,.0f}</b></td></tr>
      <tr><td style="padding:6px 0;color:#9CA3AF">Worst trade</td><td style="padding:6px 0;text-align:right;color:#EF4444"><b>${tw['worst']:,.0f}</b></td></tr>
      {setup_row}
      {viol_row}
      {mood_row}
    </table>
    <p style="color:#6B7280;font-size:12px;margin-top:24px;line-height:1.5">Open the app for your full metrics, calendar and AI coach review. You're receiving this because weekly digests are on in your Blue Collar Alpha settings.</p>
    <p style="color:#4B5563;font-size:11px;margin-top:8px">{('<a href="' + unsub_url + '" style="color:#6B7280">Unsubscribe from weekly recaps</a>') if unsub_url else ''}</p>
  </div>
</div>
</body></html>"""

def _make_unsub_token(uid: str) -> str:
    payload = {"sub": uid, "purpose": "unsub",
               "exp": datetime.now(timezone.utc) + timedelta(days=365)}
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGO)

@api.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str = ""):
    def page(msg: str, ok: bool):
        color = "#22C55E" if ok else "#EF4444"
        return HTMLResponse(f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Blue Collar Alpha</title></head>
<body style="margin:0;background:#0A0A0A;font-family:Arial,Helvetica,sans-serif;color:#E5E7EB;text-align:center;padding-top:90px">
<div style="max-width:460px;margin:0 auto;background:#141414;border:1px solid #262626;border-radius:16px;padding:36px 28px">
<div style="font-size:40px;margin-bottom:8px">{'✅' if ok else '⚠️'}</div>
<h2 style="margin:0 0 8px;color:{color}">{msg}</h2>
<p style="color:#9CA3AF;font-size:14px;line-height:1.5">You can re-enable weekly recaps anytime in the app under Profile → Preferences → Weekly Email Recap.</p>
</div></body></html>""")
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=[ALGO])
        if data.get("purpose") != "unsub":
            raise ValueError("bad purpose")
        uid = data.get("sub")
    except Exception:
        return page("This unsubscribe link is invalid or expired.", False)
    await db.users.update_one({"id": uid}, {"$set": {"weekly_digest_enabled": False}})
    return page("You're unsubscribed from weekly recaps.", True)

@api.post("/jobs/send-weekly-digest")
async def send_weekly_digest(x_ingest_key: str = Header(default=""), base_url: str = ""):
    if not GEX_INGEST_KEY or not hmac.compare_digest(x_ingest_key, GEX_INGEST_KEY):
        raise HTTPException(status_code=401, detail="Invalid ingest key")
    if not (RESEND_API_KEY and RESEND_FROM_EMAIL):
        raise HTTPException(status_code=503, detail="Email not configured")
    base = (base_url or PUBLIC_APP_URL or "").rstrip("/")
    users = await db.users.find({"weekly_digest_enabled": {"$ne": False}}).to_list(5000)
    sent = 0; skipped = 0; failed = 0
    for u in users:
        email = (u.get("email") or "").lower()
        if not email or email.endswith("@bca.local"):
            skipped += 1
            continue
        summary = await _compute_weekly_summary(u["id"])
        if not summary:
            skipped += 1
            continue
        unsub_url = f"{base}/api/unsubscribe?token={_make_unsub_token(u['id'])}" if base else ""
        try:
            resend.Emails.send({
                "from": RESEND_FROM_EMAIL,
                "to": [email],
                "subject": "Your Weekly Trading Recap 📈",
                "html": _digest_html(summary, unsub_url),
            })
            sent += 1
        except Exception as e:
            logger.error(f"resend send err {email}: {e}")
            failed += 1
    return {"ok": True, "sent": sent, "skipped": skipped, "failed": failed, "total_users": len(users)}


# ---------- Daily report ----------
@api.get("/reports/daily")
async def daily_report(user=Depends(get_current_user)):
    enforce_ai_limit(user)
    today = datetime.now(timezone.utc).date().isoformat()
    trades = await db.trades.find({"user_id": user["id"]}).sort("created_at", 1).to_list(1000)
    todays = [t for t in trades if t.get("created_at", "").startswith(today)]
    src = todays if todays else trades[-10:]
    if not src:
        return {"report": "No trades logged yet. Upload a trade screenshot to get your first coaching session.", "has_data": False}
    summary = [{"symbol": t["symbol"], "pnl": t.get("pnl"), "grade": t.get("setup_grade"),
                "setup": t.get("detected_setup"), "time": t.get("trade_time"),
                "followed": t.get("strategy_followed"), "violations": t.get("rule_violations")} for t in src]
    system = ("You are an elite trading coach. Given a trader's trades, write a concise, direct, actionable session review "
              "like a real coach. Use specific numbers. Cover: what went right, what went wrong, biggest mistake, "
              "emotional/behavioral patterns, and one clear recommendation. Keep under 180 words. Plain text, no markdown headers.")
    chat = llm(system, f"report-{user['id']}-{uuid.uuid4()}")
    try:
        resp = await chat.send_message(UserMessage(text=f"Here are the trades: {json.dumps(summary)}. Write the session review."))
    except Exception as e:
        logger.error(f"report err {e}")
        raise HTTPException(status_code=502, detail="AI report failed.")
    return {"report": resp, "has_data": True, "label": "Today" if todays else "Recent trades"}

# ---------- AI Coach chat ----------
class VoiceIn(BaseModel):
    audio_base64: str
    ext: Optional[str] = "m4a"
    summarize: Optional[bool] = False

@api.post("/coach/transcribe")
async def coach_transcribe(inp: VoiceIn, user=Depends(get_current_user)):
    """Transcribe a short voice note (Whisper) so the trader can journal by voice.
    Optionally returns a brief AI coaching summary of the note."""
    enforce_ai_limit(user)
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="Voice journaling is a Premium feature. Upgrade to unlock.")
    ext = (inp.ext or "m4a").lower().lstrip(".")
    if ext not in ("m4a", "mp3", "mp4", "wav", "webm", "mpeg", "mpga"):
        ext = "m4a"
    try:
        raw = base64.b64decode(inp.audio_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid audio data")
    if len(raw) > 24 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Voice note too large (max ~24MB).")
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        with open(tmp_path, "rb") as fh:
            resp = await stt.transcribe(file=fh, model="whisper-1", response_format="text")
        text = resp if isinstance(resp, str) else getattr(resp, "text", str(resp))
        text = (text or "").strip()
    except Exception as e:
        logger.error(f"transcribe err {e}")
        raise HTTPException(status_code=502, detail="Could not transcribe voice note. Try again.")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try: os.remove(tmp_path)
            except Exception: pass
    if not text:
        raise HTTPException(status_code=422, detail="No speech detected in the voice note.")
    summary = None
    if inp.summarize:
        try:
            chat = llm("You are a trading coach. The trader just spoke a quick journal note about their trading. "
                       "Reply with ONE short, encouraging, actionable coaching sentence (under 30 words). Plain text.",
                       f"voicesum-{user['id']}-{uuid.uuid4()}", max_tokens=120)
            summary = (await chat.send_message(UserMessage(text=text))).strip()
        except Exception as e:
            logger.error(f"voice summary err {e}")
    return {"text": text, "summary": summary}

# ---------- Voice journal: emotion from words + tone, correlated to P&L ----------
class VoiceNoteIn(BaseModel):
    text: Optional[str] = None
    audio_base64: Optional[str] = None
    ext: Optional[str] = "m4a"

async def _transcribe_b64(audio_base64: str, ext: str) -> str:
    ext = (ext or "m4a").lower().lstrip(".")
    if ext not in ("m4a", "mp3", "mp4", "wav", "webm", "mpeg", "mpga"):
        ext = "m4a"
    try:
        raw = base64.b64decode(audio_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid audio data")
    if len(raw) > 24 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Voice note too large (max ~24MB).")
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
            tmp.write(raw); tmp_path = tmp.name
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        with open(tmp_path, "rb") as fh:
            resp = await stt.transcribe(file=fh, model="whisper-1", response_format="text")
        text = resp if isinstance(resp, str) else getattr(resp, "text", str(resp))
        return (text or "").strip()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"voicenote transcribe err {e}")
        raise HTTPException(status_code=502, detail="Could not transcribe voice note. Try again.")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try: os.remove(tmp_path)
            except Exception: pass

async def _day_pnl_map(uid: str) -> dict:
    trades = await db.trades.find({"user_id": uid}, {"pnl": 1, "created_at": 1, "taken": 1, "pending": 1}).to_list(3000)
    m = defaultdict(float)
    for t in trades:
        if t.get("taken", True) is False or t.get("pending"):
            continue
        d = (t.get("created_at") or "")[:10]
        if d:
            m[d] += t.get("pnl", 0) or 0
    return m

@api.post("/journal/voice-note")
async def create_voice_note(inp: VoiceNoteIn, user=Depends(get_current_user)):
    """Save a spoken (or typed) journal note and infer the trader's emotion from the
    WORDS, TONE and overall feel — then tie it to that day's P&L."""
    enforce_ai_limit(user)
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="Voice journaling is a Premium feature. Upgrade to unlock.")
    text = (inp.text or "").strip()
    if not text and inp.audio_base64:
        text = await _transcribe_b64(inp.audio_base64, inp.ext or "m4a")
    if not text:
        raise HTTPException(status_code=422, detail="Nothing to journal — say or type a note first.")
    emotion, tone, reason = "Calm", "", ""
    try:
        system = ("You analyze a trader's short spoken/written journal note. From the WORDS, the TONE, and the "
                  "OVERALL emotion, classify the single dominant emotional state. Respond ONLY with a valid JSON object. "
                  f"emotion MUST be exactly one of: {json.dumps(EMOTIONS)}.")
        prompt = (f"Journal note: \"{text}\"\n\nReturn JSON with keys: emotion (one from the allowed list), "
                  "tone (2-4 word descriptor of the vocal/written tone, e.g. 'tense and rushed'), "
                  "reason (one short sentence citing what signals the emotion).")
        chat = llm(system, f"voicemood-{user['id']}-{uuid.uuid4()}", max_tokens=200)
        data = extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
        e = str(data.get("emotion") or "").strip().title()
        emotion = e if e in EMOTIONS else "Calm"
        tone = str(data.get("tone") or "").strip()[:60]
        reason = str(data.get("reason") or "").strip()[:200]
    except Exception as e:
        logger.error(f"voice emotion err {e}")
    now = datetime.now(timezone.utc)
    doc = {"id": str(uuid.uuid4()), "user_id": user["id"], "text": text[:2000],
           "emotion": emotion, "tone": tone, "reason": reason,
           "date": now.date().isoformat(), "created_at": now.isoformat()}
    await db.voice_notes.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.get("/journal/voice-notes")
async def list_voice_notes(user=Depends(get_current_user)):
    notes = await db.voice_notes.find({"user_id": user["id"]}).sort("created_at", -1).to_list(100)
    day = await _day_pnl_map(user["id"])
    return {"notes": [{"id": n["id"], "text": n["text"], "emotion": n["emotion"], "tone": n.get("tone", ""),
                       "reason": n.get("reason", ""), "created_at": n["created_at"],
                       "day_pnl": round(day.get(n.get("date", ""), 0), 2)} for n in notes]}

@api.delete("/journal/voice-note/{nid}")
async def delete_voice_note(nid: str, user=Depends(get_current_user)):
    await db.voice_notes.delete_one({"id": nid, "user_id": user["id"]})
    return {"ok": True}

@api.get("/insights/emotion-voice")
async def emotion_voice_insights(user=Depends(get_current_user)):
    """Correlate the emotion behind each voice note to that day's realized P&L."""
    notes = await db.voice_notes.find({"user_id": user["id"]}).sort("created_at", -1).to_list(500)
    day = await _day_pnl_map(user["id"])
    agg = {}
    for n in notes:
        dp = day.get(n.get("date", ""), 0)
        a = agg.setdefault(n["emotion"], {"count": 0, "pnl": 0.0, "green": 0})
        a["count"] += 1; a["pnl"] += dp
        if dp > 0:
            a["green"] += 1
    by_emotion = [{"emotion": k, "count": v["count"], "total_pnl": round(v["pnl"], 2),
                   "avg_pnl": round(v["pnl"] / v["count"], 2) if v["count"] else 0,
                   "win_rate": round(v["green"] / v["count"] * 100, 1) if v["count"] else 0}
                  for k, v in agg.items()]
    by_emotion.sort(key=lambda x: x["avg_pnl"], reverse=True)
    recent = [{"id": n["id"], "text": n["text"], "emotion": n["emotion"], "tone": n.get("tone", ""),
               "reason": n.get("reason", ""), "created_at": n["created_at"],
               "day_pnl": round(day.get(n.get("date", ""), 0), 2)} for n in notes[:20]]
    return {"has_data": len(notes) > 0, "total_notes": len(notes), "by_emotion": by_emotion,
            "best_emotion": by_emotion[0] if by_emotion else None,
            "worst_emotion": by_emotion[-1] if by_emotion else None, "recent": recent}

@api.get("/coach/mood-nudge")
async def coach_mood_nudge(user=Depends(get_current_user)):
    """If the trader's most recent logged mood is one that historically loses them
    money, surface a gentle heads-up in the Coach."""
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        return {"show": False}
    latest = await db.voice_notes.find_one({"user_id": user["id"]}, sort=[("created_at", -1)])
    if not latest:
        return {"show": False}
    emo = latest["emotion"]
    notes = await db.voice_notes.find({"user_id": user["id"], "emotion": emo}).to_list(500)
    day = await _day_pnl_map(user["id"])
    vals = [day.get(n.get("date", ""), 0) for n in notes]
    if len(vals) < 2:
        return {"show": False, "emotion": emo}
    avg = sum(vals) / len(vals)
    if avg >= 0:
        return {"show": False, "emotion": emo, "avg_pnl": round(avg, 2)}
    amt = f"-${abs(avg):,.0f}"
    return {"show": True, "emotion": emo, "count": len(vals), "avg_pnl": round(avg, 2),
            "message": f"You logged feeling {emo.lower()} recently. On your {emo.lower()} days you've averaged {amt}. Slow down and trade your plan today."}

@api.post("/coach/chat")
async def coach_chat(inp: ChatIn, user=Depends(get_current_user)):
    enforce_ai_limit(user)
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="AI Coach chat is a Premium feature. Upgrade to unlock.")
    trades = await db.trades.find({"user_id": user["id"]}).sort("created_at", 1).to_list(1000)
    strategies = await db.strategies.find({"user_id": user["id"]}).to_list(50)
    ctx_trades = [{"symbol": t["symbol"], "pnl": t.get("pnl"), "grade": t.get("setup_grade"),
                   "setup": t.get("detected_setup"), "time": t.get("trade_time"),
                   "day": t.get("created_at", "")[:10], "followed": t.get("strategy_followed"),
                   "violations": t.get("rule_violations")} for t in trades]
    ctx_strat = [{"name": s["name"], "rules": s.get("rules", [])} for s in strategies]
    system = (f"You are the trader's personal AI trading coach. Answer using ONLY the trader's own data below. "
              f"Be specific, cite numbers, be direct and encouraging but honest. Keep answers concise (under 150 words). "
              f"After your answer, on a NEW line output exactly 'FOLLOWUPS:' followed by 3 short, specific follow-up "
              f"questions the trader would naturally ask next based on your answer, separated by ' | '. "
              f"Keep each follow-up under 7 words.\n"
              f"TRADES: {json.dumps(ctx_trades)}\nSTRATEGIES: {json.dumps(ctx_strat)}")
    # persist history
    await db.chat_messages.insert_one({"id": str(uuid.uuid4()), "user_id": user["id"], "role": "user",
                                       "content": inp.message, "created_at": datetime.now(timezone.utc).isoformat()})
    chat = llm(system, f"coach-{user['id']}")
    try:
        resp = await chat.send_message(UserMessage(text=inp.message))
    except Exception as e:
        logger.error(f"coach err {e}")
        raise HTTPException(status_code=502, detail="AI coach failed.")
    # Split the answer from the AI-generated follow-up suggestions.
    answer = resp
    suggestions = []
    if "FOLLOWUPS:" in resp:
        answer, _, follow = resp.partition("FOLLOWUPS:")
        answer = answer.strip()
        suggestions = [s.strip(" -•*").strip() for s in follow.replace("\n", " ").split("|")]
        suggestions = [s for s in suggestions if s and len(s) < 60][:3]
    await db.chat_messages.insert_one({"id": str(uuid.uuid4()), "user_id": user["id"], "role": "assistant",
                                       "content": answer, "created_at": datetime.now(timezone.utc).isoformat()})
    return {"reply": answer, "suggestions": suggestions}

@api.get("/coach/history")
async def coach_history(user=Depends(get_current_user)):
    msgs = await db.chat_messages.find({"user_id": user["id"]}).sort("created_at", 1).to_list(200)
    return [{"role": m["role"], "content": m["content"]} for m in msgs]

class CoachImageIn(BaseModel):
    image_base64: str
    note: Optional[str] = ""

@api.post("/coach/analyze-image")
async def coach_analyze_image(inp: CoachImageIn, user=Depends(get_current_user)):
    """Analyze a shared screenshot (chart/trade) and reply with coaching feedback,
    saved into the coach thread so the trader can ask follow-ups."""
    enforce_ai_limit(user)
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="AI Coach is a Premium feature. Upgrade to unlock.")
    note = (inp.note or "").strip()
    system = ("You are the trader's personal AI trading coach. The trader shared a screenshot "
              "(usually a price chart or a trade/broker screen). Read it and give specific, honest, "
              "actionable coaching: what you see (setup, trend, key levels, entry/exit quality if visible), "
              "what was done well, and what to improve next time. Be direct and encouraging. Under 160 words. "
              "After your answer, on a NEW line output exactly 'FOLLOWUPS:' followed by 3 short follow-up "
              "questions the trader would naturally ask next, separated by ' | ', each under 7 words.")
    user_text = note or "Here's a screenshot from my trading — coach me on it."
    await db.chat_messages.insert_one({"id": str(uuid.uuid4()), "user_id": user["id"], "role": "user",
                                       "content": ("📷 Shared a screenshot" + (f" — {note}" if note else "")),
                                       "created_at": datetime.now(timezone.utc).isoformat()})
    chat = llm(system, f"coach-{user['id']}")
    try:
        resp = await chat.send_message(UserMessage(text=user_text, file_contents=[ImageContent(image_base64=inp.image_base64)]))
    except Exception as e:
        logger.error(f"coach image err {e}")
        raise HTTPException(status_code=502, detail="Could not analyze the screenshot. Please try again.")
    answer, suggestions = resp, []
    if "FOLLOWUPS:" in resp:
        answer, _, follow = resp.partition("FOLLOWUPS:")
        answer = answer.strip()
        suggestions = [s.strip(" -•*").strip() for s in follow.replace("\n", " ").split("|")]
        suggestions = [s for s in suggestions if s and len(s) < 60][:3]
    await db.chat_messages.insert_one({"id": str(uuid.uuid4()), "user_id": user["id"], "role": "assistant",
                                       "content": answer, "created_at": datetime.now(timezone.utc).isoformat()})
    return {"reply": answer, "suggestions": suggestions}

# ---------- Text-to-speech: spoken coach replies & end-of-day recap ----------
_TTS_VOICES = OpenAITextToSpeech.VOICES

class SpeakIn(BaseModel):
    text: str
    voice: Optional[str] = "onyx"

def _strip_for_speech(text: str) -> str:
    """Remove markdown / follow-up markers so the spoken output sounds natural."""
    t = text or ""
    t = re.split(r"FOLLOWUPS:", t)[0]
    t = re.sub(r"[*_#`>]+", "", t)
    t = re.sub(r"^\s*[-•]\s*", "", t, flags=re.MULTILINE)
    t = re.sub(r"\n{2,}", "\n", t).strip()
    return t

@api.post("/coach/speak")
async def coach_speak(inp: SpeakIn, user=Depends(get_current_user)):
    """Synthesize spoken audio (mp3) from a coach reply or the daily recap so the
    trader can listen hands-free. Premium feature."""
    enforce_ai_limit(user)
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="Voice replies are a Premium feature. Upgrade to unlock.")
    clean = _strip_for_speech(inp.text)[:4000]
    if not clean:
        raise HTTPException(status_code=400, detail="Nothing to read aloud.")
    voice = inp.voice if inp.voice in _TTS_VOICES else "onyx"
    try:
        tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
        b64 = await tts.generate_speech_base64(text=clean, model="tts-1", voice=voice, response_format="mp3")
    except Exception as e:
        logger.error(f"tts err {e}")
        raise HTTPException(status_code=502, detail="Could not generate audio. Please try again.")
    return {"audio_base64": b64, "mime": "audio/mpeg"}

# ---------- Stripe payments ----------
class CheckoutIn(BaseModel):
    tier: str
    origin: str
    return_url: str
    offer: Optional[str] = None   # "trial" = keep-Premium conversion offer

@api.post("/payments/create-checkout-session")
async def create_checkout(inp: CheckoutIn, user=Depends(get_current_user)):
    tier = inp.tier.lower()
    if tier not in STRIPE_PACKAGES:
        raise HTTPException(status_code=400, detail="Invalid plan")
    pkg = STRIPE_PACKAGES[tier]
    success_url = f"{inp.origin}/api/payments/redirect?rt={quote(inp.return_url)}&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{inp.origin}/api/payments/redirect?rt={quote(inp.return_url)}&status=cancel"
    # Trial converters already used their free days — don't grant another trial.
    is_trial_offer = (inp.offer == "trial" and bool(user.get("trial_premium_until")))
    sub_data = {} if is_trial_offer else ({"trial_period_days": pkg["trial_days"]} if pkg["trial_days"] > 0 else {})
    # First-month discount: the launch promo OR a keep-Premium trial-conversion offer.
    discounts = []
    promo = pkg.get("promo_amount")
    if (promo_active() or is_trial_offer) and promo and promo < pkg["amount"]:
        off = pkg["amount"] - promo
        try:
            cid = _promo_coupons.get(off)
            if not cid:
                coupon = stripe.Coupon.create(
                    amount_off=off, currency="usd", duration="once",
                    name=f"{pkg['name']} - First Month",
                )
                cid = coupon.id
                _promo_coupons[off] = cid
            discounts = [{"coupon": cid}]
        except Exception as e:
            logger.error(f"stripe coupon err {e}")
            discounts = []
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer_email=user["email"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": pkg["name"]},
                    "unit_amount": pkg["amount"],
                    "recurring": {"interval": pkg.get("interval", "month")},
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            subscription_data=sub_data,
            discounts=discounts or None,
            metadata={"user_id": user["id"], "tier": tier},
        )
    except Exception as e:
        logger.error(f"stripe create err {e}")
        raise HTTPException(status_code=502, detail="Could not start checkout")
    await db.payments.insert_one({
        "id": str(uuid.uuid4()), "user_id": user["id"], "tier": tier,
        "amount": pkg["amount"], "currency": "usd", "session_id": session.id,
        "status": "pending", "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"checkout_url": session.url, "session_id": session.id}

@api.get("/payments/redirect", response_class=HTMLResponse)
async def payment_redirect(rt: str, session_id: str = "", pay_status: str = Query("", alias="status")):
    msg = "Payment cancelled." if pay_status == "cancel" else "Payment complete."
    return _safe_redirect_response(
        rt, {"session_id": session_id, "status": pay_status or "success"}, msg, accent="#FFB74D")

@api.get("/payments/status")
async def payment_status(session_id: str, user=Depends(get_current_user)):
    # Server-side verification: only grant tier if Stripe confirms the session is complete.
    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid session")
    meta = session.get("metadata") or {}
    if meta.get("user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Session mismatch")
    paid = session.get("status") == "complete" and session.get("payment_status") in ("paid", "no_payment_required")
    if paid:
        tier = meta.get("tier", "free")
        base_tier = STRIPE_PACKAGES.get(tier, {}).get("base", tier)
        await db.payments.update_one({"session_id": session_id},
            {"$set": {"status": "completed", "stripe_subscription_id": session.get("subscription"),
                      "stripe_customer_id": session.get("customer"),
                      "updated_at": datetime.now(timezone.utc).isoformat()}})
        await db.users.update_one({"id": user["id"]}, {"$set": {
            "subscription_tier": base_tier, "stripe_subscription_id": session.get("subscription"),
            "stripe_customer_id": session.get("customer")}})
        await grant_role_if_linked(user["id"])
    u = await db.users.find_one({"id": user["id"]})
    return {"paid": paid, "session_status": session.get("status"),
            "payment_status": session.get("payment_status"), "user": public_user(u)}

@api.post("/payments/cancel")
async def cancel_subscription(user=Depends(get_current_user)):
    sub_id = user.get("stripe_subscription_id")
    if not sub_id:
        raise HTTPException(status_code=400, detail="No active subscription")
    try:
        stripe.Subscription.cancel(sub_id)
    except Exception as e:
        logger.error(f"cancel err {e}")
        raise HTTPException(status_code=502, detail="Could not cancel subscription")
    if user.get("discord_id"):
        await discord_set_role(user["discord_id"], False)
    await db.users.update_one({"id": user["id"]},
        {"$set": {"subscription_tier": "free", "stripe_subscription_id": None},
         "$unset": {"discord_welcomed": ""}})
    u = await db.users.find_one({"id": user["id"]})
    return {"ok": True, "user": public_user(u)}

@api.post("/payments/webhook")
async def stripe_webhook(request: Request):
    secret = os.environ.get('STRIPE_WEBHOOK_SECRET', '')
    body = await request.body()
    sig = request.headers.get("stripe-signature", "")
    if not secret:
        raise HTTPException(status_code=400, detail="Webhook not configured")
    try:
        event = stripe.Webhook.construct_event(payload=body, sig_header=sig, secret=secret)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}")
    etype = event["type"]
    obj = event["data"]["object"]
    if etype == "checkout.session.completed":
        meta = obj.get("metadata") or {}
        uid = meta.get("user_id"); tier = meta.get("tier")
        if uid and tier:
            base_tier = STRIPE_PACKAGES.get(tier, {}).get("base", tier)
            await db.users.update_one({"id": uid}, {"$set": {
                "subscription_tier": base_tier, "stripe_subscription_id": obj.get("subscription"),
                "stripe_customer_id": obj.get("customer")}})
            await grant_role_if_linked(uid)
            await db.payments.update_one({"session_id": obj.get("id")},
                {"$set": {"status": "completed", "updated_at": datetime.now(timezone.utc).isoformat()}})
    elif etype == "customer.subscription.deleted":
        # Subscription ended/cancelled -> downgrade to free.
        await revoke_role_by_query({"stripe_subscription_id": obj.get("id")})
        await db.users.update_one({"stripe_subscription_id": obj.get("id")},
            {"$set": {"subscription_tier": "free", "stripe_subscription_id": None}})
    elif etype == "invoice.payment_failed":
        cust = obj.get("customer")
        if cust:
            await revoke_role_by_query({"stripe_customer_id": cust})
            await db.users.update_one({"stripe_customer_id": cust},
                {"$set": {"subscription_tier": "free"}})
    return {"received": True}

@api.get("/payments/billing")
async def billing_info(user=Depends(get_current_user)):
    cust = user.get("stripe_customer_id")
    if not cust:
        return {"has_subscription": False, "tier": user.get("subscription_tier", "free"), "subscription": None, "invoices": []}
    sub_info = None
    sub_id = user.get("stripe_subscription_id")
    if sub_id:
        try:
            s = stripe.Subscription.retrieve(sub_id)
            item = (s.get("items", {}).get("data") or [{}])[0]
            price = item.get("price") or {}
            sub_info = {
                "status": s.get("status"),
                "amount": (price.get("unit_amount") or 0) / 100,
                "interval": (price.get("recurring") or {}).get("interval", "month"),
                "current_period_end": datetime.fromtimestamp(s["current_period_end"], timezone.utc).isoformat() if s.get("current_period_end") else None,
                "trial_end": datetime.fromtimestamp(s["trial_end"], timezone.utc).isoformat() if s.get("trial_end") else None,
                "cancel_at_period_end": s.get("cancel_at_period_end", False),
            }
        except Exception as e:
            logger.error(f"sub retrieve err {e}")
    invoices = []
    try:
        inv = stripe.Invoice.list(customer=cust, limit=12)
        for i in inv.get("data", []):
            invoices.append({
                "number": i.get("number"),
                "amount": (i.get("amount_paid") or 0) / 100,
                "currency": (i.get("currency") or "usd").upper(),
                "status": i.get("status"),
                "created": datetime.fromtimestamp(i["created"], timezone.utc).isoformat() if i.get("created") else None,
                "pdf": i.get("invoice_pdf"),
                "url": i.get("hosted_invoice_url"),
            })
    except Exception as e:
        logger.error(f"invoice list err {e}")
    return {"has_subscription": sub_info is not None, "tier": user.get("subscription_tier", "free"),
            "subscription": sub_info, "invoices": invoices}

@api.get("/upsell/annual")
async def annual_upsell(user=Depends(get_current_user)):
    """Show a save-more annual offer to monthly subscribers after a few months of billing."""
    raw = user.get("subscription_tier", "free")
    if raw not in ("pro", "premium"):
        return {"show": False}
    pays = await db.payments.find({"user_id": user["id"], "status": "completed"}).sort("created_at", 1).to_list(100)
    # Monthly plans use the base keys ('pro'/'premium'); annual plans use '*_annual'.
    monthly_pays = [p for p in pays if p.get("tier") in ("pro", "premium")]
    if not monthly_pays:
        return {"show": False}
    try:
        start = datetime.fromisoformat(monthly_pays[0]["created_at"])
        months = (datetime.now(timezone.utc) - start).days // 30
    except Exception:
        months = 0
    if months < UPSELL_MIN_MONTHS:
        return {"show": False}
    annual_key = f"{raw}_annual"
    monthly = STRIPE_PACKAGES[raw]["amount"]
    annual = STRIPE_PACKAGES[annual_key]["amount"]
    yearly_at_monthly = monthly * 12
    savings = yearly_at_monthly - annual
    return {"show": True, "base": raw, "annual_tier": annual_key, "months_active": months,
            "monthly_amount": round(monthly / 100, 2), "annual_amount": round(annual / 100, 2),
            "annual_monthly_equiv": round(annual / 12 / 100, 2),
            "savings_amount": round(savings / 100, 2),
            "savings_pct": round(savings / yearly_at_monthly * 100) if yearly_at_monthly else 0}

@api.get("/")
async def root():
    return {"message": "Blue Collar Alpha API"}

# ---------- Emotion tagging ----------
EMOTIONS = ["Calm", "Confident", "Disciplined", "FOMO", "Anxious", "Greedy", "Revenge", "Bored"]

class EmotionIn(BaseModel):
    emotion: str

class SettingsIn(BaseModel):
    daily_loss_limit: Optional[float] = None
    weekly_digest_enabled: Optional[bool] = None
    discord_share_wins: Optional[bool] = None
    leaderboard_optin: Optional[bool] = None

class ImportCsvIn(BaseModel):
    csv: str

@api.put("/trades/{tid}/emotion")
async def set_emotion(tid: str, inp: EmotionIn, user=Depends(get_current_user)):
    emo = inp.emotion if inp.emotion in EMOTIONS else None
    res = await db.trades.update_one({"id": tid, "user_id": user["id"]}, {"$set": {"emotion": emo}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    t = await db.trades.find_one({"id": tid})
    return clean_trade(t)

@api.post("/user/settings")
async def set_settings(inp: SettingsIn, user=Depends(get_current_user)):
    updates = {}
    if inp.daily_loss_limit is not None:
        updates["daily_loss_limit"] = max(0, float(inp.daily_loss_limit or 0))
    if inp.weekly_digest_enabled is not None:
        updates["weekly_digest_enabled"] = bool(inp.weekly_digest_enabled)
    if inp.discord_share_wins is not None:
        updates["discord_share_wins"] = bool(inp.discord_share_wins)
    if inp.leaderboard_optin is not None:
        updates["leaderboard_optin"] = bool(inp.leaderboard_optin)
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    u = await db.users.find_one({"id": user["id"]})
    return public_user(u)

# ---------- Multi-broker balances + cash-adjustments ledger ----------
def _strip(d: dict) -> dict:
    d.pop("_id", None)
    return d

def _today_str() -> str:
    return datetime.now(timezone.utc).date().isoformat()

class BrokerIn(BaseModel):
    name: str
    balance: float = 0

class BrokerUpdate(BaseModel):
    name: Optional[str] = None
    balance: Optional[float] = None

class ReconcileItem(BaseModel):
    id: str
    new_balance: float
    classification: Optional[str] = None  # win | loss | other
    note: Optional[str] = None

class ReconcileIn(BaseModel):
    items: List[ReconcileItem]

@api.get("/brokers")
async def list_brokers(user=Depends(get_current_user)):
    accts = await db.broker_accounts.find({"user_id": user["id"]}).sort("created_at", 1).to_list(100)
    accts = [_strip(a) for a in accts]
    total = round(sum(a.get("balance", 0) for a in accts), 2)
    u = await db.users.find_one({"id": user["id"]})
    needs = bool(accts) and (u.get("balances_confirmed_on") != _today_str())
    return {"accounts": accts, "total": total, "needs_reconcile": needs,
            "confirmed_on": u.get("balances_confirmed_on")}

@api.post("/brokers")
async def add_broker(inp: BrokerIn, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": str(uuid.uuid4()), "user_id": user["id"], "name": (inp.name or "Broker").strip()[:40] or "Broker",
           "balance": round(float(inp.balance or 0), 2), "created_at": now, "updated_at": now}
    await db.broker_accounts.insert_one(doc)
    return _strip(doc)

@api.put("/brokers/{bid}")
async def update_broker(bid: str, inp: BrokerUpdate, user=Depends(get_current_user)):
    upd = {}
    if inp.name is not None:
        upd["name"] = inp.name.strip()[:40] or "Broker"
    if inp.balance is not None:
        upd["balance"] = round(float(inp.balance), 2)
    if upd:
        upd["updated_at"] = datetime.now(timezone.utc).isoformat()
        r = await db.broker_accounts.update_one({"id": bid, "user_id": user["id"]}, {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Broker not found")
    a = await db.broker_accounts.find_one({"id": bid, "user_id": user["id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Broker not found")
    return _strip(a)

@api.delete("/brokers/{bid}")
async def delete_broker(bid: str, user=Depends(get_current_user)):
    await db.broker_accounts.delete_one({"id": bid, "user_id": user["id"]})
    return {"ok": True}

@api.post("/brokers/reconcile")
async def reconcile_brokers(inp: ReconcileIn, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    logged = []
    for it in inp.items:
        a = await db.broker_accounts.find_one({"id": it.id, "user_id": user["id"]})
        if not a:
            continue
        old = a.get("balance", 0)
        delta = round(float(it.new_balance) - old, 2)
        if abs(delta) >= 0.005:
            cls = (it.classification or "other").lower()
            if cls not in ("win", "loss", "other"):
                cls = "other"
            adj = {"id": str(uuid.uuid4()), "user_id": user["id"], "broker_account_id": a["id"],
                   "broker_name": a["name"], "amount": delta, "type": cls,
                   "note": (it.note or "")[:200], "created_at": now}
            await db.cash_adjustments.insert_one(adj)
            logged.append(_strip(dict(adj)))
        await db.broker_accounts.update_one({"id": a["id"]},
            {"$set": {"balance": round(float(it.new_balance), 2), "updated_at": now}})
    await db.users.update_one({"id": user["id"]}, {"$set": {"balances_confirmed_on": _today_str()}})
    return {"ok": True, "adjustments": logged}

@api.get("/cash-adjustments")
async def cash_adjustments(user=Depends(get_current_user)):
    items = await db.cash_adjustments.find({"user_id": user["id"]}).sort("created_at", -1).to_list(500)
    items = [_strip(i) for i in items]
    summ = {"win": 0.0, "loss": 0.0, "other": 0.0}
    for i in items:
        t = i.get("type", "other")
        summ[t] = round(summ.get(t, 0) + i.get("amount", 0), 2)
    return {"adjustments": items, "summary": summ, "net": round(sum(i.get("amount", 0) for i in items), 2)}

# ---------- AI Coaching: game plan, emotion insights, streak ----------
@api.get("/coach/game-plan")
async def coach_game_plan(user=Depends(get_current_user)):
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="AI Game Plan is a Premium feature. Upgrade to unlock.")
    trades = await db.trades.find({"user_id": user["id"]}).sort("created_at", -1).to_list(300)
    taken = [t for t in trades if t.get("taken", True) is not False and not t.get("pending")]
    recent = taken[:60]
    tags = defaultdict(int)
    for t in recent:
        for tag in (t.get("mistake_tags") or []):
            tags[tag] += 1
        if t.get("strategy_followed") is False:
            tags["rule violation"] += 1
    top_mistakes = sorted(tags.items(), key=lambda x: -x[1])[:5]
    n = len(recent)
    pnl = round(sum(t.get("pnl", 0) for t in recent), 2)
    wins = sum(1 for t in recent if t.get("pnl", 0) > 0)
    perf = {"trades": n, "pnl": pnl, "win_rate": round(wins / n * 100, 1) if n else 0}
    snaps = await db.gex_snapshots.find({}).to_list(10)
    gex_ctx = [{"symbol": s["symbol"], "spot": s.get("spot"), "flip": s.get("flip_point"),
                "call_wall": s.get("call_wall"), "put_wall": s.get("put_wall"),
                "net_gex": s.get("net_gex")} for s in snaps]
    system = ("You are an elite trading coach writing a SHORT, punchy pre-market game plan for the trader. "
              "Use ONLY their data. Structure with 3 sections using these exact headers on their own lines: "
              "'Focus', 'Watch-outs', 'Key Levels'. Under Focus: 1-2 things to lean into based on what's working. "
              "Under Watch-outs: their top recurring mistakes to avoid today. Under Key Levels: reference the GEX "
              "flip/walls per symbol in plain English (what to do around them). Keep the whole thing under 180 words, "
              "direct and motivating.")
    prompt = (f"RECENT PERFORMANCE (last {n} trades): {json.dumps(perf)}\n"
              f"TOP RECURRING MISTAKES: {json.dumps(top_mistakes)}\n"
              f"TODAY'S GEX LEVELS: {json.dumps(gex_ctx)}")
    chat = llm(system, f"gameplan-{user['id']}", max_tokens=700)
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.error(f"gameplan err {e}")
        raise HTTPException(status_code=502, detail="Could not generate game plan. Try again.")
    return {"game_plan": resp.strip(), "generated_at": datetime.now(timezone.utc).isoformat(),
            "gex_levels": gex_ctx, "has_data": n > 0}

@api.get("/insights/emotion")
async def emotion_insights(user=Depends(get_current_user)):
    trades = await db.trades.find({"user_id": user["id"]}).to_list(2000)
    taken = [t for t in trades if t.get("taken", True) is not False and t.get("emotion")]
    g = defaultdict(lambda: {"n": 0, "pnl": 0.0, "wins": 0})
    for t in taken:
        e = t["emotion"]
        g[e]["n"] += 1
        g[e]["pnl"] += t.get("pnl", 0)
        if t.get("pnl", 0) > 0:
            g[e]["wins"] += 1
    out = [{"emotion": e, "trades": v["n"], "pnl": round(v["pnl"], 2),
            "win_rate": round(v["wins"] / v["n"] * 100, 1) if v["n"] else 0,
            "avg_pnl": round(v["pnl"] / v["n"], 2) if v["n"] else 0} for e, v in g.items()]
    out.sort(key=lambda x: x["pnl"], reverse=True)
    return {"by_emotion": out, "has_data": len(out) > 0}

@api.get("/insights/setups")
async def setup_insights(user=Depends(get_current_user)):
    """Performance by detected setup so the best-performing plays surface over time."""
    trades = await db.trades.find({"user_id": user["id"]}).to_list(2000)
    taken = [t for t in trades if t.get("taken", True) is not False and not t.get("pending")]
    g = defaultdict(lambda: {"n": 0, "pnl": 0.0, "wins": 0})
    for t in taken:
        name = t.get("detected_setup") or t.get("strategy_name") or "Unlabeled"
        g[name]["n"] += 1
        g[name]["pnl"] += t.get("pnl", 0)
        if t.get("pnl", 0) > 0:
            g[name]["wins"] += 1
    out = [{"setup": k, "trades": v["n"], "pnl": round(v["pnl"], 2),
            "win_rate": round(v["wins"] / v["n"] * 100, 1) if v["n"] else 0,
            "avg_pnl": round(v["pnl"] / v["n"], 2) if v["n"] else 0} for k, v in g.items()]
    out.sort(key=lambda x: x["pnl"], reverse=True)
    return {"setups": out, "has_data": len(out) > 0}

# ---------- P&L heatmap: day-of-week × time-of-day ----------
_HM_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
# (label, start_hour_inclusive, end_hour_exclusive) — US market sessions.
_HM_SESSIONS = [("Open", 0, 10), ("Mid-AM", 10, 12), ("Midday", 12, 14), ("PM", 14, 16), ("Late", 16, 24)]

@api.get("/insights/heatmap")
async def pnl_heatmap(symbol: Optional[str] = None, strategy_id: Optional[str] = None,
                      grade: Optional[str] = None, user=Depends(get_current_user)):
    """Aggregate realized P&L by weekday and trading session so the trader can see
    WHEN they make and lose money. Optionally filter by symbol, strategy or grade."""
    trades = await db.trades.find({"user_id": user["id"]}).to_list(3000)
    taken = [t for t in trades if t.get("taken", True) is not False and not t.get("pending")]
    # Filter options from the full set (before applying the active filter).
    symbols = sorted({(t.get("symbol") or "").upper() for t in taken if t.get("symbol")})
    grades = sorted({t.get("setup_grade") for t in taken if t.get("setup_grade")})
    strat_map = {}
    for t in taken:
        for sid, sname in zip(t.get("strategy_ids", []) or [], t.get("strategy_names", []) or []):
            if sid:
                strat_map[sid] = sname
    strategies_opt = [{"id": k, "name": v} for k, v in strat_map.items()]
    if symbol:
        taken = [t for t in taken if (t.get("symbol") or "").upper() == symbol.upper()]
    if strategy_id:
        taken = [t for t in taken if strategy_id in (t.get("strategy_ids") or [])]
    if grade:
        taken = [t for t in taken if t.get("setup_grade") == grade]

    day_agg = [{"pnl": 0.0, "trades": 0, "wins": 0} for _ in range(7)]
    sess_agg = [{"pnl": 0.0, "trades": 0, "wins": 0} for _ in _HM_SESSIONS]
    grid = [[{"pnl": 0.0, "trades": 0, "wins": 0} for _ in range(7)] for _ in _HM_SESSIONS]
    used_days: set = set()
    used_sessions: set = set()

    for t in taken:
        ca = (t.get("created_at") or "").replace("Z", "").replace("z", "")
        try:
            di = datetime.fromisoformat(ca).weekday()
        except Exception:
            continue
        pnl = t.get("pnl", 0) or 0
        win = 1 if pnl > 0 else 0
        day_agg[di]["pnl"] += pnl; day_agg[di]["trades"] += 1; day_agg[di]["wins"] += win
        used_days.add(di)
        h = _parse_hour(t.get("trade_time"))
        if h is None:
            continue
        si = next((idx for idx, s in enumerate(_HM_SESSIONS) if s[1] <= h < s[2]), None)
        if si is None:
            continue
        sess_agg[si]["pnl"] += pnl; sess_agg[si]["trades"] += 1; sess_agg[si]["wins"] += win
        used_sessions.add(si)
        c = grid[si][di]
        c["pnl"] += pnl; c["trades"] += 1; c["wins"] += win

    def fin(a):
        return {"pnl": round(a["pnl"], 2), "trades": a["trades"],
                "win_rate": round(a["wins"] / a["trades"] * 100, 1) if a["trades"] else 0}

    day_idx = [0, 1, 2, 3, 4] + [i for i in (5, 6) if i in used_days]
    day_stats = [{"day": _HM_DAYS[i], **fin(day_agg[i])} for i in day_idx]
    session_stats = [{"session": _HM_SESSIONS[si][0], **fin(sess_agg[si])} for si in range(len(_HM_SESSIONS))]
    grid_out = [{"session": _HM_SESSIONS[si][0],
                 "cells": [{"day": _HM_DAYS[di], **fin(grid[si][di])} for di in day_idx]}
                for si in range(len(_HM_SESSIONS))]

    active_days = [d for d in day_stats if d["trades"] > 0]
    active_sess = [s for s in session_stats if s["trades"] > 0]
    best_day = max(active_days, key=lambda x: x["pnl"]) if active_days else None
    worst_day = min(active_days, key=lambda x: x["pnl"]) if active_days else None
    best_session = max(active_sess, key=lambda x: x["pnl"]) if active_sess else None
    return {"has_data": len(taken) > 0, "has_time": len(used_sessions) > 0,
            "days": [_HM_DAYS[i] for i in day_idx], "day_stats": day_stats,
            "session_stats": session_stats, "grid": grid_out,
            "best_day": best_day, "worst_day": worst_day, "best_session": best_session,
            "symbols": symbols, "strategies": strategies_opt,
            "grades": grades,
            "filter": {"symbol": symbol, "strategy_id": strategy_id, "grade": grade}}

@api.get("/insights/heatmap/trades")
async def heatmap_trades(day: str, session: str, symbol: Optional[str] = None,
                         strategy_id: Optional[str] = None, grade: Optional[str] = None,
                         user=Depends(get_current_user)):
    """The executed trades behind one heatmap cell (weekday × session), for drill-down."""
    di = _HM_DAYS.index(day) if day in _HM_DAYS else None
    sess = next((s for s in _HM_SESSIONS if s[0] == session), None)
    if di is None or sess is None:
        raise HTTPException(status_code=400, detail="Invalid day or session")
    trades = await db.trades.find({"user_id": user["id"]}, {"image_base64": 0}).to_list(3000)
    taken = [t for t in trades if t.get("taken", True) is not False and not t.get("pending")]
    if symbol:
        taken = [t for t in taken if (t.get("symbol") or "").upper() == symbol.upper()]
    if strategy_id:
        taken = [t for t in taken if strategy_id in (t.get("strategy_ids") or [])]
    if grade:
        taken = [t for t in taken if t.get("setup_grade") == grade]
    out = []
    for t in taken:
        ca = (t.get("created_at") or "").replace("Z", "").replace("z", "")
        try:
            if datetime.fromisoformat(ca).weekday() != di:
                continue
        except Exception:
            continue
        h = _parse_hour(t.get("trade_time"))
        if h is None or not (sess[1] <= h < sess[2]):
            continue
        out.append({"id": t["id"], "symbol": t.get("symbol"), "pnl": round(t.get("pnl", 0) or 0, 2),
                    "trade_time": t.get("trade_time"), "setup": t.get("detected_setup"),
                    "grade": t.get("setup_grade"), "created_at": t.get("created_at")})
    out.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return {"day": day, "session": session, "count": len(out),
            "total_pnl": round(sum(x["pnl"] for x in out), 2), "trades": out}

@api.get("/insights/streak")
async def rule_streak(user=Depends(get_current_user)):
    trades = await db.trades.find({"user_id": user["id"]}).sort("created_at", -1).to_list(1000)
    taken = [t for t in trades if t.get("taken", True) is not False and not t.get("pending")]
    current = 0
    for t in taken:
        if t.get("strategy_followed") is not False:
            current += 1
        else:
            break
    best = 0
    run = 0
    for t in reversed(taken):
        if t.get("strategy_followed") is not False:
            run += 1
            best = max(best, run)
        else:
            run = 0
    return {"current_streak": current, "best_streak": best, "total": len(taken)}


# ---------- Performance metrics + playbooks ----------
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

def _parse_hour(tt):
    if not tt or not isinstance(tt, str):
        return None
    m = re.match(r"\s*(\d{1,2}):?(\d{2})?\s*([APap][Mm])?", tt)
    if not m:
        return None
    h = int(m.group(1))
    ap = (m.group(3) or "").lower()
    if ap == "pm" and h < 12:
        h += 12
    if ap == "am" and h == 12:
        h = 0
    return h if 0 <= h <= 23 else None

@api.get("/dashboard/metrics")
async def dashboard_metrics(user=Depends(get_current_user)):
    all_trades = await db.trades.find({"user_id": user["id"]}, {"image_base64": 0}).sort("created_at", 1).to_list(3000)
    trades = [t for t in all_trades if t.get("taken", True) is not False and not t.get("pending")]
    total = len(trades)
    if total == 0:
        return {"total_trades": 0, "has_data": False}
    pnls = [t.get("pnl", 0) or 0 for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    total_pnl = sum(pnls)
    avg_win = gross_win / len(wins) if wins else 0
    avg_loss = -gross_loss / len(losses) if losses else 0
    # streaks
    cur = best_win = worst_loss = 0
    for p in pnls:
        if p > 0:
            cur = cur + 1 if cur > 0 else 1
            best_win = max(best_win, cur)
        elif p < 0:
            cur = cur - 1 if cur < 0 else -1
            worst_loss = min(worst_loss, cur)
        else:
            cur = 0
    # by weekday
    wd = defaultdict(lambda: {"pnl": 0.0, "trades": 0, "wins": 0})
    for t in trades:
        ca = t.get("created_at", "")
        try:
            d = datetime.fromisoformat(ca.replace("z", "").replace("Z", ""))
            idx = d.weekday()
        except Exception:
            continue
        p = t.get("pnl", 0) or 0
        wd[idx]["pnl"] += p
        wd[idx]["trades"] += 1
        if p > 0:
            wd[idx]["wins"] += 1
    by_weekday = [{"day": WEEKDAYS[i], "pnl": round(wd[i]["pnl"], 2), "trades": wd[i]["trades"],
                   "win_rate": round(wd[i]["wins"] / wd[i]["trades"] * 100) if wd[i]["trades"] else 0}
                  for i in range(7) if wd[i]["trades"] > 0]
    # by hour
    hb = defaultdict(lambda: {"pnl": 0.0, "trades": 0, "wins": 0})
    for t in trades:
        h = _parse_hour(t.get("trade_time"))
        if h is None:
            continue
        p = t.get("pnl", 0) or 0
        hb[h]["pnl"] += p
        hb[h]["trades"] += 1
        if p > 0:
            hb[h]["wins"] += 1
    def hlabel(h):
        ap = "AM" if h < 12 else "PM"
        hh = h % 12 or 12
        return f"{hh}{ap}"
    by_hour = [{"hour": hlabel(h), "pnl": round(hb[h]["pnl"], 2), "trades": hb[h]["trades"],
                "win_rate": round(hb[h]["wins"] / hb[h]["trades"] * 100) if hb[h]["trades"] else 0}
               for h in sorted(hb.keys())]
    # playbooks (per strategy)
    strategies = await db.strategies.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    pb = {s["id"]: {"name": s["name"], "pnl": 0.0, "trades": 0, "wins": 0} for s in strategies}
    for t in trades:
        p = t.get("pnl", 0) or 0
        for sid in (t.get("strategy_ids") or []):
            if sid in pb:
                pb[sid]["pnl"] += p
                pb[sid]["trades"] += 1
                if p > 0:
                    pb[sid]["wins"] += 1
    playbooks = sorted(
        [{"name": v["name"], "pnl": round(v["pnl"], 2), "trades": v["trades"],
          "win_rate": round(v["wins"] / v["trades"] * 100) if v["trades"] else 0,
          "avg": round(v["pnl"] / v["trades"], 2) if v["trades"] else 0}
         for v in pb.values() if v["trades"] > 0],
        key=lambda x: -x["pnl"])
    return {
        "has_data": True, "total_trades": total,
        "win_rate": round(len(wins) / total * 100, 1),
        "total_pnl": round(total_pnl, 2),
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else round(gross_win, 2),
        "expectancy": round(total_pnl / total, 2),
        "avg_win": round(avg_win, 2), "avg_loss": round(avg_loss, 2),
        "payoff_ratio": round(avg_win / abs(avg_loss), 2) if avg_loss else 0,
        "largest_win": round(max(pnls), 2), "largest_loss": round(min(pnls), 2),
        "best_win_streak": best_win, "worst_loss_streak": abs(worst_loss),
        "current_streak": cur,
        "by_weekday": by_weekday, "by_hour": by_hour, "playbooks": playbooks,
    }

# ---------- P&L Calendar ----------
@api.get("/dashboard/calendar")
async def dashboard_calendar(month: Optional[str] = None, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    if month:
        try:
            y, m = map(int, month.split("-"))
        except Exception:
            y, m = now.year, now.month
    else:
        y, m = now.year, now.month
    prefix = f"{y:04d}-{m:02d}"
    all_trades = await db.trades.find(
        {"user_id": user["id"], "created_at": {"$regex": f"^{prefix}"}}, {"pnl": 1, "created_at": 1, "taken": 1, "_id": 0}
    ).to_list(3000)
    days = defaultdict(lambda: {"pnl": 0.0, "trades": 0})
    for t in all_trades:
        if t.get("taken", True) is False:
            continue
        day = t.get("created_at", "")[:10]
        days[day]["pnl"] += t.get("pnl", 0) or 0
        days[day]["trades"] += 1
    out = {d: {"pnl": round(v["pnl"], 2), "trades": v["trades"]} for d, v in days.items()}
    month_pnl = round(sum(v["pnl"] for v in days.values()), 2)
    green = sum(1 for v in days.values() if v["pnl"] > 0)
    red = sum(1 for v in days.values() if v["pnl"] < 0)
    return {"month": prefix, "days": out, "month_pnl": month_pnl,
            "green_days": green, "red_days": red, "trading_days": len(days)}

# ---------- CSV import ----------
@api.post("/trades/import-csv")
async def import_csv(inp: ImportCsvIn, user=Depends(get_current_user)):
    import csv, io
    text = inp.csv.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty CSV")
    try:
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse CSV")
    if not rows:
        raise HTTPException(status_code=400, detail="No rows found in CSV")

    def norm(k):
        return re.sub(r"[^a-z0-9]", "", (k or "").lower())
    SYN = {
        "symbol": ["symbol", "ticker", "instrument", "sym"],
        "pnl": ["pnl", "pl", "profit", "profitloss", "netpnl", "net", "realized", "realizedpnl", "gain", "gainloss"],
        "date": ["date", "datetime", "time", "closedate", "closetime", "tradedate", "opened", "closed", "exittime"],
        "direction": ["side", "direction", "type", "action"],
        "entry": ["entry", "entryprice", "buyprice", "avgentry", "open", "openprice"],
        "exit": ["exit", "exitprice", "sellprice", "avgexit", "close", "closeprice"],
        "quantity": ["qty", "quantity", "size", "shares", "contracts", "volume"],
        "setup": ["setup", "strategy", "notes", "note", "tag"],
    }
    def pick(row, field):
        for cand in SYN[field]:
            for k in row:
                if norm(k) == cand:
                    return row[k]
        return None
    def pnum(v):
        if v is None:
            return None
        s = str(v).strip().replace("$", "").replace(",", "")
        neg = s.startswith("(") and s.endswith(")")
        s = s.strip("()")
        try:
            n = float(s)
            return -n if neg else n
        except Exception:
            return None

    # Free-tier remaining allowance
    remaining = None
    if effective_tier(user) == "free":
        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        cnt = await db.trades.count_documents({"user_id": user["id"], "created_at": {"$gte": month_start.isoformat()}})
        remaining = max(0, FREE_MONTHLY_LIMIT + user.get("bonus_trades", 0) - cnt)

    docs = []
    skipped = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    for row in rows:
        pnl = pnum(pick(row, "pnl"))
        sym = (pick(row, "symbol") or "").strip().upper()
        if pnl is None or not sym:
            skipped += 1
            continue
        # date
        created = now_iso
        raw_date = pick(row, "date")
        if raw_date:
            s = str(raw_date).strip()
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%m/%d/%Y %H:%M", "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y"):
                try:
                    created = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc).isoformat()
                    break
                except Exception:
                    continue
        direction = (pick(row, "direction") or "long").strip().lower()
        direction = "short" if direction in ("short", "sell", "s", "sold") else "long"
        docs.append({
            "id": str(uuid.uuid4()), "user_id": user["id"], "symbol": sym[:12],
            "asset_type": "stock", "direction": direction,
            "entry": pnum(pick(row, "entry")) or 0, "exit": pnum(pick(row, "exit")) or 0,
            "quantity": pnum(pick(row, "quantity")) or 1, "pnl": round(pnl, 2),
            "trade_time": None, "setup_grade": "C", "strategy_followed": True,
            "rule_violations": [], "detected_setup": (pick(row, "setup") or "Imported").strip()[:40] or "Imported",
            "ai_summary": "", "advanced": {}, "taken": True,
            "strategy_ids": [], "strategy_names": [], "strategy_id": None, "strategy_name": None,
            "source": "csv", "created_at": created,
        })
    if remaining is not None and len(docs) > remaining:
        docs = docs[:remaining]
        capped = True
    else:
        capped = False
    if docs:
        await db.trades.insert_many(docs)
    return {"imported": len(docs), "skipped": skipped, "capped": capped, "total_rows": len(rows)}

# ---------- GEX ingest + tracker ----------
class GexStrike(BaseModel):
    strike: float
    gex: float = 0
    call_oi: Optional[float] = None
    put_oi: Optional[float] = None

class GexIn(BaseModel):
    symbol: str
    spot: float
    timestamp: Optional[str] = None
    net_gex: float = 0
    flip_point: Optional[float] = None
    call_wall: Optional[float] = None
    put_wall: Optional[float] = None
    strikes: List[GexStrike] = []

def _clean_gex(d: dict) -> dict:
    d.pop("_id", None)
    return d

@api.post("/ingest/gex")
async def ingest_gex(inp: GexIn, x_ingest_key: str = Header(default="")):
    if not GEX_INGEST_KEY or not hmac.compare_digest(x_ingest_key, GEX_INGEST_KEY):
        raise HTTPException(status_code=401, detail="Invalid ingest key")
    sym = inp.symbol.upper().strip()
    if sym not in GEX_SYMBOLS:
        raise HTTPException(status_code=400, detail=f"Unsupported symbol {sym}. Allowed: {GEX_SYMBOLS}")
    now = datetime.now(timezone.utc).isoformat()
    doc = inp.model_dump()
    doc["symbol"] = sym
    doc["received_at"] = now
    if not doc.get("timestamp"):
        doc["timestamp"] = now
    await db.gex_snapshots.update_one({"symbol": sym}, {"$set": doc}, upsert=True)
    await db.gex_snapshots.update_one({"symbol": sym},
        {"$push": {"net_gex_history": {"$each": [{"t": doc["timestamp"], "v": doc["net_gex"]}], "$slice": -30}}})
    # Log one prediction record per (symbol, trading day) for the accuracy scorecard.
    day = doc["timestamp"][:10]
    await db.gex_daily.update_one(
        {"symbol": sym, "date": day},
        {"$set": {"symbol": sym, "date": day, "spot": inp.spot,
                  "net_gex": inp.net_gex, "flip_point": inp.flip_point,
                  "call_wall": inp.call_wall, "put_wall": inp.put_wall,
                  "updated_at": now}},
        upsert=True)
    return {"ok": True, "symbol": sym, "strikes": len(doc.get("strikes", []))}

@api.get("/gex")
async def gex_all(user=Depends(get_current_user)):
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="GEX Tracker is a Premium feature. Upgrade to unlock.")
    out = []
    for sym in GEX_SYMBOLS:
        d = await db.gex_snapshots.find_one({"symbol": sym})
        if d:
            out.append(_clean_gex(d))
    return {"symbols": GEX_SYMBOLS, "snapshots": out}

@api.get("/gex/scorecard")
async def gex_scorecard(user=Depends(get_current_user)):
    """Historical accuracy of GEX levels vs the next day's realized move.
    Pairs each day's prediction (walls/flip/regime) with the following day's spot."""
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="GEX Tracker is a Premium feature. Upgrade to unlock.")
    cards = []
    for sym in GEX_SYMBOLS:
        days = await db.gex_daily.find({"symbol": sym}).sort("date", 1).to_list(400)
        pairs = []
        for i in range(len(days) - 1):
            d, nx = days[i], days[i + 1]
            spot, nspot = d.get("spot"), nx.get("spot")
            if not spot or not nspot:
                continue
            realized_pct = (nspot - spot) / spot * 100
            cw, pw = d.get("call_wall"), d.get("put_wall")
            within = (pw <= nspot <= cw) if (cw and pw) else None
            regime = "positive" if (d.get("net_gex") or 0) >= 0 else "negative"
            pairs.append({"date": nx["date"], "realized_pct": round(realized_pct, 2),
                          "within_band": within, "regime": regime, "abs_move": abs(realized_pct)})
        band = [p for p in pairs if p["within_band"] is not None]
        band_acc = round(sum(1 for p in band if p["within_band"]) / len(band) * 100, 1) if band else None
        pos = [p["abs_move"] for p in pairs if p["regime"] == "positive"]
        neg = [p["abs_move"] for p in pairs if p["regime"] == "negative"]
        cards.append({
            "symbol": sym,
            "samples": len(pairs),
            "band_accuracy": band_acc,
            "band_samples": len(band),
            "avg_move_positive_gamma": round(sum(pos) / len(pos), 2) if pos else None,
            "avg_move_negative_gamma": round(sum(neg) / len(neg), 2) if neg else None,
            "recent": pairs[-5:][::-1],
        })
    return {"symbols": GEX_SYMBOLS, "cards": cards}

@api.get("/gex/{symbol}")
async def gex_one(symbol: str, user=Depends(get_current_user)):
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="GEX Tracker is a Premium feature. Upgrade to unlock.")
    sym = symbol.upper().strip()
    d = await db.gex_snapshots.find_one({"symbol": sym})
    if not d:
        raise HTTPException(status_code=404, detail="No GEX data for this symbol yet")
    return _clean_gex(d)

async def _gex_summary(sym: str) -> dict:
    """Plain-English gamma regime + walls for the Discord !gex command."""
    sym = (sym or "SPY").upper().strip()
    if sym not in GEX_SYMBOLS:
        return {"error": f"Unsupported symbol. Try one of: {', '.join(GEX_SYMBOLS)}."}
    d = await db.gex_snapshots.find_one({"symbol": sym})
    if not d:
        return {"empty": True, "symbol": sym}
    net = d.get("net_gex") or 0
    positive = net >= 0
    return {
        "symbol": sym,
        "spot": d.get("spot"),
        "net_gex": net,
        "flip_point": d.get("flip_point"),
        "call_wall": d.get("call_wall"),
        "put_wall": d.get("put_wall"),
        "regime": "Positive gamma" if positive else "Negative gamma",
        "implication": ("Dealers dampen moves — expect mean-reversion / pinning toward the walls."
                        if positive else
                        "Dealers amplify moves — expect trendier, more volatile price action."),
        "timestamp": d.get("timestamp"),
    }

@api.post("/user/send-test-digest")
async def send_test_digest(user=Depends(get_current_user)):
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="Weekly digest preview is a Premium feature.")
    if not (RESEND_API_KEY and RESEND_FROM_EMAIL):
        raise HTTPException(status_code=503, detail="Email is not configured yet.")
    email = (user.get("email") or "").lower()
    if not email or email.endswith("@bca.local"):
        raise HTTPException(status_code=400, detail="Add a real email to your account to receive the digest.")
    summary = await _compute_weekly_summary(user["id"])
    if not summary:
        raise HTTPException(status_code=400, detail="No trades in the last 7 days to summarize yet.")
    unsub_url = f"{PUBLIC_APP_URL}/api/unsubscribe?token={_make_unsub_token(user['id'])}" if PUBLIC_APP_URL else ""
    try:
        resend.Emails.send({
            "from": RESEND_FROM_EMAIL,
            "to": [email],
            "subject": "Your Weekly Trading Recap (Preview) 📈",
            "html": _digest_html(summary, unsub_url),
        })
    except Exception as e:
        msg = str(e)
        if "not verified" in msg:
            raise HTTPException(status_code=502, detail="Sending domain isn't verified in Resend yet. Verify it, then try again.")
        raise HTTPException(status_code=502, detail=f"Email failed: {msg[:180]}")
    return {"ok": True, "email": email}

# ---------- Market Sentiment (Premium) ----------
_sentiment_cache = {"ts": 0.0, "data": None}

async def _yahoo_chg(client, symbol):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1d"
    r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
    meta = r.json()["chart"]["result"][0]["meta"]
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    chg = ((price - prev) / prev * 100) if price and prev else 0.0
    return price, round(chg, 2)

def _sent_label(score):
    if score >= 15:
        return "Bullish"
    if score <= -15:
        return "Bearish"
    return "Neutral"

async def _build_sentiment():
    stocks = futures = crypto = options = None
    async with httpx.AsyncClient(timeout=12) as c:
        try:
            _, spchg = await _yahoo_chg(c, "^GSPC")
            vixp, _ = await _yahoo_chg(c, "^VIX")
            score = max(-100, min(100, spchg * 14 - max(0, (vixp or 0) - 18) * 2))
            stocks = {"cls": "Stocks", "label": _sent_label(score), "score": round(score),
                      "detail": f"S&P 500 {spchg:+.2f}% · VIX {vixp:.1f}" if vixp else f"S&P 500 {spchg:+.2f}%"}
        except Exception as e:
            logger.error(f"sent stocks {e}")
        try:
            es = await _yahoo_chg(c, "ES=F"); nq = await _yahoo_chg(c, "NQ=F"); cl = await _yahoo_chg(c, "CL=F")
            avg = (es[1] + nq[1]) / 2
            futures = {"cls": "Futures", "label": _sent_label(max(-100, min(100, avg * 14))),
                       "score": round(max(-100, min(100, avg * 14))),
                       "detail": f"ES {es[1]:+.2f}% · NQ {nq[1]:+.2f}% · CL {cl[1]:+.2f}%"}
        except Exception as e:
            logger.error(f"sent futures {e}")
        try:
            r = await c.get("https://api.alternative.me/fng/?limit=1")
            d = r.json()["data"][0]
            val = int(d["value"]); cls = d.get("value_classification", "")
            lbl = "Bullish" if val >= 60 else ("Bearish" if val <= 40 else "Neutral")
            crypto = {"cls": "Crypto", "label": lbl, "score": val, "detail": f"Fear & Greed {val} · {cls}"}
        except Exception as e:
            logger.error(f"sent crypto {e}")
    try:
        snaps = await db.gex_snapshots.find({}).to_list(10)
        if snaps:
            net = sum(s.get("net_gex", 0) for s in snaps)
            call_oi = sum((st.get("call_oi") or 0) for s in snaps for st in s.get("strikes", []))
            put_oi = sum((st.get("put_oi") or 0) for s in snaps for st in s.get("strikes", []))
            skew = ((call_oi - put_oi) / (call_oi + put_oi) * 50) if (call_oi + put_oi) else 0
            score = max(-100, min(100, skew + (10 if net > 0 else -10)))
            options = {"cls": "Options", "label": _sent_label(score), "score": round(score),
                       "detail": ("Positive gamma · vol dampened" if net > 0 else "Negative gamma · vol elevated")}
    except Exception as e:
        logger.error(f"sent options {e}")
    cards = [x for x in [stocks, options, futures, crypto] if x]
    return {"cards": cards, "as_of": datetime.now(timezone.utc).isoformat()}

@api.get("/sentiment")
async def get_sentiment(user=Depends(get_current_user)):
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="Market Sentiment is a Premium feature.")
    import time as _t
    now = _t.time()
    if _sentiment_cache["data"] and (now - _sentiment_cache["ts"] < 300):
        return _sentiment_cache["data"]
    data = await _build_sentiment()
    if data["cards"]:
        _sentiment_cache["ts"] = now
        _sentiment_cache["data"] = data
    return data

@api.get("/config")
async def config():
    return {"promo_active": promo_active(), "promo_end": PROMO_END.isoformat(),
            "discord_enabled": _discord_configured()}

app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=False, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

# Accounts that must always have permanent full (Premium) access.
def _load_seed_accounts() -> list:
    """Seed/admin accounts are read from the SEED_ACCOUNTS env var (server-side secret),
    formatted as 'email1:password1,email2:password2'. Never hard-coded in source."""
    raw = os.environ.get("SEED_ACCOUNTS", "").strip()
    accounts = []
    for part in raw.split(","):
        part = part.strip()
        if not part or ":" not in part:
            continue
        email, pw = part.split(":", 1)
        email, pw = email.strip(), pw.strip()
        if email and pw:
            accounts.append({"email": email, "password": pw})
    return accounts

PREMIUM_SEED_ACCOUNTS = _load_seed_accounts()

@app.on_event("startup")
async def seed_premium_accounts():
    """Idempotently ensure owner/admin accounts exist with permanent Premium access.
    Runs on every startup so access persists across deploys / fresh databases."""
    for acc in PREMIUM_SEED_ACCOUNTS:
        email = acc["email"].lower()
        existing = await db.users.find_one({"email": email})
        if existing:
            updates = {"subscription_tier": "premium"}
            if not existing.get("referral_code"):
                updates["referral_code"] = gen_referral_code()
            if not existing.get("account_balance"):
                updates["account_balance"] = 50000
            await db.users.update_one({"email": email}, {"$set": updates})
        else:
            doc = {
                "id": str(uuid.uuid4()), "email": email,
                "password_hash": hash_pw(acc["password"]),
                "subscription_tier": "premium", "account_balance": 50000,
                "referral_code": gen_referral_code(), "bonus_trades": 0,
                "referral_count": 0, "referred_by": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.users.insert_one(doc)
        logger.info("Premium seed ensured for %s", email)

@app.on_event("shutdown")
async def shutdown():
    client.close()
    if _discord_gateway is not None:
        try:
            await _discord_gateway.close()
        except Exception:
            pass

_discord_gateway = None

@app.on_event("startup")
async def start_discord_gateway():
    """Start a persistent Discord gateway bot for !stats / !leaderboard commands."""
    global _discord_gateway
    if not DISCORD_BOT_TOKEN or os.environ.get("DISCORD_BOT_GATEWAY", "1") != "1":
        logger.info("Discord gateway bot disabled (no token or DISCORD_BOT_GATEWAY!=1)")
        return
    try:
        _discord_gateway = _build_discord_client(db, _compute_stats, _compute_leaderboard, _gex_summary)
        asyncio.create_task(_discord_gateway.start(DISCORD_BOT_TOKEN))
        logger.info("Discord gateway bot starting…")
    except Exception as e:
        logger.error("discord gateway start err %s", e)
