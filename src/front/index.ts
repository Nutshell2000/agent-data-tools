/**
 * Quote front (19 Nov 2026, owner: "Yes, build it"), step 3: the small Worker that answers unpaid quotes.
 *
 * Why: routers probe each listing with an unpaid request and count anything slower than ~1.5 s as a failure (Mercator),
 * and our full Worker is a 15 MB bundle whose cold isolates take 0.7-3 s. This Worker is under 1 MB: it starts in
 * milliseconds and answers a repeated unpaid quote from KV, with fresh MPP challenges, without waking the core.
 *
 * What it answers itself: a GET from a program (not a browser) with no payment, key, cookie or free-call request, for a
 * URL whose exact quote the core gave before in this release. The stored quote is the core's own answer, byte for byte
 * (status, headers, PAYMENT-REQUIRED, body); only the MPP challenges are minted fresh (src/front/challenges.ts), because
 * a challenge pays once. Everything else, and anything in doubt, is passed to the core unchanged (service binding CORE).
 *
 * Release safety: the core stamps every answer with X-Quote-Release (its quote fingerprint: version plus payment
 * settings). A stored quote carries the fingerprint it was made under and is used only while that is the current one,
 * which the front learns from the core's answers and keeps in KV (`q:release`). A deploy of the core therefore retires
 * every stored quote as soon as any request reaches the new core.
 */
import { challengeSecretHex, mintChallenge, termsOf, type MppMethod, type MppTerms } from "./challenges";
import { splitChallenges } from "./template";

// A Worker module may export only handlers: helpers stay module-private (workerd refuses other exports).

export interface FrontEnv {
  CORE: { fetch(request: Request): Promise<Response> };
  QUOTES: KVNamespace;
  MPP_SECRET_KEY?: string;
  CDP_API_KEY_SECRET?: string;
  /** "off" passes every request to the core (the first rollback step: a config deploy, no code change). */
  FRONT?: string;
}

/** A quote as the core gave it, minus what belongs to one answer. */
export interface StoredQuote { v: 1; release: string; status: number; headers: [string, string][]; body: string; mpp: MppTerms[] }

const RELEASE_HEADER = "x-quote-release";
const RELEASE_KEY = "q:release";
const RELEASE_MEMO_MS = 60_000;
const QUOTE_TTL_SECONDS = 6 * 3600;
const MEMO_MS = 60_000;
const MEMO_MAX = 2000;
const WRITES_PER_ISOLATE_HOUR = 300;

/** Headers that belong to one answer, never stored (www-authenticate is rebuilt from the terms). */
const PER_ANSWER = new Set(["www-authenticate", "x-request-id", "date", "content-length", "set-cookie", "x-quote-cache", "cf-ray", "report-to", "nel", "server", "alt-svc", RELEASE_HEADER,
  // Encoding is negotiated per client by the runtime; a stored "br" would be sent to a client that never accepted it.
  "content-encoding", "transfer-encoding"]);
const CREDENTIAL_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key", "x-rapidapi-proxy-secret", "x-fluxa-proxy-secret", "cookie", "origin"];
const CONTROL_PARAMS = ["trial", "sample", "api_key", "apikey", "key"];
/** Paths that are never a tool quote; they go straight to the core without a KV read. */
const NEVER = /^\/(?:$|mcp|v1\/|\.well-known|tools|credits|guides|discovery|openapi|llms|sitemap|robots|favicon|og|metrics|revenue|status|health|e$|app|docs|from\/)/;

/** Whether this request may be answered from a stored quote (the core's own quote-cache rules, plus Origin). */
function quotable(request: Request): URL | undefined {
  if (request.method !== "GET") return undefined;
  for (const name of CREDENTIAL_HEADERS) if (request.headers.has(name)) return undefined;
  if (/text\/html/i.test(request.headers.get("accept") ?? "") || /mozilla/i.test(request.headers.get("user-agent") ?? "")) return undefined;
  const url = new URL(request.url);
  if (NEVER.test(url.pathname)) return undefined;
  for (const name of CONTROL_PARAMS) if (url.searchParams.has(name)) return undefined;
  if (url.href.length > 1500) return undefined;
  return url;
}

const quoteKey = (release: string, href: string) => `q:${release}:${href}`;

/** A stored quote from one core answer, or undefined when the answer is not a plain x402 quote. */
function toStored(response: Response, body: string, release: string): StoredQuote | undefined {
  if (response.status !== 402 || !response.headers.get("payment-required")) return undefined;
  if (response.headers.has("x-free-trial-unavailable") || response.headers.has("set-cookie")) return undefined;
  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => { if (!PER_ANSWER.has(name.toLowerCase())) headers.push([name, value]); });
  const mpp: MppTerms[] = [];
  for (const raw of splitChallenges(response.headers.get("www-authenticate"))) {
    const terms = termsOf(raw);
    if (!terms) return undefined;
    mpp.push(terms);
  }
  if (body.length > 200_000) return undefined;
  return { v: 1, release, status: 402, headers, body, mpp };
}

// Per-isolate state. Memo entries are copies of KV (never authoritative); a miss always falls back to KV, then the core.
let release: { value: string | null; at: number } | undefined;
const memo = new Map<string, { quote: StoredQuote; at: number }>();
const seenMisses = new Set<string>();
const secrets = new Map<MppMethod, Promise<string>>();
let writes = { hour: 0, count: 0 };

async function currentRelease(env: FrontEnv): Promise<string | null> {
  if (release && Date.now() - release.at < RELEASE_MEMO_MS) return release.value;
  const value = await env.QUOTES.get(RELEASE_KEY);
  release = { value, at: Date.now() };
  return value;
}

function noteRelease(env: FrontEnv, ctx: ExecutionContext, seen: string | null) {
  if (!seen || release?.value === seen) return;
  release = { value: seen, at: Date.now() };
  memo.clear();
  ctx.waitUntil(env.QUOTES.put(RELEASE_KEY, seen).catch(() => {}));
}

function rootSecret(env: FrontEnv): string | undefined { return env.MPP_SECRET_KEY || env.CDP_API_KEY_SECRET || undefined; }

function secretFor(env: FrontEnv, method: MppMethod): Promise<string> {
  let s = secrets.get(method);
  if (!s) { s = challengeSecretHex(rootSecret(env)!, method); secrets.set(method, s); }
  return s;
}

async function lookup(env: FrontEnv, href: string): Promise<StoredQuote | undefined> {
  const rel = await currentRelease(env);
  if (!rel) return undefined;
  const key = quoteKey(rel, href);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.quote;
  const quote = await env.QUOTES.get<StoredQuote>(key, "json");
  if (!quote || quote.v !== 1 || quote.release !== rel) return undefined;
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(key, { quote, at: Date.now() });
  return quote;
}

/** The answer rebuilt from a stored quote, with fresh MPP challenges in the core's order. */
async function answerFrom(env: FrontEnv, quote: StoredQuote, url: URL): Promise<Response> {
  const headers = new Headers(quote.headers);
  for (const terms of quote.mpp) headers.append("WWW-Authenticate", mintChallenge(terms, url.host, await secretFor(env, terms.method)));
  headers.set("X-Quote-Front", "hit");
  return new Response(quote.body, { status: quote.status, headers });
}

function mayWrite(): boolean {
  const hour = Math.floor(Date.now() / 3_600_000);
  if (writes.hour !== hour) writes = { hour, count: 0 };
  return writes.count++ < WRITES_PER_ISOLATE_HOUR;
}

async function store(env: FrontEnv, href: string, response: Response, rel: string) {
  try {
    const quote = toStored(response, await response.text(), rel);
    if (!quote) return;
    await env.QUOTES.put(quoteKey(rel, href), JSON.stringify(quote), { expirationTtl: QUOTE_TTL_SECONDS });
  } catch {
    // Storing is an optimization only.
  }
}

export default {
  async fetch(request: Request, env: FrontEnv, ctx: ExecutionContext): Promise<Response> {
    const url = env.FRONT === "off" || !rootSecret(env) ? undefined : quotable(request);
    if (url) {
      try {
        const quote = await lookup(env, url.href);
        if (quote) return await answerFrom(env, quote, url);
      } catch (e) {
        console.error("quote front: stored quote unusable, asking the core", e);
      }
    }
    const response = await env.CORE.fetch(request);
    const rel = response.headers.get(RELEASE_HEADER);
    noteRelease(env, ctx, rel);
    // Store a quote only for a bare tool path or a URL asked before in this colo: a crawler's one-off URLs never reach
    // KV, while a router's repeated probe of a listing does after its second miss. The "asked before" mark lives in the
    // colo's edge cache (free, shared by its isolates): an isolate-only mark missed on the rehearsal Worker (19 Nov),
    // because consecutive requests landed on different isolates.
    if (url && rel && response.status === 402) {
      const copy = response.clone();
      ctx.waitUntil((async () => {
        if (url.search !== "" && !(await askedBefore(url.href))) return;
        if (mayWrite()) await store(env, url.href, copy, rel);
      })());
    }
    return response;
  },
};

const edgeCache = () => (typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined);

/** True when this colo saw the URL miss before (within an hour); otherwise marks it and answers false. Never throws. */
async function askedBefore(href: string): Promise<boolean> {
  if (seenMisses.has(href)) return true;
  if (seenMisses.size > 5000) seenMisses.clear();
  seenMisses.add(href);
  try {
    const cache = edgeCache();
    if (!cache) return false;
    const key = new Request(`https://quote-front-seen.invalid/${encodeURIComponent(href)}`);
    if (await cache.match(key)) return true;
    await cache.put(key, new Response("1", { headers: { "cache-control": "max-age=3600" } }));
  } catch {
    // The mark is an optimization only.
  }
  return false;
}
