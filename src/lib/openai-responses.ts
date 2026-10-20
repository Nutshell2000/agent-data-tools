// OpenAI Responses API shape (`POST /v1/responses`): the request form newer OpenAI SDKs and agent frameworks use.
// It is mapped onto the chat-completions body and served by the same paid chat tools through lib/openai-chat.ts, so
// every payment path, price and refusal rule is identical; only the answer shape differs (`output` items).
import type { Context } from "hono";
import type { Env } from "./env";
import { PASSTHROUGH_RESPONSE_HEADERS, completeChat, openApiGetVariant, requestBody, toolFor, type ChatQuery } from "./openai-chat";
import { MODELS } from "./ai";
import { paymentInfo as buildPaymentInfo } from "./payment-info";

export const OPENAI_RESPONSES_PATH = "/v1/responses";
type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;

/** Text of a Responses content part or list (`input_text` / `output_text` parts, or a plain string). */
function partsText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("\n").trim();
  return "";
}

/** A Responses body as the equivalent chat-completions body, or null when it is not an object. */
export function toChatBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const messages: { role: string; content: string }[] = [];
  if (typeof b.instructions === "string" && b.instructions.trim()) messages.push({ role: "system", content: b.instructions });
  if (typeof b.input === "string") messages.push({ role: "user", content: b.input });
  else if (Array.isArray(b.input)) {
    for (const item of b.input) {
      if (!item || typeof item !== "object") continue;
      const role = String((item as { role?: unknown }).role ?? "user");
      messages.push({ role, content: partsText((item as { content?: unknown }).content) });
    }
  }
  return {
    model: b.model,
    messages,
    max_tokens: b.max_output_tokens ?? b.max_tokens,
    temperature: b.temperature,
    stream: b.stream,
  };
}

/** The Responses-shaped answer for one chat tool result. Token counts are estimates (about four characters per token). */
export function toResponsesAnswer(query: ChatQuery, result: { model?: string; response?: string }, requestedModel?: string) {
  const text = String(result.response ?? "");
  const inputTokens = Math.ceil((query.prompt.length + (query.system ?? "").length) / 4);
  const outputTokens = Math.ceil(text.length / 4);
  const id = crypto.randomUUID().replace(/-/g, "");
  return {
    id: `resp_${id.slice(0, 24)}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: result.model ?? requestedModel ?? MODELS.text,
    output: [{ type: "message", id: `msg_${id.slice(24)}${id.slice(0, 16)}`, status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }],
    output_text: text,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens, estimated: true },
  };
}

/** The Responses body a GET query stands for (`input=`, optional instructions, model, max_output_tokens, temperature), or null. */
export function responsesBodyFromQuery(params: Record<string, string>): Record<string, unknown> | null {
  const input = params.input ?? params.prompt ?? params.q;
  if (input === undefined) return null;
  const body: Record<string, unknown> = { input };
  const instructions = params.instructions ?? params.system;
  if (instructions) body.instructions = instructions;
  if (params.model) body.model = params.model;
  const max = params.max_output_tokens ?? params.max_tokens;
  if (max !== undefined) body.max_output_tokens = Number(max);
  if (params.temperature !== undefined) body.temperature = Number(params.temperature);
  return body;
}

/** Handles /v1/responses (POST body, or GET query) through the shared chat core. */
export async function openAiResponses(c: C, forward: Forward): Promise<Response> {
  const body = await requestBody(c, responsesBodyFromQuery);
  const done = await completeChat(c, forward, toChatBody(body));
  if (!done.ok) return done.response;
  const out = c.json(toResponsesAnswer(done.query, done.result, done.requestedModel), 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = done.answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}

/** The /v1/responses path for /openapi.json; paid at the chosen chat tool's price, like /v1/chat/completions. */
export function openAiResponsesOpenApiPath(origin: string, prices: { small: string; large: string }, mpp: readonly unknown[]) {
  const paymentInfo = buildPaymentInfo({ min: prices.small, max: prices.large }, mpp);
  return {
    [OPENAI_RESPONSES_PATH]: {
      get: openApiGetVariant(
        "responses_get",
        "Responses API over GET (input in the query; same models and prices as the POST)",
        `The same Responses call for clients that can only GET: input (and optional instructions, model, max_output_tokens, temperature) in the query string, the Responses shape back (output plus output_text). Paid at the same prices as /v1/chat/completions: ${prices.small} by default, ${prices.large} with model "llama-3.3-70b" or "gpt-oss-120b". Failed calls are never charged.`,
        ["ai", "chat", "completion", "openai"],
        "input",
        {
          input: { type: "string", description: "The user message (up to 8,000 characters)" },
          instructions: { type: "string", description: "Optional system prompt" },
          model: { type: "string", description: `${MODELS.text} (default, ${prices.small}), or llama-3.3-70b / gpt-oss-120b (${prices.large})` },
          max_output_tokens: { type: "integer", minimum: 1, maximum: 1024, description: "Maximum output tokens (default 400)" },
          temperature: { type: "number", minimum: 0, maximum: 1.5, description: "Default 0.6" },
        },
        paymentInfo,
        { "200": { description: "Completed response (same shape as the POST)" }, "400": { description: "Invalid request (not charged)" }, "402": { description: "Payment Required" }, "503": { description: "Daily AI capacity used up (not charged)" } },
      ),
      post: {
        operationId: "responses",
        summary: "OpenAI Responses API shape (same models and prices as /v1/chat/completions)",
        description: `OpenAI Responses request shape: input (a string or a list of role/content items), optional instructions, max_output_tokens and temperature; one completed message comes back in output (plus output_text). Served by the same models and prices as /v1/chat/completions: ${prices.small} by default, ${prices.large} with model "llama-3.3-70b" or "gpt-oss-120b". No streaming, no tools. Point an OpenAI SDK at ${origin}/v1 with an x402 or MPP fetch wrapper. Failed calls are never charged.`,
        tags: ["ai", "chat", "completion", "openai"],
        "x-payment-info": paymentInfo,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["input"],
                properties: {
                  model: { type: "string", description: `${MODELS.text} (default, ${prices.small}), or llama-3.3-70b / gpt-oss-120b (${prices.large})` },
                  input: { description: "A string, or a list of { role, content } items (content a string or input_text parts)", oneOf: [{ type: "string" }, { type: "array", items: { type: "object", properties: { role: { type: "string", enum: ["system", "user", "assistant"] }, content: {} } } }] },
                  instructions: { type: "string", description: "Optional system prompt" },
                  max_output_tokens: { type: "integer", minimum: 1, maximum: 1024 },
                  temperature: { type: "number", minimum: 0, maximum: 1.5 },
                  stream: { type: "boolean", description: "Must be false or absent" },
                },
              },
              example: { model: MODELS.text, instructions: "You are a concise assistant.", input: "Explain x402 in one sentence.", max_output_tokens: 200 },
            },
          },
        },
        responses: {
          "200": { description: "Completed response", content: { "application/json": { example: { id: "resp_0123456789abcdef01234567", object: "response", created_at: 1792400000, status: "completed", model: MODELS.text, output: [{ type: "message", id: "msg_0123456789abcdef", status: "completed", role: "assistant", content: [{ type: "output_text", text: "x402 lets software pay for an HTTP request with a stablecoin by answering a 402 Payment Required challenge.", annotations: [] }] }], output_text: "x402 lets software pay for an HTTP request with a stablecoin by answering a 402 Payment Required challenge.", usage: { input_tokens: 12, output_tokens: 24, total_tokens: 36, estimated: true } } } } },
          "400": { description: "Invalid request body (not charged)" },
          "402": { description: "Payment Required" },
          "503": { description: "Daily AI capacity used up (not charged)" },
        },
      },
    },
  };
}

export { toolFor };
