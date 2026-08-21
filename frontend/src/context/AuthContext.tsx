import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/src/api";

type User = { id: string; email: string; subscription_tier: "free" | "pro" | "premium"; raw_tier?: "free" | "pro" | "premium"; account_balance: number; referral_code?: string; bonus_trades?: number; referral_count?: number; reward_pro_until?: string | null; trial_premium_until?: string | null; trial_used?: boolean; discord_id?: string | null; discord_username?: string | null; daily_loss_limit?: number; weekly_digest_enabled?: boolean; discord_share_wins?: boolean; leaderboard_optin?: boolean };
type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  register: (email: string, password: string, referral_code?: string) => Promise<void>;
  logout: () => Promise<void>;
  setTier: (tier: string) => Promise<void>;
  setBalance: (balance: number) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    const token = await api.getToken();
    if (token) {
      try { setUser(await api.get("/auth/me")); }
      catch { await api.clearToken(); setUser(null); }
    }
    setLoading(false);
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const login = async (email: string, password: string) => {
    const r = await api.post("/auth/login", { email, password });
    await api.setToken(r.access_token);
    setUser(r.user);
  };
  const loginWithToken = async (token: string) => {
    await api.setToken(token);
    setUser(await api.get("/auth/me"));
  };
  const register = async (email: string, password: string, referral_code?: string) => {
    const r = await api.post("/auth/register", { email, password, referral_code });
    await api.setToken(r.access_token);
    setUser(r.user);
  };
  const logout = async () => { await api.clearToken(); setUser(null); };
  const setTier = async (tier: string) => { setUser(await api.post("/auth/tier", { tier })); };
  const setBalance = async (balance: number) => { setUser(await api.post("/user/balance", { balance })); };
  const changePassword = async (current: string, next: string) => {
    await api.post("/auth/change-password", { current_password: current, new_password: next });
  };
  const refresh = async () => { try { setUser(await api.get("/auth/me")); } catch {} };

  return <Ctx.Provider value={{ user, loading, login, loginWithToken, register, logout, setTier, setBalance, changePassword, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
}
