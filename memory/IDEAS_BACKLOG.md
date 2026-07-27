# Blue Collar Alpha — Ideas Backlog (running tab)

> Brainstorm only. Nothing here is built until explicitly greenlit.
> Legend: [ ] idea · [~] discussing · [>] queued to build · [x] shipped

## GEX / Options Intelligence
- [ ] Expected-move band (spot ± wall distance) — *already built on GEX screen; extend to glance widget*
- [ ] GEX intraday history sparkline per symbol — *shipped as net-GEX trendline; could add multi-day*
- [ ] GEX "regime" banner: Positive vs Negative gamma with plain-English trade implications
- [ ] Flip-level proximity alert: notify when spot crosses the gamma flip
- [ ] Wall-break alert: price closes beyond call/put wall
- [ ] 0DTE vs multi-expiry GEX toggle (if Pi can send per-expiry)
- [ ] Historical GEX vs next-day realized move accuracy scorecard

## AI Coaching / Journaling
- [ ] Voice-note trade journaling (speech-to-text) with AI summary
- [ ] Weekly AI "game plan" generated from last week's mistakes + upcoming GEX levels
- [ ] Trade replay: annotate the screenshot with AI-detected entry/exit quality
- [ ] "Ask my journal" — chat over the user's own trade history
- [ ] Emotion vs P&L correlation insights (tie existing emotion tags to outcomes)
- [ ] Rule-adherence streak tracking + nudges

## Analytics / Dashboards
- [ ] R-multiple / expectancy metrics
- [ ] Time-of-day and day-of-week performance heatmap
- [ ] Setup performance leaderboard (win rate + expectancy per setup)
- [ ] Drawdown curve + max adverse excursion
- [ ] Tag/strategy filter across all dashboards

## Community / Discord
- [x] Discord OAuth link + auto subscriber role on subscribe
- [x] Discord welcome DM on subscribe
- [ ] Post user's opted-in wins to a #wins channel (with consent toggle)
- [ ] Discord slash command to pull your own stats
- [ ] Leaderboard channel (opt-in, anonymized handles)

## Monetization / Retention
- [x] Free/Pro/Premium tiers + Stripe
- [x] GEX Premium teaser on dashboard
- [ ] Annual plan option (discount vs monthly)
- [ ] Referral rewards expansion (tiered milestones)
- [ ] Free-trial of Premium (X days) with auto-downgrade
- [ ] "Upgrade nudge" when free user hits a gated feature repeatedly

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
