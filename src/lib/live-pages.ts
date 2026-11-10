/**
 * Live answers on tool pages (10 Nov 2026).
 *
 * Why: the owner's goal needs customers of our own, and under her rules they can only arrive by search. Search Console that
 * day: 0 clicks in 28 days; the queries that did show our pages were people asking for a value right now ("base gas
 * price", "avax gas fee", "501 redirect"), and a tool page answered them with a static example from October. For tools
 * whose published example is a question with a current answer, the page now shows the real answer, read at most 15
 * minutes ago: the page satisfies the search, and it changes between crawls instead of being one of 700 identical
 * templates. A visitor who wants it in their own code has the request, the free calls and the card key right below.
 *
 * Cost: one run of the tool's published example per page and quarter hour at most (edge cache), whatever the crawler
 * traffic. Tools that cost us money per run (AI, rendering, search) are never run for a page view.
 */
import type { Env } from "./env";
import { CAPACITY_LIMITED } from "./capacity";
import { ENDPOINTS, exampleParams, type Endpoint } from "../endpoints";
import { TOOLS } from "../tools";

const LIVE_SECONDS = 900;
const LIVE_TIMEOUT_MS = 3_500;
export const LIVE_EXACT: ReadonlySet<string> = new Set([
  "/base-gas", "/pack/gas-tracker", "/btc-price", "/btc-fees", "/crypto/fear-greed", "/crypto/fear-and-greed", "/crypto/trending",
  "/hyperliquid/prices", "/hyperliquid/market", "/price/token", "/price/crypto", "/token/price", "/price/tokens", "/fx", "/fx/rates", "/fx/all",
  "/stablecoin/supply", "/defi/usdc-yield", "/defi/yields", "/defi/tvl", "/dex/trending", "/dex/new-pools", "/whale/transfers", "/whales",
  "/time", "/earthquakes", "/airport/status", "/econ/national-debt", "/econ/treasury-rates", "/weather", "/weather/forecast", "/weather/current",
  "/sun", "/moon", "/stock/quote", "/polymarket/markets", "/polymarket/events", "/llm/prices",
]);
/** Per-network gas and latest-block pages ("avax gas fee", "base block number"): every network we read. */
const LIVE_PATTERN = /^\/[a-z0-9]+\/(gas|block)$/;

export const isLivePage = (e: Pick<Endpoint, "path">) => (LIVE_EXACT.has(e.path) || LIVE_PATTERN.test(e.path)) && !CAPACITY_LIMITED.has(e.path);
export const LIVE_PAGE_PATHS = () => ENDPOINTS.filter(isLivePage).map((e) => e.path);

export interface LiveAnswer { result: unknown; at: string }

type Runner = (path: string, env: Env, input: (name: string) => string | undefined) => Promise<unknown>;
const runTool: Runner = (path, env, input) => (TOOLS as Record<string, (env: Env, input: (name: string) => string | undefined) => Promise<unknown>>)[path](env, input);

/**
 * The tool's answer to its own published example, at most a quarter hour old. Never throws and never waits longer than
 * LIVE_TIMEOUT_MS: a slow or failing source means the page shows its static example, as before.
 */
export async function liveAnswer(e: Endpoint, env: Env, wait: (p: Promise<unknown>) => void, run: Runner = runTool, store: Cache | undefined = (globalThis as { caches?: { default?: Cache } }).caches?.default): Promise<LiveAnswer | undefined> {
  if (!isLivePage(e)) return undefined;
  const key = new Request(`https://live-answer.invalid${e.path}`);
  try {
    const hit = await store?.match(key);
    if (hit) return (await hit.json()) as LiveAnswer;
  } catch { /* no cache here: read it live */ }
  const example = Object.fromEntries(exampleParams(e).map(([name, p]) => [name, String(p.example)]));
  const fresh = run(e.path, env, (name) => example[name]).then((result): LiveAnswer => ({ result, at: new Date().toISOString() }));
  // The read finishes and is cached even when this page view stops waiting for it, so the next visitor gets it.
  const kept = fresh.then(async (answer) => {
    await store?.put(key, new Response(JSON.stringify(answer), { headers: { "content-type": "application/json", "cache-control": `max-age=${LIVE_SECONDS}` } }));
    return answer;
  }).catch(() => undefined);
  wait(kept);
  return Promise.race([kept, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), LIVE_TIMEOUT_MS))]);
}
