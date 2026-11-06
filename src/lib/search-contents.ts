// Search API 2.0 (6 Nov 2026): what a paid /search answer can carry beyond Brave's title and snippet, in the shape the
// neural-search SDKs ask for (contents.text, contents.highlights, contents.summary). Web search is the biggest paid
// category on the Coinbase Bazaar (~$1,700 in 30 days over 385 sellers, 5 Nov 2026), led by Exa-shaped listings; an agent
// that knows that request shape gets the same fields from us. Everything after the one Brave request is our own work:
// pages read through extract() in parallel, highlights picked locally, summaries from Workers AI. A page that cannot be
// read keeps its snippet, so one slow site never fails the call.
import { extract } from "../routes/extract";
import { pdfUrl, readPdf } from "../routes/pdf";
import { HttpError } from "./env";
import { fetchFile } from "./fetch";

export interface Hit {
  title: string;
  url: string;
  snippet: string;
  age: string | null;
  publishedDate: string | null;
  author: string | null;
  domain: string;
  favicon: string | null;
  image: string | null;
}

export interface ContentsOptions {
  /** Characters of page text to return per result (0 = none). */
  textChars: number;
  /** Highlights: sentences per highlight (0 = none). */
  numSentences: number;
  highlightsPerUrl: number;
  highlightQuery?: string;
  summary: boolean;
  summaryQuery?: string;
  /** How many of the top results to read (pages beyond keep their snippet). */
  readTop: number;
}

export type Enriched = Hit & { text?: string; highlights?: string[]; highlightScores?: number[]; summary?: string | null; readError?: string };

const STOP = new Set("a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with you your".split(" "));

/** Lower-case query words worth matching: no stop words, no one- or two-letter words. */
export function queryTerms(q: string): string[] {
  return [...new Set(q.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w)))];
}

/**
 * Page chrome that reads like a sentence once the markup is gone (6 Nov 2026, staging: GitHub pages highlighted "Repository
 * navigation [Image alt text: …] - Notifications - Fork (2.3k)").
 */
const CHROME = /\[Image alt text|Skip to (main )?content|\b(Notifications|Fork|Star) \(?\d|\bcookies?\b.{0,40}\b(accept|consent|policy)|\bSign (in|up)\b.{0,30}\bSign (in|up)\b/i;
const isChrome = (s: string) => CHROME.test(s) || (s.match(/ [-·|•] /g)?.length ?? 0) >= 3;

/** Sentences of readable length from page text, without navigation and cookie chrome. */
export function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'(])/u).map((s) => s.trim()).filter((s) => s.length >= 30 && s.length <= 600 && !isChrome(s));
}

/**
 * The passages of `text` that best match `query`: windows of `numSentences` sentences around the sentences holding the most
 * distinct query words (a word also counts when it starts a longer word: "protocol" matches "protocols"), earlier wins a
 * tie. Scores are the share of query words in the window, 0 to 1. Windows never overlap.
 */
export function highlights(text: string, query: string, numSentences = 3, perUrl = 1): { highlights: string[]; scores: number[] } {
  const terms = queryTerms(query);
  const sent = sentences(text);
  if (!sent.length) return { highlights: [], scores: [] };
  const words = sent.map((s) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u));
  const hits = (i: number) => terms.filter((t) => words[i].some((w) => w === t || (t.length > 3 && w.startsWith(t)))).length;
  const order = sent.map((_, i) => i).sort((a, b) => hits(b) - hits(a) || a - b);
  const taken: number[][] = [];
  for (const i of order) {
    if (taken.length >= perUrl) break;
    const start = Math.max(0, Math.min(i, sent.length - numSentences));
    const span = Array.from({ length: Math.min(numSentences, sent.length) }, (_, k) => start + k);
    if (taken.some((t) => t.some((x) => span.includes(x)))) continue;
    taken.push(span);
  }
  const out = taken.map((span) => {
    const passage = span.map((k) => sent[k]).join(" ");
    const matched = terms.length ? new Set(span.flatMap((k) => terms.filter((t) => words[k].some((w) => w === t || (t.length > 3 && w.startsWith(t)))))).size / terms.length : 0;
    return { passage, score: Math.round(matched * 1000) / 1000 };
  });
  return { highlights: out.map((o) => o.passage), scores: out.map((o) => o.score) };
}

type Page = { text?: string; title?: string | null; sourceMetadata?: { authors?: { value: string }[]; dates?: { value: string; kind?: string }[] } };
type Reader = (url: string, chars: number) => Promise<Page>;
type Summarizer = (text: string, title: string, focus: string) => Promise<string>;

/** Reads, highlights and summarizes the top results as asked; every step is per page and never fails the call. */
export async function enrich(hits: Hit[], query: string, o: ContentsOptions, read: Reader, summarize: Summarizer): Promise<Enriched[]> {
  const wantsPage = o.textChars > 0 || o.numSentences > 0 || o.summary;
  if (!wantsPage) return hits;
  // Highlights and summaries need more text than a short text= preview returns.
  const readChars = Math.max(o.textChars, o.numSentences > 0 || o.summary ? 12_000 : 0);
  const pages = await Promise.all(hits.map((h, i) => (i < o.readTop ? read(h.url, readChars).then((p) => ({ page: p, error: null }), (e: unknown) => ({ page: null, error: String((e as Error)?.message ?? e).slice(0, 160) })) : Promise.resolve({ page: null, error: null }))));
  return Promise.all(hits.map(async (h, i): Promise<Enriched> => {
    const { page, error } = pages[i];
    const full = page?.text ?? "";
    const out: Enriched = { ...h };
    if (!h.author) out.author = page?.sourceMetadata?.authors?.[0]?.value ?? null;
    if (!h.publishedDate) {
      const d = page?.sourceMetadata?.dates?.find((x) => /publish|created|date/i.test(x.kind ?? "date"))?.value;
      const t = d ? Date.parse(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(d) ? `${d}Z` : d) : NaN;
      if (Number.isFinite(t)) out.publishedDate = new Date(t).toISOString();
    }
    if (o.textChars > 0) out.text = full ? full.slice(0, o.textChars) : h.snippet;
    if (o.numSentences > 0) {
      const hl = full ? highlights(full, o.highlightQuery || query, o.numSentences, o.highlightsPerUrl) : { highlights: [], scores: [] };
      out.highlights = hl.highlights.length ? hl.highlights : h.snippet ? [h.snippet] : [];
      out.highlightScores = hl.highlights.length ? hl.scores : out.highlights.map(() => 0);
    }
    if (o.summary) {
      out.summary = full ? await summarize(full.slice(0, 6_000), h.title, o.summaryQuery || query).catch(() => null) : null;
    }
    if (error && i < o.readTop) out.readError = error;
    return out;
  }));
}

/** A PDF result (whitepapers, filings, papers) read through the PDF tool's reader: the first 5 pages. */
async function readPdfPage(url: string, chars: number): Promise<Page> {
  const file = await fetchFile(pdfUrl(url), /^/, 10 * 1024 * 1024, "a PDF", { cacheSeconds: 600, budgetMs: 10_000 });
  const pdf = await readPdf(file.bytes, 1, 5, Math.max(1_000, chars)) as { title?: string | null; author?: string | null; pages?: { text: string }[] };
  return { title: pdf.title ?? null, text: (pdf.pages ?? []).map((p) => p.text).join("\n\n"), sourceMetadata: { authors: pdf.author ? [{ value: pdf.author }] : [], dates: [] } };
}

/**
 * extract() as the search reader: an 8 s budget and no archive detour, because the snippet is already there. PDF results
 * go to the PDF reader (6 Nov 2026 staging: x402's whitepaper came back "unsupported content type: application/pdf").
 */
export const readPage: Reader = async (url, chars) => {
  const budget = String(Math.min(100_000, Math.max(500, chars)));
  if (/\.pdf($|[?#])/i.test(url) || /^https?:\/\/(www\.)?arxiv\.org\/abs\//i.test(url)) return readPdfPage(url, chars);
  try {
    return await (extract(url, budget, "text", undefined, { budgetMs: 8_000, archiveFallback: false }) as Promise<Page>);
  } catch (e) {
    if (e instanceof HttpError && e.status === 415 && /pdf/i.test(e.message)) return readPdfPage(url, chars);
    throw e;
  }
};
