import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { useEffect, useState } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/context/AuthContext";
import { ToastProvider } from "@/src/context/ToastContext";
import { colors } from "@/src/theme";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

function useAppFonts() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await Font.loadAsync({
          Rajdhani: "https://github.com/google/fonts/raw/main/ofl/rajdhani/Rajdhani-SemiBold.ttf",
          RajdhaniBold: "https://github.com/google/fonts/raw/main/ofl/rajdhani/Rajdhani-Bold.ttf",
          DMSans: "https://github.com/google/fonts/raw/main/ofl/dmsans/DMSans%5Bopsz,wght%5D.ttf",
        });
      } catch (e) {
        // Non-blocking: fall back to system fonts if CDN unreachable.
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
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
      <Stack.Screen name="upload" options={{ presentation: "modal" }} />
      <Stack.Screen name="analyze" options={{ presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const fontsDone = useAppFonts();

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
