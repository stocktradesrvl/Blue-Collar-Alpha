import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { useVoiceNote } from "@/src/hooks/useVoiceNote";
import { useShareIntentContext } from "@/src/context/ShareIntentContext";
import { colors, spacing, radius, font, fs, gradients, glow } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";

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
  const A = useAccent().theme;
  const [messages, setMessages] = useState<{ role: string; content: string; image?: string }[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const locked = user?.subscription_tier !== "premium";
  const toast = useToast();
  const voice = useVoiceNote(toast, false);
  const { pending, clear } = useShareIntentContext();
  const processingShare = useRef(false);

  const analyzeShared = useCallback(async (base64: string) => {
    processingShare.current = true;
    setSuggestions([]);
    let history: { role: string; content: string }[] = [];
    try { history = await api.get("/coach/history"); } catch {}
    const withUser = [...history, { role: "user", content: "📷 Shared a screenshot", image: `data:image/jpeg;base64,${base64}` }];
    setMessages(withUser);
    setBusy(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const r = await api.post("/coach/analyze-image", { image_base64: base64 });
      setMessages([...withUser, { role: "assistant", content: r.reply }]);
      setSuggestions(Array.isArray(r.suggestions) ? r.suggestions : []);
    } catch (e: any) {
      setMessages([...withUser, { role: "assistant", content: e.message || "Could not analyze that screenshot." }]);
    } finally {
      setBusy(false);
      processingShare.current = false;
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, []);

  useEffect(() => {
    if (!pending?.base64) return;
    if (locked) { clear(); toast("Sharing screenshots to Coach is a Premium feature.", "info"); return; }
    const b64 = pending.base64;
    clear();
    analyzeShared(b64);
  }, [pending, locked, clear, analyzeShared, toast]);

  const onMicPress = async () => {
    if (busy) return;
    if (voice.recording) {
      const r = await voice.stop();
      if (r?.text) setInput((prev) => (prev ? `${prev} ${r.text}` : r.text));
    } else {
      await voice.start();
    }
  };

  const load = useCallback(async () => {
    if (locked || processingShare.current) return;
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
        <ScreenBackground />
        <View style={[styles.lock, { paddingTop: insets.top + 80 }]}>
          <View style={[styles.lockIcon, { backgroundColor: A.accentTint, shadowColor: A.accent }]}><Ionicons name="sparkles" size={40} color={A.accent} /></View>
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
      <ScreenBackground />
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
          m.role === "user" ? (
            <LinearGradient key={i} colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.bubble, styles.user]}>
              {m.image ? <Image source={{ uri: m.image }} style={styles.sharedImg} resizeMode="cover" /> : null}
              <Text style={[styles.msgTxt, { color: colors.onBrand }]}>{m.content}</Text>
            </LinearGradient>
          ) : (
            <LinearGradient key={i} colors={["rgba(46,118,232,0.16)", "rgba(22,27,34,0.95)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.bubble, styles.ai]}>
              <Ionicons name="sparkles" size={14} color={A.accent} style={{ marginBottom: 4 }} />
              <Text style={styles.msgTxt}>{m.content}</Text>
            </LinearGradient>
          )
        ))}
        {busy && <View style={[styles.bubble, styles.ai]}><ActivityIndicator color={colors.brand} /></View>}
        {!busy && messages.length > 0 && messages[messages.length - 1].role === "assistant" && (
          <View style={styles.followWrap}>
            <Text style={styles.followLabel}>Follow up</Text>
            <View style={styles.followRow}>
              {(suggestions.length > 0 ? suggestions : FOLLOWUPS.filter((f) => !messages.some((m) => m.content === f))).slice(0, 3).map((f) => (
                <Pressable key={f} testID={`followup-${f.slice(0, 6)}`} style={[styles.followChip, { backgroundColor: A.accentTint, borderColor: A.accent }]} onPress={() => send(f)}>
                  <Text style={[styles.followTxt, { color: A.accent }]}>{f}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
      <View style={[styles.inputBar, { paddingBottom: insets.bottom || spacing.md }]}>
        <Pressable testID="coach-mic" onPress={onMicPress} disabled={busy || voice.transcribing}
          style={[styles.micBtn, voice.recording && { backgroundColor: colors.error + "22", borderColor: colors.error }]}>
          {voice.transcribing ? (
            <ActivityIndicator color={A.accent} />
          ) : (
            <Ionicons name={voice.recording ? "stop" : "mic"} size={22} color={voice.recording ? colors.error : A.accent} />
          )}
        </Pressable>
        <TextInput testID="coach-input" style={styles.input}
          placeholder={voice.recording ? "Listening… tap stop when done" : "Ask your coach…"} placeholderTextColor={colors.onSurface3}
          value={input} onChangeText={setInput} multiline editable={!voice.recording} />
        <Pressable testID="coach-send" onPress={() => send(input)} disabled={busy}>
          <LinearGradient colors={A.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.sendBtn, { shadowColor: A.accent }]}>
            <Ionicons name="arrow-up" size={22} color={A.onAccent} />
          </LinearGradient>
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
  ai: { backgroundColor: colors.surface2, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.borderStrong, borderBottomLeftRadius: radius.sm },
  msgTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg, lineHeight: 22 },
  sharedImg: { width: 200, height: 130, borderRadius: radius.md, marginBottom: spacing.sm, backgroundColor: colors.surface3 },
  followWrap: { marginTop: spacing.sm, marginBottom: spacing.md },
  followLabel: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: spacing.sm },
  followRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  followChip: { backgroundColor: colors.accentTint, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  followTxt: { color: colors.accent, fontFamily: font.text, fontSize: fs.base },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface2 },
  input: { flex: 1, maxHeight: 120, backgroundColor: colors.surface3, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg },
  sendBtn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", ...glow(colors.accent, 0.5) },
  micBtn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface3, borderWidth: 1, borderColor: colors.border },
  lock: { flex: 1, alignItems: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  lockIcon: { width: 80, height: 80, borderRadius: radius.lg, backgroundColor: colors.accentTint, alignItems: "center", justifyContent: "center", marginBottom: spacing.md, ...glow(colors.accent, 0.4) },
  lockTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  lockSub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.lg, textAlign: "center" },
  upgradeBtn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.xxl, paddingVertical: spacing.lg, marginTop: spacing.lg },
  upgradeTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg },
});
