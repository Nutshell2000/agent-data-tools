import type { Env } from "./env";

/** True when `sent` equals one of the comma-separated secrets (at least 16 characters each), compared in constant time. */
function secretMatches(list: string | undefined, sent: string | undefined): boolean {
  if (!list || !sent) return false;
  let match = false;
  for (const secret of list.split(",").map((s) => s.trim())) {
    if (secret.length < 16 || sent.length !== secret.length) continue;
    // Compare every character so the time taken does not reveal how much matched.
    let diff = 0;
    for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ sent.charCodeAt(i);
    if (diff === 0) match = true;
  }
  return match;
}

/**
 * True for a call that came through RapidAPI's proxy. Those callers pay RapidAPI, which
 * pays us, so they skip the x402 paywall. Off until the secret is configured.
 * Each RapidAPI listing has its own proxy secret, so RAPIDAPI_PROXY_SECRET holds one or more
 * secrets separated by commas; the header must equal one of them exactly.
 */
export function viaMarketplace(env: Pick<Env, "RAPIDAPI_PROXY_SECRET">, sent: string | undefined): boolean {
  return secretMatches(env.RAPIDAPI_PROXY_SECRET, sent);
}

export type Marketplace = "rapidapi" | "fluxa";

/**
 * The marketplace whose proxy sent this call, or false. FluxA's proxy (proxy-monetize.fluxapay.xyz) takes the buyer's
 * x402 payment itself, settles it to our wallet through its facilitator, and forwards the call with the static header
 * X-FluxA-Proxy-Secret we configured in its Studio (FLUXA_PROXY_SECRET, set 23 Oct 2026); RapidAPI sends
 * X-RapidAPI-Proxy-Secret. Either skips our paywall; neither is ever counted as our own x402 revenue.
 */
export function marketplaceOf(env: Pick<Env, "RAPIDAPI_PROXY_SECRET" | "FLUXA_PROXY_SECRET">, rapid: string | undefined, fluxa: string | undefined): Marketplace | false {
  if (secretMatches(env.RAPIDAPI_PROXY_SECRET, rapid)) return "rapidapi";
  if (secretMatches(env.FLUXA_PROXY_SECRET, fluxa)) return "fluxa";
  return false;
}
