import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Polyline, Line as SvgLine } from "react-native-svg";
import { api } from "@/src/api";
import { colors, spacing, radius, font, fs } from "@/src/theme";
import { useAccent } from "@/src/context/AccentContext";
import { ScreenBackground } from "@/src/components/ui";

const SYMBOLS = ["SPY", "SPX", "XSP"];

function fmtGex(v: number): string {
  if (v === null || v === undefined || isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
function fmtPx(v?: number | null): string {
  if (v === null || v === undefined || isNaN(v as number)) return "—";
  return (v as number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function ago(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Sparkline({ data, color, width = 300, height = 44 }: { data: any[]; color: string; width?: number; height?: number }) {
  if (!data || data.length < 2) return null;
  const vals = data.map((d) => d.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max - min) || 1;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d.v - min) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const zeroY = min < 0 && max > 0 ? height - ((0 - min) / range) * (height - 6) - 3 : null;
  return (
    <Svg width={width} height={height}>
      {zeroY != null && <SvgLine x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={colors.border} strokeWidth={1} strokeDasharray="3,3" />}
      <Polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

function ExpectedRange({ spot, put, call, accent }: { spot?: number; put?: number; call?: number; accent: string }) {
  if (spot == null || put == null || call == null || call <= put) return null;
  const pct = Math.min(Math.max((spot - put) / (call - put), 0), 1);
  const toCall = call - spot;
  const toPut = spot - put;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Expected Range (dealer walls)</Text>
      <View style={styles.rangeBar}>
        <View style={styles.rangeMarker} />
        <View style={[styles.rangeDot, { left: `${pct * 100}%`, backgroundColor: accent }]} />
      </View>
      <View style={styles.rangeLabels}>
        <View>
          <Text style={[styles.rangeEnd, { color: colors.error }]}>{put.toFixed(0)}</Text>
          <Text style={styles.rangeSub}>Put wall · -{toPut.toFixed(2)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.rangeEnd, { color: colors.success }]}>{call.toFixed(0)}</Text>
          <Text style={[styles.rangeSub, { textAlign: "right" }]}>Call wall · +{toCall.toFixed(2)}</Text>
        </View>
      </View>
      <Text style={styles.rangeNote}>Spot {spot.toFixed(2)} sits {(pct * 100).toFixed(0)}% between the put and call walls — the band dealers are likely to defend.</Text>
    </View>
  );
}


function StrikeRow({ s, max, tag }: { s: any; max: number; tag?: string }) {
  const pos = (s.gex ?? 0) >= 0;
  const w = Math.max((Math.abs(s.gex ?? 0) / (max || 1)) * 100, 3);
  return (
    <View style={styles.strikeRow}>
      <View style={styles.strikeHead}>
        <Text style={styles.strikeLabel}>{s.strike}</Text>
        {tag ? <Text style={[styles.strikeTag, tag === "Spot" ? styles.tagSpot : pos ? styles.tagCall : styles.tagPut]}>{tag}</Text> : null}
      </View>
      <View style={styles.strikeTrack}>
        <View style={[styles.strikeFill, { width: `${w}%`, backgroundColor: pos ? colors.success : colors.error }]} />
      </View>
      <Text style={[styles.strikeGex, { color: pos ? colors.success : colors.error }]}>{fmtGex(s.gex ?? 0)}</Text>
    </View>
  );
}

export default function Gex() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const A = useAccent().theme;
  const [snaps, setSnaps] = useState<Record<string, any>>({});
  const [sym, setSym] = useState("SPY");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const r = await api.get("/gex");
      const map: Record<string, any> = {};
      (r.snapshots || []).forEach((s: any) => { map[s.symbol] = s; });
      setSnaps(map);
      setLocked(false);
      setError("");
    } catch (e: any) {
      if (e.status === 402) setLocked(true);
      else setError(e.message || "Could not load GEX data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const d = snaps[sym];
  const strikes = (d?.strikes || []).slice().sort((a: any, b: any) => b.strike - a.strike);
  const maxGex = Math.max(1, ...strikes.map((x: any) => Math.abs(x.gex ?? 0)));
  const netPos = (d?.net_gex ?? 0) >= 0;
  const STALE_MS = 26 * 3600 * 1000; // flag if bot hasn't pushed in >26h (daily cadence)
  const snapTs = d ? new Date(d.timestamp || d.received_at).getTime() : 0;
  const isStale = !!d && !isNaN(snapTs) && (Date.now() - snapTs) > STALE_MS;

  const tagFor = (strike: number): string | undefined => {
    if (d?.call_wall != null && strike === d.call_wall) return "Call Wall";
    if (d?.put_wall != null && strike === d.put_wall) return "Put Wall";
    return undefined;
  };

  return (
    <View style={styles.flex}>
      <ScreenBackground />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="gex-back" onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>GEX Tracker</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={A.accent} size="large" /></View>
      ) : locked ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={44} color={colors.onSurface3} />
          <Text style={styles.empty}>The GEX Tracker & options heatmap is a Premium feature.</Text>
          <Pressable testID="gex-upgrade" style={[styles.upgradeBtn, { backgroundColor: A.accent }]} onPress={() => router.push("/(tabs)/profile")}>
            <Text style={styles.upgradeTxt}>Upgrade to Premium</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={A.accent} />}
        >
          <View style={styles.tabs}>
            {SYMBOLS.map((s) => (
              <Pressable key={s} testID={`gex-tab-${s}`} onPress={() => setSym(s)}
                style={[styles.tab, sym === s && { backgroundColor: A.accent, borderColor: A.accent }]}>
                <Text style={[styles.tabTxt, sym === s && { color: colors.onBrand }]}>{s}</Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={styles.errTxt}>{error}</Text> : null}

          {isStale && (
            <View style={styles.staleBanner}>
              <Ionicons name="warning-outline" size={16} color={colors.warning} />
              <Text style={styles.staleTxt}>Data may be stale — your bot hasn’t pushed {sym} since {ago(d.timestamp || d.received_at)}.</Text>
            </View>
          )}

          {!d ? (
            <View style={styles.waitCard}>
              <Ionicons name="hourglass-outline" size={32} color={colors.onSurface3} />
              <Text style={styles.empty}>No {sym} data yet. Waiting for your bot to push a snapshot.</Text>
            </View>
          ) : (
            <>
              <View style={styles.netCard}>
                <View style={styles.netTop}>
                  <View>
                    <Text style={styles.netLabel}>Net Gamma Exposure</Text>
                    <Text style={[styles.netVal, { color: netPos ? colors.success : colors.error }]}>{fmtGex(d.net_gex ?? 0)}</Text>
                    <Text style={[styles.netTag, { color: netPos ? colors.success : colors.error }]}>
                      {netPos ? "Positive · dealers suppress volatility" : "Negative · dealers amplify volatility"}
                    </Text>
                  </View>
                  <View style={styles.spotBox}>
                    <Text style={styles.spotLabel}>SPOT</Text>
                    <Text style={styles.spotVal}>{fmtPx(d.spot)}</Text>
                  </View>
                </View>
                <Text style={[styles.updated, isStale && { color: colors.warning }]}>Updated {ago(d.timestamp || d.received_at)}</Text>
                {d.net_gex_history?.length > 1 && (
                  <View style={styles.trendWrap}>
                    <Text style={styles.trendLabel}>Net GEX trend · last {d.net_gex_history.length}</Text>
                    <Sparkline data={d.net_gex_history} color={A.accent} />
                  </View>
                )}
              </View>

              <View style={styles.levelGrid}>
                <View style={styles.levelCard}>
                  <Text style={styles.levelLabel}>Gamma Flip</Text>
                  <Text style={[styles.levelVal, { color: A.accent }]}>{fmtPx(d.flip_point)}</Text>
                </View>
                <View style={styles.levelCard}>
                  <Text style={styles.levelLabel}>Call Wall</Text>
                  <Text style={[styles.levelVal, { color: colors.success }]}>{fmtPx(d.call_wall)}</Text>
                </View>
                <View style={styles.levelCard}>
                  <Text style={styles.levelLabel}>Put Wall</Text>
                  <Text style={[styles.levelVal, { color: colors.error }]}>{fmtPx(d.put_wall)}</Text>
                </View>
              </View>

              <ExpectedRange spot={d.spot} put={d.put_wall} call={d.call_wall} accent={A.accent} />

              {strikes.length ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Strike Gamma Heatmap</Text>
                  {strikes.map((s: any) => <StrikeRow key={s.strike} s={s} max={maxGex} tag={tagFor(s.strike)} />)}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  empty: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.base, textAlign: "center" },
  errTxt: { color: colors.error, fontFamily: font.text, fontSize: fs.sm, textAlign: "center" },
  staleBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.warning + "18", borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning + "55", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  staleTxt: { flex: 1, color: colors.onSurface, fontFamily: font.text, fontSize: fs.sm, lineHeight: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  backBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.surface2 },
  headerTitle: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  upgradeBtn: { borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  upgradeTxt: { color: colors.onBrand, fontFamily: font.displayBold, fontSize: fs.base },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  tabTxt: { color: colors.onSurface2, fontFamily: font.displayBold, fontSize: fs.base, letterSpacing: 0.5 },
  waitCard: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.xl, borderWidth: 1, borderColor: colors.border, alignItems: "center", gap: spacing.sm },
  netCard: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  netTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  netLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1 },
  netVal: { fontFamily: font.displayBold, fontSize: 34, marginTop: 2 },
  netTag: { fontFamily: font.text, fontSize: fs.sm, marginTop: 2 },
  spotBox: { alignItems: "flex-end" },
  spotLabel: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, letterSpacing: 1 },
  spotVal: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.xl },
  updated: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  trendWrap: { marginTop: spacing.sm, gap: 2 },
  trendLabel: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  rangeBar: { height: 10, borderRadius: radius.pill, backgroundColor: colors.surface3, justifyContent: "center", marginTop: spacing.xs, marginBottom: spacing.sm },
  rangeMarker: { position: "absolute", left: 0, right: 0, height: 10, borderRadius: radius.pill, backgroundColor: colors.error + "22" },
  rangeDot: { position: "absolute", width: 14, height: 14, borderRadius: 7, marginLeft: -7, borderWidth: 2, borderColor: colors.surface },
  rangeLabels: { flexDirection: "row", justifyContent: "space-between" },
  rangeEnd: { fontFamily: font.displayBold, fontSize: fs.lg },
  rangeSub: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm },
  rangeNote: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, lineHeight: 18, marginTop: spacing.sm },
  levelGrid: { flexDirection: "row", gap: spacing.sm },
  levelCard: { flex: 1, backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 2 },
  levelLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm },
  levelVal: { fontFamily: font.displayBold, fontSize: fs.lg },
  section: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  sectionTitle: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.xs },
  strikeRow: { gap: 3, marginBottom: spacing.xs },
  strikeHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  strikeLabel: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs.base },
  strikeTag: { fontFamily: font.text, fontSize: fs.sm, paddingHorizontal: spacing.sm, paddingVertical: 1, borderRadius: radius.sm, overflow: "hidden" },
  tagCall: { color: colors.success, backgroundColor: colors.success + "22" },
  tagPut: { color: colors.error, backgroundColor: colors.error + "22" },
  tagSpot: { color: colors.onSurface, backgroundColor: colors.surface3 },
  strikeTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surface3, overflow: "hidden" },
  strikeFill: { height: 8, borderRadius: radius.pill },
  strikeGex: { fontFamily: font.displayBold, fontSize: fs.sm },
});
