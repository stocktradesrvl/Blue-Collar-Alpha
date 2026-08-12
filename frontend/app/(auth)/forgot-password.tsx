import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { useToast } from "@/src/context/ToastContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";

export default function ForgotPassword() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    if (!email.trim()) return toast("Enter your email", "error");
    setBusy(true);
    try {
      await api.post("/auth/password-reset/request", { email: email.trim() });
      toast("If an account exists, a reset code was emailed.", "success");
      setStep("reset");
    } catch (e: any) {
      toast(e.message || "Something went wrong", "error");
    } finally { setBusy(false); }
  };

  const confirmReset = async () => {
    if (!code.trim() || password.length < 6) return toast("Enter the code and a 6+ char password", "error");
    setBusy(true);
    try {
      await api.post("/auth/password-reset/confirm", { email: email.trim(), code: code.trim(), new_password: password });
      toast("Password updated — please log in.", "success");
      router.replace("/(auth)/login");
    } catch (e: any) {
      toast(e.message || "Invalid or expired code", "error");
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.flex}>
      <Image source={require("../../assets/images/money-bg.jpg")} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient colors={["rgba(10,10,10,0.55)", "rgba(10,10,10,0.8)", "rgba(10,10,10,0.96)"]} style={StyleSheet.absoluteFill} />
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 40 }]} keyboardShouldPersistTaps="handled">
          <Pressable testID="forgot-back" onPress={() => router.back()} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
            <Text style={styles.backTxt}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Reset password</Text>
          <Text style={styles.subtitle}>
            {step === "email" ? "Enter your email and we'll send you a reset code." : `Enter the code we sent to ${email} and choose a new password.`}
          </Text>

          <View style={styles.form}>
            {step === "email" ? (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput testID="forgot-email" style={styles.input} placeholder="you@email.com" placeholderTextColor={colors.onSurface3}
                  value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
                <Pressable testID="forgot-request" style={styles.btn} onPress={requestCode} disabled={busy}>
                  {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnTxt}>Send Reset Code</Text>}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.label}>Reset Code</Text>
                <TextInput testID="forgot-code" style={styles.input} placeholder="6-character code" placeholderTextColor={colors.onSurface3}
                  value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" />
                <Text style={styles.label}>New Password</Text>
                <TextInput testID="forgot-password" style={styles.input} placeholder="••••••••" placeholderTextColor={colors.onSurface3}
                  value={password} onChangeText={setPassword} secureTextEntry />
                <Pressable testID="forgot-confirm" style={styles.btn} onPress={confirmReset} disabled={busy}>
                  {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnTxt}>Update Password</Text>}
                </Pressable>
                <Pressable testID="forgot-resend" onPress={requestCode} disabled={busy} style={styles.linkWrap}>
                  <Text style={styles.link}>Didn't get it? <Text style={styles.linkBold}>Resend code</Text></Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  kav: { flex: 1, backgroundColor: "transparent" },
  container: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  back: { flexDirection: "row", alignItems: "center", gap: 2, marginBottom: spacing.xl },
  backTxt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: 28, letterSpacing: 0.5 },
  subtitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base, marginTop: spacing.xs, marginBottom: spacing.xl, lineHeight: 20 },
  form: { gap: spacing.sm },
  label: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: "uppercase", letterSpacing: 1 },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg },
  btn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.lg, alignItems: "center", marginTop: spacing.xl },
  btnTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.lg, letterSpacing: 0.5 },
  linkWrap: { alignItems: "center", marginTop: spacing.lg },
  link: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  linkBold: { color: colors.brand, fontFamily: font.text },
});
