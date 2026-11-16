// Two free keys for the voice fronts, both issued without an e-mail address and both OFF unless a wrangler var says "on":
//   POST /keys/voice-test  (VOICE_TEST_KEYS=on)  a key for a developer's first calls with an OpenAI or ElevenLabs SDK
//   POST /credits/trial    (CREDITS_TRIAL=on)    a key for the voice site's "Try Pro free on this file" button
// Why (16 Nov 2026): OpenAI retires tts-1 and whisper-1 in early 2027, and apps with an "OpenAI-compatible" speech
// setting need a new base URL. The move only happens if the first test call succeeds without a purchase.
//
// Built on what exists, with no new ledger: the key is an ordinary-looking adt_ key whose SHA-256 is kept in KV (TRIALS)
// until it expires; its calls are counted exactly in the Metrics object with the free-call counter (lib/free-calls.ts
// `takeFreeCall`, under its own caller and day names, so the ordinary free calls are untouched); a failed call is given
// back. Nothing is written to the credit ledger, so /revenue, the funnel's credits stages and the buyer counts stay
// customer-only: these keys are never revenue, customers or demand.
//
// A voice key works only through the /v1 voice fronts, because only a front has read the text or the file and knows its
// length: the front checks the limits (`admitVoiceKey`), marks the tool request it forwards (`GRANTS`), and the paywall
// (`chargeVoiceKey`, called from src/index.ts) runs the tool only for a marked request. Sent anywhere else the key is
// refused with a sentence. One exception, because the voice site's Pro mode uploads straight to the tools: a trial key
// also takes a file POSTed to /transcribe/long or /transcribe (lib/voice-fronts.ts `admitTrialUpload` measures it).
// This module must not import the catalog (lib/credit-routes.ts imports it).
//
// Worst case per UTC day, computed from Cloudflare's model prices read on 14 Nov 2026 (Aura-2 $0.030 per 1,000
// characters, Whisper large-v3-turbo $0.000513 per audio minute):
//   Test keys: at most VOICE_TEST_KEYS_PER_DAY (100) keys of VOICE_TEST_CALLS (25) calls = 2,500 calls, and the shared
//     free-call counter stops at 2,000 a day. A speech call is at most 100 characters = $0.003, and at most
//     VOICE_TEST_SPEECH_CALLS_PER_DAY (1,000) speech calls run a day = $3.00. A transcription is at most 30 seconds
//     = $0.00026; 2,000 of them = $0.52. So about $3.50 a day if every limit is reached, and $0 when unused. The
//     2,000-calls-a-day count is exact (Durable Object), so even if both KV counters were passed in a burst the day
//     costs at most 2,000 x $0.003 = $6.
//   Trial keys: at most CREDITS_TRIAL_MINUTES (200) audio minutes a day = $0.11. A file in a format whose length cannot
//     be measured first (M4A, OGG, WebM: at most 5 MB) is counted after it ran; one such file at a very low bitrate can
//     run about 90 minutes ($0.05), and it uses up the day's minutes when it is counted. So about $0.15 a day.
// The two KV counters (keys issued, speech calls, minutes) are approximate under parallel requests, as lib/daily-cap.ts
// says of its own; the per-key call count is exact.
import { Hono, type Context, type Next } from "hono";
import type { Env } from "./env";
import { VOICE_PRO_URL, hashCreditKey } from "./credits";
import { FREE_CALLS_PER_DAY, callerHash, utcDay } from "./free-calls";

type C = Context<{ Bindings: Env }>;

export const VOICE_TEST_PATH = "/keys/voice-test";
export const CREDITS_TRIAL_PATH = "/credits/trial";

/** Successful calls one test key makes, in total. */
export const VOICE_TEST_CALLS = 25;
/** The longest text a test key speaks in one call. 100 characters of Aura-2 cost $0.003. */
export const VOICE_TEST_SPEECH_CHARS = 100;
/** The longest audio a test key transcribes in one call (MP3 or WAV, measured before anything runs). */
export const VOICE_TEST_AUDIO_SECONDS = 30;
/** Test keys issued per UTC day over all callers, unless VOICE_TEST_KEYS_PER_DAY says otherwise. */
export const VOICE_TEST_KEYS_PER_DAY = 100;
/** Speech calls all test keys together make per UTC day: the cap that keeps the worst day at about $3. */
export const VOICE_TEST_SPEECH_CALLS_PER_DAY = 1000;
/** How long a test key works. */
export const VOICE_TEST_KEY_HOURS = 24;

/** The longest recording a trial key reads. */
export const TRIAL_MAX_SECONDS = 30 * 60;
/** Audio minutes all trial keys together read per UTC day, unless CREDITS_TRIAL_MINUTES says otherwise. */
export const TRIAL_MINUTES_PER_DAY = 200;
/** A trial key works this long, and never past the end of its UTC day. */
export const TRIAL_KEY_HOURS = 2;
/** Trial keys one address may ask for in a UTC day (a reloaded page asks again); still one file a day per address. */
export const TRIAL_KEYS_PER_CALLER = 5;

export type VoiceKeyKind = "test" | "trial";
const PREFIX: Record<VoiceKeyKind, string> = { test: "adt_vt_", trial: "adt_tr_" };

/** Which kind of voice key this is by its shape (46 characters after adt_, so never a purchased key, which has 43), or undefined. */
export const voiceKeyKind = (key: string): VoiceKeyKind | undefined => {
  const m = /^adt_(vt|tr)_[A-Za-z0-9_-]{43}$/.exec(key);
  return m ? (m[1] === "vt" ? "test" : "trial") : undefined;
};

type Switches = Pick<Env, "VOICE_TEST_KEYS" | "CREDITS_TRIAL" | "TRIALS" | "METRICS">;
export const voiceTestKeysOn = (env: Switches): boolean => env.VOICE_TEST_KEYS === "on" && Boolean(env.TRIALS && env.METRICS);
export const creditsTrialOn = (env: Switches): boolean => env.CREDITS_TRIAL === "on" && Boolean(env.TRIALS && env.METRICS);
const kindOn = (env: Switches, kind: VoiceKeyKind) => (kind === "test" ? voiceTestKeysOn(env) : creditsTrialOn(env));

const testKeysPerDay = (env: Env) => Math.max(0, Math.floor(Number(env.VOICE_TEST_KEYS_PER_DAY))) || VOICE_TEST_KEYS_PER_DAY;
const trialMinutesPerDay = (env: Env) => Math.max(0, Math.floor(Number(env.CREDITS_TRIAL_MINUTES))) || TRIAL_MINUTES_PER_DAY;

/** What the test key allows, in one sentence; every answer about a test key carries it. */
export const VOICE_TEST_LIMITS = `A free voice test key makes ${VOICE_TEST_CALLS} successful calls within ${VOICE_TEST_KEY_HOURS} hours on POST /v1/audio/speech (up to ${VOICE_TEST_SPEECH_CHARS} characters a call) and POST /v1/audio/transcriptions (an MP3 or WAV file of up to ${VOICE_TEST_AUDIO_SECONDS} seconds a call). One key per network address per day. Failed calls do not count.`;
/** What the trial key allows, in one sentence. */
export const TRIAL_LIMITS = `A free trial key transcribes one uploaded file a day per network address, with POST /v1/audio/transcriptions, /transcribe/long or /transcribe: an MP3 or WAV file of up to ${TRIAL_MAX_SECONDS / 60} minutes (25 MB), or another format up to 5 MB. It works for ${TRIAL_KEY_HOURS} hours. A failed call does not count.`;

/** Where a caller who wants more goes; `origin` is the API's. */
export function paidOptions(origin: string) {
  return { credits: `${origin}/credits`, transcribePro: VOICE_PRO_URL, payPerCall: "Without a key every call can be paid on its own with x402 or MPP (USDC): send the request with no key to get the quote." };
}
const paidSentence = (origin: string) => `For more, buy a prepaid key from $1 at ${origin}/credits (no account), or pay per call with x402.`;
const proSentence = (origin: string) => `For longer or more recordings, Transcribe Pro is $9 a month at ${origin}/transcribe-pro, or buy a prepaid key from $1 at ${origin}/credits.`;

interface KeyRecord { kind: VoiceKeyKind; expires: string; caller: string; day: string }
const recordKey = (keyHash: string) => `voicekey:${keyHash}`;

async function keyRecord(env: Env, key: string): Promise<(KeyRecord & { keyHash: string }) | null> {
  const kind = voiceKeyKind(key);
  if (!kind || !env.TRIALS) return null;
  const keyHash = await hashCreditKey(key);
  const record = await env.TRIALS.get(recordKey(keyHash), "json").catch(() => null) as KeyRecord | null;
  if (!record || record.kind !== kind || !(Date.parse(record.expires) > Date.now())) return null;
  return { ...record, keyHash };
}

/** Adds `amount` to a per-day KV counter unless that would pass `cap`. Approximate under parallel requests (KV). */
async function takeOfDay(kv: KVNamespace, name: string, amount: number, cap: number): Promise<boolean> {
  const key = `voicekey:${name}:${utcDay()}`;
  const used = Number(await kv.get(key)) || 0;
  if (used + amount > cap) return false;
  if (amount > 0) await kv.put(key, String(used + amount), { expirationTtl: 172_800 });
  return true;
}
async function giveBackOfDay(kv: KVNamespace, name: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const key = `voicekey:${name}:${utcDay()}`;
  const used = Number(await kv.get(key)) || 0;
  await kv.put(key, String(Math.max(0, used - amount)), { expirationTtl: 172_800 });
}

const newKey = (kind: VoiceKeyKind) => PREFIX[kind] + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** One caller per IPv4 address or per IPv6 /64 (a home or server usually holds a whole /64, so each address in it is the same caller). */
export const addressBucket = (ip: string | undefined): string => {
  const raw = (ip ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  return raw.includes(":") ? raw.split(":").slice(0, 4).join(":") : raw;
};

type Issued = { ok: true; key: string; expires: string } | { ok: false; why: "caller" | "day" };

/** Issues one key for this address, or says which limit stops it. Only a hash of the address is stored, for two days. */
async function issueVoiceKey(env: Env, kind: VoiceKeyKind, ip: string | undefined): Promise<Issued> {
  const kv = env.TRIALS!;
  const day = utcDay();
  const caller = await callerHash(addressBucket(ip));
  const perCaller = kind === "test" ? 1 : TRIAL_KEYS_PER_CALLER;
  // A trial key needs at least one of the day's minutes, so no more keys than minutes are issued.
  const perDay = kind === "test" ? testKeysPerDay(env) : trialMinutesPerDay(env);
  const callerKey = `voicekey:issued:${kind}:${day}:${caller}`;
  const mine = Number(await kv.get(callerKey)) || 0;
  if (mine >= perCaller) return { ok: false, why: "caller" };
  if (kind === "trial" && !await takeOfDay(kv, "trial-minutes", 0, trialMinutesPerDay(env) - 1)) return { ok: false, why: "day" };
  if (!await takeOfDay(kv, `issued:${kind}`, 1, perDay)) return { ok: false, why: "day" };
  await kv.put(callerKey, String(mine + 1), { expirationTtl: 172_800 });
  const endOfDay = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
  const until = kind === "test" ? Date.now() + VOICE_TEST_KEY_HOURS * 3_600_000 : Math.min(Date.now() + TRIAL_KEY_HOURS * 3_600_000, endOfDay);
  const key = newKey(kind);
  const record: KeyRecord = { kind, expires: new Date(until).toISOString(), caller, day };
  await kv.put(recordKey(await hashCreditKey(key)), JSON.stringify(record), { expirationTtl: Math.max(60, Math.ceil((until - Date.now()) / 1000)) });
  return { ok: true, key, expires: record.expires };
}

export const voiceKeys = new Hono<{ Bindings: Env }>();

const testKeyInfo = (origin: string) => ({
  limits: VOICE_TEST_LIMITS,
  calls: VOICE_TEST_CALLS, speechCharactersPerCall: VOICE_TEST_SPEECH_CHARS, audioSecondsPerCall: VOICE_TEST_AUDIO_SECONDS, audioFormats: ["mp3", "wav"], validHours: VOICE_TEST_KEY_HOURS,
  worksOn: [`POST ${origin}/v1/audio/speech`, `POST ${origin}/v1/audio/transcriptions`, `POST ${origin}/v1/text-to-speech/{voice_id}`, `POST ${origin}/v1/speech-to-text`],
  models: "Speech is Deepgram Aura-2 and transcription is Whisper large-v3-turbo, both on Cloudflare Workers AI. tts-1 and whisper-1 are accepted as model names only.",
  privacy: "We keep a one-way hash of your network address for two days, so one address gets one key a day, and a hash of the key until it expires. The address itself is not stored.",
  more: paidOptions(origin),
});

voiceKeys.get(VOICE_TEST_PATH, (c) => {
  const origin = new URL(c.req.url).origin;
  if (!voiceTestKeysOn(c.env)) return c.json({ error: `Free voice test keys are not offered right now. ${paidSentence(origin)}`, code: "not_offered", more: paidOptions(origin) }, 404);
  return c.json({ freeVoiceTestKey: true, how: `POST ${origin}${VOICE_TEST_PATH} (no body, no e-mail) answers with the key. Use it as the API key of an OpenAI SDK whose base URL is ${origin}/v1.`, ...testKeyInfo(origin) });
});

voiceKeys.post(VOICE_TEST_PATH, async (c) => {
  c.header("Cache-Control", "no-store");
  const origin = new URL(c.req.url).origin;
  if (!voiceTestKeysOn(c.env)) return c.json({ error: `Free voice test keys are not offered right now. ${paidSentence(origin)}`, code: "not_offered", more: paidOptions(origin) }, 404);
  const issued = await issueVoiceKey(c.env, "test", c.req.header("cf-connecting-ip")).catch((e: unknown) => { console.error("voice test key: not issued", e); return null; });
  if (!issued) return c.json({ error: `A test key cannot be issued right now; try again in a few minutes. ${paidSentence(origin)}`, code: "unavailable", more: paidOptions(origin) }, 503, { "Retry-After": "300" });
  if (!issued.ok) {
    const message = issued.why === "caller"
      ? `This network address already got a free voice test key today (UTC); it works for ${VOICE_TEST_KEY_HOURS} hours and ${VOICE_TEST_CALLS} calls. ${paidSentence(origin)}`
      : `Today's free voice test keys are all given out; new ones start at 00:00 UTC. ${paidSentence(origin)}`;
    return c.json({ error: message, code: issued.why === "caller" ? "one_key_per_day" : "daily_keys_used_up", ...testKeyInfo(origin) }, 429);
  }
  return c.json({
    apiKey: issued.key, expires: issued.expires,
    use: `Send it as Authorization: Bearer ${issued.key} (an OpenAI SDK: base_url ${origin}/v1, api_key the key; an ElevenLabs SDK: base URL ${origin}, the key as xi-api-key).`,
    example: `curl ${origin}/v1/audio/speech -H "Authorization: Bearer ${issued.key}" -H "Content-Type: application/json" -d '{"model":"tts-1","input":"Hello from the new endpoint.","voice":"nova"}' --output hello.mp3`,
    ...testKeyInfo(origin),
  });
});

const trialInfo = (origin: string) => ({
  limits: TRIAL_LIMITS,
  files: 1, maxMinutes: TRIAL_MAX_SECONDS / 60, validHours: TRIAL_KEY_HOURS,
  worksOn: [`POST ${origin}/v1/audio/transcriptions`, `POST ${origin}/v1/speech-to-text`, `POST ${origin}/transcribe/long`, `POST ${origin}/transcribe`],
  privacy: "We keep a one-way hash of your network address for two days, so one address gets one free file a day, and a hash of the key until it expires. The address itself is not stored.",
  more: { transcribePro: `${origin}/transcribe-pro`, buyPro: VOICE_PRO_URL, credits: `${origin}/credits` },
});

voiceKeys.post(CREDITS_TRIAL_PATH, async (c) => {
  c.header("Cache-Control", "no-store");
  const origin = new URL(c.req.url).origin;
  if (!creditsTrialOn(c.env)) return c.json({ error: `The free trial is not offered right now. ${proSentence(origin)}`, code: "not_offered", more: trialInfo(origin).more }, 404);
  const issued = await issueVoiceKey(c.env, "trial", c.req.header("cf-connecting-ip")).catch((e: unknown) => { console.error("trial key: not issued", e); return null; });
  if (!issued) return c.json({ error: `A trial key cannot be issued right now; try again in a few minutes. ${proSentence(origin)}`, code: "unavailable", more: trialInfo(origin).more }, 503, { "Retry-After": "300" });
  if (!issued.ok) {
    const message = issued.why === "caller"
      ? `This network address has asked for today's free trial ${TRIAL_KEYS_PER_CALLER} times already; it comes back at 00:00 UTC. ${proSentence(origin)}`
      : `Today's free trial minutes are used up; they come back at 00:00 UTC. ${proSentence(origin)}`;
    return c.json({ error: message, code: issued.why === "caller" ? "trial_asked_too_often" : "daily_trial_used_up", ...trialInfo(origin) }, 429);
  }
  return c.json({ apiKey: issued.key, expires: issued.expires, transcribe: `${origin}/v1/audio/transcriptions`, transcribeLong: `${origin}/transcribe/long`, use: "POST the file with Authorization: Bearer <apiKey>: to /v1/audio/transcriptions as a multipart `file` part (response_format json, text, srt, vtt or verbose_json), or to /transcribe/long as the raw body (timestamps=true and subtitles=srt or vtt in the query).", ...trialInfo(origin) });
});
voiceKeys.get(CREDITS_TRIAL_PATH, (c) => {
  const origin = new URL(c.req.url).origin;
  return creditsTrialOn(c.env)
    ? c.json({ freeTrial: true, how: `POST ${origin}${CREDITS_TRIAL_PATH} (no body) answers with a key for one file.`, ...trialInfo(origin) })
    : c.json({ error: `The free trial is not offered right now. ${proSentence(origin)}`, code: "not_offered", more: trialInfo(origin).more }, 404);
});

/** What /credits/balance answers for a voice key, or null when the key is not a live one. */
export async function voiceKeyBalance(env: Env, key: string, origin: string): Promise<Record<string, unknown> | null> {
  const record = await keyRecord(env, key);
  if (!record || !kindOn(env, record.kind)) return null;
  return record.kind === "test"
    ? { voiceTestKey: true, expires: record.expires, ...testKeyInfo(origin) }
    : { trialKey: true, expires: record.expires, ...trialInfo(origin) };
}

// ---- Using a key ---------------------------------------------------------------------------------------------------

/** What a front read from the request before forwarding it. `seconds` is null when the format cannot be measured. */
export type VoiceUse = { what: "speech"; characters: number } | { what: "audio"; upload: boolean; seconds: number | null; bytes: number };
export interface VoiceRefusal { status: 401 | 402 | 503; message: string; code: string; more: Record<string, unknown> }
interface Grant { key: string; kind: VoiceKeyKind; counter: string; speech: boolean; minutes: number | null }

const GRANTS = new WeakMap<Request, Grant>();
/** True when a front (or `admitTrialUpload`) has already admitted this request. */
export const hasVoiceGrant = (request: Request) => GRANTS.has(request);

/**
 * A front asks before it forwards: may this voice key do this? Marks `inner` (the tool request the front is about to
 * forward) when it may, so the paywall runs it; otherwise the sentence to answer with. Nothing is counted here.
 */
export async function admitVoiceKey(env: Env, key: string, use: VoiceUse, inner: Request, origin: string): Promise<VoiceRefusal | null> {
  const kind = voiceKeyKind(key)!;
  const test = kind === "test";
  const more = test ? paidOptions(origin) : trialInfo(origin).more;
  const pay = test ? paidSentence(origin) : proSentence(origin);
  const refuse = (message: string, code: string, status: 401 | 402 = 402): VoiceRefusal => ({ status, message: `${message} Nothing was charged. ${pay}`, code, more });
  const record = kindOn(env, kind) ? await keyRecord(env, key) : null;
  if (!record) return refuse(test ? `This free voice test key is not recognised or has expired (a test key works for ${VOICE_TEST_KEY_HOURS} hours).` : `This free trial key is not recognised or has expired (a trial key works for ${TRIAL_KEY_HOURS} hours).`, "invalid_api_key", 401);
  let minutes: number | null = null;
  if (test) {
    if (use.what === "speech" && use.characters > VOICE_TEST_SPEECH_CHARS) return refuse(`A free voice test key speaks up to ${VOICE_TEST_SPEECH_CHARS} characters a call; this text has ${use.characters}.`, "test_key_limit");
    if (use.what === "audio" && !use.upload) return refuse("A free voice test key transcribes an uploaded MP3 or WAV file, not a URL.", "test_key_limit");
    if (use.what === "audio" && use.seconds === null) return refuse(`A free voice test key transcribes MP3 or WAV files of up to ${VOICE_TEST_AUDIO_SECONDS} seconds, because their length can be measured before anything runs; this file is in another format.`, "test_key_limit");
    if (use.what === "audio" && use.seconds! > VOICE_TEST_AUDIO_SECONDS) return refuse(`A free voice test key transcribes up to ${VOICE_TEST_AUDIO_SECONDS} seconds of audio a call; this file is ${Math.ceil(use.seconds!)} seconds long.`, "test_key_limit");
  } else {
    if (use.what !== "audio") return refuse("A free trial key transcribes one audio file; it does not make speech.", "trial_key_limit");
    if (!use.upload) return refuse("A free trial key transcribes an uploaded file, not a URL.", "trial_key_limit");
    if (use.seconds !== null && use.seconds > TRIAL_MAX_SECONDS) return refuse(`The free trial reads recordings of up to ${TRIAL_MAX_SECONDS / 60} minutes; this one is ${Math.ceil(use.seconds / 60)} minutes long.`, "trial_key_limit");
    minutes = use.seconds === null ? null : Math.max(1, Math.ceil(use.seconds / 60));
  }
  // Test keys count per key; the trial counts per address and day, so a second key on the same day is the same one file.
  GRANTS.set(inner, { key, kind, counter: test ? `voicetest:${record.keyHash}` : `voicetrial:${record.day}:${record.caller}`, speech: use.what === "speech", minutes });
  return null;
}

/**
 * Paywall branch for a voice key (src/index.ts, before the credit ledger is asked): runs the tool only for a request a
 * front admitted, counts one call, and gives everything back when the tool fails. Answers `{ error, code, more }`, which
 * the fronts turn into their own error shape.
 */
export async function chargeVoiceKey(c: C, key: string, next: Next) {
  const origin = new URL(c.req.url).origin;
  const kind = voiceKeyKind(key)!;
  const test = kind === "test";
  const more = test ? paidOptions(origin) : trialInfo(origin).more;
  const pay = test ? paidSentence(origin) : proSentence(origin);
  const refuse = (message: string, code: string, status: 402 | 503 = 402) => c.json({ error: `${message} Nothing was charged. ${pay}`, code, more }, status, status === 503 ? { "Retry-After": "300" } : undefined);
  const grant = GRANTS.get(c.req.raw);
  if (!grant || grant.key !== key) return refuse(test ? `A free voice test key works only on POST ${origin}/v1/audio/speech and POST ${origin}/v1/audio/transcriptions, not on this path.` : `A free trial key transcribes one uploaded file with POST ${origin}/v1/audio/transcriptions, /transcribe/long or /transcribe; it does not work on this path or with a URL.`, test ? "test_key_scope" : "trial_key_scope");
  const kv = c.env.TRIALS;
  const store = c.env.METRICS?.get(c.env.METRICS.idFromName("credits"));
  if (!kv || !store || !kindOn(c.env, kind)) return refuse("This key cannot be checked right now; try again in a few minutes.", "unavailable", 503);
  const limit = test ? VOICE_TEST_CALLS : 1;
  // The free-call counter under its own names: `free:caller:<counter>` (never reset) and `free:day:<name>` (2,000 a day).
  const dayName = `${test ? "voicetest" : "voicetrial"}:${utcDay()}`;
  let left: number | null;
  try { left = await store.takeFreeCall(grant.counter, dayName, limit); } catch (e) { console.error("voice key: counter unavailable", e); return refuse("This key cannot be checked right now; try again in a few minutes.", "unavailable", 503); }
  if (left === null) {
    return refuse(test
      ? `This free voice test key has used its ${VOICE_TEST_CALLS} calls, or today's ${FREE_CALLS_PER_DAY.toLocaleString("en-US")} free test calls are used up.`
      : "Today's free trial file for this network address has been used; the next one is free after 00:00 UTC.", test ? "test_key_used_up" : "trial_used_up");
  }
  const giveCallBack = () => store.refundFreeCall(grant.counter, dayName).catch((e: unknown) => { console.error("voice key: giving a call back failed", e); });
  const dayCounter = test ? "test-speech" : "trial-minutes";
  // Speech with a test key: one of the day's speech calls. A trial file of known length: its minutes of the day's minutes.
  // A trial file whose length is not known yet needs room for one minute and is counted after it ran.
  const amount = test ? (grant.speech ? 1 : 0) : grant.minutes ?? 0;
  const cap = test ? VOICE_TEST_SPEECH_CALLS_PER_DAY : trialMinutesPerDay(c.env) - (grant.minutes === null ? 1 : 0);
  const room = test && !grant.speech ? true : await takeOfDay(kv, dayCounter, amount, cap).catch(() => false);
  if (!room) {
    await giveCallBack();
    return refuse(test ? "Today's free speech test calls are used up; they come back at 00:00 UTC. Transcription test calls still work." : "Today's free trial minutes are used up; they come back at 00:00 UTC.", test ? "daily_test_speech_used_up" : "daily_trial_used_up");
  }
  const giveBack = async () => { await giveCallBack(); await giveBackOfDay(kv, dayCounter, amount).catch(() => {}); };
  try { await next(); } catch (err) { await giveBack(); throw err; }
  const failed = c.res.status >= 400;
  if (failed) await giveBack();
  c.res.headers.set("X-Credits-Charged", "0");
  if (test) {
    c.res.headers.set("X-Test-Calls-Left", String(failed ? left + 1 : left));
    c.res.headers.set("X-Key-Limits", VOICE_TEST_LIMITS);
    return;
  }
  let minutes = grant.minutes;
  if (!failed && minutes === null) {
    // Length known only now: Whisper's own reading of the file, or a minute per 240 KB (32 kbit/s) when it gave none.
    const result = await c.res.clone().json().catch(() => null) as { durationSeconds?: unknown; bytes?: unknown } | null;
    const seconds = Number(result?.durationSeconds) > 0 ? Number(result!.durationSeconds) : Number(result?.bytes) > 0 ? Number(result!.bytes) / 4000 : 60;
    minutes = Math.max(1, Math.ceil(seconds / 60));
    await takeOfDay(kv, dayCounter, minutes, Number.MAX_SAFE_INTEGER).catch(() => {});
  }
  c.res.headers.set("X-Trial-Files-Left", failed ? "1" : "0");
  if (!failed && minutes !== null) c.res.headers.set("X-Trial-Minutes", String(minutes));
  c.res.headers.set("X-Key-Limits", TRIAL_LIMITS);
}
