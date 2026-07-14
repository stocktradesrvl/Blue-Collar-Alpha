import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { storage } from "@/src/utils/storage";

const MUTE_KEY = "tm_sound_muted";
const SELECT_KEY = "tm_sound_select";

// Category → default lab key. These real recordings replace the old sounds.
export type SoundCategory = "bigwin" | "coin" | "refresh";
const DEFAULT_SELECT: Record<SoundCategory, string> = {
  bigwin: "bigwin_a",
  coin: "coin_a",
  refresh: "refresh_a",
};
// Legacy playSound names → category.
const CATEGORY_OF: Record<string, SoundCategory> = {
  chaching: "bigwin",
  coin: "coin",
  refresh: "refresh",
};

const SOURCES: Record<string, any> = {
  chaching: require("@/assets/sounds/chaching.wav"),
  coin: require("@/assets/sounds/coin.wav"),
  refresh: require("@/assets/sounds/refresh.wav"),
};

// Candidate sounds for the in-app Sound Lab (auditioning). Real recordings.
const LAB_SOURCES: Record<string, any> = {
  bigwin_a: require("@/assets/sounds/lab/bigwin_a.mp3"),
  bigwin_b: require("@/assets/sounds/lab/bigwin_b.mp3"),
  bigwin_c: require("@/assets/sounds/lab/bigwin_c.mp3"),
  coin_a: require("@/assets/sounds/lab/coin_a2.mp3"),
  coin_b: require("@/assets/sounds/lab/coin_b2.mp3"),
  coin_c: require("@/assets/sounds/lab/coin_c2.mp3"),
  refresh_a: require("@/assets/sounds/lab/refresh_a2.mp3"),
  refresh_b: require("@/assets/sounds/lab/refresh_b2.mp3"),
  refresh_c: require("@/assets/sounds/lab/refresh_c2.mp3"),
};

let muted = false;
let ready = false;
let selected: Record<SoundCategory, string> = { ...DEFAULT_SELECT };
const players: Record<string, AudioPlayer> = {};

function getPlayer(key: string, src: any): AudioPlayer | null {
  if (!src) return null;
  if (!players[key]) {
    try { players[key] = createAudioPlayer(src); } catch { return null; }
  }
  return players[key] || null;
}

export async function initSound() {
  if (ready) return;
  ready = true;
  try {
    muted = (await storage.getItem<boolean>(MUTE_KEY, false)) === true;
  } catch { /* no-op */ }
  try {
    const s = await storage.getItem<Record<string, string>>(SELECT_KEY, null as any);
    if (s && typeof s === "object") selected = { ...DEFAULT_SELECT, ...s };
  } catch { /* no-op */ }
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch { /* no-op */ }
  // Pre-warm the selected players.
  (Object.keys(selected) as SoundCategory[]).forEach((cat) => {
    getPlayer(selected[cat], LAB_SOURCES[selected[cat]]);
  });
}

export function isSoundMuted() {
  return muted;
}

export async function setSoundMuted(value: boolean) {
  muted = value;
  try { await storage.setItem(MUTE_KEY, value); } catch { /* no-op */ }
}

export function getSelectedSounds(): Record<SoundCategory, string> {
  return { ...selected };
}

export async function selectSound(category: SoundCategory, key: string) {
  if (!LAB_SOURCES[key]) return;
  selected = { ...selected, [category]: key };
  getPlayer(key, LAB_SOURCES[key]); // pre-warm
  try { await storage.setItem(SELECT_KEY, selected); } catch { /* no-op */ }
}

export function playSound(name: "chaching" | "coin" | "refresh") {
  if (muted) return;
  const cat = CATEGORY_OF[name] || "bigwin";
  const key = selected[cat];
  const src = LAB_SOURCES[key] || SOURCES[name];
  const p = getPlayer(key || name, src);
  if (!p) return;
  try { p.seekTo(0); p.play(); } catch { /* no-op */ }
}

// Audition a candidate sound in the Sound Lab. Plays regardless of mute so
// the user can always hear it while picking.
let labPlayer: AudioPlayer | null = null;
export async function previewSound(key: string) {
  const src = LAB_SOURCES[key];
  if (!src) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch { /* no-op */ }
  try {
    if (labPlayer) { labPlayer.remove(); labPlayer = null; }
    labPlayer = createAudioPlayer(src);
    labPlayer.seekTo(0);
    labPlayer.play();
  } catch { /* no-op */ }
}
