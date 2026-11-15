// Developer documentation search on our own index (15 Nov 2026, Beat-Exa plan 4c: "own index + ask Mojeek").
// The index (D1 web-docs, EU jurisdiction) is built from Common Crawl by scripts/web-index/build.mjs: per page the URL,
// title, description, headings and the start of the text. Keyword candidates (FTS5, title and headings weighted), then
// the same reranker as the EU law index. No outside search engine is asked, so nothing here touches the Brave cap.
// Results link to the publisher's page; we return a short snippet, never the page.
import { entry, num, need, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";
import { runAi } from "../lib/ai";
import { ftsQuery } from "./law-search";
import { RERANK_MODEL } from "./retrieval";

export interface DocRow { id: string; url: string; site: string; source: string; title: string; description: string; headings: string; text: string; crawled: string }

export interface DocsDeps {
  keywords(match: string, limit: number, site: string | null): Promise<DocRow[]>;
  rerank(q: string, docs: string[]): Promise<{ index: number; score: number }[] | null>;
}

/** A short snippet: the sentence of the text (or description) that shares most words with the question. */
export function snippet(row: Pick<DocRow, "text" | "description">, q: string, max = 300): string {
  const want = new Set(q.toLowerCase().split(/[^a-z0-9_.]+/).filter((w) => w.length > 2));
  const sentences = `${row.description ? `${row.description}. ` : ""}${row.text.slice(0, 4000)}`.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30);
  let best = sentences[0] ?? row.text.slice(0, max), score = -1;
  for (const s of sentences) {
    const hits = s.toLowerCase().split(/[^a-z0-9_.]+/).filter((w) => want.has(w)).length;
    if (hits > score) { best = s; score = hits; }
  }
  return best.length > max ? `${best.slice(0, max - 1)}…` : best;
}

export async function docsSearch(q: string, opts: { count: number; site: string | null }, deps: DocsDeps) {
  const match = ftsQuery(q);
  if (!match) throw new HttpError(400, "q needs at least one word of two or more letters");
  const candidates = await deps.keywords(match, 30, opts.site);
  if (!candidates.length) return { candidates: [] as DocRow[], scores: null as number[] | null };
  const ranked = await deps.rerank(q, candidates.map((r) => `${r.title}\n${r.headings.slice(0, 400)}\n${r.description}\n${r.text.slice(0, 1200)}`)).catch(() => null);
  if (!ranked?.length) return { candidates, scores: null };
  const order = ranked.filter((r) => r.index >= 0 && r.index < candidates.length).sort((a, b) => b.score - a.score);
  return { candidates: order.map((r) => candidates[r.index]), scores: order.map((r) => Math.round(r.score * 1000) / 1000) };
}

export function docsDeps(env: Env): DocsDeps {
  const db = env.WEB_DB;
  if (!db) throw new HttpError(503, "the documentation index is not available here; nothing was charged");
  return {
    async keywords(match, limit, site) {
      const r = await db.prepare(`SELECT p.* FROM pages_fts f JOIN pages p ON p.id = f.id WHERE pages_fts MATCH ?${site ? " AND p.url LIKE ?" : ""} ORDER BY bm25(pages_fts, 0, 10.0, 5.0, 3.0, 1.0) LIMIT ?`)
        .bind(match, ...(site ? [`%${site}%`] : []), limit).all<DocRow>();
      return r.results ?? [];
    },
    async rerank(q, docs) {
      const out = await runAi<{ response?: { id: number; score: number }[] }>(env, RERANK_MODEL, { query: q.slice(0, 1000), contexts: docs.map((text) => ({ text })), top_k: docs.length });
      return (out.response ?? []).map((r) => ({ index: r.id, score: r.score }));
    },
  };
}

/** The sites in the index, for the description and for routing /v1/search includeDomains here. */
export async function indexedSites(env: Env): Promise<string[]> {
  const r = await env.WEB_DB?.prepare("SELECT DISTINCT source FROM pages").all<{ source: string }>();
  return (r?.results ?? []).map((x) => x.source);
}

const ATTRIBUTION = "Index built from Common Crawl captures of each publisher's public documentation; follow the link for the page itself.";

export const DOCS_SEARCH: Entry[] = [
  entry("/docs/search", "Developer docs search",
    "Search developer documentation on our own index: MDN, React, Next.js, Python, Django, Node.js, TypeScript, Rust, Go, Kubernetes, Docker, Terraform, AWS, Cloudflare, Stripe, OpenAI, Anthropic, LangChain and about 100 more official docs sites. Returns the matching pages with title, URL, a snippet, the docs site and when the page was read. Use for coding agents that need the official page for an API, option or error.",
    ["docs-search", "developer-documentation", "code-search", "api-docs", "programming", "search"], {
      q: { type: "string", description: "What to look up, in plain words or with the API name", required: true, example: "abort a fetch request with AbortController" },
      site: { type: "string", description: "Only this docs site: a domain or part of a URL (react.dev, docs.python.org/3/library)", example: "developer.mozilla.org" },
      count: { type: "integer", description: "Results (1-10, default 5)", example: 5 },
    },
    {
      query: "abort a fetch request with AbortController", count: 1,
      results: [{ title: "AbortController - Web APIs | MDN", url: "https://developer.mozilla.org/en-US/docs/Web/API/AbortController", source: "MDN Web Docs", snippet: "The AbortController interface represents a controller object that allows you to abort one or more Web requests as and when desired.", crawled: "2026-10-12", score: 0.981 }],
      attribution: ATTRIBUTION,
    },
    async (env, q) => {
      const query = need(q, "q", 400);
      const site = opt(q, "site", 200)?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? null;
      const count = num(q, "count", { min: 1, max: 10, fallback: 5, integer: true });
      const found = await docsSearch(query, { count, site }, docsDeps(env));
      const results = found.candidates.slice(0, count).map((r, i) => ({
        title: r.title, url: r.url, source: r.source, snippet: snippet(r, query), crawled: r.crawled, ...(found.scores ? { score: found.scores[i] } : {}),
      }));
      if (!results.length) throw new HttpError(404, "no documentation page matches; nothing was charged");
      return { query, ...(site ? { site } : {}), count: results.length, results, attribution: ATTRIBUTION };
    }, "$0.003"), // 15 Nov 2026 (prices delegated): under Exa's cheapest search ($0.004); our own index, no per-query supplier cost
];
