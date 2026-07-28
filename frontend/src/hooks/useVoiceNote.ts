import { useState, useRef } from "react";
import { Platform, Linking } from "react-native";
import {
  useAudioRecorder,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { api } from "@/src/api";

type Toast = (msg: string, type?: "success" | "error" | "info") => void;

/**
 * Records a short voice note, transcribes it via the backend (Whisper), and
 * returns the text. Handles mic-permission states per the permissions contract.
 */
export function useVoiceNote(toast: Toast, summarize = false) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const askedOnce = useRef(false);

  const ensurePermission = async (): Promise<boolean> => {
    const cur = await AudioModule.getRecordingPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain) {
      const req = await AudioModule.requestRecordingPermissionsAsync();
      if (req.granted) return true;
      if (!req.canAskAgain) {
        toast("Enable microphone access in Settings to record voice notes.", "error");
        Linking.openSettings();
      }
      return false;
    }
    toast("Microphone is blocked. Enable it in Settings to record.", "error");
    Linking.openSettings();
    return false;
  };

  const start = async () => {
    if (recording || transcribing) return;
    if (!askedOnce.current) askedOnce.current = true;
    const ok = await ensurePermission();
    if (!ok) return;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e: any) {
      toast(e?.message || "Could not start recording", "error");
    }
  };

  // Stops recording, uploads for transcription, and returns the text (or null).
  const stop = async (): Promise<{ text: string; summary?: string | null } | null> => {
    if (!recording) return null;
    setRecording(false);
    setTranscribing(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording captured");
      const extMatch = /\.([a-zA-Z0-9]+)$/.exec(uri);
      const ext = (extMatch?.[1] || "m4a").toLowerCase();
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const r = await api.post("/coach/transcribe", { audio_base64: b64, ext, summarize });
      if (!r?.text) throw new Error("No speech detected");
      return { text: r.text, summary: r.summary };
    } catch (e: any) {
      toast(e?.message || "Could not transcribe voice note", "error");
      return null;
    } finally {
      setTranscribing(false);
    }
  };

  const cancel = async () => {
    if (recording) {
      try { await recorder.stop(); } catch {}
      setRecording(false);
    }
  };

  return { recording, transcribing, start, stop, cancel };
}
