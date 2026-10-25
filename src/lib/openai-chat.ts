// OpenAI-compatible chat completions: `POST /v1/chat/completions` with the usual `{ messages: [...] }` body, answered
// in the OpenAI response shape. It is a front for the paid chat tools: the request is translated into the tool's GET
// call and forwarded through the same middleware, so x402 (v1 and v2), MPP (evm and tempo), card credits and free
// calls all work unchanged, at the tool's price, and a failed call is never charged. Agents that already speak the
// OpenAI API (SDKs with an x402 or MPP fetch wrapper) can use the tools without learning our query format.
//
// The `model` field picks the tool: the default is /ai/chat (Llama 4 Scout); a model name containing "70b",
// "llama-3.3", "gpt-oss" or "120b" goes to /ai/chat-large (Llama 3.3 70B or gpt-oss-120b) at its own price.
//
// Why: on-chain, the one tool category with verified outside buyers is LLM inference sold through this interface.
import type { Context } from "hono";
import { ENDPOINTS } from "../endpoints";
import { CHAT_MODEL } from "../routes/ai-text";
import type { Env } from "./env";
import { LARGE_CHAT_MODELS, MODEL_ENDPOINTS } from "../routes/ai-text";
import { paymentInfo as buildPaymentInfo } from "./payment-info";

export const OPENAI_CHAT_PATH = "/v1/chat/completions";
export const OPENAI_MODELS_PATH = "/v1/models";
/** The tools that answer; their prices and payment terms apply. */
export const CHAT_TOOL_PATH = "/ai/chat";
export const CHAT_LARGE_TOOL_PATH = "/ai/chat-large";
const PROMPT_LIMIT = 8000;
const SYSTEM_LIMIT = 2000;

type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;

/** OpenAI fields /ai/chat (Llama 4 Scout) takes as they are: the agent-loop request (tools, tool turns, JSON mode). */
export interface NativeChat { messages: unknown[]; tools?: unknown[]; tool_choice?: unknown; response_format?: unknown }
export interface ChatQuery { prompt: string; system?: string; maxTokens?: number; temperature?: number; model?: keyof typeof LARGE_CHAT_MODELS; tool?: string; native?: NativeChat }

/** True when the request needs the model's own message handling: tools, tool-result turns, tool calls or JSON mode. */
export function needsNative(b: Record<string, unknown>): boolean {
  if (Array.isArray(b.tools) && b.tools.length) return true;
  if (b.response_format && typeof b.response_format === "object" && (b.response_format as { type?: unknown }).type !== "text") return true;
  return Array.isArray(b.messages) && b.messages.some((m) => m && typeof m === "object" && ((m as { role?: unknown }).role === "tool" || Array.isArray((m as { tool_calls?: unknown }).tool_calls)));
}

/**
 * Which tool (and large-model name) an OpenAI `model` string selects: a model with its own listing (/ai/model/<slug>)
 * by its slug, Workers AI id or family name; then the two large models; everything else is /ai/chat (Llama 4 Scout).
 */
export function toolFor(model: unknown): { path: string; model?: keyof typeof LARGE_CHAT_MODELS } {
  const name = String(model ?? "").toLowerCase();
  const own = (slug: string) => ({ path: `/ai/model/${slug}` });
  if (/deepseek|r1/.test(name)) return own("deepseek-r1");
  if (/coder/.test(name)) return own("qwen-coder");
  if (/qwen/.test(name)) return own("qwen3-30b");
  if (/mistral/.test(name)) return own("mistral-small");
  if (/gpt-oss-?20b/.test(name)) return own("gpt-oss-20b");
  if (/gpt-oss|120b/.test(name)) return { path: CHAT_LARGE_TOOL_PATH, model: "gpt-oss-120b" };
  if (/70b|llama-3\.3|large/.test(name)) return { path: CHAT_LARGE_TOOL_PATH, model: "llama-3.3-70b" };
  return { path: CHAT_TOOL_PATH };
}

/** Text of an OpenAI message `content` (a string, or an array of text parts). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("\n").trim();
  return "";
}

/**
 * Maps an OpenAI chat request onto the chat tool's query: system messages become the system prompt, a single user
 * message is the prompt, a longer conversation is rendered as a transcript the model is asked to continue.
 */
export function toChatQuery(body: unknown): { query: ChatQuery } | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object with a messages array" };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages) || b.messages.length === 0) return { error: "messages must be a non-empty array of { role, content }" };
  if (needsNative(b)) {
    const picked = toolFor(b.model);
    if (picked.path !== CHAT_TOOL_PATH) return { error: `tools, tool messages and response_format are served by ${CHAT_MODEL} (the default model); omit model or use llama-4-scout` };
    const last = [...b.messages].reverse().find((m) => m && typeof m === "object" && textOf((m as { content?: unknown }).content));
    const query: ChatQuery = { prompt: textOf((last as { content?: unknown } | undefined)?.content) || "Continue.", native: { messages: b.messages, ...(Array.isArray(b.tools) && b.tools.length ? { tools: b.tools } : {}), ...(b.tool_choice !== undefined ? { tool_choice: b.tool_choice } : {}), ...(b.response_format ? { response_format: b.response_format } : {}) } };
    const maxTokens = Number(b.max_completion_tokens ?? b.max_tokens);
    if (Number.isFinite(maxTokens) && maxTokens > 0) query.maxTokens = Math.min(1024, Math.floor(maxTokens));
    const temperature = Number(b.temperature);
    if (Number.isFinite(temperature) && temperature >= 0) query.temperature = Math.min(1.5, temperature);
    query.prompt = query.prompt.slice(-PROMPT_LIMIT);
    return { query };
  }
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
  const picked = toolFor(b.model);
  if (picked.model) query.model = picked.model;
  if (picked.path.startsWith("/ai/model/")) query.tool = picked.path;
  return { query };
}

/**
 * The same answer as server-sent events, for clients that ask for `stream: true` (most OpenAI SDK chat helpers and chat
 * UIs do by default). The tool answers in one piece, so the stream is one role chunk, one content chunk, the finish
 * chunk, an optional usage chunk (stream_options.include_usage) and [DONE]: what an OpenAI client expects to parse.
 */
export function toOpenAiStream(completion: ReturnType<typeof toOpenAiResponse>, includeUsage: boolean): string {
  const base = { id: completion.id, object: "chat.completion.chunk", created: completion.created, model: completion.model };
  const { message, finish_reason } = completion.choices[0];
  const calls = message.tool_calls ?? [];
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
    ...(message.content ? [{ ...base, choices: [{ index: 0, delta: { content: message.content }, finish_reason: null }] }] : []),
    ...(calls.length ? [{ ...base, choices: [{ index: 0, delta: { tool_calls: calls.map((t, index) => ({ index, ...t })) }, finish_reason: null }] }] : []),
    { ...base, choices: [{ index: 0, delta: {}, finish_reason }] },
    ...(includeUsage ? [{ ...base, choices: [], usage: completion.usage }] : []),
  ];
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}

type ToolCall = { id: string; type: string; function: { name: string; arguments: string } };
type ChatResult = { model?: string; response?: string; tool_calls?: ToolCall[]; finish_reason?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };

/**
 * The OpenAI-shaped answer for one chat tool result. A native call (tools, JSON mode) carries the model's tool_calls and
 * its own token counts; otherwise the counts are estimates (about four characters per token).
 */
export function toOpenAiResponse(query: ChatQuery, result: ChatResult, requestedModel?: string) {
  const text = String(result.response ?? "");
  const calls = Array.isArray(result.tool_calls) ? result.tool_calls : [];
  const counted = (result.usage?.prompt_tokens ?? 0) > 0;
  const promptTokens = counted ? result.usage!.prompt_tokens! : Math.ceil((query.prompt.length + (query.system ?? "").length) / 4);
  const completionTokens = counted ? result.usage!.completion_tokens ?? 0 : Math.ceil(text.length / 4);
  return {
    id: `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model ?? requestedModel ?? CHAT_MODEL,
    choices: [{
      index: 0,
      message: calls.length ? { role: "assistant", content: text || null, tool_calls: calls } : { role: "assistant", content: text as string | null },
      finish_reason: calls.length ? "tool_calls" : result.finish_reason === "length" ? "length" : "stop",
    }] as { index: number; message: { role: string; content: string | null; tool_calls?: ToolCall[] }; finish_reason: string }[],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens, estimated: !counted },
  };
}

const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"];
export const PASSTHROUGH_RESPONSE_HEADERS = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];

/**
 * The chat-completions body a GET request's query stands for, or null when the query names no prompt. Directories
 * that index every route as GET (Zero.xyz did) send agents here with `prompt=` (or `input`, `q`, `message`, `text`),
 * optional `system`/`instructions`, `model`, `max_tokens` and `temperature`; `messages=<JSON array>` is accepted too.
 */
export function chatBodyFromQuery(params: Record<string, string>): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  if (params.messages !== undefined) {
    try { body.messages = JSON.parse(params.messages); } catch { body.messages = params.messages; }
  } else {
    const prompt = params.prompt ?? params.input ?? params.q ?? params.message ?? params.text;
    if (prompt === undefined) return null;
    const system = params.system ?? params.instructions;
    body.messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
  }
  if (params.model) body.model = params.model;
  const max = params.max_tokens ?? params.maxTokens ?? params.max_completion_tokens ?? params.max_output_tokens;
  if (max !== undefined) body.max_tokens = Number(max);
  if (params.temperature !== undefined) body.temperature = Number(params.temperature);
  return body;
}

/** The request body: JSON for POST, the query's equivalent for GET and HEAD. */
export async function requestBody(c: C, fromQuery: (params: Record<string, string>) => unknown): Promise<unknown> {
  if (c.req.method === "GET" || c.req.method === "HEAD") return fromQuery(c.req.query());
  try { return await c.req.json(); } catch { return null; }
}

/** Handles /v1/chat/completions (POST body, or GET query) by forwarding the equivalent chat-tool GET through the whole middleware chain. */
export async function openAiChatCompletions(c: C, forward: Forward): Promise<Response> {
  const body = await requestBody(c, chatBodyFromQuery);
  const done = await completeChat(c, forward, body);
  if (!done.ok) return done.response;
  const completion = toOpenAiResponse(done.query, done.result, done.requestedModel);
  const b = (body && typeof body === "object" ? body : {}) as { stream?: unknown; stream_options?: { include_usage?: unknown } };
  const out = b.stream === true
    ? new Response(toOpenAiStream(completion, b.stream_options?.include_usage === true), { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } })
    : c.json(completion, 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = done.answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}

/**
 * Runs one chat request (an OpenAI chat-completions body) through the paid tool: validation, the unpaid quote, the
 * forwarded call. Shared by the chat-completions and Responses fronts, which only differ in the body and answer shapes.
 */
export async function completeChat(c: C, forward: Forward, body: unknown): Promise<
  { ok: true; answer: Response; query: ChatQuery; result: ChatResult; requestedModel?: string } | { ok: false; response: Response }
> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const mapped = toChatQuery(body);
  if ("error" in mapped && paying) {
    // Invalid input with a payment attached: refuse before anything is forwarded, so nothing is charged.
    return { ok: false, response: c.json({ error: { message: mapped.error, type: "invalid_request_error" } }, 400) };
  }
  // An unpaid probe (directories, validators, a first unpaid call) gets the real quote even with an empty body.
  const requestedModel = body && typeof body === "object" ? String((body as { model?: unknown }).model ?? "") || undefined : undefined;
  const picked = toolFor(requestedModel);
  const query: ChatQuery = "error" in mapped
    ? { prompt: String(ENDPOINTS.find((e) => e.path === CHAT_TOOL_PATH)?.params.prompt.example ?? "Hello"), model: picked.model, ...(picked.path.startsWith("/ai/model/") ? { tool: picked.path } : {}) }
    : mapped.query;
  const toolPath = query.tool ?? (query.model ? CHAT_LARGE_TOOL_PATH : CHAT_TOOL_PATH);
  const outer = new URL(c.req.url);
  const inner = new URL(toolPath, outer.origin);
  inner.searchParams.set("prompt", query.prompt);
  if (query.model) inner.searchParams.set("model", query.model);
  if (query.system) inner.searchParams.set("system", query.system);
  if (query.maxTokens) inner.searchParams.set("maxTokens", String(query.maxTokens));
  if (query.temperature !== undefined) inner.searchParams.set("temperature", String(query.temperature));
  if (query.native) {
    inner.searchParams.set("messages", JSON.stringify(query.native.messages));
    if (query.native.tools) inner.searchParams.set("tools", JSON.stringify(query.native.tools));
    if (query.native.tool_choice !== undefined) inner.searchParams.set("tool_choice", typeof query.native.tool_choice === "string" ? query.native.tool_choice : JSON.stringify(query.native.tool_choice));
    if (query.native.response_format) inner.searchParams.set("response_format", JSON.stringify(query.native.response_format));
  }
  if (outer.searchParams.get("trial") === "1") inner.searchParams.set("trial", "1");
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  const answer = await forward(new Request(inner.href, { method: "GET", headers }));
  if (answer.status === 402) return { ok: false, response: await asFrontQuote(answer, outer, FRONT_DESCRIPTIONS[outer.pathname] ?? "", toolPath) };
  if (answer.status !== 200) return { ok: false, response: answer }; // a refusal or an uncharged error, unchanged
  const result = (await answer.json().catch(() => ({}))) as ChatResult;
  return { ok: true, answer, query, result, requestedModel };
}

/** What the quote of each front says it sells; directories list a settled front under this name and text. */
export const FRONT_DESCRIPTIONS: Record<string, string> = {
  "/v1/chat/completions": "OpenAI-compatible chat completions for agents, pay per request: Llama 4 Scout by default with function calling (tools, tool_calls), JSON mode and streaming; Llama 3.3 70B, gpt-oss-20b/120b, Qwen3 30B, Qwen2.5 Coder, Mistral Small 3.1 or DeepSeek R1 by model name. No account or API key; failed calls are not charged.",
  "/v1/responses": "OpenAI Responses API shape, pay per request: input text or messages, instructions and max_output_tokens in, one completed message and output_text out. Llama 4 Scout by default, Llama 3.3 70B or gpt-oss-120b by model name. No account or API key; failed calls are not charged.",
  "/v1/search": "Web search API, neural-search request shape (query, numResults, contents.text), pay per request: top 1-20 results with title and URL, and the page text of the top 5 when contents.text is asked for. Brave Search results; no account or API key; failed calls are not charged.",
  "/v1/contents": "Page contents API (urls or ids, text.maxCharacters), pay per request: clean text, title, author and date of up to 5 pages in one call. No account or API key; failed calls are not charged.",
  "/v1/answer": "Answer API (query), pay per request: an answer from live web search results with citations (title, URL). No account or API key; failed calls are not charged.",
  "/v1/rerank": "Rerank API, Cohere-style request shape, pay per request: query and up to 50 documents in, relevance scores best first out (BAAI bge-reranker-base). No account or API key; failed calls are not charged.",
  "/v1/moderations": "OpenAI-compatible moderation, pay per request: one input in, flagged and categories out (Llama Guard 3, 14 hazard categories mapped onto OpenAI names). No account or API key; failed calls are not charged.",
  "/v1/messages": "Anthropic Messages API shape on open models, pay per request: Llama 4 Scout by default with tool_use and streaming, or an open model by name. Claude models are not served. No account or API key; failed calls are not charged.",
  "/v1/images/generations": "OpenAI-compatible image generation, pay per image: a prompt in, one 1024x1024 FLUX.1 schnell JPEG out as b64_json. No account or API key; failed calls are not charged.",
  "/v1/embeddings": "OpenAI-compatible embeddings, pay per request: one input string in, a 1,024-dimension BGE-M3 vector out (multilingual, for search and RAG). No account or API key; failed calls are not charged.",
};

/**
 * A front's 402 names the front, not the tool it forwards to: the x402 v2 resource (URL without the query, and the
 * front's description) and the v1 body's resource. Directories then list the OpenAI path, and clients that compare
 * the quoted resource with the URL they called accept it. The payment terms and the Bazaar extension stay the
 * tool's: the paid retry is checked against those (matching ignores the resource; echoed extensions must match).
 */
export async function asFrontQuote(answer: Response, outer: URL, description: string, toolPath?: string): Promise<Response> {
  const url = outer.origin + outer.pathname;
  const headers = new Headers(answer.headers);
  if (toolPath) headers.set("X-Tool", toolPath); // which tool (and so which price) this request maps to
  const encoded = headers.get("payment-required");
  if (encoded) {
    try {
      const terms = JSON.parse(atob(encoded)) as { resource?: Record<string, unknown> };
      terms.resource = { ...terms.resource, url, ...(description ? { description } : {}) };
      headers.set("payment-required", btoa(JSON.stringify(terms)));
    } catch { /* not ours to fix: pass it on unchanged */ }
  }
  let body: string | null = await answer.text();
  try {
    const parsed = JSON.parse(body) as { accepts?: Array<Record<string, unknown>> };
    if (Array.isArray(parsed.accepts)) {
      for (const a of parsed.accepts) { a.resource = url; if (description) a.description = description; }
      body = JSON.stringify(parsed);
      headers.delete("content-length");
    }
  } catch { /* an HTML page or another body: unchanged */ }
  return new Response(body, { status: answer.status, statusText: answer.statusText, headers });
}

/** GET /v1/models: the models behind /v1/chat/completions, free to read. */
export function openAiModels() {
  const created = 1735689600;
  return {
    object: "list",
    data: [
      { id: CHAT_MODEL, object: "model", created, owned_by: "cloudflare-workers-ai", tool: CHAT_TOOL_PATH },
      ...Object.entries(LARGE_CHAT_MODELS).map(([alias, id]) => ({ id, object: "model", created, owned_by: "cloudflare-workers-ai", alias, tool: CHAT_LARGE_TOOL_PATH })),
      ...MODEL_ENDPOINTS.filter((m) => m.slug !== "gpt-oss-120b").map((m) => ({ id: m.id, object: "model", created, owned_by: "cloudflare-workers-ai", alias: m.slug, tool: `/ai/model/${m.slug}`, price: m.price })),
    ],
  };
}

/** The OpenAPI `get` operation of a /v1 front: the same call with the inputs in the query, for GET-only clients. */
export function openApiGetVariant(operationId: string, summary: string, description: string, tags: string[], required: string, parameters: Record<string, { type: string; description: string; minimum?: number; maximum?: number }>, paymentInfo: unknown, responses: unknown) {
  return {
    operationId,
    summary,
    description,
    tags,
    "x-payment-info": paymentInfo,
    parameters: Object.entries(parameters).map(([name, schema]) => ({ name, in: "query", required: name === required, schema: { type: schema.type, ...(schema.minimum !== undefined ? { minimum: schema.minimum } : {}), ...(schema.maximum !== undefined ? { maximum: schema.maximum } : {}) }, description: schema.description })),
    responses,
  };
}

/** The two OpenAI-style paths for /openapi.json; the completion is paid at the chosen chat tool's price and terms. */
export function openAiOpenApiPaths(origin: string, prices: { small: string; large: string }, mpp: readonly unknown[]) {
  const paymentInfo = buildPaymentInfo({ min: prices.small, max: prices.large }, mpp);
  const errorResponses = {
    "400": { description: "Invalid request (not charged)" },
    "402": { description: "Payment Required" },
    "503": { description: "Daily AI capacity used up (not charged)" },
  };
  return {
    [OPENAI_CHAT_PATH]: {
      get: openApiGetVariant(
        "chat_completions_get",
        "Chat completion over GET (prompt in the query; same models and prices as the POST)",
        `The same chat completion for clients that can only GET: prompt (and optional system, model, max_tokens, temperature) in the query string, the OpenAI chat-completion shape back. Paid at the same prices as ${CHAT_TOOL_PATH} (${prices.small}) and ${CHAT_LARGE_TOOL_PATH} (${prices.large}, model "llama-3.3-70b" or "gpt-oss-120b"). Failed calls are never charged.`,
        ["ai", "chat", "completion", "llama", "openai"],
        "prompt",
        {
          prompt: { type: "string", description: "The user message (up to 8,000 characters)" },
          system: { type: "string", description: "Optional system prompt (up to 2,000 characters)" },
          model: { type: "string", description: `${CHAT_MODEL} (default, ${prices.small}), or llama-3.3-70b / gpt-oss-120b (${prices.large})` },
          max_tokens: { type: "integer", minimum: 1, maximum: 1024, description: "Maximum output tokens (default 400)" },
          temperature: { type: "number", minimum: 0, maximum: 1.5, description: "Default 0.6" },
        },
        paymentInfo,
        { "200": { description: "Chat completion (same shape as the POST)" }, ...errorResponses },
      ),
      post: {
        operationId: "chat_completions",
        summary: "OpenAI-compatible chat completion (Llama 4 Scout, Llama 3.3 70B, gpt-oss, Qwen3, Mistral, DeepSeek R1)",
        description: `OpenAI chat completions request shape, answered by the same models and at the same prices as ${CHAT_TOOL_PATH} (${prices.small}, default) and ${CHAT_LARGE_TOOL_PATH} (${prices.large}; pick it with model "llama-3.3-70b" or "gpt-oss-120b"): send messages (system, user, assistant), get one assistant message back. No streaming. Point an OpenAI SDK at ${origin}/v1 with an x402 or MPP fetch wrapper; the unpaid request returns the 402 quote and the paid retry returns the completion. Failed calls are never charged.`,
        tags: ["ai", "chat", "completion", "llama", "openai"],
        "x-payment-info": paymentInfo,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["messages"],
                properties: {
                  model: { type: "string", description: `${CHAT_MODEL} (default, ${prices.small}), or llama-3.3-70b / gpt-oss-120b (${prices.large})` },
                  messages: { type: "array", minItems: 1, items: { type: "object", required: ["role", "content"], properties: { role: { type: "string", enum: ["system", "user", "assistant"] }, content: { type: "string" } } } },
                  max_tokens: { type: "integer", minimum: 1, maximum: 1024, description: "Maximum output tokens (default 400)" },
                  temperature: { type: "number", minimum: 0, maximum: 1.5, description: "Default 0.6" },
                  stream: { type: "boolean", description: "true answers OpenAI server-sent events ending in [DONE]" },
                  tools: { type: "array", description: "OpenAI function tools (Llama 4 Scout, the default model): the answer carries tool_calls", items: { type: "object" } },
                  tool_choice: { description: "auto, none, required or one named function" },
                  response_format: { type: "object", description: "{\"type\":\"json_object\"} or a json_schema" },
                },
              },
              example: { model: CHAT_MODEL, messages: [{ role: "system", content: "You are a concise assistant." }, { role: "user", content: "Explain x402 in one sentence." }], max_tokens: 200 },
            },
          },
        },
        responses: {
          "200": {
            description: "Chat completion",
            content: {
              "application/json": {
                schema: { type: "object", properties: { id: { type: "string" }, object: { type: "string" }, created: { type: "integer" }, model: { type: "string" }, choices: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, message: { type: "object", properties: { role: { type: "string" }, content: { type: "string" } } }, finish_reason: { type: "string" } } } }, usage: { type: "object", properties: { prompt_tokens: { type: "integer" }, completion_tokens: { type: "integer" }, total_tokens: { type: "integer" }, estimated: { type: "boolean" } } } } },
                example: { id: "chatcmpl-0123456789abcdef01234567", object: "chat.completion", created: 1792400000, model: CHAT_MODEL, choices: [{ index: 0, message: { role: "assistant", content: "x402 lets software pay for an HTTP request with a stablecoin by answering a 402 Payment Required challenge." }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36, estimated: true } },
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
        description: "The models behind /v1/chat/completions. Free.",
        tags: ["ai", "openai"],
        security: [],
        responses: { "200": { description: "Model list", content: { "application/json": { example: openAiModels() } } } },
      },
    },
  };
}
