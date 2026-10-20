// OpenAI-compatible embeddings: `POST /v1/embeddings` with `{ input, model? }`, answered in the OpenAI shape, as a
// front for the paid /ai/embed tool (BGE-M3, 1,024 dimensions) through the same middleware and payment paths as the
// chat front (lib/openai-chat.ts). One input per request: one x402 or MPP payment pays for exactly one tool call, so an
// array with more than one item is refused before anything is charged.
import type { Context } from "hono";
import { ENDPOINTS } from "../endpoints";
import type { Env } from "./env";
import { FRONT_DESCRIPTIONS, asFrontQuote, openApiGetVariant, requestBody } from "./openai-chat";
import { paymentInfo as buildPaymentInfo } from "./payment-info";

export const OPENAI_EMBEDDINGS_PATH = "/v1/embeddings";
export const EMBED_TOOL_PATH = "/ai/embed";
export const EMBED_MODEL = "@cf/baai/bge-m3";
const TEXT_LIMIT = 4000;

type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;
const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"];
const PASSTHROUGH_RESPONSE_HEADERS = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];

/** The one text to embed from an OpenAI embeddings body, or why it cannot be served. */
export function toEmbedText(body: unknown): { text: string } | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object with an input string" };
  const input = (body as { input?: unknown }).input;
  const items = Array.isArray(input) ? input : [input];
  if (items.length !== 1) return { error: "one input per request: this endpoint pays for one tool call, so send a single string (or a one-item array)" };
  const text = typeof items[0] === "string" ? items[0].trim() : "";
  if (!text) return { error: "input must be a non-empty string" };
  if (text.length > TEXT_LIMIT) return { error: `input must be at most ${TEXT_LIMIT} characters` };
  return { text };
}

/** The OpenAI-shaped answer for one /ai/embed result. Token count is an estimate (about four characters per token). */
export function toOpenAiEmbedding(text: string, result: { embedding?: number[]; model?: string }) {
  const tokens = Math.ceil(text.length / 4);
  return {
    object: "list",
    data: [{ object: "embedding", index: 0, embedding: result.embedding ?? [] }],
    model: result.model ?? EMBED_MODEL,
    usage: { prompt_tokens: tokens, total_tokens: tokens, estimated: true },
  };
}

/** The embeddings body a GET query stands for (`input=` or `text=`), or null when it names no text. */
export function embedBodyFromQuery(params: Record<string, string>): Record<string, unknown> | null {
  const input = params.input ?? params.text;
  return input === undefined ? null : { input };
}

/** Handles /v1/embeddings (POST body, or GET query) by forwarding the equivalent /ai/embed GET through the whole middleware chain. */
export async function openAiEmbeddings(c: C, forward: Forward): Promise<Response> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const body = await requestBody(c, embedBodyFromQuery);
  const mapped = toEmbedText(body);
  if ("error" in mapped && paying) return c.json({ error: { message: mapped.error, type: "invalid_request_error" } }, 400);
  // An unpaid probe gets the real quote even with an empty body.
  const text = "error" in mapped ? String(ENDPOINTS.find((e) => e.path === EMBED_TOOL_PATH)?.params.text.example ?? "hello") : mapped.text;
  const outer = new URL(c.req.url);
  const inner = new URL(EMBED_TOOL_PATH, outer.origin);
  inner.searchParams.set("text", text);
  if (outer.searchParams.get("trial") === "1") inner.searchParams.set("trial", "1");
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  const answer = await forward(new Request(inner.href, { method: "GET", headers }));
  if (answer.status === 402) { const outer = new URL(c.req.url); return asFrontQuote(answer, outer, FRONT_DESCRIPTIONS[outer.pathname] ?? "", inner.pathname); }
  if (answer.status !== 200) return answer;
  const result = (await answer.json().catch(() => ({}))) as { embedding?: number[]; model?: string };
  const out = c.json(toOpenAiEmbedding(text, result), 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}

/** The /v1/embeddings path for /openapi.json, paid at the /ai/embed price and terms. */
export function openAiEmbeddingsOpenApiPath(origin: string, price: string, mpp: readonly unknown[]) {
  const paymentInfo = buildPaymentInfo({ amount: price }, mpp);
  return {
    [OPENAI_EMBEDDINGS_PATH]: {
      get: openApiGetVariant(
        "embeddings_get",
        "Embedding over GET (input in the query; same model and price as the POST)",
        `The same embedding for clients that can only GET: input (up to ${TEXT_LIMIT} characters) in the query string, the OpenAI embeddings shape back, paid at the ${EMBED_TOOL_PATH} price (${price}). Failed calls are never charged.`,
        ["ai", "embeddings", "vector", "rag", "openai"],
        "input",
        { input: { type: "string", description: `The text to embed (up to ${TEXT_LIMIT} characters, 100+ languages)` } },
        paymentInfo,
        { "200": { description: "Embedding (same shape as the POST)" }, "400": { description: "Invalid request (not charged)" }, "402": { description: "Payment Required" }, "503": { description: "Daily AI capacity used up (not charged)" } },
      ),
      post: {
        operationId: "embeddings",
        summary: "OpenAI-compatible embeddings (BGE-M3, 1,024 dimensions)",
        description: `OpenAI embeddings request shape, answered by the same model and at the same price as ${EMBED_TOOL_PATH} (${price}): send one input string (up to ${TEXT_LIMIT} characters, 100+ languages), get one 1,024-dimension vector. One input per request, because one payment pays for one call. Point an OpenAI SDK at ${origin}/v1 with an x402 or MPP fetch wrapper, or an adt_ card-credit key as apiKey. Failed calls are never charged.`,
        tags: ["ai", "embeddings", "vector", "rag", "openai"],
        "x-payment-info": paymentInfo,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["input"], properties: { input: { description: "One text to embed (a string, or a one-item array)", oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1 }] }, model: { type: "string", description: `Ignored; the model is ${EMBED_MODEL}` } } },
              example: { model: EMBED_MODEL, input: "pay-per-call APIs for AI agents" },
            },
          },
        },
        responses: {
          "200": { description: "Embedding", content: { "application/json": { schema: { type: "object", properties: { object: { type: "string" }, data: { type: "array", items: { type: "object", properties: { object: { type: "string" }, index: { type: "integer" }, embedding: { type: "array", items: { type: "number" } } } } }, model: { type: "string" }, usage: { type: "object", properties: { prompt_tokens: { type: "integer" }, total_tokens: { type: "integer" }, estimated: { type: "boolean" } } } } }, example: { object: "list", data: [{ object: "embedding", index: 0, embedding: [0.0123, -0.0456, 0.0789] }], model: EMBED_MODEL, usage: { prompt_tokens: 8, total_tokens: 8, estimated: true } } } } },
          "400": { description: "Invalid request body (not charged)" },
          "402": { description: "Payment Required" },
          "503": { description: "Daily AI capacity used up (not charged)" },
        },
      },
    },
  };
}
