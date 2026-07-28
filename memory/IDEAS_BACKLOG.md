# Blue Collar Alpha — Ideas Backlog (running tab)

> Brainstorm only. Nothing here is built until explicitly greenlit.
> Legend: [ ] idea · [~] discussing · [>] queued to build · [x] shipped

## GEX / Options Intelligence  — ALL QUEUED
- [>] Expected-move band (spot ± wall distance) — extend to glance widget
- [>] GEX intraday history sparkline per symbol — multi-day extension
- [>] GEX "regime" banner: Positive vs Negative gamma with plain-English trade implications
- [>] Flip-level proximity alert: notify when spot crosses the gamma flip
- [>] Wall-break alert: price closes beyond call/put wall
- [>] 0DTE vs multi-expiry GEX toggle (if Pi can send per-expiry)
- [>] Historical GEX vs next-day realized move accuracy scorecard

## AI Coaching / Journaling — ALL QUEUED
- [>] Voice-note trade journaling (speech-to-text) with AI summary
- [>] Weekly AI "game plan" generated from last week's mistakes + upcoming GEX levels
- [>] Trade replay: annotate the screenshot with AI-detected entry/exit quality
- [>] "Ask my journal" — chat over the user's own trade history
- [>] Emotion vs P&L correlation insights (tie existing emotion tags to outcomes)
- [>] Rule-adherence streak tracking + nudges

## Analytics / Dashboards
- [ ] R-multiple / expectancy metrics
- [ ] Time-of-day and day-of-week performance heatmap
- [ ] Setup performance leaderboard (win rate + expectancy per setup)
- [ ] Drawdown curve + max adverse excursion
- [ ] Tag/strategy filter across all dashboards

## Community / Discord — ALL QUEUED
- [x] Discord OAuth link + auto subscriber role on subscribe
- [x] Discord welcome DM on subscribe
- [>] Post user's opted-in wins to a #wins channel (with consent toggle)
- [>] Discord slash command to pull your own stats
- [>] Leaderboard channel (opt-in, anonymized handles)

## Monetization / Retention — ALL QUEUED
- [x] Free/Pro/Premium tiers + Stripe
- [x] GEX Premium teaser on dashboard
- [>] Annual plan option (discount vs monthly)
- [>] Referral rewards expansion (tiered milestones)
- [>] Free-trial of Premium (X days) with auto-downgrade
- [>] "Upgrade nudge" when free user hits a gated feature repeatedly

## Multi-Broker Balance Reconciliation — NEW (queued)
Goal: track cash/account balances across multiple brokers, reconcile on login.
- [>] Add per-broker balance lines: Robinhood, Webull, Tastytrade, + "Other" (custom name)
- [>] Show combined TOTAL across all broker accounts
- [>] On login: prompt to CONFIRM each broker's current balance (handles overnight changes)
- [>] If a balance changed, ask user to classify the delta as: Win / Loss / Other (deposit, withdrawal, fee, dividend, etc.)
- [>] Log the classified delta into the journal/history so P&L stays accurate
- [>] Balance history timeline per broker + aggregate equity curve
- OPEN QUESTIONS: manual entry vs broker API (RH/Webull/Tastytrade lack official/stable public APIs → likely manual for MVP); should "Win/Loss" deltas count toward trade stats or a separate cash-adjustment ledger?; base currency (USD assumed).

## Market Sentiment on Login (replace quotes) — NEW (queued)
Goal: replace the login/dashboard quotes with a market-sentiment overview.
- [>] Sentiment across 4 asset classes: Stocks, Options, Futures, Crypto
- [>] Each shows a sentiment read (e.g., Bullish/Neutral/Bearish + score/gauge)
- [>] Concise, glanceable cards; tappable for a short "why" (drivers)
- OPEN QUESTIONS: data source per class — Stocks (indices trend/advancers vs decliners, VIX), Options (put/call ratio, our own GEX regime!), Futures (ES/NQ/CL trend), Crypto (Fear & Greed index / BTC dominance). Need to pick providers (many free: Alternative.me F&G for crypto, CBOE put/call, etc.) or derive from existing data. Refresh cadence + caching. Free vs Premium gating?

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
