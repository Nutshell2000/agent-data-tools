import type { Env } from "./env";
import { paymentOptions } from "./networks";

/**
 * Unpaid quotes from the edge cache (14 Nov 2026).
 *
 * Why: about 95% of requests are unpaid 402 quotes from monitors and directories that ask for the same URLs every few
 * minutes from the same places. Each one ran the payment gateway (about 5 ms of CPU), and the first quote in a fresh
 * isolate builds all 701 route configurations (60-225 ms): cold starts were 2.7% of requests and a third of all CPU.
 * A quote is the same for the same URL until the next release, so the colo's cache can hold it; a hit never starts the
 * gateway at all.
 *
 * What is cached: the finished quote (status, headers, body) of a request that carried no payment, key, trial or
 * browser, for 30 minutes, under a key that holds the release version, the payment settings and the exact URL.
 * What is never cached or served from cache: anything with a payment or credential header, free-call requests,
 * browsers (they get a page), and the MPP challenges, which are made fresh for every answer because they expire.
 */
export const QUOTE_TTL_SECONDS = 1800;

const edgeCache = () => (typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined);

/** Headers that belong to one answer, not to the quote. */
const PER_ANSWER = new Set(["www-authenticate", "x-request-id", "date", "content-length", "set-cookie", "x-quote-cache", "cf-ray", "report-to", "nel"]);

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

/** Everything outside the URL that changes a quote: the release, where payments go, and the switches that change its text. */
export function quoteFingerprint(env: Env, version: string): string {
  return fnv(JSON.stringify([version, paymentOptions(env), env.TRIALS_ENABLED ?? "", env.PDF_TRY ?? "", Boolean(env.STRIPE_READ_KEY), env.QUOTE_BODY ?? "", env.MPP_EVM ?? "", env.TEMPO_PAY_TO ?? ""]));
}

/**
 * The cache key of an unpaid quote, or undefined when this request must go through the gateway.
 * `header` reads a request header by lower-case name.
 */
export function quoteCacheKey(env: Env, version: string, method: string, url: string, header: (name: string) => string | undefined): Request | undefined {
  if (method !== "GET" || env.QUOTE_CACHE === "off") return undefined;
  for (const name of ["payment-signature", "x-payment", "authorization", "x-api-key", "x-rapidapi-proxy-secret", "x-fluxa-proxy-secret", "cookie"]) if (header(name)) return undefined;
  // A browser gets a page built for it; only programs get the cached quote.
  if (/text\/html/i.test(header("accept") ?? "") || /mozilla/i.test(header("user-agent") ?? "")) return undefined;
  const u = new URL(url);
  for (const name of ["trial", "sample", "api_key", "apikey", "key"]) if (u.searchParams.has(name)) return undefined;
  if (u.href.length > 1500) return undefined;
  return new Request(`https://quote-cache.invalid/v1/${quoteFingerprint(env, version)}/${encodeURIComponent(u.href)}`);
}

/** A cached quote as a fresh Response marked `X-Quote-Cache: hit`, or undefined. Never throws. */
export async function readQuote(key: Request): Promise<Response | undefined> {
  try {
    const hit = await edgeCache()?.match(key);
    if (!hit) return undefined;
    const stored = (await hit.json()) as { status: number; headers: [string, string][]; body: string };
    if (stored.status !== 402 || typeof stored.body !== "string" || !Array.isArray(stored.headers)) return undefined;
    const headers = new Headers(stored.headers);
    headers.set("X-Quote-Cache", "hit");
    return new Response(stored.body, { status: 402, headers });
  } catch {
    return undefined;
  }
}

/** Stores a finished 402 quote. Only a 402 with x402 terms is kept. Never throws. */
export async function writeQuote(key: Request, quote: Response): Promise<void> {
  try {
    if (quote.status !== 402 || !quote.headers.get("payment-required")) return;
    const headers = [...quote.headers.entries()].filter(([name]) => !PER_ANSWER.has(name.toLowerCase()));
    const body = await quote.text();
    if (body.length > 200_000) return;
    await edgeCache()?.put(key, new Response(JSON.stringify({ status: 402, headers, body }), { headers: { "content-type": "application/json", "cache-control": `max-age=${QUOTE_TTL_SECONDS}` } }));
  } catch {
    // Caching is an optimization only.
  }
}
