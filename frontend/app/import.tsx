import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";

export default function ImportTrades() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const A = useAccent().theme;
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const uri = res.assets[0].uri;
      const text = await (await fetch(uri)).text();
      setCsv(text);
      toast("File loaded — review & import", "success");
    } catch (e: any) {
      toast("Could not read file. Try pasting instead.", "error");
    }
  };

  const doImport = async () => {
    if (!csv.trim()) { toast("Paste or choose a CSV first", "error"); return; }
    setBusy(true); setResult(null);
    try {
      const r = await api.post("/trades/import-csv", { csv });
      setResult(r);
      if (r.imported > 0) toast(`Imported ${r.imported} trade${r.imported > 1 ? "s" : ""}`, "success");
      else toast("No trades imported — check columns", "error");
    } catch (e: any) {
      toast(e.message || "Import failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="import-back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Import Trades (CSV)</Text>
        <View style={{ width: 34 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }} keyboardShouldPersistTaps="handled">
          <View style={styles.info}>
            <Text style={styles.infoTitle}>Supported columns</Text>
            <Text style={styles.infoTxt}>Required: <Text style={styles.b}>Symbol</Text> and <Text style={styles.b}>PnL</Text>. Optional: Date, Side, Entry, Exit, Quantity, Setup. Column names are matched flexibly (e.g. Ticker, P&L, Profit, Qty).</Text>
          </View>

          <Pressable testID="import-pick" style={[styles.fileBtn, { borderColor: A.accent }]} onPress={pickFile}>
            <Ionicons name="document-attach" size={20} color={A.accent} />
            <Text style={[styles.fileTxt, { color: A.accent }]}>Choose a .csv file</Text>
          </Pressable>

          <Text style={styles.orTxt}>or paste your CSV below</Text>
          <TextInput
            testID="import-textarea"
            style={styles.textarea}
            multiline
            placeholder={"Symbol,PnL,Date,Side\nAAPL,150.50,2026-07-01,long\nTSLA,-80,2026-07-02,short"}
            placeholderTextColor={colors.onSurface3}
            value={csv}
            onChangeText={setCsv}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Pressable testID="import-run" style={[styles.importBtn, { backgroundColor: A.accent, shadowColor: A.accent }, busy && { opacity: 0.6 }]} onPress={doImport} disabled={busy}>
            {busy ? <ActivityIndicator color={A.onAccent} /> : <><Ionicons name="cloud-upload" size={20} color={A.onAccent} /><Text style={[styles.importTxt, { color: A.onAccent }]}>Import Trades</Text></>}
          </Pressable>

          {result ? (
            <View style={styles.result}>
              <Text style={styles.resultLine}>✅ Imported: <Text style={styles.b}>{result.imported}</Text></Text>
              {result.skipped > 0 ? <Text style={styles.resultLine}>⚠️ Skipped (missing symbol/pnl): {result.skipped}</Text> : null}
              {result.capped ? <Text style={styles.resultLine}>🔒 Free plan limit reached — upgrade to import more.</Text> : null}
              {result.imported > 0 ? (
                <Pressable testID="import-done" style={styles.doneBtn} onPress={() => router.replace("/(tabs)/journal")}>
                  <Text style={[styles.doneTxt, { color: A.accent }]}>View in Journal</Text>
                  <Ionicons name="arrow-forward" size={16} color={A.accent} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface2 },
  headerTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  info: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  infoTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.base },
  infoTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, lineHeight: 20 },
  b: { fontFamily: font.displayBold, color: colors.onSurface },
  fileBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1.5, borderStyle: "dashed", borderRadius: radius.md, paddingVertical: spacing.lg },
  fileTxt: { fontFamily: font.displayBold, fontSize: fs.base },
  orTxt: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, textAlign: "center" },
  textarea: { minHeight: 160, backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.onSurface, fontFamily: font.text, fontSize: fs.base, textAlignVertical: "top" },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.lg },
  importTxt: { fontFamily: font.displayBold, fontSize: fs.lg },
  result: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  resultLine: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.base },
  doneBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm },
  doneTxt: { fontFamily: font.displayBold, fontSize: fs.base },
});
