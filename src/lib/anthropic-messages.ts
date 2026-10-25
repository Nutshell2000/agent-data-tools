// Anthropic Messages API shape (`POST /v1/messages`): the request form of the Anthropic SDK and of agent frameworks
// built on it (system, messages with text / tool_use / tool_result blocks, tools with input_schema, tool_choice,
// stream). It is translated to the chat-completions body and served by the same paid chat tools through
// lib/openai-chat.ts (Llama 4 Scout by default with function calling, or an open model by name), so every payment
// path, price and refusal rule is identical; the answer comes back in the Messages shape, streamed as Messages events
// when asked. Claude model names are refused with the reason: no Claude model is served here.
// Why (25 Oct 2026): BlockRun's Anthropic-compatible messages endpoint sold 2,266 calls in 30 days at $0.011.
import type { Context } from "hono";
import type { Env } from "./env";
import { PASSTHROUGH_RESPONSE_HEADERS, completeChat, openApiGetVariant, toOpenAiResponse } from "./openai-chat";
import { CHAT_MODEL } from "../routes/ai-text";
import { paymentInfo as buildPaymentInfo } from "./payment-info";

export const ANTHROPIC_MESSAGES_PATH = "/v1/messages";
type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;
type Block = { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown };

const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"];
const textOfBlocks = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((b) => (b && typeof b === "object" && (b as Block).type === "text" ? String((b as Block).text ?? "") : "")).join("\n").trim() : "";

/** A Messages body as the equivalent chat-completions body (OpenAI messages, tools, tool_choice), or null. */
export function toChatBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const messages: Record<string, unknown>[] = [];
  const system = textOfBlocks(b.system);
  if (system) messages.push({ role: "system", content: system });
  for (const m of Array.isArray(b.messages) ? b.messages : []) {
    if (!m || typeof m !== "object") continue;
    const role = String((m as { role?: unknown }).role ?? "user");
    const content = (m as { content?: unknown }).content;
    if (typeof content === "string") { messages.push({ role, content }); continue; }
    const blocks = (Array.isArray(content) ? content : []) as Block[];
    if (role === "assistant") {
      const calls = blocks.filter((x) => x.type === "tool_use").map((x) => ({ id: x.id, type: "function", function: { name: x.name, arguments: JSON.stringify(x.input ?? {}) } }));
      messages.push({ role, content: textOfBlocks(blocks) || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // A user turn: tool results become tool messages (before the turn's text, as the model saw them).
    for (const r of blocks.filter((x) => x.type === "tool_result")) {
      messages.push({ role: "tool", tool_call_id: r.tool_use_id, content: typeof r.content === "string" ? r.content : textOfBlocks(r.content) || JSON.stringify(r.content ?? "") });
    }
    const text = textOfBlocks(blocks);
    if (text) messages.push({ role: "user", content: text });
  }
  const tools = Array.isArray(b.tools) ? (b.tools as { name?: string; description?: string; input_schema?: unknown }[]).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema ?? { type: "object", properties: {} } } })) : undefined;
  const tc = b.tool_choice as { type?: string; name?: string } | undefined;
  const toolChoice = !tc ? undefined : tc.type === "any" ? "required" : tc.type === "none" ? "none" : tc.type === "tool" && tc.name ? { type: "function", function: { name: tc.name } } : "auto";
  return {
    model: b.model, messages, max_tokens: b.max_tokens, temperature: b.temperature,
    ...(tools?.length ? { tools } : {}), ...(toolChoice !== undefined && tools?.length ? { tool_choice: toolChoice } : {}),
  };
}

/** The Messages-shaped answer for one chat completion: text and tool_use blocks, stop_reason, usage. */
export function toMessagesAnswer(completion: ReturnType<typeof toOpenAiResponse>) {
  const { message, finish_reason } = completion.choices[0];
  const content: Record<string, unknown>[] = [];
  if (message.content) content.push({ type: "text", text: message.content });
  for (const t of message.tool_calls ?? []) {
    let input: unknown = {};
    try { input = JSON.parse(t.function.arguments || "{}"); } catch { input = { raw: t.function.arguments }; }
    content.push({ type: "tool_use", id: t.id.startsWith("toolu_") ? t.id : `toolu_${t.id.replace(/[^A-Za-z0-9]/g, "").slice(-24)}`, name: t.function.name, input });
  }
  return {
    id: `msg_${completion.id.replace(/^chatcmpl-/, "")}`,
    type: "message", role: "assistant", model: completion.model, content,
    stop_reason: finish_reason === "tool_calls" ? "tool_use" : finish_reason === "length" ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: completion.usage.prompt_tokens, output_tokens: completion.usage.completion_tokens },
  };
}

/** The same answer as Messages stream events (message_start … message_stop), for `stream: true`. */
export function toMessagesStream(answer: ReturnType<typeof toMessagesAnswer>): string {
  const ev = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev("message_start", { message: { ...answer, content: [], stop_reason: null, usage: { input_tokens: answer.usage.input_tokens, output_tokens: 0 } } });
  answer.content.forEach((block, index) => {
    if (block.type === "text") {
      out += ev("content_block_start", { index, content_block: { type: "text", text: "" } });
      out += ev("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    } else {
      out += ev("content_block_start", { index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      out += ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    out += ev("content_block_stop", { index });
  });
  out += ev("message_delta", { delta: { stop_reason: answer.stop_reason, stop_sequence: null }, usage: { output_tokens: answer.usage.output_tokens } });
  return out + ev("message_stop", {});
}

/** Handles POST /v1/messages through the shared chat core. */
export async function anthropicMessages(c: C, forward: Forward): Promise<Response> {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const model = String(body?.model ?? "");
  if (/claude/i.test(model) && PAYMENT_HEADERS.some((h) => c.req.header(h))) {
    return c.json({ type: "error", error: { type: "invalid_request_error", message: `${model} is not served here: this endpoint runs open models (${CHAT_MODEL} by default; see /v1/models). Nothing was charged.` } }, 400);
  }
  const done = await completeChat(c, forward, toChatBody(body ? { ...body, model: /claude/i.test(model) ? undefined : body.model } : null));
  if (!done.ok) return done.response;
  const answer = toMessagesAnswer(toOpenAiResponse(done.query, done.result, done.requestedModel));
  const out = body?.stream === true
    ? new Response(toMessagesStream(answer), { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } })
    : c.json(answer, 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = done.answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}

/** The /v1/messages path for /openapi.json; paid at the chosen chat tool's price, like /v1/chat/completions. */
export function anthropicMessagesOpenApiPath(origin: string, prices: { small: string; large: string }, mpp: readonly unknown[]) {
  const paymentInfo = buildPaymentInfo({ min: prices.small, max: prices.large }, mpp);
  return {
    [ANTHROPIC_MESSAGES_PATH]: {
      post: {
        operationId: "anthropic_messages",
        summary: "Anthropic Messages API shape on open models (Llama 4 Scout by default, with tools)",
        description: `Anthropic Messages request shape: system, messages (text, tool_use and tool_result blocks), tools with input_schema, tool_choice, max_tokens, temperature and stream. Served by the same open models and prices as /v1/chat/completions (${prices.small} by default, up to ${prices.large} by model name); Claude models are not served and are refused with the reason. Point the Anthropic SDK at ${origin} with an x402 or MPP fetch wrapper, or an adt_ card-credit key. Failed calls are never charged.`,
        tags: ["ai", "chat", "anthropic", "messages", "tools"],
        "x-payment-info": paymentInfo,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["messages", "max_tokens"], properties: { model: { type: "string", description: `Open model name (default ${CHAT_MODEL}); Claude names are refused` }, system: {}, messages: { type: "array", items: { type: "object" } }, tools: { type: "array", items: { type: "object" } }, tool_choice: { type: "object" }, max_tokens: { type: "integer", minimum: 1, maximum: 1024 }, temperature: { type: "number" }, stream: { type: "boolean" } } },
              example: { model: "llama-4-scout", max_tokens: 200, system: "You are a concise assistant.", messages: [{ role: "user", content: "Explain x402 in one sentence." }] },
            },
          },
        },
        responses: {
          "200": { description: "Message", content: { "application/json": { example: { id: "msg_0123456789abcdef01234567", type: "message", role: "assistant", model: CHAT_MODEL, content: [{ type: "text", text: "x402 lets software pay for an HTTP request with a stablecoin by answering a 402 Payment Required challenge." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 24, output_tokens: 22 } } } } },
          "400": { description: "Invalid request body or a Claude model name (not charged)" },
          "402": { description: "Payment Required" },
          "503": { description: "Daily AI capacity used up (not charged)" },
        },
      },
    },
  };
}

export { openApiGetVariant };
