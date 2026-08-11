import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAutoRefresh } from "@/src/hooks/useAutoRefresh";
import { colors, spacing, radius, font, fs } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const EMO_COLOR = (avg: number) => (avg >= 0 ? colors.success : colors.error);

function parsePlan(text: string) {
  if (!text) return [];
  const heads = ["Focus", "Watch-outs", "Key Levels"];
  const out: { h: string; body: string }[] = [];
  let rest = text;
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const idx = rest.indexOf(h);
    if (idx === -1) continue;
    const next = heads.slice(i + 1).map((n) => rest.indexOf(n)).filter((x) => x > idx);
    const end = next.length ? Math.min(...next) : rest.length;
    out.push({ h, body: rest.slice(idx + h.length, end).replace(/^[:\s]+/, "").trim() });
  }
  return out.length ? out : [{ h: "Game Plan", body: text }];
}

const HEAD_ICON: Record<string, any> = { Focus: "flag", "Watch-outs": "warning", "Key Levels": "layers", "Game Plan": "sparkles" };

export default function GamePlan() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const [plan, setPlan] = useState<any>(null);
  const [emotion, setEmotion] = useState<any>(null);
  const [streak, setStreak] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, e, s] = await Promise.all([
        api.get("/coach/game-plan"),
        api.get("/insights/emotion"),
        api.get("/insights/streak"),
      ]);
      setPlan(p); setEmotion(e); setStreak(s); setLocked(false);
    } catch (err: any) {
      if (err.status === 402) setLocked(true);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useAutoRefresh(load, 30000);

  const sections = parsePlan(plan?.game_plan || "");

  return (
    <View style={styles.flex}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="gameplan-back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>AI Game Plan</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={A.accent} size="large" /></View>
      ) : locked ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={44} color={colors.onSurface3} />
          <Text style={styles.empty}>Your AI pre-market game plan and coaching insights are a Premium feature.</Text>
          <Pressable testID="gameplan-upgrade" style={[styles.upgrade, { backgroundColor: A.accent }]} onPress={() => router.push("/(tabs)/profile")}>
            <Text style={[styles.upgradeTxt, { color: A.onAccent }]}>Upgrade to Premium</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={A.accent} />}
        >
          {streak && (
            <View style={styles.streakRow}>
              <View style={styles.streakCard}>
                <Text style={[styles.streakVal, { color: A.accent }]}>{streak.current_streak}</Text>
                <Text style={styles.streakLabel}>Current rule streak</Text>
              </View>
              <View style={styles.streakCard}>
                <Text style={[styles.streakVal, { color: colors.success }]}>{streak.best_streak}</Text>
                <Text style={styles.streakLabel}>Best streak</Text>
              </View>
            </View>
          )}

          {!plan?.has_data ? (
            <View style={styles.card}><Text style={styles.empty}>Log a few trades and your AI coach will build a personalized pre-market game plan here.</Text></View>
          ) : (
            sections.map((sec) => (
              <View key={sec.h} style={styles.card}>
                <View style={styles.cardHead}>
                  <Ionicons name={HEAD_ICON[sec.h] || "sparkles"} size={16} color={A.accent} />
                  <Text style={styles.cardTitle}>{sec.h}</Text>
                </View>
                <Text style={styles.cardBody}>{sec.body}</Text>
              </View>
            ))
          )}

          {emotion?.has_data && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Ionicons name="happy" size={16} color={A.accent} />
                <Text style={styles.cardTitle}>Emotion vs P&amp;L</Text>
              </View>
              <Text style={styles.cardSub}>How your tagged emotions map to results.</Text>
              {emotion.by_emotion.map((e: any) => (
                <View key={e.emotion} style={styles.emoRow}>
                  <Text style={styles.emoName}>{e.emotion}</Text>
                  <Text style={styles.emoMeta}>{e.trades} trade{e.trades > 1 ? "s" : ""} · {e.win_rate}% win</Text>
                  <Text style={[styles.emoPnl, { color: EMO_COLOR(e.avg_pnl) }]}>{e.avg_pnl >= 0 ? "+" : "-"}{money(Math.abs(e.avg_pnl))}/trade</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  empty: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base, textAlign: "center", lineHeight: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface2 },
  headerTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  upgrade: { borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  upgradeTxt: { fontFamily: font.displayBold, fontSize: fs.base },
  streakRow: { flexDirection: "row", gap: spacing.md },
  streakCard: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: "center" },
  streakVal: { fontFamily: font.displayBold, fontSize: 34 },
  streakLabel: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginTop: 2 },
  card: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  cardTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  cardSub: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  cardBody: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, lineHeight: 21, marginTop: 2 },
  emoRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  emoName: { flex: 1, color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.base },
  emoMeta: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginRight: spacing.sm },
  emoPnl: { fontFamily: font.displayBold, fontSize: fs.sm },
});
