import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { colors, spacing, radius, font, fs, money, pnlColor } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";

type TagRow = { tag: string; count: number; pnl: number };

export default function MistakeTrends() {
  const params = useLocalSearchParams<{ window?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const [data, setData] = useState<{ tags: TagRow[]; good_count: number; total_debriefed: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState<"30" | "all">(params.window === "all" ? "all" : "30");

  const load = useCallback(async (w: "30" | "all") => {
    setLoading(true);
    try { setData(await api.get(`/dashboard/mistake-trends?window=${w}`)); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(win); }, [win]);

  const tags = data?.tags || [];
  const max = tags.length ? tags[0].count : 1;

  return (
    <View style={styles.flex}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="mistakes-back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Mistake Trends</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }}>
        <View style={styles.toggle}>
          {(["30", "all"] as const).map((w) => (
            <Pressable key={w} testID={`mistakes-win-${w}`} onPress={() => setWin(w)} style={[styles.seg, win === w && [styles.segActive, { backgroundColor: A.accent }]]}>
              <Text style={[styles.segTxt, win === w && { color: A.onAccent }]}>{w === "30" ? "Last 30 days" : "All time"}</Text>
            </Pressable>
          ))}
        </View>

        {data && data.good_count > 0 && (
          <View style={styles.goodCard}>
            <Ionicons name="shield-checkmark" size={18} color={colors.success} />
            <Text style={styles.goodTxt}>{data.good_count} clean trade{data.good_count > 1 ? "s" : ""} with good discipline</Text>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator color={A.accent} /></View>
        ) : tags.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="happy-outline" size={44} color={colors.onSurface3} />
            <Text style={styles.emptyTxt}>{data && data.total_debriefed === 0
              ? "Debrief some trades first — your habit patterns will show up here."
              : `No mistakes flagged ${win === "30" ? "in the last 30 days" : "yet"}. Keep it up!`}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.intro}>Your most frequent flagged habits, and the total P&L of the trades they show up in.</Text>
            {tags.map((row) => (
              <View key={row.tag} style={styles.row}>
                <View style={styles.rowTop}>
                  <View style={styles.tagWrap}>
                    <Ionicons name="warning" size={14} color={colors.error} />
                    <Text style={styles.tag}>{row.tag}</Text>
                  </View>
                  <Text style={[styles.pnl, { color: pnlColor(row.pnl) }]}>{money(row.pnl)}</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.max((row.count / max) * 100, 6)}%` }]} />
                </View>
                <Text style={styles.count}>{row.count}× {row.count === 1 ? "trade" : "trades"}</Text>
              </View>
            ))}
          </>
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
  toggle: { flexDirection: "row", backgroundColor: colors.surface2, borderRadius: radius.md, padding: 3, borderWidth: 1, borderColor: colors.border },
  seg: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: "center" },
  segActive: {},
  segTxt: { color: colors.onSurface2, fontFamily: font.display, fontSize: fs.base },
  goodCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.success + "18", borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.success + "44" },
  goodTxt: { color: colors.success, fontFamily: font.text, fontSize: fs.base, flex: 1 },
  loadingBox: { padding: spacing.xxl, alignItems: "center" },
  emptyBox: { alignItems: "center", gap: spacing.md, padding: spacing.xxl },
  emptyTxt: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base, textAlign: "center", lineHeight: 21 },
  intro: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, lineHeight: 19 },
  row: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tagWrap: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  tag: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  pnl: { fontFamily: font.displayBold, fontSize: fs.lg },
  barTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surface3, overflow: "hidden" },
  barFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.error },
  count: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
});
