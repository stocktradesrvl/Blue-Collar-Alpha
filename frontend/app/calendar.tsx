import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { colors, spacing, radius, font, fs, money, pnlColor } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

export default function Calendar() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const now = new Date();
  const [y, setY] = useState(now.getUTCFullYear());
  const [m, setM] = useState(now.getUTCMonth()); // 0-based
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = (yy: number, mm: number) => {
    setLoading(true);
    api.get(`/dashboard/calendar?month=${yy}-${String(mm + 1).padStart(2, "0")}`)
      .then(setData).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(y, m); }, [y, m]);

  const shift = (dir: number) => {
    let nm = m + dir, ny = y;
    if (nm < 0) { nm = 11; ny--; }
    if (nm > 11) { nm = 0; ny++; }
    setM(nm); setY(ny);
  };

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const arr: (number | null)[] = Array(first).fill(null);
    for (let i = 1; i <= daysIn; i++) arr.push(i);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [y, m]);

  const days = data?.days || {};
  const dayKey = (d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return (
    <View style={styles.flex}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="cal-back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>P&L Calendar</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }}>
        <View style={styles.monthNav}>
          <Pressable testID="cal-prev" onPress={() => shift(-1)} style={styles.navBtn}><Ionicons name="chevron-back" size={20} color={colors.onSurface} /></Pressable>
          <Text style={styles.monthTitle}>{MONTHS[m]} {y}</Text>
          <Pressable testID="cal-next" onPress={() => shift(1)} style={styles.navBtn}><Ionicons name="chevron-forward" size={20} color={colors.onSurface} /></Pressable>
        </View>

        <View style={styles.summary}>
          <View style={styles.sumItem}><Text style={styles.sumLabel}>Month P&L</Text><Text style={[styles.sumVal, { color: pnlColor(data?.month_pnl || 0) }]}>{money(data?.month_pnl || 0)}</Text></View>
          <View style={styles.sumItem}><Text style={styles.sumLabel}>Green</Text><Text style={[styles.sumVal, { color: colors.success }]}>{data?.green_days || 0}</Text></View>
          <View style={styles.sumItem}><Text style={styles.sumLabel}>Red</Text><Text style={[styles.sumVal, { color: colors.error }]}>{data?.red_days || 0}</Text></View>
        </View>

        {loading ? (
          <View style={{ paddingVertical: spacing.xxl }}><ActivityIndicator color={A.accent} /></View>
        ) : (
          <View>
            <View style={styles.dowRow}>
              {DOW.map((d, i) => <Text key={i} style={styles.dow}>{d}</Text>)}
            </View>
            <View style={styles.gridWrap}>
              {cells.map((d, i) => {
                if (d === null) return <View key={i} style={styles.cell} />;
                const info = days[dayKey(d)];
                const pnl = info?.pnl;
                const bg = pnl == null ? colors.surface2 : pnl > 0 ? colors.success + "2E" : pnl < 0 ? colors.error + "2E" : colors.surface3;
                const bd = pnl == null ? colors.border : pnl > 0 ? colors.success + "88" : colors.error + "88";
                return (
                  <View key={i} style={styles.cell}>
                    <View style={[styles.cellFill, { backgroundColor: bg, borderColor: bd }]}>
                      <Text style={styles.cellDay}>{d}</Text>
                      {info ? <Text style={[styles.cellPnl, { color: pnlColor(pnl) }]} numberOfLines={1}>{pnl >= 0 ? "+" : ""}{Math.round(pnl)}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface2 },
  headerTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface2 },
  monthTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  summary: { flexDirection: "row", backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  sumItem: { flex: 1, alignItems: "center", gap: 2 },
  sumLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  sumVal: { fontFamily: font.displayBold, fontSize: fs.lg },
  dowRow: { flexDirection: "row", marginBottom: spacing.xs },
  dow: { flex: 1, textAlign: "center", color: colors.onSurface3, fontFamily: font.display, fontSize: fs.sm },
  gridWrap: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  cellFill: { flex: 1, borderWidth: 1, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  cellDay: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.sm },
  cellPnl: { fontFamily: font.displayBold, fontSize: 10 },
});
