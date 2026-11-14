// Drop-in voice APIs (14 Nov 2026, voice plan: business/voice-plan-2026-11-14/plan.md). Code written for ElevenLabs or
// for OpenAI's audio endpoints switches to us by changing the base URL; no account, pay per request (x402, MPP, a
// prepaid adt_ key as X-API-Key, Authorization: Bearer or ElevenLabs' xi-api-key header).
//   POST /v1/text-to-speech/{voice_id}[/stream]  ElevenLabs text to speech  -> /ai/speech or /text-to-speech (MP3 bytes)
//   POST /v1/speech-to-text                      ElevenLabs speech to text  -> /transcribe (words with timings)
//   POST /v1/audio/transcriptions                OpenAI transcription       -> /transcribe (json, text, srt, vtt, verbose_json)
// Same pattern as the other /v1 fronts: the request is mapped onto one tool GET and forwarded through the whole
// middleware (`forward`), so prices, payments and refusals are the tool's; an unpaid or empty request gets the tool's
// quote under the front's own path (`asFrontQuote`); invalid input with a payment attached is refused before anything
// is forwarded. An uploaded file waits in lib/file-input.ts and travels as its hash, so the quote and the paid retry of
// the same file name the same resource.
import type { Context } from "hono";
import type { Env } from "./env";
import { asFrontQuote, requestBody } from "./openai-chat";
import { SPEECH_INPUT_LIMIT, SPEECH_SHORT_LIMIT, SPEECH_LONG_TOOL_PATH, SPEECH_TOOL_PATH, speakThrough, withXiKey, type SpeechRequest } from "./openai-speech";
import { FILE_INPUT, holdFile, releaseFile, sentFile } from "./file-input";
import { TRANSCRIBE_MAX_BYTES } from "../routes/ai";
import { SPEECH_VOICES, OPENAI_VOICES } from "../routes/ai-text";

type Forward = (request: Request) => Response | Promise<Response>;
type C = Context<{ Bindings: Env }>;

export const ELEVEN_TTS_PATH = "/v1/text-to-speech/:voice_id";
export const ELEVEN_TTS_STREAM_PATH = "/v1/text-to-speech/:voice_id/stream";
export const ELEVEN_STT_PATH = "/v1/speech-to-text";
export const OPENAI_TRANSCRIPTIONS_PATH = "/v1/audio/transcriptions";
export const TRANSCRIBE_TOOL_PATH = "/transcribe";
/** The published example of /transcribe: what an unpaid probe without audio is quoted on. */
const PROBE_AUDIO = "https://commons.wikimedia.org/wiki/Special:FilePath/En-us-hello.ogg";
const PROBE_TEXT = "Your payment was received. Thank you!";

export const VOICE_FRONT_DESCRIPTIONS = {
  tts: "ElevenLabs-compatible text to speech, pay per request: text in, one MP3 file out (Deepgram Aura-2 voices; ElevenLabs premade voice IDs map to a similar voice). Up to 2,000 characters, English or Spanish. No account; failed calls are not charged.",
  stt: "ElevenLabs-compatible speech to text, pay per request: an audio file (multipart file, or cloud_storage_url) in, transcript with language and word timings out (Whisper large-v3-turbo, 90+ languages). Up to 5 MB. No account; failed calls are not charged.",
  openaiStt: "OpenAI-compatible audio transcription, pay per request: an audio file in, the transcript out as json, text, srt, vtt or verbose_json (Whisper large-v3-turbo, 90+ languages). Up to 5 MB. No account; failed calls are not charged.",
} as const;

const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key", "xi-api-key"];
const PASSTHROUGH = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-free-trial-remaining", "x-request-id"];

const FEMALE = ["luna", "asteria", "thalia", "athena", "aurora", "hera", "iris", "juno", "cora", "helena", "ophelia", "phoebe", "vesta"] as const;
const MALE = ["orion", "zeus", "apollo", "arcas", "draco", "orpheus", "atlas", "hermes", "jupiter", "mars", "odysseus", "saturn", "neptune"] as const;
/**
 * ElevenLabs premade voices (ID, name, voice gender) as their SDK examples and default library name them. Each maps to
 * an Aura-2 voice of the same gender, so code that names "Rachel" or her ID gets a similar voice, not an error. The
 * answer's X-Voice header names the voice that spoke. These are mappings to our own voices, never imitations.
 */
const ELEVEN_PREMADE: ReadonlyArray<readonly [string, string, "f" | "m"]> = [
  ["21m00Tcm4TlvDq8ikWAM", "rachel", "f"], ["29vD33N1CtxCmqQRPOHJ", "drew", "m"], ["2EiwWnXFnvU5JabPnv8n", "clyde", "m"],
  ["5Q0t7uMcjvnagumLfvZi", "paul", "m"], ["AZnzlk1XvdvUeBnXmlld", "domi", "f"], ["CYw3kZ02Hs0563khs1Fj", "dave", "m"],
  ["D38z5RcWu1voky8WS1ja", "fin", "m"], ["EXAVITQu4vr4xnSDxMaL", "sarah", "f"], ["ErXwobaYiN019PkySvjV", "antoni", "m"],
  ["GBv7mTt0atIp3Br8iCZE", "thomas", "m"], ["IKne3meq5aSn9XLyUdCD", "charlie", "m"], ["JBFqnCBsd6RMkjVDRZzb", "george", "m"],
  ["LcfcDJNUP1GQjkzn1xUU", "emily", "f"], ["MF3mGyEYCl7XYWbV9V6O", "elli", "f"], ["N2lVS1w4EtoT3dr4eOWO", "callum", "m"],
  ["ODq5zmih8GrVes37Dizd", "patrick", "m"], ["SOYHLrjzK2X1ezoPC6cr", "harry", "m"], ["TX3LPaxmHKxFdv7VOQHJ", "liam", "m"],
  ["ThT5KcBeYPX3keUQqHPh", "dorothy", "f"], ["TxGEqnHWrfWFTfGW9XjX", "josh", "m"], ["VR6AewLTigWG4xSOukaG", "arnold", "m"],
  ["XB0fDUnXU5powFXDhCwa", "charlotte", "f"], ["Xb7hH8MSUJpSbSDYk0k2", "alice", "f"], ["XrExE9yKIg1WjnnlVkGX", "matilda", "f"],
  ["ZQe5CZNOzWyzPSCn5a3c", "james", "m"], ["Zlb1dXrM653N07WRdFW3", "joseph", "m"], ["cgSgspJ2msm6clMCkdW9", "jessica", "f"],
  ["flq6f7yk4E4fJM5XTYuZ", "michael", "m"], ["g5CIjZEefAph4nQFvHAz", "ethan", "m"], ["iP95p4xoKVk53GoZ742B", "chris", "m"],
  ["jBpfuIE2acCO8z3wKNLl", "gigi", "f"], ["jsCqWAovK2LkecY7zXl4", "freya", "f"], ["nPczCjzI2devNBz1zQrb", "brian", "m"],
  ["oWAxZDx7w5VEj9dCyTzz", "grace", "f"], ["onwK4e9ZLuTAKqWW03F9", "daniel", "m"], ["pFZP5JQG7iQjIQuC4Bku", "lily", "f"],
  ["pMsXgVXv3BLzUgSXRplE", "serena", "f"], ["pNInz6obpgDQGcFmaJgB", "adam", "m"], ["piTKgcLEGmPE4e6mEKli", "nicole", "f"],
  ["pqHfZKP75CvOlQylNhV4", "bill", "m"], ["t0jbNlBVZ17f02VDIeMI", "jessie", "m"], ["yoZ06aMxZJJ28mfd3POQ", "sam", "m"],
  ["z9fAnlkpzviPz146aGWa", "glinda", "f"], ["zcAOhNBS3c14rBihAFp1", "giovanni", "m"], ["zrHiDhphv9ZnVXBqCLjz", "mimi", "f"],
  ["9BWtsMINqrJLrRacOk9x", "aria", "f"], ["FGY2WhTYpPnrIDTdsKH5", "laura", "f"], ["SAz9YHcvj6GT2YYXdXww", "river", "f"],
  ["bIHbv24MWmeRgasZH58o", "will", "m"], ["cjVigY5qzO86Huf0OWal", "eric", "m"],
];
const AURA = new Set<string>([...SPEECH_VOICES.en, ...SPEECH_VOICES.es]);

/** The Aura-2 (or OpenAI) voice name an ElevenLabs voice ID or name stands for; undefined means the tool's default voice. */
export function elevenVoice(idOrName: string | undefined): string | undefined {
  const raw = (idOrName ?? "").trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (AURA.has(lower) || Object.hasOwn(OPENAI_VOICES, lower)) return lower;
  const i = ELEVEN_PREMADE.findIndex(([id, name]) => id === raw || name === lower);
  if (i < 0) return undefined;
  const gender = ELEVEN_PREMADE[i][2];
  const pool = gender === "f" ? FEMALE : MALE;
  const nth = ELEVEN_PREMADE.slice(0, i).filter((v) => v[2] === gender).length;
  return pool[nth % pool.length];
}

/** The speech request an ElevenLabs text-to-speech body stands for, or why it cannot be served. */
export function elevenSpeechRequest(body: unknown, voiceId: string | undefined, outputFormat: string | null | undefined): SpeechRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object with text" };
  const b = body as { text?: unknown; language_code?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { error: "text is required: the text to speak" };
  if (text.length > SPEECH_INPUT_LIMIT) return { error: `text must be at most ${SPEECH_INPUT_LIMIT} characters` };
  const format = (outputFormat ?? "").trim().toLowerCase();
  if (format && !format.startsWith("mp3")) return { error: "output_format must be an mp3 format such as mp3_44100_128 (the only format this endpoint returns)" };
  const lang = typeof b.language_code === "string" ? b.language_code.trim().toLowerCase().slice(0, 2) : "";
  if (lang && lang !== "en" && lang !== "es") return { error: "language_code must be en or es" };
  const voice = elevenVoice(voiceId);
  return { text, ...(voice ? { voice } : {}), ...(lang ? { lang } : {}), tool: text.length > SPEECH_SHORT_LIMIT ? SPEECH_LONG_TOOL_PATH : SPEECH_TOOL_PATH };
}

/** Handles POST /v1/text-to-speech/{voice_id} (and /stream): the MP3 file as the response body. */
export async function elevenLabsSpeech(c: C, forward: Forward): Promise<Response> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const body = await requestBody(c, (q) => (q.text === undefined ? null : { text: q.text, language_code: q.language_code }));
  const mapped = elevenSpeechRequest(body, c.req.param("voice_id"), c.req.query("output_format"));
  if ("error" in mapped && paying) return c.json({ detail: { status: "invalid_request", message: mapped.error } }, 400);
  const request: SpeechRequest = "error" in mapped ? { text: PROBE_TEXT, tool: SPEECH_TOOL_PATH } : mapped;
  return speakThrough(c, forward, request, VOICE_FRONT_DESCRIPTIONS.tts);
}

export type TranscriptShape = "openai" | "eleven";
const OPENAI_FORMATS = new Set(["json", "text", "srt", "vtt", "verbose_json"]);

export interface TranscriptionOptions { format: string; language?: string; url?: string }

/** Reads the options of an OpenAI or ElevenLabs transcription request, or why it cannot be served. */
export function transcriptionOptions(fields: Record<string, string>, shape: TranscriptShape): TranscriptionOptions | { error: string } {
  const format = shape === "openai" ? (fields.response_format ?? "json").trim().toLowerCase() || "json" : "eleven";
  if (shape === "openai" && !OPENAI_FORMATS.has(format)) return { error: "response_format must be json, text, srt, vtt or verbose_json" };
  if (shape === "eleven" && /^(1|true|yes)$/i.test(fields.diarize ?? "")) return { error: "diarize is not supported (one speaker track only); send diarize=false" };
  const langRaw = (fields.language ?? fields.language_code ?? "").trim().toLowerCase();
  const language = langRaw ? langRaw.slice(0, 2) : "";
  if (langRaw && !/^[a-z]{2,3}([-_][a-z0-9]+)?$/.test(langRaw)) return { error: "language must be a language code such as en, sv or de" };
  const url = (fields.cloud_storage_url ?? fields.url ?? fields.file_url ?? "").trim();
  return { format, ...(language ? { language } : {}), ...(url ? { url } : {}) };
}

interface Transcript { text?: string; language?: string | null; languageProbability?: number | null; durationSeconds?: number | null; segments?: { start: number; end: number; text: string }[]; words?: { word: string; start: number; end: number }[]; subtitles?: string }

/** The answer the caller's API shape expects, from /transcribe's JSON. */
export function shapeTranscript(t: Transcript, shape: TranscriptShape, format: string): { json: unknown } | { text: string; type: string } {
  const text = t.text ?? "";
  if (shape === "eleven") {
    return { json: { language_code: t.language ?? null, language_probability: t.languageProbability ?? null, text, words: (t.words ?? []).map((w) => ({ text: w.word, start: w.start, end: w.end, type: "word" })) } };
  }
  if (format === "text") return { text, type: "text/plain; charset=utf-8" };
  if (format === "srt") return { text: t.subtitles ?? "", type: "application/x-subrip; charset=utf-8" };
  if (format === "vtt") return { text: t.subtitles ?? "", type: "text/vtt; charset=utf-8" };
  if (format === "verbose_json") {
    return { json: { task: "transcribe", language: t.language ?? null, duration: t.durationSeconds ?? null, text, segments: (t.segments ?? []).map((s, id) => ({ id, start: s.start, end: s.end, text: s.text })), words: t.words ?? [] } };
  }
  return { json: { text } };
}

async function jsonFields(c: C): Promise<Record<string, string>> {
  const type = (c.req.header("content-type") ?? "").toLowerCase();
  if (!type.includes("json")) return {};
  const body = await c.req.raw.clone().json().catch(() => null) as Record<string, unknown> | null;
  const out: Record<string, string> = {};
  if (body && typeof body === "object" && !Array.isArray(body)) for (const [k, v] of Object.entries(body)) if (typeof v === "string" && v.length <= 2000) out[k] = v;
  return out;
}

/** Handles POST /v1/audio/transcriptions (OpenAI) and POST /v1/speech-to-text (ElevenLabs) through /transcribe. */
export async function transcribeFront(c: C, forward: Forward, shape: TranscriptShape): Promise<Response> {
  const outer = new URL(c.req.url);
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const refuse = (message: string, status: 400 | 413 = 400) => (shape === "openai"
    ? c.json({ error: { message, type: "invalid_request_error" } }, status)
    : c.json({ detail: { status: "invalid_request", message } }, status));
  const sent = c.req.method === "POST" ? await sentFile(c.req.raw, TRANSCRIBE_MAX_BYTES) : { kind: "none" as const, fields: {} as Record<string, string> };
  if (sent.kind === "too-large") return refuse(`the audio file is larger than ${Math.round(TRANSCRIBE_MAX_BYTES / 1024 / 1024)} MB (nothing was charged)`, 413);
  const fields = { ...c.req.query(), ...(await jsonFields(c)), ...sent.fields };  const options = transcriptionOptions(fields, shape);
  if ("error" in options && paying) return refuse(options.error);
  const opts: TranscriptionOptions = "error" in options ? { format: shape === "openai" ? "json" : "eleven" } : options;
  if (sent.kind !== "file" && !opts.url && paying) return refuse(shape === "openai" ? "file is required: send the audio as a multipart `file` part" : "file or cloud_storage_url is required");
  const inner = new URL(TRANSCRIBE_TOOL_PATH, outer.origin);
  let ref: string | null = null;
  if (sent.kind === "file") {
    ref = await holdFile(sent.bytes);
    inner.searchParams.set(FILE_INPUT, ref);
  } else inner.searchParams.set("url", opts.url ?? PROBE_AUDIO);
  if (opts.language) inner.searchParams.set("language", opts.language);
  if (opts.format === "srt" || opts.format === "vtt") inner.searchParams.set("subtitles", opts.format);
  if (opts.format === "verbose_json" || opts.format === "eleven") inner.searchParams.set("timestamps", "true");
  const headers = withXiKey(new Headers(c.req.raw.headers));
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  try {
    const answer = await forward(new Request(inner.href, { method: "GET", headers }));
    const description = shape === "openai" ? VOICE_FRONT_DESCRIPTIONS.openaiStt : VOICE_FRONT_DESCRIPTIONS.stt;
    if (answer.status === 402) return asFrontQuote(answer, outer, description, TRANSCRIBE_TOOL_PATH);
    if (answer.status !== 200) return answer;
    const result = (await answer.json().catch(() => null)) as Transcript | null;
    if (!result || typeof result.text !== "string") return answer;
    const shaped = shapeTranscript(result, shape, opts.format);
    const out = "json" in shaped
      ? new Response(JSON.stringify(shaped.json), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } })
      : new Response(shaped.text, { status: 200, headers: { "content-type": shaped.type } });
    for (const name of PASSTHROUGH) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
    out.headers.set("cache-control", "no-store");
    out.headers.set("x-tool", TRANSCRIBE_TOOL_PATH);
    return out;
  } finally {
    if (ref) releaseFile(ref);
  }
}
