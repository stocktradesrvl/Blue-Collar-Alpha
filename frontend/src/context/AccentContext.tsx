import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { storage } from "@/src/utils/storage";

// Independent accent-color theming. Only the accent family is dynamic;
// surface/brand colors stay fixed (see src/theme.ts).
export const ACCENT_KEY = "tm_accent";

export type AccentId = "orange" | "gold" | "green" | "blue" | "purple";

export type AccentTheme = {
  id: AccentId;
  label: string;
  accent: string;
  accentLight: string;
  accentTint: string;
  onAccent: string;
  gradient: readonly [string, string];
  gradientGlow: readonly [string, string];
};

function tint(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function make(id: AccentId, label: string, main: string, light: string, onAccent: string): AccentTheme {
  return {
    id,
    label,
    accent: main,
    accentLight: light,
    accentTint: tint(main, 0.16),
    onAccent,
    gradient: [light, main] as const,
    gradientGlow: [tint(main, 0.28), tint(main, 0.03)] as const,
  };
}

export const ACCENTS: Record<AccentId, AccentTheme> = {
  orange: make("orange", "Orange", "#FF7F00", "#FFA23D", "#1A0E00"),
  gold: make("gold", "Gold", "#F5B301", "#FFD24D", "#1A1400"),
  green: make("green", "Green", "#00C853", "#4AE27E", "#04210F"),
  blue: make("blue", "Blue", "#2E76E8", "#5B9BFF", "#FFFFFF"),
  purple: make("purple", "Purple", "#8B5CF6", "#B18BFF", "#FFFFFF"),
};

export const ACCENT_LIST: AccentTheme[] = [
  ACCENTS.orange, ACCENTS.gold, ACCENTS.green, ACCENTS.blue, ACCENTS.purple,
];

const DEFAULT_ID: AccentId = "orange";

type Ctx = { theme: AccentTheme; accentId: AccentId; setAccentId: (id: AccentId) => void };
const AccentContext = createContext<Ctx>({ theme: ACCENTS[DEFAULT_ID], accentId: DEFAULT_ID, setAccentId: () => {} });

export function AccentProvider({ children }: { children: React.ReactNode }) {
  const [accentId, setId] = useState<AccentId>(DEFAULT_ID);

  useEffect(() => {
    storage.getItem<AccentId>(ACCENT_KEY, DEFAULT_ID).then((v) => {
      if (v && ACCENTS[v]) setId(v);
    });
  }, []);

  const setAccentId = useCallback((id: AccentId) => {
    setId(id);
    storage.setItem(ACCENT_KEY, id);
  }, []);

  const theme = ACCENTS[accentId] || ACCENTS[DEFAULT_ID];
  return <AccentContext.Provider value={{ theme, accentId, setAccentId }}>{children}</AccentContext.Provider>;
}

export function useAccent() {
  return useContext(AccentContext);
}
