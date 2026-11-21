// The ElevenLabs "account surface" (17 Nov 2026, owner: "OUR API WILL BE THE BEST EVER"). Apps written for ElevenLabs
// (their Python and JS SDKs, Home Assistant's elevenlabs integration, SillyTavern, n8n, Make) read these on setup,
// before they ever speak: the voice picker, the model picker and the key check. Without them, pointing such an app's
// base URL here failed at setup even though POST /v1/text-to-speech/{voice_id} works. All of them are free to read.
//   GET /v1/voices, /v2/voices          our Aura-2 voices in ElevenLabs' voice shape (voice_id = our voice name)
//   GET /v1/voices/{voice_id}           one voice; ElevenLabs premade IDs answer with the voice they map to
//   GET /v1/models (xi-api-key sent)    ElevenLabs' model-list shape; without that header /v1/models stays OpenAI's
//   GET /v1/user, /v1/user/subscription the key check: a prepaid key's balance as characters it still buys
// Every entry names our own voices and models; nothing imitates ElevenLabs' voices or claims to be ElevenLabs.
import type { Context } from "hono";
import type { Env } from "./env";
import { SPEECH_VOICES } from "../routes/ai-text";
import { elevenVoice } from "./voice-fronts";
import { SPEECH_INPUT_LIMIT, withXiKey } from "./openai-speech";
import { SPEECH_CREDITS_PER_100 } from "./voice-billing";
import { VOICE_TEST_CALLS, VOICE_TEST_SPEECH_CHARS } from "./voice-keys";
import { apiKeyFrom } from "./credits";
import { forwardedHeaders } from "./paying-request";

type C = Context<{ Bindings: Env }>;
type Forward = (request: Request) => Response | Promise<Response>;

export const ELEVEN_VOICES_PATHS = ["/v1/voices", "/v2/voices"] as const;
export const ELEVEN_VOICE_PATH = "/v1/voices/:voice_id";
export const ELEVEN_USER_PATH = "/v1/user";
export const ELEVEN_SUBSCRIPTION_PATH = "/v1/user/subscription";

/** Aura-2 voice genders as Deepgram's voice list gives them. A voice not named here is listed without a gender label. */
const FEMININE = new Set(["amalthea", "andromeda", "asteria", "athena", "aurora", "callista", "cora", "cordelia", "delia", "electra", "harmonia", "helena", "hera", "iris", "juno", "luna", "minerva", "ophelia", "pandora", "phoebe", "thalia", "theia", "vesta", "carina", "celeste", "diana", "selena", "estrella"]);
const MASCULINE = new Set(["apollo", "arcas", "aries", "atlas", "draco", "hermes", "hyperion", "janus", "jupiter", "mars", "neptune", "odysseus", "orion", "orpheus", "pluto", "saturn", "zeus", "sirio", "nestor", "alvaro", "aquila", "javier"]);
const DEFAULT_VOICE = "luna";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const HEADERS = { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" };

export interface ElevenVoice {
  voice_id: string; name: string; category: "premade"; description: string;
  labels: Record<string, string>; preview_url: null; available_for_tiers: string[];
  settings: null; high_quality_base_model_ids: string[]; verified_languages: { language: string; model_id: string }[];
}

const LANG_NAME = { en: "english", es: "spanish" } as const;
const MODEL_ID = { en: "glyphcall_aura_2", es: "glyphcall_aura_2" } as const;

function voiceObject(name: string, lang: "en" | "es"): ElevenVoice {
  const gender = FEMININE.has(name) ? "female" : MASCULINE.has(name) ? "male" : "";
  return {
    voice_id: name,
    name: cap(name) + (name === DEFAULT_VOICE ? " (default)" : ""),
    category: "premade",
    description: `${cap(name)}, a natural ${LANG_NAME[lang] === "english" ? "English" : "Spanish"} voice (Aura-2).${lang === "es" ? " Send language_code es with it." : ""}`,
    labels: { ...(gender ? { gender } : {}), language: lang, use_case: "general" },
    preview_url: null,
    available_for_tiers: [],
    settings: null,
    high_quality_base_model_ids: [MODEL_ID[lang]],
    verified_languages: [{ language: lang, model_id: MODEL_ID[lang] }],
  };
}

/** Every voice POST /v1/text-to-speech/{voice_id} speaks, English first with the default voice at the top. */
export function elevenVoiceList(): ElevenVoice[] {
  const en = [DEFAULT_VOICE, ...SPEECH_VOICES.en.filter((v) => v !== DEFAULT_VOICE)];
  return [...en.map((v) => voiceObject(v, "en")), ...SPEECH_VOICES.es.map((v) => voiceObject(v, "es"))];
}

/** One voice by our name, or by an ElevenLabs premade ID or name (answered with the voice it maps to). */
export function elevenVoiceById(id: string): ElevenVoice | undefined {
  const lower = id.trim().toLowerCase();
  if ((SPEECH_VOICES.es as readonly string[]).includes(lower)) return voiceObject(lower, "es");
  const mapped = elevenVoice(id);
  if (mapped && (SPEECH_VOICES.en as readonly string[]).includes(mapped)) return voiceObject(mapped, "en");
  return undefined;
}

/** ElevenLabs' model-list shape: the one speech model behind the endpoint. Any model_id is accepted on requests. */
export function elevenModels() {
  return [{
    model_id: MODEL_ID.en,
    name: "Glyphcall Aura-2",
    description: "Natural English and Spanish voices (Deepgram Aura-2). Requests may send any model_id; this model speaks them.",
    can_be_finetuned: false, can_do_text_to_speech: true, can_do_voice_conversion: false, can_use_style: false,
    can_use_speaker_boost: false, serves_pro_voices: false, requires_alpha_access: false,
    token_cost_factor: 1,
    max_characters_request_free_user: SPEECH_INPUT_LIMIT,
    max_characters_request_subscribed_user: SPEECH_INPUT_LIMIT,
    maximum_text_length_per_request: SPEECH_INPUT_LIMIT,
    languages: [{ language_id: "en", name: "English" }, { language_id: "es", name: "Spanish" }],
  }];
}

/** True when the request comes from an ElevenLabs client (it sends xi-api-key), so /v1/models answers in their shape. */
export const wantsElevenShape = (header: (name: string) => string | undefined) => Boolean(header("xi-api-key"));

const unauthorized = (c: C, message: string) => c.json({ detail: { status: "invalid_api_key", message } }, 401, { "Access-Control-Allow-Origin": "*" });

/**
 * The subscription object ElevenLabs clients read to check a key. A prepaid key's balance is shown as the characters
 * it still buys at the per-character key rate (SPEECH_CREDITS_PER_100 credits per 100 characters): there is no monthly
 * reset and nothing tops up by itself, so `next_character_count_reset_unix` is null and `can_extend_character_limit` is
 * false. The balance comes from GET /credits/balance with the same key, so free test and trial keys answer too.
 */
export async function elevenSubscription(c: C, forward: Forward): Promise<{ sub: Record<string, unknown> } | Response> {
  const headers = withXiKey(forwardedHeaders(c.req.raw));
  const key = apiKeyFrom((n) => headers.get(n) ?? undefined);
  const origin = new URL(c.req.url).origin;
  if (!key) return unauthorized(c, `Send a Glyphcall key as xi-api-key (get one at ${origin}/credits; a free voice test key may be available at ${origin}/keys/voice-test).`);
  const inner = new Headers({ "x-api-key": key, accept: "application/json" });
  const answer = await forward(new Request(`${origin}/credits/balance`, { headers: inner }));
  const body = (await answer.json().catch(() => null)) as Record<string, unknown> | null;
  if (answer.status === 401 || answer.status === 403) return unauthorized(c, `This key is not a Glyphcall key (or it was replaced). Keys start with adt_; get one at ${origin}/credits.`);
  if (!answer.ok || !body) return c.json({ detail: { status: "service_unavailable", message: "The key's balance cannot be read right now; try again shortly. Speech requests still work." } }, 503);
  const credits = typeof body.balanceCredits === "number" ? body.balanceCredits : null;
  const remaining = credits === null ? null : Math.floor((credits / SPEECH_CREDITS_PER_100) * 100);
  // A free test key has no credit balance, but apps (Home Assistant, SillyTavern, n8n) read this on setup and refuse
  // to enable speech when character_limit is 0. Report its real free allowance so the first call is ever attempted.
  const freeCharacters = VOICE_TEST_CALLS * VOICE_TEST_SPEECH_CHARS;
  const sub = {
    tier: credits === null ? "free_test" : "pay_as_you_go",
    character_count: 0,
    character_limit: remaining ?? freeCharacters,
    can_extend_character_limit: false,
    allowed_to_extend_character_limit: false,
    next_character_count_reset_unix: null,
    voice_limit: 0,
    professional_voice_limit: 0,
    can_use_instant_voice_cloning: false,
    can_use_professional_voice_cloning: false,
    currency: "usd",
    status: "active",
    billing_period: "prepaid",
    glyphcall: {
      note: credits === null
        ? `Free voice test key: ${VOICE_TEST_CALLS} successful calls, up to ${VOICE_TEST_SPEECH_CHARS} characters each, for 24 hours. character_limit is that allowance; get a prepaid key at ${origin}/credits for more.`
        : "Prepaid credits: no monthly reset, no automatic top-ups, unused credits never expire. character_limit is what the key's balance buys at the key rate.",
      balance: credits === null ? body : { credits },
      topUp: `${origin}/credits`,
    },
  };
  return { sub };
}

/** GET /v1/user/subscription */
export async function elevenSubscriptionRoute(c: C, forward: Forward): Promise<Response> {
  const r = await elevenSubscription(c, forward);
  return r instanceof Response ? r : c.json(r.sub, 200, { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
}

/** GET /v1/user */
export async function elevenUserRoute(c: C, forward: Forward): Promise<Response> {
  const r = await elevenSubscription(c, forward);
  if (r instanceof Response) return r;
  return c.json({ subscription: r.sub, is_new_user: false, can_use_delayed_payment_methods: false, is_onboarding_completed: true, first_name: null }, 200, { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
}

/** GET /v1/voices and /v2/voices (v2 adds paging fields; every voice fits on one page). */
export function elevenVoicesRoute(c: C): Response {
  const voices = elevenVoiceList();
  const v2 = c.req.path.startsWith("/v2/");
  return c.json(v2 ? { voices, has_more: false, total_count: voices.length, next_page_token: null } : { voices }, 200, HEADERS);
}

/** GET /v1/voices/{voice_id} */
export function elevenVoiceRoute(c: C): Response {
  const v = elevenVoiceById(c.req.param("voice_id") ?? "");
  if (!v) return c.json({ detail: { status: "voice_not_found", message: `Unknown voice_id. GET /v1/voices lists every voice; ElevenLabs premade voice IDs also work and map to a similar voice.` } }, 404, { "Access-Control-Allow-Origin": "*" });
  return c.json(v, 200, HEADERS);
}

export { HEADERS as ELEVEN_LIST_HEADERS };
