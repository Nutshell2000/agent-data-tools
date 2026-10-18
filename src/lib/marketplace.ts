import type { Env } from "./env";

/**
 * True for a call that came through RapidAPI's proxy. Those callers pay RapidAPI, which
 * pays us, so they skip the x402 paywall. Off until the secret is configured.
 * Each RapidAPI listing has its own proxy secret, so RAPIDAPI_PROXY_SECRET holds one or more
 * secrets separated by commas; the header must equal one of them exactly.
 */
export function viaMarketplace(env: Pick<Env, "RAPIDAPI_PROXY_SECRET">, sent: string | undefined): boolean {
  if (!env.RAPIDAPI_PROXY_SECRET || !sent) return false;
  let match = false;
  for (const secret of env.RAPIDAPI_PROXY_SECRET.split(",").map((s) => s.trim())) {
    if (secret.length < 16 || sent.length !== secret.length) continue;
    // Compare every character so the time taken does not reveal how much matched.
    let diff = 0;
    for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ sent.charCodeAt(i);
    if (diff === 0) match = true;
  }
  return match;
}
