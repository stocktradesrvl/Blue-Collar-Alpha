import React, { useCallback, useState } from "react";
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
import { StatCard, EquityCurve, GradientCard, ScreenBackground } from "@/src/components/ui";
import { PressableScale, CountUpText, PulseHalo } from "@/src/components/anim";
import { playSound } from "@/src/utils/sound";
import { storage } from "@/src/utils/storage";
import { BACKDROP_KEY, backdropSource } from "@/src/appearance";

const RANGES: Record<string, number> = { "1W": 8, "1M": 31, ALL: 9999 };

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const A = useAccent().theme;
  const [stats, setStats] = useState<any>(null);
  const [trial, setTrial] = useState<{ days: number } | null>(null);
  const [weekly, setWeekly] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<keyof typeof RANGES>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const [backdrop, setBackdrop] = useState<string | null>("cash");
  const [lastTrade, setLastTrade] = useState<any>(null);

  const load = useCallback(async () => {
    try { setStats(await api.get("/dashboard/stats")); } catch {}
    try { setWeekly(await api.get("/dashboard/weekly")); } catch {}
    try { setLastTrade(await api.get("/dashboard/last-trade")); } catch {}
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
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
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

  const curve = stats?.equity_curve || [];
  const shownCurve = range === "ALL" ? curve : curve.slice(-RANGES[range]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;

  const empty = !stats || stats.total_trades === 0;
  const up = (stats?.total_pnl || 0) >= 0;
  const heroTint = empty ? "rgba(46,118,232,0.30)" : up ? "rgba(0,230,118,0.28)" : "rgba(255,61,0,0.28)";

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

        {empty ? (
          <View style={styles.emptyBox}>
            <Ionicons name="cloud-upload-outline" size={48} color={colors.brand} />
            <Text style={styles.emptyTitle}>No trades yet</Text>
            <Text style={styles.emptySub}>Upload a screenshot of your trade and let the AI coach analyze it.</Text>
          </View>
        ) : (
          <>
            <Animated.View entering={FadeInDown.duration(700).delay(200)}>
            <GradientCard accent={colors.brand} style={styles.chartCard}>
              <View style={styles.chartHead}>
                <Text style={styles.cardTitle}>Equity Curve</Text>
                <Text style={[styles.totalPnl, { color: pnlColor(stats.total_pnl) }]}>{money(stats.total_pnl)}</Text>
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

            <Animated.View entering={FadeInDown.duration(400).delay(180)} style={styles.grid}>
              <StatCard testID="stat-winrate" label="Win Rate" icon="trophy" value={`${stats.win_rate}%`} countTo={stats.win_rate} trigger={tick} format={(n) => `${n.toFixed(1)}%`} style={styles.half} valueColor={stats.win_rate >= 50 ? colors.success : colors.warning} />
              <StatCard testID="stat-pf" label="Profit Factor" icon="trending-up" value={`${stats.profit_factor}`} countTo={stats.profit_factor} trigger={tick} format={(n) => n.toFixed(2)} style={styles.half} valueColor={stats.profit_factor >= 1 ? colors.success : colors.error} />
              <StatCard testID="stat-winner" label="Avg Winner" icon="arrow-up-circle" value={money(stats.avg_winner)} countTo={stats.avg_winner} trigger={tick} format={money} style={styles.half} valueColor={colors.success} />
              <StatCard testID="stat-loser" label="Avg Loser" icon="arrow-down-circle" value={money(stats.avg_loser)} countTo={stats.avg_loser} trigger={tick} format={money} style={styles.half} valueColor={colors.error} />
            </Animated.View>

            <View style={styles.infoRow}>
              <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>Best Setup</Text>
                <Text style={styles.infoVal} numberOfLines={1}>{stats.best_setup || "—"}</Text>
              </View>
              <View style={styles.infoCard}>
                <Text style={styles.infoLabel}>Best Time</Text>
                <Text style={styles.infoVal} numberOfLines={1}>{stats.best_hour || "—"}</Text>
              </View>
            </View>

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
