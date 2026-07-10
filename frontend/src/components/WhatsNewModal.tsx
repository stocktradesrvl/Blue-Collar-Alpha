import React, { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { storage } from "@/src/utils/storage";
import { colors, spacing, radius, font, fs } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { WHATS_NEW, WHATS_NEW_VERSION } from "@/src/whatsNew";

const SEEN_KEY = "tm_whats_new_version";

export default function WhatsNewModal() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const A = useAccent().theme;

  useEffect(() => {
    (async () => {
      const seen = await storage.getItem<string>(SEEN_KEY, "");
      if (seen !== WHATS_NEW_VERSION) setVisible(true);
    })();
  }, []);

  const dismiss = async () => {
    await storage.setItem(SEEN_KEY, WHATS_NEW_VERSION);
    setVisible(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <View style={[styles.card, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={[styles.badge, { backgroundColor: A.accent }]}>
            <Ionicons name="sparkles" size={22} color={A.onAccent} />
          </View>
          <Text style={styles.title}>{"What's New"}</Text>
          <Text style={styles.subtitle}>The latest updates in Blue Collar Strategy Guide</Text>

          <View style={styles.list}>
            {WHATS_NEW.map((item, i) => (
              <View key={i} style={styles.row}>
                <View style={styles.iconWrap}>
                  <Ionicons name={item.icon as any} size={20} color={colors.brand} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowBody}>{item.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <Pressable testID="whats-new-dismiss" style={styles.btn} onPress={dismiss}>
            <Text style={styles.btnTxt}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  card: {
    backgroundColor: colors.surface2, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.xl, borderTopWidth: 1, borderColor: colors.border,
  },
  badge: {
    width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.accent,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  subtitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, marginTop: 2, marginBottom: spacing.lg },
  list: { gap: spacing.lg, marginBottom: spacing.xl },
  row: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  iconWrap: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandTint,
    alignItems: "center", justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  rowBody: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, marginTop: 2, lineHeight: 20 },
  btn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center" },
  btnTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg, letterSpacing: 0.5 },
});
