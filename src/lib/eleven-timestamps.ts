// POST /v1/text-to-speech/{voice_id}/with-timestamps (17 Nov 2026): ElevenLabs' speech-with-alignment shape, which
// read-along players, karaoke captions and lip-sync tools call to highlight text as it is spoken. Served by
// /text-to-speech/captions (one MP3 plus cue timings measured from the generated audio) at that tool's price.
// Cue start and end are measured; character times inside a cue are spread by position, so a highlight moves at the
// cue's real pace and lands on each cue's real start.
import type { Context } from "hono";
import type { Env } from "./env";
import { asFrontQuote, requestBody } from "./openai-chat";
import { KEY_RESPONSE_HEADERS, SPEECH_INPUT_LIMIT, withXiKey } from "./openai-speech";
import { asFrontKeyError } from "./voice-billing";
import { elevenVoice } from "./voice-fronts";

type C = Context<{ Bindings: Env }>;
type Forward = (request: Request) => Response | Promise<Response>;

export const ELEVEN_TTS_TIMESTAMPS_PATH = "/v1/text-to-speech/:voice_id/with-timestamps";
const CAPTIONS_TOOL = "/text-to-speech/captions";
const PAYMENT_HEADERS = ["payment-signature", "x-payment", "authorization", "x-api-key", "xi-api-key"];
const PASSTHROUGH = ["payment-response", "x-payment-response", "payment-receipt", "extension-responses", "x-request-id", ...KEY_RESPONSE_HEADERS];
const DESCRIPTION = "ElevenLabs-compatible text to speech with timestamps, pay per request: text in, base64 MP3 plus character alignment out (Deepgram Aura-2 voices; cue timings measured from the audio). Up to 2,000 characters, English or Spanish. No account; failed calls are not charged.";
const META = { serviceName: "Text to speech with timestamps, ElevenLabs-compatible API", tags: ["text-to-speech", "elevenlabs-compatible", "timestamps", "alignment", "captions"] };
const PROBE_TEXT = "Your payment was received. Thank you!";

export interface Alignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }

/** Character alignment from measured cues: each cue's characters share its time span in order; cues are joined by one space. */
export function alignmentFromCues(cues: readonly { start: number; end: number; text: string }[]): Alignment {
  const out: Alignment = { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  const r = (n: number) => Math.round(n * 1000) / 1000;
  cues.forEach((cue, i) => {
    if (i > 0) { const at = r(cues[i - 1].end); out.characters.push(" "); out.character_start_times_seconds.push(at); out.character_end_times_seconds.push(r(cue.start)); }
    const chars = [...cue.text];
    const step = chars.length ? Math.max(0, cue.end - cue.start) / chars.length : 0;
    chars.forEach((ch, k) => {
      out.characters.push(ch);
      out.character_start_times_seconds.push(r(cue.start + step * k));
      out.character_end_times_seconds.push(r(k === chars.length - 1 ? cue.end : cue.start + step * (k + 1)));
    });
  });
  return out;
}

/** The captions-tool query an ElevenLabs with-timestamps body stands for, or why it cannot be served. */
export function timestampsRequest(body: unknown, voiceId: string | undefined, outputFormat: string | null | undefined): URLSearchParams | { error: string } {
  if (!body || typeof body !== "object") return { error: "the body must be a JSON object with text" };
  const b = body as { text?: unknown; language_code?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { error: "text is required: the text to speak" };
  if (text.length > SPEECH_INPUT_LIMIT) return { error: `text must be at most ${SPEECH_INPUT_LIMIT} characters` };
  const format = (outputFormat ?? "").trim().toLowerCase();
  if (format && !format.startsWith("mp3")) return { error: "output_format must be an mp3 format such as mp3_44100_128 (the only format this endpoint returns)" };
  const lang = typeof b.language_code === "string" ? b.language_code.trim().toLowerCase().slice(0, 2) : "";
  if (lang && lang !== "en" && lang !== "es") return { error: "language_code must be en or es" };
  const q = new URLSearchParams({ text });
  const voice = elevenVoice(voiceId);
  if (voice) q.set("voice", voice);
  if (lang) q.set("lang", lang);
  return q;
}

/** Handles POST /v1/text-to-speech/{voice_id}/with-timestamps. */
export async function elevenSpeechWithTimestamps(c: C, forward: Forward): Promise<Response> {
  const outer = new URL(c.req.url);
  const paying = PAYMENT_HEADERS.some((h) => c.req.header(h));
  const body = await requestBody(c, (q) => (q.text === undefined ? null : { text: q.text, language_code: q.language_code }));
  const mapped = timestampsRequest(body, c.req.param("voice_id"), c.req.query("output_format"));
  if ("error" in mapped && paying) return c.json({ detail: { status: "invalid_request", message: mapped.error } }, 400);
  const query = "error" in mapped ? new URLSearchParams({ text: PROBE_TEXT }) : mapped;
  const headers = withXiKey(new Headers(c.req.raw.headers));
  headers.delete("content-type");
  headers.delete("content-length");
  headers.set("accept", "application/json");
  const answer = await forward(new Request(`${outer.origin}${CAPTIONS_TOOL}?${query}`, { method: "GET", headers }));
  const keyError = await asFrontKeyError(answer, "eleven");
  if (keyError) return keyError;
  if (answer.status === 402) return asFrontQuote(answer, outer, DESCRIPTION, CAPTIONS_TOOL, META);
  if (answer.status !== 200) return answer;
  const result = (await answer.json().catch(() => null)) as { audioBase64?: string; cues?: { start: number; end: number; text: string }[]; voice?: string } | null;
  if (!result?.audioBase64 || !Array.isArray(result.cues)) return answer;
  const alignment = alignmentFromCues(result.cues);
  const out = new Response(JSON.stringify({ audio_base64: result.audioBase64, alignment, normalized_alignment: alignment }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-tool": CAPTIONS_TOOL, ...(result.voice ? { "x-voice": result.voice } : {}) } });
  for (const name of PASSTHROUGH) { const v = answer.headers.get(name); if (v) out.headers.set(name, v); }
  return out;
}
