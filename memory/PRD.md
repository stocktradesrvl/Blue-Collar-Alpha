# TradeMind AI — Product Requirements Document

## Original Problem Statement
AI trading journal that acts like a personal trading coach (not just an analytics dashboard). Imports trades, computes stats, and uses AI to answer "Why am I losing?", "What setups work?", "What mistakes do I repeat?". MVP: import trades, P&L, win rate, avg winner vs loser, equity curve, best/worst times, group by strategy, AI session summary. Advanced: chart screenshot analysis (patterns, S/R, trend, A–F grade), conversational AI coach on user's own data, strategy builder with rule-violation checks, daily report. Pricing Free/Pro/Premium.

## User Choices (locked)
- Import method: **Screenshot from phone** (camera/gallery → AI extracts trade)
- AI features: **All** (session summary + daily report, coach chat, chart screenshot analysis)
- LLM: **Claude Sonnet 4.6** via Emergent universal key
- Strategy Builder: **Yes** (V1)
- Auth: **Email/password JWT** with tiers free/pro/premium

## Architecture
- Frontend: Expo Router (React Native), dark "Utility" theme (Rajdhani/DM Sans), Ionicons, bottom tabs. Token in secure storage via `@/src/utils/storage`.
- Backend: FastAPI + MongoDB (motor), JWT auth (bcrypt + python-jose), emergentintegrations LlmChat (anthropic claude-sonnet-4-6, vision + text, max_tokens capped at 1500 to stay under ingress timeout).
- All routes under `/api`.

## User Personas
- Active retail trader (stocks/options/futures) wanting accountability and to stop repeating mistakes.
- Mentor/coach reviewing a mentee's execution against a defined strategy.

## Core Requirements (static)
- Screenshot → trade extraction + A–F grade + rule violations + coach summary
- Dashboard stats + equity curve
- Journal (filter by grade) + trade detail
- Strategy builder (rules) with AI enforcement
- AI coach chat on own data; daily session report
- Subscription tiers with feature gating

## Implemented (2026-07-05)
- Feature batch (2026-07-06): trade **Taken/Missed toggle** (missed excluded from stats; Journal Executed/Missed tabs); editable **starting account balance**; **20 preset strategy templates** + multi-select strategies per trade; **change password** (auth playbook); pricing → **Pro $19.99 / Premium $49.99**; **Pre-Trade Grader** (Pro+; chart + strategies → grade A–F, best-fit, rules met/violated, disclaimers); options/futures advanced analysis. Backend: 84/84 tests pass.
- Referral system: unique code per user; signup w/ code → +20 bonus trades both sides; **milestone: 3 referrals → free 30-day Pro** (effective_tier, raw_tier preserved). Profile "Refer & Earn" card w/ native Share + stats + reward badge.
- Options/Futures advanced analysis: screenshot extraction returns `advanced` object (options: greeks/IV/overpaying/suggested strike+expiry; futures: MFE/MAE/hold time/profit-left) shown on Trade Detail.
- Full regression: **58/58 backend tests pass** (referral, milestone, effective-tier gating, advanced fields, payments, core).
- Auth: register/login/me, JWT, tier switching (free/pro/premium)
- Strategies: full CRUD
- Trades: analyze-screenshot (vision extract+grade+violations+summary), list w/ grade & strategy filters, detail, delete; free-tier 20/month limit
- analyze-chart (Pro-gated): trend/patterns/support/resistance/grade/analysis
- Dashboard stats: total/daily P&L, win rate, profit factor, avg winner/loser, equity curve, best setup/time
- Daily AI session report
- AI coach chat (Premium-gated) using user's trades+strategies as context; chat history persisted
- Frontend screens: Login/Register, Dashboard(+FAB, report, chart-analyze), Journal, Coach, Strategy Builder, Profile/Plans, Upload modal, Chart Analyze modal, Trade Detail, Report
- Camera/photo permissions declared (app.json)
- Backend tested: 19/24 initially; screenshot 502 (LLM latency) fixed via max_tokens cap → verified 200 in ~6s, dashboard/trades reflect data.
- **Stripe payments (2026-07-05):** Checkout (subscription mode) for Pro $29 / Premium $79 w/ 7-day trial on Premium; server-side fixed prices; /payments/create-checkout-session, /payments/redirect (deep-link back), /payments/status (server-verified fulfillment before granting tier), /payments/cancel (cancels Stripe sub + downgrade), /payments/webhook (checkout.session.completed, customer.subscription.deleted, invoice.payment_failed). 16/16 payment backend tests pass. Frontend: Profile upgrade buttons via expo-web-browser + Linking; trial badge; Downgrade-to-Free cancels the Stripe subscription.
- Requires STRIPE_WEBHOOK_SECRET set + webhook endpoint (/api/payments/webhook) configured in Stripe Dashboard AFTER deploy for auto-renewal/cancel events; preview uses secure session-polling.

## Backlog / Remaining
- P1: Options Greeks/IV analysis; Futures MFE/MAE, hold-time, "profit left on table"
- P1: Streaming coach responses (SSE) for token-by-token UX
- P1: CSV / broker import as alternate to screenshots
- P2: Team tier (shared journals for mentors)
- P2: Real payments (Stripe) for tier upgrades (currently instant switch)
- P2: Best/worst trading-time analytics need trade_time reliably parsed (bucket by hour)

## Next Tasks
1. Frontend UI validation via testing agent (flows: register→upload→detail→dashboard→strategy→tier upgrade→coach/chart).
2. Add Stripe for real subscriptions.
3. Options/futures-specific analysis fields.

## Personalization (2026-06): React Context (`src/context/AccentContext.tsx`) with 5 presets (Orange default, Gold, Green, Blue, Purple), persisted to AsyncStorage (`tm_accent`). Live-swaps app-wide (tab bar, FABs, gradient buttons, glows, chips, plan borders) without restart. Picker UI in Profile → Preferences. `useAccent()` hook exposes `{ theme, accentId, setAccentId }`.
- Dashboard backdrop picker (Cash/Gold/Charts) independent of accent (`src/appearance.ts`).

## AI Trade Debrief (2026-06): Claude (anthropic claude-sonnet-4-6, Emergent LLM Key) generates a per-trade debrief. Backend: `POST /api/trades/{id}/debrief` (generates went_right[], watch_out[], mistake_tags[] from fixed set, summary; persisted to trade doc under `debrief`; cached, `?regenerate=true` to refresh); `GET /api/dashboard/last-trade`. Frontend: Dashboard card (preview + tags + View/Generate CTA) → `/debrief/[id]` screen (auto-generates if missing, regenerate button, accent-themed).

## Mistake Trends (2026-06): `GET /api/dashboard/mistake-trends?window=30|all` aggregates debrief `mistake_tags` across trades → per-tag {count, total pnl}, ranked by frequency; excludes "Good Discipline" (returned as `good_count`). Frontend: Dashboard card (30D/All toggle, top 3 habits w/ frequency bars + $ P&L, "See all" → `/mistakes` full screen). Tested with 6 debriefed trades.

## Habit Alert (2026-06): Gentle amber Dashboard banner when any single mistake tag appears in 3+ trades within 30 days (e.g. "You've chased entries 4× in the last 30 days · -$X"). Reuses `mistake-trends?window=30`; tag→phrase map in index.tsx (`HABIT_PHRASES`). Dismissible; dismissal persists per `tag:count` signature (`tm_habit_alert_dismissed`) so it reappears only when the count grows. Taps through to `/mistakes`.

## Sound Lab (2026-06): In-app sound picker at Profile -> Preferences -> Sound Lab (app/soundlab.tsx). 3 real royalty-free recordings (Mixkit, no attribution) per action (Big Win/Cash, Coin, Refresh) in assets/sounds/lab/*.mp3. Tapping previews (previewSound, ignores mute) AND selects it as active sound (selectSound), persisted to tm_sound_select. playSound is selection-driven, defaulting to real recordings (replaces old disliked chaching.wav). Works in preview/Expo Go now; on device after a fresh build.

## Rebrand + Pricing (2026-07): Renamed app to "Blue Collar Alpha". New logo emblem generated from user asset into icon.png/adaptive-icon.png/splash-image.png/favicon.png/logo-mark.png (light bg #F1F5F8). Login/register use money-bg.jpg + emblem logo card. Pricing: Pro $17.99/mo (was 19.99), Premium $28.99/mo (was 49.99). Launch promo (PROMO_ACTIVE in server.py) discounts FIRST MONTH via one-time Stripe coupon: Pro $9.99, Premium $14.99; recurring reverts to full price. NOTE: removed Premium 7-day free trial in favor of the promo first-month price. Verified: Stripe first charge = $9.99 (pro). Icons/splash need a fresh native build to show on device.

## Pricing update (2026-07): Restored Premium 7-day free trial (trial_days=7) which now STACKS with promo coupon (7 days free -> $14.99 first invoice -> $28.99 recurring). Added green diagonal "LAUNCH DEAL" corner ribbon to promo plan cards (Pro & Premium) in profile.tsx (styles.ribbon, overflow hidden on .plan).

## Analytics + Coach features (2026-07): 
- Metrics: GET /api/dashboard/metrics (profit_factor, expectancy, avg_win/loss, payoff, streaks, by_weekday, by_hour, playbooks) -> app/metrics.tsx.
- P&L Calendar: GET /api/dashboard/calendar?month=YYYY-MM (daily heatmap, month_pnl, green/red) -> app/calendar.tsx.
- CSV import: POST /api/trades/import-csv (flexible column mapping, free-tier cap) -> app/import.tsx.
- Daily loss limit: POST /api/user/settings {daily_loss_limit}; red Dashboard banner when day P&L <= -limit; Profile input.
- Emotion tagging: PUT /api/trades/{id}/emotion (8 emotions) -> chips on Trade Detail; fed into debrief ctx.
- Playbook stats included in metrics (per-strategy). Dashboard nav buttons: metrics-btn, calendar-btn, import-btn.
- Verified: 13/13 backend pytest + 6/6 frontend E2E (iteration_7.json). expo-document-picker installed.

## Discord OAuth2 + Auto-Role (2026-07):
- Scope: `identify` only (users join server manually; we grant the subscriber role). Discord creds in backend/.env (DISCORD_CLIENT_ID/SECRET/BOT_TOKEN/GUILD_ID/ROLE_ID). Client ID 1531047271498780723, Guild 1531043083766993027, Role 1531048547254800477.
- Backend: POST /api/auth/discord/link-url (auth) + GET /api/auth/discord/login-url (public) build authorize URLs with signed-JWT state {mode,uid?,rt,redirect}. GET /api/auth/discord/callback exchanges code via httpx, fetches /users/@me, then LINK mode saves discord_id/discord_username to user (grants role if paid) or LOGIN mode finds/creates user (email discord_<id>@bca.local) and redirects to app returnUrl with ?token=<jwt>. POST /api/auth/discord/unlink revokes role + unsets fields. Role grant/revoke via bot token PUT/DELETE guilds/{g}/members/{uid}/roles/{r}.
- Wired into payments: checkout.session.completed webhook + /payments/status grant role if linked; customer.subscription.deleted, invoice.payment_failed, and /payments/cancel revoke role. /api/config now returns discord_enabled.
- Frontend: DiscordLoginButton ("Continue with Discord") on login + register (auto-hides if not configured); Community card in Profile links/unlinks Discord. AuthContext exposes discord_id/discord_username + loginWithToken(token).
- Verified: 16/16 backend tests (iteration_8.json). NOTE: live role grant/revoke requires a real guild member and cannot be verified in preview; test on a real Discord account after deploy.
- Next queued: GEX Tracker & Options Heatmap ingest (POST /api/ingest/gex, Premium-gated screens); weekly summary emails (Resend).

## GEX Tracker & Options Heatmap (2026-07):
- Ingest: POST /api/ingest/gex — key-protected via header `X-Ingest-Key` (== backend/.env GEX_INGEST_KEY). One symbol per request; upserts latest snapshot per symbol into `gex_snapshots` (keyed by symbol). Symbols: SPY, SPX, XSP. Payload schema {symbol, spot, timestamp?, net_gex, flip_point, call_wall, put_wall, strikes:[{strike,gex,call_oi?,put_oi?}]}. Returns {ok,symbol,strikes}.
- Read (Premium-gated, 402 else): GET /api/gex (all latest snapshots) + GET /api/gex/{symbol}.
- Frontend: app/gex.tsx — symbol tabs, Net GEX (green positive=suppressed vol / red negative=amplified vol), spot, Gamma Flip / Call Wall / Put Wall cards, Strike Gamma Heatmap (bars colored by gex sign, wall-tagged), pull-to-refresh, Premium lock screen w/ upgrade CTA. Dashboard entry: gex-btn -> /gex.
- Next queued: weekly summary emails (Resend).
- Dashboard "GEX · At a Glance" widget (2026-07): Premium-only card on Dashboard showing net GEX (color-coded) + flip level for SPY/SPX/XSP; taps through to /gex. Fetched via GET /api/gex in dashboard load(); hidden for non-premium (402) or when no snapshots exist. testID gex-glance.
- GEX upgrade teaser + stale indicator (2026-07): (a) Non-premium users see a locked "GEX · Options Heatmap · PREMIUM" teaser card (testID gex-teaser) on the Dashboard — shown in BOTH empty and populated states — that taps to Profile/upgrade. (b) GEX screen shows an amber "Data may be stale" banner + amber "Updated" text when the selected symbol's snapshot is older than 26h (daily push cadence). Verified both via screenshots.
- Glance stale badge + test-digest (2026-07): (1) Dashboard "GEX · At a Glance" widget shows a header "⚠ STALE" pill when any snapshot >26h old, and per-symbol "stale" (amber) replaces the flip level for that symbol (isStaleSnap, GEX_STALE_MS). (2) POST /api/user/send-test-digest (Premium-gated): emails the current user their own weekly recap on demand (400 if no real email / no trades in 7d; friendly 502 if Resend domain unverified). Profile button "Send me a test recap now" (testID send-test-digest), shown for premium + digest-on. Verified: 400 no-trades, 502 domain-not-verified, UI renders.

## Weekly Digest Emails via Resend (2026-07):
- Integration: Resend Python SDK (resend==2.34.0). Keys in backend/.env: RESEND_API_KEY, RESEND_FROM_EMAIL ("Blue Collar Alpha <russelllewis@montanahorizonventuresllc.com>"). resend.api_key set at startup.
- Send endpoint: POST /api/jobs/send-weekly-digest, protected by header X-Ingest-Key (== GEX_INGEST_KEY, reused for the Pi cron). Iterates users with weekly_digest_enabled != False, skips placeholder @bca.local emails and users with no trades in last 7 days; sends per-user HTML recap via resend.Emails.send. Returns {ok,sent,skipped,failed,total_users}. Failures are caught per-user (won't abort the batch).
- Digest content: _compute_weekly_summary(uid) (this-week trades/pnl/win_rate/best/worst, top setup, rule violations, WR delta vs last week) -> _digest_html() branded HTML.
- Opt-in: weekly_digest_enabled defaults True; PUT via POST /api/user/settings {weekly_digest_enabled}. public_user exposes it. Profile toggle "Weekly Email Recap" (digest-toggle).
- STATUS: LIVE ✅ — Resend domain montanahorizonventuresllc.com verified; working API key (re_fEid3796…) from the matching account is set in backend/.env. Confirmed real delivery (direct send + in-app POST /api/user/send-test-digest both returned success). From-name: "Blue Collar Alpha".
- Unsubscribe: GET /api/unsubscribe?token=<signed JWT purpose:unsub, 365d> sets weekly_digest_enabled=False and returns a branded HTML confirmation page (invalid/expired token -> friendly error page). Digest footer includes a one-tap unsubscribe link built from PUBLIC_APP_URL (backend .env, defaults to preview URL) or an optional `base_url` query param on the send endpoint (Pi can pass its production URL). Verified: invalid token -> error page; valid token -> opts out + confirms.

## Modal Queue + Community/Voice/GEX-Scorecard (2026-06 fork):
- MODAL QUEUE (P0): src/context/ModalQueue.tsx (ModalQueueProvider + useModalSlot(key,priority,wantsToShow)->{isActive,dismiss}). Only ONE login modal shows at a time. Priorities: WhatsNew=1, MarketSentiment/DailyQuote=2, Reconcile=3. Provider added to app/_layout.tsx; WhatsNewModal/DailyQuoteModal/MarketSentimentModal + dashboard ReconcileModal all refactored to use it. Fixes recurring e2e overlay-timeout. Also added PREVIEW AUTO-LOGIN: AuthContext auto signs-in when EXPO_PUBLIC_PREVIEW_AUTOLOGIN=1 using EXPO_PUBLIC_PREVIEW_EMAIL/PASSWORD (frontend/.env). SET TO 0 BEFORE SHIPPING.
- PHASE 5 DISCORD COMMUNITY: (a) Opt-in toggles in Profile Discord section (only when linked): discord_share_wins, leaderboard_optin -> POST /api/user/settings; exposed in public_user. (b) Auto-post wins: post_win_to_discord fires on winning taken screenshot trades (asyncio task) to DISCORD_WINS_CHANNEL_ID (=1531681734268158134) via bot token embed; no-op if channel unset. (c) Bot-key endpoints (header x-bot-key == DISCORD_BOT_KEY in .env): GET /api/discord/bot/stats?discord_id=, GET /api/discord/bot/leaderboard (anonymized alias Trader-XXXX via anon_alias, opt-in + >=3 trades/window). (d) PERSISTENT BOT: backend/discord_bot.py (discord.py 2.7.1) runs in-process via startup asyncio task (start_discord_gateway, toggle DISCORD_BOT_GATEWAY=1), message commands !stats/!leaderboard reusing DISCORD_BOT_TOKEN. REQUIRES "Message Content Intent" enabled in Discord Developer Portal (currently raises PrivilegedIntentsRequired until enabled — isolated, does not crash backend).
- PHASE 7 VOICE JOURNALING: POST /api/coach/transcribe (Premium-gated) {audio_base64,ext,summarize} -> Whisper via emergentintegrations OpenAISpeechToText (whisper-1, open FILE OBJECT not path) using EMERGENT_LLM_KEY; optional 1-line AI coaching summary. Frontend: src/hooks/useVoiceNote.ts (expo-audio recorder + expo-file-system/legacy base64 + permission contract) + mic button on Coach input (coach-mic) fills chat input. app.json: iOS NSMicrophoneUsageDescription + Android RECORD_AUDIO + expo-audio plugin microphonePermission. NEEDS NATIVE BUILD to test mic. ("Ask my journal"=existing coach chat; emotion/streak insights=Phase 4.)
- GEX ACCURACY SCORECARD: ingest_gex now logs one gex_daily doc per (symbol,date). GET /api/gex/scorecard (Premium, declared BEFORE /gex/{symbol}) pairs consecutive daily records: band_accuracy (next-day spot within put/call walls), avg abs move by +/- gamma regime, recent 5 days. Frontend: Scorecard component in app/gex.tsx. 0DTE/multi-expiry toggle DEFERRED (Pi sends aggregate net_gex only for now).
- Refactor: extracted _compute_stats(uid,balance) (used by dashboard + bot stats) and _compute_leaderboard(window,limit) (endpoint + bot).
- Backend tests: iteration_12.json 15/15 (Phase5+7). New env in backend/.env: DISCORD_WINS_CHANNEL_ID, DISCORD_BOT_KEY (=QTG2TRP2Of_-J5q6JDmwQ6_zel8cTX__8aXL_pr1y-4).

## Security Hardening (2026-06 fork, pre-Play-Store):
Applied after a security audit; verified 24/24 backend tests (iter13_security).
- SEC-001 /api/auth/tier is DOWNGRADE-ONLY (tier=='free'); paid tiers granted ONLY via Stripe (/payments/status + webhook). Frontend only ever calls setTier("free").
- SEC-002 REMOVED preview auto-login + bundled admin creds. Deleted EXPO_PUBLIC_PREVIEW_* from frontend/.env and reverted AuthContext.bootstrap to no auto-login (login screen shows again; token persists in storage after first login).
- SEC-003 JWT_SECRET fail-closed at import (server.py:26-28, raises if missing/<16 chars); removed 'dev_secret' fallback. Added .env to .gitignore (root) for backend+frontend.
- SEC-004 New _safe_redirect_response(rt,params,msg): allowlists schemes (APP_SCHEME='frontend', exp/exps, http(s) only for PUBLIC_APP_URL/BACKEND_URL host or *.emergentagent.com / *.emergent.host); escapes HTML attr via html.escape and JS string via json.dumps + <,>,& -> \u-escape. Applied to /payments/redirect and _discord_app_redirect. javascript:/data:/evil hosts -> plain page, no redirect.
- Hardening: hmac.compare_digest for GEX_INGEST_KEY + DISCORD_BOT_KEY; CORS allow_credentials=False (bearer-token auth). Seed/admin accounts moved OUT of source into backend/.env SEED_ACCOUNTS ("email:pw,email:pw"); parsed by _load_seed_accounts().
- Residual (needs user action, not code): set STRIPE_WEBHOOK_SECRET in prod (webhook fails closed w/ 400 until then — safe); rotate live keys if the repo was ever exposed.
- Security test file: /app/backend/tests/test_security_fixes.py

## Independent auto-refresh + full empty-state dashboard (2026-08 fork):
- AUTO-REFRESH: new hook /app/frontend/src/hooks/useAutoRefresh.ts — loads on focus, polls on an interval while focused, refreshes on AppState 'active', cleans up on blur. Each screen owns its loader (independent, not chained). Applied to: dashboard/index.tsx (30s, replaces the load useFocusEffect; kept backdrop useFocusEffect; added reconcilePrompted ref so polling doesn't reopen the Reconcile modal), gex.tsx (20s), balances.tsx (30s), gameplan.tsx (30s), journal.tsx (45s), strategy.tsx (45s). Coach left focus-only (avoid clobbering chat).
- FULL EMPTY-STATE DASHBOARD: index.tsx no longer hides the layout when a user has 0 trades. Added `s` (zeroed stats fallback) and a flat baseline equity curve ([bal,bal]) so with no trades the screen still shows: hero balance ($ default 10000), a compact "No trades yet" hint card, Equity Curve (flat, $0.00), all StatCards (0s), all action buttons (Session Report/Analyze/Grade/Metrics/Calendar/Import/GEX/Balances/Game Plan), GEX widget/teaser, upgrade nudge. Replaced the old `{empty ? minimal : full}` ternary with `{empty && hint}` + always-rendered full content; replaced non-optional `stats.` with `s.` (win_rate, profit_factor, avg_winner, avg_loser, total_pnl, best_setup, best_hour). Verified via screenshot with a fresh free account.

## Pricing update + Forgot Password (2026-08 fork):
- PRICING (server-side PRICING dict, cents): pro 1499 (promo 999), premium 2499 (promo 1999, 7-day trial), pro_annual 16489, premium_annual 27489 (one month free = 11x monthly). Frontend paywall display updated in profile.tsx PLANS. Existing subs grandfathered (checkout uses price_data per session; not retroactive).
- FORGOT PASSWORD (opaque single-use code via Resend, per integration_expert playbook): POST /api/auth/password-reset/request {email} -> always 202 generic (no enumeration), IP rate-limited (10/15min); generates 6-char A-Z2-9 code, stores SHA-256(email:code) in db.password_resets w/ 20-min expiry, deletes prior codes, emails code via Resend. POST /api/auth/password-reset/confirm {email,code,new_password} -> atomic find_one_and_delete on code_hash+expiry, updates bcrypt hash. Verified: old pw 401 / new pw 200 after reset; bad code 400. Frontend: app/(auth)/forgot-password.tsx (2-step: email -> code+new pw), "Forgot password?" link on login.tsx. No deep links needed (code entered manually).

## STILL TODO (confirmed, next build): Coach share-flow
- When a screenshot is shared to Coach: Coach analyzes, then asks "Did you take this trade?" with 3 options: (a) I took it -> save as EXECUTED trade, status OPEN/PENDING (user fills outcome/P&L later), (b) Just an idea -> save as idea (taken=false) in Journal, and ASK EACH TIME whether to also run Pre-Trade Grader, (c) Just coach me (don't save). Add a Profile setting to REMEMBER the default choice (took-it vs idea vs ask). Ideas live in the Journal (taken=false filter).

## Coach share-flow (2026-08 fork) — DONE:
- After a screenshot is shared to Coach and analyzed, Coach asks "Did you take this trade?" with 3 actions:
  * shared-took -> POST /api/trades/analyze-screenshot {taken:true, pending:true} = executed OPEN trade (fill P&L later). ScreenshotIn now has `pending: bool=False`; trade doc stores `pending`.
  * shared-idea -> POST /api/trades/analyze-screenshot {taken:false} = idea in Journal; then Alert asks EACH TIME "Grade this setup?" -> optional POST /api/analyze/pretrade.
  * shared-skip -> coach only, no save.
- "Remember my choice" checkbox persists default to AsyncStorage key bca_share_default ("took"|"idea"|"ask"); when set, future shares auto-save without prompting. Header shows a resettable chip ("Shared shots auto-save as trades/ideas · Reset") to clear back to ask. All in app/(tabs)/coach.tsx.
- Verified: both save paths (took->taken/pending true, idea->taken false) via API; coach screen bundles/renders. Native share-sheet trigger requires a build (not testable in preview).
- Minor known cosmetic: coach image-analysis reply contains markdown (##/**), rendered literally in the chat bubble.

## Coach markdown cleanup (2026-08 fork) — DONE:
- Added CoachText component in coach.tsx: renders the coach's light markdown (## headings -> bold heading, **bold** -> bold spans, -/* bullets -> •) as clean text. Applied to assistant bubbles. Verified: no raw ## or ** in rendered chat.

## Ideas Filter + Close The Trade (2026-08 fork) — DONE:
- IDEAS FILTER: already satisfied by the Journal "Missed / Ideas" tab (taken=false); coach "idea" shares (taken=false) show there.
- CLOSE THE TRADE: open/pending trades (pending=true, from "I took it" shares) show an OPEN pill + "Add outcome" button in the Journal Executed tab. New PUT /api/trades/{tid}/close {pnl} sets pnl, pending=false, taken=true (and fires win-to-Discord if profit). Close modal (numeric input) in journal.tsx. Stats now EXCLUDE pending trades (added `and not t.get("pending")` to all taken filters in _compute_stats/streak/emotion) so open trades don't skew win rate until closed. Verified: close endpoint (pnl set, pending cleared) + UI (OPEN pill, Add outcome, modal).
