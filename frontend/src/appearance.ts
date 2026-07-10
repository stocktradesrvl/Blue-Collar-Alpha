// Dashboard backdrop personalization.
export const BACKDROP_KEY = "tm_dash_backdrop";
export type BackdropId = "cash" | "gold" | "charts";

export const BACKDROPS: { id: BackdropId; label: string; icon: string; source: any }[] = [
  { id: "cash", label: "Cash", icon: "cash", source: require("@/assets/images/usd100.jpg") },
  { id: "gold", label: "Gold Bars", icon: "diamond", source: require("@/assets/images/gold-bg.jpg") },
  { id: "charts", label: "Charts", icon: "stats-chart", source: require("@/assets/images/dashboard-texture.jpg") },
];

export function backdropSource(id?: string | null) {
  return (BACKDROPS.find((b) => b.id === id) || BACKDROPS[0]).source;
}
