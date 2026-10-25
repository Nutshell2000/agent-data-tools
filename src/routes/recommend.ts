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

type Doc = { path: string; name: string; tags: string[]; summary: string; description: string; price: string };

/** Lexical score: a query word in the listing name counts most, then tags, then the summary, then the description. */
export function lexicalScore(query: string[], d: Doc) {
  if (!query.length) return 0;
  const has = (text: string, w: string) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.$]/g, "\\$&")}`).test(text);
  const name = d.name.toLowerCase(), tags = d.tags.join(" ").toLowerCase().replace(/-/g, " "), summary = d.summary.toLowerCase(), desc = d.description.toLowerCase();
  let s = 0;
  for (const w of query) s += has(name, w) ? 4 : has(tags, w) ? 3 : has(summary, w) ? 2 : has(desc, w) ? 1 : 0;
  // The whole request as a phrase in the name or tags (e.g. "token price", "dns lookup").
  const phrase = query.join(" ");
  if (query.length > 1 && (name.includes(phrase) || tags.includes(phrase))) s += 4;
  return s / query.length;
}

async function catalog(): Promise<{ docs: Doc[]; example: (path: string) => [string, { example?: unknown; required?: boolean; description: string }][]; free: (path: string) => boolean }> {
  const [{ ENDPOINTS, exampleParams }, { listingName, listingTags }, { CAPACITY_LIMITED }] = await Promise.all([import("../endpoints"), import("../lib/bazaar-extension"), import("../lib/capacity")]);
  const byPath = new Map(ENDPOINTS.map((e) => [e.path, e]));
  return {
    docs: ENDPOINTS.filter((e) => e.path !== "/recommend").map((e) => ({ path: e.path, name: listingName(e.summary), tags: listingTags(e.tags, e.path), summary: e.summary, description: e.description, price: e.price })),
    example: (path) => exampleParams(byPath.get(path as never)!) as never,
    free: (path) => !CAPACITY_LIMITED.has(path),
  };
}

export async function recommend(env: Env, needText: string, count: number, rerank: ((q: string, docs: string[]) => Promise<number[] | null>) | null) {
  const query = tokens(needText);
  if (!query.length) throw new HttpError(400, "describe the task in a few plain words, for example need=current gas price on Base");
  const { docs, example, free } = await catalog();
  const ranked = docs.map((d) => ({ d, s: lexicalScore(query, d) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 15);
  if (!ranked.length) throw new HttpError(404, `no tool here matches "${needText.slice(0, 80)}"; nothing was charged. The full catalog is at ${ORIGIN}/discovery/resources`);
  let order = ranked;
  let method = "lexical";
  if (rerank && ranked.length > 1) {
    const scores = await rerank(needText, ranked.map(({ d }) => `${d.name}. ${d.summary}. ${d.description.slice(0, 400)}`)).catch(() => null);
    if (scores && scores.length === ranked.length) {
      // Blend: the reranker reads meaning, the lexical score keeps exact task names (a tool named for the phrase) on top.
      const top = ranked[0].s;
      order = ranked.map((x, i) => ({ ...x, s: 0.7 * scores[i] + 0.3 * (x.s / top) })).sort((a, b) => b.s - a.s);
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
      call: { method: "GET", url: `${ORIGIN}${d.path}${query ? `?${query}` : ""}` },
      requiredInputs: params.filter(([, p]) => p.required).map(([n, p]) => ({ name: n, description: p.description })),
      inFreeCalls: free(d.path),
      score: Math.round(s * 1000) / 1000,
    };
  });
  return {
    need: needText,
    picks,
    howToPay: `GET the call URL: unpaid it answers 402 with x402 terms (USDC on Base, Polygon, Arbitrum or Solana) and MPP; or send a card-credit key from ${ORIGIN}/credits as Authorization: Bearer. Failed calls are never charged; the first 25 calls per caller are free on tools in the free calls.`,
    mcp: `${ORIGIN}/mcp`,
    method,
  };
}

export const RECOMMEND: Entry[] = [
  entry("/recommend", "API recommendation: which API to call for a task",
    "Describe a task in plain words and get the best-matching paid API calls for it from a catalog of 320 tools (web search and page reading, LLM chat, token prices and chain reads on 5 networks, sanctions and company checks, weather, finance and utilities): each pick with the exact call URL, required inputs, price, MCP tool name and whether it is in the free calls. Use when an agent needs to find which API to call before paying for one.",
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
