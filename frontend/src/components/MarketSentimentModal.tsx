import React, { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { storage } from "@/src/utils/storage";
import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { useAccent } from "@/src/context/AccentContext";
import { useModalSlot } from "@/src/context/ModalQueue";
import { colors, spacing, radius, font, fs, gradients, glow } from "@/src/theme";

const DATE_KEY = "tm_sentiment_date";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const ICONS: Record<string, any> = { Stocks: "trending-up", Options: "pulse", Futures: "cube", Crypto: "logo-bitcoin" };

function labelColor(label: string) {
  if (label === "Bullish") return colors.success;
  if (label === "Bearish") return colors.error;
  return colors.warning;
}

export function SentimentCard({ card }: { card: any }) {
  const c = labelColor(card.label);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardTitleRow}>
          <Ionicons name={ICONS[card.cls] || "ellipse"} size={16} color={colors.onSurface2} />
          <Text style={styles.cardTitle}>{card.cls}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: c + "22" }]}>
          <Text style={[styles.pillTxt, { color: c }]}>{card.label}</Text>
        </View>
      </View>
      <Text style={styles.cardDetail}>{card.detail}</Text>
    </View>
  );
}

export default function MarketSentimentModal() {
  const { user } = useAuth();
  const A = useAccent().theme;
  const [wants, setWants] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { isActive, dismiss: releaseSlot } = useModalSlot("sentiment", 2, wants);

  useEffect(() => {
    (async () => {
      if (user?.subscription_tier !== "premium") return;
      const lastDate = await storage.getItem<string>(DATE_KEY, "");
      if (lastDate === todayStr()) return;
      setWants(true);
      setLoading(true);
      try {
        const d = await api.get("/sentiment");
        setData(d);
        await storage.setItem(DATE_KEY, todayStr());
      } catch {
        setWants(false);
        releaseSlot();
      } finally { setLoading(false); }
    })();
  }, [user?.subscription_tier]);

  if (!wants) return null;

  const dismiss = () => { setWants(false); releaseSlot(); };

  return (
    <Modal visible={isActive} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <LinearGradient colors={gradients.card} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sheet}>
          <View style={[styles.badge, { backgroundColor: A.accent, shadowColor: A.accent }]}>
            <Ionicons name="speedometer" size={24} color={A.onAccent} />
          </View>
          <Text style={[styles.eyebrow, { color: A.accent }]}>Market Sentiment</Text>
          <Text style={styles.sub}>Where the market&apos;s leaning as you start your day.</Text>

          {loading ? (
            <ActivityIndicator color={A.accent} style={{ marginVertical: spacing.xl }} />
          ) : (
            <View style={{ alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.md }}>
              {(data?.cards || []).map((c: any) => <SentimentCard key={c.cls} card={c} />)}
              {(!data?.cards || data.cards.length === 0) && <Text style={styles.empty}>Sentiment data is briefly unavailable. Try again shortly.</Text>}
            </View>
          )}

          <Pressable testID="sentiment-dismiss" style={[styles.btn, { backgroundColor: A.accent }]} onPress={dismiss}>
            <Text style={[styles.btnTxt, { color: A.onAccent }]}>{"Let's Trade"}</Text>
          </Pressable>
        </LinearGradient>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  sheet: { width: "100%", borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.borderStrong + "66", alignItems: "center", ...glow(colors.brand, 0.35) },
  badge: { width: 52, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginBottom: spacing.md, ...glow(colors.accent, 0.5) },
  eyebrow: { fontFamily: font.displayBold, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 2 },
  sub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, marginTop: spacing.xs, textAlign: "center" },
  card: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  cardTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.base },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 2 },
  pillTxt: { fontFamily: font.displayBold, fontSize: fs.sm, letterSpacing: 0.5 },
  cardDetail: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  empty: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, textAlign: "center", paddingVertical: spacing.lg },
  btn: { marginTop: spacing.xl, alignSelf: "stretch", borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", ...glow(colors.brand, 0.4) },
  btnTxt: { fontFamily: font.displayBold, fontSize: fs.lg, letterSpacing: 0.5 },
});
