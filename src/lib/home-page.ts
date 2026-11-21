// The front page of the product site (glyphcall.com), for people. Served at "/" only when the owner has set a public
// brand (PUBLIC_BRAND, lib/public-brand.ts); until then "/" stays the agent catalogue, which is always at /agents.
//
// Owner, 15 Nov 2026: "make our great homepage that beats ElevenLabs, Exa, everybody's homepages ... must draw in a lot
// of customers", and "no personal information, only market Glyphcall".
// Owner, 17 Nov 2026: "more like elevenlabs in layout (we still use our own cool dark graphics) ... way more user
// friendly and accessible to beginners, too much reading and instructions in people's faces in the beginning; we want
// to market to the masses as well". So the page is built for someone who has never heard of an API:
// - The top of the page is one short headline, one short line and the free tool. Nothing else to read.
// - Then "What do you want to make?": big tiles, one line each, every tile opens a free tool.
// - Then three steps, then a plain pricing block that says the browser tools are free.
// - Everything for developers (APIs, code, price comparisons, plans) sits below, under "For developers", folded where
//   it is long. No developer word (API, key, call, curl) above that section except the nav link to it.
//
// Rules for this page:
// - Every number is computed from the catalog, the plans or the console's voice list. Never type a number.
// - No rival names, prices or benchmarks (owner, 17 Nov 2026: "we are gonna just have the better products, people will
//   compare themselves"; the /compare and /benchmarks pages were removed in 1.216.2). Only the factual request-format
//   line ("OpenAI- and ElevenLabs-shaped requests work") stays: it says what the API accepts.
// - No payment protocol, wallet or crypto word before the "For AI agents" section (tests/site-pages.test.cjs).
// - The only script is the free voice console in the hero (lib/voice-console.ts). Everything else stays script-free:
//   the code tabs are radio inputs, the phone menu and the folded parts are <details>, the motion is CSS and stops under
//   prefers-reduced-motion.
import { ENDPOINTS, exampleParams, type Endpoint } from "../endpoints";
import { TOOL_COUNT } from "../endpoints";
import { CONSOLE_LANGUAGES, CONSOLE_VOICES, STUDIO_SITE, VOICE_CONSOLE_CSS, VOICE_SITE, voiceConsole, voiceConsoleScript } from "./voice-console";
import { PLAN_PORTAL_URL, VOICE_PRO_CENTS, VOICE_PRO_CREDITS, VOICE_PRO_URL } from "./credits";
import { firstCall } from "./first-call";
import { FREE_CALLS_PER_CALLER, FREE_HTTP_CALLS_PER_CALLER } from "./free-calls";
import { COMPANY_FOOTER } from "./legal";
import { PRODUCTS, productOffers, type Product } from "./product-pages";
import { ourVoice } from "./voice-prices";
import { webApplicationScript } from "./app-jsonld";
import { LOGO, OFFER_CSS, STYLE } from "./site-style";
import { STUDIO_VOICES_CSS, studioVoices, studioVoicesScript } from "./studio-voices";
import { SPEECH_VOICES } from "../routes/ai-text";
import { SPEECH_INPUT_LIMIT } from "./openai-speech";
import { SPEECH_CREDITS_PER_100 } from "./voice-billing";
import { VOICE_TEST_SPEECH_CHARS } from "./voice-keys";
import { offerCompare, offerLadder, tryLink, voicePrices, voiceProHours } from "./voice-pro";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const BY_PATH = new Map(ENDPOINTS.map((e) => [e.path, e as Endpoint]));
const queryOf = (e: Endpoint) => exampleParams(e).map(([k, p]) => `${k}=${encodeURIComponent(String(p.example ?? ""))}`).join("&");
/** $0.05, $0.20, $0.258, $1.50: two decimals, a third only when it carries a digit. */
const money = (n: number) => `$${n.toFixed(3).replace(/(\.\d\d)0$/, "$1")}`;

export { VOICE_SITE, STUDIO_SITE };

/** Which group of the developer section each product sits in. A product not named here lands in the last group. */
const SHELVES: readonly { id: string; kicker: string; title: string; slugs: readonly string[] }[] = [
  { id: "voice", kicker: "Voice", title: "Voice", slugs: ["speech-to-text-api", "text-to-speech-api"] },
  { id: "documents", kicker: "Documents", title: "Documents", slugs: ["pdf-to-text-api", "document-to-text-api", "invoice-data-extraction-api", "web-page-to-markdown-api", "bulk-web-reader-api"] },
  { id: "search", kicker: "Search and checks", title: "Search and checks", slugs: ["eu-law-search-api", "company-check-api", "eu-sanctions-screening-api"] },
];

const ICON: Record<string, string> = {
  voice: `<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>`,
  documents: `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`,
  speaker: `<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>`,
  text: `<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/>`,
  captions: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3"/>`,
  book: `<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>`,
  podcast: `<circle cx="12" cy="11" r="3"/><path d="M12 14v7M7.5 15.5a6 6 0 1 1 9 0"/>`,
  phone: `<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>`,
  check: `<path d="m5 12 5 5 9-10"/>`,
  lock: `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
  download: `<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>`,
  redo: `<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>`,
  coin: `<circle cx="12" cy="12" r="9"/><path d="M9 9.5c0-1 1.3-1.8 3-1.8s3 .8 3 1.8-1.3 1.6-3 2-3 1-3 2 1.3 1.8 3 1.8 3-.8 3-1.8M12 6v12"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  exit: `<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>`,
};
const icon = (id: string) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[id] ?? ICON.search}</svg>`;



const shelfOf = (p: Product) => SHELVES.find((s) => s.slugs.includes(p.slug)) ?? SHELVES[SHELVES.length - 1];

function productCard(p: Product, cardReady: boolean): string {
  const tool = BY_PATH.get(p.tool);
  const lead = productOffers(p, cardReady).find((o) => o.monthly);
  return `<article class="card"><h4><a href="/${esc(p.slug)}">${esc(p.name)}</a></h4><p>${esc(p.tagline)}</p>`
    + `<div class="price"><span>Pay as you go</span><b>${tool ? `${esc(tool.price)} a call` : "See pricing"}</b></div>`
    + `${lead ? `<p class="from">${esc(lead.label)}: ${esc(lead.calls)} ${esc(p.unit)}</p>` : ""}`
    + `<a class="cover" href="/${esc(p.slug)}" aria-label="${esc(p.name)}: code, free try and plans"></a></article>`;
}

/** The FAQ: plain questions first, the developer ones last. Every answer restates what the docs, the privacy page or the tool descriptions already say. */
function faqItems(brand: string, languages: string, browserVoices: number, apiVoices: number): [q: string, a: string][] {
  return [
    ["Is it really free?", `Yes. Making speech and transcripts on this page, on voice.glyphcall.com and in the ${brand} app is free, with no account and no limit. You only pay if you want a long recording transcribed on our servers with Transcribe Pro, or if you build ${brand} into your own app or website.`],
    ["Do I need to sign up?", `No. Type your text or drop your file and press the button. There is nothing to fill in.`],
    ["Are my files private?", `The free tools run on your own device, so your text and recordings are never uploaded. The first time you press Play, your browser downloads the voice once; after that it starts in seconds.`],
    ["Which languages does it understand?", `${languages} Subtitles come back as SRT or VTT files you can add to any video.`],
    ["How many voices are there?", `${browserVoices} voices in the free browser tools and ${apiVoices} through the API. Both are our own voices; nothing is uploaded to make either one speak.`],
    ["Can I use it on my phone?", `Yes. Open this page on your phone, or install the free ${brand} app from glyphcall.com/app. It works on Windows, Mac, Linux, Android and iPhone, and keeps working offline.`],
    ["What happens when an API call fails?", `You pay nothing. Wrong input, a page that cannot be read or an outside source that is down are all free; only answers that succeed use credits.`],
    ["Can I cancel a plan?", `Any time, from the plan portal, with the e-mail address you paid with. Unused credits stay on your key and one-off packs never expire.`],
  ];
}

// 21 Nov 2026 (front-page layout pass): on a phone the Play button sat under the sticky bar (y≈790 of 812) and the
// developer block was 37% of the page. The hero is tighter on phones, the sample-script chips scroll in one row, the
// keyboard hint is hidden on touch screens, and the long API catalogue folds into one panel (opened by a link into it).
const HOME_LAYOUT_CSS = `.devmore{margin:26px 0 0;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.02)}
.devmore>summary{cursor:pointer;padding:16px 20px;font-weight:700;color:var(--fg);list-style:none}
.devmore>summary::-webkit-details-marker{display:none}.devmore>summary::after{content:" +";color:var(--c)}.devmore[open]>summary::after{content:" \\2212"}
.devmore>:not(summary){padding:0 20px}.devmore>:last-child{padding-bottom:20px}
@media (hover:none) and (pointer:coarse){.vc-meta span:last-child{display:none}}
@media (max-width:720px){.hero{padding:14px 0 18px}.hero h1{font-size:1.85rem;line-height:1.08;margin-bottom:8px}.hero .lede{font-size:1rem;margin:0 auto 14px}
.hero .vc textarea{min-height:0;height:5.4em}.hero .vc-pane{padding:12px}.hero .vc-meta{margin:4px 2px 8px}
.hero .vc-presets{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin-bottom:10px}.hero .vc-presets::-webkit-scrollbar{display:none}.hero .vc-presets button{flex:none}}`;
// 21 Nov 2026 redesign (owner: "more like elevenlabs ... the first thing hitting you should be the text thing", and "win
// where elevenlabs looses and beat them where they win as well"). Internal research: business/voice-plan-2026-11-14/
// internal-bench/homepage-research-2026-11-21.md. What it changed:
// - a one-line news bar, a product row above the console (the big studio-style text box stays the first thing seen),
//   and a promise row under it that names what visitors elsewhere pay for or sign up for: downloads, retries, accounts;
// - the six tiles became a product tour: one wide row per product, each with a drawn preview of the real tool and one
//   button into it (the market leader wins on showing breadth; this shows ours without a word of jargon);
// - a "Fair by design" block: the billing and privacy complaints people have about voice tools, answered as promises
//   the code keeps (free retries, failed calls cost nothing, packs never expire, cancel from the portal, no account).
// Still: no rival named, no speed claim, no AI label, every number computed.
const REDESIGN_CSS = `.annc{position:relative;z-index:21;background:linear-gradient(90deg,rgba(139,92,246,.22),rgba(34,211,238,.18));border-bottom:1px solid rgba(255,255,255,.07);font-size:.9rem;text-align:center;padding:8px 16px;color:var(--fg)}
.annc a{color:var(--fg);font-weight:650}.annc .short{display:none}.annc b{color:#07070c;background:var(--grad);border-radius:999px;padding:1px 8px;margin-right:8px;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase}
.hero{padding-top:40px}.hero h1{font-size:clamp(2rem,4.6vw,3.5rem);max-width:20ch;margin-bottom:10px}.hero .lede{margin-bottom:20px}.hero .pill{display:inline-flex;gap:8px;align-items:center;margin:0 0 18px;padding:6px 14px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--muted);font-size:.9rem}.hero .pill i{width:8px;height:8px;border-radius:50%;background:var(--g);box-shadow:0 0 10px var(--g)}
.prow{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:0 auto 14px;max-width:900px}
.prow a{display:inline-flex;align-items:center;gap:7px;padding:8px 15px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--muted);font-size:.93rem;font-weight:600}.prow a .ico{width:17px;height:17px}
.prow a:hover,.prow a[aria-current]{color:var(--fg);border-color:#4a4a70;background:rgba(255,255,255,.08);text-decoration:none}.prow a[aria-current]{border-color:var(--c)}
.promise{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 10px;margin:16px 0 0;padding:0;list-style:none}.promise li{display:flex;align-items:center;gap:7px;font-size:.9rem;color:var(--muted);padding:6px 12px;border-radius:999px;background:rgba(52,211,153,.07);border:1px solid rgba(52,211,153,.22)}.promise .ico{width:16px;height:16px;color:var(--g)}
.tour{display:grid;gap:18px;margin-top:8px;text-align:left}
.trow{display:grid;grid-template-columns:1fr 1.1fr;gap:28px;align-items:center;padding:28px;border-radius:26px;border:1px solid var(--line);background:radial-gradient(520px 220px at 0 0,rgba(139,92,246,.10),transparent 65%),var(--card)}
.trow:nth-child(even){background:radial-gradient(520px 220px at 100% 0,rgba(34,211,238,.09),transparent 65%),var(--card)}.trow:nth-child(even) .tcopy{order:2}
.tcopy h3{font-size:clamp(1.4rem,2.6vw,1.9rem);line-height:1.12;letter-spacing:-.02em;margin:6px 0 10px}.tcopy p{color:var(--muted);margin:0 0 18px}.tcopy .free{font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--g);background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);padding:3px 9px;border-radius:999px;margin-left:8px}
.mock{border-radius:18px;border:1px solid var(--line);background:linear-gradient(180deg,#141422,#0c0c15);padding:18px;font-size:.9rem;color:var(--muted);min-height:190px}
.mock .row{display:flex;gap:10px;align-items:center;padding:9px 12px;border-radius:12px;background:rgba(255,255,255,.03);margin:0 0 8px}.mock .row.on{background:rgba(34,211,238,.10);border:1px solid rgba(34,211,238,.35);color:var(--fg)}
.mock .t{font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--c);font-size:.8rem;flex:none}.mock .tag{margin-left:auto;font-size:.75rem;font-weight:700;color:#07070c;background:var(--grad);border-radius:999px;padding:2px 9px;flex:none}
.mock .bar{height:6px;border-radius:6px;background:#25253a;overflow:hidden;flex:1}.mock .bar i{display:block;height:100%;background:var(--grad)}
.mock .bub{max-width:82%;padding:9px 13px;border-radius:14px;margin:0 0 8px;background:rgba(139,92,246,.14);color:var(--fg)}.mock .bub.b{margin-left:auto;background:rgba(34,211,238,.12)}.mock .bub small{display:block;color:var(--c);font-weight:700;font-size:.74rem}
.mock .mwave{display:flex;gap:3px;align-items:center;height:44px;margin:4px 0 12px}.mock .mwave i{flex:1;border-radius:3px;background:var(--grad);opacity:.85}
.fair{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;text-align:left;margin-top:8px}
.fair div{padding:24px;border-radius:20px;border:1px solid var(--line);background:var(--card)}.fair b{display:flex;gap:10px;align-items:center;font-size:1.1rem;color:var(--fg);margin-bottom:6px}.fair b .ico{color:var(--g);width:22px;height:22px;flex:none}.fair span{color:var(--muted);font-size:.97rem}
.steps.compact li{padding:22px}
@media (max-width:860px){.trow{grid-template-columns:1fr;padding:20px}.trow:nth-child(even) .tcopy{order:0}.fair{grid-template-columns:1fr}.mock{min-height:0}}
@media (max-width:720px){.promise,.prow,.annc,.trow:not(:first-child) .mock{display:none}.annc .short{display:inline}.annc{font-size:.82rem;padding:6px 12px}.hero .pill{display:none}.prow{flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start;scrollbar-width:none;margin-bottom:10px}.prow::-webkit-scrollbar{display:none}.prow a{flex:none;padding:7px 12px}}`;

const OPEN_FOLDED_TARGET = `<script data-gc-fold>(()=>{const open=()=>{const t=location.hash&&document.getElementById(decodeURIComponent(location.hash.slice(1)));const d=t&&t.closest&&t.closest("details.devmore");if(d&&!d.open){d.open=true;t.scrollIntoView();}};addEventListener("hashchange",open);open();})();</script>`;

/**
 * The front page of the product site. `cardReady`: card plans and packs can be bought (lib/credit-routes.ts).
 * `opts.trial`: free calls are on, so the developer tabs open with a request that needs no key (lib/first-call.ts);
 * `opts.freeKey`: free keys by e-mail are offered (lib/free-keys.ts `freeKeysOn`), so the page links /keys/free.
 */
export function landingPage(brand: string, origin: string, cardReady: boolean, opts: { trial?: boolean; freeKey?: boolean; voiceTry?: boolean; creditsTrial?: boolean } = {}): string {
  const us = ourVoice();
  const hasLite = BY_PATH.has("/text-to-speech/lite");
  const longTool = BY_PATH.get("/transcribe/long");
  const languages = longTool && /90\+ languages/.test(longTool.description) ? "More than 90 languages, detected by itself or chosen by you." : "Many languages; choose yours for the best result.";
  const voices = CONSOLE_VOICES.length;
  const proPrice = `$${VOICE_PRO_CENTS / 100}`;
  const proHours = voiceProHours(voicePrices().long);

  const title = `${brand}: free text to speech and transcription, plus voice and document APIs`;
  const description = `Turn text into natural speech and recordings into text, free in your browser with no sign-up. For apps: an hour of transcription for ${us.long}${hasLite ? `, speech from ${money(us.lite1k)} per 1,000 characters` : ""}, PDFs and web pages to text, and EU search. Failed calls are never charged.`.slice(0, 300);

  // Developer code tabs: each runs a tool's own published example, so the request shown is one that works.
  const sample = (path: string) => {
    const e = BY_PATH.get(path);
    if (!e) return "";
    // ":" and "/" are legal in a query string; leaving them readable makes the example URL legible.
    const q = queryOf(e).replace(/%3A/gi, ":").replace(/%2F/gi, "/");
    return `<span class="k">curl</span> -H <span class="s">"Authorization: Bearer $GLYPHCALL_KEY"</span> \\\n  <span class="s">"${esc(origin)}${esc(e.path)}${q ? `?${esc(q)}` : ""}"</span>`;
  };
  // The first tab needs no key: the request is a tool's published example with trial=1 and the answer under it is that
  // tool's published example answer (tests/first-call.test.cjs runs the printed URL and compares the two).
  const keyless = opts.trial ? firstCall(origin) : null;
  const tabs: [label: string, code: string, out: string][] = [
    ...(keyless ? [["Try it now", `<pre><code><span class="k">curl</span> <span class="s">"${esc(keyless.url)}"</span></code></pre><pre class="res"><code>${esc(keyless.output)}</code></pre>`, `That is the real answer, and the request needs no key: ${FREE_HTTP_CALLS_PER_CALLER} free calls per caller on most tools. After that, one key runs everything.`] as [string, string, string]] : []),
    ...([
      ["Transcribe", "/transcribe/long", `200 OK: transcript, SRT subtitles and word timings for up to an hour of audio. ${us.long}.`],
      ["PDF to text", "/pdf/text", `200 OK: the text of every page as JSON. ${BY_PATH.get("/pdf/text")?.price ?? ""} a call.`],
      ["EU law search", "/law/search", `200 OK: the exact articles, with act, article number, full text and EUR-Lex link.`],
    ].filter(([, p]) => BY_PATH.has(p)).map(([label, path, out]) => [label, `<pre><code>${sample(path)}</code></pre>`, out] as [string, string, string])),
  ];
  const bars = Array.from({ length: 34 }, (_, i) => `<i style="animation-delay:-${((i * 137) % 1400) / 1000}s"></i>`).join("");

  // The API prices in three numbers, for developers.
  const stats: [n: string, l: string, s: string][] = [
    [us.long, "for an hour of transcription", "Up to 60 minutes in one call, with subtitles and word timings"],
    ...(hasLite ? [[money(us.lite1k), "per 1,000 characters of speech", "Natural voices back as MP3, no credit pool to convert"] as [string, string, string]] : []),
    ["$0", "for any call that fails", "Errors, bad input and outages are never charged"],
  ];

  // Products, group by group.
  const shelves = SHELVES.map((s) => {
    const rank = (p: Product) => (s.slugs.indexOf(p.slug) + 1) || 99;
    const items = PRODUCTS.filter((p) => shelfOf(p) === s).sort((a, b) => rank(a) - rank(b));
    if (!items.length) return "";
    return `<div class="shelf" id="${s.id}"><h3>${icon(s.id)}${esc(s.title)}</h3><div class="cards">${items.map((p) => productCard(p, cardReady)).join("")}</div></div>`;
  }).join("");

  // Pricing: the free tools first, then the monthly plans as cards, the packs as chips, the full table folded.
  const offers = productOffers(PRODUCTS[0], cardReady);
  const highlight = ["speech-to-text-api", "pdf-to-text-api", "web-page-to-markdown-api", "company-check-api"].map((slug) => PRODUCTS.find((p) => p.slug === slug)).filter(Boolean) as Product[];
  const planCards = offers.map((o, i) => ({ o, i })).filter(({ o }) => o.monthly).map(({ o, i }, k, all) => {
    const price = o.label.replace(/ a month$/, "");
    return `<div class="plan${k === all.length - 1 ? " best" : ""}">${k === all.length - 1 ? `<span class="ribbon">Best value</span>` : ""}<div class="p">${esc(price)}<small> / month</small></div><ul>${highlight.map((p) => `<li><b>${esc(productOffers(p, cardReady)[i]?.calls ?? "")}</b> ${esc(p.unit)}</li>`).join("")}<li>One key for every API, unused credits roll over</li></ul><a class="btn${k === all.length - 1 ? " primary" : ""}" href="${esc(o.url)}">Start for ${esc(price)}</a></div>`;
  }).join("");
  const packs = offers.filter((o) => !o.monthly);
  const pricing = offers.length ? `<div class="devhead"><h3>For your own app or website</h3><p>Plans add credits every month and unused credits stay.</p></div><div class="plans">${planCards}</div>
${packs.length ? `<p class="packs"><span>Or a one-off pack that never expires:</span>${packs.map((o) => `<a href="${esc(o.url)}">${esc(o.label.replace(/ once$/, ""))}</a>`).join("")}</p>` : ""}
<details><summary>What each plan buys, API by API</summary><div><div class="scroll"><table><tr><th>Plan</th>${PRODUCTS.map((p) => `<th>${esc(p.unit.charAt(0).toUpperCase() + p.unit.slice(1))}</th>`).join("")}</tr>
${offers.map((o, i) => `<tr><td><a href="${esc(o.url)}">${esc(o.label)}</a></td>${PRODUCTS.map((p) => `<td>${esc(productOffers(p, cardReady)[i]?.calls ?? "")}</td>`).join("")}</tr>`).join("\n")}
</table></div><p class="small">Each column is what that amount buys if you spend it all on that one API. <a href="${esc(PLAN_PORTAL_URL)}">Cancel a plan at any time</a>. Details: <a href="/credits">pricing</a>.</p></div></details>`
    : `<p><a href="/credits">Plans and packs</a></p>`;

  const ttsTagline = PRODUCTS.find((p) => p.slug === "text-to-speech-api")?.tagline ?? "";
  const apiVoices = Number(/(\d+) natural voices/.exec(ttsTagline)?.[1] ?? CONSOLE_VOICES.length);
  const faq = faqItems(brand, languages, CONSOLE_VOICES.length, apiVoices);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${origin}/#org`, name: brand, url: `${origin}/`, logo: `${origin}/favicon.svg`, description },
      { "@type": "WebSite", "@id": `${origin}/#site`, name: brand, url: `${origin}/`, publisher: { "@id": `${origin}/#org` } },
      { "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
    ],
  };

  // The product row above the console: the same jobs as the tour below, one tap each.
  const prow: [ico: string, label: string, href: string][] = [
    ["speaker", "Text to speech", "#try"],
    ["text", "Speech to text", `${VOICE_SITE}/transcribe`],
    ["captions", "Subtitles", `${VOICE_SITE}/transcribe`],
    ["book", "Audiobooks", `${STUDIO_SITE}/audiobook`],
    ["podcast", "Podcasts", `${STUDIO_SITE}/dialogue`],
    ["phone", "App", "/app"],
  ];
  const v = (i: number) => esc(CONSOLE_VOICES[i % voices]?.name ?? "");
  const waveBars = Array.from({ length: 40 }, (_, i) => `<i style="height:${18 + ((i * 53) % 78)}%"></i>`).join("");
  // The product tour: one wide row per job, a drawn preview of the real tool, one button into it. Every claim is a thing
  // the linked free tool does today.
  const tour: [kicker: string, title: string, line: string, href: string, go: string, mock: string][] = [
    ["Voiceovers", "Fix one sentence, not the whole take.", "Type your script and pick a voice. Not happy with one line? Redo just that sentence; it is spliced into the same download.", "#try", "Make a voiceover",
      `<div class="mock" aria-hidden="true"><div class="mwave">${waveBars}</div><div class="row"><span class="t">01</span>The harbour woke slowly.</div><div class="row on"><span class="t">02</span>Gulls called above the empty quay.<span class="tag">Redo</span></div><div class="row"><span class="t">03</span>The first boat slipped out.</div></div>`],
    ["Transcripts and subtitles", "Every word, with the time it was said.", `Drop a recording and get the text back, plus SRT or VTT subtitles for YouTube or any video editor. ${esc(languages)}`, `${VOICE_SITE}/transcribe`, "Transcribe a file",
      `<div class="mock" aria-hidden="true"><div class="row"><span class="t">00:00:01</span>Welcome back to the show.</div><div class="row on"><span class="t">00:00:04</span>Today we talk about keeping it simple.</div><div class="row"><span class="t">00:00:09</span>Let&rsquo;s start with the first question.</div><div class="row"><span class="t">SRT</span>Subtitles ready<span class="tag">Download</span></div></div>`],
    ["Audiobooks", "Your book, read aloud. Chapter by chapter.", "Open a PDF, EPUB or Word file in the studio, choose a narrator and get one audio file per chapter.", `${STUDIO_SITE}/audiobook`, "Open the audiobook studio",
      `<div class="mock" aria-hidden="true"><div class="row"><span class="t">Ch 1</span>The Harbour<div class="bar"><i style="width:100%"></i></div></div><div class="row on"><span class="t">Ch 2</span>The Storm<div class="bar"><i style="width:64%"></i></div></div><div class="row"><span class="t">Ch 3</span>Home Again<div class="bar"><i style="width:0"></i></div></div><div class="row"><span class="t">Voice</span>${v(2)}<span class="tag">Narrator</span></div></div>`],
    ["Podcasts and dialogue", "A voice for every speaker. One whole show.", "Write who says what, and every person gets their own voice in one audio file. Add pauses where you want them.", `${STUDIO_SITE}/dialogue`, "Make a podcast",
      `<div class="mock" aria-hidden="true"><div class="bub"><small>${v(0)}</small>So what did you think of the ending?</div><div class="bub b"><small>${v(3)}</small>Honestly? I did not see it coming.</div><div class="bub"><small>${v(0)}</small>Neither did I. Let&rsquo;s talk about it.</div></div>`],
    ["The app", "On your phone. On your computer. Offline.", `Install ${esc(brand)} Voice from this site on Windows, Mac, Linux, Android or iPhone. It keeps working without a connection.`, "/app", `Get the ${esc(brand)} app`,
      `<div class="mock" aria-hidden="true"><div class="row on"><span class="t">${icon("phone")}</span>${esc(brand)} Voice<span class="tag">Install</span></div><div class="row"><span class="t">${icon("check")}</span>Works offline after the first use</div><div class="row"><span class="t">${icon("lock")}</span>Your text and recordings stay on the device</div><div class="row"><span class="t">${icon("download")}</span>MP3, WAV and subtitle downloads</div></div>`],
  ];
  // Fair by design: the complaints people have about voice tools, answered as promises this service keeps.
  const fair: [ico: string, title: string, line: string][] = [
    ["user", "No account for the free tools", "Type, play, download. No e-mail, no sign-up form, no trial that ends."],
    ["redo", "Retries and previews are free", "Audition every voice and redo any sentence as often as you like. Nothing is counted on this page."],
    ["download", "Downloads are not locked", "MP3, WAV and subtitle files from the free tools are yours to keep."],
    ["coin", "A failed job costs nothing", "On paid plans and the API, only work that succeeds uses credits. Errors and bad input are free."],
    ["clock", "Packs never expire", "A one-off pack keeps its credits until you use them. No subscription needed."],
    ["exit", "Cancel in one click", "Stop a plan any time from the plan portal with the e-mail you paid with. Unused credits stay on your key."],
  ];

  const navLinks = `<a href="#try">Text to speech</a><a href="${VOICE_SITE}/transcribe">Transcribe</a><a href="${STUDIO_SITE}/audiobook">Audiobooks</a><a href="/transcribe-pro">Pro</a><a href="#pricing">Pricing</a><a href="/guides">Guides</a><a href="#developers">Developers</a>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#07070c">
<link rel="canonical" href="${esc(origin)}/">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(brand)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(origin)}/"><meta property="og:image" content="${esc(origin)}/og-glyphcall.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate icon" href="/favicon.ico">
<script type="application/ld+json">${jsonLd(ld)}</script>
${webApplicationScript({ name: brand, url: `${origin}/`, description, brand, offers: offers.map((o) => ({ label: o.label })) })}
<style>${STYLE}${OFFER_CSS}${STUDIO_VOICES_CSS}${HOME_LAYOUT_CSS}${REDESIGN_CSS}</style></head><body class="has-stickbar">
<p class="annc"><b>New</b><span class="long">The free voice tool now also speaks Spanish, French, Italian, Portuguese and Hindi. </span><span class="short">Five more languages in the free voice tool. </span><a href="${VOICE_SITE}/text-to-speech">Try a voice &rarr;</a></p>
<header class="nav"><div class="wrap"><div class="home"><a href="/" aria-hidden="true" tabindex="-1">${LOGO}</a><a class="brand" href="/">${esc(brand)}</a></div>
<nav aria-label="Main">${navLinks}</nav>
<div class="nav-cta"><a class="btn sm" href="/transcribe-pro">Get Pro</a><a class="btn sm primary" href="#try">Try it free</a><details class="menu"><summary aria-label="Menu">Menu</summary><div>${navLinks}<a href="/app">Get the app</a><a href="/docs">Docs</a>${opts.freeKey ? `<a href="/keys/free">Get a free key</a>` : ""}<a href="/credits">Get an API key</a></div></details></div></div></header>
<main>
<section class="hero" id="try"><div class="glow"></div><div class="grid-bg"></div><div class="wrap">
<p class="pill"><i></i>Free in your browser &middot; no account &middot; nothing uploaded</p>
<h1>Lifelike voices for <span class="gt">anything you write.</span></h1>
<p class="lede">Type, pick a voice, press Play. Download it free. No sign-up, nothing to install.</p>
<nav class="prow" aria-label="What you can make">${prow.map(([ic, label, href], i) => `<a href="${esc(href)}"${i === 0 ? ' aria-current="page"' : ""}>${icon(ic)}${esc(label)}</a>`).join("")}</nav>
<div class="stage">${voiceConsole({ id: "hero-vc", voiceSite: VOICE_SITE, upsellTts: `Want it inside your own app? See <a href="#developers">${esc(brand)} for developers</a>.`, upsellStt: `Long recording? <a href="/transcribe-pro">Transcribe Pro</a> does up to an hour for you.` })}
<ul class="promise"><li>${icon("download")}Free MP3 and WAV downloads</li><li>${icon("redo")}Redo one sentence, keep the rest</li><li>${icon("check")}Unlimited previews and retries</li></ul>
<p class="after">Rather use an app? <a href="/app">Install ${esc(brand)} Voice</a>, free on your phone or computer.</p>
${cardReady ? studioVoices({ textId: "hero-vc-text", voices: SPEECH_VOICES, planUrl: VOICE_PRO_URL, planPrice: proPrice, planCharacters: Math.floor(VOICE_PRO_CREDITS / SPEECH_CREDITS_PER_100) * 100, maxCharacters: SPEECH_INPUT_LIMIT, testCharacters: VOICE_TEST_SPEECH_CHARS, freeTry: false }) : ""}</div>
</div></section>

<section class="stats" aria-label="Why people like it"><div class="wrap"><ul class="trust">
<li>${icon("check")}Free, no limits</li><li>${icon("user")}No account needed</li><li>${icon("lock")}Your files stay on your device</li><li>${icon("download")}Download MP3, WAV or subtitles</li><li>${icon("speaker")}${voices} free browser voices</li>
</ul></div></section>

<section class="sec center" id="make"><div class="wrap">
<h2>One studio for every voice job.</h2>
<p class="sub">Voiceovers, transcripts, subtitles, audiobooks and podcasts. Every one of these is free to use.</p>
<div class="tour">${tour.map(([k, t, line, href, go, mock]) => `<article class="trow"><div class="tcopy"><span class="kicker">${esc(k)}</span><span class="free">Free</span><h3>${esc(t)}</h3><p>${line}</p><a class="btn primary" href="${esc(href)}">${go} &rarr;</a></div>${mock}</article>`).join("")}</div>
</div></section>

<section class="sec" id="pro"><div class="wrap"><div class="proband">
<div><span class="kicker">Transcribe Pro</span><h2>When your device is not enough, <span class="gt">we do it for you.</span></h2>
<p class="sub">The free tools run on your phone or computer. Transcribe Pro runs on our servers: long recordings, any device, about ${proHours} hours a month for ${proPrice}.</p>
<div class="ctas"><a class="btn primary" href="${cardReady ? esc(VOICE_PRO_URL) : "/transcribe-pro"}">Get Transcribe Pro: ${proPrice} a month</a>${cardReady ? tryLink(voicePrices(), opts.creditsTrial ?? false, "Try Pro free on one file", "btn") : `<a class="btn" href="/credits">One job? See the one-off packs</a>`}</div></div>
<ul><li><b>Long recordings</b><span>Any length in the browser tool: it is compressed and sent in parts for you.</span></li><li><b>More than 90 languages</b><span>Detected by itself, with SRT or VTT subtitles and word timings.</span></li><li><b>Any device</b><span>The work is done on our servers, so a slow phone is as good as a fast computer.</span></li></ul>
</div></div></section>

<section class="sec center" id="pricing"><div class="wrap">
<h2>Free stays free. <span class="gt">Pro does the heavy lifting.</span></h2>
<p class="sub">Everything you make on this page and in the app is free, on your own device. Pay only when you want the work done for you.</p>
${cardReady ? offerLadder(voicePrices(), { brand, browserVoices: voices, freeHref: "#try", trial: opts.creditsTrial }) : `<div class="freebox"><div><h3>${esc(brand)} Free</h3><div class="p">$0<small> forever</small></div><ul><li>Text to speech</li><li>Transcripts and subtitles</li><li>All ${voices} browser voices</li><li>Every download</li><li>No account, no limits</li></ul></div><a class="btn white" href="#try">Start for free</a></div>`}
${cardReady ? `<details class="cmpbox"><summary>Compare Free and Transcribe Pro</summary><div>${offerCompare(voicePrices(), CONSOLE_LANGUAGES.length)}</div></details>` : ""}
</div></section>

<section class="sec center" id="fair"><div class="wrap">
<h2>Fair by design. <span class="gt">No surprises on your bill.</span></h2>
<p class="sub">The things people dislike about voice tools, answered as promises we keep.</p>
<div class="fair">${fair.map(([ic, t, line]) => `<div><b>${icon(ic)}${esc(t)}</b><span>${esc(line)}</span></div>`).join("")}</div>
</div></section>

<section class="sec center" id="how"><div class="wrap">
<h2>As easy as 1, 2, 3</h2>
<p class="sub">No learning curve. If you can type, you can use ${esc(brand)}.</p>
<ol class="steps compact">
<li><strong>Type or drop</strong><span>Write some text, or drop in a recording.</span></li>
<li><strong>Pick a voice</strong><span>Choose from ${voices} voices and set the speed.</span></li>
<li><strong>Press Play</strong><span>Listen, then download it. Done.</span></li>
</ol>
<div class="ctas" style="justify-content:center;margin-top:30px"><a class="btn primary" href="#try">Start now, it&rsquo;s free</a></div>
</div></section>

<section class="sec" id="faq"><div class="wrap">
<div class="center"><h2>Questions</h2></div>
<div class="faq" style="margin-top:28px">${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><div>${esc(a)}</div></details>`).join("")}</div>
</div></section>

<section class="sec" id="developers"><div class="wrap"><div class="devbox">
<span class="kicker">For developers</span><h2>Building an app? One key does it all.</h2>
<p class="sub">The same voices and transcripts, plus document reading and search, as simple web requests. ${opts.trial ? "A free try on every page, and failed" : "Prepaid from $1, and failed"} calls cost nothing.</p>
<div class="dev"><div><ol>
<li><b>${opts.trial ? "Try it." : "See it."}</b> ${opts.trial ? "Every product page runs the real thing on your own input, free." : "Every product page shows a real example answer."}</li>
<li><b>Get a key.</b> Pay by card; the key is shown right after payment. No account to create.</li>
<li><b>Call it.</b> OpenAI- and ElevenLabs-shaped requests work as they are.</li>
</ol>
<div class="ctas"><a class="btn primary" href="/credits">Get an API key</a>${opts.freeKey ? `<a class="btn" href="/keys/free">Get a free key</a>` : ""}<a class="btn" href="/docs">Read the docs</a></div></div>
<div class="term" aria-label="Example requests"><div class="wave" aria-hidden="true">${bars}</div>
<div class="tabs">${tabs.map(([label], i) => `<input type="radio" name="hero-tab" id="t${i + 1}"${i === 0 ? " checked" : ""}><label for="t${i + 1}">${esc(label)}</label>`).join("")}
<div class="panes" style="width:100%">${tabs.map(([, code, out], i) => `<div class="pane p${i + 1}">${code}<p class="out">${esc(out)}</p></div>`).join("")}</div></div></div></div>
<div class="nums">${stats.map(([n, l, s]) => `<div class="num"><div class="n gt">${esc(n)}</div><div class="l">${esc(l)}</div><div class="s">${esc(s)}</div></div>`).join("")}</div>
<details class="devmore" id="apis"><summary>See every API, with prices and what each plan buys</summary>
<div class="devpricing" id="api-pricing">${pricing}</div>
<div id="products">${shelves}</div>
<div class="agents">
<h2>For AI agents</h2>
<p>The same APIs, and the rest of a catalogue of ${TOOL_COUNT} tools, are available to AI agents: an MCP server at <code>${esc(origin)}/mcp</code> ${opts.trial ? `(the first ${FREE_CALLS_PER_CALLER} successful calls are free)` : "(paid per call or with a prepaid key)"} and pay-per-call over HTTP. <a href="/agents">Agent catalogue and payment details</a> · <a href="/tools">all tools</a> · <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">OpenAPI</a></p>
</div>
</details>
</div></div></section>

<section class="final"><h2>Give it a try. <span class="gt">It takes ten seconds.</span></h2><p>Free, no account, and nothing to install.</p><div class="ctas"><a class="btn primary" href="#try">Try it free, no account</a><a class="btn" href="/app">Get the app</a></div></section>
</main><div class="stickbar"><a class="btn primary" href="#try" data-ev="sticky_try">Try it free</a><a class="btn" href="/transcribe-pro" data-ev="sticky_pro">Get Pro: ${proPrice}/month</a></div>${voiceConsoleScript()}${cardReady ? studioVoicesScript() : ""}${OPEN_FOLDED_TARGET}
<footer><div class="wrap"><div class="cols">
<div><div class="home" style="margin-bottom:10px">${LOGO.replace(/gc-logo/g, "gc-logo-f")}<strong style="color:var(--fg)">${esc(brand)}</strong></div><p>Free text to speech and transcription in your browser, and simple APIs for voice, documents and search.</p><p><a href="${VOICE_SITE}/text-to-speech">Text to speech</a> · <a href="${VOICE_SITE}/transcribe">Transcribe</a> · <a href="${STUDIO_SITE}/audiobook">Audiobook studio</a> · <a href="/app">App</a></p></div>
${SHELVES.map((s) => `<div><h3>${esc(s.kicker)} APIs</h3><ul>${PRODUCTS.filter((p) => shelfOf(p) === s).map((p) => `<li><a href="/${esc(p.slug)}">${esc(p.name.replace(/ API( for .*)?$/, ""))}</a></li>`).join("")}</ul></div>`).join("")}
</div>
<p class="legal"><a href="/docs">Docs</a> · <a href="/credits">Pricing</a> · <a href="/transcribe-pro">Transcribe Pro</a> · <a href="/agents">For AI agents</a> · ${COMPANY_FOOTER}</p>
</div></footer></body></html>`;
}
