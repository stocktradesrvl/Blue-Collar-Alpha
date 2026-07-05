import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";

export default function Register() {
  const { register } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referral, setReferral] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || password.length < 6) return toast("Password must be 6+ characters", "error");
    setBusy(true);
    try { await register(email.trim(), password, referral.trim() || undefined); router.replace("/(tabs)"); }
    catch (e: any) { toast(e.message || "Registration failed", "error"); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 20 }]} keyboardShouldPersistTaps="handled">
        <Pressable testID="back-btn" onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>Start your first coaching session free</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput testID="reg-email" style={styles.input} placeholder="you@email.com" placeholderTextColor={colors.onSurface3}
            value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
          <Text style={styles.label}>Password</Text>
          <TextInput testID="reg-password" style={styles.input} placeholder="Min 6 characters" placeholderTextColor={colors.onSurface3}
            value={password} onChangeText={setPassword} secureTextEntry />
          <Text style={styles.label}>Referral code (optional)</Text>
          <TextInput testID="reg-referral" style={styles.input} placeholder="Get 20 bonus trades" placeholderTextColor={colors.onSurface3}
            value={referral} onChangeText={setReferral} autoCapitalize="characters" />

          <Pressable testID="reg-submit" style={styles.btn} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnTxt}>Create Account</Text>}
          </Pressable>
          <Pressable testID="go-login" onPress={() => router.back()} style={styles.linkWrap}>
            <Text style={styles.link}>Have an account? <Text style={styles.linkBold}>Log in</Text></Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  container: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { marginBottom: spacing.xl, width: 40 },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: 34 },
  subtitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.lg, marginTop: spacing.xs, marginBottom: spacing.xl },
  form: { gap: spacing.sm },
  label: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: "uppercase", letterSpacing: 1 },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg },
  btn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  btnTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg, letterSpacing: 0.5 },
  linkWrap: { alignItems: "center", marginTop: spacing.xl },
  link: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  linkBold: { color: colors.brand, fontFamily: font.text },
});
