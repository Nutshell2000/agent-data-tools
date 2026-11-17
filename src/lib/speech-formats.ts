// Audio formats for the speech tools and fronts (17 Nov 2026). Aura-2 on Workers AI returns more than MP3: probed that
// day with one call each, linear16 (raw 16-bit PCM, or WAV), mulaw and alaw (8 kHz telephony), Opus in Ogg and FLAC all
// came back as real audio; AAC came back in a non-standard wrapper and is not offered. Phone systems (Twilio, Vonage,
// Asterisk) want 8 kHz mu-law or A-law, games and voice pipelines want raw PCM: ElevenLabs and OpenAI both sell these.
// Raw formats are joined by concatenation, WAV gets one header over the joined PCM, MP3 frames are joined as before.
// Opus and FLAC files cannot be glued part to part, so they are offered only for text that is spoken in one part.

export type FormatName = "mp3" | "wav" | "pcm" | "ulaw" | "alaw" | "opus" | "flac";
export interface SpeechFormat { name: FormatName; sampleRate?: number }

export const FORMAT_NAMES: readonly FormatName[] = ["mp3", "wav", "pcm", "ulaw", "alaw", "opus", "flac"];
/** Sample rates Aura-2 takes for 16-bit PCM (and so WAV), and for the telephony codecs. */
const PCM_RATES = [8000, 16000, 24000, 32000, 48000] as const;
const PHONE_RATES = [8000, 16000] as const;
export const DEFAULT_RATE: Partial<Record<FormatName, number>> = { wav: 24000, pcm: 24000, ulaw: 8000, alaw: 8000 };

export const FORMAT_HELP = "Audio format: mp3 (default), wav, pcm (raw 16-bit little-endian mono), ulaw or alaw (8 kHz telephony, e.g. Twilio), opus (Ogg) or flac. opus and flac only for text spoken in one part (up to 450 characters)";
export const RATE_HELP = "Sample rate in Hz for wav and pcm (8000, 16000, 24000 default, 32000, 48000) or ulaw/alaw (8000 default, 16000)";

/** The format a request asks for, or why it cannot be served. */
export function parseFormat(format: string | undefined | null, rate: string | number | undefined | null): SpeechFormat | { error: string } {
  const name = (format ?? "").toString().trim().toLowerCase() || "mp3";
  if (!(FORMAT_NAMES as readonly string[]).includes(name)) return { error: `format must be one of ${FORMAT_NAMES.join(", ")}` };
  const f = name as FormatName;
  const rawRate = rate === undefined || rate === null || rate === "" ? undefined : Number(rate);
  if (rawRate === undefined) return DEFAULT_RATE[f] ? { name: f, sampleRate: DEFAULT_RATE[f] } : { name: f };
  const allowed: readonly number[] | null = f === "wav" || f === "pcm" ? PCM_RATES : f === "ulaw" || f === "alaw" ? PHONE_RATES : null;
  if (!allowed) return { error: `sample_rate applies to wav, pcm, ulaw and alaw only` };
  if (!allowed.includes(rawRate)) return { error: `sample_rate for ${f} must be one of ${allowed.join(", ")}` };
  return { name: f, sampleRate: rawRate };
}

/** Whether audio in this format can be joined from several spoken parts. */
export const joinable = (f: SpeechFormat) => f.name !== "opus" && f.name !== "flac";

/** The Aura-2 parameters for a format. WAV is asked for as raw PCM and wrapped here, so parts join cleanly. */
export function auraParams(f: SpeechFormat): Record<string, string | number> {
  switch (f.name) {
    case "mp3": return { encoding: "mp3" };
    case "wav": case "pcm": return { encoding: "linear16", container: "none", sample_rate: f.sampleRate ?? 24000 };
    case "ulaw": return { encoding: "mulaw", container: "none", sample_rate: f.sampleRate ?? 8000 };
    case "alaw": return { encoding: "alaw", container: "none", sample_rate: f.sampleRate ?? 8000 };
    case "opus": return { encoding: "opus", container: "ogg" };
    case "flac": return { encoding: "flac" };
  }
}

/** The media type of a format's bytes. */
export function formatType(f: SpeechFormat): string {
  switch (f.name) {
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "pcm": return `audio/L16; rate=${f.sampleRate ?? 24000}; channels=1`;
    case "ulaw": return `audio/basic; rate=${f.sampleRate ?? 8000}`;
    case "alaw": return `audio/x-alaw-basic; rate=${f.sampleRate ?? 8000}`;
    case "opus": return "audio/ogg; codecs=opus";
    case "flac": return "audio/flac";
  }
}

/** A 44-byte RIFF/WAVE header for 16-bit mono PCM of `dataLength` bytes. */
export function wavHeader(dataLength: number, sampleRate: number): Uint8Array {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const s = (at: number, text: string) => { for (let i = 0; i < text.length; i++) h[at + i] = text.charCodeAt(i); };
  s(0, "RIFF"); v.setUint32(4, 36 + dataLength, true); s(8, "WAVE");
  s(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  s(36, "data"); v.setUint32(40, dataLength, true);
  return h;
}

/** Raw parts (PCM, mu-law, A-law) joined in order; WAV adds its header over the joined PCM. */
export function joinRaw(parts: readonly Uint8Array[], f: SpeechFormat): Uint8Array {
  const data = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of parts) { data.set(b, at); at += b.length; }
  if (f.name !== "wav") return data;
  const out = new Uint8Array(44 + data.length);
  out.set(wavHeader(data.length, f.sampleRate ?? 24000), 0);
  out.set(data, 44);
  return out;
}

/** Seconds of audio in raw or WAV bytes (16-bit PCM is 2 bytes a sample; mu-law and A-law 1), or null for other formats. */
export function rawSeconds(bytes: number, f: SpeechFormat): number | null {
  const rate = f.sampleRate ?? DEFAULT_RATE[f.name];
  if (!rate) return null;
  if (f.name === "pcm") return bytes / (rate * 2);
  if (f.name === "wav") return Math.max(0, bytes - 44) / (rate * 2);
  if (f.name === "ulaw" || f.name === "alaw") return bytes / rate;
  return null;
}

/**
 * ElevenLabs' output_format (mp3_44100_128, pcm_16000, ulaw_8000, alaw_8000, opus_48000_64, wav_24000…) as a format,
 * or why it cannot be served. Their 22,050 and 44,100 Hz PCM rates are not ones Aura-2 produces.
 */
export function fromElevenFormat(raw: string | null | undefined): SpeechFormat | { error: string } {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v.startsWith("mp3")) return { name: "mp3" };
  const m = /^(pcm|ulaw|alaw|opus|wav)_(\d+)(?:_\d+)?$/.exec(v);
  if (!m) return { error: "output_format must be mp3_*, pcm_8000/16000/24000/48000, ulaw_8000, alaw_8000, wav_* or opus_48000_*" };
  if (m[1] === "opus") return { name: "opus" };
  const parsed = parseFormat(m[1], m[2]);
  return "error" in parsed ? { error: `output_format ${v}: ${parsed.error}` } : parsed;
}

/** OpenAI's response_format (mp3, opus, aac, flac, wav, pcm) as a format; pcm is 24 kHz as OpenAI sends it. */
export function fromOpenAiFormat(raw: unknown): SpeechFormat | { error: string } {
  const v = raw === undefined || raw === null ? "mp3" : String(raw).trim().toLowerCase() || "mp3";
  if (v === "aac") return { error: "response_format aac is not available here; use mp3, opus, flac, wav or pcm" };
  if (v === "mp3" || v === "opus" || v === "flac" || v === "wav" || v === "pcm") return parseFormat(v, undefined);
  return { error: "response_format must be mp3, opus, flac, wav or pcm" };
}

/** Most entries one request's pronunciation list may hold, and the longest word or replacement. */
export const PRONUNCIATIONS_MAX = 50;
const PRONUNCIATION_LEN = 60;
export const PRONUNCIATIONS_HELP = 'How to say words: JSON {"Nginx":"engine x","GIF":"jif"} or Nginx=engine x, GIF=jif (up to 50, whole words, any case)';

/** A pronunciation list from JSON or "word=say, word=say", or why it cannot be read. */
export function parsePronunciations(raw: unknown): [from: string, to: string][] | { error: string } {
  if (raw === undefined || raw === null || raw === "") return [];
  let pairs: [string, string][] = [];
  if (typeof raw === "object" && !Array.isArray(raw)) pairs = Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]);
  else if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("{")) {
      try { const o = JSON.parse(s); if (!o || typeof o !== "object" || Array.isArray(o)) return { error: "pronunciations must be a JSON object of word: how to say it" }; pairs = Object.entries(o).map(([k, v]) => [k, String(v ?? "")]); }
      catch { return { error: "pronunciations is not valid JSON" }; }
    } else pairs = s.split(/[,;\n]/).map((p) => p.split("=")).filter((p) => p.length === 2).map(([a, b]) => [a, b]);
  } else return { error: "pronunciations must be an object or text" };
  const clean = pairs.map(([a, b]) => [a.trim(), b.trim()] as [string, string]).filter(([a, b]) => a && b);
  if (clean.length > PRONUNCIATIONS_MAX) return { error: `pronunciations holds ${clean.length} entries; up to ${PRONUNCIATIONS_MAX}` };
  if (clean.some(([a, b]) => a.length > PRONUNCIATION_LEN || b.length > PRONUNCIATION_LEN)) return { error: `each pronunciation word and replacement is at most ${PRONUNCIATION_LEN} characters` };
  return clean.sort((x, y) => y[0].length - x[0].length);
}

/** The text with each listed word (whole word, any case) replaced by how it should be said. */
export function applyPronunciations(text: string, pairs: readonly [string, string][]): string {
  let out = text;
  for (const [from, to] of pairs) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), to);
  }
  return out;
}