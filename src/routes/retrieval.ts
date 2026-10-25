// Retrieval tools for agents (25 Oct 2026). Bazaar search that day, nothing of ours in the results: "get contents" (107 payers
// summed over the top 20; a search-API resale has 56 and the search API itself 36), "web contents" (69) and "rerank" (29).
// `/contents` reads several pages in one call with the same reader as /extract; `/ai/rerank` runs BAAI's bge-reranker-base
// (MIT) on Workers AI, a fraction of a cent per call.
import { entry, need, num, opt, type Entry } from "../family";
import { runAi } from "../lib/ai";
import { HttpError } from "../lib/env";
import { extract } from "./extract";

/**
 * A list input as agents send it: a JSON array (a POST body array that held commas arrives this way), one item per line,
 * or comma-separated.
 */
export function listInput(raw: string): string[] {
  const s = raw.trim();
  if (s.startsWith("[")) {
    let parsed: unknown;
    try { parsed = JSON.parse(s); } catch { throw new HttpError(400, "the list looks like JSON but is not a valid JSON array"); }
    if (!Array.isArray(parsed)) throw new HttpError(400, "the list must be a JSON array");
    return parsed.map((v) => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string" ? (v as { text: string }).text : String(v ?? ""))).map((v) => v.trim()).filter(Boolean);
  }
  return (s.includes("\n") ? s.split(/\r?\n/) : s.split(",")).map((v) => v.trim()).filter(Boolean);
}

const MAX_PAGES = 5;
type Page = { finalUrl: string; title?: string | null; text?: string; markdown?: string; textLength: number; truncated: boolean; lang?: string | null; sourceMetadata?: { authors: { value: string }[]; dates: { value: string; kind: string }[] } };

export async function contents(urlsRaw: string, maxChars: number, format: "text" | "markdown") {
  const urls = [...new Set(listInput(urlsRaw))];
  if (!urls.length) throw new HttpError(400, "urls is required: one to five page URLs");
  if (urls.length > MAX_PAGES) throw new HttpError(400, `at most ${MAX_PAGES} URLs per call (got ${urls.length})`);
  const settled = await Promise.allSettled(urls.map((u) => extract(u, String(maxChars), format) as Promise<Page>));
  const results: Record<string, unknown>[] = [];
  const statuses = settled.map((s, i) => {
    if (s.status === "fulfilled") {
      const p = s.value;
      results.push({
        id: urls[i], url: p.finalUrl, title: p.title ?? null,
        author: p.sourceMetadata?.authors[0]?.value ?? null,
        publishedDate: p.sourceMetadata?.dates.find((d) => d.kind === "published")?.value ?? null,
        ...(format === "markdown" ? { markdown: p.markdown ?? "" } : { text: p.text ?? "" }),
        textLength: p.textLength, truncated: p.truncated, lang: p.lang ?? null,
      });
      return { id: urls[i], status: "success" };
    }
    const e = s.reason;
    return { id: urls[i], status: "error", error: e instanceof HttpError ? e.message : "the page could not be read" };
  });
  // Nothing read: refuse, so the caller is not charged (one bad URL alone keeps its own status code).
  if (!results.length) {
    const only = settled.length === 1 ? (settled[0] as PromiseRejectedResult).reason : null;
    if (only instanceof HttpError) throw only;
    throw new HttpError(502, `none of the ${urls.length} pages could be read; nothing was charged`);
  }
  return { results, statuses, requested: urls.length, read: results.length };
}

export const RERANK_MODEL = "@cf/baai/bge-reranker-base";
const MAX_DOCS = 50, DOC_CHARS = 2000, TOTAL_CHARS = 40_000;

export async function rerank(run: (model: string, input: unknown) => Promise<unknown>, query: string, docsRaw: string, topN?: number) {
  const docs = listInput(docsRaw);
  if (!docs.length) throw new HttpError(400, "documents is required: a JSON array of strings, or one document per line");
  if (docs.length > MAX_DOCS) throw new HttpError(400, `at most ${MAX_DOCS} documents per call (got ${docs.length})`);
  const clipped = docs.map((d) => d.slice(0, DOC_CHARS));
  if (clipped.reduce((a, d) => a + d.length, 0) > TOTAL_CHARS) throw new HttpError(400, `documents may hold at most ${TOTAL_CHARS} characters in all`);
  const out = await run(RERANK_MODEL, { query, contexts: clipped.map((text) => ({ text })), top_k: clipped.length }) as { response?: { id: number; score: number }[] };
  const scored = Array.isArray(out?.response) ? out.response : null;
  if (!scored?.length) throw new HttpError(502, "the rerank model returned no scores");
  const results = [...scored]
    .filter((r) => Number.isInteger(r.id) && r.id >= 0 && r.id < docs.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN ?? docs.length)
    .map((r) => ({ index: r.id, relevance_score: Math.round(r.score * 1e6) / 1e6, document: docs[r.id] }));
  return { query, results, documents: docs.length, clippedDocuments: docs.filter((d) => d.length > DOC_CHARS).length, model: RERANK_MODEL };
}

export const RETRIEVAL: Entry[] = [
  entry("/contents", "Get contents, web contents: clean text of up to five pages in one call",
    "Read one to five public web pages in one call and get each one's clean text (or Markdown), title, author and published date where the page declares them, in the request shape search APIs use (urls as a list). Pages are read in parallel; one that cannot be read is listed in statuses with its reason and the rest still answer. Static HTML, Markdown and plain text, up to 20,000 characters a page. Use to read search results in one call.",
    ["get-contents", "web-contents", "page-contents", "web-scraping", "read-url"], {
      urls: { type: "string", description: "One to five page URLs: comma-separated, one per line, or a JSON array", required: true, example: "https://example.com,https://www.iana.org/help/example-domains" },
      maxChars: { type: "string", description: "Characters per page, 500 to 20000 (default 4000)", example: "3000" },
      format: { type: "string", description: "text (default) or markdown", example: "text" },
    },
    { results: [{ id: "https://example.com", url: "https://example.com/", title: "Example Domain", author: null, publishedDate: null, text: "This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.", textLength: 156, truncated: false, lang: "en" }], statuses: [{ id: "https://example.com", status: "success" }, { id: "https://www.iana.org/help/example-domains", status: "success" }], requested: 2, read: 2 },
    (_env, q) => {
      const format = (opt(q, "format", 20) ?? "text").toLowerCase();
      if (format !== "text" && format !== "markdown") throw new HttpError(400, "format must be text or markdown");
      return contents(need(q, "urls", 5000), num(q, "maxChars", { min: 500, max: 20_000, fallback: 4000, integer: true }), format);
    }, "$0.01"),

  entry("/ai/rerank", "Rerank documents by relevance: reranker for RAG",
    "Order up to 50 documents by how well each answers a query, with a relevance score from 0 to 1 (BAAI bge-reranker-base, a cross-encoder). Send documents as a JSON array or one per line; each is read up to 2,000 characters, 40,000 in all. Returns the original index, score and text, best first; top_n keeps only the best. Also available in the Cohere-style shape at /v1/rerank. Use to pick what a model reads after search or vector retrieval.",
    ["rerank", "reranker", "rag", "relevance", "ai"], {
      query: { type: "string", description: "What the documents should answer (up to 2,000 characters)", required: true, example: "What is the capital of France?" },
      documents: { type: "string", description: "Up to 50 documents: a JSON array of strings, or one per line", required: true, example: "[\"France has hundreds of cheeses.\",\"Berlin is the capital of Germany.\",\"Paris is the capital and largest city of France.\"]" },
      top_n: { type: "string", description: "Keep only the best N results (default all)", example: "2" },
    },
    { query: "What is the capital of France?", results: [{ index: 2, relevance_score: 0.999785, document: "Paris is the capital and largest city of France." }, { index: 1, relevance_score: 0.025102, document: "Berlin is the capital of Germany." }], documents: 3, clippedDocuments: 0, model: RERANK_MODEL },
    (env, q) => {
      const topRaw = opt(q, "top_n", 10) ?? opt(q, "top_k", 10) ?? opt(q, "topN", 10);
      const topN = topRaw === undefined ? undefined : num(() => topRaw, "top_n", { min: 1, max: MAX_DOCS, integer: true });
      return rerank((model, input) => runAi(env, model, input as Record<string, unknown>), need(q, "query", 2000), need(q, "documents", 60_000), topN);
    }, "$0.002"),
];
