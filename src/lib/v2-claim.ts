// One signed x402 v2 payment runs one tool call at a time (safety audit of 21 Nov 2026, finding D1).
//
// The x402 library verifies a payment, runs the tool, then settles. Verification does not notice that the same signed
// payment is already being used, so one $0.01 signature sent 500 times at once ran the tool 500 times and settled once:
// 499 answers were withheld, but their cost (search, AI, browser, upstream quotas) was spent, and the day's capacity
// could be used up so that paying buyers got 503. The v1 path and both MPP paths already claim the payment before the
// tool runs; this does the same for v2.
//
// The claim is released when nothing was settled (the payment was refused, the tool failed, settlement failed), so an
// honest retry of the same payment after a failure runs again. It is kept after a settlement: the chain refuses that
// payment from then on anyway.
//
// When the claim cannot be recorded (storage unavailable) the payment goes on WITHOUT a claim. That is deliberate: a
// storage hiccup must not turn a paying buyer's call into an error, and the cost of the gap is what it was before.
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { Env } from "./env";

export interface V2Claim {
  /** True when this payment is already being used by another request. */
  taken: boolean;
  /** Frees the claim; call it when nothing was settled. Never throws. */
  release: () => Promise<void>;
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The claim key of a v2 payment: its network and its signed payload, hashed. Undefined when the header is not a payment. */
export async function v2ClaimKey(header: string | null | undefined): Promise<{ key: string; expires: number } | undefined> {
  if (!header) return undefined;
  let p: { accepted?: { network?: unknown }; payload?: unknown };
  try { p = decodePaymentSignatureHeader(header) as never; } catch { return undefined; }
  if (!p?.payload || typeof p.payload !== "object") return undefined;
  const now = Date.now();
  // An EVM authorization says until when it is valid; the claim never outlives it, nor ten minutes.
  const validBefore = Number((p.payload as { authorization?: { validBefore?: unknown } }).authorization?.validBefore);
  const expires = Math.min(Number.isFinite(validBefore) && validBefore > 0 ? validBefore * 1000 : Infinity, now + 600_000);
  if (!(expires > now)) return undefined; // expired: the facilitator refuses it, nothing to guard
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([String(p.accepted?.network ?? ""), p.payload])));
  return { key: `x402v2:${hex(digest)}`, expires: Math.floor(expires) };
}

/** Claims a v2 payment before the tool runs. Undefined when there is nothing to claim or the claim could not be recorded. */
export async function claimV2Payment(env: Pick<Env, "METRICS">, header: string | null | undefined): Promise<V2Claim | undefined> {
  if (!env.METRICS) return undefined;
  const claim = await v2ClaimKey(header);
  if (!claim) return undefined;
  const ledger = env.METRICS.get(env.METRICS.idFromName("global"));
  const claimed = await ledger.mppClaim(claim.key, claim.expires).catch((e: unknown) => { console.error("x402 v2: the payment claim could not be recorded; going on without it", e); return null; });
  if (claimed === null) return undefined;
  const release = () => ledger.mppDelete(claim.key).catch((e: unknown) => { console.error("x402 v2: releasing the payment claim failed", e); });
  return claimed ? { taken: false, release } : { taken: true, release: async () => {} };
}
