import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAutoRefresh } from "@/src/hooks/useAutoRefresh";
import { useAccent } from "@/src/context/AccentContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Setups() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const r = await api.get("/insights/setups"); setRows(r.setups || []); } catch {}
    setLoading(false);
  }, []);
  useAutoRefresh(load, 30000);

  const best = rows.length ? rows[0] : null;

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="setups-back" onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Setup Performance</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={A.accent} style={{ marginTop: 40 }} />
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="pricetags-outline" size={40} color={colors.onSurface3} />
          <Text style={styles.emptyTxt}>No setups yet. As you log trades, each one is tagged with its setup and your best-performing plays will rank here.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(i) => i.setup}
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: insets.bottom + 40 }}
          ListHeaderComponent={best ? (
            <View style={[styles.bestCard, { borderColor: A.accent + "55" }]}>
              <Text style={styles.bestLabel}>🏆 TOP SETUP</Text>
              <Text style={styles.bestName}>{best.setup}</Text>
              <Text style={[styles.bestPnl, { color: best.pnl >= 0 ? colors.success : colors.error }]}>{money(best.pnl)}</Text>
              <Text style={styles.bestSub}>{best.win_rate}% win rate · {best.trades} trades</Text>
            </View>
          ) : null}
          renderItem={({ item, index }) => (
            <View style={styles.row}>
              <View style={[styles.rank, { backgroundColor: A.accent + "22" }]}><Text style={[styles.rankTxt, { color: A.accent }]}>{index + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.setup}</Text>
                <Text style={styles.meta}>{item.win_rate}% WR · {item.trades} trades · avg {money(item.avg_pnl)}</Text>
              </View>
              <Text style={[styles.pnl, { color: item.pnl >= 0 ? colors.success : colors.error }]}>{money(item.pnl)}</Text>
            </View>
          )}
        />
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
  bestCard: { backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, padding: spacing.xl, alignItems: "center", marginBottom: spacing.lg, gap: 2 },
  bestLabel: { color: colors.onSurface3, fontFamily: font.displayBold, fontSize: fs.sm, letterSpacing: 1 },
  bestName: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  bestPnl: { fontFamily: font.displayBold, fontSize: 30, marginTop: 2 },
  bestSub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  rank: { width: 30, height: 30, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  rankTxt: { fontFamily: font.displayBold, fontSize: fs.base },
  name: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  meta: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginTop: 1 },
  pnl: { fontFamily: font.displayBold, fontSize: fs.lg },
});
