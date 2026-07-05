import { storage } from "@/src/utils/storage";

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;
const TOKEN_KEY = "tm_token";

async function req(path: string, method: string = "GET", body?: any) {
  const token = await storage.secureGet<string>(TOKEN_KEY, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = (data && data.detail) || "Request failed";
    const err: any = new Error(typeof detail === "string" ? detail : "Request failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (p: string) => req(p, "GET"),
  post: (p: string, b?: any) => req(p, "POST", b),
  put: (p: string, b?: any) => req(p, "PUT", b),
  del: (p: string) => req(p, "DELETE"),
  setToken: (t: string) => storage.secureSet(TOKEN_KEY, t),
  clearToken: () => storage.secureRemove(TOKEN_KEY),
  getToken: () => storage.secureGet<string>(TOKEN_KEY, ""),
};
