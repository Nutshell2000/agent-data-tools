// Glyphcall Transcribe Pro: a monthly plan for people who transcribe. It is the entry credits plan under a voice name
// (lib/credits.ts VOICE_PRO_URL, VOICE_PRO_CENTS, VOICE_PRO_CREDITS), so billing, renewals and cancelling are the plan's. This file holds what is voice-specific: the landing page
// at /transcribe-pro and the "how to use your key for transcription" part of /credits/claim when the checkout came from Voice Pro.
// Hours are always computed from the live price of /transcribe/long, never written by hand.
import { PLAN_PORTAL_URL, VOICE_BUNDLE_PLAN, VOICE_HOURS_PACK_CREDITS, VOICE_HOURS_PACK_URL, VOICE_PRO_CENTS, VOICE_PRO_CREDITS, VOICE_PRO_URL, VOICE_STUDIO_PLAN, VOICE_TOOLS_URL, WEB_PLANS, speechCharacters } from "./credits";
import { LOGO, OFFER_CSS, STYLE } from "./site-style";
import { CONSOLE_LANGUAGES, CONSOLE_VOICES, STUDIO_SITE, VOICE_SITE } from "./voice-console";

export const VOICE_PRO_PATH = "/transcribe-pro";
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
/** Credits one call costs at a catalog price ("$0.05" is 50 credits). */
const creditsAt = (price: string) => Math.max(1, Math.round(Number(price.replace("$", "")) * 1000));
/** Hours of audio a month of Transcribe Pro buys through /transcribe/long (one call reads up to 60 minutes). */
export const voiceProHours = (longPrice: string, credits: number = VOICE_PRO_CREDITS) => Math.floor(credits / creditsAt(longPrice));

export interface VoicePrices { long: string; short: string; summary: string }
/**
 * The live prices of /transcribe/long, /transcribe and /transcribe/summary. src/index.ts sets them from the catalog at load
 * (`setVoicePrices`), because lib/credit-routes.ts, which renders the claim page, must not import the catalog.
 * tests/voice-pro.test.cjs checks they equal the catalog's.
 */
let current: VoicePrices = { long: "$0.05", short: "$0.01", summary: "$0.05" };
export const setVoicePrices = (p: VoicePrices) => { current = { ...p }; };
export const voicePrices = (): VoicePrices => ({ ...current });

/**
 * The JSON a Transcribe Pro buyer gets next to the key on /credits/claim. `credits` is what the checkout granted, so a
 * plan bought through an older link is told its own hours, not today's.
 */
export function voiceKeyJson(origin: string, key: string, prices: VoicePrices, credits: number = VOICE_PRO_CREDITS) {
  return {
    voicePro: {
      hoursEachMonth: voiceProHours(prices.long, credits),
      browser: `Open ${VOICE_TOOLS_URL}, paste the key under "Already have an access key?" in the Pro section, then use "Transcribe with Pro".`,
      transcribe: `curl -H "Authorization: Bearer ${key}" "${origin}/transcribe/long?url=<public audio URL>&subtitles=srt"`,
      openaiSdk: `OpenAI SDK: base_url="${origin}/v1", api_key="${key}", then audio.transcriptions.create(model="whisper-1", file=...)`,
    },
  };
}

/**
 * The name of the voice plan a checkout of this monthly amount bought. Voice Pro and the bundle return to the claim page
 * with for=voice like Transcribe Pro does, and the buyer must read the name of what they paid for.
 */
export function voicePlanName(usdCents: number): string {
  if (usdCents === VOICE_STUDIO_PLAN.usdCents) return "Voice Pro";
  if (usdCents === VOICE_BUNDLE_PLAN.usdCents) return "Voice and Transcribe Pro";
  return "Transcribe Pro";
}

/** What a month's credits buy, said for the plan that was bought. One balance pays for both, so it is "or", never "and". */
export function voiceAllowance(usdCents: number, credits: number, prices: VoicePrices): string {
  const hours = voiceProHours(prices.long, credits);
  const characters = speechCharacters(credits).toLocaleString("en-US");
  if (usdCents === VOICE_STUDIO_PLAN.usdCents) return `about ${characters} characters of studio voices`;
  if (usdCents === VOICE_BUNDLE_PLAN.usdCents) return `about ${characters} characters of studio voices, or about ${hours} hours of audio at ${prices.long} an hour, or any mix of the two`;
  return `about ${hours} hours of audio at ${prices.long} an hour`;
}

/** The voice section of /credits/claim for a voice plan checkout (`usdCents` is the monthly amount that was paid). */
export function voiceKeyHtml(origin: string, key: string, prices: VoicePrices, credits: number = VOICE_PRO_CREDITS, usdCents: number = VOICE_PRO_CENTS) {
  const speech = usdCents === VOICE_STUDIO_PLAN.usdCents || usdCents === VOICE_BUNDLE_PLAN.usdCents;
  return `<h2>Use it for ${usdCents === VOICE_STUDIO_PLAN.usdCents ? "studio voices" : speech ? "voices and transcription" : "transcription"}</h2>
<p>Your plan adds ${credits.toLocaleString("en-US")} credits each month: ${esc(voiceAllowance(usdCents, credits, prices))}.</p>${speech ? `
<p><b>Studio voices:</b> open <a href="${esc(origin)}/#try">the voice console</a>, paste the key above under the studio voices and press Play. From code: <code>POST ${esc(origin)}/v1/audio/speech</code> with the key as the Bearer token.</p>` : ""}
<ol><li><b>In your browser:</b> open <a href="${esc(VOICE_TOOLS_URL)}">Glyphcall Voice Transcribe</a>, paste the key above under <b>Already have an access key?</b> in the Pro section, then press <b>Transcribe with Pro</b>. Your files are then transcribed on our servers, with SRT or VTT subtitles.</li>
<li><b>From code:</b> <pre>curl -H "Authorization: Bearer ${esc(key)}" "${esc(origin)}/transcribe/long?url=https://example.com/episode.mp3&amp;subtitles=srt"</pre></li>
<li><b>With the OpenAI SDK:</b> set the base URL to <code>${esc(origin)}/v1</code> and the API key to your key; <code>audio.transcriptions.create</code> works as before.</li></ol>`;
}

/** Hours of audio that `credits` buy through /transcribe/long. */
const hoursFor = (credits: number, longPrice: string) => Math.floor(credits / creditsAt(longPrice));
/** The larger monthly plan, when the card checkout offers one beside the entry plan (WEB_PLANS holds the developer plans only). */
const largerPlan = () => WEB_PLANS.find((p) => p.usdCents > VOICE_PRO_CENTS);

/**
 * The three steps people can choose between, as cards (21 Nov 2026). Before this the front page said "free" six times
 * and showed the paid plans as developer credit tables, so nothing told a visitor what paying adds: in the ten days to
 * 21 Nov the site issued one free key and sold nothing. Every line states what the plan really does; the hours come
 * from the live price of /transcribe/long and the plans from lib/credits.ts, never typed by hand.
 * `freeHref` is where "start free" leads (the console on the front page).
 */
export function offerLadder(prices: VoicePrices, opts: { brand?: string; browserVoices: number; freeHref: string }): string {
  const brand = opts.brand ?? "Glyphcall";
  const price = `$${VOICE_PRO_CENTS / 100}`;
  const hours = voiceProHours(prices.long);
  const more = largerPlan();
  const pack = hoursFor(VOICE_HOURS_PACK_CREDITS, prices.long);
  const free = `<div class="tier"><h3>${esc(brand)} Free</h3><p class="for">Everything you make on your own device.</p><div class="p">$0<small> forever</small></div>
<ul><li>Text to speech: <b>${opts.browserVoices} voices</b> here, 41 in 7 languages in the free voice tools</li><li>Transcripts and subtitles</li><li>Every download: MP3, WAV, SRT, VTT</li><li>No account, no limit, nothing uploaded</li></ul>
<a class="btn" href="${esc(opts.freeHref)}" data-ev="free_start">Start free</a></div>`;
  const pro = `<div class="tier hot"><span class="tag">Most popular</span><h3>Transcribe Pro</h3><p class="for">Long recordings, done for you on our servers.</p><div class="p">${price}<small> / month</small></div>
<ul><li><b>About ${hours} hours</b> of transcription a month</li><li>Up to <b>60 minutes</b> per recording, in <b>90+ languages</b></li><li>Subtitles as SRT or VTT, with word timings</li><li>Works the same on a slow phone or laptop</li><li>One key that also runs the APIs</li><li>Unused credits stay; cancel any time</li></ul>
<a class="btn primary" href="${esc(VOICE_PRO_URL)}">Get Transcribe Pro: ${price} a month</a><p class="fine">No account. <a href="${VOICE_SITE}/transcribe#fast" data-ev="trial_click">Try Pro free on one file</a> first.</p></div>`;
  const plus = more ? `<div class="tier"><h3>Transcribe Pro Plus</h3><p class="for">Hours of audio every day: channels, studios and teams.</p><div class="p">$${more.usdCents / 100}<small> / month</small></div>
<ul><li><b>About ${hoursFor(more.credits, prices.long)} hours</b> of transcription a month</li><li>Everything in Transcribe Pro</li><li>${more.credits.toLocaleString("en-US")} credits a month for any API: speech, documents, search</li><li>Unused credits stay; cancel any time</li></ul>
<a class="btn" href="${esc(more.url)}">Get Pro Plus: $${more.usdCents / 100} a month</a></div>` : "";
  return `<div class="ladder">${free}${pro}${plus}</div>
<p class="packs" style="justify-content:center"><span>Just one job?</span><a href="${esc(VOICE_HOURS_PACK_URL)}">${pack} hours of transcription for $1, paid once</a><a href="/credits">Building an app? API pricing</a></p>`;
}

/** Free beside Transcribe Pro, row by row. Each cell is something the code or the tools' descriptions state. */
export function offerCompare(prices: VoicePrices, browserLanguages: number): string {
  const price = `$${VOICE_PRO_CENTS / 100}`;
  const rows: [string, string, string][] = [
    ["Where the work is done", "On your own device", "On our servers"],
    ["Speed", "Depends on your device", "Does not depend on your device"],
    ["Longest recording", "What your device can handle", "60 minutes per file; the browser tool sends longer ones in parts"],
    ["Speech-to-text model", "Whisper base; large-v3-turbo on browsers with a graphics card", "Whisper large-v3-turbo on every device"],
    ["Languages", `${browserLanguages} to choose from`, "More than 90, detected by itself or chosen by you"],
    ["Subtitles", "SRT and VTT", "SRT and VTT, with word timings"],
    ["Your files", "Never leave your device", "Sent to our servers for the job"],
    ["Use from your own code", "No", "Yes: one API key, OpenAI-shaped requests work as they are"],
    ["Price", "$0", `${price} a month for about ${voiceProHours(prices.long)} hours, or $1 once for ${hoursFor(VOICE_HOURS_PACK_CREDITS, prices.long)} hours`],
  ];
  return `<div class="scroll"><table class="cmp"><tr><th></th><th>Free</th><th>Transcribe Pro</th></tr>${rows.map(([what, a, b]) => `<tr><td>${esc(what)}</td><td>${esc(a)}</td><td class="yes">${esc(b)}</td></tr>`).join("")}</table></div>`;
}

/** The Transcribe Pro landing page, in the product site's own design (it was plain text until 21 Nov 2026). */
export function voiceProPage(origin: string, prices: VoicePrices, brand = "Glyphcall") {
  const hours = voiceProHours(prices.long);
  const hoursPack = hoursFor(VOICE_HOURS_PACK_CREDITS, prices.long);
  const price = `$${VOICE_PRO_CENTS / 100}`;
  const title = `${brand} Transcribe Pro: ${hours} hours a month for ${price}`;
  const description = `Audio and video to text on our servers, with SRT and VTT subtitles in 90+ languages. ${price} a month is about ${hours} hours. No account, cancel any time.`;
  const faq: Array<[string, string]> = [
    ["How many hours do I get?", `About ${hours}. Each month adds ${VOICE_PRO_CREDITS.toLocaleString("en-US")} credits, and a recording of up to 60 minutes costs ${prices.long} (${creditsAt(prices.long)} credits). Short clips cost ${prices.short} each. Unused credits stay on your key.`],
    ["How do I use it?", `Pay by card and your key is shown right away. Open ${brand} Voice Transcribe, paste the key under "Already have an access key?" in the Pro section, then press "Transcribe with Pro" and drop your file. The same key works from code.`],
    ["Which files work?", "MP3 or WAV up to 25 MB and 60 minutes in one call; OGG, M4A, MP4 and other common formats up to 5 MB. A public link to the file works too. The browser tool splits longer recordings for you."],
    ["Which languages?", "More than 90, detected by itself or set by you (Whisper large-v3-turbo). Swedish, Norwegian, Danish, Finnish and German work as well as English."],
    ["Do I need an account?", "No. You pay with a card through Stripe and get a key. Keep the key private: anyone with it can use your credits."],
    ["Can I try it first?", `Yes. In ${brand} Voice, drop a file and choose "Try Pro free on this file": one recording a day, up to 30 minutes, with no card.`],
    ["Can I cancel?", "Yes, any time, in Stripe's customer portal with the e-mail you paid with. Credits already added stay."],
    ["What else can the credits pay for?", `Summaries of a recording (${prices.summary}), text to speech, and every other tool in the catalog.`],
  ];
  const ld = { "@context": "https://schema.org", "@type": "Product", name: `${brand} Transcribe Pro`, description, offers: { "@type": "Offer", price: (VOICE_PRO_CENTS / 100).toFixed(2), priceCurrency: "USD", url: VOICE_PRO_URL } };
  const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  const nav = `<a href="/#try">Text to speech</a><a href="${VOICE_SITE}/transcribe">Transcribe</a><a href="${STUDIO_SITE}/audiobook">Audiobooks</a><a href="/#pricing">Pricing</a><a href="/#developers">Developers</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#07070c"><link rel="canonical" href="${esc(origin)}${VOICE_PRO_PATH}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(origin)}${VOICE_PRO_PATH}"><meta property="og:image" content="${esc(origin)}/og-glyphcall.png"><meta property="og:price:amount" content="${(VOICE_PRO_CENTS / 100).toFixed(2)}"><meta property="og:price:currency" content="USD"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate icon" href="/favicon.ico">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script><script type="application/ld+json">${JSON.stringify(faqLd).replace(/</g, "\\u003c")}</script>
<style>${STYLE}${OFFER_CSS}</style></head><body>
<header class="nav"><div class="wrap"><div class="home"><a href="/" aria-hidden="true" tabindex="-1">${LOGO}</a><a class="brand" href="/">${esc(brand)}</a></div>
<nav aria-label="Main">${nav}</nav>
<div class="nav-cta"><a class="btn sm" href="/#try">Try it free</a><a class="btn sm primary" href="${esc(VOICE_PRO_URL)}">Get Pro</a><details class="menu"><summary aria-label="Menu">Menu</summary><div>${nav}<a href="/app">Get the app</a><a href="/docs">Docs</a></div></details></div></div></header>
<main>
<section class="hero"><div class="glow"></div><div class="grid-bg"></div><div class="wrap">
<span class="kicker">${esc(brand)} Transcribe Pro</span>
<h1>Any recording, turned into text.<br><span class="gt">Done for you.</span></h1>
<p class="lede"><strong>About ${hours} hours of transcription a month for ${price}.</strong> Audio and video to text on our servers, with SRT and VTT subtitles and word timings, in more than 90 languages.</p>
<div class="ctas" style="justify-content:center"><a class="btn primary" href="${esc(VOICE_PRO_URL)}">Get Transcribe Pro: ${price} a month</a><a class="btn" href="${VOICE_SITE}/transcribe#fast" data-ev="trial_click">Try Pro free on one file</a></div>
<p class="after">Just one file? <a href="${esc(VOICE_HOURS_PACK_URL)}">${hoursPack} hours for $1</a>, paid once, no subscription.</p>
<p class="after">Card payment through Stripe. No account. Cancel any time. Failed transcriptions are never charged.</p>
</div></section>

<section class="sec center" id="how"><div class="wrap">
<h2>Three steps, no account</h2>
<ol class="steps">
<li><strong>Pay by card</strong><span>Your key is shown right after payment. Nothing to sign up for.</span></li>
<li><strong>Paste the key</strong><span>Open <a href="${VOICE_SITE}/transcribe#fast">${esc(brand)} Voice Transcribe</a>, paste the key under <b>Already have an access key?</b> in the Pro section, then press <b>Transcribe with Pro</b>.</span></li>
<li><strong>Drop your file</strong><span>Get the transcript and subtitles back. Long recordings are split for you.</span></li>
</ol>
</div></section>

<section class="sec center" id="pricing"><div class="wrap">
<h2>Pick what fits</h2>
<p class="sub">Free stays free. Pay only when you want the work done for you.</p>
${offerLadder(prices, { brand, browserVoices: CONSOLE_VOICES.length, freeHref: "/#try" })}
</div></section>

<section class="sec" id="compare"><div class="wrap">
<div class="center"><h2>Free and Transcribe Pro, side by side</h2></div>
${offerCompare(prices, CONSOLE_LANGUAGES.length)}
</div></section>

<section class="sec" id="faq"><div class="wrap">
<div class="center"><h2>Questions</h2></div>
<div class="faq" style="margin-top:28px">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><div>${esc(a)}</div></details>`).join("")}</div>
<p class="small" style="margin-top:22px">For developers: the same key works from code with <code>/transcribe/long</code> and the OpenAI-compatible <code>/v1/audio/transcriptions</code>. <a href="/speech-to-text-api">Speech to text API</a> · <a href="/credits">all credit packs and plans</a> · <a href="${esc(PLAN_PORTAL_URL)}">manage or cancel a plan</a></p>
</div></section>

<section class="final"><h2>Drop a recording. <span class="gt">Get every word back.</span></h2><p>About ${hours} hours a month for ${price}. No account.</p><div class="ctas"><a class="btn primary" href="${esc(VOICE_PRO_URL)}">Get Transcribe Pro</a><a class="btn" href="${VOICE_SITE}/transcribe#fast" data-ev="trial_click">Try it free on one file</a></div></section>
</main>
<footer><div class="wrap"><p class="legal"><a href="/">Home</a> · <a href="/docs">Docs</a> · <a href="/credits">Pricing</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refunds">Refunds</a></p></div></footer></body></html>`;
}
