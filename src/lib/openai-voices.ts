// GET /v1/audio/voices: the voice names /v1/audio/speech (and the two speech tools) accept, free to read.
// Why (16 Nov 2026): apps with an "OpenAI-compatible endpoint" setting fill their voice picker from this sibling of the
// speech endpoint. Home Assistant's openai_tts integration (sfortis/openai_tts, voice_listing.py) asks for it before it
// falls back to a typed voice name, and reads `data` (OpenAI style, {id, name}), `items` (Mistral) or `voices` (a list of
// strings, Kokoro-FastAPI). We answer `data` and `voices` so both kinds of client fill their list. English is the
// default because a Spanish voice also needs language=es on the speech request; `?language=es` lists those.
import { OPENAI_VOICES, SPEECH_VOICES } from "../routes/ai-text";

export const OPENAI_VOICES_PATH = "/v1/audio/voices";
const DEFAULT_VOICE = { en: "luna", es: "aquila" } as const;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface VoiceItem { id: string; object: "voice"; name: string; language: "en" | "es"; default?: true; alias_of?: string }

/** The voice list for one language, the default voice first; for English also the OpenAI names, each naming its voice. */
export function openAiVoiceList(language?: string | null): { object: "list"; language: "en" | "es"; default: string; data: VoiceItem[]; voices: string[] } | { error: string } {
  const raw = (language ?? "").trim().toLowerCase().slice(0, 2);
  if (raw && raw !== "en" && raw !== "es") return { error: "language must be en or es" };
  const lang: "en" | "es" = raw === "es" ? "es" : "en";
  const def = DEFAULT_VOICE[lang];
  const own = [def, ...SPEECH_VOICES[lang].filter((v) => v !== def)];
  const data: VoiceItem[] = own.map((v) => ({ id: v, object: "voice", name: v === def ? `${cap(v)} (default)` : cap(v), language: lang, ...(v === def ? { default: true as const } : {}) }));
  if (lang === "en") for (const [alias, voice] of Object.entries(OPENAI_VOICES)) data.push({ id: alias, object: "voice", name: `${alias} (OpenAI name, sounds like ${cap(voice)})`, language: "en", alias_of: voice });
  return { object: "list", language: lang, default: def, data, voices: data.map((v) => v.id) };
}

/** The /v1/audio/voices path for /openapi.json. */
export function openAiVoicesOpenApiPath() {
  return {
    [OPENAI_VOICES_PATH]: {
      get: {
        operationId: "list_voices",
        summary: "Voice list for /v1/audio/speech",
        description: "The voice names /v1/audio/speech accepts: 40 English Aura-2 voices plus the OpenAI names (alloy, nova, onyx…) mapped to them, or the 10 Spanish voices with language=es (a Spanish voice also needs language=es on the speech request). Free.",
        tags: ["ai", "text-to-speech", "tts", "audio", "openai"],
        security: [],
        parameters: [{ name: "language", in: "query", required: false, schema: { type: "string", enum: ["en", "es"] }, description: "en (default) or es" }],
        responses: {
          "200": { description: "Voice list", content: { "application/json": { example: openAiVoiceList("en") } } },
          "400": { description: "Unknown language" },
        },
      },
    },
  };
}
