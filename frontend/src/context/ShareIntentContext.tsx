import React, { createContext, useContext, useState, useCallback } from "react";

export type PendingShare = { base64: string; note?: string } | null;

type Ctx = {
  pending: PendingShare;
  setPending: (p: PendingShare) => void;
  clear: () => void;
};

const ShareIntentContext = createContext<Ctx | null>(null);

export function ShareIntentProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingShare>(null);
  const clear = useCallback(() => setPending(null), []);
  return (
    <ShareIntentContext.Provider value={{ pending, setPending, clear }}>
      {children}
    </ShareIntentContext.Provider>
  );
}

export function useShareIntentContext() {
  const c = useContext(ShareIntentContext);
  if (!c) throw new Error("useShareIntentContext must be used within ShareIntentProvider");
  return c;
}
