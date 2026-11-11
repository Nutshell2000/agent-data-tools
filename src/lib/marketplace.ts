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

export type Marketplace = "rapidapi" | "fluxa" | "orthogonal";

/**
 * The credential an Orthogonal proxy call carries (11 Nov 2026, owner: "Yes, Orthogonal"). Orthogonal bills its own
 * buyers from their prepaid balance and pays us through Stripe, so the call reaches us with the credential we stored in
 * its seller dashboard instead of an x402 payment. Its dashboard decides how it is sent, so three places are read:
 * X-Orthogonal-Proxy-Secret, X-API-Key, or Authorization: Bearer. Our own prepaid keys (adt_…) and MPP credentials
 * (Authorization: Payment) are never taken for it; they keep their own paths.
 */
export function orthogonalSecret(header: (name: string) => string | undefined): string | undefined {
  const own = (v: string | undefined) => (v && !/^adt_/i.test(v) ? v : undefined);
  const named = header("x-orthogonal-proxy-secret")?.trim();
  if (named) return named;
  const apiKey = own(header("x-api-key")?.trim());
  if (apiKey) return apiKey;
  const auth = header("authorization")?.trim();
  return auth && /^Bearer\s+/i.test(auth) ? own(auth.replace(/^Bearer\s+/i, "").trim()) : undefined;
}

/**
 * The marketplace whose proxy sent this call, or false. FluxA's proxy (proxy-monetize.fluxapay.xyz) takes the buyer's
 * x402 payment itself, settles it to our wallet through its facilitator, and forwards the call with the static header
 * X-FluxA-Proxy-Secret we configured in its Studio (FLUXA_PROXY_SECRET, set 23 Oct 2026); RapidAPI sends
 * X-RapidAPI-Proxy-Secret. Either skips our paywall; neither is ever counted as our own x402 revenue.
 */
export function marketplaceOf(
  env: Pick<Env, "RAPIDAPI_PROXY_SECRET" | "FLUXA_PROXY_SECRET" | "ORTHOGONAL_PROXY_SECRET">,
  rapid: string | undefined,
  fluxa: string | undefined,
  orthogonal?: string,
): Marketplace | false {
  if (secretMatches(env.RAPIDAPI_PROXY_SECRET, rapid)) return "rapidapi";
  if (secretMatches(env.FLUXA_PROXY_SECRET, fluxa)) return "fluxa";
  if (secretMatches(env.ORTHOGONAL_PROXY_SECRET, orthogonal)) return "orthogonal";
  return false;
}
