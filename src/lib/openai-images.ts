// OpenAI-compatible image generation: `POST /v1/images/generations` with `{ prompt, n?, size?, response_format? }`,
// answered in the OpenAI shape, as a front for the paid /image tool (FLUX.1 schnell, 1024x1024 JPEG) through the same
// middleware and payment paths as the chat and embeddings fronts. One image per request: one payment pays for one call.
// Why (25 Oct 2026): agents that already call OpenAI's images API buy images by that shape; BlockRun's images endpoint
// sold 2,046 calls in 30 days at $0.041, ours is $0.01.
import type { Context } from "hono";
import { ENDPOINTS } from "../endpoints";
import type { Env } from "./env";
import { FRONT_DESCRIPTIONS, asFrontQuote, openApiGetVariant, requestBody } from "./openai-chat";
import { paymentInfo as buildPaymentInfo } from "./payment-info";

export const OPENAI_IMAGES_PATH = "/v1/images/generations";
export const IMAGE_TOOL_PATH = "/image";
const PROMPT_LIMIT = 800;

type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;
const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"];
const PASSTHROUGH_RESPONSE_HEADERS = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];

/** The prompt of an OpenAI images body, or why it cannot be served. */
export function toImagePrompt(body: unknown): { prompt: string } | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object with a prompt" };
  const b = body as { prompt?: unknown; n?: unknown };
  if (b.n !== undefined && Number(b.n) !== 1) return { error: "n must be 1: one payment pays for one image" };
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (prompt.length < 3) return { error: "prompt must be at least 3 characters" };
  if (prompt.length > PROMPT_LIMIT) return { error: `prompt must be at most ${PROMPT_LIMIT} characters` };
  return { prompt };
}

/** The OpenAI-shaped answer for one /image result: the image as b64_json, and as a data: URL in `url` for clients that read it. */
export function toOpenAiImage(prompt: string, result: { imageBase64?: string; contentType?: string; model?: string }) {
  const b64 = result.imageBase64 ?? "";
  return {
    created: Math.floor(Date.now() / 1000),
    data: [{ b64_json: b64, url: `data:${result.contentType ?? "image/jpeg"};base64,${b64}`, revised_prompt: prompt }],
    model: result.model,
    size: "1024x1024",
    output_format: (result.contentType ?? "image/jpeg").replace("image/", ""),
  };
}

/** The images body a GET query stands for (`prompt=`), or null when it names no prompt. */
export function imageBodyFromQuery(params: Record<string, string>): Record<string, unknown> | null {
  return params.prompt === undefined ? null : { prompt: params.prompt };
}

/** Handles /v1/images/generations (POST body, or GET query) by forwarding the equivalent /image GET through the whole middleware chain. */
export async function openAiImages(c: C, forward: Forward): Promise<Response> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const body = await requestBody(c, imageBodyFromQuery);
  const mapped = toImagePrompt(body);
  if ("error" in mapped && paying) return c.json({ error: { message: mapped.error, type: "invalid_request_error" } }, 400);
  // An unpaid probe gets the real quote even with an empty body.
  const prompt = "error" in mapped ? String(ENDPOINTS.find((e) => e.path === IMAGE_TOOL_PATH)?.params.prompt.example ?? "a lighthouse at sunset") : mapped.prompt;
  const outer = new URL(c.req.url);
  const inner = new URL(IMAGE_TOOL_PATH, outer.origin);
  inner.searchParams.set("prompt", prompt);
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  const answer = await forward(new Request(inner.href, { method: "GET", headers }));
  if (answer.status === 402) return asFrontQuote(answer, outer, FRONT_DESCRIPTIONS[outer.pathname] ?? "", IMAGE_TOOL_PATH);
  if (answer.status !== 200) return answer;
  const result = (await answer.json().catch(() => ({}))) as { imageBase64?: string; contentType?: string; model?: string };
  const out = c.json(toOpenAiImage(prompt, result), 200);
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
  out.headers.set("Cache-Control", "no-store");
  return out;
}

/** The /v1/images/generations path for /openapi.json, paid at the /image price and terms. */
export function openAiImagesOpenApiPath(origin: string, price: string, mpp: readonly unknown[]) {
  const paymentInfo = buildPaymentInfo({ amount: price }, mpp);
  return {
    [OPENAI_IMAGES_PATH]: {
      get: openApiGetVariant(
        "images_generations_get",
        "Image generation over GET (prompt in the query; same model and price as the POST)",
        `The same image for clients that can only GET: prompt (3-${PROMPT_LIMIT} characters) in the query string, the OpenAI images shape back, paid at the ${IMAGE_TOOL_PATH} price (${price}). Failed calls are never charged.`,
        ["ai", "image-generation", "images", "openai"],
        "prompt",
        { prompt: { type: "string", description: `What the image should show (3-${PROMPT_LIMIT} characters)` } },
        paymentInfo,
        { "200": { description: "Image (same shape as the POST)" }, "400": { description: "Invalid request (not charged)" }, "402": { description: "Payment Required" }, "503": { description: "Daily AI capacity used up (not charged)" } },
      ),
      post: {
        operationId: "images_generations",
        summary: "OpenAI-compatible image generation (FLUX.1 schnell, 1024x1024)",
        description: `OpenAI images request shape, answered by the same model and at the same price as ${IMAGE_TOOL_PATH} (${price}): send a prompt, get one 1024x1024 JPEG as b64_json (and as a data: URL in url). n must be 1, because one payment pays for one image; size and quality are accepted and ignored. Point an OpenAI SDK at ${origin}/v1 with an x402 or MPP fetch wrapper, or an adt_ card-credit key as apiKey. Failed calls are never charged.`,
        tags: ["ai", "image-generation", "images", "openai"],
        "x-payment-info": paymentInfo,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string", description: `What the image should show (3-${PROMPT_LIMIT} characters)` }, n: { type: "integer", description: "Must be 1" }, size: { type: "string", description: "Ignored; images are 1024x1024" }, model: { type: "string", description: "Ignored; the model is FLUX.1 schnell" }, response_format: { type: "string", description: "b64_json or url; both fields are always filled" } } },
              example: { prompt: "a lighthouse on a cliff at sunset, watercolor", n: 1, size: "1024x1024" },
            },
          },
        },
        responses: {
          "200": { description: "Image", content: { "application/json": { schema: { type: "object", properties: { created: { type: "integer" }, data: { type: "array", items: { type: "object", properties: { b64_json: { type: "string" }, url: { type: "string" }, revised_prompt: { type: "string" } } } }, model: { type: "string" }, size: { type: "string" }, output_format: { type: "string" } } }, example: { created: 1792400000, data: [{ b64_json: "/9j/4AAQSkZJRgABAQAAAQABAAD...", url: "data:image/jpeg;base64,/9j/4AAQ...", revised_prompt: "a lighthouse on a cliff at sunset, watercolor" }], model: "@cf/black-forest-labs/flux-1-schnell", size: "1024x1024", output_format: "jpeg" } } } },
          "400": { description: "Invalid request body (not charged)" },
          "402": { description: "Payment Required" },
          "503": { description: "Daily AI capacity used up (not charged)" },
        },
      },
    },
  };
}
