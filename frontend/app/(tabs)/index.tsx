import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, useWindowDimensions, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { api } from "@/src/api";
import { colors, spacing, radius, font, fs, money, pnlColor, glow, cardShadow } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { useAuth } from "@/src/context/AuthContext";
import { StatCard, EquityCurve, GradientCard, ScreenBackground } from "@/src/components/ui";
import ReconcileModal from "@/src/components/ReconcileModal";
import { useModalSlot } from "@/src/context/ModalQueue";
import { useAutoRefresh } from "@/src/hooks/useAutoRefresh";
import { PressableScale, CountUpText, PulseHalo } from "@/src/components/anim";
import { playSound } from "@/src/utils/sound";
import { storage } from "@/src/utils/storage";
import { BACKDROP_KEY, backdropSource } from "@/src/appearance";

const RANGES: Record<string, number> = { "1W": 8, "1M": 31, ALL: 9999 };

// Turn a mistake tag into a natural coaching phrase for the habit alert.
const HABIT_PHRASES: Record<string, string> = {
  "FOMO": "traded on FOMO",
  "Chased Entry": "chased entries",
  "No Stop": "traded without a stop",
  "Oversized": "oversized positions",
  "Revenge Trade": "revenge traded",
  "Cut Winner Early": "cut winners early",
  "Held Loser": "held losers too long",
  "Overtraded": "overtraded",
  "Hesitated": "hesitated on entries",
};
const HABIT_DISMISS_KEY = "tm_habit_alert_dismissed";

function fmtGexShort(v: number): string {
  if (v === null || v === undefined || isNaN(v)) return "—";
  const abs = Math.abs(v); const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
const GEX_STALE_MS = 26 * 3600 * 1000;
function isStaleSnap(s: any): boolean {
  const t = new Date(s?.timestamp || s?.received_at).getTime();
  return !isNaN(t) && (Date.now() - t) > GEX_STALE_MS;
}


export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const A = useAccent().theme;
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [trial, setTrial] = useState<{ days: number } | null>(null);
  const [weekly, setWeekly] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<keyof typeof RANGES>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const [backdrop, setBackdrop] = useState<string | null>("cash");
  const [lastTrade, setLastTrade] = useState<any>(null);
  const [mistakes, setMistakes] = useState<any>(null);
  const [mWindow, setMWindow] = useState<"30" | "all">("30");
  const [alert30, setAlert30] = useState<any>(null);
  const [gex, setGex] = useState<any>(null);
  const [brokerAccts, setBrokerAccts] = useState<any[]>([]);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const { isActive: reconcileActive, dismiss: reconcileRelease } = useModalSlot("reconcile", 3, reconcileOpen);
  const [gatedHits, setGatedHits] = useState(0);
  const [dismissedSig, setDismissedSig] = useState<string | null>(null);

  const loadMistakes = useCallback(async (w: "30" | "all") => {
    try { setMistakes(await api.get(`/dashboard/mistake-trends?window=${w}`)); } catch {}
  }, []);

  useEffect(() => {
    storage.getItem<string>(HABIT_DISMISS_KEY, "").then((v) => setDismissedSig(v || null));
  }, []);

  const load = useCallback(async () => {
    try { setStats(await api.get("/dashboard/stats")); } catch {}
    try { setWeekly(await api.get("/dashboard/weekly")); } catch {}
    try { setLastTrade(await api.get("/dashboard/last-trade")); } catch {}
    try { setAlert30(await api.get("/dashboard/mistake-trends?window=30")); } catch {}
    try { const g = await api.get("/gex"); setGex(g?.snapshots?.length ? g.snapshots : null); } catch { setGex(null); }
    try {
      const b = await api.get("/brokers");
      setBrokerAccts(b.accounts || []);
      if (b.needs_reconcile && (b.accounts || []).length && !reconcilePrompted.current) {
        reconcilePrompted.current = true;
        setReconcileOpen(true);
      }
    } catch {}
    loadMistakes(mWindow);
    try { setGatedHits((await storage.getItem<number>("tm_gated_hits", 0)) || 0); } catch {}
    try {
      const b = await api.get("/payments/billing");
      const end = b?.subscription?.trial_end;
      if (end && b?.subscription?.status === "trialing") {
        const days = Math.ceil((new Date(end).getTime() - Date.now()) / 86400000);
        if (days >= 0 && days <= 3) setTrial({ days });
        else setTrial(null);
      } else setTrial(null);
    } catch {}
    setLoading(false);
  }, [mWindow, loadMistakes]);

  const reconcilePrompted = useRef(false);
  useAutoRefresh(load, 30000);
  useFocusEffect(useCallback(() => {
    storage.getItem<string>(BACKDROP_KEY, "cash").then((v) => setBackdrop(v || "cash"));
  }, []));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    await load();
    setTick((t) => t + 1);
    playSound("refresh");
    setRefreshing(false);
  }, [load]);

  const baseBal = stats?.account_balance ?? (user?.account_balance || 0);
  const curve = (stats?.equity_curve?.length ? stats.equity_curve : [baseBal, baseBal]);
  const shownCurve = range === "ALL" ? curve : curve.slice(-RANGES[range]);

  const topHabit = useMemo(() => {
    const tags = alert30?.tags || [];
    return tags.find((t: any) => t.count >= 3) || null;
  }, [alert30]);
  const habitSig = topHabit ? `${topHabit.tag}:${topHabit.count}` : null;
  const showHabitAlert = !!topHabit && dismissedSig !== habitSig;
  const dismissHabit = useCallback(() => {
    setDismissedSig(habitSig);
    if (habitSig) storage.setItem(HABIT_DISMISS_KEY, habitSig);
  }, [habitSig]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;

  const empty = !stats || stats.total_trades === 0;
  const s = stats || { total_trades: 0, total_pnl: 0, daily_pnl: 0, win_rate: 0, profit_factor: 0,
    avg_winner: 0, avg_loser: 0, account_balance: user?.account_balance || 0, equity_curve: [],
    best_setup: null, worst_setup: null, best_hour: null, worst_hour: null };
  const up = (stats?.total_pnl || 0) >= 0;
  const heroTint = empty ? "rgba(46,118,232,0.30)" : up ? "rgba(0,230,118,0.28)" : "rgba(255,61,0,0.28)";

  const gexTeaser = (!gex && user?.subscription_tier !== "premium") ? (    <Animated.View entering={FadeInDown.duration(600).delay(300)}>
      <Pressable testID="gex-teaser" onPress={() => router.push("/(tabs)/profile")}>
        <GradientCard accent={A.accent} style={styles.gexCard}>
          <View style={styles.gexHead}>
            <View style={styles.gexTitleRow}>
              <Ionicons name="lock-closed" size={16} color={A.accent} />
              <Text style={styles.gexTitle}>GEX · Options Heatmap</Text>
            </View>
            <View style={[styles.gexPremiumPill, { backgroundColor: A.accentTint }]}>
              <Text style={[styles.gexPremiumTxt, { color: A.accent }]}>PREMIUM</Text>
            </View>
          </View>
          <Text style={styles.gexTeaserSub}>Unlock live net GEX, gamma flip levels, call/put walls and strike heatmaps for SPY, SPX & XSP.</Text>
          <View style={[styles.gexUnlockBtn, { backgroundColor: A.accent }]}>
            <Ionicons name="sparkles" size={15} color={A.onAccent} />
            <Text style={[styles.gexUnlockTxt, { color: A.onAccent }]}>Upgrade to Premium</Text>
          </View>
        </GradientCard>
      </Pressable>
    </Animated.View>
  ) : null;

  const dismissNudge = async () => { setGatedHits(0); try { await storage.setItem("tm_gated_hits", 0); } catch {} };
  const upgradeNudge = (user?.subscription_tier !== "premium" && gatedHits >= 3) ? (
    <Animated.View entering={FadeInDown.duration(500)}>
      <View style={styles.nudge}>
        <Ionicons name="rocket" size={20} color={A.accent} />
        <View style={{ flex: 1 }}>
          <Text style={styles.nudgeTitle}>You keep bumping into Premium features</Text>
          <Text style={styles.nudgeSub}>Unlock GEX, market sentiment & the AI game plan.</Text>
        </View>
        <Pressable testID="nudge-upgrade" onPress={() => router.push("/(tabs)/profile")} style={[styles.nudgeBtn, { backgroundColor: A.accent }]}>
          <Text style={[styles.nudgeBtnTxt, { color: A.onAccent }]}>See plans</Text>
        </Pressable>
        <Pressable testID="nudge-dismiss" onPress={dismissNudge} hitSlop={8}><Ionicons name="close" size={18} color={colors.onSurface3} /></Pressable>
      </View>
    </Animated.View>
  ) : null;


  return (
    <View style={styles.flex}>
      <ScreenBackground tone={empty ? "neutral" : up ? "up" : "down"} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: 210, paddingHorizontal: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}>
        {trial && (
          <Pressable testID="trial-banner" style={styles.trialBanner} onPress={() => router.push("/billing")}>
            <Ionicons name="time-outline" size={20} color={colors.onBrand} />
            <Text style={styles.trialTxt}>
              {trial.days === 0 ? "Your Premium trial ends today" : `Premium trial ends in ${trial.days} day${trial.days === 1 ? "" : "s"}`}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onBrand} />
          </Pressable>
        )}
        <Animated.View style={styles.hero} entering={FadeIn.duration(900)}>
          <Image source={backdropSource(backdrop)} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient colors={[heroTint, "rgba(13,17,23,0.84)", "#0D1117"]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
          <View style={styles.header}>
            <View>
              <Text style={styles.hi}>Account Balance</Text>
              <CountUpText testID="account-balance" trigger={tick} style={styles.balance} value={stats?.account_balance || 0}
                format={(n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            </View>
            <View style={styles.dailyPill}>
              <Text style={styles.dailyLabel}>Today</Text>
              <Text style={[styles.dailyVal, { color: pnlColor(stats?.daily_pnl || 0) }]}>{money(stats?.daily_pnl || 0)}</Text>
            </View>
          </View>
        </Animated.View>

        {!empty && showHabitAlert && (
          <Animated.View entering={FadeInDown.duration(600)} style={styles.habitAlert}>
            <View style={styles.habitIcon}><Ionicons name="pulse" size={18} color={colors.warning} /></View>
            <Pressable testID="habit-alert" style={{ flex: 1 }} onPress={() => router.push("/mistakes?window=30")}>
              <Text style={styles.habitTxt}>
                You’ve <Text style={styles.habitBold}>{HABIT_PHRASES[topHabit.tag] || topHabit.tag.toLowerCase()}</Text> {topHabit.count}× in the last 30 days{topHabit.pnl < 0 ? ` · ${money(topHabit.pnl)}` : ""}
              </Text>
            </Pressable>
            <Pressable testID="habit-alert-dismiss" hitSlop={12} onPress={dismissHabit} style={styles.habitClose}>
              <Ionicons name="close" size={18} color={colors.onSurface3} />
            </Pressable>
          </Animated.View>
        )}

        {!empty && (user?.daily_loss_limit || 0) > 0 && (stats?.daily_pnl || 0) <= -(user?.daily_loss_limit || 0) && (
          <Animated.View entering={FadeInDown.duration(600)} style={styles.lossBanner}>
            <View style={styles.lossIcon}><Ionicons name="hand-left" size={18} color={colors.error} /></View>
            <Text style={styles.lossTxt}>
              Daily loss limit hit — you’re down <Text style={styles.lossBold}>{money(stats?.daily_pnl || 0)}</Text> (limit {money(-(user?.daily_loss_limit || 0))}). Consider stepping away.
            </Text>
          </Animated.View>
        )}

        {empty && (
          <Animated.View entering={FadeInDown.duration(500).delay(150)} style={styles.emptyBox}>
            <Ionicons name="cloud-upload-outline" size={44} color={colors.brand} />
            <Text style={styles.emptyTitle}>No trades yet</Text>
            <Text style={styles.emptySub}>Upload your first trade to bring these stats to life. Everything below is ready to explore now.</Text>
          </Animated.View>
        )}

        {(
          <>
            <Animated.View entering={FadeInDown.duration(700).delay(200)}>
            <GradientCard accent={colors.brand} style={styles.chartCard}>
              <View style={styles.chartHead}>
                <Text style={styles.cardTitle}>Equity Curve</Text>
                <Text style={[styles.totalPnl, { color: pnlColor(s.total_pnl) }]}>{money(s.total_pnl)}</Text>
              </View>
              <EquityCurve data={shownCurve} replay={tick} width={width - spacing.lg * 2 - spacing.lg * 2} />
              <View style={styles.rangeRow}>
                {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
                  <Pressable key={r} testID={`range-${r}`} onPress={() => setRange(r)}
                    style={[styles.rangeChip, range === r && styles.rangeChipActive]}>
                    <Text style={[styles.rangeTxt, range === r && styles.rangeTxtActive]}>{r}</Text>
                  </Pressable>
                ))}
              </View>
            </GradientCard>
            </Animated.View>

            {weekly?.has_data && (
              <Animated.View entering={FadeInDown.duration(700).delay(450)}>
              <GradientCard accent={A.accent} style={styles.weeklyCard}>
                <View style={styles.weeklyHead}>
                  <Text style={styles.weeklyTitle}>This Week</Text>
                  <View style={[styles.wrTrend, { backgroundColor: (weekly.wr_change >= 0 ? colors.success : colors.error) + "22" }]}>
                    <Ionicons name={weekly.wr_change >= 0 ? "arrow-up" : "arrow-down"} size={12} color={weekly.wr_change >= 0 ? colors.success : colors.error} />
                    <Text style={[styles.wrTrendTxt, { color: weekly.wr_change >= 0 ? colors.success : colors.error }]}>{Math.abs(weekly.wr_change)}pts</Text>
                  </View>
                </View>
                <View style={styles.weeklyRow}>
                  <View>
                    <Text style={styles.weeklyLabel}>P&L</Text>
                    <CountUpText value={weekly.this_week.pnl} trigger={tick} format={money} style={[styles.weeklyVal, { color: pnlColor(weekly.this_week.pnl) }]} />
                  </View>
                  <View>
                    <Text style={styles.weeklyLabel}>Win Rate</Text>
                    <CountUpText value={weekly.this_week.win_rate} trigger={tick} format={(n) => `${n.toFixed(1)}%`} style={styles.weeklyVal} />
                  </View>
                  <View>
                    <Text style={styles.weeklyLabel}>Trades</Text>
                    <CountUpText value={weekly.this_week.trades} trigger={tick} format={(n) => `${Math.round(n)}`} style={styles.weeklyVal} />
                  </View>
                </View>
                <View style={styles.takeawayRow}>
                  <Ionicons name="sparkles" size={14} color={A.accent} />
                  <Text style={styles.takeawayTxt}>{weekly.takeaway}</Text>
                </View>
              </GradientCard>
              </Animated.View>
            )}

            <Animated.View entering={FadeInDown.duration(500).delay(240)} style={{ marginBottom: spacing.md }}>
              <Pressable testID="daily-report-btn" style={styles.reportBtn} onPress={() => router.push("/report")}>
                <Ionicons name="document-text" size={20} color={colors.brand} />
                <Text style={styles.reportTxt}>View AI Session Report</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
              <Pressable testID="analyze-chart-btn" style={styles.chartBtn} onPress={() => router.push("/analyze")}>
                <Ionicons name="analytics" size={20} color={colors.onSurface} />
                <Text style={styles.chartBtnTxt}>Analyze a Chart Screenshot</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
              <Pressable testID="pretrade-btn" style={styles.chartBtn} onPress={() => router.push("/pretrade")}>
                <Ionicons name="ribbon" size={20} color={colors.onSurface} />
                <Text style={styles.chartBtnTxt}>Grade a Potential Trade</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
              <Pressable testID="metrics-btn" style={styles.chartBtn} onPress={() => router.push("/metrics")}>
                <Ionicons name="stats-chart" size={20} color={colors.onSurface} />
                <Text style={styles.chartBtnTxt}>Performance Metrics</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
              <Pressable testID="setups-btn" style={styles.chartBtn} onPress={() => router.push("/setups")}>
                <Ionicons name="pricetags" size={20} color={colors.onSurface} />
                <Text style={styles.chartBtnTxt}>Setup Performance</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
              <Pressable testID="heatmap-btn" style={styles.chartBtn} onPress={() => router.push("/heatmap")}>
                <Ionicons name="grid" size={20} color={colors.onSurface} />
                <Text style={styles.chartBtnTxt}>P&L Heatmap</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
              <Pressable testID="calendar-btn" style={styles.chartBtn} onPress={() => router.push("/calendar")}>
                <Ionicons name="calendar" size={20} color={colors.onSurface} />
                <Text style={styles.chartBtnTxt}>P&L Calendar</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
              <Pressable testID="import-btn" style={styles.chartBtn} onPress={() => router.push("/import")}>
                <Ionicons name="cloud-upload-outline" size={20} color={colors.onSurface} />
                <Text style={styles.chartBtnTxt}>Import Trades (CSV)</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
              <Pressable testID="gex-btn" style={styles.chartBtn} onPress={() => router.push("/gex")}>
                <Ionicons name="pulse" size={20} color={colors.onSurface} />
                <Text style={styles.chartBtnTxt}>GEX Tracker & Heatmap</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
              <Pressable testID="balances-btn" style={styles.chartBtn} onPress={() => router.push("/balances")}>
                <Ionicons name="wallet-outline" size={20} color={colors.onSurface} />
                <Text style={styles.chartBtnTxt}>Broker Balances</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
              <Pressable testID="gameplan-btn" style={styles.chartBtn} onPress={() => router.push("/gameplan")}>
                <Ionicons name="sparkles" size={20} color={colors.onSurface} />
                <Text style={styles.chartBtnTxt}>AI Game Plan & Insights</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
              </Pressable>
            </Animated.View>

            {gex && (
              <Animated.View entering={FadeInDown.duration(600).delay(300)}>
                <Pressable testID="gex-glance" onPress={() => router.push("/gex")}>
                  <GradientCard accent={A.accent} style={styles.gexCard}>
                    <View style={styles.gexHead}>
                      <View style={styles.gexTitleRow}>
                        <Ionicons name="pulse" size={16} color={A.accent} />
                        <Text style={styles.gexTitle}>GEX · At a Glance</Text>
                        {gex.some(isStaleSnap) && (
                          <View style={styles.gexStalePill}>
                            <Ionicons name="warning-outline" size={11} color={colors.warning} />
                            <Text style={styles.gexStaleTxt}>stale</Text>
                          </View>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.onSurface3} />
                    </View>
                    <View style={styles.gexRow}>
                      {gex.map((s: any) => {
                        const pos = (s.net_gex ?? 0) >= 0;
                        const stale = isStaleSnap(s);
                        return (
                          <View key={s.symbol} style={styles.gexItem}>
                            <Text style={styles.gexSym}>{s.symbol}</Text>
                            <Text style={[styles.gexNet, { color: pos ? colors.success : colors.error }]}>{fmtGexShort(s.net_gex ?? 0)}</Text>
                            <Text style={[styles.gexFlip, stale && { color: colors.warning }]}>{stale ? "stale" : `flip ${s.flip_point != null ? Number(s.flip_point).toFixed(0) : "—"}`}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </GradientCard>
                </Pressable>
              </Animated.View>
            )}

            {!gex && user?.subscription_tier !== "premium" && gexTeaser}
            {upgradeNudge}

            {lastTrade?.has_trade && (
              <Animated.View entering={FadeInDown.duration(700).delay(320)}>
                <Pressable testID="debrief-card" onPress={() => router.push(`/debrief/${lastTrade.trade.id}`)}>
                  <GradientCard accent={A.accent} style={styles.debriefCard}>
                    <View style={styles.debriefHead}>
                      <View style={styles.debriefTitleRow}>
                        <Ionicons name="sparkles" size={16} color={A.accent} />
                        <Text style={styles.debriefTitle}>AI Trade Debrief</Text>
                      </View>
                      {lastTrade.trade.debrief ? (
                        <View style={styles.debriefReady}><Ionicons name="checkmark-circle" size={13} color={colors.success} /><Text style={styles.debriefReadyTxt}>Ready</Text></View>
                      ) : (
                        <View style={[styles.debriefNew, { backgroundColor: A.accentTint }]}><Text style={[styles.debriefNewTxt, { color: A.accent }]}>NEW</Text></View>
                      )}
                    </View>
                    <View style={styles.debriefTradeRow}>
                      <Text style={styles.debriefSym}>{lastTrade.trade.symbol}</Text>
                      <Text style={[styles.debriefPnl, { color: pnlColor(lastTrade.trade.pnl) }]}>{money(lastTrade.trade.pnl || 0)}</Text>
                    </View>
                    {lastTrade.trade.debrief?.summary ? (
                      <Text style={styles.debriefSummary} numberOfLines={2}>{lastTrade.trade.debrief.summary}</Text>
                    ) : (
                      <Text style={styles.debriefSub}>Get a focused, trade-specific review from your AI coach.</Text>
                    )}
                    {lastTrade.trade.debrief?.mistake_tags?.length ? (
                      <View style={styles.debriefTags}>
                        {lastTrade.trade.debrief.mistake_tags.map((tag: string, i: number) => {
                          const good = tag === "Good Discipline";
                          const c = good ? colors.success : colors.error;
                          return <View key={i} style={[styles.debriefTag, { backgroundColor: c + "1F" }]}><Text style={[styles.debriefTagTxt, { color: c }]}>{tag}</Text></View>;
                        })}
                      </View>
                    ) : null}
                    <View style={[styles.debriefCta, { backgroundColor: A.accent }]}>
                      <Ionicons name={lastTrade.trade.debrief ? "eye" : "sparkles"} size={16} color={A.onAccent} />
                      <Text style={[styles.debriefCtaTxt, { color: A.onAccent }]}>{lastTrade.trade.debrief ? "View Debrief" : "Generate Debrief"}</Text>
                    </View>
                  </GradientCard>
                </Pressable>
              </Animated.View>
            )}

            {mistakes?.total_debriefed > 0 && (
              <Animated.View entering={FadeInDown.duration(700).delay(360)}>
                <GradientCard accent={colors.error} style={styles.debriefCard}>
                  <View style={styles.debriefHead}>
                    <View style={styles.debriefTitleRow}>
                      <Ionicons name="trending-down" size={16} color={colors.error} />
                      <Text style={styles.debriefTitle}>Mistake Trends</Text>
                    </View>
                    <View style={styles.mToggle}>
                      {(["30", "all"] as const).map((w) => (
                        <Pressable key={w} testID={`mistake-window-${w}`} onPress={() => setMWindow(w)} style={[styles.mSeg, mWindow === w && { backgroundColor: A.accent }]}>
                          <Text style={[styles.mSegTxt, mWindow === w && { color: A.onAccent }]}>{w === "30" ? "30D" : "All"}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  {(mistakes.tags?.length || 0) === 0 ? (
                    <Text style={styles.debriefSub}>No mistakes flagged{mWindow === "30" ? " in the last 30 days" : ""}.{mistakes.good_count > 0 ? ` ${mistakes.good_count} clean trade${mistakes.good_count > 1 ? "s" : ""}. ` : " "}Keep it up!</Text>
                  ) : (
                    <>
                      {mistakes.tags.slice(0, 3).map((row: any) => {
                        const mx = mistakes.tags[0].count || 1;
                        return (
                          <View key={row.tag} style={styles.mRow}>
                            <View style={styles.debriefTradeRow}>
                              <Text style={styles.mTag}>{row.tag}</Text>
                              <Text style={[styles.debriefPnl, { color: pnlColor(row.pnl) }]}>{money(row.pnl)}</Text>
                            </View>
                            <View style={styles.mBarTrack}>
                              <View style={[styles.mBarFill, { width: `${Math.max((row.count / mx) * 100, 6)}%` }]} />
                            </View>
                            <Text style={styles.mCount}>{row.count}× {row.count === 1 ? "trade" : "trades"}</Text>
                          </View>
                        );
                      })}
                      <Pressable testID="mistakes-see-all" style={styles.mSeeAll} onPress={() => router.push(`/mistakes?window=${mWindow}`)}>
                        <Text style={[styles.mSeeAllTxt, { color: A.accent }]}>See all {mistakes.tags.length} habit{mistakes.tags.length > 1 ? "s" : ""}</Text>
                        <Ionicons name="chevron-forward" size={16} color={A.accent} />
                      </Pressable>
                    </>
                  )}
                </GradientCard>
              </Animated.View>
            )}

            <Animated.View entering={FadeInDown.duration(400).delay(180)} style={styles.grid}>
              <StatCard testID="stat-winrate" label="Win Rate" icon="trophy" value={`${s.win_rate}%`} countTo={s.win_rate} trigger={tick} format={(n) => `${n.toFixed(1)}%`} style={styles.half} valueColor={s.win_rate >= 50 ? colors.success : colors.warning} />
              <StatCard testID="stat-pf" label="Profit Factor" icon="trending-up" value={`${s.profit_factor}`} countTo={s.profit_factor} trigger={tick} format={(n) => n.toFixed(2)} style={styles.half} valueColor={s.profit_factor >= 1 ? colors.success : colors.error} />
              <StatCard testID="stat-winner" label="Avg Winner" icon="arrow-up-circle" value={money(s.avg_winner)} countTo={s.avg_winner} trigger={tick} format={money} style={styles.half} valueColor={colors.success} />
              <StatCard testID="stat-loser" label="Avg Loser" icon="arrow-down-circle" value={money(s.avg_loser)} countTo={s.avg_loser} trigger={tick} format={money} style={styles.half} valueColor={colors.error} />
            </Animated.View>

            <View style={styles.infoRow}>
              <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>Best Setup</Text>
                <Text style={styles.infoVal} numberOfLines={1}>{s.best_setup || "—"}</Text>
              </View>
              <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>Best Time</Text>
                <Text style={styles.infoVal} numberOfLines={1}>{s.best_hour || "—"}</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      <PressableScale testID="fab-upload" style={[styles.fabWrap, { shadowColor: A.accent }]} onPress={() => router.push("/upload")}>
        <PulseHalo color={A.accent} />
        <LinearGradient colors={A.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fab}>
          <Ionicons name="camera" size={24} color={A.onAccent} />
          <Text style={[styles.fabTxt, { color: A.onAccent }]}>Add Trade</Text>
        </LinearGradient>
      </PressableScale>

      <ReconcileModal visible={reconcileActive} accounts={brokerAccts} onClose={() => { setReconcileOpen(false); reconcileRelease(); }} onDone={() => { setReconcileOpen(false); reconcileRelease(); load(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  hero: { marginHorizontal: -spacing.lg, marginTop: -(spacing.md), paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl, marginBottom: spacing.lg, overflow: "hidden", borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  trialBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginBottom: spacing.lg, ...glow(colors.brand, 0.4) },
  trialTxt: { flex: 1, color: colors.onBrand, fontFamily: font.display, fontSize: fs.base },
  hi: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1.5 },
  balance: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: 42, marginTop: 2 },
  dailyPill: { backgroundColor: "rgba(22,27,34,0.7)", borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, alignItems: "flex-end" },
  dailyLabel: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  dailyVal: { fontFamily: font.displayBold, fontSize: fs.lg },
  chartCard: { marginBottom: spacing.md, ...cardShadow },
  chartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  totalPnl: { fontFamily: font.displayBold, fontSize: fs.xl },
  rangeRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  rangeChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface3 },
  rangeChipActive: { backgroundColor: colors.brand, ...glow(colors.brand, 0.5) },
  rangeTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  rangeTxtActive: { color: colors.onBrand, fontFamily: font.text },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.md },
  weeklyCard: { marginBottom: spacing.md, gap: spacing.md, ...cardShadow },
  debriefCard: { marginBottom: spacing.md, gap: spacing.sm, ...cardShadow },
  gexCard: { marginBottom: spacing.md, gap: spacing.sm, ...cardShadow },
  gexHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  gexTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  gexTitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1 },
  gexStalePill: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: colors.warning + "22", borderRadius: radius.sm, paddingHorizontal: spacing.xs, paddingVertical: 1 },
  gexStaleTxt: { color: colors.warning, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  nudge: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  nudgeTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.base },
  nudgeSub: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginTop: 1 },
  nudgeBtn: { borderRadius: radius.pill, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  nudgeBtnTxt: { fontFamily: font.displayBold, fontSize: fs.sm },
  gexRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  gexItem: { flex: 1, alignItems: "center", gap: 2 },
  gexSym: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.base, letterSpacing: 0.5 },
  gexNet: { fontFamily: font.displayBold, fontSize: fs.lg },
  gexFlip: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  gexPremiumPill: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  gexPremiumTxt: { fontFamily: font.displayBold, fontSize: fs.sm, letterSpacing: 1 },
  gexTeaserSub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, lineHeight: 20 },
  gexUnlockBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.xs },
  gexUnlockTxt: { fontFamily: font.displayBold, fontSize: fs.base },
  debriefHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  debriefTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  debriefTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  debriefReady: { flexDirection: "row", alignItems: "center", gap: 3 },
  debriefReadyTxt: { color: colors.success, fontFamily: font.text, fontSize: fs.sm },
  debriefNew: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  debriefNewTxt: { fontFamily: font.displayBold, fontSize: fs.sm, letterSpacing: 1 },
  debriefTradeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  debriefSym: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  debriefPnl: { fontFamily: font.displayBold, fontSize: fs.lg },
  debriefSummary: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.base, lineHeight: 20, fontStyle: "italic" },
  debriefSub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, lineHeight: 20 },
  debriefTags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  debriefTag: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  debriefTagTxt: { fontFamily: font.text, fontSize: fs.sm },
  debriefCta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.xs },
  debriefCtaTxt: { fontFamily: font.displayBold, fontSize: fs.base },
  mToggle: { flexDirection: "row", backgroundColor: colors.surface3, borderRadius: radius.sm, padding: 2 },
  mSeg: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.sm - 2 },
  mSegTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  mRow: { gap: 4, marginTop: spacing.xs },
  mTag: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.base },
  mBarTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surface3, overflow: "hidden" },
  mBarFill: { height: 6, borderRadius: radius.pill, backgroundColor: colors.error },
  mCount: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  mSeeAll: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, paddingTop: spacing.sm },
  mSeeAllTxt: { fontFamily: font.display, fontSize: fs.base },
  habitAlert: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warning + "18", borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning + "55", paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.lg },
  habitIcon: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.warning + "22", alignItems: "center", justifyContent: "center" },
  habitTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.base, lineHeight: 19 },
  habitBold: { fontFamily: font.displayBold, color: colors.warning },
  habitClose: { padding: spacing.xs },
  lossBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.error + "1A", borderRadius: radius.md, borderWidth: 1, borderColor: colors.error + "66", paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.lg },
  lossIcon: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.error + "22", alignItems: "center", justifyContent: "center" },
  lossTxt: { flex: 1, color: colors.onSurface, fontFamily: font.text, fontSize: fs.base, lineHeight: 19 },
  lossBold: { fontFamily: font.displayBold, color: colors.error },
  weeklyHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  weeklyTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  wrTrend: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  wrTrendTxt: { fontFamily: font.text, fontSize: fs.sm },
  weeklyRow: { flexDirection: "row", justifyContent: "space-between" },
  weeklyLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  weeklyVal: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  takeawayRow: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.brandTint, borderRadius: radius.md, padding: spacing.md },
  takeawayTxt: { flex: 1, color: colors.onSurface, fontFamily: font.text, fontSize: fs.base, lineHeight: 20 },
  half: { width: "47.7%", flexGrow: 1 },
  infoRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  infoCard: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  infoLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, marginBottom: spacing.xs },
  infoVal: { color: colors.brand, fontFamily: font.display, fontSize: fs.lg },
  reportBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandTint, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.brand },
  reportTxt: { flex: 1, color: colors.brand, fontFamily: font.display, fontSize: fs.lg },
  chartBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md },
  chartBtnTxt: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  emptyBox: { alignItems: "center", padding: spacing.xxl, backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl, marginTop: spacing.sm },
  emptySub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, textAlign: "center" },
  fabWrap: { position: "absolute", bottom: 94, right: spacing.lg, borderRadius: radius.pill, ...glow(colors.accent, 0.6) },
  fab: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  fabTxt: { color: colors.onAccent, fontFamily: font.displayBold, fontSize: fs.lg },
});
