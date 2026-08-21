import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { useAuth } from "@/src/context/AuthContext";
import { useVoiceNote } from "@/src/hooks/useVoiceNote";
import { useAutoRefresh } from "@/src/hooks/useAutoRefresh";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";
import { colors, spacing, radius, font, fs } from "@/src/theme";

const money = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Warm/positive vs stressful emotions get green/red accents.
const POSITIVE = ["Calm", "Confident", "Disciplined"];
const emoColor = (e: string) => (POSITIVE.includes(e) ? colors.success : ["FOMO", "Anxious", "Greedy", "Revenge"].includes(e) ? colors.error : colors.warning);

export default function VoiceJournal() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const toast = useToast();
  const { user } = useAuth();
  const locked = user?.subscription_tier !== "premium";
  const voice = useVoiceNote(toast, false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (locked) { setLoading(false); return; }
    try { setData(await api.get("/insights/emotion-voice")); } catch {}
    setLoading(false);
  }, [locked]);
  useAutoRefresh(load, 30000);

  const onMic = async () => {
    if (voice.recording) {
      const r = await voice.stop();
      if (r?.text) setText((p) => (p ? `${p} ${r.text}` : r.text));
    } else { await voice.start(); }
  };

  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const n = await api.post("/journal/voice-note", { text: text.trim() });
      toast(`Logged — sounds ${String(n.emotion).toLowerCase()}.`, "success");
      setText("");
      await load();
    } catch (e: any) { toast(e.message || "Could not save note", "error"); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    try { await api.del(`/journal/voice-note/${id}`); await load(); } catch {}
  };

  if (locked) {
    return (
      <View style={styles.flex}>
        <ScreenBackground />
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Pressable testID="vj-back" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
          <Text style={styles.title}>Voice Journal</Text><View style={{ width: 26 }} />
        </View>
        <View style={styles.lock}>
          <View style={[styles.lockIcon, { backgroundColor: A.accentTint }]}><Ionicons name="mic" size={38} color={A.accent} /></View>
          <Text style={styles.lockTitle}>Voice Journal</Text>
          <Text style={styles.lockSub}>Speak your mind after a session — the coach reads your mood and ties it to your P&L. Available on Premium.</Text>
          <Pressable testID="vj-upgrade" style={[styles.saveBtn, { backgroundColor: A.accent }]} onPress={() => router.push("/(tabs)/profile")}>
            <Text style={[styles.saveTxt, { color: A.onAccent }]}>Upgrade to Premium</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const best = data?.best_emotion, worst = data?.worst_emotion;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="vj-back" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Voice Journal</Text><View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {/* Recorder / composer */}
        <View style={styles.composer}>
          <Text style={styles.composerHint}>How did that session feel? Tap the mic and speak, or type it out.</Text>
          <TextInput testID="vj-input" style={styles.input} value={text} onChangeText={setText} multiline
            placeholder={voice.recording ? "Listening… tap stop when done" : "e.g. Felt calm and stuck to my plan today…"}
            placeholderTextColor={colors.onSurface3} editable={!voice.recording} />
          <View style={styles.composerRow}>
            <Pressable testID="vj-mic" onPress={onMic} disabled={voice.transcribing || saving}
              style={[styles.micBtn, voice.recording && { backgroundColor: colors.error + "22", borderColor: colors.error }]}>
              {voice.transcribing ? <ActivityIndicator color={A.accent} />
                : <Ionicons name={voice.recording ? "stop" : "mic"} size={22} color={voice.recording ? colors.error : A.accent} />}
            </Pressable>
            <Pressable testID="vj-save" onPress={save} disabled={!text.trim() || saving || voice.recording} style={[styles.saveBtn, { backgroundColor: text.trim() ? A.accent : colors.surface3, flex: 1 }]}>
              {saving ? <ActivityIndicator color={A.onAccent} /> : <Text style={[styles.saveTxt, { color: text.trim() ? A.onAccent : colors.onSurface3 }]}>Save & read my mood</Text>}
            </Pressable>
          </View>
        </View>

        {loading ? <ActivityIndicator color={A.accent} style={{ marginTop: 30 }} /> : !data?.has_data ? (
          <View style={styles.empty}>
            <Ionicons name="pulse-outline" size={38} color={colors.onSurface3} />
            <Text style={styles.emptyTxt}>No notes yet. After a few sessions you'll see which moods make — and lose — you money.</Text>
          </View>
        ) : (
          <>
            {(best || worst) && (
              <View style={styles.callouts}>
                {best && <View style={[styles.callout, { borderColor: emoColor(best.emotion) + "66" }]}>
                  <Text style={styles.calloutLabel}>BEST MOOD</Text>
                  <Text style={[styles.calloutEmo, { color: emoColor(best.emotion) }]}>{best.emotion}</Text>
                  <Text style={styles.calloutSub}>{money(best.avg_pnl)}/day avg · {best.count}×</Text>
                </View>}
                {worst && worst.emotion !== best?.emotion && <View style={[styles.callout, { borderColor: emoColor(worst.emotion) + "66" }]}>
                  <Text style={styles.calloutLabel}>WATCH OUT</Text>
                  <Text style={[styles.calloutEmo, { color: emoColor(worst.emotion) }]}>{worst.emotion}</Text>
                  <Text style={styles.calloutSub}>{money(worst.avg_pnl)}/day avg · {worst.count}×</Text>
                </View>}
              </View>
            )}

            <Text style={styles.section}>Mood vs P&L</Text>
            {(data.by_emotion || []).map((e: any) => (
              <View key={e.emotion} style={styles.emoRow}>
                <View style={[styles.dot, { backgroundColor: emoColor(e.emotion) }]} />
                <Text style={styles.emoName}>{e.emotion}</Text>
                <Text style={styles.emoMeta}>{e.count}× · {e.win_rate}% green</Text>
                <Text style={[styles.emoPnl, { color: e.avg_pnl >= 0 ? colors.success : colors.error }]}>{money(e.avg_pnl)}/day</Text>
              </View>
            ))}

            <Text style={styles.section}>Recent notes</Text>
            {(data.recent || []).map((n: any) => (
              <View key={n.id} style={styles.noteCard}>
                <View style={styles.noteHead}>
                  <View style={[styles.emoChip, { backgroundColor: emoColor(n.emotion) + "22" }]}>
                    <Text style={[styles.emoChipTxt, { color: emoColor(n.emotion) }]}>{n.emotion}</Text>
                  </View>
                  {!!n.tone && <Text style={styles.noteTone}>{n.tone}</Text>}
                  <Text style={[styles.notePnl, { color: n.day_pnl >= 0 ? colors.success : colors.error }]}>{money(n.day_pnl)}</Text>
                  <Pressable testID={`vj-del-${n.id}`} onPress={() => remove(n.id)} hitSlop={8}><Ionicons name="trash-outline" size={16} color={colors.onSurface3} /></Pressable>
                </View>
                <Text style={styles.noteTxt} numberOfLines={4}>{n.text}</Text>
                {!!n.reason && <Text style={styles.noteReason}>💡 {n.reason}</Text>}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  composer: { backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  composerHint: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  input: { minHeight: 84, maxHeight: 160, backgroundColor: colors.surface3, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg, textAlignVertical: "top" },
  composerRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  micBtn: { width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface3, borderWidth: 1, borderColor: colors.border },
  saveBtn: { borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: "center", justifyContent: "center" },
  saveTxt: { fontFamily: font.displayBold, fontSize: fs.base },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.md },
  emptyTxt: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base, textAlign: "center", lineHeight: 20 },
  callouts: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl },
  callout: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: 2 },
  calloutLabel: { color: colors.onSurface3, fontFamily: font.displayBold, fontSize: 11, letterSpacing: 0.8 },
  calloutEmo: { fontFamily: font.displayBold, fontSize: fs.xl },
  calloutSub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  section: { color: colors.onSurface2, fontFamily: font.displayBold, fontSize: fs.base, textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.xl, marginBottom: spacing.md },
  emoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  emoName: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.base, width: 96 },
  emoMeta: { flex: 1, color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  emoPnl: { fontFamily: font.displayBold, fontSize: fs.base },
  noteCard: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm, gap: 6 },
  noteHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  emoChip: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 },
  emoChipTxt: { fontFamily: font.displayBold, fontSize: fs.sm },
  noteTone: { flex: 1, color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, fontStyle: "italic" },
  notePnl: { fontFamily: font.displayBold, fontSize: fs.base },
  noteTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.base, lineHeight: 20 },
  noteReason: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, lineHeight: 17 },
  lock: { flex: 1, alignItems: "center", paddingHorizontal: spacing.xl, paddingTop: 80, gap: spacing.md },
  lockIcon: { width: 76, height: 76, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  lockTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  lockSub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.lg, textAlign: "center" },
});
