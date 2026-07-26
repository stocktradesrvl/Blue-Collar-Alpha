import React, { useEffect, useState } from "react";
import { Pressable, Text, StyleSheet, ActivityIndicator, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";

export default function DiscordLoginButton({ onLogin }: { onLogin: (token: string) => Promise<void> }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/config").then((c) => setEnabled(!!c?.discord_enabled)).catch(() => {});
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const origin = process.env.EXPO_PUBLIC_BACKEND_URL!;
      const returnUrl = Linking.createURL("discord-login");
      const { url } = await api.get(
        `/auth/discord/login-url?origin=${encodeURIComponent(origin)}&return_url=${encodeURIComponent(returnUrl)}`
      );
      const res = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (res.type === "success" && res.url) {
        const q = Linking.parse(res.url).queryParams || {};
        const token = q.token as string | undefined;
        if (token) await onLogin(token);
        else if (q.discord !== "cancelled") toast("Discord sign-in failed", "error");
      }
    } catch (e: any) {
      toast(e?.message || "Discord sign-in failed", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>
      <Pressable testID="discord-login" style={styles.btn} onPress={start} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="logo-discord" size={20} color="#fff" />
            <Text style={styles.txt}>Continue with Discord</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: "#5865F2", borderRadius: radius.md, paddingVertical: spacing.lg },
  txt: { color: "#fff", fontFamily: font.displayBold, fontSize: fs.lg, letterSpacing: 0.3 },
});
