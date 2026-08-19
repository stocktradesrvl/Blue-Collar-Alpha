import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

let configured = false;

/** Show notifications even while the app is foregrounded, and set up the Android channel. */
export async function configureNotifications() {
  if (Platform.OS === "web" || configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync("trades", {
        name: "Trade captures",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 150, 80, 150],
        lightColor: "#2E76E8",
      });
    } catch { /* no-op */ }
  }
}

/**
 * Contextual permission request following the permissions contract: check first,
 * only ask when we can, never dead-end. Returns whether we can post notifications.
 */
export async function ensureNotifPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain === false) return false;
    const res = await Notifications.requestPermissionsAsync();
    return !!res.granted;
  } catch {
    return false;
  }
}

/** Fire a local notification immediately (no server, no keys needed). */
export async function notifyLocal(title: string, body: string, data: Record<string, any> = {}) {
  if (Platform.OS === "web") return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: true },
      trigger: Platform.OS === "android" ? ({ channelId: "trades" } as any) : null,
    });
  } catch { /* no-op */ }
}
