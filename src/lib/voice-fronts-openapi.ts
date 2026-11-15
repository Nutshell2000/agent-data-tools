// What directories read about the drop-in voice fronts (lib/voice-fronts.ts): their descriptions, the name and tags their
// 402 quotes carry, and their /openapi.json paths. Kept apart from voice-fronts.ts so discovery.ts can import it without
// pulling in the route modules.
// 15 Nov 2026 (owner: "start selling more voice calls"): the fronts were missing from /openapi.json, and their quotes
// carried the tool's name and tags ("Text to speech (TTS)"), so a search for ElevenLabs found nothing of ours while one
// router sold an ElevenLabs-named speech route 3,749 times in 30 days. Names say "ElevenLabs-compatible API" after the
// task words, never "ElevenLabs text to speech" first: the voices are Deepgram Aura, only the request shape is theirs.
import { openApiGetVariant, type FrontMeta } from "./openai-chat";
import { paymentInfo as buildPaymentInfo } from "./payment-info";

export const VOICE_FRONT_DESCRIPTIONS = {
  tts: "ElevenLabs-compatible text to speech, pay per request: text in, one MP3 file out (Deepgram Aura-2 voices; ElevenLabs premade voice IDs map to a similar voice). Up to 2,000 characters, English or Spanish. No account; failed calls are not charged.",
  stt: "ElevenLabs-compatible speech to text, pay per request: an audio file (multipart file, or cloud_storage_url) in, transcript with language and word timings out (Whisper large-v3-turbo, 90+ languages). Up to 5 MB in any common format, or up to 25 MB and 60 minutes of MP3 or WAV. No account; failed calls are not charged.",
  openaiStt: "OpenAI-compatible audio transcription, pay per request: an audio file in, the transcript out as json, text, srt, vtt or verbose_json (Whisper large-v3-turbo, 90+ languages). Up to 5 MB in any common format, or up to 25 MB and 60 minutes of MP3 or WAV. No account; failed calls are not charged.",
} as const;

/** The name and tags each front's 402 quote carries in its resource (the Bazaar extension stays the tool's). */
export const VOICE_FRONT_META: Readonly<Record<keyof typeof VOICE_FRONT_DESCRIPTIONS, FrontMeta>> = Object.freeze({
  tts: { serviceName: "Text to speech, ElevenLabs-compatible API", tags: ["text-to-speech", "elevenlabs-compatible", "tts", "voice", "mp3"] },
  stt: { serviceName: "Speech to text, ElevenLabs-compatible API", tags: ["speech-to-text", "elevenlabs-compatible", "transcription", "scribe-compatible", "audio"] },
  openaiStt: { serviceName: "Audio transcription, OpenAI Whisper-compatible API", tags: ["speech-to-text", "whisper", "transcription", "openai-compatible", "subtitles"] },
});

export const ELEVEN_TTS_OPENAPI_PATH = "/v1/text-to-speech/{voice_id}";
export const ELEVEN_STT_OPENAPI_PATH = "/v1/speech-to-text";
export const OPENAI_TRANSCRIPTIONS_OPENAPI_PATH = "/v1/audio/transcriptions";

const others = { "400": { description: "Invalid request (not charged)" }, "402": { description: "Payment Required" }, "413": { description: "File too large (not charged)" }, "503": { description: "Daily AI capacity used up (not charged)" } };
const fileForm = (extra: Record<string, unknown>) => ({ "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary", description: "The audio or video file (up to 25 MB; over 5 MB: MP3 or WAV, up to 60 minutes)" }, ...extra } } } });

/** /openapi.json paths of the three voice fronts, at the prices of the tools they forward to. */
export function voiceFrontsOpenApiPaths(origin: string, prices: { speechShort: string; speechLong: string; transcribe: string; transcribeLong: string }, mpp: readonly unknown[]) {
  const ttsPay = buildPaymentInfo({ min: prices.speechShort, max: prices.speechLong }, mpp);
  const sttPay = buildPaymentInfo({ min: prices.transcribe, max: prices.transcribeLong }, mpp);
  const ttsPriced = `${prices.speechShort} for text up to 300 characters, ${prices.speechLong} up to 2,000 characters`;
  const sttPriced = `${prices.transcribe} for a file up to 5 MB, ${prices.transcribeLong} for a longer MP3 or WAV up to 25 MB and 60 minutes`;
  const audio = { description: "The speech as an MP3 file", content: { "audio/mpeg": { schema: { type: "string", format: "binary" } } } };
  const voiceParam = { name: "voice_id", in: "path", required: true, description: "An ElevenLabs premade voice ID or name (mapped to a similar Aura-2 voice; the X-Voice header names it) or an Aura-2 voice name", schema: { type: "string" }, example: "21m00Tcm4TlvDq8ikWAM" };
  const ttsTags = ["ai", "text-to-speech", "tts", "audio", "elevenlabs-compatible"];
  const sttTags = ["ai", "speech-to-text", "transcription", "audio", "elevenlabs-compatible"];
  const oaTags = ["ai", "speech-to-text", "transcription", "audio", "openai"];
  const elevenWords = { description: "Transcript with language and word timings (ElevenLabs shape)", content: { "application/json": { schema: { type: "object", properties: { language_code: { type: "string" }, language_probability: { type: "number" }, text: { type: "string" }, words: { type: "array", items: { type: "object", properties: { text: { type: "string" }, start: { type: "number" }, end: { type: "number" }, type: { type: "string" } } } } } } } } };
  const oaText = { description: "The transcript (json, text, srt, vtt or verbose_json)", content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" } } } }, "text/plain": { schema: { type: "string" } } } };
  const ttsGet = openApiGetVariant("elevenlabs_tts_get", "Text to speech, ElevenLabs-compatible API, over GET", `The same MP3 for clients that can only GET: text (up to 2,000 characters) and an optional language_code in the query. ${ttsPriced}. Failed calls are never charged.`, ttsTags, "text", { text: { type: "string", description: "Text to speak (up to 2,000 characters)" }, language_code: { type: "string", description: "en (default) or es" } }, ttsPay, { "200": audio, ...others }) as Record<string, unknown>;
  return {
    [ELEVEN_TTS_OPENAPI_PATH]: {
      get: { ...ttsGet, parameters: [voiceParam, ...((ttsGet.parameters as unknown[]) ?? [])] },
      post: {
        operationId: "elevenlabs_tts",
        summary: "Text to speech, ElevenLabs-compatible API (MP3 file, no account)",
        description: `${VOICE_FRONT_DESCRIPTIONS.tts} Same request as ElevenLabs' POST /v1/text-to-speech/{voice_id}: point an ElevenLabs SDK's base URL at ${origin} and send an adt_ prepaid key as xi-api-key, or pay per call with x402 or MPP. ${ttsPriced}. output_format must be an mp3 format.`,
        tags: ttsTags,
        "x-payment-info": ttsPay,
        parameters: [voiceParam, { name: "output_format", in: "query", required: false, description: "mp3_* only (mp3_44100_128 by default)", schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text"], properties: { text: { type: "string", description: "Text to speak (up to 2,000 characters)" }, model_id: { type: "string", description: "Accepted and ignored; the voices are Deepgram Aura-2" }, language_code: { type: "string", description: "en (default) or es" } } }, example: { text: "Your order has shipped and should reach you within three working days.", model_id: "eleven_flash_v2_5" } } } },
        responses: { "200": audio, ...others },
      },
    },
    [ELEVEN_STT_OPENAPI_PATH]: {
      get: openApiGetVariant("elevenlabs_stt_get", "Speech to text, ElevenLabs-compatible API, over GET (audio by URL)", `The same transcript for clients that can only GET: cloud_storage_url names a public audio or video file. ${sttPriced}. Failed calls are never charged.`, sttTags, "cloud_storage_url", { cloud_storage_url: { type: "string", description: "Public URL of the audio or video file" }, language_code: { type: "string", description: "Language code such as en, sv or de (detected when left out)" } }, sttPay, { "200": elevenWords, ...others }),
      post: {
        operationId: "elevenlabs_stt",
        summary: "Speech to text, ElevenLabs-compatible API (Whisper, word timings, no account)",
        description: `${VOICE_FRONT_DESCRIPTIONS.stt} Same request as ElevenLabs' POST /v1/speech-to-text (Scribe): multipart file or cloud_storage_url, optional language_code; diarize is not supported. ${sttPriced}. An adt_ prepaid key works as xi-api-key.`,
        tags: sttTags,
        "x-payment-info": sttPay,
        requestBody: { required: true, content: fileForm({ cloud_storage_url: { type: "string", description: "Public URL of the file instead of an upload" }, language_code: { type: "string" }, model_id: { type: "string", description: "Accepted and ignored" } }) },
        responses: { "200": elevenWords, ...others },
      },
    },
    [OPENAI_TRANSCRIPTIONS_OPENAPI_PATH]: {
      get: openApiGetVariant("audio_transcriptions_get", "Audio transcription, OpenAI Whisper-compatible API, over GET (audio by URL)", `The same transcript for clients that can only GET: url names a public audio or video file; response_format json, text, srt, vtt or verbose_json. ${sttPriced}. Failed calls are never charged.`, oaTags, "url", { url: { type: "string", description: "Public URL of the audio or video file" }, response_format: { type: "string", description: "json (default), text, srt, vtt or verbose_json" }, language: { type: "string", description: "Language code such as en, sv or de" } }, sttPay, { "200": oaText, ...others }),
      post: {
        operationId: "audio_transcriptions",
        summary: "Audio transcription, OpenAI Whisper-compatible API (SRT/VTT subtitles, no account)",
        description: `${VOICE_FRONT_DESCRIPTIONS.openaiStt} Same request as OpenAI's POST /v1/audio/transcriptions: point an OpenAI SDK at ${origin}/v1 with an adt_ prepaid key as apiKey, or pay per call with x402 or MPP. ${sttPriced}.`,
        tags: oaTags,
        "x-payment-info": sttPay,
        requestBody: { required: true, content: fileForm({ model: { type: "string", description: "Accepted and ignored (whisper-1 works)" }, response_format: { type: "string", description: "json (default), text, srt, vtt or verbose_json" }, language: { type: "string" } }) },
        responses: { "200": oaText, ...others },
      },
    },
  };
}
