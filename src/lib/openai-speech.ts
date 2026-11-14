// OpenAI-compatible text to speech: `POST /v1/audio/speech` with `{ model, input, voice, response_format? }`, answered
// as OpenAI answers it: the audio file itself (audio/mpeg), not JSON. A front for the two paid speech tools through the
// same middleware and payment paths as the other /v1 fronts: input up to 300 characters runs /ai/speech, longer input
// (up to 2,000 characters) runs /text-to-speech, each at its own price. One file per request.
// Why (10 Nov 2026): the steadiest router buyer paid other sellers $37 in a week for speech, most of it to OpenAI's
// /v1/audio/speech shape, and clients written for that shape send `input` and an OpenAI voice name and expect bytes back.
// Both tools already map OpenAI voice names to Aura-2 voices (OPENAI_VOICES in routes/ai-text.ts).
import type { Context } from "hono";
import type { Env } from "./env";
import { FRONT_DESCRIPTIONS, asFrontQuote, openApiGetVariant, requestBody } from "./openai-chat";
import { paymentInfo as buildPaymentInfo } from "./payment-info";

export const OPENAI_SPEECH_PATH = "/v1/audio/speech";
export const SPEECH_TOOL_PATH = "/ai/speech";
export const SPEECH_LONG_TOOL_PATH = "/text-to-speech";
/** The two tools' own limits (routes/ai-text.ts SPEECH_MAX and SPEECH_LONG_MAX); tests/openai-speech.test.cjs keeps them equal. */
export const SPEECH_SHORT_LIMIT = 300;
export const SPEECH_INPUT_LIMIT = 2000;
const PROBE_TEXT = "Your payment was received. Thank you!";

type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;
const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key"];
const PASSTHROUGH_RESPONSE_HEADERS = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];

export interface SpeechRequest { text: string; voice?: string; lang?: string; tool: string }

/** ElevenLabs SDKs send the API key as `xi-api-key`: an adt_ prepaid key sent that way is read as X-API-Key. */
export function withXiKey(headers: Headers): Headers {
  const xi = headers.get("xi-api-key")?.trim();
  if (xi && !headers.get("x-api-key") && !headers.get("authorization")) headers.set("x-api-key", xi);
  headers.delete("xi-api-key");
  return headers;
}

/** The speech request an OpenAI audio body stands for, or why it cannot be served. */
export function toSpeechRequest(body: unknown): SpeechRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object with input" };
  const b = body as { input?: unknown; text?: unknown; voice?: unknown; response_format?: unknown; lang?: unknown; language?: unknown; speed?: unknown };
  const raw = typeof b.input === "string" ? b.input : typeof b.text === "string" ? b.text : "";
  const text = raw.trim();
  if (!text) return { error: "input is required: the text to speak" };
  if (text.length > SPEECH_INPUT_LIMIT) return { error: `input must be at most ${SPEECH_INPUT_LIMIT} characters` };
  const format = b.response_format === undefined || b.response_format === null ? "mp3" : String(b.response_format).toLowerCase();
  if (format !== "mp3") return { error: "response_format must be mp3 (the only format this endpoint returns)" };
  if (b.speed !== undefined && Number(b.speed) !== 1) return { error: "speed must be 1 (other speeds are not supported)" };
  // OpenAI voices may be sent as a name or as { id }; anything else is left to the tool's default voice.
  const voice = typeof b.voice === "string" ? b.voice.trim().toLowerCase() : b.voice && typeof b.voice === "object" && typeof (b.voice as { id?: unknown }).id === "string" ? String((b.voice as { id: string }).id).trim().toLowerCase() : "";
  const langRaw = typeof b.lang === "string" ? b.lang : typeof b.language === "string" ? b.language : "";
  const lang = langRaw.trim().toLowerCase().slice(0, 2);
  if (lang && lang !== "en" && lang !== "es") return { error: "language must be en or es" };
  return { text, ...(voice ? { voice } : {}), ...(lang ? { lang } : {}), tool: text.length > SPEECH_SHORT_LIMIT ? SPEECH_LONG_TOOL_PATH : SPEECH_TOOL_PATH };
}

/** The audio body a GET query stands for (`input=` or `text=`), or null when it names no text. */
export function speechBodyFromQuery(params: Record<string, string>): Record<string, unknown> | null {
  const input = params.input ?? params.text;
  return input === undefined ? null : { input, voice: params.voice, response_format: params.response_format, language: params.language ?? params.lang };
}

/** Base64 to bytes. */
export function audioBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Handles /v1/audio/speech (POST body, or GET query) by forwarding the equivalent speech-tool GET through the whole middleware chain. */
export async function openAiSpeech(c: C, forward: Forward): Promise<Response> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const body = await requestBody(c, speechBodyFromQuery);
  const mapped = toSpeechRequest(body);
  if ("error" in mapped && paying) return c.json({ error: { message: mapped.error, type: "invalid_request_error" } }, 400);
  // An unpaid probe gets a real quote even with an empty body: the short tool's, the price most requests pay.
  const request: SpeechRequest = "error" in mapped ? { text: PROBE_TEXT, tool: SPEECH_TOOL_PATH } : mapped;
  return speakThrough(c, forward, request, FRONT_DESCRIPTIONS[new URL(c.req.url).pathname] ?? "");
}

/** Runs one speech request through the speech tool it maps to and answers with the MP3 bytes (or the tool's quote under the caller's path). */
export async function speakThrough(c: C, forward: Forward, request: SpeechRequest, description: string): Promise<Response> {
  const outer = new URL(c.req.url);
  const inner = new URL(request.tool, outer.origin);
  inner.searchParams.set("text", request.text);
  if (request.voice) inner.searchParams.set("voice", request.voice);
  if (request.lang) inner.searchParams.set("lang", request.lang);
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  withXiKey(headers);
  const answer = await forward(new Request(inner.href, { method: "GET", headers }));
  if (answer.status === 402) return asFrontQuote(answer, outer, description, request.tool);
  if (answer.status !== 200) return answer;
  const result = (await answer.json().catch(() => ({}))) as { audioBase64?: string; contentType?: string; voice?: string; characters?: number };
  if (!result.audioBase64) return answer;
  const out = new Response(audioBytes(result.audioBase64), { status: 200, headers: { "content-type": result.contentType ?? "audio/mpeg", "cache-control": "no-store" } });
  for (const name of PASSTHROUGH_RESPONSE_HEADERS) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
  if (result.voice) out.headers.set("x-voice", result.voice);
  out.headers.set("x-tool", request.tool);
  return out;
}

/** The /v1/audio/speech path for /openapi.json: priced by input length, at the two speech tools' prices and terms. */
export function openAiSpeechOpenApiPath(origin: string, prices: { short: string; long: string }, mpp: readonly unknown[]) {
  const paymentInfo = buildPaymentInfo({ min: prices.short, max: prices.long }, mpp);
  const priced = `${prices.short} for input up to ${SPEECH_SHORT_LIMIT} characters, ${prices.long} for longer input up to ${SPEECH_INPUT_LIMIT.toLocaleString("en-US")} characters`;
  const audio = { description: "The speech as an MP3 file", content: { "audio/mpeg": { schema: { type: "string", format: "binary" } } } };
  const others = { "400": { description: "Invalid request (not charged)" }, "402": { description: "Payment Required" }, "503": { description: "Daily AI capacity used up (not charged)" } };
  return {
    [OPENAI_SPEECH_PATH]: {
      get: openApiGetVariant(
        "audio_speech_get",
        "Text to speech over GET (input in the query; same voices and prices as the POST)",
        `The same audio for clients that can only GET: input (up to ${SPEECH_INPUT_LIMIT.toLocaleString("en-US")} characters) and an optional voice in the query string, an MP3 file back. ${priced}. Failed calls are never charged.`,
        ["ai", "text-to-speech", "tts", "audio", "openai"],
        "input",
        { input: { type: "string", description: `Text to speak (up to ${SPEECH_INPUT_LIMIT.toLocaleString("en-US")} characters)` }, voice: { type: "string", description: "An OpenAI voice name (alloy, nova, onyx…) or an Aura-2 voice name; default luna" }, language: { type: "string", description: "en (default) or es" } },
        paymentInfo,
        { "200": audio, ...others },
      ),
      post: {
        operationId: "audio_speech",
        summary: "OpenAI-compatible text to speech (Deepgram Aura-2, MP3 file)",
        description: `OpenAI audio speech request shape: send input and a voice, get the MP3 file back as the response body. ${priced}; the 402 quote for a request states its price. OpenAI voice names (alloy, ash, coral, echo, fable, nova, onyx, sage, shimmer…) are mapped to Aura-2 voices; Aura-2 voice names work too. English by default, Spanish with language=es. response_format must be mp3 and speed 1; model is accepted and ignored. Point an OpenAI SDK at ${origin}/v1 with an x402 or MPP fetch wrapper, or an adt_ prepaid key as apiKey. Failed calls are never charged.`,
        tags: ["ai", "text-to-speech", "tts", "audio", "openai"],
        "x-payment-info": paymentInfo,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["input"], properties: { input: { type: "string", description: `Text to speak (up to ${SPEECH_INPUT_LIMIT.toLocaleString("en-US")} characters)` }, voice: { type: "string", description: "An OpenAI voice name or an Aura-2 voice name; default luna" }, model: { type: "string", description: "Ignored; the model is Deepgram Aura-2" }, response_format: { type: "string", description: "mp3 (the only format)" }, language: { type: "string", description: "en (default) or es" } } },
              example: { model: "tts-1", input: "Your order has shipped and should reach you within three working days.", voice: "nova" },
            },
          },
        },
        responses: { "200": audio, ...others },
      },
    },
  };
}
