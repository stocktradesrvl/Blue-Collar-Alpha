import React, { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";

const SUGGESTIONS = ["Why am I losing money?", "What's my best setup?", "Should I stop after two losses?", "What mistakes cost me the most?"];
const FOLLOWUPS = [
  "Show my worst day",
  "Compare Monday vs Friday",
  "Which setup should I avoid?",
  "Am I overtrading?",
  "How's my risk management?",
  "Which strategy is most profitable?",
  "When should I stop for the day?",
  "What's my average winner vs loser?",
];

export default function Coach() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const locked = user?.subscription_tier !== "premium";

  const load = useCallback(async () => {
    if (locked) return;
    try { setMessages(await api.get("/coach/history")); } catch {}
  }, [locked]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const r = await api.post("/coach/chat", { message: text });
      setMessages([...next, { role: "assistant", content: r.reply }]);
      setSuggestions(Array.isArray(r.suggestions) ? r.suggestions : []);
    } catch (e: any) {
      setMessages([...next, { role: "assistant", content: e.message || "Something went wrong." }]);
      setSuggestions([]);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  if (locked) {
    return (
      <View style={styles.flex}>
        <View style={[styles.lock, { paddingTop: insets.top + 80 }]}>
          <View style={styles.lockIcon}><Ionicons name="sparkles" size={40} color={colors.brand} /></View>
          <Text style={styles.lockTitle}>AI Coach Chat</Text>
          <Text style={styles.lockSub}>Ask questions about your own trading data. Available on the Premium plan.</Text>
          <Pressable testID="upgrade-coach" style={styles.upgradeBtn} onPress={() => router.push("/(tabs)/profile")}>
            <Text style={styles.upgradeTxt}>Upgrade to Premium</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>AI Coach</Text>
        <Text style={styles.subtitle}>Answers from your own trades</Text>
      </View>
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}>
        {messages.length === 0 && (
          <View style={styles.greet}>
            <Text style={styles.greetTxt}>{"How was today's session? Ask me anything about your trading."}</Text>
            <View style={styles.sugWrap}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} testID={`suggest-${s.slice(0,6)}`} style={styles.sug} onPress={() => send(s)}>
                  <Text style={styles.sugTxt}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === "user" ? styles.user : styles.ai]}>
            {m.role === "assistant" && <Ionicons name="sparkles" size={14} color={colors.brand} style={{ marginBottom: 4 }} />}
            <Text style={[styles.msgTxt, m.role === "user" && { color: colors.onBrand }]}>{m.content}</Text>
          </View>
        ))}
        {busy && <View style={[styles.bubble, styles.ai]}><ActivityIndicator color={colors.brand} /></View>}
        {!busy && messages.length > 0 && messages[messages.length - 1].role === "assistant" && (
          <View style={styles.followWrap}>
            <Text style={styles.followLabel}>Follow up</Text>
            <View style={styles.followRow}>
              {(suggestions.length > 0 ? suggestions : FOLLOWUPS.filter((f) => !messages.some((m) => m.content === f))).slice(0, 3).map((f) => (
                <Pressable key={f} testID={`followup-${f.slice(0, 6)}`} style={styles.followChip} onPress={() => send(f)}>
                  <Text style={styles.followTxt}>{f}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
      <View style={[styles.inputBar, { paddingBottom: insets.bottom || spacing.md }]}>
        <TextInput testID="coach-input" style={styles.input} placeholder="Ask your coach..." placeholderTextColor={colors.onSurface3}
          value={input} onChangeText={setInput} multiline />
        <Pressable testID="coach-send" style={styles.sendBtn} onPress={() => send(input)} disabled={busy}>
          <Ionicons name="arrow-up" size={22} color={colors.onBrand} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["3xl"] },
  subtitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  greet: { marginTop: spacing.md },
  greetTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.lg, marginBottom: spacing.lg },
  sugWrap: { gap: spacing.sm },
  sug: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  sugTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.base },
  bubble: { maxWidth: "85%", borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  user: { backgroundColor: colors.brand, alignSelf: "flex-end", borderBottomRightRadius: radius.sm },
  ai: { backgroundColor: colors.surface2, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.sm },
  msgTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg, lineHeight: 22 },
  followWrap: { marginTop: spacing.sm, marginBottom: spacing.md },
  followLabel: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: spacing.sm },
  followRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  followChip: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  followTxt: { color: colors.brand, fontFamily: font.text, fontSize: fs.base },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface2 },
  input: { flex: 1, maxHeight: 120, backgroundColor: colors.surface3, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg },
  sendBtn: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  lock: { flex: 1, alignItems: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  lockIcon: { width: 80, height: 80, borderRadius: radius.lg, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  lockTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  lockSub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.lg, textAlign: "center" },
  upgradeBtn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.xxl, paddingVertical: spacing.lg, marginTop: spacing.lg },
  upgradeTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg },
});
