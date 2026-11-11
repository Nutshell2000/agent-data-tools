/**
 * Review keys (11 Nov 2026): ordinary-looking `adt_` keys for marketplace reviewers and demo recordings (n8n's node
 * verification asks for a video in which the credential test passes and the common actions run). Owner: "fix it in a
 * better way yourself no more spending until 18/11", so the key is not bought: its SHA-256 is listed in the Worker secret
 * REVIEW_KEY_HASHES (comma-separated hex), and the key itself lives only with the operator.
 *
 * A review key never touches the credit ledger: nothing is "purchased", so /revenue's card-credit figures, the funnel's
 * credits stages and the payment counters stay customer-only. It runs a capped number of successful calls per UTC day
 * (`REVIEW_CALLS_PER_DAY`, counted in the Metrics object with the ChatGPT daily-call records; failed calls are given back)
 * and only tools at or below `REVIEW_MAX_PRICE`, so a leaked key costs at most a few cents of upstream use a day.
 * Remove a hash from the secret to end a key.
 */
import type { Env } from "./env";
import { priceMicros } from "./credits";

export const REVIEW_CALLS_PER_DAY = 150;
/** Shared with the ChatGPT records' all-callers counter (lib/free-calls.ts takeDailyCall); the ChatGPT limit is 5,000. */
export const REVIEW_CALLS_TOTAL_PER_DAY = 5_000;
export const REVIEW_MAX_PRICE = "$0.10";

const HEX64 = /^[0-9a-f]{64}$/;

/** The configured review-key hashes; malformed entries are ignored. */
export function reviewKeyHashes(env: Env): Set<string> {
  return new Set((env.REVIEW_KEY_HASHES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => HEX64.test(s)));
}

export const isReviewKey = (env: Env, keyHash: string) => reviewKeyHashes(env).has(keyHash);

/** The daily-call record name for a review key, kept apart from ChatGPT callers' records. */
export const reviewCaller = (keyHash: string) => `review:${keyHash}`;

/** True when a review key may run a tool at this price. */
export const reviewAllows = (price: string) => priceMicros(price) <= priceMicros(REVIEW_MAX_PRICE);

export const REVIEW_NOTE = `Review key: up to ${REVIEW_CALLS_PER_DAY} successful calls a day on tools priced up to ${REVIEW_MAX_PRICE}, for marketplace review and demos. Customers buy their own key at /credits.`;
