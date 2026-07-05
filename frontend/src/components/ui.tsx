import React from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import Svg, { Polyline, Defs, LinearGradient, Stop, Polygon, Line } from "react-native-svg";
import { colors, spacing, radius, font, fs, GRADE_COLORS } from "@/src/theme";

export function GradeBadge({ grade, size = 30 }: { grade: string; size?: number }) {
  const c = GRADE_COLORS[grade] || colors.onSurface2;
  return (
    <View testID={`grade-${grade}`} style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: c + "22",
      borderWidth: 1.5, borderColor: c, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c, fontFamily: font.displayBold, fontSize: size * 0.5 }}>{grade}</Text>
    </View>
  );
}

export function StatCard({ label, value, valueColor, sub, style, testID }:
  { label: string; value: string; valueColor?: string; sub?: string; style?: ViewStyle; testID?: string }) {
  return (
    <View testID={testID} style={[styles.stat, style]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={styles.statSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
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
    return `${x},${y}`;
  });
  const up = data[data.length - 1] >= data[0];
  const stroke = up ? colors.success : colors.error;
  const areaPts = `${pts.join(" ")} ${pad + (data.length - 1) * stepX},${height - pad} ${pad},${height - pad}`;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity="0.28" />
          <Stop offset="1" stopColor={stroke} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Line x1={pad} y1={height / 2} x2={width - pad} y2={height / 2} stroke={colors.divider} strokeWidth={1} />
      <Polygon points={areaPts} fill="url(#grad)" />
      <Polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stat: { backgroundColor: colors.surface2, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  statLabel: { color: colors.onSurface2, fontFamily: font.text, fontSize: fs.sm, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: spacing.xs },
  statValue: { color: colors.onSurface, fontFamily: font.displayBold, fontSize: fs["2xl"] },
  statSub: { color: colors.onSurface3, fontFamily: font.text, fontSize: fs.sm, marginTop: 2 },
});
