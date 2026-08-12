import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api } from "@/src/api";

/**
 * Starts a Stripe checkout for a paid tier and verifies the result server-side.
 * `offer: "trial"` applies the keep-Premium first-month discount for converting
 * trial users. Returns whether the subscription was confirmed paid.
 */
export async function startCheckout(tier: string, offer?: "trial"): Promise<{ paid: boolean }> {
  const returnUrl = Linking.createURL("payment-complete");
  const { checkout_url, session_id } = await api.post("/payments/create-checkout-session", {
    tier, origin: process.env.EXPO_PUBLIC_BACKEND_URL, return_url: returnUrl, offer,
  });
  const res = await WebBrowser.openAuthSessionAsync(checkout_url, returnUrl);
  if (res.type === "success" && res.url) {
    const parsed = Linking.parse(res.url);
    if (parsed.queryParams?.status === "cancel") return { paid: false };
    const r = await api.get(`/payments/status?session_id=${session_id}`);
    return { paid: !!r.paid };
  }
  const r = await api.get(`/payments/status?session_id=${session_id}`).catch(() => null);
  return { paid: !!r?.paid };
}
