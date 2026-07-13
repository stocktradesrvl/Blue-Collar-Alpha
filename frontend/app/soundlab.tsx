import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, fs, glow } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";
import { previewSound } from "@/src/utils/sound";

type Variant = { key: string; label: string; desc: string };
type Group = { title: string; icon: string; when: string; variants: Variant[] };

const GROUPS: Group[] = [
  {
    title: "Big Win / Cash",
    icon: "cash",
    when: "Plays on a big winning trade",
    variants: [
      { key: "cash_a", label: "A · Register Ding", desc: "Classic cash-register ka-ching" },
      { key: "cash_b", label: "B · Arcade Win", desc: "Rising victory arpeggio" },
      { key: "cash_c", label: "C · Sparkle Chimes", desc: "Shimmering bell cascade" },
    ],
  },
  {
    title: "Coin — Profitable Trade",
    icon: "logo-usd",
    when: "Plays when you save a profitable trade",
    variants: [
      { key: "coin_a", label: "A · Single Ting", desc: "One crisp coin chime" },
      { key: "coin_b", label: "B · Coin Bounce", desc: "Two quick rising tings" },
      { key: "coin_c", label: "C · Metallic Clink", desc: "Bright metallic coin" },
    ],
  },
  {
    title: "Refresh",
    icon: "refresh",
    when: "Plays on pull-to-refresh",
    variants: [
      { key: "refresh_a", label: "A · Swoosh", desc: "Soft airy sweep" },
      { key: "refresh_b", label: "B · Bubble Pop", desc: "Quick playful pop" },
      { key: "refresh_c", label: "C · Two-note Blip", desc: "Gentle double blip" },
    ],
  },
];

export default function SoundLab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const [playing, setPlaying] = useState<string | null>(null);

  const play = (key: string) => {
    setPlaying(key);
    previewSound(key);
    setTimeout(() => setPlaying((p) => (p === key ? null : p)), 900);
  };

  return (
    <View style={styles.flex}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="soundlab-back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/profile")} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Sound Lab</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.lg }}>
        <Text style={styles.intro}>Tap any option to hear it. Once you pick your favorite of each, tell me the letters (e.g. "A, B, C") and I'll set them as your sounds.</Text>

        {GROUPS.map((g) => (
          <View key={g.title} style={styles.group}>
            <View style={styles.groupHead}>
              <View style={[styles.groupIcon, { backgroundColor: A.accentTint }]}>
                <Ionicons name={g.icon as any} size={18} color={A.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.groupTitle}>{g.title}</Text>
                <Text style={styles.groupWhen}>{g.when}</Text>
              </View>
            </View>
            {g.variants.map((v) => {
              const active = playing === v.key;
              return (
                <Pressable
                  key={v.key}
                  testID={`play-${v.key}`}
                  onPress={() => play(v.key)}
                  style={[styles.row, active && { borderColor: A.accent, ...glow(A.accent, 0.35) }]}
                >
                  <View style={[styles.playBtn, { backgroundColor: active ? A.accent : colors.surface3 }]}>
                    <Ionicons name={active ? "volume-high" : "play"} size={18} color={active ? A.onAccent : colors.onSurface} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{v.label}</Text>
                    <Text style={styles.rowDesc}>{v.desc}</Text>
                  </View>
                  <Ionicons name="play-circle-outline" size={22} color={colors.onSurface3} />
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface2 },
  headerTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  intro: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, lineHeight: 20 },
  group: { gap: spacing.sm },
  groupHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xs },
  groupIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  groupTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  groupWhen: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  playBtn: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  rowLabel: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.base },
  rowDesc: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
});
