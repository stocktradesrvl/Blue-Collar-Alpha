import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAutoRefresh } from "@/src/hooks/useAutoRefresh";
import { useAccent } from "@/src/context/AccentContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Blend a pnl value into a heat color: green for gains, red for losses.
function cellColor(pnl: number, trades: number, max: number) {
  if (!trades) return colors.surface3;
  const t = max > 0 ? Math.min(1, Math.abs(pnl) / max) : 0;
  const alpha = 0.15 + t * 0.6;
  return pnl >= 0 ? `rgba(0,230,118,${alpha})` : `rgba(255,61,0,${alpha})`;
}

export default function Heatmap() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get("/insights/heatmap")); } catch {}
    setLoading(false);
  }, []);
  useAutoRefresh(load, 30000);

  const days: string[] = data?.days || [];
  const grid: any[] = data?.grid || [];
  const maxAbs = Math.max(1, ...grid.flatMap((r: any) => r.cells.map((c: any) => Math.abs(c.pnl))));
  const dayMaxAbs = Math.max(1, ...(data?.day_stats || []).map((d: any) => Math.abs(d.pnl)));

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="heatmap-back" onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>P&L Heatmap</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={A.accent} style={{ marginTop: 40 }} />
      ) : !data?.has_data ? (
        <View style={styles.empty}>
          <Ionicons name="grid-outline" size={40} color={colors.onSurface3} />
          <Text style={styles.emptyTxt}>No trades yet. As you log trades, this heatmap shows exactly which days and times make — or lose — you money.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 40 }}>
          {/* Insight callouts */}
          <View style={styles.callouts}>
            {data.best_day && (
              <View style={[styles.callout, { borderColor: colors.success + "55" }]}>
                <Text style={styles.calloutLabel}>💚 BEST DAY</Text>
                <Text style={styles.calloutVal}>{data.best_day.day}</Text>
                <Text style={[styles.calloutSub, { color: colors.success }]}>{money(data.best_day.pnl)} · {data.best_day.win_rate}% WR</Text>
              </View>
            )}
            {data.worst_day && data.worst_day.pnl < 0 && (
              <View style={[styles.callout, { borderColor: colors.error + "55" }]}>
                <Text style={styles.calloutLabel}>🔻 TOUGHEST DAY</Text>
                <Text style={styles.calloutVal}>{data.worst_day.day}</Text>
                <Text style={[styles.calloutSub, { color: colors.error }]}>{money(data.worst_day.pnl)} · {data.worst_day.win_rate}% WR</Text>
              </View>
            )}
          </View>

          {/* Day-of-week bars */}
          <Text style={styles.section}>By day of week</Text>
          <View style={styles.dayRow}>
            {(data.day_stats || []).map((d: any) => {
              const h = d.trades ? 20 + Math.round((Math.abs(d.pnl) / dayMaxAbs) * 70) : 6;
              return (
                <View key={d.day} style={styles.dayCol}>
                  <Text style={[styles.dayPnl, { color: d.trades ? (d.pnl >= 0 ? colors.success : colors.error) : colors.onSurface3 }]}>
                    {d.trades ? money(d.pnl) : "—"}
                  </Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.bar, { height: h, backgroundColor: d.pnl >= 0 ? colors.success : colors.error, opacity: d.trades ? 1 : 0.3 }]} />
                  </View>
                  <Text style={styles.dayLabel}>{d.day}</Text>
                  <Text style={styles.dayTrades}>{d.trades}t</Text>
                </View>
              );
            })}
          </View>

          {/* Session × day grid */}
          <Text style={styles.section}>By session × day</Text>
          {!data.has_time ? (
            <Text style={styles.noTime}>Add trade times (they're auto-read from screenshots) to unlock the time-of-day grid.</Text>
          ) : (
            <View style={styles.grid}>
              <View style={styles.gridHeadRow}>
                <View style={styles.sessLabelCell} />
                {days.map((d) => <Text key={d} style={styles.gridHeadTxt}>{d}</Text>)}
              </View>
              {grid.map((row: any) => (
                <View key={row.session} style={styles.gridRow}>
                  <Text style={styles.sessLabel}>{row.session}</Text>
                  {row.cells.map((c: any, i: number) => (
                    <View key={i} style={[styles.cell, { backgroundColor: cellColor(c.pnl, c.trades, maxAbs) }]}>
                      <Text style={styles.cellTxt} numberOfLines={1}>{c.trades ? money(c.pnl) : ""}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}
          {data.best_session && (
            <Text style={styles.footnote}>Your strongest session is <Text style={{ color: colors.success, fontFamily: font.displayBold }}>{data.best_session.session}</Text> ({money(data.best_session.pnl)}).</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  back: { width: 24 },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.md },
  emptyTxt: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base, textAlign: "center", lineHeight: 20 },
  callouts: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.xl },
  callout: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: 2 },
  calloutLabel: { color: colors.onSurface3, fontFamily: font.displayBold, fontSize: 11, letterSpacing: 0.8 },
  calloutVal: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  calloutSub: { fontFamily: font.displayBold, fontSize: fs.sm },
  section: { color: colors.onSurface2, fontFamily: font.displayBold, fontSize: fs.base, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: spacing.md },
  dayRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.xl },
  dayCol: { flex: 1, alignItems: "center", gap: 3 },
  dayPnl: { fontFamily: font.displayBold, fontSize: 10 },
  barTrack: { height: 92, justifyContent: "flex-end" },
  bar: { width: 18, borderRadius: 4 },
  dayLabel: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.sm },
  dayTrades: { color: colors.onSurface3, fontFamily: font.text, fontSize: 10 },
  noTime: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base, lineHeight: 20, marginBottom: spacing.lg },
  grid: { backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 4 },
  gridHeadRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  gridHeadTxt: { flex: 1, textAlign: "center", color: colors.onSurface3, fontFamily: font.displayBold, fontSize: fs.sm },
  gridRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  sessLabelCell: { width: 54 },
  sessLabel: { width: 54, color: colors.onSurface2, fontFamily: font.displayBold, fontSize: 11 },
  cell: { flex: 1, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  cellTxt: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: 10 },
  footnote: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, marginTop: spacing.lg, lineHeight: 18 },
});
