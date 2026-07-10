import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { useEffect, useState } from "react";
import { LogBox, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/context/AuthContext";
import { ToastProvider } from "@/src/context/ToastContext";
import { colors } from "@/src/theme";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

// Anchor the stack to index so any deep-linked/restored route always has a
// home to return to (prevents getting stuck on a screen with no back target).
export const unstable_settings = { initialRouteName: "index" };

function useAppFonts() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await Font.loadAsync({
          Rajdhani: require("../assets/fonts/Rajdhani-SemiBold.ttf"),
          RajdhaniBold: require("../assets/fonts/Rajdhani-Bold.ttf"),
          DMSans: require("../assets/fonts/DMSans.ttf"),
        });
      } catch (e) {
        // Non-blocking: fall back to system fonts if load fails.
      } finally {
        setDone(true);
      }
    })();
  }, []);
  return done;
}

function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "(auth)";
    if (!user && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (user && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [user, loading, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const fontsDone = useAppFonts();

  // Immersive full-screen: hide the Android system navigation bar.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    (async () => {
      try {
        await NavigationBar.setVisibilityAsync("hidden");
        await NavigationBar.setBehaviorAsync("overlay-swipe");
      } catch { /* no-op */ }
    })();
  }, []);

  useEffect(() => {
    if ((loaded || error) && fontsDone) SplashScreen.hideAsync();
  }, [loaded, error, fontsDone]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ToastProvider>
            <StatusBar style="light" />
            <RootNavigator />
          </ToastProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
