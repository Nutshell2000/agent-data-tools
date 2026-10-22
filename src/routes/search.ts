// Web search, one Brave Search API request per paid call (key in SEARCH_API_KEY). Search is the largest category
// agents pay for over x402 (723 real payers a week on the Bazaar, Oct 2026). ON since 1.49.0 by Peter's decision of
// 22 Oct 2026 under the Brave Search API terms (api-dashboard.search.brave.com/terms-of-service, 1 Sep 2026):
// §3(a) licenses showing Search Results to the End Users of a Customer Application; §4(c) requires those end users
// to carry the §3(b) obligations, so the description and every answer state them (`terms` below); §3(b)(i) allows
// only transient storage, so nothing is cached here; §3(b)(xii) ("redistribute, resell") is the clause Peter accepted
// the risk on. Every paid call costs us one upstream request, so SEARCH_DAILY_CAP bounds the day's upstream spend
// to Brave's free monthly credits; above it the tool answers 503, uncharged.
import { entry, need, num, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";

/** Upstream requests per UTC day when SEARCH_DAILY_CAP is unset: about $2.50 at Brave's $5 per 1,000. */
const DEFAULT_DAILY_CAP = 500;

/** The Brave API terms' end-user obligations, stated in every answer (§4(c) of the terms). */
const TERMS = "Results are for the caller's immediate use: no storing or caching beyond the current task, no resale and no model training (Brave Search API terms).";

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
    "Search the web and get the top results as JSON: title, URL, a short snippet and the page age, from the Brave Search API. 1-20 results per call. Results are for the caller's immediate use only: no storing, resale or model training (Brave API terms). Upstream failures and exhausted daily capacity return 503, uncharged. Pair with /extract to read a result in full. Use when an agent needs current information or sources from the open web.",
    ["web-search", "search", "web", "research", "rag"], {
      q: { type: "string", description: "Search query, at most 400 characters", required: true, example: "x402 payment protocol" },
      count: { type: "integer", description: "Number of results (1-20, default 10)", example: 10 },
    },
    {
      query: "x402 payment protocol", provider: "Brave Search", count: 1,
      results: [{ title: "x402: an open payment protocol", url: "https://www.x402.org/", snippet: "x402 lets any HTTP API charge per request in stablecoins…", age: "2 days ago" }],
      terms: TERMS,
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
      return { query, provider: "Brave Search", count: results.length, results, terms: TERMS };
    }, "$0.01"),
];
