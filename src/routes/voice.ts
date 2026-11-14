// Glyphcall Voice tools, round 2 (14 Nov 2026, voice plan: business/voice-plan-2026-11-14/plan.md). Two tools that give
// an honest price edge over ElevenLabs, read from their own pricing page that day (Scribe $0.20 an hour; Flash text to
// speech $0.04 per 1,000 characters):
//   /transcribe/long      up to 60 minutes of MP3 or WAV (25 MB) for $0.05: the file is cut into parts at frame (MP3) or
//                         sample (WAV) boundaries, each part goes to Whisper large-v3-turbo, and the timings are joined.
//                         Our cost is about $0.0005 per audio minute, so a full hour costs about $0.031.
//   /text-to-speech/lite  up to 2,000 characters in English with Deepgram Aura-1 for $0.04 ($0.02 per 1,000 characters
//                         at full length, half Flash's price). Aura-1 costs $0.015 per 1,000 characters, so $0.03 a full call.
// Both are added with CATALOG.push in src/families.ts and listed in CAPACITY_LIMITED (paid only).
import { Buffer } from "node:buffer";
import { entry, pick, type Entry, type Input } from "../family";
import { HttpError, type Env } from "../lib/env";
import { MODELS, runAi } from "../lib/ai";
import { fetchFile } from "../lib/fetch";
import { FILE_REF_INPUT, heldFile, isFileRef } from "../lib/file-input";
import { toSubtitles, type TimedSegment } from "./ai";
import { OPENAI_VOICES, audioToBase64, base64Bytes, id3Length, joinMp3, speechParts } from "./ai-text";

const MB = 1024 * 1024;
export const LONG_TRANSCRIBE_PATH = "/transcribe/long";
export const LITE_SPEECH_PATH = "/text-to-speech/lite";
export const LONG_TRANSCRIBE_MAX_BYTES = 25 * MB;
export const LONG_TRANSCRIBE_MAX_SECONDS = 60 * 60;
export const LONG_TRANSCRIBE_PRICE = "$0.05";
/** One Whisper call reads at most this much audio: the size /transcribe already sends in one call, and ten minutes. */
export const PART_MAX_BYTES = 4 * MB;
export const PART_MAX_SECONDS = 600;
const PARALLEL_PARTS = 3;

export const LITE_SPEECH_MAX = 2000;
export const LITE_SPEECH_PRICE = "$0.04";
export const LITE_SPEECH_MODEL = "@cf/deepgram/aura-1";
/** Aura-1 speakers as the model schema lists them (read 14 Nov 2026 via /ai/models/schema). */
export const LITE_VOICES = ["angus", "asteria", "arcas", "orion", "orpheus", "athena", "luna", "zeus", "perseus", "helios", "hera", "stella"] as const;

// ---- MP3 frames (MPEG-1, -2 and -2.5 Layer III) -------------------------------------------------------------------
const KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** The Layer III frame whose header starts at `i`, or null. */
export function mp3FrameAt(b: Uint8Array, i: number): { length: number; seconds: number } | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3;
  const bi = (b[i + 2] >> 4) & 15;
  const ri = (b[i + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bi === 0 || bi === 15 || ri === 3) return null;
  const kbps = (version === 3 ? KBPS_V1 : KBPS_V2)[bi];
  const rate = RATES[version][ri];
  const samples = version === 3 ? 1152 : 576;
  return { length: Math.floor((samples / 8) * kbps * 1000 / rate) + ((b[i + 2] >> 1) & 1), seconds: samples / rate };
}

export interface Mp3Frame { offset: number; length: number; seconds: number }

/** Every Layer III frame of an MP3, after an ID3v2 tag and before an ID3v1 tag; bytes that are not a frame are skipped. */
export function mp3Frames(b: Uint8Array): Mp3Frame[] {
  const frames: Mp3Frame[] = [];
  let i = id3Length(b);
  let expected = -1; // where the last trusted frame ended
  while (i + 4 <= b.length) {
    if (b.length - i === 128 && b[i] === 0x54 && b[i + 1] === 0x41 && b[i + 2] === 0x47) break; // "TAG": ID3v1
    const f = mp3FrameAt(b, i);
    // A header is trusted when it follows the last trusted frame, or when the next frame starts where it says it ends
    // (or the file ends there): a stray 0xFF in junk bytes is not taken for a frame.
    if (f && i + f.length <= b.length && (i === expected || i + f.length >= b.length - 4 || b.length - (i + f.length) === 128 || mp3FrameAt(b, i + f.length))) {
      frames.push({ offset: i, length: f.length, seconds: f.seconds });
      i += f.length;
      expected = i;
    } else i++;
  }
  return frames;
}

// ---- WAV (RIFF PCM) ------------------------------------------------------------------------------------------------
export interface WavInfo { fmt: Uint8Array; dataStart: number; dataLength: number; byteRate: number; blockAlign: number }

/** The fmt chunk and the sample data of a RIFF/WAVE file, or null when it is not one. */
export function wavInfo(b: Uint8Array): WavInfo | null {
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fmt: Uint8Array | null = null;
  let byteRate = 0, blockAlign = 0;
  for (let o = 12; o + 8 <= b.length;) {
    const size = view.getUint32(o + 4, true);
    if (tag(o) === "fmt " && o + 8 + 16 <= b.length) {
      fmt = b.subarray(o, Math.min(b.length, o + 8 + size));
      byteRate = view.getUint32(o + 16, true);
      blockAlign = view.getUint16(o + 20, true);
    } else if (tag(o) === "data") {
      if (!fmt || !byteRate || !blockAlign) return null;
      return { fmt, dataStart: o + 8, dataLength: Math.min(size, b.length - (o + 8)), byteRate, blockAlign };
    }
    o += 8 + size + (size & 1);
  }
  return null;
}

/** A standalone WAV file holding `pcm` with the original file's fmt chunk. */
export function wavFile(fmt: Uint8Array, pcm: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + fmt.length + 8 + pcm.length);
  const view = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, out.length - 8, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8);
  out.set(fmt, 12);
  const d = 12 + fmt.length;
  out.set([0x64, 0x61, 0x74, 0x61], d);
  view.setUint32(d + 4, pcm.length, true);
  out.set(pcm, d + 8);
  return out;
}

// ---- Cutting audio into parts ----------------------------------------------------------------------------------------
export interface AudioPart { bytes: Uint8Array; start: number; seconds: number }
export interface AudioPlan { format: "mp3" | "wav"; seconds: number; parts: AudioPart[] }

/** The audio cut into parts Whisper takes in one call, or a 415 for anything that is not MP3 or WAV. */
export function planAudio(b: Uint8Array, maxBytes = PART_MAX_BYTES, maxSeconds = PART_MAX_SECONDS): AudioPlan {
  const wav = wavInfo(b);
  if (wav) {
    const step = Math.max(wav.blockAlign, Math.floor(Math.min(maxBytes, maxSeconds * wav.byteRate) / wav.blockAlign) * wav.blockAlign);
    const parts: AudioPart[] = [];
    for (let at = 0; at < wav.dataLength; at += step) {
      const pcm = b.subarray(wav.dataStart + at, wav.dataStart + Math.min(wav.dataLength, at + step));
      parts.push({ bytes: wavFile(wav.fmt, pcm), start: at / wav.byteRate, seconds: pcm.length / wav.byteRate });
    }
    return { format: "wav", seconds: wav.dataLength / wav.byteRate, parts };
  }
  const frames = mp3Frames(b);
  if (frames.length < 2) throw new HttpError(415, "send an MP3 or WAV file (nothing was charged); other formats such as M4A and OGG work with /transcribe up to 5 MB");
  const parts: AudioPart[] = [];
  let first = 0, bytes = 0, secs = 0, start = 0;
  const close = (end: number) => {
    const a = frames[first], z = frames[end];
    parts.push({ bytes: b.subarray(a.offset, z.offset + z.length), start, seconds: secs });
    start += secs;
  };
  for (let i = 0; i < frames.length; i++) {
    if (i > first && (bytes + frames[i].length > maxBytes || secs + frames[i].seconds > maxSeconds)) { close(i - 1); first = i; bytes = 0; secs = 0; }
    bytes += frames[i].length;
    secs += frames[i].seconds;
  }
  close(frames.length - 1);
  return { format: "mp3", seconds: start, parts };
}

interface WhisperOut {
  text?: string;
  transcription_info?: { language?: string; language_probability?: number };
  segments?: { start?: number; end?: number; text?: string; words?: { word?: string; start?: number; end?: number }[] }[];
}

export interface PartTranscript { text: string; language: string | null; languageProbability: number | null; segments: TimedSegment[]; words: { word: string; start: number; end: number }[] }

/** One part's Whisper answer with its timings moved to the part's place in the whole file. */
export function shiftPart(out: WhisperOut, start: number): PartTranscript {
  const r = (n: unknown) => Math.round((Number(n) || 0) * 1000 + start * 1000) / 1000;
  return {
    text: String(out.text ?? "").trim(),
    language: out.transcription_info?.language ?? null,
    languageProbability: out.transcription_info?.language_probability ?? null,
    segments: (out.segments ?? []).map((s) => ({ start: r(s.start), end: r(s.end), text: String(s.text ?? "").trim() })).filter((s) => s.text),
    words: (out.segments ?? []).flatMap((s) => s.words ?? []).map((w) => ({ word: String(w.word ?? "").trim(), start: r(w.start), end: r(w.end) })).filter((w) => w.word),
  };
}

async function audioBytes(q: Input): Promise<{ bytes: Uint8Array; url: string | null }> {
  const sent = q(FILE_REF_INPUT);
  if (isFileRef(sent)) {
    const held = heldFile(sent);
    if (!held) throw new HttpError(400, "send the audio file in a POST body (raw bytes, a multipart `file` part, or base64 in JSON); a file reference cannot be used in a GET");
    return { bytes: held, url: null };
  }
  const file = await fetchFile(q("url"), /^(audio|video)\/|^(application|binary)\/(octet-stream|ogg)/i, LONG_TRANSCRIBE_MAX_BYTES, "an audio file");
  return { bytes: file.bytes, url: file.url };
}

export const VOICE: Entry[] = [
  entry(LONG_TRANSCRIBE_PATH, "Transcribe long audio: up to 60 minutes of MP3 or WAV, with subtitles",
    "Transcribe a podcast, meeting, interview or lecture: up to 60 minutes of MP3 or WAV (25 MB) by URL or uploaded in a POST body, 90+ languages, Whisper large-v3-turbo. Parts are joined, so subtitles=srt or vtt and timestamps=true cover the whole recording; longer audio is refused before anything runs. Use for meeting notes, podcast show notes, video subtitles and interviews; for a short clip in any format, transcribe costs less.",
    ["transcription", "speech-to-text", "long-audio", "podcast-transcription", "subtitles", "whisper", "audio"], {
      url: { type: "string", description: "Absolute http(s) URL of an MP3 or WAV file (max 25 MB, 60 minutes); or POST the file itself (raw body, multipart `file` part, or base64 in JSON)", required: true, example: "https://upload.wikimedia.org/wikipedia/commons/7/77/Tofino_pronunciation.mp3" },
      subtitles: { type: "string", description: "srt or vtt: also return subtitle text for the whole recording", example: "srt" },
      timestamps: { type: "string", description: "true: also return timed segments and words", example: "true" },
      language: { type: "string", description: "Spoken language code such as en, sv or de (default: detected per part)", example: "en" },
    },
    { url: "https://upload.wikimedia.org/wikipedia/commons/7/77/Tofino_pronunciation.mp3", format: "mp3", durationSeconds: 1, parts: 1, text: "Tofino.", language: "en", wordCount: 1, model: MODELS.speech },
    async (env: Env, q: Input) => {
      const subtitles = (q("subtitles") ?? "").trim().toLowerCase();
      if (subtitles && subtitles !== "srt" && subtitles !== "vtt") throw new HttpError(400, "subtitles must be srt or vtt");
      const timestamps = /^(1|true|yes|on)$/i.test((q("timestamps") ?? "").trim());
      const langRaw = (q("language") ?? "").trim().toLowerCase();
      if (langRaw && !/^[a-z]{2,3}([-_][a-z0-9]+)?$/.test(langRaw)) throw new HttpError(400, "language must be a 2-3 letter code such as en, sv or de");
      const language = langRaw.slice(0, 2);
      const { bytes, url } = await audioBytes(q);
      const plan = planAudio(bytes);
      if (plan.seconds > LONG_TRANSCRIBE_MAX_SECONDS) throw new HttpError(400, `the audio is ${Math.ceil(plan.seconds / 60)} minutes long; this tool reads up to ${LONG_TRANSCRIBE_MAX_SECONDS / 60} minutes (nothing was charged)`);
      const results: PartTranscript[] = new Array(plan.parts.length);
      for (let i = 0; i < plan.parts.length; i += PARALLEL_PARTS) {
        await Promise.all(plan.parts.slice(i, i + PARALLEL_PARTS).map(async (part, k) => {
          const out = await runAi<WhisperOut>(env, MODELS.speech, { audio: Buffer.from(part.bytes).toString("base64"), ...(language ? { language } : {}) });
          if (typeof out?.text !== "string") throw new HttpError(502, `the AI model returned no transcript for part ${i + k + 1} of ${plan.parts.length}; nothing was charged`);
          results[i + k] = shiftPart(out, part.start);
        }));
      }
      const text = results.map((r) => r.text).filter(Boolean).join(" ");
      const segments = results.flatMap((r) => r.segments);
      const words = results.flatMap((r) => r.words);
      if (subtitles && !segments.length && text) segments.push({ start: 0, end: plan.seconds, text });
      const lead = results.find((r) => r.language) ?? results[0];
      return {
        url,
        ...(url ? {} : { source: "upload", bytes: bytes.byteLength }),
        format: plan.format,
        durationSeconds: Math.round(plan.seconds * 10) / 10,
        parts: plan.parts.length,
        text,
        language: lead?.language ?? null,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        model: MODELS.speech,
        ...(timestamps ? { languageProbability: lead?.languageProbability ?? null, segments, words } : {}),
        ...(subtitles ? { subtitleFormat: subtitles, subtitles: toSubtitles(segments, subtitles as "srt" | "vtt") } : {}),
      };
    }, LONG_TRANSCRIBE_PRICE),
  entry(LITE_SPEECH_PATH, "Cheap text to speech: up to 2,000 characters in English as one MP3",
    "Low-cost text to speech for longer English text: up to 2,000 characters as one MP3 (base64) with Deepgram Aura-1, 12 voices. Half the price per character of text_to_speech, with a slightly less natural voice. Pick a voice by name or leave the default. Use for narration drafts, read-aloud of articles and summaries, notifications and accessibility at volume; for the most natural voices or Spanish use text_to_speech.",
    ["text-to-speech", "tts", "cheap-tts", "tts-api", "narration", "audio"], {
      text: { type: "string", description: "Text to speak, up to 2,000 characters", required: true, example: "Your order has shipped and should reach you within three working days." },
      voice: { type: "string", description: `Voice name: ${LITE_VOICES.join(", ")}. OpenAI voice names map to the nearest one. Default: luna`, example: "luna" },
    },
    { contentType: "audio/mpeg", audioBase64: "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjMuMTAwAAAA…", bytes: 61440, voice: "luna", characters: 72, parts: 1, model: LITE_SPEECH_MODEL },
    async (env: Env, q: Input) => {
      const raw = q("text") ?? "";
      const t = raw.trim();
      if (!t) throw new HttpError(400, "text is required");
      if (t.length > LITE_SPEECH_MAX) throw new HttpError(400, `text must be at most ${LITE_SPEECH_MAX} characters`);
      const voice = liteVoice(q);
      const parts = speechParts(t);
      const spoken = await Promise.all(parts.map(async (part) => {
        const b64 = await audioToBase64(await runAi<unknown>(env, LITE_SPEECH_MODEL, { text: part, speaker: voice, encoding: "mp3" }));
        if (!b64) throw new HttpError(502, "the AI model returned no audio");
        return b64;
      }));
      const audioBase64 = spoken.length === 1 ? spoken[0] : joinMp3(spoken);
      return { contentType: "audio/mpeg", audioBase64, bytes: base64Bytes(audioBase64), voice, characters: t.length, parts: parts.length, model: LITE_SPEECH_MODEL };
    }, LITE_SPEECH_PRICE),
];

/** The Aura-1 voice asked for: an Aura-1 name, or an OpenAI name mapped to the nearest one; unknown names are a 400. */
export function liteVoice(q: Input): string {
  const sent = (q("voice") ?? "").trim().toLowerCase().replace(/^aura-(1-)?|-en$/g, "");
  if (!sent) return "luna";
  const lite: readonly string[] = LITE_VOICES;
  if (lite.includes(sent)) return sent;
  if (Object.hasOwn(OPENAI_VOICES, sent)) { const mapped = OPENAI_VOICES[sent]; return lite.includes(mapped) ? mapped : "luna"; }
  return pick(q, "voice", LITE_VOICES);
}

export const VOICE_PATHS = VOICE.map((e) => e.endpoint.path);
