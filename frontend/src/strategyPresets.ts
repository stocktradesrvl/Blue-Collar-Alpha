// Common trading strategies with starter rules. Users can edit after adding.
export type StrategyPreset = { name: string; risk_pct: number; rules: string[] };

export const STRATEGY_PRESETS: StrategyPreset[] = [
  { name: "Opening Range Breakout", risk_pct: 1, rules: ["Trade only 9:30–11:00", "Break of 5-min opening range", "Volume above average", "Trend aligned with break"] },
  { name: "VWAP Bounce", risk_pct: 1, rules: ["Price pulls back to VWAP", "VWAP sloping up for longs", "Confirmation candle before entry", "Stop below VWAP"] },
  { name: "VWAP Reclaim", risk_pct: 1, rules: ["Price reclaims VWAP after being below", "Strong reclaim candle", "Higher low formed", "Above-average volume"] },
  { name: "EMA Pullback (9/20)", risk_pct: 1, rules: ["Uptrend: price above 20 EMA", "Pullback to 9 or 20 EMA", "Bounce confirmation", "Stop below 20 EMA"] },
  { name: "Breakout & Retest", risk_pct: 1, rules: ["Clear level breaks", "Price retests broken level", "Level holds as support/resistance", "Enter on hold confirmation"] },
  { name: "Gap and Go", risk_pct: 1.5, rules: ["Stock gaps on news/catalyst", "Holds above premarket high", "High relative volume", "Enter on first pullback"] },
  { name: "Mean Reversion", risk_pct: 1, rules: ["Extended from moving average", "Reversal candle at extreme", "RSI oversold/overbought", "Target the mean"] },
  { name: "RSI Divergence", risk_pct: 1, rules: ["Price makes new high/low", "RSI fails to confirm", "Reversal structure forms", "Confirm with volume"] },
  { name: "MACD Crossover", risk_pct: 1, rules: ["MACD line crosses signal", "Histogram expanding", "Trend context aligned", "Avoid choppy ranges"] },
  { name: "Support/Resistance Bounce", risk_pct: 1, rules: ["Price at key S/R level", "Rejection/absorption candle", "Confluence with MA or VWAP", "Tight stop beyond level"] },
  { name: "Trendline Break", risk_pct: 1, rules: ["Established trendline", "Clean break with momentum", "Retest of trendline", "Volume on break"] },
  { name: "Bull/Bear Flag", risk_pct: 1, rules: ["Strong impulse move", "Tight consolidation flag", "Break in trend direction", "Volume dries in flag, expands on break"] },
  { name: "Order Block (ICT)", risk_pct: 1, rules: ["Identify institutional order block", "Price returns to block", "Fair value gap present", "React from block with confirmation"] },
  { name: "Supply & Demand Zone", risk_pct: 1, rules: ["Marked fresh supply/demand zone", "First touch of zone", "Strong departure candle origin", "Enter on zone reaction"] },
  { name: "Momentum Scalp", risk_pct: 0.5, rules: ["High relative volume", "Strong 1-min momentum", "Enter on micro pullback", "Quick target, tight stop"] },
  { name: "News Fade", risk_pct: 1, rules: ["Overextended spike on news", "Exhaustion/reversal candle", "Fade back toward mean", "Strict risk — no averaging"] },
  { name: "Higher-High Higher-Low", risk_pct: 1, rules: ["Confirmed uptrend structure", "Buy the higher low", "Structure intact", "Stop below last higher low"] },
  { name: "Inside Bar Breakout", risk_pct: 1, rules: ["Inside bar forms", "Break of mother bar", "Trend aligned", "Stop at opposite side of inside bar"] },
  { name: "Double Bottom / Top", risk_pct: 1, rules: ["Two equal lows/highs", "Neckline break", "Volume confirmation", "Measured move target"] },
  { name: "5-Minute Options Momentum", risk_pct: 1, rules: ["Trade 9:30–10:30", "Direction confirmed on 5-min", "Delta 0.4–0.6", "Avoid low-liquidity strikes"] },
];
