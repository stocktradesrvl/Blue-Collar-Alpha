import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import * as FileSystem from "expo-file-system/legacy";
import { useShareIntentContext } from "@/src/context/ShareIntentContext";
import { useAuth } from "@/src/context/AuthContext";

/**
 * Listens for images shared into the app from Android's share sheet (or iOS share
 * extension) and routes them into the Coach section for AI analysis. Renders nothing.
 */
export default function ShareIntentHandler() {
  const router = useRouter();
  const { user } = useAuth();
  const { setPending } = useShareIntentContext();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: true, disabled: Platform.OS === "web" });
  const handling = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || handling.current) return;
    const file = (shareIntent?.files || []).find((f: any) => (f?.mimeType || "").startsWith("image/")) || shareIntent?.files?.[0];
    if (!file?.path) return;
    handling.current = true;
    (async () => {
      try {
        const uri = file.path.startsWith("file://") || file.path.startsWith("content://") ? file.path : `file://${file.path}`;
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        setPending({ base64 });
        if (user) router.replace("/(tabs)/coach");
        else router.replace("/(auth)/login");
      } catch (e) {
        // ignore unreadable shares
      } finally {
        resetShareIntent();
        handling.current = false;
      }
    })();
  }, [hasShareIntent, shareIntent, user, router, setPending, resetShareIntent]);

  return null;
}
