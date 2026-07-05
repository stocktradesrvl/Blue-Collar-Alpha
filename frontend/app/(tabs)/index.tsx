import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, useWindowDimensions, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { colors, spacing, radius, font, fs, money, pnlColor } from "@/src/theme";
import { StatCard, EquityCurve } from "@/src/components/ui";

const RANGES: Record<string, number> = { "1W": 8, "1M": 31, ALL: 9999 };

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [stats, setStats] = useState<any>(null);
  const [trial, setTrial] = useState<{ days: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<keyof typeof RANGES>("ALL");

  const load = useCallback(async () => {
    try { setStats(await api.get("/dashboard/stats")); } catch {}
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

  const curve = stats?.equity_curve || [];
  const shownCurve = range === "ALL" ? curve : curve.slice(-RANGES[range]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;

  const empty = !stats || stats.total_trades === 0;

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: 120, paddingHorizontal: spacing.lg }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brand} />}>
        {trial && (
          <Pressable testID="trial-banner" style={styles.trialBanner} onPress={() => router.push("/billing")}>
            <Ionicons name="time-outline" size={20} color={colors.onBrand} />
            <Text style={styles.trialTxt}>
              {trial.days === 0 ? "Your Premium trial ends today" : `Premium trial ends in ${trial.days} day${trial.days === 1 ? "" : "s"}`}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onBrand} />
          </Pressable>
        )}
        <View style={styles.header}>
          <View>
            <Text style={styles.hi}>Account Balance</Text>
            <Text testID="account-balance" style={styles.balance}>${(stats?.account_balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
          </View>
          <View style={styles.dailyPill}>
            <Text style={styles.dailyLabel}>Today</Text>
            <Text style={[styles.dailyVal, { color: pnlColor(stats?.daily_pnl || 0) }]}>{money(stats?.daily_pnl || 0)}</Text>
          </View>
        </View>

        {empty ? (
          <View style={styles.emptyBox}>
            <Ionicons name="cloud-upload-outline" size={48} color={colors.brand} />
            <Text style={styles.emptyTitle}>No trades yet</Text>
            <Text style={styles.emptySub}>Upload a screenshot of your trade and let the AI coach analyze it.</Text>
          </View>
        ) : (
          <>
            <View style={styles.chartCard}>
              <View style={styles.chartHead}>
                <Text style={styles.cardTitle}>Equity Curve</Text>
                <Text style={[styles.totalPnl, { color: pnlColor(stats.total_pnl) }]}>{money(stats.total_pnl)}</Text>
              </View>
              <EquityCurve data={shownCurve} width={width - spacing.lg * 2 - spacing.lg * 2} />
              <View style={styles.rangeRow}>
                {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
                  <Pressable key={r} testID={`range-${r}`} onPress={() => setRange(r)}
                    style={[styles.rangeChip, range === r && styles.rangeChipActive]}>
                    <Text style={[styles.rangeTxt, range === r && styles.rangeTxtActive]}>{r}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.grid}>
              <StatCard testID="stat-winrate" label="Win Rate" value={`${stats.win_rate}%`} style={styles.half} valueColor={stats.win_rate >= 50 ? colors.success : colors.warning} />
              <StatCard testID="stat-pf" label="Profit Factor" value={`${stats.profit_factor}`} style={styles.half} valueColor={stats.profit_factor >= 1 ? colors.success : colors.error} />
              <StatCard testID="stat-winner" label="Avg Winner" value={money(stats.avg_winner)} style={styles.half} valueColor={colors.success} />
              <StatCard testID="stat-loser" label="Avg Loser" value={money(stats.avg_loser)} style={styles.half} valueColor={colors.error} />
            </View>

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
          </>
        )}
      </ScrollView>

      <Pressable testID="fab-upload" style={styles.fab} onPress={() => router.push("/upload")}>
        <Ionicons name="camera" size={24} color={colors.onBrand} />
        <Text style={styles.fabTxt}>Add Trade</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: spacing.lg },
  trialBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginBottom: spacing.lg },
  trialTxt: { flex: 1, color: colors.onBrand, fontFamily: font.display, fontSize: fs.base },
  hi: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1 },
  balance: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: 40 },
  dailyPill: { backgroundColor: colors.surface2, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, alignItems: "flex-end" },
  dailyLabel: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  dailyVal: { fontFamily: font.displayBold, fontSize: fs.lg },
  chartCard: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  chartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  cardTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  totalPnl: { fontFamily: font.displayBold, fontSize: fs.xl },
  rangeRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  rangeChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface3 },
  rangeChipActive: { backgroundColor: colors.brand },
  rangeTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  rangeTxtActive: { color: colors.onBrand, fontFamily: font.text },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.md },
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
  fab: { position: "absolute", bottom: 100, right: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  fabTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg },
});
