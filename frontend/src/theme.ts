export const colors = {
  surface: "#0D1117",
  onSurface: "#F0F6FC",
  surface2: "#161B22",
  onSurface2: "#C9D1D9",
  surface3: "#21262D",
  onSurface3: "#8B949E",
  brand: "#2E76E8",
  brandPrimary: "#1E5FBF",
  onBrand: "#FFFFFF",
  brandTint: "rgba(46,118,232,0.16)",
  accent: "#FF7F00",
  accentTint: "rgba(255,127,0,0.16)",
  onAccent: "#1A0E00",
  success: "#00E676",
  error: "#FF3D00",
  warning: "#FFB300",
  border: "#2A313C",
  borderStrong: "#1E5FBF",
  divider: "#21262D",
};

// Vivid gradient tokens (use with expo-linear-gradient)
export const gradients = {
  brand: ["#2E76E8", "#0A4DA0"] as const,
  accent: ["#FFA23D", "#FF7F00"] as const,
  navyGlow: ["rgba(46,118,232,0.30)", "rgba(46,118,232,0.04)"] as const,
  accentGlow: ["rgba(255,127,0,0.28)", "rgba(255,127,0,0.03)"] as const,
  card: ["#1B2431", "#12171F"] as const,
  heroScrim: ["rgba(13,17,23,0.15)", "rgba(13,17,23,0.72)", "#0D1117"] as const,
  success: ["#00E676", "#00A050"] as const,
  error: ["#FF6A3D", "#FF3D00"] as const,
};

// Colored glow shadow (iOS shadow + Android elevation)
export function glow(color: string, intensity = 0.45) {
  return { shadowColor: color, shadowOpacity: intensity, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10 };
}
export const cardShadow = { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

export const font = {
  display: "Rajdhani",
  displayBold: "RajdhaniBold",
  text: "DMSans",
};

export const fs = { sm: 12, base: 14, lg: 16, xl: 20, "2xl": 24, "3xl": 32 };

export const GRADE_COLORS: Record<string, string> = {
  A: "#00E676", B: "#8BC34A", C: "#FFC400", D: "#FF9800", F: "#FF3D00",
};

export function pnlColor(v: number) {
  return v > 0 ? colors.success : v < 0 ? colors.error : colors.onSurface2;
}
export function money(v: number) {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
