// OpenAI-compatible moderation: `POST /v1/moderations` with `{ input }`, answered in the OpenAI shape, as a front for the
// paid /ai/moderation tool (Llama Guard 3) through the same middleware and payment paths as the other /v1 fronts. One
// input per request: one payment pays for one call. Llama Guard's 14 hazard categories are mapped onto OpenAI's category
// names where one exists, and listed as they are in `llama_guard_categories`.
import type { Context } from "hono";
import { ENDPOINTS } from "../endpoints";
import type { Env } from "./env";
import { FRONT_DESCRIPTIONS, asFrontQuote, requestBody } from "./openai-chat";

export const OPENAI_MODERATIONS_PATH = "/v1/moderations";
export const MODERATION_TOOL_PATH = "/ai/moderation";
const TEXT_LIMIT = 8000;
type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;
const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"];
const PASSTHROUGH_RESPONSE_HEADERS = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];

const OPENAI_KEYS = ["harassment", "harassment/threatening", "hate", "hate/threatening", "illicit", "illicit/violent", "self-harm", "self-harm/intent", "self-harm/instructions", "sexual", "sexual/minors", "violence", "violence/graphic"] as const;
const FROM_GUARD: Readonly<Record<string, readonly string[]>> = {
  S1: ["violence", "illicit/violent"], S2: ["illicit"], S3: ["sexual", "illicit"], S4: ["sexual/minors"], S5: ["harassment"],
  S9: ["illicit/violent", "violence"], S10: ["hate"], S11: ["self-harm"], S12: ["sexual"],
};

export function toModerationText(body: unknown): { text: string } | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object with an input string" };
  const input = (body as { input?: unknown }).input;
  const items = Array.isArray(input) ? input : [input];
  if (items.length !== 1) return { error: "one input per request: this endpoint pays for one tool call, so send a single string (or a one-item array)" };
  const item = items[0];
  const text = typeof item === "string" ? item.trim() : item && typeof item === "object" && (item as { type?: unknown }).type === "text" ? String((item as { text?: unknown }).text ?? "").trim() : "";
  if (!text) return { error: "input must be a non-empty string" };
  if (text.length > TEXT_LIMIT) return { error: `input must be at most ${TEXT_LIMIT} characters` };
  return { text };
}

export function toOpenAiModeration(result: { flagged?: boolean; categories?: { code: string; name: string }[]; model?: string }) {
  const codes = (result.categories ?? []).map((c) => c.code);
  const categories = Object.fromEntries(OPENAI_KEYS.map((k) => [k, codes.some((c) => FROM_GUARD[c]?.includes(k))]));
  return {
    id: `modr-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    model: result.model ?? "llama-guard-3-8b",
    results: [{
      flagged: Boolean(result.flagged),
      categories,
      category_scores: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v ? 1 : 0])),
      llama_guard_categories: result.categories ?? [],
    }],
  };
}

export function moderationBodyFromQuery(params: Record<string, string>): Record<string, unknown> | null {
  const input = params.input ?? params.text;
  return input === undefined ? null : { input };
}

/** Handles /v1/moderations (POST body, or GET query) by forwarding the equivalent /ai/moderation GET through the middleware. */
export async function openAiModerations(c: C, forward: Forward): Promise<Response> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const body = await requestBody(c, moderationBodyFromQuery);
  const mapped = toModerationText(body);
  if ("error" in mapped && paying) return c.json({ error: { message: mapped.error, type: "invalid_request_error" } }, 400);
  const text = "error" in mapped ? String(ENDPOINTS.find((e) => e.path === MODERATION_TOOL_PATH)?.params.text.example ?? "hello") : mapped.text;
  const outer = new URL(c.req.url);
  const inner = new URL(MODERATION_TOOL_PATH, outer.origin);
  inner.searchParams.set("text", text);
  if (outer.searchParams.get("trial") === "1") inner.searchParams.set("trial", "1");
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  const answer = await forward(new Request(inner.href, { method: "GET", headers }));
  if (answer.status === 402) return asFrontQuote(answer, outer, FRONT_DESCRIPTIONS[outer.pathname] ?? "", MODERATION_TOOL_PATH);
  if (answer.status !== 200) return answer;
  const result = (await answer.json().catch(() => ({}))) as { flagged?: boolean; categories?: { code: string; name: string }[]; model?: string };
  const out = c.json(toOpenAiModeration(result), 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}
