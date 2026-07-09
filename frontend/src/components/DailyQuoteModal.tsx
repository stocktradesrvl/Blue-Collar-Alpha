import React, { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { storage } from "@/src/utils/storage";
import { colors, spacing, radius, font, fs, gradients, glow } from "@/src/theme";
import { TRADER_QUOTES, Quote } from "@/src/traderQuotes";
import { WHATS_NEW_VERSION } from "@/src/whatsNew";

const DATE_KEY = "tm_daily_quote_date";
const POOL_KEY = "tm_daily_quote_pool";
const WHATS_NEW_SEEN_KEY = "tm_whats_new_version";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function shuffle(arr: number[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shows a motivational trader quote once per day on first open,
// cycling through the pool so quotes don't repeat until all are seen.
export default function DailyQuoteModal() {
  const [visible, setVisible] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => {
    (async () => {
      const lastDate = await storage.getItem<string>(DATE_KEY, "");
      if (lastDate === todayStr()) return; // already shown today

      // Defer to the "What's New" sheet if it will show this session.
      const seenVersion = await storage.getItem<string>(WHATS_NEW_SEEN_KEY, "");
      if (seenVersion !== WHATS_NEW_VERSION) return;

      let pool = String(await storage.getItem<string>(POOL_KEY, "") || "")
        .split(",").map((n) => parseInt(n, 10)).filter((n) => !isNaN(n) && n < TRADER_QUOTES.length);
      if (pool.length === 0) pool = shuffle(TRADER_QUOTES.map((_, i) => i));

      const idx = pool.shift() as number;
      setQuote(TRADER_QUOTES[idx]);
      await storage.setItem(POOL_KEY, pool.join(","));
      await storage.setItem(DATE_KEY, todayStr());
      setVisible(true);
    })();
  }, []);

  if (!quote) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.overlay}>
        <LinearGradient colors={gradients.card} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
          <View style={styles.badge}>
            <Ionicons name="trending-up" size={24} color={colors.onAccent} />
          </View>
          <Text style={styles.eyebrow}>{"Today's Edge"}</Text>
          <Ionicons name="chatbox-ellipses" size={20} color={colors.brand} style={{ marginBottom: spacing.sm }} />
          <Text style={styles.quote}>{`"${quote.text}"`}</Text>
          <Text style={styles.author}>— {quote.author}</Text>

          <Pressable testID="daily-quote-dismiss" style={styles.btn} onPress={() => setVisible(false)}>
            <Text style={styles.btnTxt}>{"Let's Trade"}</Text>
          </Pressable>
        </LinearGradient>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  card: {
    width: "100%", borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: colors.borderStrong + "66",
    alignItems: "center", ...glow(colors.brand, 0.35),
  },
  badge: {
    width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md, ...glow(colors.accent, 0.5),
  },
  eyebrow: { color: colors.accent, fontFamily: font.displayBold, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 2, marginBottom: spacing.md },
  quote: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.xl, lineHeight: 28, textAlign: "center" },
  author: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, marginTop: spacing.md },
  btn: { marginTop: spacing.xl, alignSelf: "stretch", backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", ...glow(colors.brand, 0.4) },
  btnTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg, letterSpacing: 0.5 },
});
