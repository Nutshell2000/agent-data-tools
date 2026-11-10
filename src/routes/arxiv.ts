/**
 * arXiv paper search (10 Nov 2026). Demand measured that day: Mercator's router sent one arXiv search listing 64 calls in
 * 30 days, the Bazaar's seven arXiv listings had 79 calls (the leader 7 distinct payers at $0.003), and we sold only a
 * Crossref search (/papers), which holds no preprints.
 * Source: arXiv's public API (export.arxiv.org/api/query, keyless, Atom). arXiv's metadata is CC0; its API terms ask for
 * at most one request every three seconds per client and for the acknowledgement carried in `attribution`. Answers are
 * kept at the edge for 15 minutes, so a repeated search does not reach arXiv again. Checked from Cloudflare's network on
 * 10 Nov 2026 (a production trial of /url/uptime: 200 in 326 ms).
 * Workers have no XML parser, and an Atom entry here is flat, so entries are read with small regular expressions.
 */
import { entry, need, num, opt, pick, type Entry } from "../family";
import { HttpError } from "../lib/env";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const API = "https://export.arxiv.org/api/query";
const UA = { "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)", accept: "application/atom+xml" };
export const ARXIV_SOURCE = "arXiv API (metadata CC0)";
export const ARXIV_ATTRIBUTION = "Thank you to arXiv for use of its open access interoperability.";

/** New-style (2401.01234, optional v2) and old-style (hep-th/9901001) identifiers, bare or inside an arxiv.org link. */
const NEW_ID = /(?:^|[^\d.])(\d{4}\.\d{4,5})(v\d+)?(?![\d.]*\d)/;
const OLD_ID = /(?:^|[\s/:])([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?(?!\d)/;
export function arxivId(raw: string): string | null {
  const s = raw.trim().replace(/^arxiv:\s*/i, "").replace(/\.pdf$/i, "");
  const linked = /arxiv\.org\/(?:abs|pdf|html)\/([^\s?#]+)/i.exec(s)?.[1]?.replace(/\.pdf$/i, "");
  const text = linked ?? s;
  // A bare identifier or a link only: free text that merely mentions a number is a search.
  if (!linked && /\s/.test(text)) return null;
  const m = NEW_ID.exec(text) ?? OLD_ID.exec(` ${text}`);
  return m ? `${m[1]}${m[2] ?? ""}` : null;
}

/** Search words -> arXiv's query language: every word must match (all:a AND all:b); a quoted phrase stays a phrase. */
export function arxivQuery(q: string, category?: string): string {
  const parts: string[] = [];
  const phrases = [...q.matchAll(/"([^"]{2,120})"/g)].map((m) => m[1].replace(/[^\p{L}\p{N} .+-]/gu, " ").trim()).filter(Boolean);
  for (const p of phrases.slice(0, 3)) parts.push(`all:"${p}"`);
  const rest = q.replace(/"[^"]*"/g, " ").replace(/[^\p{L}\p{N}.+-]+/gu, " ").trim().split(/\s+/)
    // Single letters carry no meaning in a search, and arXiv's own operator words must not arrive as operators.
    .filter((w) => (w.length > 1 || /\d/.test(w)) && !/^(and|or|andnot|not)$/i.test(w));
  for (const w of rest.slice(0, 10)) parts.push(`all:${w}`);
  if (!parts.length) throw new HttpError(400, "q must hold at least one search word, or an arXiv ID such as 1706.03762");
  if (category) parts.push(`cat:${category}`);
  return parts.join(" AND ");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
  if (code[0] === "#") { const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole; }
  return Object.hasOwn(ENTITIES, code.toLowerCase()) ? ENTITIES[code.toLowerCase()] : whole;
});
const tidy = (s: string | undefined) => (s === undefined ? null : decode(s).replace(/\s+/g, " ").trim() || null);
const tag = (xml: string, name: string) => tidy(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export interface ArxivPaper {
  id: string; version: number | null; title: string | null; summary: string | null; authors: string[]; authorsTotal: number;
  published: string | null; updated: string | null; primaryCategory: string | null; categories: string[];
  comment: string | null; journalRef: string | null; doi: string | null; url: string; pdf: string;
}

/** The Atom answer as { total, papers }; arXiv reports a bad request as an entry whose id is an errors link. */
export function parseArxiv(xml: string): { total: number; papers: ArxivPaper[] } {
  const total = Number(/<opensearch:totalResults[^>]*>(\d+)</.exec(xml)?.[1] ?? 0);
  const papers: ArxivPaper[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const rawId = tag(e, "id") ?? "";
    if (/\/api\/errors/.test(rawId)) throw new HttpError(400, `arXiv refused the request: ${clip(tag(e, "summary") ?? "bad request", 160)}`);
    const full = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, "");
    const v = /v(\d+)$/.exec(full);
    const id = full.replace(/v\d+$/, "");
    if (!id) continue;
    const authors = [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => tidy(a[1])).filter((a): a is string => a !== null);
    const categories = [...new Set([...e.matchAll(/<category\s+term="([^"]+)"/g)].map((c) => decode(c[1])))];
    const summary = tag(e, "summary");
    papers.push({
      id, version: v ? Number(v[1]) : null, title: tag(e, "title"), summary: summary ? clip(summary, 1200) : null,
      authors: authors.slice(0, 12), authorsTotal: authors.length,
      published: tag(e, "published")?.slice(0, 10) ?? null, updated: tag(e, "updated")?.slice(0, 10) ?? null,
      primaryCategory: /<arxiv:primary_category\s+term="([^"]+)"/.exec(e)?.[1] ?? categories[0] ?? null, categories: categories.slice(0, 8),
      comment: tag(e, "arxiv:comment"), journalRef: tag(e, "arxiv:journal_ref"), doi: tag(e, "arxiv:doi"),
      url: `https://arxiv.org/abs/${id}`, pdf: `https://arxiv.org/pdf/${id}`,
    });
  }
  return { total: Math.max(total, papers.length), papers };
}

/** One read of arXiv's API, asked once more after a busy answer; a still-busy arXiv is an uncharged 503. */
export async function arxivRead(params: Record<string, string>, fetcher: Fetcher = fetch, sleep: (ms: number) => Promise<unknown> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<string> {
  const url = `${API}?${new URLSearchParams(params)}`;
  const read = () => fetcher(url, { headers: UA, signal: AbortSignal.timeout(9_000), cf: { cacheTtl: 900, cacheEverything: true } } as RequestInit);
  let res: Response;
  try {
    res = await read();
    if (res.status === 429 || res.status >= 500) { await res.body?.cancel().catch(() => {}); await sleep(1_200); res = await read(); }
  } catch {
    throw new HttpError(502, "arXiv did not answer in time; not charged, try again");
  }
  if (res.status === 429 || res.status === 503) throw new HttpError(503, "arXiv is busy; not charged, try again in a minute", "ARXIV_BUSY");
  // A malformed id_list is a 400 whose body is an Atom error entry: parseArxiv turns it into our own 400.
  if (!res.ok && res.status !== 400) throw new HttpError(502, `arXiv answered HTTP ${res.status}; not charged, try again`);
  return res.text();
}

const SORTS = ["relevance", "newest", "updated"] as const;
const SORT_BY = { relevance: "relevance", newest: "submittedDate", updated: "lastUpdatedDate" } as const;
const CATEGORY = /^[a-z-]+(\.[A-Za-z-]{2,})?$/;

export const ARXIV: Entry[] = [
  entry("/arxiv/search", "arXiv search: preprints by topic, or one paper by ID",
    "Search arXiv, the open preprint server for physics, mathematics, computer science and AI: give search words (every word must match, quotes for a phrase) and optionally a category such as cs.AI, and get 1-20 papers by relevance or newest first, each with title, abstract, authors, dates, categories, DOI and PDF link. An arXiv ID or link returns that paper. Use to find research on a topic, cite a paper or read its abstract before the PDF.",
    ["arxiv-search", "arxiv", "research-papers", "paper-search", "preprints", "academic", "science"], {
      q: { type: "string", description: "Search words, or an arXiv ID or link (1706.03762, arxiv.org/abs/2401.01234)", required: true, example: "retrieval augmented generation" },
      count: { type: "integer", description: "Papers to return (1-20, default 5)", example: 5 },
      sort: { type: "string", description: "relevance (default), newest (submission date) or updated", enum: SORTS, example: "relevance" },
      category: { type: "string", description: "Optional arXiv category to search in, e.g. cs.AI, cs.CL, stat.ML, hep-th", example: "cs.CL" },
    },
    {
      query: "retrieval augmented generation", total: 4912, count: 1,
      papers: [{
        id: "2005.11401", version: 4, title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
        summary: "Large pre-trained language models have been shown to store factual knowledge in their parameters, and achieve state-of-the-art results when fine-tuned on downstream NLP tasks. …",
        authors: ["Patrick Lewis", "Ethan Perez", "Aleksandra Piktus"], authorsTotal: 12, published: "2020-05-22", updated: "2021-04-12",
        primaryCategory: "cs.CL", categories: ["cs.CL", "cs.LG"], comment: "Accepted at NeurIPS 2020", journalRef: null, doi: null,
        url: "https://arxiv.org/abs/2005.11401", pdf: "https://arxiv.org/pdf/2005.11401",
      }],
      source: ARXIV_SOURCE, attribution: ARXIV_ATTRIBUTION, checkedAt: "2026-11-10T22:00:00.000Z",
    },
    async (_env, q) => {
      const raw = need(q, "q", 300);
      const id = arxivId(raw);
      if (id) {
        const { papers } = parseArxiv(await arxivRead({ id_list: id, max_results: "1" }));
        if (!papers.length) throw new HttpError(404, `no arXiv paper ${id}; nothing was charged`);
        return { query: id, total: 1, count: 1, papers, source: ARXIV_SOURCE, attribution: ARXIV_ATTRIBUTION, checkedAt: new Date().toISOString() };
      }
      const count = num(q, "count", { min: 1, max: 20, fallback: 5, integer: true });
      const sort = pick(q, "sort", SORTS, "relevance");
      const category = opt(q, "category", 30);
      if (category && !CATEGORY.test(category)) throw new HttpError(400, "category must be an arXiv category such as cs.AI, stat.ML or hep-th");
      const { total, papers } = parseArxiv(await arxivRead({ search_query: arxivQuery(raw, category), start: "0", max_results: String(count), sortBy: SORT_BY[sort], sortOrder: "descending" }));
      if (!papers.length) throw new HttpError(404, `no arXiv paper matches ${clip(raw, 80)}; nothing was charged`);
      return { query: raw, total, count: papers.length, papers, source: ARXIV_SOURCE, attribution: ARXIV_ATTRIBUTION, checkedAt: new Date().toISOString() };
    }),
];
