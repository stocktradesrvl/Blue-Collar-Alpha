import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { api } from "@/src/api";
import { colors, spacing, radius, font, fs, money, pnlColor } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { GradeBadge, ScreenBackground } from "@/src/components/ui";
import { PressableScale } from "@/src/components/anim";

const GRADES = ["All", "A", "B", "C", "D", "F"];

export default function Journal() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("All");
  const [tab, setTab] = useState<"executed" | "missed">("executed");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter !== "All") params.set("grade", filter);
      params.set("taken", tab === "executed" ? "true" : "false");
      setTrades(await api.get(`/trades?${params.toString()}`));
    } catch {}
    setLoading(false);
  }, [filter, tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const renderItem = ({ item, index }: { item: any; index: number }) => {
    const win = (item.pnl || 0) >= 0;
    const tint = win ? colors.success : colors.error;
    return (
      <Animated.View entering={FadeInDown.duration(600).delay(Math.min(index, 8) * 70)}>
      <PressableScale testID={`trade-${item.id}`} style={[styles.row, { borderColor: tint + "33" }]} onPress={() => router.push(`/trade/${item.id}`)}>
        <View style={[styles.strip, { backgroundColor: tint }]} />
        <View style={styles.rowMain}>
          <View style={styles.rowTop}>
            <View style={styles.symbolWrap}>
              <View style={[styles.assetIcon, { backgroundColor: tint + "1F" }]}>
                <Ionicons name={item.asset_type === "option" ? "options" : item.asset_type === "future" ? "cube" : "trending-up"} size={14} color={tint} />
              </View>
              <Text style={styles.symbol}>{item.symbol}</Text>
            </View>
            <Text style={[styles.pnl, { color: pnlColor(item.pnl) }]}>{money(item.pnl || 0)}</Text>
          </View>
          <View style={styles.rowBottom}>
            <Text style={styles.setup} numberOfLines={1}>{item.detected_setup || item.strategy_name || item.asset_type} · {item.direction}</Text>
            <GradeBadge grade={item.setup_grade || "C"} size={26} />
          </View>
        </View>
      </PressableScale>
      </Animated.View>
    );
  };

  return (
    <View style={styles.flex}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Trade Journal</Text>
        <View style={styles.segment}>
          <Pressable testID="tab-executed" onPress={() => setTab("executed")} style={[styles.segBtn, tab === "executed" && [styles.segActive, { backgroundColor: A.accent }]]}>
            <Text style={[styles.segTxt, tab === "executed" && [styles.segTxtActive, { color: A.onAccent }]]}>Executed</Text>
          </Pressable>
          <Pressable testID="tab-missed" onPress={() => setTab("missed")} style={[styles.segBtn, tab === "missed" && [styles.segActive, { backgroundColor: A.accent }]]}>
            <Text style={[styles.segTxt, tab === "missed" && [styles.segTxtActive, { color: A.onAccent }]]}>Missed / Ideas</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {GRADES.map((g) => (
            <Pressable key={g} testID={`filter-${g}`} onPress={() => setFilter(g)}
              style={[styles.chip, filter === g && [styles.chipActive, { backgroundColor: A.accent, borderColor: A.accent }]]}>
              <Text style={[styles.chipTxt, filter === g && [styles.chipTxtActive, { color: A.onAccent }]]}>{g === "All" ? "All" : `Grade ${g}`}</Text>
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
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: "transparent", borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["3xl"], marginBottom: spacing.md },
  segment: { flexDirection: "row", backgroundColor: colors.surface2, borderRadius: radius.md, padding: 3, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  segBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: "center" },
  segActive: { backgroundColor: colors.accent },
  segTxt: { color: colors.onSurface2, fontFamily: font.display, fontSize: fs.base },
  segTxtActive: { color: colors.onAccent },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  chipTxtActive: { color: colors.onAccent },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyTxt: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.lg },
  row: { flexDirection: "row", backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  strip: { width: 5 },
  rowMain: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  symbolWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  assetIcon: { width: 26, height: 26, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  symbol: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  pnl: { fontFamily: font.displayBold, fontSize: fs.xl },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  setup: { flex: 1, color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, marginRight: spacing.md },
});
