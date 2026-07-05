import React, { useState } from "react";
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

export default function Analyze() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const [image, setImage] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const locked = user?.subscription_tier === "free";

  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast("Permission denied", "error");
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] });
    if (!res.canceled && res.assets[0].base64) { setImage(res.assets[0].base64); setResult(null); }
  };

  const run = async () => {
    if (!image) return toast("Add a chart first", "error");
    setBusy(true);
    try { setResult(await api.post("/trades/analyze-chart", { image_base64: image })); }
    catch (e: any) { toast(e.message, "error"); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="close-analyze" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Chart Analysis</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>
        {locked ? (
          <View style={styles.lock}>
            <Ionicons name="lock-closed" size={40} color={colors.brand} />
            <Text style={styles.lockTxt}>Chart analysis is a Pro feature.</Text>
            <Pressable testID="upgrade-analyze" style={styles.upBtn} onPress={() => router.replace("/(tabs)/profile")}><Text style={styles.upTxt}>Upgrade to Pro</Text></Pressable>
          </View>
        ) : (
          <>
            {image ? (
              <Image source={{ uri: `data:image/jpeg;base64,${image}` }} style={styles.img} contentFit="contain" />
            ) : (
              <View style={styles.pickers}>
                <Pressable testID="chart-camera" style={styles.pickBox} onPress={() => pick(true)}><Ionicons name="camera" size={32} color={colors.brand} /><Text style={styles.pickTxt}>Camera</Text></Pressable>
                <Pressable testID="chart-gallery" style={styles.pickBox} onPress={() => pick(false)}><Ionicons name="images" size={32} color={colors.brand} /><Text style={styles.pickTxt}>Gallery</Text></Pressable>
              </View>
            )}
            {image && (
              <Pressable testID="run-analyze" style={styles.runBtn} onPress={run} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <><Ionicons name="sparkles" size={20} color={colors.onBrand} /><Text style={styles.runTxt}>Analyze Chart</Text></>}
              </Pressable>
            )}
            {result && (
              <View style={styles.result}>
                <View style={styles.resHead}>
                  <Text style={styles.trend}>{(result.trend || "").toUpperCase()}</Text>
                  <GradeBadge grade={result.setup_grade || "C"} size={40} />
                </View>
                <Block title="Patterns" items={result.patterns} />
                <Block title="Support" items={result.support} />
                <Block title="Resistance" items={result.resistance} />
                <Text style={styles.analysisLabel}>Analysis</Text>
                <Text style={styles.analysis}>{result.analysis}</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Block({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.blockTitle}>{title}</Text>
      <View style={styles.tagWrap}>
        {items.map((it, i) => <View key={i} style={styles.tag}><Text style={styles.tagTxt}>{it}</Text></View>)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  pickers: { flexDirection: "row", gap: spacing.md },
  pickBox: { flex: 1, aspectRatio: 1.2, backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  pickTxt: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  img: { width: "100%", height: 260, borderRadius: radius.lg, backgroundColor: colors.surface2 },
  runBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.lg, marginTop: spacing.lg },
  runTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg },
  result: { marginTop: spacing.lg, backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  resHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  trend: { color: colors.brand, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  blockTitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: spacing.sm },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tag: { backgroundColor: colors.surface3, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  tagTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.base },
  analysisLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm },
  analysis: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg, lineHeight: 24 },
  lock: { alignItems: "center", gap: spacing.md, paddingTop: 60 },
  lockTxt: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.xl },
  upBtn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.xxl, paddingVertical: spacing.lg, marginTop: spacing.md },
  upTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg },
});
