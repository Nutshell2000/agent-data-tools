import { HttpError } from "../lib/env";

// Crossref REST API: free, keyless, metadata is public.
const CROSSREF = "https://api.crossref.org/works";
const FIELDS = "DOI,title,author,issued,container-title,is-referenced-by-count,type,abstract,URL,publisher";

interface Work {
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

// Abstracts arrive as JATS XML fragments.
const plain = (s?: string) => (s ? s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null);

export async function searchPapers(queryParam: string | undefined, limitParam?: string, fromYearParam?: string) {
  const query = (queryParam ?? "").trim();
  if (query.length < 3 || query.length > 300) throw new HttpError(400, "query must be 3 to 300 characters");
  const limit = Math.min(Math.max(Math.trunc(Number(limitParam)) || 5, 1), 20);
  const fromYear = Math.trunc(Number(fromYearParam)) || null;
  if (fromYear !== null && (fromYear < 1800 || fromYear > 2100)) throw new HttpError(400, "fromYear must be a four-digit year");

  const url = new URL(CROSSREF);
  url.searchParams.set("query", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("select", FIELDS);
  if (fromYear) url.searchParams.set("filter", `from-pub-date:${fromYear}`);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "AgentDataTools/1.0" } });
  } catch {
    throw new HttpError(504, "the paper index did not respond in time");
  }
  if (!res.ok) throw new HttpError(502, `the paper index returned HTTP ${res.status}`);
  const body = (await res.json()) as { message?: { "total-results"?: number; items?: Work[] } };

  const results = (body.message?.items ?? []).map((w) => {
    const abstract = plain(w.abstract);
    return {
      title: plain(w.title?.[0]) ?? "(untitled)",
      authors: (w.author ?? []).slice(0, 8).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")),
      year: w.issued?.["date-parts"]?.[0]?.[0] ?? null,
      venue: w["container-title"]?.[0] ?? w.publisher ?? null,
      type: w.type ?? null,
      citations: w["is-referenced-by-count"] ?? 0,
      doi: w.DOI ?? null,
      url: w.DOI ? `https://doi.org/${w.DOI}` : w.URL ?? null,
      abstract: abstract && abstract.length > 1200 ? `${abstract.slice(0, 1200)}…` : abstract,
    };
  });
  return { query, fromYear, totalMatches: body.message?.["total-results"] ?? results.length, returned: results.length, results, source: "Crossref" };
}
