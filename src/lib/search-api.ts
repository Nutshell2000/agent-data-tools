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
import { extract } from "../routes/extract";

type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;
const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"];
const PASSTHROUGH_RESPONSE_HEADERS = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];

export const SEARCH_API_PATHS = { "/v1/search": "/search", "/v1/contents": "/contents", "/v1/answer": "/ai/answer" } as const;
export type SearchApiPath = keyof typeof SEARCH_API_PATHS;

const asList = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? (v.trim().startsWith("[") ? (() => { try { return JSON.parse(v); } catch { return [v]; } })() : v.split(/[\n,]/)) : [])
  .map((x: unknown) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
/** contents.text / text as the SDKs send it: true, or { maxCharacters }. Returns the character budget, or 0 for no text. */
export function textBudget(v: unknown, fallback: number): number {
  if (v === true || v === "true") return fallback;
  if (v && typeof v === "object") { const n = Number((v as { maxCharacters?: unknown }).maxCharacters); return Number.isFinite(n) && n >= 500 ? Math.min(Math.trunc(n), 20_000) : fallback; }
  return 0;
}

/** Maps a request body to the inner tool's query, or an error that is refused 400 when a payment came with it. */
export function toToolQuery(path: SearchApiPath, body: unknown): { query: Record<string, string>; text: number } | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (path === "/v1/search") {
    const q = typeof b.query === "string" ? b.query.trim() : "";
    if (!q) return { error: "query must be a non-empty string" };
    if (q.length > 400) return { error: "query must be at most 400 characters" };
    const n = b.numResults === undefined || b.numResults === "" ? 10 : Number(b.numResults);
    if (!Number.isInteger(n) || n < 1 || n > 20) return { error: "numResults must be an integer from 1 to 20" };
    const contents = b.contents as Record<string, unknown> | undefined;
    return { query: { q, count: String(n) }, text: textBudget(contents?.text ?? b.text, 3000) };
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
  return { query: { q }, text: 0 };
}

export function bodyFromQuery(params: Record<string, string>): Record<string, unknown> | null {
  if (params.query === undefined && params.urls === undefined && params.ids === undefined) return null;
  const out: Record<string, unknown> = { ...params };
  if (params.text !== undefined) out.text = params.text === "true" ? true : { maxCharacters: Number(params.text) };
  return out;
}

const requestId = () => crypto.randomUUID().replace(/-/g, "");

type SearchOut = { results?: { title: string; url: string; snippet?: string; age?: string | null }[]; terms?: string };
export async function toSearchApi(path: SearchApiPath, inner: Record<string, unknown>, text: number, read: typeof extract = extract) {
  if (path === "/v1/search") {
    const r = inner as SearchOut;
    const hits = r.results ?? [];
    // Page text for the top results when the request asked for contents: read after the one paid search call, at most 5.
    const texts = text ? await Promise.all(hits.map((h, i) => i < 5 ? (read(h.url, String(Math.max(500, text)), "text") as Promise<{ text?: string; title?: string | null }>).then((p) => p.text ?? null, () => null) : Promise.resolve(null))) : [];
    return {
      requestId: requestId(),
      resolvedSearchType: "keyword",
      results: hits.map((h, i) => ({ id: h.url, url: h.url, title: h.title, publishedDate: null, author: null, score: null, ...(h.snippet ? { highlights: [h.snippet] } : {}), ...(text ? { text: texts[i] ?? h.snippet ?? "" } : {}), ...(h.age ? { age: h.age } : {}) })),
      terms: r.terms,
    };
  }
  if (path === "/v1/contents") {
    const r = inner as { results?: Record<string, unknown>[]; statuses?: unknown[] };
    return { requestId: requestId(), results: r.results ?? [], statuses: r.statuses ?? [] };
  }
  const r = inner as { answer?: string; sources?: { n: number; title: string; url: string }[]; terms?: string; model?: string };
  return { requestId: requestId(), answer: r.answer ?? "", citations: (r.sources ?? []).map((s) => ({ id: s.url, url: s.url, title: s.title })), model: r.model, terms: r.terms };
}

/** Handles /v1/search, /v1/contents and /v1/answer by forwarding the equivalent tool GET through the middleware. */
export async function searchApi(c: C, path: SearchApiPath, forward: Forward): Promise<Response> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const mapped = toToolQuery(path, await requestBody(c, bodyFromQuery));
  if ("error" in mapped && paying) return c.json({ error: mapped.error }, 400);
  const tool = SEARCH_API_PATHS[path];
  const outer = new URL(c.req.url);
  const inner = new URL(tool, outer.origin);
  // An unpaid or empty request gets the tool's quote for its published example, under this front's own path.
  const query = "error" in mapped ? (path === "/v1/contents" ? { urls: "https://example.com" } : { q: "x402 payment protocol" }) : mapped.query;
  for (const [k, v] of Object.entries(query)) inner.searchParams.set(k, v);
  if (outer.searchParams.get("trial") === "1") inner.searchParams.set("trial", "1");
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  const answer = await forward(new Request(inner.href, { method: "GET", headers }));
  if (answer.status === 402) return asFrontQuote(answer, outer, FRONT_DESCRIPTIONS[outer.pathname] ?? "", tool);
  if (answer.status !== 200) return answer;
  const result = (await answer.json().catch(() => ({}))) as Record<string, unknown>;
  const out = c.json(await toSearchApi(path, result, "error" in mapped ? 0 : mapped.text), 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}
