import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { colors, font, radius, spacing, fs } from "@/src/theme";

type Toast = { msg: string; type: "success" | "error" | "info" };
const Ctx = createContext<(msg: string, type?: Toast["type"]) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  const show = useCallback((msg: string, type: Toast["type"] = "info") => {
    setToast({ msg, type });
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setToast(null));
    }, 2800);
  }, [opacity]);

  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <Animated.View style={[styles.wrap, { opacity }]} pointerEvents="none" testID="toast">
          <View style={[styles.toast, { borderLeftColor: toast.type === "error" ? colors.error : toast.type === "success" ? colors.success : colors.brand }]}>
            <Text style={styles.txt}>{toast.msg}</Text>
          </View>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 60, left: 0, right: 0, alignItems: "center", zIndex: 9999 },
  toast: { backgroundColor: colors.surface3, borderLeftWidth: 3, borderRadius: radius.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg, maxWidth: "90%" },
  txt: { color: colors.onSurface, fontFamily: font.text, fontSize: fs.base },
});
