import React from "react";
import { Pressable, PressableProps, ViewStyle, StyleProp, Text, TextStyle, TextProps } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = PressableProps & { scaleTo?: number; style?: StyleProp<ViewStyle> };

// Pressable that gently scales down on press for a premium, tactile feel.
export function PressableScale({ children, style, onPressIn, onPressOut, scaleTo = 0.96, ...rest }: Props) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const spring = { damping: 16, stiffness: 320, mass: 0.5 };
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => { scale.value = withSpring(scaleTo, spring); onPressIn?.(e); }}
      onPressOut={(e) => { scale.value = withSpring(1, spring); onPressOut?.(e); }}
      style={[animStyle, style]}
    >
      {children}
    </AnimatedPressable>
  );
}

// Animates a number from 0 up to `value` on mount / when value changes.
function useCountUp(value: number, duration = 1000) {
  const [display, setDisplay] = React.useState(0);
  React.useEffect(() => {
    let raf: number;
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}

export function CountUpText({ value, style, format, duration = 1000, testID, ...rest }:
  { value: number; style?: StyleProp<TextStyle>; format: (n: number) => string; duration?: number; testID?: string } & TextProps) {
  const n = useCountUp(value, duration);
  return <Text testID={testID} style={style} {...rest}>{format(n)}</Text>;
}

