import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { storage } from "@/src/utils/storage";

const MUTE_KEY = "tm_sound_muted";

const SOURCES: Record<string, any> = {
  win: require("@/assets/sounds/win.wav"),
  refresh: require("@/assets/sounds/refresh.wav"),
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

export function playSound(name: "win" | "refresh") {
  if (muted) return;
  const p = players[name];
  if (!p) return;
  try { p.seekTo(0); p.play(); } catch { /* no-op */ }
}
