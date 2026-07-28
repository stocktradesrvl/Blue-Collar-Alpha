import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, RefreshControl, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";
import ReconcileModal from "@/src/components/ReconcileModal";
import { colors, spacing, radius, font, fs } from "@/src/theme";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PRESETS = ["Robinhood", "Webull", "Tastytrade", "Other"];

export default function Balances() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const toast = useToast();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [ledger, setLedger] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBal, setNewBal] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, l] = await Promise.all([api.get("/brokers"), api.get("/cash-adjustments")]);
      setAccounts(b.accounts || []);
      setTotal(b.total || 0);
      setLedger(l);
    } catch (e: any) { toast(e.message || "Could not load balances", "error"); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addBroker = async () => {
    const name = newName.trim();
    if (!name) { toast("Pick or type a broker name", "error"); return; }
    setAdding(true);
    try {
      await api.post("/brokers", { name, balance: parseFloat(newBal) || 0 });
      setNewName(""); setNewBal("");
      await load();
      toast("Broker added", "success");
    } catch (e: any) { toast(e.message || "Could not add broker", "error"); }
    finally { setAdding(false); }
  };

  const removeBroker = async (id: string) => {
    try { await api.del(`/brokers/${id}`); await load(); toast("Broker removed", "info"); }
    catch (e: any) { toast(e.message || "Could not remove", "error"); }
  };

  return (
    <View style={styles.flex}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="balances-back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Broker Balances</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={A.accent} size="large" /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={A.accent} />}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.totalCard, { borderColor: A.accent }]}>
              <Text style={styles.totalLabel}>Total Across All Brokers</Text>
              <Text style={[styles.totalVal, { color: A.accent }]}>{money(total)}</Text>
              {accounts.length > 0 && (
                <Pressable testID="open-reconcile" style={[styles.confirmBtn, { backgroundColor: A.accent }]} onPress={() => setReconcileOpen(true)}>
                  <Ionicons name="checkmark-done" size={16} color={A.onAccent} />
                  <Text style={[styles.confirmTxt, { color: A.onAccent }]}>Confirm balances</Text>
                </Pressable>
              )}
            </View>

            {accounts.map((a) => (
              <View key={a.id} style={styles.acctRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.acctName}>{a.name}</Text>
                  <Text style={styles.acctBal}>{money(a.balance)}</Text>
                </View>
                <Pressable testID={`del-broker-${a.id}`} onPress={() => removeBroker(a.id)} hitSlop={8} style={styles.del}>
                  <Ionicons name="trash-outline" size={18} color={colors.onSurface3} />
                </Pressable>
              </View>
            ))}

            <View style={styles.addCard}>
              <Text style={styles.addTitle}>Add a broker</Text>
              <View style={styles.presetRow}>
                {PRESETS.map((p) => (
                  <Pressable key={p} testID={`preset-${p}`} onPress={() => setNewName(p === "Other" ? "" : p)}
                    style={[styles.preset, newName === p && { backgroundColor: A.accentTint, borderColor: A.accent }]}>
                    <Text style={[styles.presetTxt, newName === p && { color: A.accent }]}>{p}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput testID="broker-name" style={styles.field} value={newName} onChangeText={setNewName} placeholder="Broker name" placeholderTextColor={colors.onSurface3} />
              <View style={styles.inputWrap}>
                <Text style={styles.dollar}>$</Text>
                <TextInput testID="broker-balance" style={styles.fieldInline} value={newBal} onChangeText={(t) => setNewBal(t.replace(/[^0-9.\-]/g, ""))} keyboardType="decimal-pad" placeholder="Starting balance" placeholderTextColor={colors.onSurface3} />
              </View>
              <Pressable testID="add-broker" style={[styles.addBtn, { backgroundColor: A.accent }]} onPress={addBroker} disabled={adding}>
                {adding ? <ActivityIndicator color={A.onAccent} /> : <Text style={[styles.addBtnTxt, { color: A.onAccent }]}>Add broker</Text>}
              </Pressable>
            </View>

            <View style={styles.ledgerCard}>
              <Text style={styles.ledgerTitle}>Cash Adjustments Ledger</Text>
              <Text style={styles.ledgerNote}>Kept separate from your trade stats.</Text>
              <View style={styles.ledgerSummary}>
                <View style={styles.ledgerStat}><Text style={[styles.ledgerStatVal, { color: colors.success }]}>{money(ledger?.summary?.win || 0)}</Text><Text style={styles.ledgerStatLabel}>Wins</Text></View>
                <View style={styles.ledgerStat}><Text style={[styles.ledgerStatVal, { color: colors.error }]}>{money(ledger?.summary?.loss || 0)}</Text><Text style={styles.ledgerStatLabel}>Losses</Text></View>
                <View style={styles.ledgerStat}><Text style={[styles.ledgerStatVal, { color: colors.onSurface3 }]}>{money(ledger?.summary?.other || 0)}</Text><Text style={styles.ledgerStatLabel}>Other</Text></View>
              </View>
              {(ledger?.adjustments || []).length === 0 ? (
                <Text style={styles.ledgerEmpty}>No adjustments yet. Confirm your balances to start logging.</Text>
              ) : (
                (ledger.adjustments).slice(0, 20).map((adj: any) => (
                  <View key={adj.id} style={styles.adjRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.adjBroker}>{adj.broker_name}</Text>
                      <Text style={styles.adjDate}>{new Date(adj.created_at).toLocaleDateString()} · {adj.type}</Text>
                    </View>
                    <Text style={[styles.adjAmt, { color: adj.amount >= 0 ? colors.success : colors.error }]}>{adj.amount >= 0 ? "+" : "-"}{money(Math.abs(adj.amount)).replace("$", "$")}</Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <ReconcileModal visible={reconcileOpen} accounts={accounts} onClose={() => setReconcileOpen(false)} onDone={() => { setReconcileOpen(false); load(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface2 },
  headerTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  totalCard: { backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, alignItems: "center", gap: spacing.xs },
  totalLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1 },
  totalVal: { fontFamily: font.displayBold, fontSize: 38 },
  confirmBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  confirmTxt: { fontFamily: font.displayBold, fontSize: fs.base },
  acctRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  acctName: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  acctBal: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, marginTop: 2 },
  del: { padding: spacing.sm },
  addCard: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  addTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  preset: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  presetTxt: { color: colors.onSurface2, fontFamily: font.display, fontSize: fs.sm },
  field: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.text, fontSize: fs.base },
  inputWrap: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  dollar: { color: colors.onSurface3, fontFamily: font.displayBold, fontSize: fs.lg },
  fieldInline: { flex: 1, color: colors.onSurface, fontFamily: font.text, fontSize: fs.base, paddingVertical: spacing.md, paddingLeft: spacing.xs },
  addBtn: { alignItems: "center", justifyContent: "center", borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.xs },
  addBtnTxt: { fontFamily: font.displayBold, fontSize: fs.base },
  ledgerCard: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  ledgerTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  ledgerNote: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  ledgerSummary: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.sm },
  ledgerStat: { flex: 1, alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.md },
  ledgerStatVal: { fontFamily: font.displayBold, fontSize: fs.base },
  ledgerStatLabel: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginTop: 2 },
  ledgerEmpty: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, textAlign: "center", paddingVertical: spacing.md },
  adjRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  adjBroker: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.base },
  adjDate: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginTop: 2, textTransform: "capitalize" },
  adjAmt: { fontFamily: font.displayBold, fontSize: fs.base },
});
