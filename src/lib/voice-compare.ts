// Voice comparison pages (Glyphcall Voice, release 1.192.0, 14 Nov 2026; plan: business/voice-plan-2026-11-14/plan.md):
//   /compare/elevenlabs-alternative   text to speech and speech to text against ElevenLabs' own API price list
//   /compare/whisper-api-alternative  speech to text against OpenAI, Deepgram, AssemblyAI and ElevenLabs
//
// Rules (the same as compare-pages.ts):
// - Every rival figure is copied from the rival's own pricing page on VOICE_CHECKED, with the page linked. Groq's page
//   showed no figure that day, so Groq is not listed. When a page changes, change the row and the date, or drop it.
// - Say where a rival is better. On text to speech OpenAI's tts-1 costs less per character than our cheapest voice,
//   and ElevenLabs has far more voices and languages: the pages say so.
// - Our own prices come from the catalog, never typed.
import { ENDPOINTS, SERVICE_NAME } from "../endpoints";
import { COMPANY_FOOTER } from "./legal";
import { publicBrand } from "./public-brand";
import type { Env } from "./env";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export const VOICE_CHECKED = "14 November 2026";
export const VOICE_BRAND = "Glyphcall Voice";
const FREE_TOOLS = "https://glyphcall-voice.pages.dev";

export interface SttRival { name: string; source: string; model: string; perHourUsd: number; price: string; start: string; account: string }
export interface TtsRival { name: string; source: string; model: string; per1kUsd: number; price: string }

/** Speech to text, pre-recorded audio, pay as you go: each rival's own pricing page on VOICE_CHECKED. */
export const STT_RIVALS: readonly SttRival[] = [
  { name: "ElevenLabs", source: "https://elevenlabs.io/pricing/api", model: "Scribe v2 / v3", perHourUsd: 0.2, price: "$0.20 per hour", start: "Sign-up; no free allowance stated on the API price page", account: "Account" },
  { name: "OpenAI", source: "https://developers.openai.com/api/docs/pricing", model: "Whisper", perHourUsd: 0.36, price: "$0.006 per minute", start: "No free API credit stated", account: "Account and API key" },
  { name: "OpenAI", source: "https://developers.openai.com/api/docs/pricing", model: "gpt-4o-mini-transcribe", perHourUsd: 0.18, price: "$0.003 per minute", start: "No free API credit stated", account: "Account and API key" },
  { name: "Deepgram", source: "https://deepgram.com/pricing", model: "Nova-3 (one language)", perHourUsd: 0.258, price: "$0.0043 per minute", start: "$200 free credit, no card", account: "Account" },
  { name: "AssemblyAI", source: "https://www.assemblyai.com/pricing", model: "Universal-2", perHourUsd: 0.15, price: "$0.15 per hour", start: "$50 free credit, no card", account: "Account" },
  { name: "AssemblyAI", source: "https://www.assemblyai.com/pricing", model: "Universal-3.5 Pro", perHourUsd: 0.21, price: "$0.21 per hour", start: "$50 free credit, no card", account: "Account" },
];

/** Text to speech per 1,000 characters: each rival's own pricing page on VOICE_CHECKED. */
export const TTS_RIVALS: readonly TtsRival[] = [
  { name: "ElevenLabs", source: "https://elevenlabs.io/pricing/api", model: "Flash / Turbo", per1kUsd: 0.04, price: "$0.04 per 1,000 characters" },
  { name: "ElevenLabs", source: "https://elevenlabs.io/pricing/api", model: "Multilingual v2, v3", per1kUsd: 0.08, price: "$0.08 per 1,000 characters" },
  { name: "OpenAI", source: "https://developers.openai.com/api/docs/pricing", model: "tts-1", per1kUsd: 0.015, price: "$15 per million characters" },
  { name: "OpenAI", source: "https://developers.openai.com/api/docs/pricing", model: "tts-1-hd", per1kUsd: 0.03, price: "$30 per million characters" },
  { name: "Deepgram", source: "https://deepgram.com/pricing", model: "Aura-2", per1kUsd: 0.03, price: "$0.030 per 1,000 characters" },
];

const priceOf = (path: string, fallback: string) => ENDPOINTS.find((e) => e.path === path)?.price ?? fallback;
const usd = (price: string) => Number(price.replace(/[^0-9.]/g, ""));
const money = (n: number) => `$${(Math.round(n * 1000) / 1000).toString()}`;

/** Our side, from the catalog. */
export function ourVoice() {
  const short = priceOf("/transcribe", "$0.01");
  const long = priceOf("/transcribe/long", "$0.05");
  const summary = priceOf("/transcribe/summary", "$0.05");
  const tts = priceOf("/text-to-speech", "$0.08");
  const lite = priceOf("/text-to-speech/lite", "$0.04");
  return {
    short, long, summary, tts, lite,
    longPerHour: usd(long), // one file of up to 60 minutes
    tts1k: usd(tts) / 2, // 2,000 characters a call
    lite1k: usd(lite) / 2,
  };
}

export const VOICE_COMPARE = [
  { slug: "elevenlabs-alternative", name: "ElevenLabs" },
  { slug: "whisper-api-alternative", name: "Whisper API" },
] as const;
export const voiceComparePaths = () => VOICE_COMPARE.map((p) => `/compare/${p.slug}`);

const STYLE = `:root{--bg:#fff;--fg:#16181d;--muted:#5b616b;--card:#f5f6f8;--line:#e2e5ea;--accent:#0b57d0;--accent-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e9ebee;--muted:#a2a8b0;--card:#1a1d22;--line:#2b3037;--accent:#8ab4f8;--accent-fg:#0b1a33}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 16px 56px}nav.crumbs{color:var(--muted);font-size:.9rem;margin-bottom:18px}
h1{font-size:2rem;line-height:1.15;margin:0 0 10px;letter-spacing:-.01em}.tag{font-size:1.1rem;color:var(--muted);margin:0 0 18px}
h2{font-size:1.25rem;margin:36px 0 10px}h3{font-size:1.05rem;margin:22px 0 4px}p{margin:8px 0}a{color:var(--accent)}ul{padding-left:22px}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 6px}.btn{display:inline-block;padding:11px 18px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.small{color:var(--muted);font-size:.9rem}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.93rem}
td,th{border-bottom:1px solid var(--line);padding:9px 8px;text-align:left;vertical-align:top}th{white-space:nowrap}tr.us td{background:var(--card);font-weight:600}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:.85rem}
footer{margin-top:40px;color:var(--muted);font-size:.9rem}`;

function shell(o: { title: string; description: string; url: string; brand: string; body: string; ld: unknown[] }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.url)}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(o.url)}">
<link rel="icon" href="/favicon.ico">
${o.ld.map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`).join("\n")}
<style>${STYLE}</style></head><body><main>
${o.body}
<footer><a href="/speech-to-text-api">Speech to text API</a> · <a href="/text-to-speech-api">Text to speech API</a> · ${VOICE_COMPARE.map((p) => `<a href="/compare/${p.slug}">${esc(p.name)} alternative</a>`).join(" · ")} · <a href="${FREE_TOOLS}">Free browser tools</a> · ${COMPANY_FOOTER}<br>Prices of other services were copied from each one's own pricing page on ${VOICE_CHECKED} and change over time; follow the links for today's figures. Product names are trademarks of their owners; ${esc(o.brand)} is not affiliated with them.</footer>
</main></body></html>`;
}

const actions = () => `<div class="actions">
<a class="btn primary" href="/speech-to-text-api">Speech to text API</a>
<a class="btn" href="/text-to-speech-api">Text to speech API</a>
<a class="btn" href="${FREE_TOOLS}">Try it free in your browser</a>
</div>`;

const faqLd = (faq: [string, string][]) => ({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
const sources = (rows: readonly { name: string; source: string }[]) => [...new Map(rows.map((r) => [r.name, r.source])).entries()].map(([n, s]) => `<a href="${esc(s)}" rel="nofollow noopener">${esc(n)}</a>`).join(" · ");

/** Every speech-to-text row, ours included, cheapest per hour first. */
export function sttTable(us = ourVoice()) {
  const rows = [...STT_RIVALS].sort((a, b) => a.perHourUsd - b.perHourUsd);
  return `<div class="wrap"><table><tr><th>Service</th><th>Model</th><th>Price as listed</th><th>One hour of audio</th><th>To start</th></tr>
<tr class="us"><td>${esc(VOICE_BRAND)}</td><td>Whisper large-v3-turbo</td><td>${esc(us.long)} per file up to 60 minutes; ${esc(us.short)} per file up to 5 MB</td><td>${esc(money(us.longPerHour))}</td><td>No account: card credits from $1, or an agent pays per call in USDC</td></tr>
${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.model)}</td><td>${esc(r.price)}</td><td>${esc(money(r.perHourUsd))}</td><td>${esc(r.account)}; ${esc(r.start)}</td></tr>`).join("\n")}
</table></div>`;
}

export function elevenLabsPage(origin: string, brand: string): string {
  const us = ourVoice();
  const scribe = STT_RIVALS.find((r) => r.name === "ElevenLabs")!;
  const flash = TTS_RIVALS.find((r) => r.name === "ElevenLabs" && r.per1kUsd === 0.04)!;
  const times = Math.round(scribe.perHourUsd / us.longPerHour);
  const url = `${origin}/compare/elevenlabs-alternative`;
  const title = `ElevenLabs alternative: speech to text at ${money(us.longPerHour)} an hour, no account · ${VOICE_BRAND}`;
  const description = `ElevenLabs Scribe is ${scribe.price}; ${VOICE_BRAND} transcribes an hour for ${us.long}, with subtitles, and keeps ElevenLabs' API shape. Text to speech from ${money(us.lite1k)} per 1,000 characters. Prices checked ${VOICE_CHECKED}.`.slice(0, 300);
  const rows: [string, string, string][] = [
    ["Speech to text, one hour", `${scribe.price} (Scribe v2/v3)`, `${us.long} per file up to 60 minutes (${times}x less)`],
    ["Meeting summary with action items", "Not on its API price page", `${us.summary} per recording: transcript, summary, key points, action items`],
    ["Text to speech, per 1,000 characters", `${flash.price} (Flash/Turbo); $0.08 (Multilingual v2, v3)`, `${money(us.lite1k)} (Aura-1, English) or ${money(us.tts1k)} (Aura-2, English and Spanish)`],
    ["Account before the first call", "Yes", "No: card credits from $1 give a key, or an agent pays per call in USDC (x402, MPP)"],
    ["Same API shape", "Its own", "POST /v1/text-to-speech/{voice_id} and /v1/speech-to-text in ElevenLabs' shape; the xi-api-key header works"],
    ["Subtitles", "Scribe returns timestamps", "SRT or VTT in the answer (subtitles=srt)"],
  ];
  const faq: [string, string][] = [
    [`Is ${VOICE_BRAND} cheaper than ElevenLabs?`, `For speech to text, yes: an hour of audio is ${us.long} in one call against Scribe's ${scribe.price}. For text to speech, our Aura-1 voice is half of Flash per character and Aura-2 equals Flash; ElevenLabs' Multilingual voices cost twice Flash.`],
    ["Can I keep my ElevenLabs code?", "Yes. Change the base URL: POST /v1/text-to-speech/{voice_id} and POST /v1/speech-to-text take ElevenLabs' requests, and the xi-api-key header carries your key. Voice IDs map to our voices; there is no cloning."],
    ["Where is ElevenLabs better?", "Voice quality, a large voice library, voice cloning, 70+ speech languages, dubbing, realtime voice agents and enterprise contracts. Choose ElevenLabs for those."],
    ["Are my files stored?", "No. Audio sent in a request is held in memory for that request only. It is not stored, cached or logged."],
  ];
  const body = `<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="/compare">Comparisons</a></nav>
<h1>ElevenLabs alternative for speech to text and text to speech</h1>
<p class="tag">An hour of transcription for ${esc(us.long)}, subtitles included, in ElevenLabs' own API shape. No account, no plan, failed calls free.</p>
${actions()}
<h2>ElevenLabs and ${esc(VOICE_BRAND)} side by side</h2>
<div class="wrap"><table><tr><th></th><th>ElevenLabs</th><th>${esc(VOICE_BRAND)}</th></tr>
${rows.map(([k, a, b]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("\n")}
</table></div>
<p class="small">ElevenLabs figures from <a href="${esc(scribe.source)}" rel="nofollow noopener">its API pricing page</a>, read on ${VOICE_CHECKED}.</p>
<h2>When ElevenLabs is the better choice</h2>
<ul><li>The most natural voices, a large voice library and voice cloning</li><li>Speech in 70+ languages (ours: English, and Spanish on Aura-2)</li><li>Dubbing, music and realtime voice agents</li><li>Speaker labels (diarization) in transcripts</li></ul>
<h2>Switch with one line</h2>
<pre><code>${esc(`curl -X POST "${origin}/v1/speech-to-text" \\\n  -H "xi-api-key: $API_KEY" \\\n  -F "file=@meeting.mp3" -F "model_id=scribe_v1"`)}</code></pre>
<p>Text to speech: <code>POST ${esc(origin)}/v1/text-to-speech/{voice_id}</code> with <code>{"text": "…"}</code> returns MP3 bytes, as ElevenLabs does.</p>
<h2>Speech to text prices across services</h2>
${sttTable(us)}
<p class="small">Sources: ${sources(STT_RIVALS)}. More in <a href="/compare/whisper-api-alternative">the speech to text comparison</a>.</p>
<h2>Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}`;
  return shell({ title, description, url, brand: VOICE_BRAND, body, ld: [faqLd(faq)] });
}

export function whisperPage(origin: string, brand: string): string {
  const us = ourVoice();
  const cheapest = [...STT_RIVALS].sort((a, b) => a.perHourUsd - b.perHourUsd)[0];
  const url = `${origin}/compare/whisper-api-alternative`;
  const title = `Whisper API alternative: an hour of audio for ${us.long}, subtitles included · ${VOICE_BRAND}`;
  const description = `Speech to text prices compared from each pricing page on ${VOICE_CHECKED}: OpenAI Whisper $0.006 a minute, Deepgram, AssemblyAI, ElevenLabs Scribe. ${VOICE_BRAND}: ${us.long} for up to 60 minutes, no account.`.slice(0, 300);
  const faq: [string, string][] = [
    ["Is it the same Whisper model?", "It runs Whisper large-v3-turbo, the open model OpenAI released, on Cloudflare's network. OpenAI's own API lists Whisper and its newer gpt-4o transcribe models."],
    ["Can I keep my OpenAI code?", "Yes. POST /v1/audio/transcriptions takes OpenAI's request (file, language, response_format json, text, srt, vtt or verbose_json). Set the client's base URL here and use your key as the API key."],
    ["How is a long file priced?", `One call reads up to 60 minutes of MP3 or WAV (25 MB) for ${us.long}. A short clip in any format up to 5 MB is ${us.short}. Per-minute services cost less than us only for clips of a few minutes.`],
    ["Where are the others better?", "Speaker labels (diarization), live streaming transcription, and models tuned for accents and noise. Deepgram, AssemblyAI and ElevenLabs offer those; we do not yet."],
  ];
  const body = `<nav class="crumbs"><a href="/">${esc(brand)}</a> › <a href="/compare">Comparisons</a></nav>
<h1>Whisper API alternative: speech to text prices compared</h1>
<p class="tag">What one hour of pre-recorded audio costs at ${new Set(STT_RIVALS.map((r) => r.name)).size} speech to text APIs, read from each pricing page on ${VOICE_CHECKED}, next to ${esc(VOICE_BRAND)} at ${esc(us.long)} for up to 60 minutes.</p>
${actions()}
${sttTable(us)}
<p class="small">Sources: ${sources(STT_RIVALS)}. Groq's pricing page showed no figure that day and is not listed. The cheapest listed rival per hour is ${esc(cheapest.name)} ${esc(cheapest.model)} at ${esc(money(cheapest.perHourUsd))}.</p>
<h2>What you get</h2>
<ul>
<li>${esc(us.long)} for up to 60 minutes of MP3 or WAV (25 MB) by URL or upload; ${esc(us.short)} for any short file up to 5 MB.</li>
<li>SRT or VTT subtitles and word timestamps in the same answer.</li>
<li>${esc(us.summary)} for a summary with key points and action items on top of the transcript.</li>
<li>90+ languages. No account: card credits from $1, or an agent pays per call in USDC.</li>
<li>Failed calls are never charged. Audio is held in memory for the request only, never stored or logged.</li>
<li>Free and private: <a href="${FREE_TOOLS}/transcribe">transcribe in your browser</a>, the file never leaves your device.</li>
</ul>
<h2>One request</h2>
<pre><code>${esc(`curl "${origin}/v1/audio/transcriptions" \\\n  -H "Authorization: Bearer $API_KEY" \\\n  -F file=@podcast.mp3 -F model=whisper-1 -F response_format=srt`)}</code></pre>
<h2>Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}
<h2>Text to speech prices</h2>
<div class="wrap"><table><tr><th>Service</th><th>Model</th><th>Per 1,000 characters</th></tr>
<tr class="us"><td>${esc(VOICE_BRAND)}</td><td>Aura-1 / Aura-2</td><td>${esc(money(us.lite1k))} / ${esc(money(us.tts1k))}</td></tr>
${[...TTS_RIVALS].sort((a, b) => a.per1kUsd - b.per1kUsd).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.model)}</td><td>${esc(money(r.per1kUsd))}</td></tr>`).join("\n")}
</table></div>
<p class="small">OpenAI's tts-1 costs less per character than our voices. Sources: ${sources(TTS_RIVALS)}.</p>`;
  return shell({ title, description, url, brand: VOICE_BRAND, body, ld: [faqLd(faq)] });
}

/** The HTML for a voice comparison slug, or undefined. */
export function voiceCompareHtml(env: Env, origin: string, slug: string): string | undefined {
  const brand = publicBrand(env, SERVICE_NAME);
  if (slug === "elevenlabs-alternative") return elevenLabsPage(origin, brand);
  if (slug === "whisper-api-alternative") return whisperPage(origin, brand);
  return undefined;
}
