/**
 * MeloTTS on Workers AI (@cf/myshell-ai/melotts, MIT) was retired 20 Nov 2026: it used to supply French, Chinese, Japanese and Korean voices, which Aura-2
 * does not speak. Why: /status of 16 Nov 2026 showed paid /dub calls refused with "to must be en or es".
 *
 * Measured 16 Nov 2026 through the Workers AI REST API: `{ prompt, lang }` with lang one of en, es, fr, jp, kr, zh
 * ("de" is refused with 8007 "Unsupported language"); the answer is `{ audio }`, base64 of a RIFF WAV at 44.1 kHz, mono,
 * 16-bit (a 30-character French sentence: 1.9 s of audio in 1.6 s). There is one voice per language.
 *
 * Workers have no MP3 encoder, so the answer stays WAV, resampled to 16 kHz (32 KB a second, plenty for speech): a
 * minute of speech is about 1.9 MB, and `MELO_MAX_CHARS` keeps a call near a minute and a half.
 */
import { HttpError, type Env } from "./env";
import { runAi } from "./ai";

export const MELO_MODEL = "@cf/myshell-ai/melotts";
/** Our ISO 639-1 code to MeloTTS's own code. */
export const MELO_LANGS: Readonly<Record<string, string>> = { fr: "fr", zh: "zh", ja: "jp", ko: "kr" };
export const isMeloLang = (lang: string) => Object.hasOwn(MELO_LANGS, lang);
/** About 90 seconds of French or 1,000 Chinese characters spoken slowly; keeps the WAV near 3 MB. */
export const MELO_MAX_CHARS = 1_200;
export const MELO_RATE = 16_000;
/** MeloTTS parts: shorter than Aura-2's, so the parallel parts finish together. */
export const MELO_PART_MAX = 200;
/** Chinese and Japanese end sentences with full-width marks and no space: a line break makes them cut points. */
export const meloSentences = (t: string) => t.replace(/([。！？])/g, "$1\n");
/** Every language our speech tools speak: Aura-2 (en, es). fr, zh, ja and ko were MeloTTS's, retired with it (below). */
export const SPEECH_LANGS = ["en", "es"] as const;
export type SpeechLang = (typeof SPEECH_LANGS)[number];
/** Languages MeloTTS served before Workers AI retired it (owner: "MeloTTS is retired by Cloudflare on 20 Nov 2026"). Callers must refuse a retired language with `retiredSpeechLang`, not treat it as Aura-2. */
export const RETIRED_SPEECH_LANGS: ReadonlySet<string> = new Set(["fr", "zh", "ja", "ko"]);
const LANG_NAMES: Readonly<Record<string, string>> = { english: "en", spanish: "es", "español": "es", french: "fr", "français": "fr", chinese: "zh", mandarin: "zh", "zh-cn": "zh", japanese: "ja", jp: "ja", korean: "ko", kr: "ko" };
/** A language code or English name as one of `SPEECH_LANGS`, else undefined. A name in `RETIRED_SPEECH_LANGS` is still undefined (so callers see a language that was never served), but `retiredSpeechLang` names it. */
export function speechLangOf(raw: string | undefined): SpeechLang | undefined {
  const t = (raw ?? "").trim().toLowerCase();
  const code = Object.hasOwn(LANG_NAMES, t) ? LANG_NAMES[t] : t;
  return (SPEECH_LANGS as readonly string[]).includes(code) ? (code as SpeechLang) : undefined;
}
/** The retired language a raw name or code stands for (normalized through LANG_NAMES), or undefined. */
export function retiredSpeechLang(raw: string | undefined): string | undefined {
  const code = Object.hasOwn(LANG_NAMES, (raw ?? "").trim().toLowerCase()) ? LANG_NAMES[(raw ?? "").trim().toLowerCase()] : (raw ?? "").trim().toLowerCase();
  return RETIRED_SPEECH_LANGS.has(code) ? code : undefined;
}

/** The 16-bit mono samples and rate of a PCM WAV (the first channel when there are more). */
export function wavSamples(bytes: Uint8Array): { samples: Int16Array; rate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new HttpError(502, "the speech model returned audio that is not a WAV file; nothing was charged");
  let rate = 0, channels = 1, bits = 16, at = 12;
  let data: Uint8Array | null = null;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at), size = view.getUint32(at + 4, true), body = at + 8;
    if (id === "fmt ") { channels = view.getUint16(body + 2, true); rate = view.getUint32(body + 4, true); bits = view.getUint16(body + 14, true); }
    else if (id === "data") { data = bytes.subarray(body, Math.min(bytes.byteLength, body + size)); break; }
    at = body + size + (size % 2);
  }
  if (!data || !rate || bits !== 16 || channels < 1) throw new HttpError(502, "the speech model returned a WAV file this tool cannot read; nothing was charged");
  const frames = Math.floor(data.byteLength / (2 * channels));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const samples = new Int16Array(frames);
  for (let i = 0; i < frames; i++) samples[i] = dv.getInt16(i * 2 * channels, true);
  return { samples, rate };
}

/** Down to `to` Hz by averaging the source samples that fall in each output sample (a box low-pass, fine for speech). */
export function resample(samples: Int16Array, from: number, to = MELO_RATE): Int16Array {
  if (from <= to) return samples;
  const ratio = from / to;
  const out = new Int16Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(samples.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let k = a; k < b; k++) sum += samples[k];
    out[i] = Math.round(sum / (b - a));
  }
  return out;
}

/** One 16-bit mono WAV file from several sample runs, with a short pause between them. */
export function joinWav(parts: Int16Array[], rate = MELO_RATE, pauseMs = 250): Uint8Array {
  const gap = Math.round((rate * pauseMs) / 1000);
  const total = parts.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, parts.length - 1);
  const out = new Uint8Array(44 + total * 2);
  const v = new DataView(out.buffer);
  const put = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  put(0, "RIFF"); v.setUint32(4, 36 + total * 2, true); put(8, "WAVE");
  put(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  put(36, "data"); v.setUint32(40, total * 2, true);
  let at = 44;
  parts.forEach((p, i) => {
    if (i) at += gap * 2;
    for (let k = 0; k < p.length; k++, at += 2) v.setInt16(at, p[k], true);
  });
  return out;
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Speaks each part in `lang` (fr, zh, ja, ko) in parallel and returns one 16 kHz WAV as base64. */
export async function meloSpeech(env: Env, parts: string[], lang: string): Promise<{ audioBase64: string; seconds: number }> {
  if (!isMeloLang(lang)) throw new HttpError(400, `no MeloTTS voice for ${lang}`);
  const runs = await Promise.all(parts.map(async (prompt) => {
    const r = await runAi<{ audio?: string }>(env, MELO_MODEL, { prompt, lang: MELO_LANGS[lang] });
    if (!r?.audio) throw new HttpError(502, "the speech model returned no audio; nothing was charged");
    const { samples, rate } = wavSamples(fromBase64(r.audio));
    return resample(samples, rate);
  }));
  const wav = joinWav(runs);
  return { audioBase64: toBase64(wav), seconds: Math.round(((wav.byteLength - 44) / 2 / MELO_RATE) * 10) / 10 };
}
