import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useSpeak } from "@/src/hooks/useSpeak";
import { colors, spacing, radius, font, fs } from "@/src/theme";

export default function Report() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const speaker = useSpeak();

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await api.get("/reports/daily")); } catch (e: any) { setReport({ report: e.message, has_data: false }); }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="back-report" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Session Report</Text>
        <Pressable testID="refresh-report" onPress={load}><Ionicons name="refresh" size={22} color={colors.brand} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /><Text style={styles.gen}>Coach is reviewing your trades...</Text></View>
        ) : (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="sparkles" size={20} color={colors.brand} />
              <Text style={styles.label}>{report?.label || "AI Coach"}</Text>
              {report?.report && report?.has_data !== false && (
                <Pressable testID="report-listen" style={styles.listenBtn} onPress={() => speaker.speak("report", report.report)}>
                  {speaker.loadingId === "report" ? (
                    <ActivityIndicator size="small" color={colors.brand} />
                  ) : (
                    <>
                      <Ionicons name={speaker.playingId === "report" ? "stop-circle" : "volume-high"} size={16} color={colors.brand} />
                      <Text style={styles.listenTxt}>{speaker.playingId === "report" ? "Stop" : "Listen"}</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
            <Text style={styles.report}>{report?.report}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  center: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: spacing.lg },
  gen: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.lg },
  card: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.brand, gap: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  listenBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto", backgroundColor: colors.brandTint, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  listenTxt: { color: colors.brand, fontFamily: font.displayBold, fontSize: fs.sm },
  label: { color: colors.brand, fontFamily: font.display, fontSize: fs.lg, textTransform: "uppercase", letterSpacing: 1 },
  report: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg, lineHeight: 26 },
});
