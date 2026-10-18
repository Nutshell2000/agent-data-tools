// Web search, resold per call. Search is the largest category agents pay for over x402,
// but it needs a paid upstream: Brave Search API, with the key in SEARCH_API_KEY.
// Listed in PAUSED_FAMILY_TOOLS until the key is set and Brave's terms are confirmed to
// permit this resale; every paid call costs us an upstream request, so SEARCH_DAILY_CAP
// bounds the daily spend.
import { entry, need, num, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";

/** Upstream requests per UTC day when SEARCH_DAILY_CAP is unset: about $2.50 at Brave's $5 per 1,000. */
const DEFAULT_DAILY_CAP = 500;

/** Counts one upstream request; KV is eventually consistent, so the cap is approximate. */
async function takeSearchBudget(env: Env): Promise<void> {
  if (!env.TRIALS) throw new HttpError(503, "search is not configured on this deployment", "SEARCH_UNAVAILABLE");
  const cap = Number(env.SEARCH_DAILY_CAP) || DEFAULT_DAILY_CAP;
  const key = `search:${new Date().toISOString().slice(0, 10)}`;
  const used = Number(await env.TRIALS.get(key)) || 0;
  if (used >= cap) throw new HttpError(503, "today's search capacity is used up; try again after 00:00 UTC", "SEARCH_CAPACITY");
  await env.TRIALS.put(key, String(used + 1), { expirationTtl: 172_800 });
}

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

export const SEARCH: Entry[] = [
  entry("/search", "Web search results",
    "Search the web and get the top results as JSON: title, URL, a short snippet and the page age where known, from the Brave Search API. 1-20 results per call. Upstream failures and exhausted daily capacity return 503, uncharged. Pair with /extract to read a result in full. Use when an agent needs current information or sources from the open web.",
    ["search", "web", "research", "rag"], {
      q: { type: "string", description: "Search query, at most 400 characters", required: true, example: "x402 payment protocol" },
      count: { type: "integer", description: "Number of results (1-20, default 10)", example: 10 },
    },
    {
      query: "x402 payment protocol", provider: "Brave Search", count: 1,
      results: [{ title: "x402: an open payment protocol", url: "https://www.x402.org/", snippet: "x402 lets any HTTP API charge per request in stablecoins…", age: "2 days ago" }],
    },
    async (env, q) => {
      const query = need(q, "q", 400);
      const count = num(q, "count", { min: 1, max: 20, fallback: 10, integer: true });
      if (!env.SEARCH_API_KEY) throw new HttpError(503, "search is not configured on this deployment", "SEARCH_UNAVAILABLE");
      await takeSearchBudget(env);
      let res: Response;
      try {
        res = await fetch(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: String(count) })}`, {
          headers: { accept: "application/json", "x-subscription-token": env.SEARCH_API_KEY },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new HttpError(503, "the search provider did not answer in time; try again");
      }
      if (!res.ok) throw new HttpError(503, `the search provider answered HTTP ${res.status}; try again`);
      const body = (await res.json().catch(() => null)) as { web?: { results?: BraveResult[] } } | null;
      if (!body) throw new HttpError(503, "the search provider sent an unreadable answer");
      const results = (body.web?.results ?? [])
        .filter((r) => r.url && r.title)
        .slice(0, count)
        .map((r) => ({ title: stripTags(r.title!), url: r.url!, snippet: stripTags(r.description ?? ""), age: r.age ?? null }));
      return { query, provider: "Brave Search", count: results.length, results };
    }, "$0.01"),
];
