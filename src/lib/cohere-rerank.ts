// Cohere-style rerank: `POST /v1/rerank` with `{ query, documents, top_n, return_documents }`, answered in the Cohere
// shape, as a front for the paid /ai/rerank tool (bge-reranker-base) through the same middleware and payment paths as the
// other /v1 fronts. One request is one tool call. The model name in the body is ignored: one reranker serves every call.
import type { Context } from "hono";
import type { Env } from "./env";
import { FRONT_DESCRIPTIONS, asFrontQuote, requestBody } from "./openai-chat";

export const COHERE_RERANK_PATH = "/v1/rerank";
export const RERANK_TOOL_PATH = "/ai/rerank";
type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;
const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"];
const PASSTHROUGH_RESPONSE_HEADERS = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];
const EXAMPLE = { query: "What is the capital of France?", documents: ["France has hundreds of cheeses.", "Berlin is the capital of Germany.", "Paris is the capital and largest city of France."] };

export type RerankQuery = { query: string; documents: string[]; topN?: number; returnDocuments: boolean };

export function toRerankQuery(body: unknown): RerankQuery | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object with query and documents" };
  const b = body as { query?: unknown; documents?: unknown; top_n?: unknown; return_documents?: unknown };
  const query = typeof b.query === "string" ? b.query.trim() : "";
  if (!query) return { error: "query must be a non-empty string" };
  let docs = b.documents;
  if (typeof docs === "string") { const s = docs; try { docs = JSON.parse(s); } catch { docs = s.split(/\r?\n/); } }
  if (!Array.isArray(docs) || !docs.length) return { error: "documents must be a non-empty array of strings or {text} objects" };
  const documents = docs.map((d) => (typeof d === "string" ? d : d && typeof d === "object" && typeof (d as { text?: unknown }).text === "string" ? (d as { text: string }).text : null));
  if (documents.some((d) => d === null || !d.trim())) return { error: "every document must be a non-empty string or an object with a text string" };
  if (documents.length > 50) return { error: "at most 50 documents per request" };
  const topN = b.top_n === undefined || b.top_n === null || b.top_n === "" ? undefined : Number(b.top_n);
  if (topN !== undefined && (!Number.isInteger(topN) || topN < 1)) return { error: "top_n must be a positive integer" };
  return { query, documents: documents as string[], topN, returnDocuments: b.return_documents === true || b.return_documents === "true" };
}

export function rerankBodyFromQuery(params: Record<string, string>): Record<string, unknown> | null {
  if (params.query === undefined && params.documents === undefined) return null;
  return { query: params.query, documents: params.documents, top_n: params.top_n, return_documents: params.return_documents };
}

export function toCohereRerank(result: { results?: { index: number; relevance_score: number; document?: string }[] }, returnDocuments: boolean) {
  return {
    id: crypto.randomUUID(),
    results: (result.results ?? []).map((r) => ({ index: r.index, relevance_score: r.relevance_score, ...(returnDocuments ? { document: { text: r.document ?? "" } } : {}) })),
    meta: { api_version: { version: "2" }, billed_units: { search_units: 1 } },
  };
}

/** Handles /v1/rerank (POST body, or GET query) by forwarding the equivalent /ai/rerank GET through the middleware. */
export async function cohereRerank(c: C, forward: Forward): Promise<Response> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const mapped = toRerankQuery(await requestBody(c, rerankBodyFromQuery));
  if ("error" in mapped && paying) return c.json({ message: mapped.error }, 400);
  const q = "error" in mapped ? { ...EXAMPLE, topN: undefined, returnDocuments: false } : mapped;
  const outer = new URL(c.req.url);
  const inner = new URL(RERANK_TOOL_PATH, outer.origin);
  inner.searchParams.set("query", q.query);
  inner.searchParams.set("documents", JSON.stringify(q.documents));
  if (q.topN !== undefined) inner.searchParams.set("top_n", String(q.topN));
  if (outer.searchParams.get("trial") === "1") inner.searchParams.set("trial", "1");
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  const answer = await forward(new Request(inner.href, { method: "GET", headers }));
  if (answer.status === 402) return asFrontQuote(answer, outer, FRONT_DESCRIPTIONS[outer.pathname] ?? "", RERANK_TOOL_PATH);
  if (answer.status !== 200) return answer;
  const result = (await answer.json().catch(() => ({}))) as { results?: { index: number; relevance_score: number; document?: string }[] };
  const out = c.json(toCohereRerank(result, q.returnDocuments), 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}
