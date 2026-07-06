from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, json, uuid, re
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
from urllib.parse import quote
stripe.api_key = os.environ.get('STRIPE_SECRET_KEY', '')
BACKEND_URL = os.environ.get('EXPO_BACKEND_URL') or ''
# Fixed server-side pricing (never trust client amounts). Amounts in cents.
STRIPE_PACKAGES = {
    "pro": {"name": "TradeMind Pro", "amount": 1999, "trial_days": 0},
    "premium": {"name": "TradeMind Premium", "amount": 4999, "trial_days": 7},
}
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
            "referral_count": u.get("referral_count", 0), "reward_pro_until": u.get("reward_pro_until")}

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
            await db.payments.update_one({"session_id": obj.get("id")},
                {"$set": {"status": "completed", "updated_at": datetime.now(timezone.utc).isoformat()}})
    elif etype == "customer.subscription.deleted":
        # Subscription ended/cancelled -> downgrade to free.
        await db.users.update_one({"stripe_subscription_id": obj.get("id")},
            {"$set": {"subscription_tier": "free", "stripe_subscription_id": None}})
    elif etype == "invoice.payment_failed":
        cust = obj.get("customer")
        if cust:
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
    return {"message": "TradeMind AI API"}

app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

@app.on_event("shutdown")
async def shutdown():
    client.close()
