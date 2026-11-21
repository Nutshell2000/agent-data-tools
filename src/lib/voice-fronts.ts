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
import { VOICE_FRONT_DESCRIPTIONS, VOICE_FRONT_META } from "./voice-fronts-openapi";
import { pronunciationsParam } from "./openai-speech";
import { KEY_RESPONSE_HEADERS, SPEECH_INPUT_LIMIT, SPEECH_SHORT_LIMIT, SPEECH_LONG_TOOL_PATH, SPEECH_TOOL_PATH, speakThrough, withXiKey, type SpeechRequest } from "./openai-speech";
import { apiKeyFrom } from "./credits";
import { admitVoiceKey, hasVoiceGrant, voiceKeyKind, voiceTestKeysOn } from "./voice-keys";
import { SHORT_AUDIO_KEY_PRICE, SHORT_AUDIO_SECONDS, asFrontKeyError, foreignKey, foreignKeySentence, frontError, rebateShortAudio, setFrontKeyPrice, withSentenceFirst } from "./voice-billing";
import { FILE_INPUT, heldFile, holdFile, releaseFile, sentFile } from "./file-input";
import { TRANSCRIBE_MAX_BYTES } from "../routes/ai";
import { LONG_TRANSCRIBE_MAX_BYTES, LONG_TRANSCRIBE_PATH, mp3Frames, wavInfo } from "../routes/voice";
import { voicePrices } from "./voice-pro";
import { SPEECH_VOICES, OPENAI_VOICES } from "../routes/ai-text";
import { SPEAKERS_PATH } from "../routes/voice-plus";
import { fromElevenFormat } from "./speech-formats";
import { forwardedHeaders } from "./paying-request";

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

export { VOICE_FRONT_DESCRIPTIONS, VOICE_FRONT_META };

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
  const b = body as { text?: unknown; language_code?: unknown; pronunciations?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { error: "text is required: the text to speak" };
  if (text.length > SPEECH_INPUT_LIMIT) return { error: `text must be at most ${SPEECH_INPUT_LIMIT} characters` };
  const say = pronunciationsParam(b.pronunciations);
  if ("error" in say) return { error: say.error };
  const format = fromElevenFormat(outputFormat);
  if ("error" in format) return { error: format.error };
  const lang = typeof b.language_code === "string" ? b.language_code.trim().toLowerCase().slice(0, 2) : "";
  if (lang && lang !== "en" && lang !== "es") return { error: "language_code must be en or es" };
  const voice = elevenVoice(voiceId);
  return { text, ...(voice ? { voice } : {}), ...(lang ? { lang } : {}), ...(format.name !== "mp3" ? { format } : {}), ...(say.value ? { pronunciations: say.value } : {}), tool: text.length > SPEECH_SHORT_LIMIT ? SPEECH_LONG_TOOL_PATH : SPEECH_TOOL_PATH };
}

/** Handles POST /v1/text-to-speech/{voice_id} (and /stream): the MP3 file as the response body. */
export async function elevenLabsSpeech(c: C, forward: Forward): Promise<Response> {
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const body = await requestBody(c, (q) => (q.text === undefined ? null : { text: q.text, language_code: q.language_code, pronunciations: q.pronunciations }));
  const mapped = elevenSpeechRequest(body, c.req.param("voice_id"), c.req.query("output_format"));
  if ("error" in mapped && paying) return c.json({ detail: { status: "invalid_request", message: mapped.error } }, 400);
  const request: SpeechRequest = "error" in mapped ? { text: PROBE_TEXT, tool: SPEECH_TOOL_PATH } : mapped;
  return speakThrough(c, forward, request, VOICE_FRONT_DESCRIPTIONS.tts, VOICE_FRONT_META.tts, "eleven");
}

export type TranscriptShape = "openai" | "eleven";
const OPENAI_FORMATS = new Set(["json", "text", "srt", "vtt", "verbose_json"]);

export interface TranscriptionOptions { format: string; language?: string; url?: string; diarize?: true }

/** Reads the options of an OpenAI or ElevenLabs transcription request, or why it cannot be served. */
export function transcriptionOptions(fields: Record<string, string>, shape: TranscriptShape): TranscriptionOptions | { error: string } {
  const format = shape === "openai" ? (fields.response_format ?? "json").trim().toLowerCase() || "json" : "eleven";
  if (shape === "openai" && !OPENAI_FORMATS.has(format)) return { error: "response_format must be json, text, srt, vtt or verbose_json" };
  // 17 Nov 2026: diarize=true runs the speaker-label tool (Nova-3, /transcribe/speakers) and tags each word with its speaker.
  const diarize = shape === "eleven" && /^(1|true|yes)$/i.test(fields.diarize ?? "");
  const langRaw = (fields.language ?? fields.language_code ?? "").trim().toLowerCase();
  const language = langRaw ? langRaw.slice(0, 2) : "";
  if (langRaw && !/^[a-z]{2,3}([-_][a-z0-9]+)?$/.test(langRaw)) return { error: "language must be a language code such as en, sv or de" };
  const url = (fields.cloud_storage_url ?? fields.url ?? fields.file_url ?? "").trim();
  return { format, ...(language ? { language } : {}), ...(url ? { url } : {}), ...(diarize ? { diarize: true as const } : {}) };
}

interface Transcript { turns?: { speaker: number; start: number; end: number; text: string }[]; text?: string; language?: string | null; languageProbability?: number | null; durationSeconds?: number | null; segments?: { start: number; end: number; text: string }[]; words?: { word: string; start: number; end: number }[]; subtitles?: string }

/** The answer the caller's API shape expects, from /transcribe's JSON. */
export function shapeTranscript(t: Transcript, shape: TranscriptShape, format: string): { json: unknown } | { text: string; type: string } {
  const text = t.text ?? "";
  if (shape === "eleven" && t.turns) return { json: { language_code: t.language ?? null, language_probability: null, text, words: diarizedWords(t.turns) } };
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

/**
 * ElevenLabs' diarized word list from speaker turns: every word carries `speaker_id` ("speaker_0", "speaker_1"…, as
 * ElevenLabs numbers them). Nova-3 gives times per turn, so word times inside a turn are spread by word length; the
 * turn's own start and end are exact. Spaces between words are listed as `spacing`, as ElevenLabs does.
 */
export function diarizedWords(turns: readonly { speaker: number; start: number; end: number; text: string }[]) {
  const out: { text: string; start: number; end: number; type: "word" | "spacing"; speaker_id: string }[] = [];
  const r = (n: number) => Math.round(n * 1000) / 1000;
  for (const turn of turns) {
    const words = turn.text.split(/\s+/).filter(Boolean);
    const total = words.reduce((n, w) => n + w.length, 0) || 1;
    const span = Math.max(0, turn.end - turn.start);
    const speaker_id = `speaker_${Math.max(0, turn.speaker - 1)}`;
    let at = turn.start;
    words.forEach((w, i) => {
      const end = i === words.length - 1 ? turn.end : at + (span * w.length) / total;
      if (out.length) out.push({ text: " ", start: r(at), end: r(at), type: "spacing", speaker_id });
      out.push({ text: w, start: r(at), end: r(end), type: "word", speaker_id });
      at = end;
    });
  }
  return out;
}

async function jsonFields(c: C): Promise<Record<string, string>> {
  const type = (c.req.header("content-type") ?? "").toLowerCase();
  if (!type.includes("json")) return {};
  const body = await c.req.raw.clone().json().catch(() => null) as Record<string, unknown> | null;
  const out: Record<string, string> = {};
  if (body && typeof body === "object" && !Array.isArray(body)) for (const [k, v] of Object.entries(body)) if (typeof v === "string" && v.length <= 2000) out[k] = v;
  return out;
}

/** The length of an MP3 or WAV file read from its bytes, or null for any other format (and for a file with no frames). */
export function measuredSeconds(bytes: Uint8Array): number | null {
  const wav = wavInfo(bytes);
  if (wav) return wav.dataLength / wav.byteRate;
  const frames = mp3Frames(bytes);
  if (frames.length < 2) return null;
  let seconds = 0;
  for (const f of frames) seconds += f.seconds;
  return seconds;
}

/**
 * A free trial key sent straight to a transcription tool with an uploaded file, as the voice site's Pro mode sends it
 * (POST /transcribe/long or /transcribe): the file is measured here and admitted like a front's request. Returns the
 * refusal to answer with, or null to go on to the paywall (which refuses whatever was not admitted). Called from
 * src/index.ts for a voice key, before `chargeVoiceKey`.
 */
export async function admitTrialUpload(c: C, key: string): Promise<Response | null> {
  if (voiceKeyKind(key) !== "trial" || hasVoiceGrant(c.req.raw)) return null;
  if (c.req.path !== TRANSCRIBE_TOOL_PATH && c.req.path !== LONG_TRANSCRIBE_PATH) return null;
  const bytes = heldFile(c.req.query(FILE_INPUT));
  if (!bytes) return null;
  const refusal = await admitVoiceKey(c.env, key, { what: "audio", upload: true, seconds: measuredSeconds(bytes), bytes: bytes.byteLength }, c.req.raw, new URL(c.req.url).origin);
  return refusal ? c.json({ error: refusal.message, code: refusal.code, more: refusal.more }, refusal.status) : null;
}

/** Handles POST /v1/audio/transcriptions (OpenAI) and POST /v1/speech-to-text (ElevenLabs) through /transcribe. */
export async function transcribeFront(c: C, forward: Forward, shape: TranscriptShape): Promise<Response> {
  const outer = new URL(c.req.url);
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const refuse = (message: string, status: 400 | 413 = 400) => (shape === "openai"
    ? c.json({ error: { message, type: "invalid_request_error" } }, status)
    : c.json({ detail: { status: "invalid_request", message } }, status));
  // Up to OpenAI's own 25 MB: a file over 5 MB goes to /transcribe/long (MP3 or WAV, up to 60 minutes) at its price.
  const sent = c.req.method === "POST" ? await sentFile(c.req.raw, LONG_TRANSCRIBE_MAX_BYTES) : { kind: "none" as const, fields: {} as Record<string, string> };
  if (sent.kind === "too-large") return refuse(`the audio file is larger than ${Math.round(LONG_TRANSCRIBE_MAX_BYTES / 1024 / 1024)} MB (nothing was charged)`, 413);
  let tool: string = sent.kind === "file" && sent.bytes.byteLength > TRANSCRIBE_MAX_BYTES ? LONG_TRANSCRIBE_PATH : TRANSCRIBE_TOOL_PATH;
  const key = apiKeyFrom((name) => withXiKey(new Headers(c.req.raw.headers)).get(name) ?? undefined);
  // The file's length, read from its bytes (MP3 and WAV only) for a caller with a key: it decides the short-audio
  // price, and the limits of a free test or trial key (lib/voice-billing.ts, lib/voice-keys.ts).
  const seconds = key && sent.kind === "file" ? measuredSeconds(sent.bytes) : null;
  // A trial key reads one recording the way Transcribe Pro does: a measured MP3 or WAV goes to /transcribe/long.
  if (key && voiceKeyKind(key) === "trial" && seconds !== null) tool = LONG_TRANSCRIBE_PATH;
  const fields = { ...c.req.query(), ...(await jsonFields(c)), ...sent.fields };  const options = transcriptionOptions(fields, shape);
  if ("error" in options && paying) return refuse(options.error);
  const opts: TranscriptionOptions = "error" in options ? { format: shape === "openai" ? "json" : "eleven" } : options;
  if (opts.diarize) tool = SPEAKERS_PATH;
  if (sent.kind !== "file" && !opts.url && paying) return refuse(shape === "openai" ? "file is required: send the audio as a multipart `file` part" : "file or cloud_storage_url is required");
  const inner = new URL(tool, outer.origin);
  let ref: string | null = null;
  if (sent.kind === "file") {
    ref = await holdFile(sent.bytes);
    inner.searchParams.set(FILE_INPUT, ref);
  } else inner.searchParams.set("url", opts.url ?? PROBE_AUDIO);
  if (opts.language) inner.searchParams.set("language", opts.language);
  if (opts.format === "srt" || opts.format === "vtt") inner.searchParams.set("subtitles", opts.format);
  if ((opts.format === "verbose_json" || opts.format === "eleven") && tool !== SPEAKERS_PATH) inner.searchParams.set("timestamps", "true");
  const headers = withXiKey(forwardedHeaders(c.req.raw));
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  try {
    const toolRequest = new Request(inner.href, { method: "GET", headers });
    if (key && voiceKeyKind(key)) {
      const refusal = await admitVoiceKey(c.env, key, { what: "audio", upload: sent.kind === "file", seconds, bytes: sent.kind === "file" ? sent.bytes.byteLength : 0 }, toolRequest, outer.origin);
      if (refusal) return frontError(shape, refusal.status, refusal.message, refusal.code, { more: refusal.more });
    } else if (key && shape === "openai" && seconds !== null && seconds <= SHORT_AUDIO_SECONDS) {
      // /v1/audio/transcriptions with a prepaid key: audio of 30 seconds or less costs 1 credit, decided before the charge.
      setFrontKeyPrice(toolRequest, SHORT_AUDIO_KEY_PRICE);
    }
    const answer = await forward(toolRequest);
    const description = shape === "openai" ? VOICE_FRONT_DESCRIPTIONS.openaiStt : VOICE_FRONT_DESCRIPTIONS.stt;
    const keyError = await asFrontKeyError(answer, shape);
    if (keyError) return keyError;
    if (answer.status === 402) {
      const quote = await asFrontQuote(answer, outer, description, tool, shape === "openai" ? VOICE_FRONT_META.openaiStt : VOICE_FRONT_META.stt);
      return foreignKey((name) => c.req.header(name), Boolean(key)) ? withSentenceFirst(quote, foreignKeySentence(outer.origin, voiceTestKeysOn(c.env))) : quote;
    }
    if (answer.status !== 200) return answer;
    const result = (await answer.json().catch(() => null)) as Transcript | null;
    if (!result || typeof result.text !== "string") return answer;
    const shaped = shapeTranscript(result, shape, opts.format);
    const out = "json" in shaped
      ? new Response(JSON.stringify(shaped.json), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } })
      : new Response(shaped.text, { status: 200, headers: { "content-type": shaped.type } });
    for (const name of [...PASSTHROUGH, ...KEY_RESPONSE_HEADERS]) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
    // A format that could not be measured first was charged the tool's price: when the model itself reports 30 seconds
    // or less, the difference to the short price is given back. No reported length, no change.
    if (key && shape === "openai" && !voiceKeyKind(key) && seconds === null) {
      const rebate = await rebateShortAudio(c.env, key, tool === LONG_TRANSCRIBE_PATH ? voicePrices().long : voicePrices().short, answer.headers.get("x-credits-charged"), result.durationSeconds);
      if (rebate) { out.headers.set("x-credits-charged", rebate.charged); out.headers.set("x-credits-remaining", rebate.remaining); }
    }
    out.headers.set("cache-control", "no-store");
    out.headers.set("x-tool", tool);
    return out;
  } finally {
    if (ref) releaseFile(ref);
  }
}
