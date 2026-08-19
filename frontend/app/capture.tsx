import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { useAuth } from "@/src/context/AuthContext";
import { useShareIntentContext } from "@/src/context/ShareIntentContext";
import { useAccent } from "@/src/context/AccentContext";
import { ensureNotifPermission, notifyLocal } from "@/src/utils/notifications";
import { ScreenBackground } from "@/src/components/ui";
import { colors, spacing, radius, font, fs } from "@/src/theme";

export const PENDING_SHARE_KEY = "bca_pending_share";

const GRADE_TXT: Record<string, string> = { A: "A · textbook", B: "B · solid", C: "C · okay", D: "D · sloppy", F: "F · avoid" };

/**
 * Landing screen when a screenshot is shared into the app. It hands the image off
 * to the AI in the background, fires a local notification with the read, and lets
 * the user head straight back to their broker (or review now).
 */
export default function Capture() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const { user } = useAuth();
  const { pending, clear } = useShareIntentContext();
  const [state, setState] = useState<"working" | "done" | "empty" | "locked" | "error">("working");
  const [result, setResult] = useState<any>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const b64 = pending?.base64;
      if (!b64) { setState("empty"); return; }
      // Stash the image so the Coach can pick it up (even on a cold notification tap),
      // then release the in-memory copy.
      await storage.setItem(PENDING_SHARE_KEY, b64);
      clear();

      if (user?.subscription_tier !== "premium") { setState("locked"); return; }

      await ensureNotifPermission();
      try {
        const r = await api.post("/trades/analyze-screenshot", { image_base64: b64, preview: true });
        setResult(r);
        const pnl = Number(r?.pnl || 0);
        const pnlStr = pnl ? ` · ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "";
        const grade = String(r?.setup_grade || "C");
        await notifyLocal(
          `📸 Trade captured — ${r?.symbol || "screenshot"}`,
          `${r?.detected_setup || "Setup"} · Grade ${grade}${pnlStr}\nTap to log it or ask your coach.`,
          { route: "/(tabs)/coach" },
        );
        setState("done");
      } catch (e) {
        // Still let the user know it landed, even if the read failed.
        await notifyLocal("📸 Screenshot received", "Tap to log it or ask your coach.", { route: "/(tabs)/coach" });
        setState("error");
      }
    })();
  }, [pending, user, clear]);

  const goCoach = () => router.replace("/(tabs)/coach");
  const goHome = () => router.replace("/(tabs)");

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <ScreenBackground />
      <View style={styles.center}>
        {state === "working" && (
          <>
            <View style={[styles.iconWrap, { backgroundColor: A.accentTint }]}>
              <ActivityIndicator color={A.accent} size="large" />
            </View>
            <Text style={styles.title}>Reading your screenshot…</Text>
            <Text style={styles.sub}>Hang tight — we'll ping you with the read. You can head back to your broker.</Text>
          </>
        )}

        {(state === "done" || state === "error") && (
          <>
            <View style={[styles.iconWrap, { backgroundColor: colors.success + "22" }]}>
              <Ionicons name="checkmark-circle" size={44} color={colors.success} />
            </View>
            <Text style={styles.title}>
              {result?.symbol ? `${result.symbol} captured` : "Screenshot captured"}
            </Text>
            {result?.detected_setup ? (
              <Text style={styles.readLine}>
                {result.detected_setup} · Grade {GRADE_TXT[String(result.setup_grade)] || result.setup_grade}
              </Text>
            ) : null}
            {result?.ai_summary ? <Text style={styles.summary} numberOfLines={4}>{result.ai_summary}</Text> : null}
            <Text style={styles.sub}>We sent you a notification. Pop back into your broker, or review it now.</Text>
            <Pressable testID="capture-review" style={[styles.primary, { backgroundColor: A.accent }]} onPress={goCoach}>
              <Text style={[styles.primaryTxt, { color: A.onAccent }]}>Review now</Text>
            </Pressable>
            <Pressable testID="capture-done" style={styles.secondary} onPress={goHome}>
              <Text style={styles.secondaryTxt}>Done</Text>
            </Pressable>
          </>
        )}

        {state === "locked" && (
          <>
            <View style={[styles.iconWrap, { backgroundColor: A.accentTint }]}>
              <Ionicons name="lock-closed" size={40} color={A.accent} />
            </View>
            <Text style={styles.title}>Premium feature</Text>
            <Text style={styles.sub}>Share-to-coach with instant AI reads is part of Premium.</Text>
            <Pressable testID="capture-upgrade" style={[styles.primary, { backgroundColor: A.accent }]} onPress={() => router.replace("/(tabs)/profile")}>
              <Text style={[styles.primaryTxt, { color: A.onAccent }]}>Upgrade to Premium</Text>
            </Pressable>
            <Pressable testID="capture-done" style={styles.secondary} onPress={goHome}>
              <Text style={styles.secondaryTxt}>Not now</Text>
            </Pressable>
          </>
        )}

        {state === "empty" && (
          <>
            <View style={[styles.iconWrap, { backgroundColor: colors.surface3 }]}>
              <Ionicons name="image-outline" size={40} color={colors.onSurface3} />
            </View>
            <Text style={styles.title}>Nothing to analyze</Text>
            <Text style={styles.sub}>Share a screenshot of your trade from your broker to Blue Collar Alpha.</Text>
            <Pressable testID="capture-done" style={[styles.primary, { backgroundColor: A.accent }]} onPress={goHome}>
              <Text style={[styles.primaryTxt, { color: A.onAccent }]}>Go to dashboard</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.md },
  iconWrap: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"], textAlign: "center" },
  readLine: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg, textAlign: "center" },
  summary: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, textAlign: "center", lineHeight: 20 },
  sub: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base, textAlign: "center", lineHeight: 20, marginBottom: spacing.md },
  primary: { borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xxl, alignItems: "center", alignSelf: "stretch" },
  primaryTxt: { fontFamily: font.displayBold, fontSize: fs.lg },
  secondary: { paddingVertical: spacing.md, alignItems: "center", alignSelf: "stretch" },
  secondaryTxt: { color: colors.onSurface3, fontFamily: font.displayBold, fontSize: fs.base },
});
