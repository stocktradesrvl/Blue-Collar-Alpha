import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { colors, spacing, radius, font, fs, money, pnlColor, glow } from "@/src/theme";
import { GradeBadge } from "@/src/components/ui";
import { WinBurst } from "@/src/components/WinBurst";

export default function TradeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [trade, setTrade] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bigWin, setBigWin] = useState(false);

  const load = useCallback(async () => {
    try {
      const t = await api.get(`/trades/${id}`);
      setTrade(t);
      try {
        const s = await api.get("/dashboard/stats");
        const avg = s?.avg_winner || 0;
        const isBig = (t?.pnl || 0) > 0 && t?.taken !== false && (avg > 0 ? t.pnl >= avg * 1.5 : t.pnl >= 500);
        if (isBig) setBigWin(true);
      } catch {}
    } catch (e: any) { toast(e.message, "error"); }
    setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const del = async () => { await api.del(`/trades/${id}`); toast("Trade deleted", "info"); router.replace("/(tabs)/journal"); };

  const toggleTaken = async () => {
    const next = trade.taken === false;
    try {
      await api.put(`/trades/${id}/taken`, { taken: next });
      setTrade({ ...trade, taken: next });
      toast(next ? "Marked as executed" : "Marked as idea (excluded from stats)", "info");
    } catch (e: any) { toast(e.message, "error"); }
  };

  if (loading || !trade) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;

  const win = (trade.pnl || 0) >= 0;
  const heroTop = win ? "rgba(0,230,118,0.30)" : "rgba(255,61,0,0.30)";

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View style={styles.hero}>
          {trade.image_base64 ? (
            <Image source={{ uri: `data:image/jpeg;base64,${trade.image_base64}` }} style={styles.heroImg} contentFit="cover" />
          ) : <View style={[styles.heroImg, { backgroundColor: colors.surface2 }]} />}
          <LinearGradient colors={[heroTop, "rgba(13,17,23,0.55)", "rgba(13,17,23,0.97)"]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
          <Pressable testID="back-detail" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/journal")} style={[styles.back, { top: insets.top + spacing.sm }]}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
          <Pressable testID="delete-trade" onPress={del} style={[styles.delBtn, { top: insets.top + spacing.sm }]}>
            <Ionicons name="trash-outline" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={styles.heroBottom}>
            <View>
              <Text style={styles.symbol}>{trade.symbol}</Text>
              <Text style={styles.sub}>{String(trade.direction || "").toUpperCase()} · {trade.asset_type} · {trade.trade_time || "—"}</Text>
            </View>
            <GradeBadge grade={trade.setup_grade || "C"} size={48} />
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.pnlRow}>
            <Text style={styles.pnlLabel}>Realized P&L</Text>
            <Text style={[styles.pnlVal, { color: pnlColor(trade.pnl) }]}>{money(trade.pnl || 0)}</Text>
          </View>

          <View style={styles.metrics}>
            <Metric label="Entry" value={`$${trade.entry}`} />
            <Metric label="Exit" value={trade.exit ? `$${trade.exit}` : "—"} />
            <Metric label="Qty" value={`${trade.quantity}`} />
          </View>

          <View style={styles.setupCard}>
            <Text style={styles.setupLabel}>Detected Setup</Text>
            <Text style={styles.setupName}>{String(trade.detected_setup || "Unknown")}</Text>
          </View>

          <Pressable testID="toggle-taken" style={styles.takenCard} onPress={toggleTaken}>
            <Ionicons name={trade.taken !== false ? "checkmark-circle" : "eye-outline"} size={20} color={trade.taken !== false ? colors.success : colors.warning} />
            <Text style={styles.takenCardTxt}>{trade.taken !== false ? "Executed trade" : "Missed / idea (not counted in stats)"}</Text>
            <Text style={styles.takenToggle}>Change</Text>
          </Pressable>

          {(trade.strategy_names && trade.strategy_names.length > 0) ? (
            <View style={styles.stratWrap}>
              {trade.strategy_names.map((n: string, i: number) => (
                <View key={i} style={styles.stratPill}><Text style={styles.stratPillTxt}>{n}</Text></View>
              ))}
            </View>
          ) : null}

          <Text style={styles.section}>Strategy Check</Text>
          <View style={[styles.checkCard, { borderColor: trade.strategy_followed ? colors.success : colors.error }]}>
            <Ionicons name={trade.strategy_followed ? "checkmark-circle" : "alert-circle"} size={22} color={trade.strategy_followed ? colors.success : colors.error} />
            <Text style={styles.checkTxt}>{trade.strategy_followed ? "Trade followed your plan" : "Trade deviated from your plan"}</Text>
          </View>
          {(trade.rule_violations || []).map((v: string, i: number) => (
            <View key={i} style={styles.violation}>
              <Ionicons name="close-circle" size={16} color={colors.error} />
              <Text style={styles.violationTxt}>{v}</Text>
            </View>
          ))}

          <Text style={styles.section}>Coach Insight</Text>
          <View style={styles.aiCard}>
            <Ionicons name="sparkles" size={16} color={colors.brand} />
            <Text style={styles.aiTxt}>{String(trade.ai_summary || "No summary available.")}</Text>
          </View>

          {trade.advanced && Object.keys(trade.advanced).length > 0 && (
            <>
              <Text style={styles.section}>{trade.asset_type === "option" ? "Options Analysis" : trade.asset_type === "future" ? "Futures Analysis" : "Advanced Analysis"}</Text>
              <View style={styles.advCard}>
                {Object.entries(trade.advanced).map(([k, v]) => {
                  if (v === null || v === undefined || v === "") return null;
                  const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                  const isFlag = typeof v === "boolean";
                  return (
                    <View key={k} style={styles.advRow}>
                      <Text style={styles.advLabel}>{label}</Text>
                      {isFlag ? (
                        <View style={[styles.advFlag, { backgroundColor: (v ? colors.error : colors.success) + "22" }]}>
                          <Text style={[styles.advFlagTxt, { color: v ? colors.error : colors.success }]}>{v ? "Yes" : "No"}</Text>
                        </View>
                      ) : (
                        <Text style={styles.advVal}>{String(v)}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </View>
      </ScrollView>
      <WinBurst visible={bigWin} />
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  hero: { height: 280, justifyContent: "flex-end" },
  heroImg: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  back: { position: "absolute", left: spacing.lg, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: radius.pill, padding: spacing.xs },
  delBtn: { position: "absolute", right: spacing.lg, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: radius.pill, padding: spacing.sm },
  heroBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", padding: spacing.lg },
  symbol: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: 40 },
  sub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  body: { padding: spacing.lg, gap: spacing.md },
  pnlRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  pnlLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.lg },
  pnlVal: { fontFamily: font.displayBold, fontSize: fs["2xl"] },
  metrics: { flexDirection: "row", gap: spacing.md },
  metric: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  metricLabel: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  metricVal: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  setupCard: { backgroundColor: colors.brandTint, borderRadius: radius.md, padding: spacing.lg },
  setupLabel: { color: colors.brand, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8 },
  setupName: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.xl },
  takenCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  takenCardTxt: { flex: 1, color: colors.onSurface, fontFamily: font.text, fontSize: fs.base },
  takenToggle: { color: colors.brand, fontFamily: font.display, fontSize: fs.base },
  stratWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stratPill: { backgroundColor: colors.brandTint, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  stratPillTxt: { color: colors.brand, fontFamily: font.text, fontSize: fs.sm },
  section: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.sm },
  checkCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1 },
  checkTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg, flex: 1 },
  violation: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm },
  violationTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, flex: 1 },
  aiCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.brand, ...glow(colors.brand, 0.3) },
  aiTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg, lineHeight: 22, flex: 1 },
  advCard: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg },
  advRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  advLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, flex: 1 },
  advVal: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg, marginLeft: spacing.md },
  advFlag: { borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 2 },
  advFlagTxt: { fontFamily: font.text, fontSize: fs.base },
});
