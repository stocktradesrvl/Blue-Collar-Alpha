import React from "react";
import { Pressable, PressableProps, ViewStyle, StyleProp } from "react-native";
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
