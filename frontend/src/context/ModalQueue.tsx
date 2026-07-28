import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Coordinates the login/first-open modals so only ONE shows at a time.
 * Modals register with a priority (lower number = higher priority) when they
 * want to be shown; the queue exposes which key is currently "active" and each
 * modal renders only while it is the active one. On dismiss, the next in line
 * is promoted automatically.
 */
type Entry = { key: string; priority: number };

type Ctx = {
  request: (key: string, priority: number) => void;
  release: (key: string) => void;
  activeKey: string | null;
};

const ModalQueueContext = createContext<Ctx | null>(null);

export function ModalQueueProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  const request = useCallback((key: string, priority: number) => {
    setEntries((prev) => (prev.some((e) => e.key === key) ? prev : [...prev, { key, priority }]));
  }, []);

  const release = useCallback((key: string) => {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  }, []);

  const activeKey = useMemo(() => {
    if (entries.length === 0) return null;
    return [...entries].sort((a, b) => a.priority - b.priority)[0].key;
  }, [entries]);

  const value = useMemo(() => ({ request, release, activeKey }), [request, release, activeKey]);

  return <ModalQueueContext.Provider value={value}>{children}</ModalQueueContext.Provider>;
}

/**
 * Hook for a queued modal. When `wantsToShow` becomes true the modal enters the
 * queue; `isActive` is true only while it is first in line. Returns `dismiss`
 * which should be called from the modal's close handler to advance the queue.
 */
export function useModalSlot(key: string, priority: number, wantsToShow: boolean) {
  const ctx = useContext(ModalQueueContext);
  if (!ctx) throw new Error("useModalSlot must be used within ModalQueueProvider");
  const { request, release, activeKey } = ctx;
  const requested = useRef(false);

  useEffect(() => {
    if (wantsToShow && !requested.current) {
      requested.current = true;
      request(key, priority);
    }
  }, [wantsToShow, key, priority, request]);

  const dismiss = useCallback(() => {
    requested.current = false;
    release(key);
  }, [key, release]);

  // Clean up if the component unmounts while queued.
  useEffect(() => () => release(key), [key, release]);

  return { isActive: activeKey === key, dismiss };
}
