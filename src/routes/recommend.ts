// "Which API should I call?" (1.77.0, 25 Oct 2026). On the Bazaar the API recommender agents-trust.com/recommend sold 8,885
// calls to 29 payers in 30 days (about 300 calls per payer, still called that day), and the searches "api recommendation",
// "recommend api", "find api" and "which api" had nothing of ours. This one recommends from our own catalog: each answer is
// the exact call for the best-matching tools, so a bot that asks comes back to buy the call. Lexical scoring over each tool's
// name, tags and copy, then BAAI bge-reranker-base orders the top candidates (lexical order when the model is unavailable).
import { entry, need, num, type Entry } from "../family";
import { runAi } from "../lib/ai";
import { HttpError, type Env } from "../lib/env";
import { RERANK_MODEL } from "./retrieval";

const ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
const STOP = new Set("a an and are as at be by can do does for from get give how i in is it me my of on or please show tell that the this to use want what when where which who why with you your api apis call tool tools find need".split(" "));

// Words agents use for a task, mapped onto the words our tool names use.
const SYNONYMS: Readonly<Record<string, string>> = { remember: "memory", recall: "memory", save: "memory", store: "memory", forget: "memory", sanctioned: "sanctions", ofac: "sanctions", scrape: "extract", crawl: "extract", markdown: "extract", llm: "chat", gpt: "chat", completion: "chat", forecast: "weather", temperature: "weather", currency: "fx", exchange: "fx", eur: "fx", usd: "fx", whois: "domain", rug: "honeypot", scam: "risk", ether: "eth", ethereum: "eth", bitcoin: "btc" };
/** Light stemming: "sanctioned" and "sanctions" both become "sanction"; prefix matching does the rest. */
const stem = (w: string) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, "") : w.length > 3 ? w.replace(/s$/, "") : w);
export const tokens = (s: string) => {
  const words = s.toLowerCase().replace(/[^a-z0-9$.\s-]/g, " ").split(/[\s-]+/).map((w) => w.replace(/^\.+|\.+$/g, "")).filter((w) => w.length > 1 && !STOP.has(w));
  const out = new Set(words.flatMap((w) => (Object.hasOwn(SYNONYMS, w) ? [stem(w), SYNONYMS[w]] : [stem(w)])));
  // "price of ETH" asks for a token price, not a gas price, unless gas or fees are named.
  if (out.has("price") && !["gas", "fee", "fees"].some((w) => out.has(w))) { out.add("token"); out.add("crypto"); }
  return [...out];
};

/** `also`: the names and tags of the entry paths that run this tool, so the phrases those doors were named for find it. */
type Doc = { path: string; name: string; tags: string[]; summary: string; description: string; price: string; also?: string };

/** The request as written: lower case, punctuation as spaces. Word order is kept ("text to speech" is not "speech to text"). */
export const asWritten = (s: string) => s.toLowerCase().replace(/[^a-z0-9$.]+/g, " ").trim();

/**
 * Jobs as buyers name them, each with the tool that does it (1.111.0, 11 Nov 2026). The names are what our paying
 * wallets bought from other sellers that week (base-bots/buyer-next.mjs); word and phrase scoring sent several to the
 * wrong tool: "audit bundle" to the package audit, "hunter email verifier" to the x402 finder, "token preflight" to the
 * token lookup, "tts elevenlabs" below speech to text. A request that holds one of these phrases as whole words gets
 * that tool first; the longest phrase wins. Keep each phrase to a job the tool really does, and add one when buyer-next
 * shows a job landing on the wrong tool (tests/recommend.test.cjs checks every path is a tool).
 */
export const JOBS: Readonly<Record<string, string>> = Object.freeze({
  "text to speech": "/ai/speech", "tts": "/ai/speech", "read aloud": "/ai/speech", "voice over": "/ai/speech", "speak text": "/ai/speech",
  "long text to speech": "/text-to-speech", "narrate": "/text-to-speech", "narration": "/text-to-speech",
  "speech to text": "/transcribe", "transcribe": "/transcribe", "transcription": "/transcribe", "audio to text": "/transcribe",
  "website audit": "/audit/website", "site audit": "/audit/website", "audit bundle": "/audit/website", "accessibility audit": "/audit/website", "page speed": "/audit/website", "lighthouse": "/audit/website",
  "seo audit": "/seo/audit", "package audit": "/package-audit", "dependency audit": "/package-audit",
  // 10 Nov 2026 (base-bots/mercator-jobs.mjs, bazaar-word-demand.mjs): jobs sold elsewhere under a path that names them.
  "cve lookup": "/cve", "cve": "/cve", "vulnerability lookup": "/cve", "known exploited": "/cve", "kev": "/cve", "epss": "/cve", "cvss score": "/cve",
  "timezone convert": "/time", "time zone converter": "/time", "current time": "/time", "what time is it": "/time",
  "perp funding": "/hyperliquid/market", "funding rate": "/hyperliquid/market", "open interest": "/hyperliquid/market",
  "income statement": "/sec/financials", "balance sheet": "/sec/financials", "cash flow statement": "/sec/financials", "financial statements": "/sec/financials", "company financials": "/sec/financials", "stock fundamentals": "/sec/financials", "fundamentals": "/sec/financials", "company facts": "/sec/financials", "earnings per share": "/sec/financials",
  "arxiv": "/arxiv/search", "arxiv search": "/arxiv/search", "preprint": "/arxiv/search", "preprints": "/arxiv/search",
  "url to markdown": "/extract", "page to markdown": "/extract", "html to markdown": "/extract",
  "wikipedia summary": "/wikipedia", "wiki summary": "/wikipedia", "trending crypto": "/crypto/trending", "trending coins": "/crypto/trending", "crypto ohlcv": "/hyperliquid/candles", "crypto candles": "/hyperliquid/candles",
  "web search": "/search", "search the web": "/search", "google search": "/search", "serp": "/search", "brave search": "/search", "exa search": "/search",
  "keyword ideas": "/keywords/ideas", "keyword research": "/keywords/ideas", "keyword overview": "/keywords/ideas",
  "email verifier": "/email", "verify email": "/email", "email verification": "/email", "email validation": "/email",
  "email auth": "/pack/email-deliverability", "spf": "/pack/email-deliverability", "dmarc": "/pack/email-deliverability", "dkim": "/pack/email-deliverability",
  "fear and greed": "/crypto/fear-greed", "fear greed": "/crypto/fear-greed",
  "token price": "/price/token", "crypto price": "/price/token", "coin price": "/price/token",
  "gas oracle": "/pack/gas-tracker", "gas tracker": "/pack/gas-tracker", "multichain gas": "/pack/gas-tracker",
  "erc20 balance": "/base/token-balance", "token balance": "/base/token-balance", "wallet balance": "/wallet/balances", "wallet portfolio": "/wallet/portfolio",
  "weather forecast": "/weather", "current weather": "/weather",
  "screenshot": "/screenshot", "status check": "/url/uptime", "uptime": "/url/uptime", "is it down": "/url/uptime",
  "image generation": "/image", "generate image": "/image", "image gen": "/image",
  "chat completion": "/ai/chat", "chat completions": "/ai/chat", "llm": "/ai/chat",
  "rug check": "/token/verdict", "honeypot": "/token/verdict", "token preflight": "/token/verdict", "token verdict": "/token/verdict",
  "wallet screen": "/sanctions/check", "sanctions check": "/sanctions/check", "ofac": "/sanctions/check",
  "company lookup": "/company", "company enrich": "/pack/domain-intel", "company enrichment": "/pack/domain-intel",
  "rss": "/feed", "feed json": "/feed", "pdf to text": "/pdf/text", "web page to markdown": "/extract", "scrape": "/extract",
  "prediction markets": "/polymarket/markets", "polymarket": "/polymarket/markets",
  "stock price": "/stock/quote", "stock quote": "/stock/quote", "stock history": "/stock/history", "ohlcv": "/hyperliquid/candles",
  "github repo": "/github/repo", "github repository": "/github/repo",
  "contract call": "/base/call", "eth call": "/base/call", "read contract": "/base/call",
  "vat number": "/vat/validate", "vat validation": "/vat/validate", "lei": "/lei/lookup",
  "my ip": "/ip/geolocate", "ip geolocation": "/ip/geolocate", "ip location": "/ip/geolocate", "ip lookup": "/ip/lookup", "ip whois": "/ip/lookup",
  "national debt": "/econ/national-debt", "usdc yield": "/defi/usdc-yield", "defi yields": "/defi/yields", "tvl": "/defi/tvl",
});
/** The tool for the longest job phrase the request holds as whole words, if any. */
export function jobTool(needText: string): string | undefined {
  const text = ` ${asWritten(needText)} `;
  let best: string | undefined;
  for (const phrase of Object.keys(JOBS)) if (text.includes(` ${phrase} `) && (!best || phrase.length > best.length)) best = phrase;
  return best ? JOBS[best] : undefined;
}

/**
 * Lexical score: a query word in the listing name counts most, then tags, then the summary, then the description.
 * `written` is the request as the caller wrote it (1.110.1): the stop-word-free word list scored "text to speech" and
 * "speech to text" the same, so the free finder answered /transcribe for a text-to-speech job. A name or tag that holds
 * the phrase in the caller's own word order wins.
 */
export function lexicalScore(query: string[], d: Doc, written = "") {
  if (!query.length) return 0;
  const has = (text: string, w: string) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.$]/g, "\\$&")}`).test(text);
  const name = asWritten(d.name), tags = `${d.tags.join(" ").toLowerCase().replace(/-/g, " ")} ${d.also ?? ""}`, summary = d.summary.toLowerCase(), desc = d.description.toLowerCase();
  let s = 0;
  for (const w of query) s += has(name, w) ? 4 : has(tags, w) ? 3 : has(summary, w) ? 2 : has(desc, w) ? 1 : 0;
  // The whole request as a phrase in the name or tags (e.g. "token price", "dns lookup").
  const phrase = query.join(" ");
  if (query.length > 1 && (name.includes(phrase) || tags.includes(phrase))) s += 4;
  if (written.includes(" ")) s += name.startsWith(written) ? 8 : name.includes(written) ? 6 : tags.includes(written) ? 5 : 0;
  return s / query.length;
}

async function catalog(): Promise<{ docs: Doc[]; example: (path: string) => [string, { example?: unknown; required?: boolean; description: string }][]; free: (path: string) => boolean }> {
  const [{ ENDPOINTS, exampleParams }, { listingName, listingTags }, { CAPACITY_LIMITED }, { ENTRY_OF }] = await Promise.all([import("../endpoints"), import("../lib/bazaar-extension"), import("../lib/capacity"), import("./entry-paths")]);
  const byPath = new Map(ENDPOINTS.map((e) => [e.path, e]));
  // Entry paths (7 Nov 2026) are doors for outside search engines; our own recommender names the canonical tool only.
  const canonical = (e: { path: string }) => !Object.hasOwn(ENTRY_OF, e.path);
  // Each door was named for a phrase buyers search ("USDC yield", "Current weather"): the tool it runs answers to it too.
  const also = new Map<string, string[]>();
  for (const e of ENDPOINTS) if (!canonical(e)) (also.get(ENTRY_OF[e.path]) ?? also.set(ENTRY_OF[e.path], []).get(ENTRY_OF[e.path])!).push(asWritten(listingName(e.summary)), ...listingTags(e.tags, e.path).map((tag) => tag.toLowerCase().replace(/-/g, " ")));
  return {
    docs: ENDPOINTS.filter((e) => e.path !== "/recommend" && canonical(e)).map((e) => ({ path: e.path, name: listingName(e.summary), tags: listingTags(e.tags, e.path), summary: e.summary, description: e.description, price: e.price, also: (also.get(e.path) ?? []).join(" , ") })),
    example: (path) => exampleParams(byPath.get(path as never)!) as never,
    free: (path) => !CAPACITY_LIMITED.has(path),
  };
}

/**
 * `rerank` null is the free finder (GET /find, 1.110.0): word matching only, so it costs nothing to run and an agent can
 * ask which of our tools does its next job without paying or leaving. `origin` is the host the caller used.
 */
export async function recommend(env: Env, needText: string, count: number, rerank: ((q: string, docs: string[]) => Promise<number[] | null>) | null, origin = ORIGIN) {
  const query = tokens(needText);
  if (!query.length) throw new HttpError(400, "describe the task in a few plain words, for example need=current gas price on Base");
  const { docs, example, free } = await catalog();
  const written = asWritten(needText);
  const job = jobTool(needText);
  const ranked = docs.map((d) => ({ d, s: lexicalScore(query, d, written) + (d.path === job ? 10 : 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 15);
  if (!ranked.length) throw new HttpError(404, `no tool here matches "${needText.slice(0, 80)}"; nothing was charged. The full catalog is at ${origin}/discovery/resources`);
  let order = ranked;
  let method = "lexical";
  if (rerank && ranked.length > 1) {
    const scores = await rerank(needText, ranked.map(({ d }) => `${d.name}. ${d.summary}. ${d.description.slice(0, 400)}`)).catch(() => null);
    if (scores && scores.length === ranked.length) {
      // Blend: the reranker reads meaning, the lexical score keeps exact task names (a tool named for the phrase) on top.
      const top = ranked[0].s;
      // A named job keeps its tool first: the reranker reads "text to speech" and "speech to text" as near twins.
      order = ranked.map((x, i) => ({ ...x, s: 0.7 * scores[i] + 0.3 * (x.s / top) + (x.d.path === job ? 1 : 0) })).sort((a, b) => b.s - a.s);
      method = "lexical+rerank";
    }
  }
  const picks = order.slice(0, count).map(({ d, s }) => {
    const params = example(d.path);
    const query = new URLSearchParams(params.filter(([, p]) => p.example !== undefined && p.example !== "").map(([n, p]) => [n, String(p.example)])).toString();
    return {
      tool: d.path,
      name: d.name,
      what: d.summary,
      price: d.price,
      mcpTool: d.path.slice(1).replace(/[/-]/g, "_"),
      call: { method: "GET", url: `${origin}${d.path}${query ? `?${query}` : ""}` },
      requiredInputs: params.filter(([, p]) => p.required).map(([n, p]) => ({ name: n, description: p.description })),
      inFreeCalls: free(d.path),
      score: Math.round(s * 1000) / 1000,
    };
  });
  return {
    need: needText,
    picks,
    howToPay: `GET the call URL: unpaid it answers 402 with x402 terms (USDC on Base, Polygon, Arbitrum or Solana) and MPP; or send a prepaid key as Authorization: Bearer (by card at ${origin}/credits, or with USDC at ${origin}/credits/usdc/5). Failed calls are never charged; the first 3 calls per caller are free over HTTP on tools in the free calls (add trial=1).`,
    mcp: `${origin}/mcp`,
    method,
  };
}

export const RECOMMEND: Entry[] = [
  entry("/recommend", "API recommendation: which API to call for a task",
    "Describe a task in plain words and get the best-matching paid API calls for it from a catalog of 600+ tools (web search and page reading, LLM chat, token prices and EVM chain reads, sanctions and company checks, weather, finance and utilities): each pick with the exact call URL, required inputs, price, MCP tool name and whether it is in the free calls. Use when an agent needs to find which API to call before paying for one.",
    ["api-recommendation", "which-api", "find-api", "api-discovery", "x402-discovery"], {
      need: { type: "string", description: "The task in plain words, up to 300 characters", required: true, example: "current gas price on Base" },
      count: { type: "string", description: "How many picks, 1 to 5 (default 3)", example: "3" },
    },
    { need: "current gas price on Base", picks: [{ tool: "/base-gas", name: "Base gas price", what: "Base gas price: current fees for a transaction on Base", price: "$0.002", mcpTool: "base_gas", call: { method: "GET", url: `${ORIGIN}/base-gas` }, requiredInputs: [], inFreeCalls: true, score: 0.95 }], howToPay: "GET the call URL: unpaid it answers 402 with x402 terms…", mcp: `${ORIGIN}/mcp`, method: "lexical+rerank" },
    (env, q) => recommend(env, need(q, "need", 300), num(q, "count", { min: 1, max: 5, fallback: 3, integer: true }),
      async (query, docs) => {
        const out = await runAi<{ response?: { id: number; score: number }[] }>(env, RERANK_MODEL, { query, contexts: docs.map((text) => ({ text })), top_k: docs.length });
        if (!Array.isArray(out?.response)) return null;
        const scores = new Array(docs.length).fill(0);
        for (const r of out.response) if (Number.isInteger(r.id) && r.id >= 0 && r.id < docs.length) scores[r.id] = r.score;
        return scores;
      }),
    "$0.002"),
];
