// Search-API request shape (1.77.0, 25 Oct 2026): POST /v1/search, /v1/contents and /v1/answer take the bodies that the common
// neural-search SDKs send (query, numResults, contents.text; urls or ids; query) and answer in that shape (results with id,
// url, title, publishedDate, author, text; answer with citations). Clients only change their base URL to <origin>/v1. Bazaar
// search on 25 Oct: "exa" 400 payers summed over the top 20, "exa search" 336, "neural search" 284, "contents" 104, "web
// answer" 49; resellers of one search API hold them and nothing of ours was there. Each front forwards one call to our own
// tool through the middleware (/search, /contents, /ai/answer), so x402, MPP, card credits and free calls apply unchanged,
// and quotes under its own path (asFrontQuote) so a settled payment lists it on the Bazaar.
import type { Context } from "hono";
import type { Env } from "./env";
import { FRONT_DESCRIPTIONS, asFrontQuote, requestBody } from "./openai-chat";
import { ENDPOINTS } from "../endpoints";
import { keyPrice } from "./key-prices";
import { categoryOf } from "../routes/search";
import { LAW_ACTS } from "../routes/law-search";
import DOC_SITES from "../data/web-docs-sites.json";

/** Act names that mean the law wherever they appear; other names (CRA, MDR, Instant Payments) count only next to a law word. */
const LEGAL_NAMES = new Set(["gdpr", "ai act", "dsa", "dma", "nis2", "dora", "mica", "csrd", "csddd", "psd2", "eidas", "eprivacy", "amlr", "amla", "cbam", "sfdr", "eudr", "vida", "gpsr", "ehds", "espr", "ucpd", "eudpr"]);
const LAW_WORDS = /\b(article|art\.|recital|regulation|directive|eu law|union law|comply|compliance|complian|obligations?|required?|requirements?|fines?|penalt|lawful|legal|prohibit|transpos)/i;
const foldName = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** A question about an indexed EU act, named by its short or full name (never by topic words alone). */
export function isLawQuestion(q: string): boolean {
  const text = ` ${foldName(q)} `;
  return LAW_ACTS.some((a) => [a.short, a.name].map(foldName).some((n) => n.length >= 3 && text.includes(` ${n} `) && (LEGAL_NAMES.has(n) || LAW_WORDS.test(q))));
}

type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;
const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"];
const PASSTHROUGH_RESPONSE_HEADERS = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];

export const SEARCH_API_PATHS = { "/v1/search": "/search", "/v1/findSimilar": "/search/similar", "/v1/contents": "/contents", "/v1/answer": "/ai/answer" } as const;
export type SearchApiPath = keyof typeof SEARCH_API_PATHS;

const asList = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? (v.trim().startsWith("[") ? (() => { try { return JSON.parse(v); } catch { return [v]; } })() : v.split(/[\n,]/)) : [])
  .map((x: unknown) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
/** contents.text / text as the SDKs send it: true, or { maxCharacters }. Returns the character budget, or 0 for no text. */
export function textBudget(v: unknown, fallback: number): number {
  if (v === true || v === "true") return fallback;
  if (v && typeof v === "object") { const n = Number((v as { maxCharacters?: unknown }).maxCharacters); return Number.isFinite(n) && n >= 500 ? Math.min(Math.trunc(n), 20_000) : fallback; }
  return 0;
}

const firstText = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v.find((x) => typeof x === "string") : v;
  return typeof s === "string" && s.trim() ? s.trim().slice(0, 80) : undefined;
};
const isOn = (v: unknown) => v === true || v === "true" || (!!v && typeof v === "object");

/** Exa's `userLocation`: "SE", or { country, latitude?, longitude? }. Returns the country code, if one was given. */
export function userCountry(v: unknown): string | undefined {
  const raw = typeof v === "string" ? v : v && typeof v === "object" ? (v as { country?: unknown }).country : undefined;
  return typeof raw === "string" && /^[A-Za-z]{2}$/.test(raw.trim()) ? raw.trim().toUpperCase() : undefined;
}

/** An Exa API warning: a field we accepted that has no effect (`code` IGNORED_FIELD, `path` a JSON Pointer). The SDKs print them. */
export type ApiWarning = { code: string; path: string; message: string };
const DEEP_TYPES = new Set(["deep", "deep-lite", "deep-reasoning"]);
const KNOWN_TYPES = new Set(["auto", "lite", "fast", "instant", "keyword", "neural", "hybrid", ...DEEP_TYPES]);

/**
 * The warnings Exa itself would give for fields that change nothing here (exa-js 2.28 request types, read 15 Nov 2026).
 * Fields we apply, or that are already true of every answer (pages are always read live, so `maxAgeHours` >= 0 and
 * livecrawl always/preferred/fallback/auto hold), get none. `ignored` notes from the inner tool are added by the caller.
 */
export function exaWarnings(path: SearchApiPath, body: unknown): ApiWarning[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const c = (b.contents && typeof b.contents === "object" ? b.contents : {}) as Record<string, unknown>;
  const out: ApiWarning[] = [];
  const warn = (p: string, message: string) => out.push({ code: "IGNORED_FIELD", path: p, message });
  const has = (k: string) => b[k] !== undefined && b[k] !== null && b[k] !== "";
  const isSearch = path === "/v1/search" || path === "/v1/findSimilar";
  if (isSearch && typeof b.type === "string") {
    const t = b.type.trim().toLowerCase();
    if (DEEP_TYPES.has(t)) warn("/type", `type "${t}" runs as a single keyword search here: there is no multi-query deep search. Drop type, or use /v1/answer for a synthesized answer.`);
    else if (!KNOWN_TYPES.has(t)) warn("/type", `type "${t.slice(0, 30)}" is not a search type; the search ran as auto.`);
  }
  if (isSearch) {
    for (const k of ["outputSchema", "systemPrompt", "objective", "additionalQueries"]) if (has(k)) warn(`/${k}`, `${k} is not applied to /v1/search; for a synthesized answer send the query to /v1/answer (it takes outputSchema).`);
    if (has("moderation")) warn("/moderation", "moderation is not applied: results are not filtered for safety.");
    if (has("flags")) warn("/flags", "experimental flags are not applied.");
    for (const k of ["startCrawlDate", "endCrawlDate"]) if (has(k)) warn(`/${k}`, `${k} is deprecated and not applied; use startPublishedDate / endPublishedDate.`);
    if (has("useAutoprompt")) warn("/useAutoprompt", "useAutoprompt is no longer supported; remove it.");
    const loc = b.userLocation;
    if (loc && typeof loc === "object" && !userCountry(loc) && ((loc as Record<string, unknown>).latitude !== undefined)) warn("/userLocation", "only userLocation.country is applied; coordinates alone do not localize results. Send country.");
    else if (loc !== undefined && loc !== null && loc !== "" && !userCountry(loc)) warn("/userLocation", "userLocation must be a two-letter country code or { country }; it was not applied.");
  }
  const contentsBase = path === "/v1/contents" ? b : c;
  const cp = path === "/v1/contents" ? "" : "/contents";
  if (Number(contentsBase.maxAgeHours) === -1) warn(`${cp}/maxAgeHours`, "maxAgeHours -1 (cached content only) is not available: every page is read live.");
  if (contentsBase.livecrawl === "never") warn(`${cp}/livecrawl`, 'livecrawl "never" is not available: every page is read live.');
  if (contentsBase.snapshotAsOf) warn(`${cp}/snapshotAsOf`, "snapshotAsOf is not available: pages are read as they are now.");
  for (const k of ["subpages", "subpageTarget", "extras", "context"]) if (contentsBase[k] !== undefined && contentsBase[k] !== false) warn(`${cp}/${k}`, `${k} is not applied.`);
  if (path === "/v1/contents") for (const k of ["highlights", "summary"]) if (isOn(b[k])) warn(`/${k}`, `${k} is not returned by /v1/contents here; /v1/search with contents.${k} returns it.`);
  if (path === "/v1/answer") {
    if (has("systemPrompt")) warn("/systemPrompt", "systemPrompt is not applied to the answer.");
    if (b.text === true || b.text === "true") warn("/text", "citations carry no page text; read them with /v1/contents.");
    if (has("userLocation")) warn("/userLocation", "userLocation is not applied to answers.");
    if (has("model") && b.model !== "exa") warn("/model", "model is not selectable; the answer model is named in `model`.");
  }
  return out;
}

/** Our inner tools' `ignored` notes ("excludeDomains: …") as Exa warnings; the field name before the colon becomes the path. */
export function warningsFromIgnored(ignored: string[] | undefined): ApiWarning[] {
  return (ignored ?? []).map((s) => {
    const field = /^([A-Za-z]+)[\s:]/.exec(s)?.[1];
    return { code: "IGNORED_FIELD", path: field ? `/${field}` : "", message: s };
  });
}

/**
 * The neural-search request fields we serve (6 Nov 2026), as /search inputs: includeDomains, excludeDomains,
 * start/endPublishedDate, category, includeText, excludeText, and contents.{text, highlights, summary} (also accepted at the
 * top level). type, useAutoprompt, livecrawl and crawl dates are accepted and ignored: every page we read is fetched live.
 */
export function searchFields(b: Record<string, unknown>): { query: Record<string, string>; text: number } | { error: string } {
  const q: Record<string, string> = {};
  const contents = (b.contents && typeof b.contents === "object" ? b.contents : {}) as Record<string, unknown>;
  for (const k of ["includeDomains", "excludeDomains"] as const) {
    const list = asList(b[k]);
    if (list.length > 20) return { error: `${k} takes at most 20 domains` };
    if (list.length) q[k] = list.join(",");
  }
  for (const k of ["startPublishedDate", "endPublishedDate", "category"] as const) {
    if (typeof b[k] === "string" && (b[k] as string).trim()) q[k] = (b[k] as string).trim().slice(0, 40);
  }
  const inc = firstText(b.includeText), exc = firstText(b.excludeText);
  if (inc) q.includeText = inc;
  if (exc) q.excludeText = exc;
  const country = userCountry(b.userLocation);
  if (country) q.country = country;
  const text = textBudget(contents.text ?? b.text, 3000);
  if (text) q.textChars = String(text);
  const hl = contents.highlights ?? b.highlights;
  if (isOn(hl)) {
    q.highlights = "true";
    const h = (typeof hl === "object" ? hl : {}) as Record<string, unknown>;
    if (Number.isInteger(Number(h.numSentences)) && Number(h.numSentences) > 0) q.numSentences = String(Math.min(10, Number(h.numSentences)));
    if (Number.isInteger(Number(h.highlightsPerUrl)) && Number(h.highlightsPerUrl) > 0) q.highlightsPerUrl = String(Math.min(5, Number(h.highlightsPerUrl)));
    if (typeof h.query === "string" && h.query.trim()) q.highlightQuery = h.query.trim().slice(0, 400);
  }
  const sum = contents.summary ?? b.summary;
  if (isOn(sum)) {
    q.summary = "true";
    const s = (typeof sum === "object" ? sum : {}) as Record<string, unknown>;
    if (typeof s.query === "string" && s.query.trim()) q.summaryQuery = s.query.trim().slice(0, 400);
  }
  return { query: q, text };
}

/** Maps a request body to the inner tool's query, or an error that is refused 400 when a payment came with it. */
/** The EU law index answers a search with a law category, or one limited to EUR-Lex (14 Nov 2026, the beat-Exa plan). */
const LAW_CATEGORIES = new Set(["law", "legal", "legislation", "regulation", "eu law", "eu legislation"]);
export function isLawSearch(b: Record<string, unknown>): boolean {
  if (typeof b.category === "string" && LAW_CATEGORIES.has(b.category.trim().toLowerCase())) return true;
  const domains = asList(b.includeDomains).map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""));
  return domains.length > 0 && domains.every((d) => d === "eur-lex.europa.eu");
}

/**
 * Exa's result categories answered from sources of record instead of a web index (14 Nov 2026, the beat-Exa plan,
 * Phase 1): `company` from the official registers behind /company/search, `research paper` from the scholarly
 * indexes behind /papers (OpenAlex, Crossref) or /arxiv/search, `github` from GitHub's own repository search. No
 * Brave request is made for these, so they do not count against the search cap, and every result is a record with a
 * source, not a crawled page. A company search must look like a name: Exa's company category also takes descriptions
 * ("AI startups in Berlin"), which a register cannot answer, so those stay on the web search. Filters a source cannot
 * honour (a phrase, other domains) also keep the web search; anything else that is left unused is named in `ignored`.
 */
const DESCRIBES_COMPANIES = /\b(companies|startups?|firms|businesses|vendors|providers|suppliers|competitors|alternatives?|like|similar|top|best|leading|largest|biggest|that|which|who|near|based|using|building|making|makers?)\b/i;
export function looksLikeCompanyName(q: string): boolean {
  const words = q.trim().split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 6 && !DESCRIBES_COMPANIES.test(q) && !/\?$/.test(q.trim());
}
const hostOnly = (d: string) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
export function categoryRoute(b: Record<string, unknown>, q: string, n: number): { tool: string; query: Record<string, string>; ignored: string[] } | undefined {
  const category = typeof b.category === "string" ? categoryOf(b.category) : undefined;
  if (!category || !["company", "research paper", "github"].includes(category)) return undefined;
  if (firstText(b.includeText) || firstText(b.excludeText)) return undefined;
  const domains = asList(b.includeDomains).map(hostOnly);
  const only = (h: string) => domains.length > 0 && domains.every((d) => d === h || d.endsWith(`.${h}`));
  const arxivOnly = only("arxiv.org");
  if (domains.length && !(category === "research paper" && arxivOnly) && !(category === "github" && only("github.com"))) return undefined;
  const ignored: string[] = [];
  if (asList(b.excludeDomains).length) ignored.push("excludeDomains: results come from a source of record, not web pages");
  const contents = (b.contents && typeof b.contents === "object" ? b.contents : {}) as Record<string, unknown>;
  if (isOn(contents.summary ?? b.summary)) ignored.push("summary: records carry their own abstract or description");
  const count = String(Math.min(20, n));
  if (category === "company") {
    if (!looksLikeCompanyName(q)) return undefined;
    if (b.startPublishedDate || b.endPublishedDate) ignored.push("published dates: register records have no publication date");
    return { tool: "/company/search", query: { q: q.slice(0, 200), limit: count }, ignored };
  }
  if (category === "github") {
    if (b.startPublishedDate || b.endPublishedDate) ignored.push("published dates: repositories are ordered by relevance");
    return { tool: "/github/search", query: { q: q.slice(0, 200), count }, ignored };
  }
  if (q.length < 3) return undefined;
  if (arxivOnly) {
    if (b.startPublishedDate || b.endPublishedDate) ignored.push("published dates: arXiv results are ordered by relevance");
    return { tool: "/arxiv/search", query: { q: q.slice(0, 300), count }, ignored };
  }
  const year = typeof b.startPublishedDate === "string" ? Number(b.startPublishedDate.trim().slice(0, 4)) : NaN;
  if (b.endPublishedDate) ignored.push("endPublishedDate: only a start year is applied to papers");
  return { tool: "/papers", query: { query: q.slice(0, 300), limit: count, ...(year >= 1800 && year <= 2100 ? { fromYear: String(year) } : {}) }, ignored };
}

/** Hosts of the developer-docs sites in our own index (src/data/web-docs-sites.json, 15 Nov 2026). */
export const DOC_HOSTS: ReadonlySet<string> = new Set((DOC_SITES as { prefix: string }[]).map((s) => hostOnly(s.prefix)));
const DOC_CATEGORIES = new Set(["docs", "documentation", "developer docs", "developer documentation", "api docs"]);
/**
 * A search for developer documentation goes to our own index: category docs, or includeDomains naming only indexed
 * docs sites. A phrase filter (includeText/excludeText) keeps the web search, which can honour it.
 */
export function docsRoute(b: Record<string, unknown>, q: string, n: number): { tool: string; query: Record<string, string>; ignored: string[] } | undefined {
  if (firstText(b.includeText) || firstText(b.excludeText) || q.length < 2) return undefined;
  const domains = asList(b.includeDomains).map(hostOnly);
  const byCategory = typeof b.category === "string" && DOC_CATEGORIES.has(b.category.trim().toLowerCase());
  const byDomains = domains.length > 0 && domains.every((d) => DOC_HOSTS.has(d));
  if (!byCategory && !byDomains) return undefined;
  const ignored: string[] = [];
  if (b.startPublishedDate || b.endPublishedDate) ignored.push("published dates: documentation pages are ordered by relevance");
  if (asList(b.excludeDomains).length) ignored.push("excludeDomains: not applied to the documentation index");
  return { tool: "/docs/search", query: { q: q.slice(0, 400), count: String(Math.min(10, n)), ...(domains.length === 1 ? { site: domains[0] } : {}) }, ignored };
}

export function toToolQuery(path: SearchApiPath, body: unknown): { query: Record<string, string>; text: number; tool?: string; ignored?: string[] } | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (path === "/v1/search" || path === "/v1/findSimilar") {
    const out: Record<string, string> = {};
    if (path === "/v1/search") {
      const q = typeof b.query === "string" ? b.query.trim() : "";
      if (!q) return { error: "query must be a non-empty string" };
      if (q.length > 400) return { error: "query must be at most 400 characters" };
      out.q = q;
      if (isLawSearch(b)) {
        const n = b.numResults === undefined || b.numResults === "" ? 5 : Number(b.numResults);
        if (!Number.isInteger(n) || n < 1) return { error: "numResults must be a whole number from 1 (at most 10 are returned for EU law)" };
        return { query: { q, count: String(Math.min(10, n)) }, text: 0, tool: "/law/search" };
      }
      const n = b.numResults === undefined || b.numResults === "" ? 10 : Number(b.numResults);
      if (Number.isInteger(n) && n >= 1) {
        const routed = docsRoute(b, q, n) ?? categoryRoute(b, q, n);
        if (routed) {
          const contents = (b.contents && typeof b.contents === "object" ? b.contents : {}) as Record<string, unknown>;
          return { query: routed.query, text: textBudget(contents.text ?? b.text, 3000), tool: routed.tool, ...(routed.ignored.length ? { ignored: routed.ignored } : {}) };
        }
      }
    } else {
      const url = typeof b.url === "string" ? b.url.trim() : "";
      if (!url) return { error: "url must be a non-empty string" };
      if (url.length > 2000) return { error: "url must be at most 2000 characters" };
      out.url = url;
      // Only an explicit choice is passed on; otherwise the tool leaves the source site out. Exa's own default keeps
      // it, which suits a neural index of similar pages, but our results come from a keyword search on the page's own
      // title and topic words, and with the source site kept they were the source site again (14 Nov 2026: the
      // official SDK's findSimilar("https://www.firecrawl.dev") returned firecrawl.dev twice, its GitHub and its YC page).
      if (b.excludeSourceDomain !== undefined && b.excludeSourceDomain !== "") out.excludeSourceDomain = String(b.excludeSourceDomain === true || b.excludeSourceDomain === "true");
    }
    // Neural-search clients ask for up to 100; one Brave request returns at most 20, so larger asks get 20.
    const n = b.numResults === undefined || b.numResults === "" ? 10 : Number(b.numResults);
    if (!Number.isInteger(n) || n < 1) return { error: "numResults must be a whole number from 1 (at most 20 are returned)" };
    out.count = String(Math.min(20, n));
    const fields = searchFields(b);
    if ("error" in fields) return fields;
    Object.assign(out, fields.query);
    return { query: out, text: fields.text };
  }
  if (path === "/v1/contents") {
    const urls = [...new Set([...asList(b.urls), ...asList(b.ids)])];
    if (!urls.length) return { error: "urls (or ids) must list one to five page URLs" };
    if (urls.length > 5) return { error: "at most 5 URLs per request: one request pays for one call" };
    const budget = textBudget(b.text ?? (b.contents as Record<string, unknown> | undefined)?.text ?? true, 4000);
    return { query: { urls: JSON.stringify(urls), maxChars: String(Math.max(500, budget)) }, text: 0 };
  }
  const q = typeof b.query === "string" ? b.query.trim() : "";
  if (!q) return { error: "query must be a non-empty string" };
  if (q.length > 400) return { error: "query must be at most 400 characters" };
  // An EU-law question (a law category, or the question names an indexed act: GDPR, AI Act, DSA…) is answered from
  // our EU law index, not from web search results.
  if (isLawSearch(b) || isLawQuestion(q)) return { query: { q, count: "5", answer: "true" }, text: 0, tool: "/law/search" };
  return { query: { q }, text: 0 };
}

export function bodyFromQuery(params: Record<string, string>): Record<string, unknown> | null {
  if (params.query === undefined && params.url === undefined && params.urls === undefined && params.ids === undefined) return null;
  const out: Record<string, unknown> = { ...params };
  if (params.text !== undefined) out.text = params.text === "true" ? true : { maxCharacters: Number(params.text) };
  return out;
}

const requestId = () => crypto.randomUUID().replace(/-/g, "");

/** Query parameters that only track a click; two results that differ only in them are the same page. */
const TRACKING = /^(utm_[a-z]+|dub_id|via|ref|ref_src|fbclid|gclid|mc_cid|mc_eid|_hs(enc|mi))$/i;
/** A result's identity: scheme, www, trailing slash, fragment and tracking parameters do not make a different page. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    const query = u.searchParams.toString();
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`;
  } catch { return url; }
}
const unique = <T extends { url: string }>(rows: T[]): T[] => { const seen = new Set<string>(); return rows.filter((r) => { const k = pageKey(r.url); if (seen.has(k)) return false; seen.add(k); return true; }); };

/**
 * What the call cost the caller, in the `costDollars` shape the neural-search SDKs read (they surface `total`).
 * A free trial costs nothing; a prepaid key pays its key price; any other paid call pays the tool's price.
 */
export function costDollars(price: string | undefined, keyPrice: string | undefined, how: "free" | "key" | "paid"): { total: number } | undefined {
  const usd = (p: string | undefined) => (p && /^\$\d+(\.\d+)?$/.test(p) ? Number(p.slice(1)) : undefined);
  const total = how === "free" ? 0 : how === "key" ? usd(keyPrice ?? price) : usd(price);
  return total === undefined ? undefined : { total };
}

/**
 * /v1/answer with `stream: true` as Server-Sent Events, the shape the SDKs' streamAnswer reads: the answer text as
 * `choices[0].delta.content` chunks (cut at sentence ends, since our model answers in one piece), then one chunk with
 * the citations and the cost, then `[DONE]`. Before this the SDK got plain JSON and yielded no text at all.
 */
export function answerStream(answer: { answer: string | Record<string, unknown>; citations: unknown[]; costDollars?: unknown; requestId: string }): string {
  // A structured answer (outputSchema) streams as its JSON text in one chunk.
  if (typeof answer.answer !== "string") answer = { ...answer, answer: JSON.stringify(answer.answer) };
  const text = answer.answer as string;
  const parts = typeof answer.answer === "string" && text.startsWith("{") ? [text] : text.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? (text ? [text] : []);
  const lines = parts.map((p) => `data: ${JSON.stringify({ requestId: answer.requestId, choices: [{ index: 0, delta: { content: p } }] })}\n\n`);
  lines.push(`data: ${JSON.stringify({ requestId: answer.requestId, citations: answer.citations, ...(answer.costDollars ? { costDollars: answer.costDollars } : {}) })}\n\n`);
  lines.push("data: [DONE]\n\n");
  return lines.join("");
}

type CompanyHit = { name: string; country: string; idType?: string; id?: string; legalForm?: string; city?: string; exact?: boolean; url?: string; details?: string; lei?: string; source?: string; branchOfForeign?: boolean };
type PaperHit = { title: string; authors?: string[]; year?: number | null; venue?: string | null; type?: string | null; citations?: number; doi?: string | null; url?: string | null; abstract?: string | null };
type ArxivHit = { id: string; title: string; summary?: string; authors?: string[]; published?: string; updated?: string; primaryCategory?: string; doi?: string | null; url: string; pdf?: string };
type RepoHit = { repo: string; url: string; description?: string | null; stars?: number; forks?: number; language?: string | null; topics?: string[]; license?: string | null; pushedAt?: string | null; archived?: boolean };

/** "SE" -> "Sweden", as Exa's company entities name the country; an unknown code stays as it is. */
const countryName = (code: string) => { try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; } };
/** Text of a record as the SDKs' `text` field, cut to the caller's budget; nothing when text was not asked for. */
const textOf = (s: string, budget: number | undefined) => (budget ? { text: s.slice(0, budget) } : {});

/**
 * A source-of-record answer (company registers, scholarly indexes, arXiv, GitHub) in the neural-search response shape.
 * Company results carry Exa-shaped `entities` built only from register facts: name, legal form, seat, register ID,
 * LEI, the register itself and the time it was read. Nothing is guessed (no headcount, revenue or description).
 */
export function recordResults(inner: Record<string, unknown>, tool: string | undefined, opts: { text?: number; origin?: string; ignored?: string[] }) {
  const base = { requestId: requestId(), ...(opts.ignored?.length ? { ignored: opts.ignored } : {}) };
  if (tool === "/company/search") {
    const r = inner as { results?: CompanyHit[]; note?: string; retrievedAt?: string; failed?: unknown[]; searched?: string[] };
    return {
      ...base, resolvedSearchType: "company-registers",
      results: (r.results ?? []).map((h) => {
        const url = h.url ?? (h.lei ? `https://search.gleif.org/#/record/${h.lei}` : h.details ? `${opts.origin ?? ""}${h.details}` : "");
        const facts = [h.legalForm, h.city, h.country].filter(Boolean).join(", ");
        const line = `${h.name}${facts ? ` (${facts})` : ""}.${h.id ? ` ${h.idType ?? "Register ID"} ${h.id}.` : ""}${h.lei ? ` LEI ${h.lei}.` : ""}${h.branchOfForeign ? " Registered branch of a foreign company." : ""}${h.source ? ` Source: ${h.source}.` : ""}`;
        return {
          id: url || `${h.country}:${h.id ?? h.lei ?? h.name}`, url, title: h.name, publishedDate: null, author: null, score: h.exact ? 1 : null,
          ...textOf(line, opts.text), highlights: [line],
          entities: [{
            id: `${h.country}:${h.id ?? h.lei ?? h.name}`, type: "company", version: 1,
            properties: {
              name: h.name, legalForm: h.legalForm ?? null,
              headquarters: { address: null, city: h.city ?? null, postalCode: null, country: countryName(h.country), countryCode: h.country },
              registration: { country: h.country, idType: h.idType ?? null, id: h.id ?? null, lei: h.lei ?? null, register: h.source ?? null, url: h.url ?? null, branchOfForeign: !!h.branchOfForeign, retrievedAt: r.retrievedAt ?? null },
            },
          }],
        };
      }),
      searched: r.searched, ...(r.failed?.length ? { failed: r.failed } : {}),
      terms: r.note,
    };
  }
  if (tool === "/papers") {
    const r = inner as { results?: PaperHit[]; source?: string };
    return {
      ...base, resolvedSearchType: "scholarly-index",
      results: (r.results ?? []).filter((h) => h.url || h.doi).map((h) => {
        const url = h.url ?? `https://doi.org/${h.doi}`;
        return {
          id: url, url, title: h.title, publishedDate: null, year: h.year ?? null, author: h.authors?.length ? h.authors.join(", ") : null, score: null,
          ...(h.abstract ? { ...textOf(h.abstract, opts.text), highlights: [h.abstract.slice(0, 300)] } : {}),
          doi: h.doi ?? null, venue: h.venue ?? null, citations: h.citations ?? 0, type: h.type ?? null,
        };
      }),
      terms: `Paper metadata from ${r.source ?? "OpenAlex or Crossref"} (OpenAlex data is CC0; Crossref metadata is open). Open the DOI link for the paper itself.`,
    };
  }
  if (tool === "/arxiv/search") {
    const r = inner as { papers?: ArxivHit[]; attribution?: string };
    return {
      ...base, resolvedSearchType: "arxiv",
      results: (r.papers ?? []).map((h) => ({
        id: h.url, url: h.url, title: h.title, publishedDate: h.published ? `${h.published}T00:00:00.000Z` : null, author: h.authors?.length ? h.authors.join(", ") : null, score: null,
        ...(h.summary ? { ...textOf(h.summary, opts.text), highlights: [h.summary.slice(0, 300)] } : {}),
        arxivId: h.id, pdf: h.pdf ?? null, doi: h.doi ?? null, category: h.primaryCategory ?? null,
      })),
      terms: r.attribution,
    };
  }
  if (tool === "/docs/search") {
    // Our own documentation index: a snippet per page (we do not serve the page text; read it with /v1/contents).
    const r = inner as { results?: { title: string; url: string; source?: string; snippet?: string; crawled?: string; score?: number }[]; attribution?: string };
    return {
      ...base, resolvedSearchType: "docs-index",
      results: (r.results ?? []).map((h) => ({
        id: h.url, url: h.url, title: h.title, publishedDate: null, author: null, score: h.score ?? null,
        ...(h.snippet ? { highlights: [h.snippet] } : {}), source: h.source ?? null, crawled: h.crawled ?? null,
      })),
      terms: r.attribution,
    };
  }
  if (tool === "/github/search") {
    const r = inner as { repos?: RepoHit[]; source?: string };
    return {
      ...base, resolvedSearchType: "github",
      results: (r.repos ?? []).map((h) => {
        const line = `${h.repo}: ${h.description ?? "no description"}.${h.language ? ` ${h.language}.` : ""} ${h.stars ?? 0} stars.${h.license ? ` License ${h.license}.` : ""}${h.archived ? " Archived." : ""}`;
        return {
          id: h.url, url: h.url, title: h.repo, publishedDate: h.pushedAt ?? null, author: null, score: null,
          ...textOf(line, opts.text), highlights: [line],
          stars: h.stars ?? 0, forks: h.forks ?? 0, language: h.language ?? null, topics: h.topics ?? [], license: h.license ?? null,
        };
      }),
      terms: r.source,
    };
  }
  return undefined;
}

type SearchOut = {
  results?: { title: string; url: string; snippet?: string; age?: string | null; publishedDate?: string | null; author?: string | null; image?: string | null; favicon?: string | null; text?: string; highlights?: string[]; highlightScores?: number[]; summary?: string | null }[];
  terms?: string; filters?: Record<string, unknown>; ignored?: string[]; query?: string;
};
/** The tool's answer in the neural-search response shape. The tool already read, highlighted and summarized what was asked. */
export function toSearchApi(path: SearchApiPath, inner: Record<string, unknown>, tool?: string, opts: { text?: number; origin?: string; ignored?: string[] } = {}) {
  const routed = recordResults(inner, tool, opts);
  if (routed) return routed;
  if (tool === "/law/search" && path === "/v1/answer") {
    const r = inner as { answer?: string; model?: string | null; results?: { citation: string; heading?: string; url: string }[]; attribution?: string };
    return {
      requestId: requestId(), answer: r.answer ?? "", model: r.model ?? undefined, resolvedSearchType: "eu-law-index",
      citations: (r.results ?? []).map((h) => ({ id: h.url, url: h.url, title: h.heading ? `${h.citation}: ${h.heading}` : h.citation })),
      terms: r.attribution,
    };
  }
  if (tool === "/law/search") {
    // EU law passages as search results: the title is the citation, the text the provision, highlights its opening.
    const r = inner as { results?: { citation: string; heading?: string; text: string; url: string; version: string; score?: number }[]; attribution?: string };
    return {
      requestId: requestId(),
      resolvedSearchType: "eu-law-index",
      results: (r.results ?? []).map((h) => ({
        id: h.url, url: h.url, title: h.heading ? `${h.citation}: ${h.heading}` : h.citation, publishedDate: null, author: null, score: h.score ?? null,
        text: h.text, highlights: [h.text.slice(0, 300)], version: h.version,
      })),
      terms: r.attribution,
    };
  }
  if (path === "/v1/search" || path === "/v1/findSimilar") {
    const r = inner as SearchOut;
    return {
      requestId: requestId(),
      resolvedSearchType: "keyword",
      results: unique(r.results ?? []).map((h) => ({
        id: h.url, url: h.url, title: h.title, publishedDate: h.publishedDate ?? null, author: h.author ?? null, score: null,
        ...(h.image ? { image: h.image } : {}), ...(h.favicon ? { favicon: h.favicon } : {}),
        ...(h.text !== undefined ? { text: h.text } : {}),
        // Without a highlights request the search snippet stands in, as it did since 1.77.0.
        ...(h.highlights ? { highlights: h.highlights, highlightScores: h.highlightScores ?? [] } : h.snippet ? { highlights: [h.snippet] } : {}),
        ...(h.summary !== undefined ? { summary: h.summary ?? "" } : {}),
        ...(h.age ? { age: h.age } : {}),
      })),
      ...(path === "/v1/findSimilar" && r.query ? { searchQuery: r.query } : {}),
      ...(r.filters ? { filters: r.filters } : {}), ...(r.ignored ? { ignored: r.ignored } : {}),
      terms: r.terms,
    };
  }
  if (path === "/v1/contents") {
    const r = inner as { results?: Record<string, unknown>[]; statuses?: Record<string, unknown>[] };
    // Every page is read live: Exa's statuses say so with source "crawled" (its other value is "cached").
    return { requestId: requestId(), results: r.results ?? [], statuses: (r.statuses ?? []).map((s) => (s && typeof s === "object" && s.status === "success" && !s.source ? { ...s, source: "crawled" } : s)) };
  }
  const r = inner as { answer?: string; sources?: { n: number; title: string; url: string }[]; terms?: string; model?: string };
  return { requestId: requestId(), answer: r.answer ?? "", citations: (r.sources ?? []).map((s) => ({ id: s.url, url: s.url, title: s.title })), model: r.model, terms: r.terms };
}

/**
 * Exa's /answer `outputSchema`: with an object schema the answer becomes an object with the schema's top-level properties
 * (at most 10, as Exa allows), read by the model out of the answer and its sources; array properties whose items are
 * objects keep exactly their item keys. A text schema leaves the answer as text. If the model fails, the answer stays text
 * and a warning says so: the call was paid for the answer, which is there either way.
 */
export function schemaFields(schema: unknown): { fields: string[]; lists: Record<string, string[]> } | null {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as { type?: unknown; properties?: unknown };
  if (s.type === "text" || !s.properties || typeof s.properties !== "object") return null;
  const props = Object.entries(s.properties as Record<string, unknown>).filter(([k]) => /^[A-Za-z_][\w-]{0,63}$/.test(k)).slice(0, 10);
  if (!props.length) return null;
  const lists: Record<string, string[]> = {};
  for (const [k, v] of props) {
    const items = (v as { type?: unknown; items?: { properties?: unknown } } | null)?.items;
    if ((v as { type?: unknown } | null)?.type === "array" && items?.properties && typeof items.properties === "object") lists[k] = Object.keys(items.properties).slice(0, 10);
  }
  return { fields: props.map(([k]) => k), lists };
}

async function applyOutputSchema(env: Env, body: Record<string, unknown>, shaped: Record<string, unknown>) {
  const spec = schemaFields(body?.outputSchema);
  if (!spec || typeof shaped.answer !== "string" || !shaped.answer) return;
  const citations = (shaped.citations as { title?: string; url?: string }[] | undefined) ?? [];
  const source = `Question: ${String(body.query ?? "").slice(0, 400)}\n\nAnswer:\n${shaped.answer}\n\nSources:\n${citations.map((c, i) => `[${i + 1}] ${c.title ?? ""} ${c.url ?? ""}`).join("\n")}`.slice(0, 12_000);
  try {
    const { extractFields } = await import("../routes/ai-text");
    const r = await extractFields(env, source, spec.fields, undefined, 700, spec.lists);
    shaped.answer = r.data;
  } catch {
    shaped.warnings = [{ code: "IGNORED_FIELD", path: "/outputSchema", message: "the structured answer could not be built this time; the answer is text" }];
  }
}

/** Handles /v1/search, /v1/findSimilar, /v1/contents and /v1/answer by forwarding the equivalent tool GET through the middleware. */
export async function searchApi(c: C, path: SearchApiPath, forward: Forward): Promise<Response> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const body = await requestBody(c, bodyFromQuery);
  const stream = path === "/v1/answer" && !!body && typeof body === "object" && ((body as Record<string, unknown>).stream === true || (body as Record<string, unknown>).stream === "true");
  const mapped = toToolQuery(path, body);
  if ("error" in mapped && paying) return c.json({ error: mapped.error }, 400);
  const tool = ("tool" in mapped && mapped.tool) || SEARCH_API_PATHS[path];
  const outer = new URL(c.req.url);
  const inner = new URL(tool, outer.origin);
  // An unpaid or empty request gets the tool's quote for its published example, under this front's own path.
  const query = "error" in mapped ? (path === "/v1/contents" ? { urls: "https://example.com" } : path === "/v1/findSimilar" ? { url: "https://www.x402.org/" } : { q: "x402 payment protocol" }) : mapped.query;
  for (const [k, v] of Object.entries(query)) inner.searchParams.set(k, v);
  if (outer.searchParams.get("trial") === "1") inner.searchParams.set("trial", "1");
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  const started = Date.now();
  const answer = await forward(new Request(inner.href, { method: "GET", headers }));
  if (answer.status === 402) return asFrontQuote(answer, outer, FRONT_DESCRIPTIONS[outer.pathname] ?? "", tool);
  if (answer.status !== 200) return answer;
  const result = (await answer.json().catch(() => ({}))) as Record<string, unknown>;
  const priced = ENDPOINTS.find((e) => e.path === tool);
  const how = answer.headers.get("x-free-trial-remaining") !== null ? "free" : c.req.header("authorization") || c.req.header("x-api-key") ? "key" : "paid";
  const cost = costDollars(priced?.price, priced ? keyPrice(priced.path, priced.price) : undefined, how);
  const shaped: Record<string, unknown> = { ...toSearchApi(path, result, tool, "error" in mapped ? {} : { text: mapped.text, origin: outer.origin, ignored: mapped.ignored }), ...(cost ? { costDollars: cost } : {}) };
  if (path === "/v1/answer" && !("error" in mapped)) await applyOutputSchema(c.env, body as Record<string, unknown>, shaped);
  // Exa's own shape for what had no effect: warnings with a JSON path, beside our older `ignored` notes.
  const warnings = [...exaWarnings(path, body), ...warningsFromIgnored([...((shaped.ignored as string[] | undefined) ?? []), ...((result.ignored as string[] | undefined) ?? [])]), ...((shaped.warnings as ApiWarning[] | undefined) ?? [])];
  const seen = new Set<string>();
  const unique = warnings.filter((w) => { const k = `${w.path}|${w.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (unique.length) shaped.warnings = unique; else delete shaped.warnings;
  if (path === "/v1/search" || path === "/v1/findSimilar") shaped.searchTime = Date.now() - started;
  const out = stream
    ? new Response(answerStream(shaped as Parameters<typeof answerStream>[0]), { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } })
    : c.json(shaped, 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}
