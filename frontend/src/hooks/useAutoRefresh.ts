import { useCallback, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

/**
 * Independently keeps a screen's data fresh:
 *  - loads immediately when the screen gains focus
 *  - re-loads on a timer while the screen is focused
 *  - re-loads when the app returns to the foreground
 *  - stops polling when the screen blurs / unmounts
 *
 * Each screen owns its own loader, so no screen depends on another to update.
 */
export function useAutoRefresh(load: () => void | Promise<void>, intervalMs = 30000) {
  const savedLoad = useRef(load);
  savedLoad.current = load;
  const focused = useRef(false);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      savedLoad.current();
      const id = setInterval(() => {
        if (focused.current) savedLoad.current();
      }, intervalMs);
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active" && focused.current) savedLoad.current();
      });
      return () => {
        focused.current = false;
        clearInterval(id);
        sub.remove();
      };
    }, [intervalMs])
  );
}
