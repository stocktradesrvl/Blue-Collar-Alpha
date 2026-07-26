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
