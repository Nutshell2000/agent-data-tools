// What a prepaid key pays on the OpenAI-shaped voice fronts, and how those fronts word a key that cannot pay.
// 16 Nov 2026 (sales plan, work item 4): OpenAI retires tts-1 and whisper-1 in early 2027; a developer who points an
// OpenAI SDK at /v1 here makes one short test call first, and that call should cost what it is worth.
//
//   POST /v1/audio/transcriptions, audio of SHORT_AUDIO_SECONDS (30 s) or less: 1 credit ($0.001) with a prepaid key.
//     Whisper large-v3-turbo costs us about $0.0005 per audio MINUTE, so 30 seconds cost about $0.00026.
//     MP3 and WAV are measured from the bytes before anything is charged. Any other format is charged the tool's price
//     and the difference is given back after the call, only when the model itself reports a length of 30 s or less.
//     If the length is unknown the tool's price stands: a long file is never undercharged.
//   POST /v1/audio/speech: SPEECH_CREDITS_PER_100 (4) credits per started 100 characters with a prepaid key, never more
//     than the flat price of the tool the text runs on. Aura-2 costs us $0.003 per 100 characters, so every length is
//     billed above cost: 1-100 characters 4 credits, 101-200 8, 201-300 10 (the /ai/speech price, not 12), and so on up
//     to 80 at 1,901-2,000 characters (the /text-to-speech price). No call costs more than it did before.
//     The rate is a price for the owner to confirm (prices are delegated to sessions, 1.166.0); it is a key price for a
//     front, so the public catalog prices and their freeze file do not change.
//
// Wallets and routers paying per call (x402, MPP) keep the tools' prices: each on-chain settlement above 1,000 a month
// costs us $0.001, so a $0.001 call would net nothing there (the same reason as lib/key-prices.ts).
import type { Env } from "./env";
import { creditsFromMicros, hashCreditKey, priceMicros } from "./credits";

export const SHORT_AUDIO_SECONDS = 30;
export const SHORT_AUDIO_KEY_PRICE = "$0.001";
export const SPEECH_CREDITS_PER_100 = 4;

const inCredits = (price: string) => Math.round(Number(price.slice(1)) * 1000);
const asPrice = (credits: number) => `$${(credits / 1000).toFixed(3)}`;

/** Credits a prepaid key pays to speak `characters` on a tool whose flat price is `toolPrice`: per started 100, capped at that price. */
export const speechKeyCredits = (characters: number, toolPrice: string): number =>
  Math.min(inCredits(toolPrice), Math.max(1, Math.ceil(characters / 100)) * SPEECH_CREDITS_PER_100);
/** The per-100-characters price before the cap; `frontKeyPrice` applies the cap, because the paywall knows the tool's price. */
export const speechRatePrice = (characters: number): string => asPrice(Math.max(1, Math.ceil(characters / 100)) * SPEECH_CREDITS_PER_100);

// The price a front set for the tool request it forwards. Keyed by the Request object itself, so a caller cannot set it
// with a header: only code in this isolate that built the request can.
const KEY_PRICE = new WeakMap<Request, string>();
export const setFrontKeyPrice = (inner: Request, price: string) => { KEY_PRICE.set(inner, price); };
/** The key price a front chose for this request, when it is below what the key would pay anyway. */
export function frontKeyPrice(request: Request, usual: string): string {
  const set = KEY_PRICE.get(request);
  return set && priceMicros(set) < priceMicros(usual) ? set : usual;
}

/**
 * A transcription that was charged the tool's price and turned out to be short: gives the difference back and returns
 * the headers to show, or null when nothing changes. `charged` is the answer's X-Credits-Charged; anything but the
 * tool's full price (a free key's call, a review key, an earlier short price) is left alone.
 */
export async function rebateShortAudio(env: Env, key: string, toolPrice: string, charged: string | null, seconds: unknown): Promise<{ charged: string; remaining: string } | null> {
  if (typeof seconds !== "number" || !(seconds > 0) || seconds > SHORT_AUDIO_SECONDS) return null;
  const full = priceMicros(toolPrice), short = priceMicros(SHORT_AUDIO_KEY_PRICE);
  if (full <= short || charged !== String(creditsFromMicros(full))) return null;
  const store = env.METRICS?.get(env.METRICS.idFromName("credits"));
  if (!store) return null;
  const balance = await store.rebateCredits(await hashCreditKey(key), full - short).catch((e: unknown) => { console.error("credits: short-audio rebate failed", e); return null; });
  return balance === null ? null : { charged: String(creditsFromMicros(short)), remaining: String(creditsFromMicros(balance)) };
}

// ---- Errors a person can read ---------------------------------------------------------------------------------------

export type ErrorShape = "openai" | "eleven";
/** Codes of the key refusals built in lib/credit-routes.ts `chargeCredits` and lib/voice-keys.ts `chargeVoiceKey`. */
const KEY_ERROR_CODES = new Set(["invalid_api_key", "insufficient_credits", "test_key_scope", "trial_key_scope", "test_key_used_up", "trial_used_up", "test_key_limit", "trial_key_limit", "daily_test_speech_used_up", "daily_trial_used_up", "unavailable", "review_key_limit"]);
const OPENAI_TYPE: Record<string, string> = { invalid_api_key: "invalid_request_error", insufficient_credits: "insufficient_quota", unavailable: "server_error" };

/** A refusal in the caller's API shape, the sentence first: OpenAI's `{ error: { message, type, code } }` or ElevenLabs' `{ detail: { status, message } }`. */
export function frontError(shape: ErrorShape, status: number, message: string, code: string, rest: Record<string, unknown> = {}, headers?: Headers): Response {
  const body = shape === "openai"
    ? { error: { message, type: OPENAI_TYPE[code] ?? "invalid_request_error", code }, ...rest }
    : { detail: { status: code, message }, ...rest };
  const out = new Headers(headers);
  out.set("content-type", "application/json; charset=utf-8");
  out.delete("content-length");
  return new Response(JSON.stringify(body), { status, headers: out });
}

/**
 * The tool's answer when it is one of the key refusals (`{ error: "<sentence>", code, ... }`), rewritten in the front's
 * shape so an SDK prints the sentence; null for every other answer, which the front passes on as before.
 */
export async function asFrontKeyError(answer: Response, shape: ErrorShape): Promise<Response | null> {
  if (answer.status < 400 || !(answer.headers.get("content-type") ?? "").includes("json")) return null;
  const body = await answer.clone().json().catch(() => null) as { error?: unknown; code?: unknown } | null;
  if (!body || typeof body.error !== "string" || typeof body.code !== "string" || !KEY_ERROR_CODES.has(body.code)) return null;
  const { error, code, ...rest } = body as { error: string; code: string } & Record<string, unknown>;
  return frontError(shape, answer.status, error, code, rest, answer.headers);
}

/** True when the request carries a key-like credential that is neither one of our keys nor a payment. */
export function foreignKey(header: (name: string) => string | undefined, isOurKey: boolean): boolean {
  if (isOurKey || header("payment-signature") || header("x-payment")) return false;
  const auth = (header("authorization") ?? "").trim();
  if (/^Payment\s/i.test(auth)) return false;
  return Boolean(auth || header("x-api-key")?.trim() || header("xi-api-key")?.trim());
}

/** The sentence a quote starts with when the caller sent a key from somewhere else (an OpenAI key left in the SDK). */
export const foreignKeySentence = (origin: string, testKeys: boolean) =>
  `The API key sent with this request is not one of this service's keys (they start with adt_), so the request was treated as unpaid and nothing was charged. Buy a key from $1 at ${origin}/credits${testKeys ? `, get a free voice test key with POST ${origin}/keys/voice-test,` : ""} or pay this call as quoted here.`;

/** Puts `sentence` first in a 402 quote's JSON body (its `error` text), leaving every payment field as it was. */
export async function withSentenceFirst(quote: Response, sentence: string): Promise<Response> {
  if (quote.status !== 402 || !(quote.headers.get("content-type") ?? "").includes("json")) return quote;
  const body = await quote.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body) || typeof body !== "object") return quote;
  const { error, ...rest } = body;
  const headers = new Headers(quote.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify({ error: typeof error === "string" && error ? `${sentence} (${error.replace(/\.$/, "")}.)` : sentence, ...rest }), { status: 402, headers });
}
