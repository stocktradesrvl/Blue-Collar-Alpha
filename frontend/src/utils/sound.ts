import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { storage } from "@/src/utils/storage";

const MUTE_KEY = "tm_sound_muted";

const SOURCES: Record<string, any> = {
  chaching: require("@/assets/sounds/chaching.wav"),
  coin: require("@/assets/sounds/coin.wav"),
  refresh: require("@/assets/sounds/refresh.wav"),
};

// Candidate sounds for the in-app Sound Lab (auditioning). Loaded lazily.
const LAB_SOURCES: Record<string, any> = {
  cash_a: require("@/assets/sounds/lab/cash_a.wav"),
  cash_b: require("@/assets/sounds/lab/cash_b.wav"),
  cash_c: require("@/assets/sounds/lab/cash_c.wav"),
  coin_a: require("@/assets/sounds/lab/coin_a.wav"),
  coin_b: require("@/assets/sounds/lab/coin_b.wav"),
  coin_c: require("@/assets/sounds/lab/coin_c.wav"),
  refresh_a: require("@/assets/sounds/lab/refresh_a.wav"),
  refresh_b: require("@/assets/sounds/lab/refresh_b.wav"),
  refresh_c: require("@/assets/sounds/lab/refresh_c.wav"),
};

let muted = false;
let ready = false;
const players: Record<string, AudioPlayer> = {};

export async function initSound() {
  if (ready) return;
  ready = true;
  try {
    muted = (await storage.getItem<boolean>(MUTE_KEY, false)) === true;
  } catch { /* no-op */ }
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch { /* no-op */ }
  for (const key of Object.keys(SOURCES)) {
    try { players[key] = createAudioPlayer(SOURCES[key]); } catch { /* no-op */ }
  }
}

export function isSoundMuted() {
  return muted;
}

export async function setSoundMuted(value: boolean) {
  muted = value;
  try { await storage.setItem(MUTE_KEY, value); } catch { /* no-op */ }
}

export function playSound(name: "chaching" | "coin" | "refresh") {
  if (muted) return;
  const p = players[name];
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
