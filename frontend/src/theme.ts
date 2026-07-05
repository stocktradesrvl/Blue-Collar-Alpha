export const colors = {
  surface: "#121212",
  onSurface: "#FFFFFF",
  surface2: "#1E1E1E",
  onSurface2: "#A3A3A3",
  surface3: "#2C2C2C",
  onSurface3: "#808080",
  brand: "#FFB74D",
  brandPrimary: "#FF9800",
  onBrand: "#000000",
  brandTint: "rgba(255,183,77,0.12)",
  success: "#00E676",
  error: "#FF3D00",
  warning: "#FFC400",
  border: "#333333",
  borderStrong: "#4D4D4D",
  divider: "#292929",
};

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
