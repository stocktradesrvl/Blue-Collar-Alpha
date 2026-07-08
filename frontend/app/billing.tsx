import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { colors, spacing, radius, font, fs } from "@/src/theme";

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return "—"; }
}

export default function Billing() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setData(await api.get("/payments/billing")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sub = data?.subscription;

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="back-billing" onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Billing</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brand} />}>
          <View style={styles.planCard}>
            <Text style={styles.planLabel}>Current Plan</Text>
            <Text style={styles.planTier}>{(data?.tier || "free").toUpperCase()}</Text>
            {sub ? (
              <>
                <Row label="Status" value={sub.cancel_at_period_end ? "Cancels at period end" : sub.status} valueColor={sub.status === "active" || sub.status === "trialing" ? colors.success : colors.warning} />
                <Row label="Price" value={`$${sub.amount}/${sub.interval}`} />
                {sub.trial_end ? <Row label="Trial ends" value={fmtDate(sub.trial_end)} valueColor={colors.brand} /> : null}
                <Row label={sub.cancel_at_period_end ? "Access until" : "Renews on"} value={fmtDate(sub.current_period_end)} />
              </>
            ) : (data?.tier && data.tier !== "free") ? (
              <Text style={styles.freeNote}>{`You have complimentary ${String(data.tier).toUpperCase()} access — no paid billing on this account.`}</Text>
            ) : (
              <Text style={styles.freeNote}>{"You're on the Free plan — no active billing. Upgrade from Profile to unlock Pro/Premium."}</Text>
            )}
          </View>

          <Text style={styles.section}>Payment History</Text>
          {(data?.invoices || []).length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="receipt-outline" size={36} color={colors.onSurface3} />
              <Text style={styles.emptyTxt}>No invoices yet</Text>
            </View>
          ) : (
            data.invoices.map((inv: any, i: number) => (
              <Pressable key={i} testID={`invoice-${i}`} style={styles.invoice} onPress={() => inv.url && Linking.openURL(inv.url)}>
                <View style={styles.invLeft}>
                  <Text style={styles.invAmount}>${inv.amount.toFixed(2)} {inv.currency}</Text>
                  <Text style={styles.invDate}>{fmtDate(inv.created)}{inv.number ? ` · ${inv.number}` : ""}</Text>
                </View>
                <View style={styles.invRight}>
                  <View style={[styles.statusPill, { backgroundColor: inv.status === "paid" ? colors.success + "22" : colors.warning + "22" }]}>
                    <Text style={[styles.statusTxt, { color: inv.status === "paid" ? colors.success : colors.warning }]}>{inv.status}</Text>
                  </View>
                  {inv.url ? <Ionicons name="open-outline" size={18} color={colors.onSurface3} /> : null}
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowVal, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  planCard: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.brand, marginBottom: spacing.xl },
  planLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1 },
  planTier: { color: colors.brand, fontFamily: font.displayBold, fontSize: fs["3xl"], marginBottom: spacing.md },
  freeNote: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, lineHeight: 20 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  rowLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  rowVal: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  section: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.md },
  emptyBox: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTxt: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base },
  invoice: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  invLeft: { gap: 2 },
  invAmount: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  invDate: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  invRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusPill: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusTxt: { fontFamily: font.text, fontSize: fs.sm, textTransform: "capitalize" },
});
