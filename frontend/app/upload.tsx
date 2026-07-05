import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";

export default function Upload() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [image, setImage] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get("/strategies").then(setStrategies).catch(() => {}); }, []);

  const pick = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast("Permission denied", "error");
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ["images"] });
    if (!res.canceled && res.assets[0].base64) setImage(res.assets[0].base64);
  };

  const analyze = async () => {
    if (!image) return toast("Add a screenshot first", "error");
    setBusy(true);
    try {
      const trade = await api.post("/trades/analyze-screenshot", { image_base64: image, strategy_id: strategyId });
      router.replace(`/trade/${trade.id}`);
    } catch (e: any) {
      toast(e.message || "Analysis failed", "error");
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="close-upload" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Add Trade</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>
        {image ? (
          <View style={styles.preview}>
            <Image source={{ uri: `data:image/jpeg;base64,${image}` }} style={styles.previewImg} contentFit="contain" />
            <Pressable testID="clear-image" style={styles.clearBtn} onPress={() => setImage(null)}>
              <Ionicons name="trash" size={18} color={colors.onSurface} /><Text style={styles.clearTxt}>Replace</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.pickers}>
            <Pressable testID="pick-camera" style={styles.pickBox} onPress={() => pick(true)}>
              <Ionicons name="camera" size={32} color={colors.brand} /><Text style={styles.pickTxt}>Camera</Text>
            </Pressable>
            <Pressable testID="pick-gallery" style={styles.pickBox} onPress={() => pick(false)}>
              <Ionicons name="images" size={32} color={colors.brand} /><Text style={styles.pickTxt}>Gallery</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.label}>Match against strategy (optional)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Pressable testID="strat-none" onPress={() => setStrategyId(null)} style={[styles.chip, !strategyId && styles.chipActive]}>
            <Text style={[styles.chipTxt, !strategyId && styles.chipTxtActive]}>None</Text>
          </Pressable>
          {strategies.map((s) => (
            <Pressable key={s.id} testID={`strat-${s.id}`} onPress={() => setStrategyId(s.id)} style={[styles.chip, strategyId === s.id && styles.chipActive]}>
              <Text style={[styles.chipTxt, strategyId === s.id && styles.chipTxtActive]}>{s.name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Pressable testID="analyze-btn" style={[styles.analyzeBtn, !image && styles.disabled]} onPress={analyze} disabled={busy || !image}>
          {busy ? <ActivityIndicator color={colors.onBrand} /> : <><Ionicons name="sparkles" size={20} color={colors.onBrand} /><Text style={styles.analyzeTxt}>Analyze with AI</Text></>}
        </Pressable>
        <Text style={styles.hint}>The AI reads your trade, grades the setup A–F, and checks your strategy rules.</Text>
      </ScrollView>
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
  preview: { gap: spacing.sm },
  previewImg: { width: "100%", height: 300, borderRadius: radius.lg, backgroundColor: colors.surface2 },
  clearBtn: { flexDirection: "row", alignSelf: "center", alignItems: "center", gap: spacing.xs, padding: spacing.sm },
  clearTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.base },
  label: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.xl, marginBottom: spacing.md },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  chipTxtActive: { color: colors.onBrand },
  analyzeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.lg, marginTop: spacing.xl },
  disabled: { opacity: 0.4 },
  analyzeTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg },
  hint: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, textAlign: "center", marginTop: spacing.md },
});
