// OpenAI-compatible chat completions: `POST /v1/chat/completions` with the usual `{ messages: [...] }` body, answered
// in the OpenAI response shape. It is a front for the paid `/ai/chat` tool: the request is translated into that
// tool's GET call and forwarded through the same middleware, so x402 (v1 and v2), MPP (evm and tempo), card credits
// and free calls all work unchanged, at the same price, and a failed call is never charged. Agents that already
// speak the OpenAI API (SDKs with an x402 or MPP fetch wrapper) can use the tool without learning our query format.
//
// Why: on-chain, the one tool category with verified outside buyers is LLM inference sold through this interface.
import type { Context } from "hono";
import { ENDPOINTS } from "../endpoints";
import { MODELS } from "./ai";
import type { Env } from "./env";

export const OPENAI_CHAT_PATH = "/v1/chat/completions";
export const OPENAI_MODELS_PATH = "/v1/models";
/** The tool that answers; its price and payment terms apply. */
export const CHAT_TOOL_PATH = "/ai/chat";
const PROMPT_LIMIT = 8000;
const SYSTEM_LIMIT = 2000;
const DEFAULT_SYSTEM = "You are a helpful, concise assistant.";

type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;

interface ChatQuery { prompt: string; system?: string; maxTokens?: number; temperature?: number }

/** Text of an OpenAI message `content` (a string, or an array of text parts). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("\n").trim();
  return "";
}

/**
 * Maps an OpenAI chat request onto the /ai/chat query: system messages become the system prompt, a single user
 * message is the prompt, a longer conversation is rendered as a transcript the model is asked to continue.
 */
export function toChatQuery(body: unknown): { query: ChatQuery } | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object with a messages array" };
  const b = body as Record<string, unknown>;
  if (b.stream === true) return { error: "streaming is not supported; send stream: false" };
  if (!Array.isArray(b.messages) || b.messages.length === 0) return { error: "messages must be a non-empty array of { role, content }" };
  const turns: { role: string; text: string }[] = [];
  const systems: string[] = [];
  for (const m of b.messages) {
    if (!m || typeof m !== "object") return { error: "each message must be an object with role and content" };
    const role = String((m as { role?: unknown }).role ?? "");
    const text = textOf((m as { content?: unknown }).content);
    if (role === "system" || role === "developer") { if (text) systems.push(text); continue; }
    if (role !== "user" && role !== "assistant") return { error: `unsupported message role "${role}"; use system, user or assistant` };
    if (!text) return { error: `a ${role} message has no text content` };
    turns.push({ role, text });
  }
  if (!turns.length || turns[turns.length - 1].role !== "user") return { error: "the last message must be from the user" };
  let prompt = turns.length === 1
    ? turns[0].text
    : `Conversation so far:\n${turns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`).join("\n\n")}\n\nReply to the last user message.`;
  if (prompt.length > PROMPT_LIMIT) prompt = prompt.slice(prompt.length - PROMPT_LIMIT); // keep the most recent turns
  const query: ChatQuery = { prompt };
  const system = systems.join("\n").slice(0, SYSTEM_LIMIT);
  if (system) query.system = system;
  const maxTokens = Number(b.max_completion_tokens ?? b.max_tokens);
  if (Number.isFinite(maxTokens) && maxTokens > 0) query.maxTokens = Math.min(1024, Math.floor(maxTokens));
  const temperature = Number(b.temperature);
  if (Number.isFinite(temperature) && temperature >= 0) query.temperature = Math.min(1.5, temperature);
  return { query };
}

/** The OpenAI-shaped answer for one /ai/chat result. Token counts are estimates (about four characters per token). */
export function toOpenAiResponse(query: ChatQuery, result: { model?: string; response?: string }, requestedModel?: string) {
  const text = String(result.response ?? "");
  const promptTokens = Math.ceil((query.prompt.length + (query.system ?? "").length) / 4);
  const completionTokens = Math.ceil(text.length / 4);
  return {
    id: `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model ?? requestedModel ?? MODELS.text,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens, estimated: true },
  };
}

const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"];
const PASSTHROUGH_RESPONSE_HEADERS = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];

/** Handles POST /v1/chat/completions by forwarding the equivalent /ai/chat GET through the whole middleware chain. */
export async function openAiChatCompletions(c: C, forward: Forward): Promise<Response> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  let body: unknown = null;
  try { body = await c.req.json(); } catch { body = null; }
  const mapped = toChatQuery(body);
  if ("error" in mapped && paying) {
    // Invalid input with a payment attached: refuse before anything is forwarded, so nothing is charged.
    return c.json({ error: { message: mapped.error, type: "invalid_request_error" } }, 400);
  }
  // An unpaid probe (directories, validators, a first unpaid call) gets the real quote even with an empty body.
  const query: ChatQuery = "error" in mapped ? { prompt: String(ENDPOINTS.find((e) => e.path === CHAT_TOOL_PATH)?.params.prompt.example ?? "Hello") } : mapped.query;
  const outer = new URL(c.req.url);
  const inner = new URL(CHAT_TOOL_PATH, outer.origin);
  inner.searchParams.set("prompt", query.prompt);
  if (query.system) inner.searchParams.set("system", query.system);
  if (query.maxTokens) inner.searchParams.set("maxTokens", String(query.maxTokens));
  if (query.temperature !== undefined) inner.searchParams.set("temperature", String(query.temperature));
  if (outer.searchParams.get("trial") === "1") inner.searchParams.set("trial", "1");
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  const answer = await forward(new Request(inner.href, { method: "GET", headers }));
  if (answer.status !== 200) return answer; // the 402 quote, a refusal or an uncharged error, unchanged
  const result = (await answer.json().catch(() => ({}))) as { model?: string; response?: string };
  const requestedModel = body && typeof body === "object" ? String((body as { model?: unknown }).model ?? "") || undefined : undefined;
  const out = c.json(toOpenAiResponse(query, result, requestedModel), 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}

/** GET /v1/models: the one model behind /v1/chat/completions, free to read. */
export function openAiModels() {
  return { object: "list", data: [{ id: MODELS.text, object: "model", created: 1735689600, owned_by: "cloudflare-workers-ai" }] };
}

/** The two OpenAI-style paths for /openapi.json; the completion is paid at the /ai/chat price and terms. */
export function openAiOpenApiPaths(origin: string, price: string, mpp: readonly unknown[]) {
  return {
    [OPENAI_CHAT_PATH]: {
      post: {
        operationId: "chat_completions",
        summary: "OpenAI-compatible chat completion (Llama 3.1 8B)",
        description: `OpenAI chat completions request shape, answered by the same model and at the same price as ${CHAT_TOOL_PATH}: send messages (system, user, assistant), get one assistant message back. No streaming. Point an OpenAI SDK at ${origin}/v1 with an x402 or MPP fetch wrapper; the unpaid request returns the 402 quote and the paid retry returns the completion. Failed calls are never charged.`,
        tags: ["ai", "chat", "completion", "llama", "openai"],
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: price.replace("$", "") }, protocols: [{ x402: {} }, ...mpp] },
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["messages"],
                properties: {
                  model: { type: "string", description: `Ignored; the model is ${MODELS.text}` },
                  messages: { type: "array", minItems: 1, items: { type: "object", required: ["role", "content"], properties: { role: { type: "string", enum: ["system", "user", "assistant"] }, content: { type: "string" } } } },
                  max_tokens: { type: "integer", minimum: 1, maximum: 1024, description: "Maximum output tokens (default 400)" },
                  temperature: { type: "number", minimum: 0, maximum: 1.5, description: "Default 0.6" },
                  stream: { type: "boolean", description: "Must be false or absent" },
                },
              },
              example: { model: MODELS.text, messages: [{ role: "system", content: "You are a concise assistant." }, { role: "user", content: "Explain x402 in one sentence." }], max_tokens: 200 },
            },
          },
        },
        responses: {
          "200": {
            description: "Chat completion",
            content: {
              "application/json": {
                schema: { type: "object", properties: { id: { type: "string" }, object: { type: "string" }, created: { type: "integer" }, model: { type: "string" }, choices: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, message: { type: "object", properties: { role: { type: "string" }, content: { type: "string" } } }, finish_reason: { type: "string" } } } }, usage: { type: "object", properties: { prompt_tokens: { type: "integer" }, completion_tokens: { type: "integer" }, total_tokens: { type: "integer" }, estimated: { type: "boolean" } } } } },
                example: { id: "chatcmpl-0123456789abcdef01234567", object: "chat.completion", created: 1792400000, model: MODELS.text, choices: [{ index: 0, message: { role: "assistant", content: "x402 lets software pay for an HTTP request with a stablecoin by answering a 402 Payment Required challenge." }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36, estimated: true } },
              },
            },
          },
          "400": { description: "Invalid request body (not charged)" },
          "402": { description: "Payment Required" },
          "503": { description: "Daily AI capacity used up (not charged)" },
        },
      },
    },
    [OPENAI_MODELS_PATH]: {
      get: {
        operationId: "list_models",
        summary: "OpenAI-compatible model list",
        description: "The one model behind /v1/chat/completions. Free.",
        tags: ["ai", "openai"],
        security: [],
        responses: { "200": { description: "Model list", content: { "application/json": { example: openAiModels() } } } },
      },
    },
  };
}
