import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { colors, spacing, radius, font, fs } from "@/src/theme";

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password) return toast("Enter email and password", "error");
    setBusy(true);
    try { await login(email.trim(), password); router.replace("/(tabs)"); }
    catch (e: any) { toast(e.message || "Login failed", "error"); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.flex}>
      <Image source={require("../../assets/images/icon.png")} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={["rgba(10,10,10,0.35)", "rgba(10,10,10,0.72)", "rgba(10,10,10,0.94)"]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 60 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.logo}><Ionicons name="trending-up" size={34} color={colors.onBrand} /></View>
          <Text style={styles.title}>Blue Collar Strategy Guide</Text>
          <Text style={styles.subtitle}>Your personal AI trading coach</Text>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput testID="login-email" style={styles.input} placeholder="you@email.com" placeholderTextColor={colors.onSurface3}
              value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Text style={styles.label}>Password</Text>
            <TextInput testID="login-password" style={styles.input} placeholder="••••••••" placeholderTextColor={colors.onSurface3}
              value={password} onChangeText={setPassword} secureTextEntry />

            <Pressable testID="login-submit" style={styles.btn} onPress={submit} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.btnTxt}>Log In</Text>}
            </Pressable>
            <Pressable testID="go-register" onPress={() => router.push("/(auth)/register")} style={styles.linkWrap}>
              <Text style={styles.link}>New here? <Text style={styles.linkBold}>Create an account</Text></Text>
            </Pressable>
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
  logo: { width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  title: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: 30, letterSpacing: 0.5 },
  subtitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.lg, marginTop: spacing.xs, marginBottom: spacing.xxl },
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
