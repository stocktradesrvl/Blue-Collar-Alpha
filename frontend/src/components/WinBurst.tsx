import React from "react";
import { StyleSheet, View, Text, useWindowDimensions } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, FadeInDown, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, font, fs, glow } from "@/src/theme";

const PIECE_COLORS = ["#00E676", "#FF7F00", "#FFD54F", "#2E76E8", "#FFFFFF"];
const COUNT = 22;

function Piece({ index, width }: { index: number; width: number }) {
  const p = React.useMemo(() => ({
    left: width / 2 + (Math.random() - 0.5) * 60,
    dx: (Math.random() - 0.5) * width * 0.95,
    dy: 320 + Math.random() * 420,
    w: 6 + Math.random() * 7,
    h: 8 + Math.random() * 8,
    color: PIECE_COLORS[index % PIECE_COLORS.length],
    rot: (Math.random() - 0.5) * 900,
    delay: Math.random() * 140,
    dur: 1300 + Math.random() * 600,
  }), [index, width]);

  const t = useSharedValue(0);
  React.useEffect(() => {
    t.value = withDelay(p.delay, withTiming(1, { duration: p.dur, easing: Easing.out(Easing.quad) }));
  }, [t, p.delay, p.dur]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: p.dx * t.value },
      { translateY: -40 + p.dy * t.value },
      { rotate: `${p.rot * t.value}deg` },
    ],
    opacity: t.value < 0.7 ? 1 : Math.max(0, 1 - (t.value - 0.7) / 0.3),
  }));

  return <Animated.View style={[{ position: "absolute", top: 80, left: p.left, width: p.w, height: p.h, borderRadius: 1.5, backgroundColor: p.color }, style]} />;
}

export function WinBurst({ visible }: { visible: boolean }) {
  const { width } = useWindowDimensions();
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      setShow(true);
      const timer = setTimeout(() => setShow(false), 2600);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!show) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: COUNT }).map((_, i) => <Piece key={i} index={i} width={width} />)}
      <Animated.View entering={FadeInDown.duration(350)} exiting={FadeOut.duration(400)} style={[styles.banner, { top: 90 }]}>
        <Text style={styles.bannerTxt}>🎉  Big Win!</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute", alignSelf: "center", backgroundColor: colors.success,
    borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, ...glow(colors.success, 0.6),
  },
  bannerTxt: { color: "#00230F", fontFamily: font.displayBold, fontSize: fs.lg, letterSpacing: 0.5 },
});
