import { HttpError } from "../lib/env";

// OpenAlex ranks by relevance and citations and finds well-known papers reliably.
// Crossref is the fallback: broader, but its ranking is weaker and it rate-limits.
const OPENALEX = "https://api.openalex.org/works";
const CROSSREF = "https://api.crossref.org/works";
const HEADERS = { "user-agent": "AgentDataTools/1.0" };

interface Paper {
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  type: string | null;
  citations: number;
  doi: string | null;
  url: string | null;
  abstract: string | null;
}

const clip = (s: string | null) => (s && s.length > 1200 ? `${s.slice(0, 1200)}…` : s);
// Crossref abstracts arrive as JATS XML fragments.
const plain = (s?: string) =>
  s
    ? s
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim()
    : null;

interface OpenAlexWork {
  title?: string;
  authorships?: { author?: { display_name?: string } }[];
  publication_year?: number;
  primary_location?: { source?: { display_name?: string } };
  type?: string;
  cited_by_count?: number;
  doi?: string;
  id?: string;
  abstract_inverted_index?: Record<string, number[]>;
}

/** OpenAlex stores abstracts as word -> positions; this puts the words back in order. */
function rebuildAbstract(index?: Record<string, number[]>): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  return words.join(" ").replace(/\s+/g, " ").trim() || null;
}

async function fromOpenAlex(query: string, limit: number, fromYear: number | null) {
  const url = new URL(OPENALEX);
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(limit));
  url.searchParams.set("select", "id,title,authorships,publication_year,primary_location,type,cited_by_count,doi,abstract_inverted_index");
  if (fromYear) url.searchParams.set("filter", `from_publication_date:${fromYear}-01-01`);
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: HEADERS });
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  const body = (await res.json()) as { meta?: { count?: number }; results?: OpenAlexWork[] };
  const results: Paper[] = (body.results ?? []).map((w) => ({
    title: w.title ?? "(untitled)",
    authors: (w.authorships ?? []).slice(0, 8).map((a) => a.author?.display_name ?? "").filter(Boolean),
    year: w.publication_year ?? null,
    venue: w.primary_location?.source?.display_name ?? null,
    type: w.type ?? null,
    citations: w.cited_by_count ?? 0,
    doi: w.doi?.replace("https://doi.org/", "") ?? null,
    url: w.doi ?? w.id ?? null,
    abstract: clip(rebuildAbstract(w.abstract_inverted_index)),
  }));
  return { total: body.meta?.count ?? results.length, results, source: "OpenAlex" };
}

interface CrossrefWork {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  "is-referenced-by-count"?: number;
  type?: string;
  abstract?: string;
  URL?: string;
  publisher?: string;
}

async function fromCrossref(query: string, limit: number, fromYear: number | null) {
  const url = new URL(CROSSREF);
  url.searchParams.set("query.title", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("select", "DOI,title,author,issued,container-title,is-referenced-by-count,type,abstract,URL,publisher");
  if (fromYear) url.searchParams.set("filter", `from-pub-date:${fromYear}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: HEADERS });
  if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);
  const body = (await res.json()) as { message?: { "total-results"?: number; items?: CrossrefWork[] } };
  const results: Paper[] = (body.message?.items ?? []).map((w) => ({
    title: plain(w.title?.[0]) ?? "(untitled)",
    authors: (w.author ?? []).slice(0, 8).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")),
    year: w.issued?.["date-parts"]?.[0]?.[0] ?? null,
    venue: w["container-title"]?.[0] ?? w.publisher ?? null,
    type: w.type ?? null,
    citations: w["is-referenced-by-count"] ?? 0,
    doi: w.DOI ?? null,
    url: w.DOI ? `https://doi.org/${w.DOI}` : w.URL ?? null,
    abstract: clip(plain(w.abstract)),
  }));
  return { total: body.message?.["total-results"] ?? results.length, results, source: "Crossref" };
}

export async function searchPapers(queryParam: string | undefined, limitParam?: string, fromYearParam?: string) {
  const query = (queryParam ?? "").trim();
  if (query.length < 3 || query.length > 300) throw new HttpError(400, "query must be 3 to 300 characters");
  const limit = Math.min(Math.max(Math.trunc(Number(limitParam)) || 5, 1), 20);
  const fromYear = Math.trunc(Number(fromYearParam)) || null;
  if (fromYear !== null && (fromYear < 1800 || fromYear > 2100)) throw new HttpError(400, "fromYear must be a four-digit year");

  const found = await fromOpenAlex(query, limit, fromYear).catch((e) => {
    console.error(`papers: ${e}; falling back to Crossref`);
    return fromCrossref(query, limit, fromYear).catch(() => {
      throw new HttpError(502, "the paper indexes did not respond");
    });
  });
  return { query, fromYear, totalMatches: found.total, returned: found.results.length, results: found.results, source: found.source };
}
