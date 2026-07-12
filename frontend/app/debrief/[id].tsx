import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { colors, spacing, radius, font, fs, money, pnlColor, glow } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { GradeBadge, ScreenBackground } from "@/src/components/ui";

type Debrief = {
  went_right: string[];
  watch_out: string[];
  mistake_tags: string[];
  summary: string;
  created_at?: string;
};

export default function TradeDebrief() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const A = useAccent().theme;
  const [trade, setTrade] = useState<any>(null);
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const generate = useCallback(async (regen: boolean) => {
    setGenerating(true);
    try {
      const d = await api.post(`/trades/${id}/debrief${regen ? "?regenerate=true" : ""}`);
      setDebrief(d);
    } catch (e: any) {
      toast(e.message || "Could not generate debrief", "error");
    } finally {
      setGenerating(false);
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const t = await api.get(`/trades/${id}`);
        setTrade(t);
        if (t?.debrief) setDebrief(t.debrief);
        else await generate(false);
      } catch (e: any) {
        toast(e.message || "Trade not found", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading || !trade) {
    return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  }

  const win = (trade.pnl || 0) >= 0;
  const isClean = debrief?.mistake_tags?.length === 1 && debrief.mistake_tags[0] === "Good Discipline";

  return (
    <View style={styles.flex}>
      <ScreenBackground tone={win ? "up" : "down"} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="debrief-back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>AI Trade Debrief</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }}>
        {/* Trade summary strip */}
        <View style={styles.tradeStrip}>
          <View style={{ flex: 1 }}>
            <Text style={styles.symbol}>{trade.symbol}</Text>
            <Text style={styles.sub}>{String(trade.direction || "").toUpperCase()} · {trade.asset_type} · {trade.trade_time || "—"}</Text>
            <Text style={[styles.pnl, { color: pnlColor(trade.pnl) }]}>{money(trade.pnl || 0)}</Text>
          </View>
          <GradeBadge grade={trade.setup_grade || "C"} size={52} />
        </View>

        {generating && !debrief ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={A.accent} />
            <Text style={styles.loadingTxt}>Claude is reviewing this trade…</Text>
          </View>
        ) : debrief ? (
          <>
            {/* Summary */}
            {!!debrief.summary && (
              <View style={[styles.summaryCard, { borderColor: A.accent, ...glow(A.accent, 0.25) }]}>
                <Ionicons name="sparkles" size={16} color={A.accent} />
                <Text style={styles.summaryTxt}>{debrief.summary}</Text>
              </View>
            )}

            {/* Mistake tags */}
            {debrief.mistake_tags.length > 0 && (
              <View style={styles.tagWrap}>
                {debrief.mistake_tags.map((tag, i) => {
                  const good = tag === "Good Discipline";
                  const c = good ? colors.success : colors.error;
                  return (
                    <View key={i} style={[styles.tag, { backgroundColor: c + "1F", borderColor: c + "66" }]}>
                      <Ionicons name={good ? "shield-checkmark" : "warning"} size={13} color={c} />
                      <Text style={[styles.tagTxt, { color: c }]}>{tag}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* What went right */}
            {debrief.went_right.length > 0 && (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>What went right</Text>
                {debrief.went_right.map((r, i) => (
                  <View key={i} style={styles.line}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                    <Text style={styles.lineTxt}>{r}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* What to watch */}
            {debrief.watch_out.length > 0 && (
              <View style={styles.block}>
                <Text style={styles.blockTitle}>What to watch</Text>
                {debrief.watch_out.map((r, i) => (
                  <View key={i} style={styles.line}>
                    <Ionicons name="alert-circle" size={18} color={colors.warning} />
                    <Text style={styles.lineTxt}>{r}</Text>
                  </View>
                ))}
              </View>
            )}

            {isClean && debrief.watch_out.length === 0 && (
              <Text style={styles.cleanNote}>Clean execution — nothing flagged. Keep it up.</Text>
            )}

            <Pressable testID="debrief-regenerate" style={[styles.regenBtn, generating && { opacity: 0.5 }]} onPress={() => generate(true)} disabled={generating}>
              {generating ? <ActivityIndicator color={A.accent} /> : <><Ionicons name="refresh" size={18} color={A.accent} /><Text style={[styles.regenTxt, { color: A.accent }]}>Regenerate debrief</Text></>}
            </Pressable>

            <Pressable testID="debrief-view-trade" style={styles.viewTradeBtn} onPress={() => router.push(`/trade/${id}`)}>
              <Ionicons name="document-text-outline" size={18} color={colors.brand} />
              <Text style={styles.viewTradeTxt}>View full trade details</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
            </Pressable>
          </>
        ) : (
          <Pressable testID="debrief-generate" style={[styles.genBtn, { backgroundColor: A.accent, shadowColor: A.accent }]} onPress={() => generate(false)}>
            <Ionicons name="sparkles" size={20} color={A.onAccent} />
            <Text style={[styles.genTxt, { color: A.onAccent }]}>Generate Debrief</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface2 },
  headerTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  tradeStrip: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  symbol: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  sub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, marginTop: 2 },
  pnl: { fontFamily: font.displayBold, fontSize: fs.xl, marginTop: spacing.xs },
  loadingBox: { alignItems: "center", gap: spacing.md, padding: spacing.xxl },
  loadingTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  summaryCard: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1 },
  summaryTxt: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg, lineHeight: 24 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  tagTxt: { fontFamily: font.displayBold, fontSize: fs.sm },
  block: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  blockTitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  lineTxt: { flex: 1, color: colors.onSurface, fontFamily: font.text, fontSize: fs.base, lineHeight: 21 },
  cleanNote: { color: colors.success, fontFamily: font.text, fontSize: fs.base, textAlign: "center", marginTop: spacing.sm },
  genBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.lg, marginTop: spacing.sm, ...glow("#000", 0.5) },
  genTxt: { fontFamily: font.displayBold, fontSize: fs.lg },
  regenBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: spacing.md, marginTop: spacing.sm },
  regenTxt: { fontFamily: font.display, fontSize: fs.base },
  viewTradeBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  viewTradeTxt: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: fs.base },
});
