# Blue Collar Alpha — Ideas Backlog (running tab)

> Brainstorm only. Nothing here is built until explicitly greenlit.
> Legend: [ ] idea · [~] discussing · [>] queued to build · [x] shipped

## GEX / Options Intelligence  — ALL QUEUED
- [>] Expected-move band (spot ± wall distance) — extend to glance widget
- [>] GEX intraday history sparkline per symbol — multi-day extension
- [>] GEX "regime" banner: Positive vs Negative gamma with plain-English trade implications
- [>] Flip-level proximity alert: notify when spot crosses the gamma flip
- [>] Wall-break alert: price closes beyond call/put wall
- [~] 0DTE vs multi-expiry GEX toggle — DEFERRED: Pi currently sums all expiries into one net_gex; needs per-expiry breakdown in ingest payload first (user will add when we're ready to consume it)
- [x] Historical GEX vs next-day realized move accuracy scorecard — /api/gex/scorecard + gex.tsx card; daily snapshots logged to gex_daily on every ingest

## AI Coaching / Journaling — ALL QUEUED
- [x] Voice-note trade journaling (speech-to-text via Whisper) with AI summary — mic on Coach screen (Premium)
- [x] Weekly AI "game plan" generated from last week's mistakes + upcoming GEX levels
- [ ] Trade replay: annotate the screenshot with AI-detected entry/exit quality (covered largely by AI Debrief)
- [x] "Ask my journal" — chat over the user's own trade history (AI Coach chat)
- [x] Emotion vs P&L correlation insights (tie existing emotion tags to outcomes)
- [x] Rule-adherence streak tracking + nudges

## Analytics / Dashboards
- [ ] R-multiple / expectancy metrics
- [ ] Time-of-day and day-of-week performance heatmap
- [ ] Setup performance leaderboard (win rate + expectancy per setup)
- [ ] Drawdown curve + max adverse excursion
- [ ] Tag/strategy filter across all dashboards

## Community / Discord — ALL QUEUED
- [x] Discord OAuth link + auto subscriber role on subscribe
- [x] Discord welcome DM on subscribe
- [x] Post user's opted-in wins to a #wins channel (with consent toggle) — needs DISCORD_WINS_CHANNEL_ID set
- [x] Discord slash command to pull your own stats — bot-key protected /api/discord/bot/stats
- [x] Leaderboard channel (opt-in, anonymized handles) — /api/discord/bot/leaderboard (Trader-XXXX aliases)

## Monetization / Retention — ALL QUEUED
- [x] Free/Pro/Premium tiers + Stripe
- [x] GEX Premium teaser on dashboard
- [x] Annual plan option (discount vs monthly)
- [x] Referral rewards expansion (tiered milestones)
- [>] Free-trial of Premium (X days) with auto-downgrade
- [x] "Upgrade nudge" when free user hits a gated feature repeatedly

## Multi-Broker Balance Reconciliation — SHIPPED ✅
Goal: track cash/account balances across multiple brokers, reconcile on login.
- [>] Add per-broker balance lines: Robinhood, Webull, Tastytrade, + "Other" (custom name)
- [>] Show combined TOTAL across all broker accounts
- [>] On login: prompt to CONFIRM each broker's current balance (handles overnight changes)
- [>] If a balance changed, ask user to classify the delta as: Win / Loss / Other (deposit, withdrawal, fee, dividend, etc.)
- [>] Log the classified delta into a SEPARATE "cash adjustments" ledger (does NOT distort trade stats)
- [>] Balance history timeline per broker + aggregate equity curve
- DECISIONS: Manual entry for MVP (no broker API). Win/Loss adjustments live in a separate cash-adjustments ledger, kept out of trade win-rate/P&L metrics. Base currency USD.

## Market Sentiment on Login (replace quotes) — SHIPPED ✅ (Premium)
Goal: replace the login/dashboard quotes with a market-sentiment overview. PREMIUM-gated.
- [>] Sentiment across 4 asset classes: Stocks, Options, Futures, Crypto
- [>] Each shows a sentiment read (Bullish/Neutral/Bearish + score/gauge)
- [>] Concise, glanceable cards; tappable for a short "why" (drivers)
- [>] Refreshes on each login/pull
- DECISIONS: Options sentiment powered by OUR OWN GEX data (gamma regime + put/call skew). Stocks = index trend + VIX. Futures = ES/NQ/CL trend. Crypto = free Fear & Greed index (alternative.me). No specific featured tickers requested yet. PREMIUM-only.

## Data Ingest / Integrations
- [x] Raspberry Pi GEX push (key-protected ingest)
- [x] CSV trade import
- [ ] Broker CSV templates (auto-map columns for common brokers)
- [ ] Direct broker API import (e.g., Tradovate/Webull) — research needed
- [ ] Economic calendar / market-hours awareness in reports

## Email / Comms (Resend)
- [x] Weekly performance recap email + unsubscribe + in-app test send
- [ ] Onboarding email sequence (day 0/3/7 tips)
- [ ] Monthly deep-dive email (bigger stats than weekly)
- [ ] Streak/milestone congrats emails

## UX / Polish
- [ ] Configurable dashboard (reorder/hide cards) — *respect "don't remove without review" rule*
- [ ] Widget/quick-glance mode
- [ ] Onboarding walkthrough for first-time users
- [ ] Accessibility pass (font scaling, contrast)

---
### Parked / Needs decision
- Sender display name: currently "Blue Collar Alpha" (change to "Montana Horizon Ventures"?)
- Production URL cutover for Pi (GEX push + weekly digest cron) after Publish
