import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";

const PLANS = [
  { tier: "free", name: "Free", price: "$0", features: ["20 trades / month", "Trade screenshot analysis", "P&L & win-rate stats"] },
  { tier: "pro", name: "Pro", price: "$29/mo", features: ["Unlimited trades", "Chart screenshot analysis", "Setup grading A–F", "Strategy rule checks"] },
  { tier: "premium", name: "Premium", price: "$79/mo", features: ["Everything in Pro", "AI Coach chat", "Daily session reports", "Behavioral insights"] },
];

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, setTier } = useAuth();
  const toast = useToast();

  const change = async (tier: string) => {
    try { await setTier(tier); toast(`Switched to ${tier} plan`, "success"); }
    catch (e: any) { toast(e.message, "error"); }
  };

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 120 }}>
        <View style={styles.userCard}>
          <View style={styles.avatar}><Ionicons name="person" size={28} color={colors.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
            <View style={styles.tierBadge}><Text style={styles.tierBadgeTxt}>{(user?.subscription_tier || "free").toUpperCase()}</Text></View>
          </View>
        </View>

        <Text style={styles.section}>Subscription Plans</Text>
        {PLANS.map((p) => {
          const active = user?.subscription_tier === p.tier;
          return (
            <View key={p.tier} style={[styles.plan, active && styles.planActive]}>
              <View style={styles.planTop}>
                <Text style={styles.planName}>{p.name}</Text>
                <Text style={styles.planPrice}>{p.price}</Text>
              </View>
              {p.features.map((f) => (
                <View key={f} style={styles.feat}><Ionicons name="checkmark" size={16} color={colors.success} /><Text style={styles.featTxt}>{f}</Text></View>
              ))}
              <Pressable testID={`select-${p.tier}`} disabled={active} style={[styles.planBtn, active && styles.planBtnActive]} onPress={() => change(p.tier)}>
                <Text style={[styles.planBtnTxt, active && { color: colors.onSurface2 }]}>{active ? "Current Plan" : `Switch to ${p.name}`}</Text>
              </Pressable>
            </View>
          );
        })}

        <Pressable testID="logout-btn" style={styles.logout} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutTxt}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  userCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xl },
  avatar: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" },
  email: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.xl },
  tierBadge: { alignSelf: "flex-start", backgroundColor: colors.brandTint, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, marginTop: spacing.xs },
  tierBadgeTxt: { color: colors.brand, fontFamily: font.text, fontSize: fs.sm, letterSpacing: 1 },
  section: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.md },
  plan: { backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  planActive: { borderColor: colors.brand },
  planTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: spacing.xs },
  planName: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  planPrice: { color: colors.brand, fontFamily: font.displayBold, fontSize: fs.xl },
  feat: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  featTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  planBtn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  planBtnActive: { backgroundColor: colors.surface3 },
  planBtnTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.base },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl, padding: spacing.lg },
  logoutTxt: { color: colors.error, fontFamily: font.display, fontSize: fs.lg },
});
