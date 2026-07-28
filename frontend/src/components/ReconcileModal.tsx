import React, { useMemo, useState } from "react";
import { Modal, View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { useAccent } from "@/src/context/AccentContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";

type Acct = { id: string; name: string; balance: number };
type Row = { value: string; classification: "win" | "loss" | "other" | null };
const CLASSES: { key: "win" | "loss" | "other"; label: string; color: string }[] = [
  { key: "win", label: "Win", color: colors.success },
  { key: "loss", label: "Loss", color: colors.error },
  { key: "other", label: "Other", color: colors.onSurface3 },
];

export default function ReconcileModal({ visible, accounts, onClose, onDone }: { visible: boolean; accounts: Acct[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const A = useAccent().theme;
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);

  // Initialise rows whenever the modal opens with fresh accounts
  const initKey = useMemo(() => accounts.map((a) => `${a.id}:${a.balance}`).join("|"), [accounts]);
  React.useEffect(() => {
    if (visible) {
      const next: Record<string, Row> = {};
      accounts.forEach((a) => { next[a.id] = { value: String(a.balance), classification: null }; });
      setRows(next);
    }
  }, [visible, initKey]);

  const setRow = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const submit = async () => {
    const items: any[] = [];
    for (const a of accounts) {
      const row = rows[a.id];
      if (!row) continue;
      const nb = parseFloat(row.value);
      if (isNaN(nb)) { toast(`Enter a valid balance for ${a.name}`, "error"); return; }
      const delta = Math.round((nb - a.balance) * 100) / 100;
      if (Math.abs(delta) >= 0.005 && !row.classification) {
        toast(`Classify the change for ${a.name} (Win/Loss/Other)`, "error");
        return;
      }
      items.push({ id: a.id, new_balance: nb, classification: row.classification || "other" });
    }
    setBusy(true);
    try {
      const r = await api.post("/brokers/reconcile", { items });
      const n = r.adjustments?.length || 0;
      toast(n ? `Balances confirmed · ${n} change${n > 1 ? "s" : ""} logged` : "Balances confirmed", "success");
      onDone();
    } catch (e: any) {
      toast(e.message || "Could not save balances", "error");
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Confirm your balances</Text>
              <Text style={styles.sub}>Update any account that changed overnight, then tell us why.</Text>
            </View>
            <Pressable testID="reconcile-close" onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={colors.onSurface3} /></Pressable>
          </View>

          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled">
            {accounts.map((a) => {
              const row = rows[a.id] || { value: String(a.balance), classification: null };
              const nb = parseFloat(row.value);
              const delta = isNaN(nb) ? 0 : Math.round((nb - a.balance) * 100) / 100;
              const changed = Math.abs(delta) >= 0.005;
              return (
                <View key={a.id} style={styles.row}>
                  <View style={styles.rowTop}>
                    <Text style={styles.broker}>{a.name}</Text>
                    {changed && (
                      <Text style={[styles.delta, { color: delta >= 0 ? colors.success : colors.error }]}>
                        {delta >= 0 ? "+" : "-"}${Math.abs(delta).toLocaleString()}
                      </Text>
                    )}
                  </View>
                  <View style={styles.inputWrap}>
                    <Text style={styles.dollar}>$</Text>
                    <TextInput
                      testID={`reconcile-input-${a.id}`}
                      style={styles.input}
                      value={row.value}
                      onChangeText={(t) => setRow(a.id, { value: t.replace(/[^0-9.\-]/g, "") })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={colors.onSurface3}
                    />
                  </View>
                  {changed && (
                    <View style={styles.chips}>
                      {CLASSES.map((c) => {
                        const on = row.classification === c.key;
                        return (
                          <Pressable key={c.key} testID={`reconcile-${c.key}-${a.id}`} onPress={() => setRow(a.id, { classification: c.key })}
                            style={[styles.chip, on && { backgroundColor: c.color + "22", borderColor: c.color }]}>
                            <Text style={[styles.chipTxt, on && { color: c.color }]}>{c.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <Pressable testID="reconcile-submit" style={[styles.save, { backgroundColor: A.accent }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={A.onAccent} /> : <Text style={[styles.saveTxt, { color: A.onAccent }]}>Confirm balances</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  sub: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginTop: 2 },
  row: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  broker: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  delta: { fontFamily: font.displayBold, fontSize: fs.base },
  inputWrap: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  dollar: { color: colors.onSurface3, fontFamily: font.displayBold, fontSize: fs.lg },
  input: { flex: 1, color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg, paddingVertical: spacing.md, paddingLeft: spacing.xs },
  chips: { flexDirection: "row", gap: spacing.sm },
  chip: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipTxt: { color: colors.onSurface2, fontFamily: font.display, fontSize: fs.base },
  save: { alignItems: "center", justifyContent: "center", borderRadius: radius.md, paddingVertical: spacing.lg },
  saveTxt: { fontFamily: font.displayBold, fontSize: fs.lg },
});
