from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Header
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, json, uuid, re, httpx
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import bcrypt
from jose import jwt, JWTError
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
JWT_SECRET = os.environ.get('JWT_SECRET', 'dev_secret')
import stripe
from fastapi import Request
from fastapi.responses import HTMLResponse
from urllib.parse import quote, urlencode
stripe.api_key = os.environ.get('STRIPE_SECRET_KEY', '')
BACKEND_URL = os.environ.get('EXPO_BACKEND_URL') or ''

# ---------- Discord config ----------
DISCORD_CLIENT_ID = os.environ.get('DISCORD_CLIENT_ID', '')
DISCORD_CLIENT_SECRET = os.environ.get('DISCORD_CLIENT_SECRET', '')
DISCORD_BOT_TOKEN = os.environ.get('DISCORD_BOT_TOKEN', '')
DISCORD_GUILD_ID = os.environ.get('DISCORD_GUILD_ID', '')
DISCORD_ROLE_ID = os.environ.get('DISCORD_ROLE_ID', '')
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

STRIPE_PACKAGES = {
    "pro": {"name": "Blue Collar Alpha Pro", "amount": 1799, "promo_amount": 999, "trial_days": 0},
    "premium": {"name": "Blue Collar Alpha Premium", "amount": 2899, "promo_amount": 1499, "trial_days": 7},
}
_promo_coupons: dict = {}  # cache: off_cents -> coupon id
ALGO = "HS256"
TIER_LEVEL = {"free": 0, "pro": 1, "premium": 2}
FREE_MONTHLY_LIMIT = 20
REFERRAL_MILESTONE = 3          # invite 3 friends -> free month of Pro
REWARD_PRO_DAYS = 30

app = FastAPI()
api = APIRouter(prefix="/api")
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

def effective_tier(u: dict) -> str:
    base = u.get("subscription_tier", "free")
    rp = u.get("reward_pro_until")
    if rp:
        try:
            if datetime.fromisoformat(rp) > datetime.now(timezone.utc) and TIER_LEVEL[base] < 1:
                base = "pro"
        except Exception:
            pass
    return base

def public_user(u: dict) -> dict:
    return {"id": u["id"], "email": u["email"], "subscription_tier": effective_tier(u),
            "raw_tier": u.get("subscription_tier", "free"),
            "account_balance": u.get("account_balance", 10000),
            "referral_code": u.get("referral_code"), "bonus_trades": u.get("bonus_trades", 0),
            "referral_count": u.get("referral_count", 0), "reward_pro_until": u.get("reward_pro_until"),
            "daily_loss_limit": u.get("daily_loss_limit", 0),
            "weekly_digest_enabled": u.get("weekly_digest_enabled", True),
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
async def register(inp: RegisterIn):
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
            # Milestone: invite REFERRAL_MILESTONE friends -> free month of Pro
            if new_count % REFERRAL_MILESTONE == 0:
                until = datetime.now(timezone.utc) + timedelta(days=REWARD_PRO_DAYS)
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
async def login(inp: LoginIn):
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
    if inp.tier not in TIER_LEVEL:
        raise HTTPException(status_code=400, detail="Invalid tier")
    await db.users.update_one({"id": user["id"]}, {"$set": {"subscription_tier": inp.tier}})
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

@api.post("/user/balance")
async def set_balance(inp: BalanceIn, user=Depends(get_current_user)):
    if inp.balance < 0:
        raise HTTPException(status_code=400, detail="Balance cannot be negative")
    await db.users.update_one({"id": user["id"]}, {"$set": {"account_balance": inp.balance}})
    u = await db.users.find_one({"id": user["id"]})
    return public_user(u)

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

async def grant_role_if_linked(uid: str):
    u = await db.users.find_one({"id": uid})
    if u and u.get("discord_id"):
        await discord_set_role(u["discord_id"], True)

async def revoke_role_by_query(query: dict):
    u = await db.users.find_one(query)
    if u and u.get("discord_id"):
        await discord_set_role(u["discord_id"], False)

def _discord_app_redirect(rt: str, params: dict) -> HTMLResponse:
    if not rt:
        return HTMLResponse("<html><body style='background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding-top:80px'><p>Discord linked. You can close this window and return to the app.</p></body></html>")
    sep = "&" if "?" in rt else "?"
    target = rt + sep + urlencode(params)
    return HTMLResponse(f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url={target}"><title>Redirecting…</title></head>
<body style="background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding-top:80px">
<p>Discord connected. Returning to the app…</p>
<a href="{target}" style="color:#5865F2">Tap here if not redirected</a>
<script>window.location.href="{target}";</script></body></html>""")

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
        {"$unset": {"discord_id": "", "discord_username": ""}})
    u = await db.users.find_one({"id": user["id"]})
    return public_user(u)

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
        "strategy_ids": [s["id"] for s in strategies],
        "strategy_names": [s["name"] for s in strategies],
        "strategy_id": strategies[0]["id"] if strategies else None,
        "strategy_name": strategies[0]["name"] if strategies else None,
        "image_base64": inp.image_base64,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.trades.insert_one(doc)
    return clean_trade(doc)

@api.put("/trades/{tid}/taken")
async def set_trade_taken(tid: str, inp: TakenIn, user=Depends(get_current_user)):
    res = await db.trades.update_one({"id": tid, "user_id": user["id"]}, {"$set": {"taken": inp.taken}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    t = await db.trades.find_one({"id": tid})
    return clean_trade(t)

# ---------- AI Trade Debrief ----------
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
@api.get("/dashboard/stats")
async def dashboard(user=Depends(get_current_user)):
    all_trades = await db.trades.find({"user_id": user["id"]}).sort("created_at", 1).to_list(1000)
    # Only executed trades count toward performance stats.
    trades = [t for t in all_trades if t.get("taken", True) is not False]
    total = len(trades)
    if total == 0:
        return {"total_trades": 0, "total_pnl": 0, "daily_pnl": 0, "win_rate": 0,
                "profit_factor": 0, "avg_winner": 0, "avg_loser": 0, "account_balance": user.get("account_balance", 10000),
                "equity_curve": [], "best_setup": None, "worst_setup": None, "best_hour": None, "worst_hour": None}
    wins = [t for t in trades if t.get("pnl", 0) > 0]
    losses = [t for t in trades if t.get("pnl", 0) < 0]
    total_pnl = sum(t.get("pnl", 0) for t in trades)
    gross_win = sum(t.get("pnl", 0) for t in wins)
    gross_loss = abs(sum(t.get("pnl", 0) for t in losses))
    today = datetime.now(timezone.utc).date().isoformat()
    daily_pnl = sum(t.get("pnl", 0) for t in trades if t.get("created_at", "").startswith(today))
    # equity curve
    bal = user.get("account_balance", 10000)
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

# ---------- Weekly recap ----------
@api.get("/dashboard/weekly")
async def weekly_recap(user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    two_weeks = (now - timedelta(days=14)).isoformat()
    trades = await db.trades.find({"user_id": user["id"]}).to_list(2000)
    taken = [t for t in trades if t.get("taken", True) is not False]

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
    taken = [t for t in trades if t.get("taken", True) is not False]
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
    return {"tw": tw, "lw": lw, "best_setup": best_setup,
            "best_setup_pnl": round(setup_pnl.get(best_setup, 0), 2) if best_setup else 0,
            "violations": violations}

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
    if not GEX_INGEST_KEY or x_ingest_key != GEX_INGEST_KEY:
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
@api.post("/coach/chat")
async def coach_chat(inp: ChatIn, user=Depends(get_current_user)):
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

# ---------- Stripe payments ----------
class CheckoutIn(BaseModel):
    tier: str
    origin: str
    return_url: str

@api.post("/payments/create-checkout-session")
async def create_checkout(inp: CheckoutIn, user=Depends(get_current_user)):
    tier = inp.tier.lower()
    if tier not in STRIPE_PACKAGES:
        raise HTTPException(status_code=400, detail="Invalid plan")
    pkg = STRIPE_PACKAGES[tier]
    success_url = f"{inp.origin}/api/payments/redirect?rt={quote(inp.return_url)}&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{inp.origin}/api/payments/redirect?rt={quote(inp.return_url)}&status=cancel"
    sub_data = {"trial_period_days": pkg["trial_days"]} if pkg["trial_days"] > 0 else {}
    # Launch promo: first month discounted via a one-time coupon (amount_off).
    discounts = []
    promo = pkg.get("promo_amount")
    if promo_active() and promo and promo < pkg["amount"]:
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
                    "recurring": {"interval": "month"},
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
async def payment_redirect(rt: str, session_id: str = "", status: str = ""):
    sep = "&" if "?" in rt else "?"
    target = f"{rt}{sep}session_id={quote(session_id)}&status={status or 'success'}"
    return HTMLResponse(f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url={target}"><title>Redirecting…</title></head>
<body style="background:#121212;color:#fff;font-family:sans-serif;text-align:center;padding-top:80px">
<p>Payment {'cancelled' if status=='cancel' else 'complete'}. Returning to the app…</p>
<a href="{target}" style="color:#FFB74D">Tap here if not redirected</a>
<script>window.location.href="{target}";</script></body></html>""")

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
        await db.payments.update_one({"session_id": session_id},
            {"$set": {"status": "completed", "stripe_subscription_id": session.get("subscription"),
                      "stripe_customer_id": session.get("customer"),
                      "updated_at": datetime.now(timezone.utc).isoformat()}})
        await db.users.update_one({"id": user["id"]}, {"$set": {
            "subscription_tier": tier, "stripe_subscription_id": session.get("subscription"),
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
        {"$set": {"subscription_tier": "free", "stripe_subscription_id": None}})
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
            await db.users.update_one({"id": uid}, {"$set": {
                "subscription_tier": tier, "stripe_subscription_id": obj.get("subscription"),
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
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    u = await db.users.find_one({"id": user["id"]})
    return public_user(u)

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
    trades = [t for t in all_trades if t.get("taken", True) is not False]
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
    if not GEX_INGEST_KEY or x_ingest_key != GEX_INGEST_KEY:
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

@api.get("/gex/{symbol}")
async def gex_one(symbol: str, user=Depends(get_current_user)):
    if TIER_LEVEL.get(effective_tier(user), 0) < 2:
        raise HTTPException(status_code=402, detail="GEX Tracker is a Premium feature. Upgrade to unlock.")
    sym = symbol.upper().strip()
    d = await db.gex_snapshots.find_one({"symbol": sym})
    if not d:
        raise HTTPException(status_code=404, detail="No GEX data for this symbol yet")
    return _clean_gex(d)

@api.get("/config")
async def config():
    return {"promo_active": promo_active(), "promo_end": PROMO_END.isoformat(),
            "discord_enabled": _discord_configured()}

app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

# Accounts that must always have permanent full (Premium) access.
PREMIUM_SEED_ACCOUNTS = [
    {"email": "stocktradesrvl@gmail.com", "password": "TradeAdmin123"},
    {"email": "owner@trademind.ai", "password": "Owner1234"},
]

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
