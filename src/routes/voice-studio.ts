// Glyphcall Voice, round 5 (15 Nov 2026, owner: "fix all problems and add more, we are gonna beat them!"). Two studio
// jobs as API calls, both timed from the audio we generate, so the captions match what is heard:
//   /dialogue                  a script ("Name: line") spoken with one Aura-2 voice per speaker, joined into one MP3,
//                              plus SRT captions with the speaker's name. ElevenLabs sells multi-speaker audio in Studio.
//   /text-to-speech/captions   text spoken sentence by sentence and joined, plus SRT/VTT whose timings come from each
//                              sentence's MP3 frames. ElevenLabs' API returns raw character timestamps; this returns
//                              subtitles ready for a video editor.
// Aura-2 costs $0.030 per 1,000 characters: /dialogue's 2,500-character cap costs at most $0.075 (price $0.10), and
// /text-to-speech/captions' 2,000 characters $0.06 (price $0.08, as /text-to-speech). Both are paid only.
import { Buffer } from "node:buffer";
import { entry, type Entry, type Input } from "../family";
import { HttpError, type Env } from "../lib/env";
import { toSubtitles } from "./ai";
import { SPEECH_VOICES, base64Bytes, joinMp3, speakOnce, speechParts, speechVoice } from "./ai-text";
import { mp3Frames } from "./voice";

const PARALLEL = 6;

/** Seconds of audio in one MP3, counted from its frames. */
export function mp3Seconds(b64: string): number {
  return mp3Frames(new Uint8Array(Buffer.from(b64, "base64"))).reduce((n, f) => n + f.seconds, 0);
}

export interface Spoken { text: string; voice: string; start: number; end: number; label?: string }

/**
 * Speaks each item with its own voice (several at a time), joins everything into one MP3 in order, and returns where
 * each item starts and ends in it. A part that fails fails the call, so nothing is charged for half a file.
 */
export async function speakTimed(env: Env, model: string, items: readonly { text: string; voice: string; label?: string }[]): Promise<{ audioBase64: string; spoken: Spoken[] }> {
  const audio: string[][] = new Array(items.length);
  for (let i = 0; i < items.length; i += PARALLEL) {
    await Promise.all(items.slice(i, i + PARALLEL).map(async (it, k) => {
      audio[i + k] = await Promise.all(speechParts(it.text).map((p) => speakOnce(env, model, it.voice, p)));
    }));
  }
  const spoken: Spoken[] = [];
  let at = 0;
  items.forEach((it, i) => {
    const seconds = audio[i].reduce((n, b64) => n + mp3Seconds(b64), 0);
    spoken.push({ text: it.text, voice: it.voice, start: Math.round(at * 1000) / 1000, end: Math.round((at + seconds) * 1000) / 1000, ...(it.label ? { label: it.label } : {}) });
    at += seconds;
  });
  const all = audio.flat();
  return { audioBase64: all.length === 1 ? all[0] : joinMp3(all), spoken };
}

// ---- Dialogue -------------------------------------------------------------------------------------------------------
export const DIALOGUE_PATH = "/dialogue";
export const DIALOGUE_PRICE = "$0.10";
export const DIALOGUE_MAX_CHARS = 2_500;
export const DIALOGUE_MAX_SPEAKERS = 6;
export const DIALOGUE_MAX_LINES = 80;
/** Default voices in speaking order, alternating female and male. */
export const DIALOGUE_VOICES = { en: ["luna", "orion", "asteria", "zeus", "athena", "arcas"], es: ["carina", "alvaro", "celeste", "javier", "diana", "nestor"] } as const;

export interface Line { speaker: string; text: string }

/** Reads "Name: line" scripts; a line without a name continues the previous speaker's turn. */
export function parseScript(script: string): Line[] {
  const lines: Line[] = [];
  for (const raw of script.replace(/\r\n?/g, "\n").split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const m = /^([^:\n]{1,40}):\s*(.+)$/.exec(l);
    if (m && !/^https?$/i.test(m[1])) lines.push({ speaker: m[1].trim(), text: m[2].trim() });
    else if (lines.length) lines[lines.length - 1].text += ` ${l}`;
    else lines.push({ speaker: "Narrator", text: l });
  }
  return lines;
}

/** The voice of each speaker: the caller's map (JSON {"Anna":"luna"} or "Anna=luna, Ben=orion"), then the defaults in order. */
export function castVoices(speakers: readonly string[], lang: "en" | "es", raw: string | undefined): Record<string, string> {
  const allowed: readonly string[] = SPEECH_VOICES[lang];
  let asked: Record<string, string> = {};
  const text = (raw ?? "").trim();
  if (text) {
    try { asked = text.startsWith("{") ? JSON.parse(text) as Record<string, string> : Object.fromEntries(text.split(/[,;\n]/).map((p) => p.split("=").map((s) => s.trim())).filter((p) => p.length === 2 && p[0] && p[1])); }
    catch { throw new HttpError(400, 'voices must be JSON such as {"Anna":"luna"} or a list such as Anna=luna, Ben=orion'); }
  }
  const cast: Record<string, string> = {};
  const free = DIALOGUE_VOICES[lang].filter((v) => !Object.values(asked).map((x) => String(x).toLowerCase()).includes(v));
  for (const s of speakers) {
    const key = Object.keys(asked).find((k) => k.toLowerCase() === s.toLowerCase());
    const v = key ? String(asked[key]).trim().toLowerCase() : free.shift() ?? DIALOGUE_VOICES[lang][0];
    if (!allowed.includes(v)) throw new HttpError(400, `voice ${v} for ${s} is not one of the ${lang} voices: ${allowed.join(", ")}`);
    cast[s] = v;
  }
  return cast;
}

// ---- Speech with captions -------------------------------------------------------------------------------------------
export const CAPTIONS_PATH = "/text-to-speech/captions";
export const CAPTIONS_PRICE = "$0.08";
export const CAPTIONS_MAX_CHARS = 2_000;
const CUE_MAX = 120;

/** The text cut into caption-sized cues: sentence ends first, then commas, never above 120 characters when avoidable. */
export function captionCues(text: string): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+(?=\S)/);
  const cues: string[] = [];
  for (const s of sentences) {
    if (s.length <= CUE_MAX) { cues.push(s); continue; }
    let rest = s;
    while (rest.length > CUE_MAX) {
      const window = rest.slice(0, CUE_MAX);
      const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(" – "));
      const at = cut > CUE_MAX / 3 ? cut + 1 : window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : CUE_MAX;
      cues.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) cues.push(rest);
  }
  // A fragment ("Hi.", "Yes.") reads better joined to its neighbour; ordinary sentences keep their own cue.
  const merged: string[] = [];
  for (const c of cues) {
    const last = merged[merged.length - 1];
    if (last && (last.length < 25 || c.length < 15) && last.length + c.length + 1 <= 80) merged[merged.length - 1] = `${last} ${c}`; else merged.push(c);
  }
  return merged.filter(Boolean);
}

export const VOICE_STUDIO: Entry[] = [
  entry(DIALOGUE_PATH, "Dialogue to audio: a script with several speakers as one MP3, plus captions",
    "Turn a script into a multi-voice conversation: write one line per turn as \"Name: text\", each speaker gets their own natural voice (Deepgram Aura-2, English or Spanish, or pick voices), and the whole dialogue comes back as one MP3 with SRT captions naming the speaker, timed from the real audio. Up to 6 speakers and 2,500 characters. Use for podcast intros, language-lesson dialogues, explainer videos, ads and game or story scenes.",
    ["dialogue", "multi-speaker-tts", "podcast-generator", "text-to-speech", "voice-generation", "captions", "audio"], {
      script: { type: "string", description: "One turn per line as Name: text (up to 6 speakers, 2,500 characters)", required: true, example: "Anna: Welcome back to the show!\nBen: Thanks, it is great to be here." },
      lang: { type: "string", description: "Language: en or es (default en)", example: "en", enum: ["en", "es"] },
      voices: { type: "string", description: 'Voice per speaker, as JSON {"Anna":"luna"} or Anna=luna, Ben=orion (default: a different voice each, in order)', example: "Anna=luna, Ben=orion" },
      captions: { type: "string", description: "srt (default) or vtt", example: "srt" },
    },
    { contentType: "audio/mpeg", audioBase64: "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjMuMTAwAAAA…", audioBytes: 98304, durationSeconds: 4.6, lang: "en", speakers: { Anna: "luna", Ben: "orion" }, lines: [{ speaker: "Anna", voice: "luna", start: 0, end: 1.9, text: "Welcome back to the show!" }, { speaker: "Ben", voice: "orion", start: 1.9, end: 4.6, text: "Thanks, it is great to be here." }], characters: 56, captionFormat: "srt", captions: "1\n00:00:00,000 --> 00:00:01,900\nAnna: Welcome back to the show!\n\n2\n00:00:01,900 --> 00:00:04,600\nBen: Thanks, it is great to be here.\n", model: "@cf/deepgram/aura-2-en" },
    async (env: Env, q: Input) => {
      const lang = (q("lang") ?? "en").trim().toLowerCase() || "en";
      if (lang !== "en" && lang !== "es") throw new HttpError(400, "lang must be en or es");
      const format = (q("captions") ?? "srt").trim().toLowerCase() || "srt";
      if (format !== "srt" && format !== "vtt") throw new HttpError(400, "captions must be srt or vtt");
      const lines = parseScript(q("script") ?? "");
      if (!lines.length) throw new HttpError(400, "script is required: one turn per line as Name: text");
      if (lines.length > DIALOGUE_MAX_LINES) throw new HttpError(400, `the script has ${lines.length} turns; this tool speaks up to ${DIALOGUE_MAX_LINES} per call`);
      const chars = lines.reduce((n, l) => n + l.text.length, 0);
      if (chars > DIALOGUE_MAX_CHARS) throw new HttpError(400, `the script holds ${chars.toLocaleString("en-US")} characters of speech; this tool speaks up to ${DIALOGUE_MAX_CHARS.toLocaleString("en-US")} per call`);
      const speakers = [...new Set(lines.map((l) => l.speaker))];
      if (speakers.length > DIALOGUE_MAX_SPEAKERS) throw new HttpError(400, `the script has ${speakers.length} speakers; this tool voices up to ${DIALOGUE_MAX_SPEAKERS}`);
      const cast = castVoices(speakers, lang, q("voices"));
      const { model } = speechVoice((k) => (k === "lang" ? lang : undefined));
      const { audioBase64, spoken } = await speakTimed(env, model, lines.map((l) => ({ text: l.text, voice: cast[l.speaker], label: l.speaker })));
      const durationSeconds = spoken.length ? spoken[spoken.length - 1].end : 0;
      return {
        contentType: "audio/mpeg", audioBase64, audioBytes: base64Bytes(audioBase64),
        durationSeconds: Math.round(durationSeconds * 10) / 10, lang, speakers: cast,
        lines: spoken.map((s) => ({ speaker: s.label!, voice: s.voice, start: s.start, end: s.end, text: s.text })),
        characters: chars, captionFormat: format,
        captions: toSubtitles(spoken.map((s) => ({ start: s.start, end: s.end, text: `${s.label}: ${s.text}` })), format as "srt" | "vtt"),
        model,
      };
    }, DIALOGUE_PRICE),
  entry(CAPTIONS_PATH, "Text to speech with subtitles: one MP3 plus SRT or VTT timed to the voice",
    "Text to speech that comes with subtitles: up to 2,000 characters spoken as one MP3 in English or Spanish (Deepgram Aura-2, pick a voice), plus SRT or VTT captions whose timings come from the generated audio itself, sentence by sentence. Ready for a video editor, no transcription step. Use for narrated videos, social clips, e-learning and accessible audio with captions.",
    ["text-to-speech", "tts-with-subtitles", "captions", "srt", "narration", "voice-over", "audio"], {
      text: { type: "string", description: "Text to speak, up to 2,000 characters", required: true, example: "Welcome to the course. Today we start with the basics, and by the end of the hour you will build your first project." },
      lang: { type: "string", description: "Language: en or es (default en)", example: "en", enum: ["en", "es"] },
      voice: { type: "string", description: "Aura-2 voice name (default luna for en, aquila for es)", example: "luna" },
      captions: { type: "string", description: "srt (default) or vtt", example: "srt" },
    },
    { contentType: "audio/mpeg", audioBase64: "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjMuMTAwAAAA…", audioBytes: 143360, durationSeconds: 7.2, lang: "en", voice: "luna", cues: [{ start: 0, end: 1.6, text: "Welcome to the course." }, { start: 1.6, end: 7.2, text: "Today we start with the basics, and by the end of the hour you will build your first project." }], characters: 116, captionFormat: "srt", captions: "1\n00:00:00,000 --> 00:00:01,600\nWelcome to the course.\n\n2\n00:00:01,600 --> 00:00:07,200\nToday we start with the basics, and by the end of the hour you will build your first project.\n", model: "@cf/deepgram/aura-2-en" },
    async (env: Env, q: Input) => {
      const text = (q("text") ?? "").replace(/\s+/g, " ").trim();
      if (!text) throw new HttpError(400, "text is required");
      if (text.length > CAPTIONS_MAX_CHARS) throw new HttpError(400, `text must be at most ${CAPTIONS_MAX_CHARS.toLocaleString("en-US")} characters`);
      const format = (q("captions") ?? "srt").trim().toLowerCase() || "srt";
      if (format !== "srt" && format !== "vtt") throw new HttpError(400, "captions must be srt or vtt");
      const { lang, voice, model } = speechVoice(q);
      const { audioBase64, spoken } = await speakTimed(env, model, captionCues(text).map((c) => ({ text: c, voice })));
      const durationSeconds = spoken.length ? spoken[spoken.length - 1].end : 0;
      return {
        contentType: "audio/mpeg", audioBase64, audioBytes: base64Bytes(audioBase64),
        durationSeconds: Math.round(durationSeconds * 10) / 10, lang, voice,
        cues: spoken.map((s) => ({ start: s.start, end: s.end, text: s.text })),
        characters: text.length, captionFormat: format,
        captions: toSubtitles(spoken.map((s) => ({ start: s.start, end: s.end, text: s.text })), format as "srt" | "vtt"),
        model,
      };
    }, CAPTIONS_PRICE),
];

export const VOICE_STUDIO_PATHS = VOICE_STUDIO.map((e) => e.endpoint.path);
