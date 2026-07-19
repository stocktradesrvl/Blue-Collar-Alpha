import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { colors, spacing, radius, font, fs, money, pnlColor } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statVal, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function BarRow({ label, pnl, sub, max }: { label: string; pnl: number; sub: string; max: number }) {
  const w = Math.max(Math.abs(pnl) / (max || 1) * 100, 4);
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${w}%`, backgroundColor: pnl >= 0 ? colors.success : colors.error }]} />
      </View>
      <Text style={[styles.barPnl, { color: pnlColor(pnl) }]}>{money(pnl)}</Text>
      <Text style={styles.barSub}>{sub}</Text>
    </View>
  );
}

export default function Metrics() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/dashboard/metrics").then(setD).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const maxWd = Math.max(1, ...((d?.by_weekday || []).map((x: any) => Math.abs(x.pnl))));
  const maxHr = Math.max(1, ...((d?.by_hour || []).map((x: any) => Math.abs(x.pnl))));
  const maxPb = Math.max(1, ...((d?.playbooks || []).map((x: any) => Math.abs(x.pnl))));

  return (
    <View style={styles.flex}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="metrics-back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Performance Metrics</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={A.accent} size="large" /></View>
      ) : !d?.has_data ? (
        <View style={styles.center}>
          <Ionicons name="stats-chart-outline" size={44} color={colors.onSurface3} />
          <Text style={styles.empty}>Log some trades to unlock your performance metrics.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }}>
          <View style={styles.grid}>
            <Stat label="Profit Factor" value={String(d.profit_factor)} tone={d.profit_factor >= 1 ? colors.success : colors.error} />
            <Stat label="Expectancy / trade" value={money(d.expectancy)} tone={pnlColor(d.expectancy)} />
            <Stat label="Win Rate" value={`${d.win_rate}%`} />
            <Stat label="Payoff Ratio" value={String(d.payoff_ratio)} />
            <Stat label="Avg Win" value={money(d.avg_win)} tone={colors.success} />
            <Stat label="Avg Loss" value={money(d.avg_loss)} tone={colors.error} />
            <Stat label="Largest Win" value={money(d.largest_win)} tone={colors.success} />
            <Stat label="Largest Loss" value={money(d.largest_loss)} tone={colors.error} />
            <Stat label="Best Win Streak" value={`${d.best_win_streak}W`} tone={colors.success} />
            <Stat label="Worst Streak" value={`${d.worst_loss_streak}L`} tone={colors.error} />
          </View>

          {d.by_weekday?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>P&L by Day of Week</Text>
              {d.by_weekday.map((x: any) => <BarRow key={x.day} label={x.day} pnl={x.pnl} sub={`${x.trades}t · ${x.win_rate}%`} max={maxWd} />)}
            </View>
          ) : null}

          {d.by_hour?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>P&L by Time of Day</Text>
              {d.by_hour.map((x: any) => <BarRow key={x.hour} label={x.hour} pnl={x.pnl} sub={`${x.trades}t · ${x.win_rate}%`} max={maxHr} />)}
            </View>
          ) : null}

          {d.playbooks?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Playbook Performance</Text>
              {d.playbooks.map((x: any) => <BarRow key={x.name} label={x.name} pnl={x.pnl} sub={`${x.trades}t · ${x.win_rate}% · avg ${money(x.avg)}`} max={maxPb} />)}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  empty: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base, textAlign: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface2 },
  headerTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCard: { width: "48%", backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 2 },
  statLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  statVal: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  section: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  sectionTitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.xs },
  barRow: { gap: 3 },
  barLabel: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.base },
  barTrack: { height: 7, borderRadius: radius.pill, backgroundColor: colors.surface3, overflow: "hidden" },
  barFill: { height: 7, borderRadius: radius.pill },
  barPnl: { fontFamily: font.displayBold, fontSize: fs.sm },
  barSub: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginBottom: spacing.xs },
});
