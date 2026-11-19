/**
 * Quote front (19 Nov 2026, owner: "Yes, build it"): MPP challenges minted WITHOUT mppx/server.
 *
 * Why: the front must start in milliseconds so router probes (Mercator times out at ~1.5 s) never hit a cold 15 MB
 * Worker. `mppx/server` pulls in viem and chain clients (a 4 MB front); `mppx` core's Challenge module alone is a 789 KB
 * front. The challenge it mints is the same as the server's:
 *   - realm = request host, method/intent/request/description as the core's route terms,
 *   - expires = issue time + 5 minutes,
 *   - meta = { _mppx_nonce: fresh 32 random bytes, _mppx_scope: path } (never cached: each challenge pays once),
 *   - id = HMAC-SHA256 over the canonical fields with the per-method secret the core derives from MPP_SECRET_KEY.
 * The core verifies a returning credential with Challenge.verify and the same secret, so a front challenge pays exactly
 * like a core challenge. tests/quote-front-challenges.test.cjs proves both properties against the real mppx server.
 */
import { Challenge } from "mppx";

export type MppMethod = "tempo" | "evm";
export const SIGNING_LABEL: Readonly<Record<MppMethod, string>> = Object.freeze({ tempo: "mpp-tempo-challenge-signing", evm: "mpp-evm-challenge-signing" });
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Route terms for one MPP method, as written into a quote template by the core. */
export interface MppTerms { method: MppMethod; intent: string; request: Record<string, unknown>; description?: string; scope: string }

/** The per-method HMAC secret, exactly as src/lib/mpp-tempo.ts and src/lib/mpp-evm.ts derive it (hex of HMAC-SHA256). */
export async function challengeSecretHex(rootSecret: string, method: MppMethod): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(rootSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(SIGNING_LABEL[method])));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The route terms of one serialized challenge, or undefined when it is not a tempo/evm challenge with a scope.
 * A deserialized challenge keeps its meta only as `opaque` (base64url JSON); Challenge.meta() reads it on some mppx
 * builds and returns undefined on others, so both are tried (a missing scope would mint challenges for the wrong route).
 */
export function termsOf(raw: string): MppTerms | undefined {
  const ch = Challenge.deserialize(raw) as unknown as { method: string; intent: string; request: Record<string, unknown>; description?: string; opaque?: string };
  if (ch.method !== "tempo" && ch.method !== "evm") return undefined;
  let meta = (Challenge.meta(ch as never) ?? undefined) as Record<string, string> | undefined;
  if (!meta && ch.opaque) {
    try { meta = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(ch.opaque.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (ch.opaque.length % 4)) % 4)), (c) => c.charCodeAt(0)))); } catch { meta = undefined; }
  }
  if (!meta?._mppx_scope) return undefined;
  return { method: ch.method, intent: ch.intent, request: ch.request, ...(ch.description ? { description: ch.description } : {}), scope: meta._mppx_scope };
}

/** A fresh, serialized WWW-Authenticate challenge for these terms on this realm. */
export function mintChallenge(terms: MppTerms, realm: string, secretHex: string, now = Date.now()): string {
  const challenge = Challenge.from({
    realm,
    method: terms.method,
    intent: terms.intent,
    request: terms.request,
    ...(terms.description ? { description: terms.description } : {}),
    expires: new Date(now + CHALLENGE_TTL_MS).toISOString(),
    meta: { _mppx_nonce: randomNonce(), _mppx_scope: terms.scope },
    secretKey: secretHex,
  } as never);
  return Challenge.serialize(challenge as never);
}
