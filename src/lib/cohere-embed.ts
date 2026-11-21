// Cohere v2 is the default SDK generation (ClientV2 / cohere.v2.embed) and calls POST /v2/embed. Until 19 Nov 2026 that
// path 404'd, so a Cohere v2 RAG app could not be pointed at us with a base-URL change. This is a thin alias over the
// same paid /ai/embed tool (BGE-M3, 1,024 dims) through the same middleware and payment paths as the OpenAI front.
// One text per request: one payment pays for exactly one tool call, so a list with more than one text is refused before
// anything is charged (the same rule as /v1/embeddings). Cohere v2 accepts up to 96 texts per call; a multi-text
// request would need a per-item billing contract, which is an owner decision, not a code-only alias.
import type { Context } from "hono";
import { ENDPOINTS } from "../endpoints";
import type { Env } from "./env";
import { FRONT_DESCRIPTIONS, asFrontQuote, requestBody } from "./openai-chat";
import { EMBED_TOOL_PATH, toEmbedText } from "./openai-embeddings";
import { carriesPayment, forwardedHeaders } from "./paying-request";

export const COHERE_EMBED_V2_PATH = "/v2/embed";
type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;
const PASSTHROUGH_RESPONSE_HEADERS = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];

/** A Cohere v2 embed body as the one text /ai/embed can serve, or why it cannot be served. */
export function toCohereEmbedText(body: unknown): { text: string } | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object with texts" };
  const b = body as { texts?: unknown; input_type?: unknown; model?: unknown };
  const texts = b.texts;
  if (!Array.isArray(texts)) return { error: "texts must be a non-empty array of strings" };
  if (texts.length !== 1) return { error: "one text per request: this endpoint pays for one tool call, so send a single text" };
  return toEmbedText({ input: texts[0] });
}

/** Cohere v2 answer for one /ai/embed result, in the official { id, embeddings.float, texts, meta } envelope. */
export function toCohereEmbed(text: string, result: { embedding?: number[]; model?: string }) {
  return {
    id: crypto.randomUUID(),
    embeddings: { float: [result.embedding ?? []] },
    texts: [text],
    meta: {
      api_version: { version: "2" },
      billed_units: { input_tokens: Math.max(1, Math.ceil(text.length / 4)) },
    },
  };
}

/** Handles /v2/embed by forwarding the equivalent /ai/embed GET through the middleware. */
export async function cohereEmbed(c: C, forward: Forward): Promise<Response> {
  const paying = carriesPayment((h) => c.req.header(h));
  const body = await requestBody(c, (params) => (params.text === undefined ? null : { texts: [params.text] }));
  const mapped = toCohereEmbedText(body);
  if ("error" in mapped && paying) return c.json({ message: mapped.error }, 400);
  const text = "error" in mapped
    ? String(ENDPOINTS.find((e) => e.path === EMBED_TOOL_PATH)?.params.text.example ?? "hello")
    : mapped.text;
  const outer = new URL(c.req.url);
  const inner = new URL(EMBED_TOOL_PATH, outer.origin);
  inner.searchParams.set("text", text);
  if (outer.searchParams.get("trial") === "1") inner.searchParams.set("trial", "1");
  const headers = forwardedHeaders(c.req.raw);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  const answer = await forward(new Request(inner.href, { method: "GET", headers }));
  if (answer.status === 402) return asFrontQuote(answer, outer, FRONT_DESCRIPTIONS[outer.pathname] ?? "", EMBED_TOOL_PATH);
  if (answer.status !== 200) return answer;
  const result = (await answer.json().catch(() => ({}))) as { embedding?: number[]; model?: string };
  const out = c.json(toCohereEmbed(text, result), 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}
