import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { STRATEGY_PRESETS } from "@/src/strategyPresets";
import { colors, spacing, radius, font, fs, glow } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";
import { PressableScale } from "@/src/components/anim";

export default function Strategy() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const A = useAccent().theme;
  const [strategies, setStrategies] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [risk, setRisk] = useState("1");
  const [rules, setRules] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setStrategies(await api.get("/strategies")); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => { setEditId(null); setName(""); setRisk("1"); setRules([""]); setEditing(true); };
  const openEdit = (s: any) => { setEditId(s.id); setName(s.name); setRisk(String(s.risk_pct)); setRules(s.rules.length ? s.rules : [""]); setEditing(true); };
  const openPreset = (p: typeof STRATEGY_PRESETS[number]) => {
    setEditId(null); setName(p.name); setRisk(String(p.risk_pct)); setRules([...p.rules]); setEditing(true);
  };

  const save = async () => {
    if (!name.trim()) return toast("Enter a strategy name", "error");
    const cleanRules = rules.map((r) => r.trim()).filter(Boolean);
    setBusy(true);
    try {
      const body = { name: name.trim(), risk_pct: parseFloat(risk) || 1, rules: cleanRules };
      if (editId) await api.put(`/strategies/${editId}`, body);
      else await api.post("/strategies", body);
      toast("Strategy saved", "success");
      setEditing(false);
      load();
    } catch (e: any) { toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => { await api.del(`/strategies/${id}`); load(); toast("Deleted", "info"); };

  if (editing) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScreenBackground />
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <View style={styles.editHead}>
            <Pressable testID="cancel-strategy" onPress={() => setEditing(false)}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
            <Text style={styles.title}>{editId ? "Edit" : "New"} Strategy</Text>
            <View style={{ width: 26 }} />
          </View>
          <Text style={styles.label}>Strategy Name</Text>
          <TextInput testID="strategy-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Opening Range Breakout" placeholderTextColor={colors.onSurface3} />
          <Text style={styles.label}>Risk per trade (%)</Text>
          <TextInput testID="strategy-risk" style={styles.input} value={risk} onChangeText={setRisk} keyboardType="numeric" placeholder="1" placeholderTextColor={colors.onSurface3} />
          <Text style={styles.label}>Rules (AI checks these after each trade)</Text>
          {rules.map((r, i) => (
            <View key={i} style={styles.ruleRow}>
              <TextInput testID={`rule-${i}`} style={[styles.input, { flex: 1 }]} value={r} placeholder="e.g. Only trade 9:30–11:00" placeholderTextColor={colors.onSurface3}
                onChangeText={(t) => setRules(rules.map((x, j) => (j === i ? t : x)))} />
              {rules.length > 1 && (
                <Pressable onPress={() => setRules(rules.filter((_, j) => j !== i))} style={styles.ruleDel}>
                  <Ionicons name="remove-circle" size={24} color={colors.error} />
                </Pressable>
              )}
            </View>
          ))}
          <Pressable testID="add-rule" style={styles.addRule} onPress={() => setRules([...rules, ""])}>
            <Ionicons name="add" size={18} color={colors.brand} /><Text style={styles.addRuleTxt}>Add rule</Text>
          </Pressable>
        </ScrollView>
        <Pressable testID="save-strategy" style={[styles.saveBtn, { backgroundColor: A.accent, shadowColor: A.accent, paddingBottom: (insets.bottom || spacing.md) + spacing.md }]} onPress={save} disabled={busy}>
          {busy ? <ActivityIndicator color={A.onAccent} /> : <Text style={[styles.saveTxt, { color: A.onAccent }]}>Save Strategy</Text>}
        </Pressable>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Strategies</Text>
        <Text style={styles.subtitle}>Define rules for the AI to enforce</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 200 }}>
        <Text style={styles.presetLabel}>Quick templates — tap to customize</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
          {STRATEGY_PRESETS.map((p) => (
            <Pressable key={p.name} testID={`preset-${p.name}`} style={styles.presetChip} onPress={() => openPreset(p)}>
              <Ionicons name="add-circle-outline" size={14} color={colors.brand} />
              <Text style={styles.presetTxt}>{p.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {strategies.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="construct-outline" size={44} color={colors.onSurface3} />
            <Text style={styles.emptyTxt}>No strategies yet. Tap a template above or create your own.</Text>
          </View>
        ) : strategies.map((s, i) => (
          <Animated.View key={s.id} entering={FadeInDown.duration(600).delay(Math.min(i, 8) * 70)}>
          <PressableScale testID={`strategy-${s.id}`} style={styles.card} onPress={() => openEdit(s)}>
            <View style={styles.cardTop}>
              <Text style={styles.cardName}>{s.name}</Text>
              <Pressable testID={`del-strategy-${s.id}`} onPress={() => remove(s.id)} hitSlop={10}><Ionicons name="trash-outline" size={20} color={colors.onSurface3} /></Pressable>
            </View>
            <Text style={[styles.cardRisk, { color: A.accent }]}>Risk {s.risk_pct}% · {s.rules.length} rules</Text>
            {s.rules.slice(0, 3).map((r: string, j: number) => (
              <View key={j} style={styles.ruleLine}><Ionicons name="checkmark-circle" size={14} color={colors.success} /><Text style={styles.ruleTxt}>{r}</Text></View>
            ))}
          </PressableScale>
          </Animated.View>
        ))}
      </ScrollView>
      <PressableScale testID="new-strategy" style={[styles.fabWrap, { shadowColor: A.accent }]} onPress={openNew}>
        <LinearGradient colors={A.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fab}>
          <Ionicons name="add" size={26} color={A.onAccent} /><Text style={[styles.fabTxt, { color: A.onAccent }]}>New Strategy</Text>
        </LinearGradient>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  presetLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: spacing.sm },
  presetRow: { gap: spacing.sm, paddingBottom: spacing.lg },
  presetChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface2, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexShrink: 0 },
  presetTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.base },

  flex: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["3xl"] },
  subtitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  editHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  label: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.xs },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  ruleDel: { padding: spacing.xs },
  addRule: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
  addRuleTxt: { color: colors.brand, fontFamily: font.text, fontSize: fs.base },
  saveBtn: { backgroundColor: colors.accent, alignItems: "center", paddingTop: spacing.lg, ...glow(colors.accent, 0.4) },
  saveTxt: { color: colors.onAccent, fontFamily: font.displayBold, fontSize: fs.lg },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.md },
  emptyTxt: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base, textAlign: "center" },
  card: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.xs, ...glow(colors.brand, 0.18) },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardName: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  cardRisk: { color: colors.accent, fontFamily: font.text, fontSize: fs.sm, marginBottom: spacing.xs },
  ruleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ruleTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, flex: 1 },
  fabWrap: { position: "absolute", bottom: 94, right: spacing.lg, borderRadius: radius.pill, ...glow(colors.accent, 0.6) },
  fab: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  fabTxt: { color: colors.onAccent, fontFamily: font.displayBold, fontSize: fs.lg },
});
