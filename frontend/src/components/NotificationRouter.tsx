import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { configureNotifications } from "@/src/utils/notifications";

/**
 * Handles taps on our local notifications: when the user taps a "trade captured"
 * alert, take them to the route it carries (the Coach). Renders nothing.
 */
export default function NotificationRouter() {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === "web") return;
    configureNotifications();
    const go = (resp: any) => {
      const route = resp?.notification?.request?.content?.data?.route;
      if (route) setTimeout(() => router.push(route), 350);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    // Cold start: the app was launched by tapping a notification.
    Notifications.getLastNotificationResponseAsync().then((r) => { if (r) go(r); }).catch(() => {});
    return () => sub.remove();
  }, [router]);
  return null;
}
