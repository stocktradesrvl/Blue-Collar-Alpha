import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { colors, spacing, radius, font, fs, money, pnlColor } from "@/src/theme";
import { GradeBadge } from "@/src/components/ui";

const GRADES = ["All", "A", "B", "C", "D", "F"];

export default function Journal() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");

  const load = useCallback(async () => {
    try {
      const q = filter === "All" ? "" : `?grade=${filter}`;
      setTrades(await api.get(`/trades${q}`));
    } catch {}
    setLoading(false);
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const renderItem = ({ item }: { item: any }) => {
    const win = (item.pnl || 0) >= 0;
    return (
      <Pressable testID={`trade-${item.id}`} style={styles.row} onPress={() => router.push(`/trade/${item.id}`)}>
        <View style={[styles.strip, { backgroundColor: win ? colors.success : colors.error }]} />
        <View style={styles.rowMain}>
          <View style={styles.rowTop}>
            <Text style={styles.symbol}>{item.symbol}</Text>
            <Text style={[styles.pnl, { color: pnlColor(item.pnl) }]}>{money(item.pnl || 0)}</Text>
          </View>
          <View style={styles.rowBottom}>
            <Text style={styles.setup} numberOfLines={1}>{item.detected_setup || item.strategy_name || item.asset_type} · {item.direction}</Text>
            <GradeBadge grade={item.setup_grade || "C"} size={26} />
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Trade Journal</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {GRADES.map((g) => (
            <Pressable key={g} testID={`filter-${g}`} onPress={() => setFilter(g)}
              style={[styles.chip, filter === g && styles.chipActive]}>
              <Text style={[styles.chipTxt, filter === g && styles.chipTxtActive]}>{g === "All" ? "All" : `Grade ${g}`}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : trades.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="documents-outline" size={44} color={colors.onSurface3} />
          <Text style={styles.emptyTxt}>No trades found</Text>
        </View>
      ) : (
        <FlatList
          data={trades}
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["3xl"], marginBottom: spacing.md },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  chipTxtActive: { color: colors.onBrand },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyTxt: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.lg },
  row: { flexDirection: "row", backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  strip: { width: 4 },
  rowMain: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  symbol: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  pnl: { fontFamily: font.displayBold, fontSize: fs.xl },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  setup: { flex: 1, color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, marginRight: spacing.md },
});
