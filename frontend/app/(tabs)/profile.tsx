import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share, TextInput, KeyboardAvoidingView, Platform, Switch } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/context/ToastContext";
import { colors, spacing, radius, font, fs, gradients, glow } from "@/src/theme";
import { useAccent, ACCENT_LIST } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";
import { isSoundMuted, setSoundMuted } from "@/src/utils/sound";
import { storage } from "@/src/utils/storage";
import { BACKDROP_KEY, BACKDROPS } from "@/src/appearance";

const PLANS = [
  { tier: "free", name: "Free", price: "$0", promo: "", features: ["20 trades / month", "Trade screenshot analysis", "P&L & win-rate stats"] },
  { tier: "pro", name: "Pro", price: "$17.99/mo", promo: "🎉 First month just $9.99", features: ["Unlimited trades", "Chart screenshot analysis", "Setup grading A–F", "Strategy rule checks", "Pre-Trade Grader"] },
  { tier: "premium", name: "Premium", price: "$28.99/mo", promo: "🎉 7-day free trial, then $14.99 first month", features: ["Everything in Pro", "AI Coach chat", "Daily session reports", "Behavioral insights"] },
];

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, setTier, setBalance, changePassword, refresh } = useAuth();
  const { theme: A, accentId, setAccentId } = useAccent();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [balInput, setBalInput] = useState(String(user?.account_balance ?? 10000));
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [soundOn, setSoundOn] = useState(!isSoundMuted());
  const [backdrop, setBackdrop] = useState<string>("cash");
  const [promoActive, setPromoActive] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [lossInput, setLossInput] = useState(String(user?.daily_loss_limit || ""));
  const [digestOn, setDigestOn] = useState(user?.weekly_digest_enabled !== false);

  const toggleDigest = async (v: boolean) => {
    setDigestOn(v);
    try { await api.post("/user/settings", { weekly_digest_enabled: v }); await refresh(); }
    catch (e: any) { setDigestOn(!v); toast(e.message || "Could not update", "error"); }
  };

  const linkDiscord = async () => {
    setBusy("discord");
    try {
      const origin = process.env.EXPO_PUBLIC_BACKEND_URL!;
      const returnUrl = Linking.createURL("discord-linked");
      const { url } = await api.post("/auth/discord/link-url", { origin, return_url: returnUrl });
      const res = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (res.type === "success" && res.url) {
        const st = Linking.parse(res.url).queryParams?.discord;
        if (st === "linked") { await refresh(); toast("Discord linked!", "success"); }
        else if (st === "conflict") toast("That Discord is already linked to another account", "error");
        else if (st !== "cancelled") toast("Could not link Discord", "error");
      }
    } catch (e: any) { toast(e.message || "Could not link Discord", "error"); }
    finally { setBusy(null); }
  };

  const unlinkDiscord = async () => {
    setBusy("discord");
    try { await api.post("/auth/discord/unlink"); await refresh(); toast("Discord unlinked", "info"); }
    catch (e: any) { toast(e.message || "Could not unlink", "error"); }
    finally { setBusy(null); }
  };

  const saveLossLimit = async () => {
    const val = parseFloat(lossInput) || 0;
    try {
      await api.post("/user/settings", { daily_loss_limit: val });
      await refresh();
      toast(val > 0 ? `Daily loss limit set to $${val}` : "Loss limit disabled", "success");
    } catch (e: any) {
      toast(e.message || "Could not save", "error");
    }
  };

  useEffect(() => {
    storage.getItem<string>(BACKDROP_KEY, "cash").then((v) => setBackdrop(v || "cash"));
    api.get("/config").then((c) => { setPromoActive(!!c?.promo_active); setDiscordEnabled(!!c?.discord_enabled); }).catch(() => {});
  }, []);

  const pickBackdrop = async (id: string) => {
    setBackdrop(id);
    await storage.setItem(BACKDROP_KEY, id);
  };

  const toggleSound = async (v: boolean) => {
    setSoundOn(v);
    await setSoundMuted(!v);
  };

  const saveBalance = async () => {
    const v = parseFloat(balInput);
    if (isNaN(v) || v < 0) return toast("Enter a valid balance", "error");
    try { await setBalance(v); toast("Starting balance updated", "success"); }
    catch (e: any) { toast(e.message, "error"); }
  };

  const savePassword = async () => {
    if (newPw.length < 6) return toast("New password must be 6+ characters", "error");
    setBusy("pw");
    try { await changePassword(curPw, newPw); setCurPw(""); setNewPw(""); toast("Password updated", "success"); }
    catch (e: any) { toast(e.message || "Could not change password", "error"); }
    finally { setBusy(null); }
  };

  const change = async (tier: string) => {
    if (tier === "free") {
      setBusy("free");
      try {
        if (user?.subscription_tier !== "free") {
          try {
            const r = await api.post("/payments/cancel");
            if (r.ok) { await refresh(); toast("Subscription cancelled", "info"); }
          } catch {
            // No active Stripe subscription (e.g. owner/reward access) — just switch tier.
            await setTier("free");
            toast("Switched to Free plan", "info");
          }
        } else { await setTier("free"); }
      } catch (e: any) { toast(e.message, "error"); }
      finally { setBusy(null); }
      return;
    }
    setBusy(tier);
    try {
      const returnUrl = Linking.createURL("payment-complete");
      const { checkout_url, session_id } = await api.post("/payments/create-checkout-session", {
        tier, origin: process.env.EXPO_PUBLIC_BACKEND_URL, return_url: returnUrl,
      });
      const res = await WebBrowser.openAuthSessionAsync(checkout_url, returnUrl);
      if (res.type === "success" && res.url) {
        const parsed = Linking.parse(res.url);
        if (parsed.queryParams?.status === "cancel") { toast("Checkout cancelled", "info"); }
        else {
          const r = await api.get(`/payments/status?session_id=${session_id}`);
          if (r.paid) { await refresh(); toast(`Welcome to ${tier === "premium" ? "Premium" : "Pro"}!`, "success"); }
          else toast("Payment not confirmed yet. Pull to refresh shortly.", "info");
        }
      } else {
        // Browser dismissed — verify anyway in case payment completed.
        const r = await api.get(`/payments/status?session_id=${session_id}`).catch(() => null);
        if (r?.paid) { await refresh(); toast(`Welcome to ${tier}!`, "success"); }
      }
    } catch (e: any) { toast(e.message || "Payment failed", "error"); }
    finally { setBusy(null); }
  };

  const shareReferral = async () => {
    const code = user?.referral_code;
    if (!code) return;
    try {
      await Share.share({
        message: `I'm using Blue Collar Alpha — an AI trading coach that reviews your trades from screenshots. Sign up with my code ${code} and we both get 20 bonus trades. 📈`,
      });
    } catch {}
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={styles.userCard}>
          <View style={styles.avatar}><Ionicons name="person" size={28} color={colors.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
            {(() => {
              const t = user?.subscription_tier || "free";
              const g = t === "premium" ? A.gradient : t === "pro" ? gradients.brand : null;
              return g ? (
                <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.tierBadge, styles.tierBadgeGlow, t === "premium" ? glow(A.accent, 0.5) : glow(colors.brand, 0.5)]}>
                  <Ionicons name={t === "premium" ? "star" : "ribbon"} size={12} color={t === "premium" ? A.onAccent : colors.onBrand} />
                  <Text style={[styles.tierBadgeTxt, { color: t === "premium" ? A.onAccent : colors.onBrand }]}>{t.toUpperCase()}</Text>
                </LinearGradient>
              ) : (
                <View style={styles.tierBadge}><Text style={styles.tierBadgeTxt}>{t.toUpperCase()}</Text></View>
              );
            })()}
          </View>
        </View>

        <Text style={styles.section}>Account</Text>
        <View style={styles.settingsCard}>
          <Text style={styles.settingLabel}>Starting account balance</Text>
          <View style={styles.inlineRow}>
            <TextInput testID="balance-input" style={styles.settingInput} value={balInput} onChangeText={setBalInput}
              keyboardType="numeric" placeholder="10000" placeholderTextColor={colors.onSurface3} />
            <Pressable testID="save-balance" style={styles.saveMini} onPress={saveBalance}><Text style={styles.saveMiniTxt}>Save</Text></Pressable>
          </View>
          <View style={styles.divider} />
          <Text style={styles.settingLabel}>Change password</Text>
          <TextInput testID="current-password" style={styles.settingInputFull} value={curPw} onChangeText={setCurPw}
            secureTextEntry placeholder="Current password" placeholderTextColor={colors.onSurface3} />
          <TextInput testID="new-password" style={styles.settingInputFull} value={newPw} onChangeText={setNewPw}
            secureTextEntry placeholder="New password (6+ chars)" placeholderTextColor={colors.onSurface3} />
          <Pressable testID="save-password" style={styles.saveMini} onPress={savePassword} disabled={busy === "pw"}>
            {busy === "pw" ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.saveMiniTxt}>Update Password</Text>}
          </Pressable>
        </View>

        {discordEnabled && (
          <>
            <Text style={styles.section}>Community</Text>
            <View style={styles.settingsCard}>
              <View style={styles.discordHeader}>
                <Ionicons name="logo-discord" size={22} color="#5865F2" />
                <Text style={styles.prefLabel}>Discord</Text>
              </View>
              {user?.discord_id ? (
                <>
                  <Text style={styles.prefHint}>Linked as {user.discord_username || "your Discord account"}. Paid members are automatically granted the subscriber role.</Text>
                  <Pressable testID="discord-unlink" style={styles.discordUnlink} onPress={unlinkDiscord} disabled={busy === "discord"}>
                    {busy === "discord" ? <ActivityIndicator color={colors.onSurface} /> : <Text style={styles.discordUnlinkTxt}>Unlink Discord</Text>}
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.prefHint}>Link your Discord to auto-receive the subscriber role the moment you upgrade to Pro or Premium.</Text>
                  <Pressable testID="discord-link" style={styles.discordBtn} onPress={linkDiscord} disabled={busy === "discord"}>
                    {busy === "discord" ? <ActivityIndicator color="#fff" /> : (
                      <><Ionicons name="logo-discord" size={18} color="#fff" /><Text style={styles.discordBtnTxt}>Link Discord</Text></>
                    )}
                  </Pressable>
                </>
              )}
            </View>
          </>
        )}

        <Text style={styles.section}>Preferences</Text>
        <View style={styles.settingsCard}>
          <View style={styles.prefRow}>
            <View style={styles.prefLeft}>
              <Ionicons name={soundOn ? "volume-high" : "volume-mute"} size={20} color={A.accent} />
              <Text style={styles.prefLabel}>Sound Effects</Text>
            </View>
            <Switch testID="sound-toggle" value={soundOn} onValueChange={toggleSound}
              trackColor={{ false: colors.surface3, true: A.accent }} thumbColor={colors.onSurface} />
          </View>

          <Pressable testID="open-soundlab" style={styles.soundLabRow} onPress={() => router.push("/soundlab")}>
            <View style={styles.prefLeft}>
              <Ionicons name="musical-notes" size={20} color={A.accent} />
              <Text style={styles.soundLabTxt}>Sound Lab — preview &amp; pick sounds</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
          </Pressable>

          <View style={styles.prefDivider} />
          <Text style={styles.prefLabel}>Daily Loss Limit</Text>
          <Text style={styles.prefHint}>Get a coaching alert on the Dashboard when your day's loss exceeds this. Set 0 to disable.</Text>
          <View style={styles.lossRow}>
            <Text style={styles.lossDollar}>$</Text>
            <TextInput
              testID="loss-limit-input"
              style={styles.lossInput}
              value={lossInput}
              onChangeText={setLossInput}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.onSurface3}
            />
            <Pressable testID="loss-limit-save" style={[styles.lossSave, { backgroundColor: A.accent }]} onPress={saveLossLimit}>
              <Text style={[styles.lossSaveTxt, { color: A.onAccent }]}>Save</Text>
            </Pressable>
          </View>

          <View style={styles.prefDivider} />
          <View style={styles.prefRow}>
            <View style={styles.prefLeft}>
              <Ionicons name="mail-outline" size={20} color={A.accent} />
              <Text style={styles.prefLabel}>Weekly Email Recap</Text>
            </View>
            <Switch testID="digest-toggle" value={digestOn} onValueChange={toggleDigest}
              trackColor={{ false: colors.surface3, true: A.accent }} thumbColor={colors.onSurface} />
          </View>
          <Text style={styles.prefHint}>Get a weekly performance summary emailed to {user?.email}.</Text>

          <View style={styles.prefDivider} />
          <Text style={styles.prefLabel}>Dashboard Backdrop</Text>
          <View style={styles.backdropRow}>
            {BACKDROPS.map((b) => (
              <Pressable key={b.id} testID={`backdrop-${b.id}`} style={styles.backdropItem} onPress={() => pickBackdrop(b.id)}>
                <View style={[styles.backdropThumb, backdrop === b.id && [styles.backdropThumbActive, { borderColor: A.accent, shadowColor: A.accent }]]}>
                  <Image source={b.source} style={StyleSheet.absoluteFill} contentFit="cover" />
                  {backdrop === b.id && (
                    <View style={styles.backdropCheck}><Ionicons name="checkmark-circle" size={22} color={A.accent} /></View>
                  )}
                </View>
                <Text style={[styles.backdropLabel, backdrop === b.id && { color: A.accent }]}>{b.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.prefDivider} />
          <Text style={styles.prefLabel}>Accent Color</Text>
          <View style={styles.accentRow}>
            {ACCENT_LIST.map((ac) => {
              const active = accentId === ac.id;
              return (
                <Pressable key={ac.id} testID={`accent-${ac.id}`} style={styles.accentItem} onPress={() => setAccentId(ac.id)}>
                  <View style={[styles.accentSwatch, { backgroundColor: ac.accent, borderColor: active ? colors.onSurface : "transparent" }, active && glow(ac.accent, 0.6)]}>
                    {active && <Ionicons name="checkmark" size={20} color={ac.onAccent} />}
                  </View>
                  <Text style={[styles.accentLabel, active && { color: ac.accent }]}>{ac.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.referCard}>
          <View style={styles.referHead}>
            <Ionicons name="gift" size={20} color={colors.brand} />
            <Text style={styles.referTitle}>Refer &amp; Earn</Text>
          </View>
          <Text style={styles.referSub}>Share your code — you both get 20 bonus trades. Invite 3 friends → free month of Pro.</Text>
          <View style={styles.codeBox}>
            <Text testID="referral-code" style={styles.code}>{user?.referral_code || "—"}</Text>
            <Pressable testID="share-referral" style={styles.shareBtn} onPress={shareReferral}>
              <Ionicons name="share-social" size={16} color={colors.onBrand} />
              <Text style={styles.shareTxt}>Share</Text>
            </Pressable>
          </View>
          <Text style={styles.referStat}>{user?.referral_count || 0} friends joined · {user?.bonus_trades || 0} bonus trades earned</Text>
          {user?.reward_pro_until && new Date(user.reward_pro_until) > new Date() ? (
            <View style={styles.rewardPill}>
              <Ionicons name="trophy" size={14} color={colors.success} />
              <Text style={styles.rewardTxt}>Free Pro active until {new Date(user.reward_pro_until).toLocaleDateString()}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.section}>Subscription Plans</Text>
        <Pressable testID="manage-billing" style={styles.billingRow} onPress={() => router.push("/billing")}>
          <Ionicons name="receipt-outline" size={20} color={colors.brand} />
          <Text style={styles.billingTxt}>Manage Billing & Invoices</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurface3} />
        </Pressable>
        {PLANS.map((p) => {
          const active = user?.subscription_tier === p.tier;
          return (
            <View key={p.tier} style={[styles.plan, active && [styles.planActive, { borderColor: A.accent, shadowColor: A.accent }]]}>
              {promoActive && p.promo ? (
                <View style={styles.ribbon} pointerEvents="none">
                  <Text style={styles.ribbonTxt}>LAUNCH DEAL</Text>
                </View>
              ) : null}
              <View style={styles.planTop}>
                <View style={styles.planNameWrap}>
                  <Text style={styles.planName}>{p.name}</Text>
                </View>
                <Text style={styles.planPrice}>{p.price}</Text>
              </View>
              {promoActive && p.promo ? (
                <View style={styles.promoBadge}><Text style={styles.promoTxt}>{p.promo}</Text></View>
              ) : null}
              {p.features.map((f) => (
                <View key={f} style={styles.feat}><Ionicons name="checkmark" size={16} color={colors.success} /><Text style={styles.featTxt}>{f}</Text></View>
              ))}
              <Pressable testID={`select-${p.tier}`} disabled={active || busy !== null} style={[styles.planBtn, active && styles.planBtnActive]} onPress={() => change(p.tier)}>
                {busy === p.tier ? <ActivityIndicator color={colors.onBrand} /> :
                  <Text style={[styles.planBtnTxt, active && { color: colors.onSurface2 }]}>{active ? "Current Plan" : p.tier === "free" ? "Downgrade to Free" : `Upgrade to ${p.name}`}</Text>}
              </Pressable>
            </View>
          );
        })}

        <Pressable testID="logout-btn" style={styles.logout} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.logoutTxt}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  userCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xl },
  avatar: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center", ...glow(colors.brand, 0.35) },
  email: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.xl },
  tierBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: colors.surface3, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3, marginTop: spacing.xs },
  tierBadgeGlow: {},
  tierBadgeTxt: { color: colors.onSurface2, fontFamily: font.displayBold, fontSize: fs.sm, letterSpacing: 1 },
  referCard: { backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.brand, marginBottom: spacing.xl, gap: spacing.sm },
  referHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  referTitle: { color: colors.brand, fontFamily: font.displayBold, fontSize: fs.xl },
  referSub: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  codeBox: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingVertical: spacing.sm, marginTop: spacing.xs },
  code: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"], letterSpacing: 3 },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  shareTxt: { color: colors.onBrand, fontFamily: font.display, fontSize: fs.base },
  referStat: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  rewardPill: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", backgroundColor: colors.success + "22", borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, marginTop: spacing.xs },
  rewardTxt: { color: colors.success, fontFamily: font.text, fontSize: fs.sm },
  section: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.md },
  settingsCard: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xl, gap: spacing.sm },
  discordHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  discordBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: "#5865F2", borderRadius: radius.md, paddingVertical: spacing.md, marginTop: spacing.xs },
  discordBtnTxt: { color: "#fff", fontFamily: font.displayBold, fontSize: fs.base, letterSpacing: 0.3 },
  discordUnlink: { alignItems: "center", justifyContent: "center", borderRadius: radius.md, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs },
  discordUnlinkTxt: { color: colors.onSurface2, fontFamily: font.display, fontSize: fs.base },
  prefRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  prefLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  prefLabel: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  prefDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  soundLabRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  soundLabTxt: { color: colors.onSurface, fontFamily: font.display, fontSize: fs.base },
  prefHint: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, lineHeight: 18, marginBottom: spacing.sm },
  lossRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  lossDollar: { color: colors.onSurface2, fontFamily: font.displayBold, fontSize: fs.lg },
  lossInput: { flex: 1, backgroundColor: colors.surface3, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.lg },
  lossSave: { borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  lossSaveTxt: { fontFamily: font.displayBold, fontSize: fs.base },
  backdropRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  backdropItem: { flex: 1, alignItems: "center", gap: spacing.xs },
  backdropThumb: { width: "100%", aspectRatio: 1.3, borderRadius: radius.md, overflow: "hidden", borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface3 },
  backdropThumbActive: { borderColor: colors.accent, ...glow(colors.accent, 0.4) },
  backdropCheck: { position: "absolute", top: 4, right: 4, backgroundColor: colors.surface, borderRadius: radius.pill },
  backdropLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  accentRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm },
  accentItem: { alignItems: "center", gap: spacing.xs },
  accentSwatch: { width: 44, height: 44, borderRadius: radius.pill, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  accentLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  settingLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  inlineRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  settingInput: { flex: 1, backgroundColor: colors.surface3, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  settingInputFull: { backgroundColor: colors.surface3, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, color: colors.onSurface, fontFamily: font.text, fontSize: fs.lg },
  saveMini: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center" },
  saveMiniTxt: { color: colors.onBrand, fontFamily: font.display, fontSize: fs.base },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  billingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  billingTxt: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: fs.lg },
  plan: { backgroundColor: colors.surface2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.sm, overflow: "hidden", position: "relative" },
  ribbon: { position: "absolute", top: 16, right: -30, width: 128, transform: [{ rotate: "45deg" }], backgroundColor: colors.success, alignItems: "center", paddingVertical: 3, ...glow(colors.success, 0.5) },
  ribbonTxt: { color: "#04210F", fontFamily: font.displayBold, fontSize: 10, letterSpacing: 1 },
  planActive: { borderColor: colors.accent, ...glow(colors.accent, 0.3) },
  planTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: spacing.xs },
  planNameWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  planName: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  trialBadge: { backgroundColor: colors.success + "22", borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  trialTxt: { color: colors.success, fontFamily: font.text, fontSize: fs.sm },
  promoBadge: { alignSelf: "flex-start", backgroundColor: colors.success + "1F", borderWidth: 1, borderColor: colors.success + "55", borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3, marginBottom: spacing.sm },
  promoTxt: { color: colors.success, fontFamily: font.displayBold, fontSize: fs.sm },
  planPrice: { color: colors.brand, fontFamily: font.displayBold, fontSize: fs.xl },
  feat: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  featTxt: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.base },
  planBtn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.sm },
  planBtnActive: { backgroundColor: colors.surface3 },
  planBtnTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.base },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl, padding: spacing.lg },
  logoutTxt: { color: colors.error, fontFamily: font.display, fontSize: fs.lg },
});
