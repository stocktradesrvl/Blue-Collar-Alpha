import React from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Polyline, Defs, LinearGradient as SvgGradient, Stop, Polygon, Line, Circle } from "react-native-svg";
import { colors, spacing, radius, font, fs, gradients, glow, GRADE_COLORS } from "@/src/theme";

export function GradeBadge({ grade, size = 30 }: { grade: string; size?: number }) {
  const c = GRADE_COLORS[grade] || colors.onSurface2;
  return (
    <View testID={`grade-${grade}`} style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: c + "22",
      borderWidth: 1.5, borderColor: c, alignItems: "center", justifyContent: "center", ...glow(c, 0.35) }}>
      <Text style={{ color: c, fontFamily: font.displayBold, fontSize: size * 0.5 }}>{grade}</Text>
    </View>
  );
}

// Vivid gradient card wrapper with an accent-tinted border.
export function GradientCard({ children, style, accent }: { children: React.ReactNode; style?: ViewStyle; accent?: string }) {
  return (
    <LinearGradient colors={gradients.card} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.gcard, accent ? { borderColor: accent + "66" } : null, style]}>
      {children}
    </LinearGradient>
  );
}

export function StatCard({ label, value, valueColor, sub, style, testID, icon }:
  { label: string; value: string; valueColor?: string; sub?: string; style?: ViewStyle; testID?: string; icon?: string }) {
  const accent = valueColor || colors.brand;
  return (
    <LinearGradient testID={testID} colors={gradients.card} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.stat, { borderColor: accent + "40" }, style]}>
      <View style={styles.statHead}>
        <Text style={styles.statLabel}>{label}</Text>
        {icon ? (
          <View style={[styles.statIcon, { backgroundColor: accent + "1F" }]}>
            <Ionicons name={icon as any} size={14} color={accent} />
          </View>
        ) : null}
      </View>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={styles.statSub} numberOfLines={1}>{sub}</Text> : null}
    </LinearGradient>
  );
}

export function EquityCurve({ data, width, height = 180 }: { data: number[]; width: number; height?: number }) {
  if (!data || data.length < 2) {
    return <View style={{ height, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.onSurface3, fontFamily: font.text }}>Not enough data yet</Text>
    </View>;
  }
  const pad = 8;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / range);
    return { x, y, s: `${x},${y}` };
  });
  const up = data[data.length - 1] >= data[0];
  const stroke = up ? colors.success : colors.error;
  const last = pts[pts.length - 1];
  const areaPts = `${pts.map((p) => p.s).join(" ")} ${pad + (data.length - 1) * stepX},${height - pad} ${pad},${height - pad}`;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity="0.34" />
          <Stop offset="1" stopColor={stroke} stopOpacity="0" />
        </SvgGradient>
      </Defs>
      <Line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke={colors.divider} strokeWidth={1} />
      <Polygon points={areaPts} fill="url(#grad)" />
      <Polyline points={pts.map((p) => p.s).join(" ")} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={last.x} cy={last.y} r={5} fill={stroke} />
      <Circle cx={last.x} cy={last.y} r={9} fill={stroke} fillOpacity={0.25} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  gcard: { borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  stat: { borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  statHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs },
  statIcon: { width: 26, height: 26, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  statLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8 },
  statValue: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  statSub: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginTop: 2 },
});
