import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import type { AudioPlayer } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

/**
 * Fetches spoken audio for a piece of text from the backend (OpenAI TTS) and
 * plays it back. `id` lets a screen track which item is currently speaking so it
 * can show a playing/loading state per bubble.
 */
export function useSpeak(toast?: Toast) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const teardown = () => {
    try { playerRef.current?.remove(); } catch {}
    playerRef.current = null;
  };
  useEffect(() => () => teardown(), []);

  const stop = () => {
    try { playerRef.current?.pause(); } catch {}
    teardown();
    setPlayingId(null);
  };

  const speak = async (id: string, text: string) => {
    if (playingId === id || loadingId === id) { stop(); return; }
    stop();
    setLoadingId(id);
    try {
      const r = await api.post("/coach/speak", { text });
      const b64 = r?.audio_base64;
      if (!b64) throw new Error("No audio returned");
      let source: string;
      if (Platform.OS === "web") {
        source = `data:${r.mime || "audio/mpeg"};base64,${b64}`;
      } else {
        const path = `${FileSystem.cacheDirectory}coach-speak-${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
        source = path;
      }
      try { await setAudioModeAsync({ playsInSilentMode: true }); } catch {}
      const player = createAudioPlayer(source);
      playerRef.current = player;
      player.addListener("playbackStatusUpdate", (s: any) => {
        if (s?.didJustFinish) { setPlayingId(null); teardown(); }
      });
      player.play();
      setPlayingId(id);
    } catch (e: any) {
      toast?.(e?.message || "Could not play audio", "error");
    } finally {
      setLoadingId(null);
    }
  };

  return { speak, stop, loadingId, playingId };
}
