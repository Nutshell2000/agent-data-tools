// Glyphcall Transcribe Pro (the owner, 15 Nov 2026: "Yes, build it"; plan business/voice-plan-2026-11-14/elevenlabs-scale-plan-2026-11-15.md,
// stage 1). A $9 monthly plan for people who transcribe: the existing credits plan under a voice name (lib/credits.ts
// VOICE_PRO_URL), so billing, renewals and cancelling are the plan's. This file holds what is voice-specific: the landing page
// at /transcribe-pro and the "how to use your key for transcription" part of /credits/claim when the checkout came from Voice Pro.
// Hours are always computed from the live price of /transcribe/long, never written by hand.
import { PLAN_PORTAL_URL, VOICE_HOURS_PACK_CREDITS, VOICE_HOURS_PACK_URL, VOICE_PRO_CREDITS, VOICE_PRO_URL, VOICE_TOOLS_URL } from "./credits";

export const VOICE_PRO_PATH = "/transcribe-pro";
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
/** Credits one call costs at a catalog price ("$0.05" is 50 credits). */
const creditsAt = (price: string) => Math.max(1, Math.round(Number(price.replace("$", "")) * 1000));
/** Hours of audio a month of Transcribe Pro buys through /transcribe/long (one call reads up to 60 minutes). */
export const voiceProHours = (longPrice: string) => Math.floor(VOICE_PRO_CREDITS / creditsAt(longPrice));

export interface VoicePrices { long: string; short: string; summary: string }
/**
 * The live prices of /transcribe/long, /transcribe and /transcribe/summary. src/index.ts sets them from the catalog at load
 * (`setVoicePrices`), because lib/credit-routes.ts, which renders the claim page, must not import the catalog.
 * tests/voice-pro.test.cjs checks they equal the catalog's.
 */
let current: VoicePrices = { long: "$0.05", short: "$0.01", summary: "$0.05" };
export const setVoicePrices = (p: VoicePrices) => { current = { ...p }; };
export const voicePrices = (): VoicePrices => ({ ...current });

/** The JSON a Transcribe Pro buyer gets next to the key on /credits/claim. */
export function voiceKeyJson(origin: string, key: string, prices: VoicePrices) {
  return {
    voicePro: {
      hoursEachMonth: voiceProHours(prices.long),
      browser: `Open ${VOICE_TOOLS_URL}, choose Fast mode and paste the key.`,
      transcribe: `curl -H "Authorization: Bearer ${key}" "${origin}/transcribe/long?url=<public audio URL>&subtitles=srt"`,
      openaiSdk: `OpenAI SDK: base_url="${origin}/v1", api_key="${key}", then audio.transcriptions.create(model="whisper-1", file=...)`,
    },
  };
}

/** The voice section of /credits/claim for a Transcribe Pro checkout. */
export function voiceKeyHtml(origin: string, key: string, prices: VoicePrices) {
  const hours = voiceProHours(prices.long);
  return `<h2>Use it for transcription</h2>
<p>Your plan adds ${VOICE_PRO_CREDITS.toLocaleString("en-US")} credits each month: about ${hours} hours of audio at ${esc(prices.long)} an hour.</p>
<ol><li><b>In your browser:</b> open <a href="${esc(VOICE_TOOLS_URL)}">Glyphcall Voice</a>, choose <b>Fast mode</b> and paste the key above. Your files are then transcribed on our servers in seconds, with SRT or VTT subtitles.</li>
<li><b>From code:</b> <pre>curl -H "Authorization: Bearer ${esc(key)}" "${esc(origin)}/transcribe/long?url=https://example.com/episode.mp3&amp;subtitles=srt"</pre></li>
<li><b>With the OpenAI SDK:</b> set the base URL to <code>${esc(origin)}/v1</code> and the API key to your key; <code>audio.transcriptions.create</code> works as before.</li></ol>`;
}

/** The Transcribe Pro landing page. */
export function voiceProPage(origin: string, prices: VoicePrices, brand = "Glyphcall") {
  const hours = voiceProHours(prices.long);
  const hoursPack = Math.floor(VOICE_HOURS_PACK_CREDITS / creditsAt(prices.long));
  const title = `${brand} Transcribe Pro: about ${hours} hours of transcription a month for $9`;
  const description = `Transcribe audio and video to text with SRT and VTT subtitles in 90+ languages. $9 a month adds ${VOICE_PRO_CREDITS.toLocaleString("en-US")} credits: about ${hours} hours of audio. No account, cancel any time.`;
  const faq: Array<[string, string]> = [
    ["How many hours do I get?", `About ${hours}. Each month adds ${VOICE_PRO_CREDITS.toLocaleString("en-US")} credits, and a recording of up to 60 minutes costs ${esc(prices.long)} (${creditsAt(prices.long)} credits). Short clips cost ${esc(prices.short)} each. Unused credits stay on your key.`],
    ["Which files work?", "MP3 or WAV up to 25 MB and 60 minutes in one call; OGG, M4A, MP4 and other common formats up to 5 MB. A public link to the file works too."],
    ["Which languages?", "More than 90, detected by itself or set by you (Whisper large-v3-turbo). Swedish, Norwegian, Danish, Finnish and German work as well as English."],
    ["Do I need an account?", "No. You pay with a card through Stripe and get a key. Keep the key private: anyone with it can use your credits."],
    ["Can I cancel?", "Yes, any time, in Stripe's customer portal with the e-mail you paid with. Credits already added stay."],
    ["What else can the credits pay for?", `Summaries of a recording (${esc(prices.summary)}), text to speech, and every other tool in the catalog.`],
  ];
  const ld = { "@context": "https://schema.org", "@type": "Product", name: `${brand} Transcribe Pro`, description, offers: { "@type": "Offer", price: "9.00", priceCurrency: "USD", url: VOICE_PRO_URL } };
  const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a.replace(/<[^>]+>/g, "") } })) };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(origin)}${VOICE_PRO_PATH}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script><script type="application/ld+json">${JSON.stringify(faqLd).replace(/</g, "\\u003c")}</script>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 16px;color:#1b1b1b;background:#fff}h1{font-size:1.7rem;line-height:1.25}a.buy{display:inline-block;margin:.5rem 0;padding:.7rem 1.2rem;border-radius:8px;background:#1b1b1b;color:#fff;text-decoration:none;font-weight:600}code,pre{background:#f2f2f2;padding:.1rem .3rem;border-radius:4px;overflow-wrap:anywhere}.small{color:#555;font-size:.9rem}@media (prefers-color-scheme:dark){body{background:#151515;color:#eee}a.buy{background:#eee;color:#151515}code,pre{background:#262626}.small{color:#aaa}}</style></head><body>
<h1>${esc(brand)} Transcribe Pro</h1>
<p><strong>About ${hours} hours of transcription a month for $9.</strong> Audio and video to text, with SRT and VTT subtitles and word timings, in more than 90 languages.</p>
<p><a class="buy" href="${esc(VOICE_PRO_URL)}">Get Transcribe Pro: $9 a month</a></p>
<p>Just one file? <a href="${esc(VOICE_HOURS_PACK_URL)}">${hoursPack} hours for $1</a>, paid once, no subscription.</p>
<p class="small">Card payment through Stripe. No account. Cancel any time. Failed transcriptions are never charged.</p>
<h2>What you get</h2><ul>
<li>${VOICE_PRO_CREDITS.toLocaleString("en-US")} credits added every month, kept if unused.</li>
<li>Recordings up to 60 minutes in one go, subtitles as SRT or VTT.</li>
<li>Fast mode in the free <a href="${esc(VOICE_TOOLS_URL)}">Glyphcall Voice</a> browser tools: paste your key, drop a file.</li>
<li>The same key works from code: <code>/transcribe/long</code>, and OpenAI-compatible <code>/v1/audio/transcriptions</code>.</li></ul>
<h2>Questions</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${a}</p>`).join("")}
<p class="small">Manage or cancel: <a href="${esc(PLAN_PORTAL_URL)}">customer portal</a>. Developers: <a href="/credits">all credit packs and plans</a>. <a href="/speech-to-text-api">Speech to text API</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
</body></html>`;
}
