import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";
import { GradeBadge } from "@/src/components/ui";

export default function PreTrade() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const [image, setImage] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [strategyIds, setStrategyIds] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const locked = user?.subscription_tier === "free";

  useEffect(() => { api.get("/strategies").then(setStrategies).catch(() => {}); }, []);
  const toggle = (id: string) => setStrategyIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast("Permission denied", "error");
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] });
    if (!res.canceled && res.assets[0].base64) { setImage(res.assets[0].base64); setResult(null); }
  };

  const grade = async () => {
    if (!image) return toast("Add a chart first", "error");
    setBusy(true);
    try { setResult(await api.post("/analyze/pretrade", { image_base64: image, strategy_ids: strategyIds })); }
    catch (e: any) { toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="close-pretrade" onPress={() => router.replace("/")}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Pre-Trade Grader</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>
        {locked ? (
          <View style={styles.lock}>
            <Ionicons name="lock-closed" size={40} color={colors.brand} />
            <Text style={styles.lockTxt}>The Pre-Trade Grader is a Pro feature.</Text>
            <Pressable testID="upgrade-pretrade" style={styles.upBtn} onPress={() => router.replace("/(tabs)/profile")}><Text style={styles.upTxt}>Upgrade to Pro</Text></Pressable>
          </View>
        ) : (
          <>
            <View style={styles.disclaimerTop}>
              <Ionicons name="information-circle" size={16} color={colors.warning} />
              <Text style={styles.disclaimerTopTxt}>Educational only — not financial advice. Grades how a possible setup fits YOUR rules.</Text>
            </View>

            {image ? (
              <Image source={{ uri: `data:image/jpeg;base64,${image}` }} style={styles.img} contentFit="contain" />
            ) : (
              <View style={styles.pickers}>
                <Pressable testID="pt-camera" style={styles.pickBox} onPress={() => pick(true)}><Ionicons name="camera" size={32} color={colors.brand} /><Text style={styles.pickTxt}>Camera</Text></Pressable>
                <Pressable testID="pt-gallery" style={styles.pickBox} onPress={() => pick(false)}><Ionicons name="images" size={32} color={colors.brand} /><Text style={styles.pickTxt}>Gallery</Text></Pressable>
              </View>
            )}

            <Text style={styles.label}>Strategies to check against</Text>
            <Text style={styles.subLabel}>Pick some, or leave empty and the AI picks the best fit from all yours.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {strategies.length === 0 && <Text style={styles.noStrat}>No strategies yet — add some first.</Text>}
              {strategies.map((s) => {
                const sel = strategyIds.includes(s.id);
                return (
                  <Pressable key={s.id} testID={`pt-strat-${s.id}`} onPress={() => toggle(s.id)} style={[styles.chip, sel && styles.chipActive]}>
                    {sel && <Ionicons name="checkmark" size={14} color={colors.onBrand} />}
                    <Text style={[styles.chipTxt, sel && styles.chipTxtActive]}>{s.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {image && (
              <Pressable testID="run-pretrade" style={styles.runBtn} onPress={grade} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <><Ionicons name="ribbon" size={20} color={colors.onBrand} /><Text style={styles.runTxt}>Grade This Setup</Text></>}
              </Pressable>
            )}

            {result && (
              <View style={styles.result}>
                <View style={styles.resHead}>
                  <View>
                    <Text style={styles.resLabel}>Setup fit grade</Text>
                    <Text style={styles.bestFit}>Best fit: {result.best_matching_strategy || "None"}</Text>
                  </View>
                  <GradeBadge grade={result.grade || "C"} size={48} />
                </View>
                <Text style={styles.trend}>Trend: {(result.trend || "unknown").toUpperCase()}</Text>
                <Block title="Rules met" items={result.rules_met} color={colors.success} icon="checkmark-circle" />
                <Block title="Rules violated" items={result.rules_violated} color={colors.error} icon="close-circle" />
                <Block title="Patterns" items={result.patterns} color={colors.brand} icon="pulse" />
                <Text style={styles.reasoningLabel}>Analysis</Text>
                <Text style={styles.reasoning}>{result.reasoning}</Text>
                {(result.considerations || []).length > 0 && (
                  <>
                    <Text style={styles.reasoningLabel}>Considerations</Text>
                    {result.considerations.map((c: string, i: number) => (
                      <View key={i} style={styles.consRow}><Ionicons name="ellipse" size={6} color={colors.onSurface3} /><Text style={styles.consTxt}>{c}</Text></View>
                    ))}
                  </>
                )}
                <View style={styles.disclaimerBox}>
                  <Text style={styles.disclaimerTxt}>{result.disclaimer}</Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Block({ title, items, color, icon }: { title: string; items?: string[]; color: string; icon: any }) {
  if (!items || items.length === 0) return null;
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.blockTitle}>{title}</Text>
      {items.map((it, i) => (
        <View key={i} style={styles.blockRow}><Ionicons name={icon} size={14} color={color} /><Text style={styles.blockTxt}>{it}</Text></View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  disclaimerTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warning + "18", borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  disclaimerTopTxt: { flex: 1, color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  pickers: { flexDirection: "row", gap: spacing.md },
  pickBox: { flex: 1, aspectRatio: 1.2, backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  pickTxt: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  img: { width: "100%", height: 240, borderRadius: radius.lg, backgroundColor: colors.surface2 },
  label: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.xl },
  subLabel: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginBottom: spacing.md, marginTop: 2 },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: { height: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  chipTxtActive: { color: colors.onBrand },
  noStrat: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base },
  runBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.lg, marginTop: spacing.xl },
  runTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg },
  result: { marginTop: spacing.lg, backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  resHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  resLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8 },
  bestFit: { color: colors.brand, fontFamily: font.display, fontSize: fs.lg },
  trend: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, marginTop: spacing.sm },
  blockTitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: spacing.xs },
  blockRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
  blockTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.base, flex: 1 },
  reasoningLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.xs },
  reasoning: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg, lineHeight: 24 },
  consRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 2 },
  consTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, flex: 1 },
  disclaimerBox: { backgroundColor: colors.surface3, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  disclaimerTxt: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, lineHeight: 18 },
  lock: { alignItems: "center", gap: spacing.md, paddingTop: 60 },
  lockTxt: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.xl, textAlign: "center" },
  upBtn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.xxl, paddingVertical: spacing.lg, marginTop: spacing.md },
  upTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg },
});
