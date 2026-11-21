// Every visible string of the product site's front page (lib/home-page.ts landingPage), by language (21 Nov 2026).
// English is the source; the project lead owns its wording. Spanish, German and French are written by hand for
// beginners, not translated word by word: short sentences, "tú" in Spanish, "du" in German, "vous" in French.
//
// The owner's rules hold in every language (tests/i18n.test.cjs scans for them): no rival names, no AI labels on our
// products, no speed claims, no refund or money-back promise, no commercial-use promise, no accounts; pay methods are
// "card, Apple Pay, Google Pay or Link"; prices in US dollars, written "$3" everywhere. Numbers come in as arguments
// (computed by the page from the catalogue, the plans and the console), never typed here.
//
// Fields named ...Html are inserted as HTML (they hold entities or links); every other field is escaped by the page.
import type { ConsoleLabels } from "../voice-console";
import type { Lang } from "./locales";
import { DE } from "./home-de";
import { ES } from "./home-es";
import { FR } from "./home-fr";

/** lineHtml and goHtml may hold {brand} and {languages}; the page fills them in, escaped. */
type Tour = readonly [kicker: string, title: string, lineHtml: string, goHtml: string];
type Pair = readonly [string, string];

/** What the copy may print; all of it computed by the page. */
export interface HomeFacts { brand: string; voices: number; apiVoices: number; proPrice: string; proHours: number; ninetyPlus: boolean }

/** The pricing cards in another language (the English page uses lib/voice-pro.ts offerLadder). */
export interface LadderStrings {
  freeName: (brand: string) => string; freeFor: string; forever: string; freeItemsHtml: (voices: number) => readonly string[]; freeGo: string;
  onceName: string; onceFor: string; once: string; onceItemsHtml: (hours: number) => readonly string[]; onceGo: (hours: number) => string; onceFine: string;
  proTag: string; proFor: string; month: string; proItemsHtml: (hours: number) => readonly string[]; proGo: (price: string) => string; proFine: string;
  moreAsk: string; more: (price: string, hours: number) => string; api: string;
}

export interface HomeStrings {
  /** "More than 90 languages, …" or the plain fallback. */
  languages: (ninetyPlus: boolean) => string;
  title: (brand: string) => string;
  description: string;
  languageLabel: string;
  // Developer code tabs and numbers.
  tryNow: string;
  tryNowOut: (freeCalls: number) => string;
  tabs: { transcribe: string; pdf: string; law: string; lawOut: string };
  tabTranscribeOut: (longPrice: string) => string;
  tabPdfOut: (price: string) => string;
  stats: { hour: Pair; perK: Pair; fail: Pair };
  // Product cards.
  card: { payg: string; aCall: (price: string) => string; seePricing: string; cover: (name: string) => string };
  shelves: Readonly<Record<"voice" | "documents" | "search", string>>;
  apis: (kicker: string) => string;
  // Developer pricing.
  devPricing: { h3: string; p: string; perMonth: string; best: string; oneKey: string; start: (price: string) => string; packsLead: string; table: string; plan: string;
    footHtml: (portalUrl: string) => string; fallback: string; monthLabel: (price: string) => string; onceLabel: (price: string) => string };
  faq: (f: HomeFacts, languages: string) => readonly Pair[];
  prow: readonly [string, string, string, string, string, string, string];
  prowLabel: string;
  tour: readonly [Tour, Tour, Tour, Tour, Tour];
  /** HTML (entities allowed). */
  mocks: { voice: readonly [string, string, string]; redo: string; transcript: readonly [string, string, string]; subtitles: string; download: string;
    chapters: readonly [string, string, string]; chapter: string; voiceTag: string; narrator: string; dialogue: readonly [string, string, string]; app: readonly [string, string, string, string] };
  fair: readonly Pair[];
  nav: { tts: string; transcribe: string; audiobooks: string; pro: string; pricing: string; guides: string; developers: string };
  menu: { label: string; app: string; docs: string; freeKey: string; apiKey: string };
  annc: { badge: string; long: string; short: string; linkHtml: string };
  getPro: (price: string) => string;
  tryFree: string;
  /** The first screen: ready-made samples, eight voice cards, then "Make your own". `ready` holds {name}. */
  show: { label: string; hearHtml: string; stopHtml: string; makeOwn: string; tag: (accent: string, gender: string) => string; play: (name: string, tag: string) => string; note: string; ready: string; own: string };
  hero: { pillHtml: string; h1: string; h1Accent: string; lede: string; upsellTtsHtml: (brand: string) => string; upsellSttHtml: string; promise: readonly [string, string, string]; afterHtml: (brand: string, ttsHref: string) => string };
  trustLabel: string;
  trust: (voices: number) => readonly [string, string, string, string, string];
  make: { h2: string; sub: string; free: string };
  pro: { kicker: string; h2: string; h2Accent: string; sub: (hours: number, price: string) => string; cta: (price: string) => string; trial: string; packs: string; centsHtml: (cents: number) => string; payWithHtml: string; points: readonly Pair[] };
  pricing: { h2: string; h2Accent: string; sub: string; freeName: (brand: string) => string; forever: string; freeItems: (voices: number) => readonly string[]; freeGo: string; compare: string };
  fairHead: { h2: string; h2Accent: string; sub: string };
  how: { h2: string; sub: (brand: string) => string; steps: (voices: number) => readonly Pair[]; goHtml: string };
  faqTitle: string;
  /** The studio-voice plans under the pricing cards. */
  voicePlans: { h3: string; voiceText: (chars: string) => string; bundleName: string; bundleText: (chars: string) => string; voiceGo: (price: string) => string; bundleGo: (price: string) => string; smallHtml: string };
  /** How numbers are written ("100,000" / "100.000" / "100 000"). */
  numberLocale: string;
  dev: { kicker: string; h2: string; sub: (trial: boolean) => string; key: string; freeKey: string; docs: string; more: string; stepsHtml: (trial: boolean) => readonly [string, string, string]; examples: string;
    agents: string; agentsHtml: (catalogue: number, mcp: string, freeCalls: number) => string };
  final: { h2: string; h2Accent: string; sub: string; go: string; app: string };
  sticky: { tryFree: string; pro: (price: string) => string };
  footer: { blurb: string; tts: string; transcribe: string; studio: string; app: string; docs: string; pricing: string; agents: string };
  console?: ConsoleLabels;
  ladder?: LadderStrings;
  /** Words that must never appear on this language's page (speed claims, AI labels, refund promises, accounts). */
  banned: readonly RegExp[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const EN: HomeStrings = {
  languages: (n) => (n ? "More than 90 languages, detected by itself or chosen by you." : "Many languages; choose yours for the best result."),
  title: (brand) => `Free Text to Speech and Transcription Online | ${brand}`,
  description: "Type any text and hear lifelike voices, or turn recordings into text and subtitles. Free in your browser: no sign-up, MP3 and WAV downloads.",
  languageLabel: "Language",
  tryNow: "Try it now",
  tryNowOut: (n) => `That is the real answer, and the request needs no key: ${n} free calls per caller on most tools. After that, one key runs everything.`,
  tabs: { transcribe: "Transcribe", pdf: "PDF to text", law: "EU law search", lawOut: "200 OK: the exact articles, with act, article number, full text and EUR-Lex link." },
  tabTranscribeOut: (long) => `200 OK: transcript, SRT subtitles and word timings for up to an hour of audio. ${long}.`,
  tabPdfOut: (price) => `200 OK: the text of every page as JSON. ${price} a call.`,
  stats: { hour: ["for an hour of transcription", "Up to 60 minutes in one call, with subtitles and word timings"], perK: ["per 1,000 characters of speech", "Natural voices back as MP3, no credit pool to convert"], fail: ["for any call that fails", "Errors, bad input and outages are never charged"] },
  card: { payg: "Pay as you go", aCall: (p) => `${p} a call`, seePricing: "See pricing", cover: (name) => `${name}: code, free try and plans` },
  shelves: { voice: "Voice", documents: "Documents", search: "Search and checks" },
  apis: (k) => `${k} APIs`,
  devPricing: {
    h3: "For your own app or website", p: "Plans add credits every month and unused credits stay.", perMonth: " / month", best: "Best value", oneKey: "One key for every API, unused credits roll over",
    start: (p) => `Start for ${p}`, packsLead: "Or a one-off pack that never expires:", table: "What each plan buys, API by API", plan: "Plan",
    footHtml: (portal) => `Each column is what that amount buys if you spend it all on that one API. <a href="${esc(portal)}">Cancel a plan at any time</a>. Details: <a href="/credits">pricing</a>.`,
    fallback: "Plans and packs", monthLabel: (p) => `${p} a month`, onceLabel: (p) => `${p} once`,
  },
  faq: (f, languages) => [
    ["Is it really free?", `Yes. Making speech and transcripts on this page, on voice.glyphcall.com and in the ${f.brand} app is free, with no account and no daily limit. You only pay if you want a long recording transcribed on our servers with Transcribe Pro, or if you build ${f.brand} into your own app or website.`],
    ["Do I need to sign up?", `No. Type your text or drop your file and press the button. There is nothing to fill in.`],
    ["Are my files private?", `The free tools run on your own device, so your text and recordings are never uploaded. The first time you press Play, your browser downloads the voice once; after that it is ready on that device.`],
    ["Which languages does it understand?", `${languages} Subtitles come as files for YouTube and most video apps (.srt) or for websites (.vtt).`],
    ["How many voices are there?", `${f.voices} voices in the free browser tools and ${f.apiVoices} through the API. Both are our own voices; nothing is uploaded to make either one speak.`],
    ["Can I use it on my phone?", `Yes. Open this page on your phone, or install the free ${f.brand} app from glyphcall.com/app. It works on Windows, Mac, Linux, Android and iPhone, and keeps working offline.`],
    ["What happens when an API call fails?", `You pay nothing. Wrong input, a page that cannot be read or an outside source that is down are all free; only answers that succeed use credits.`],
    ["Can I cancel a plan?", `Any time, from the plan portal, with the e-mail address you paid with. Hours you don't use carry over, and one-off packs never expire.`],
  ],
  prow: ["Text to speech", "Speech to text", "Read aloud", "Subtitles", "Audiobooks", "Podcasts", "App"],
  prowLabel: "What you can make",
  tour: [
    ["Voiceovers", "Make a voiceover: type it, hear it, download it.", "Type your script and pick a voice. Not happy with one line? Redo just that sentence; it is spliced into the same download.", "Make a voiceover"],
    ["Transcripts and subtitles", "Turn a recording into text and subtitles.", "Drop a recording and get the text back, plus subtitle files for YouTube and most video editors. {languages}", "Transcribe a file"],
    ["Audiobooks", "Turn a book or PDF into an audiobook.", "Open a PDF, EPUB or Word file in the studio, choose a narrator and get one audio file per chapter.", "Open the audiobook studio"],
    ["Podcasts and dialogue", "Make a podcast with a voice for each speaker.", "Write who says what, and every person gets their own voice in one audio file. Add pauses where you want them.", "Make a podcast"],
    ["The app", "Use it on your phone or computer, even offline.", "Install {brand} Voice from this site on Windows, Mac, Linux, Android or iPhone. It keeps working without a connection.", "Get the {brand} app"],
  ],
  mocks: {
    voice: ["The harbour woke slowly.", "Gulls called above the empty quay.", "The first boat slipped out."], redo: "Redo",
    transcript: ["Welcome back to the show.", "Today we talk about keeping it simple.", "Let&rsquo;s start with the first question."], subtitles: "Subtitles ready", download: "Download",
    chapters: ["The Harbour", "The Storm", "Home Again"], chapter: "Ch", voiceTag: "Voice", narrator: "Narrator",
    dialogue: ["So what did you think of the ending?", "Honestly? I did not see it coming.", "Neither did I. Let&rsquo;s talk about it."],
    app: ["Install", "Works offline after the first use", "Your text and recordings stay on the device", "MP3, WAV and subtitle downloads"],
  },
  fair: [
    ["No account for the free tools", "Type, play, download. No e-mail, no sign-up form, no trial that ends."],
    ["Retries and previews are free", "Audition every voice and redo any sentence as often as you like. Nothing is counted on this page."],
    ["No CAPTCHA, no watermark", "MP3, WAV and subtitle files from the free tools download clean, with nothing to solve first."],
    ["A failed job costs nothing", "On paid plans and the API, only work that succeeds is counted. Errors and bad input are free."],
    ["Packs never expire", "A one-off pack keeps its balance until you use it. No subscription needed."],
    ["Cancel in one click", "Stop a plan any time from the plan portal with the e-mail you paid with. Hours you don't use carry over."],
  ],
  nav: { tts: "Text to speech", transcribe: "Transcribe", audiobooks: "Audiobooks", pro: "Pro", pricing: "Pricing", guides: "Guides", developers: "Developers" },
  menu: { label: "Menu", app: "Get the app", docs: "Docs", freeKey: "Get a free key", apiKey: "Get an API key" },
  annc: { badge: "New", long: "The free voice tool now also speaks Spanish, French, Italian, Portuguese and Hindi. ", short: "Five more languages in the free voice tool. ", linkHtml: "Try a voice &rarr;" },
  getPro: (p) => `Get Pro: ${p}`,
  tryFree: "Try it free",
  show: {
    label: "Hear our voices", hearHtml: "&#9654;&nbsp; Hear it now", stopHtml: "&#9632;&nbsp; Stop", makeOwn: "Make your own, free",
    tag: (accent, gender) => `${accent} ${gender}`, play: (name, tag) => `Play ${name}, ${tag}`,
    note: "Tap a voice to hear it. Every voice here is free.", ready: "{name} is ready below. Type your words and press Play.", own: "Make your own",
  },
  hero: {
    pillHtml: "Free in your browser &middot; no account &middot; nothing uploaded", h1: "Lifelike voices for", h1Accent: "anything you write.",
    lede: "Type words. Hear them spoken. Free, right here.",
    upsellTtsHtml: (brand) => `Want it inside your own app? See <a href="#developers">${esc(brand)} for developers</a>.`,
    upsellSttHtml: `Long recording? <a href="/transcribe-pro">Transcribe Pro</a> does up to an hour for you.`,
    promise: ["Free MP3 and WAV downloads", "Redo one sentence, keep the rest", "Unlimited previews and retries"],
    afterHtml: (brand, _tts) => `Rather use an app? <a href="/app">Install ${esc(brand)} Voice</a>, free on your phone or computer.`,
  },
  trustLabel: "Why people like it",
  trust: (v) => ["Free, no daily limits", "No account needed", "Your files stay on your device", "Download MP3, WAV or subtitles", `${v} free browser voices`],
  make: { h2: "One studio for every voice job.", sub: "Voiceovers, transcripts, subtitles, audiobooks and podcasts. Every one of these is free to use.", free: "Free" },
  pro: {
    kicker: "Transcribe Pro", h2: "Your long recording as text.", h2Accent: "We do the work.",
    sub: (h, p) => `The free tools run on your phone or computer. Transcribe Pro runs on our servers: long recordings, any device, about ${h} hours a month for ${p}.`,
    cta: (p) => `Start Pro: ${p} a month`, trial: "Try Pro free on one file", packs: "One job? See the one-off packs", centsHtml: (c) => `That is about ${c}&cent; an hour.`,
    payWithHtml: "<b>Pay by card</b> (Visa, Mastercard, American Express) in one step. Apple Pay, Google Pay and Link work too. Your key appears on screen when you pay, with no account.",
    points: [["Long recordings", "Any length in the browser tool: it is compressed and sent in parts for you."], ["More than 90 languages", "Detected by itself, with SRT or VTT subtitles and word timings."], ["Any device", "The work is done on our servers, so a slow phone is as good as a fast computer."]],
  },
  pricing: {
    h2: "Free stays free.", h2Accent: "Pro does the heavy lifting.", sub: "Everything you make on this page and in the app is free, on your own device. Pay only when you want the work done for you.",
    freeName: (b) => `${b} Free`, forever: " forever", freeItems: (v) => ["Text to speech", "Transcripts and subtitles", `All ${v} browser voices`, "Every download", "No account, no limits"], freeGo: "Start for free", compare: "Compare Free and Transcribe Pro",
  },
  fairHead: { h2: "Fair by design.", h2Accent: "No surprises on your bill.", sub: "The things people dislike about voice tools, answered as promises we keep." },
  how: { h2: "As easy as 1, 2, 3", sub: (b) => `No learning curve. If you can type, you can use ${b}.`, steps: (v) => [["Type or drop", "Write some text, or drop in a recording."], ["Pick a voice", `Choose from ${v} voices and set the speed.`], ["Press Play", "Listen, then download it. Done."]], goHtml: "Start now, it&rsquo;s free" },
  faqTitle: "Questions",
  voicePlans: {
    h3: "Want studio voices too?", voiceText: (c) => `50 studio voices made on our servers: about ${c} characters a month, on any device.`,
    bundleName: "Voice and Transcribe Pro", bundleText: (c) => `One balance for both: about ${c} characters of studio voices, or transcription, or any mix.`,
    voiceGo: (p) => `Get Voice Pro: ${p} a month`, bundleGo: (p) => `Get both: ${p} a month`, smallHtml: "Pay by card, Apple Pay, Google Pay or Link. Hours and characters you don't use carry over. Cancel any time.",
  },
  numberLocale: "en-US",
  dev: {
    kicker: "For developers", h2: "Building an app? One key does it all.", sub: (trial) => `The same voices and transcripts, plus document reading and search, as simple web requests. ${trial ? "A free try on every page, and failed" : "Prepaid from $1, and failed"} calls cost nothing.`,
    key: "Get an API key", freeKey: "Get a free key", docs: "Read the docs", more: "See every API, with prices and what each plan buys",
    stepsHtml: (trial) => [`<b>${trial ? "Try it." : "See it."}</b> ${trial ? "Every product page runs the real thing on your own input, free." : "Every product page shows a real example answer."}`, "<b>Get a key.</b> Pay by card; the key is shown on screen when you pay. No account to create.", "<b>Call it.</b> Requests in the formats most voice apps already use work as they are."],
    examples: "Example requests", agents: "For AI agents",
    agentsHtml: (n, mcp, free) => `The same APIs, and the rest of a catalogue of ${n} tools, are available to AI agents: an MCP server at <code>${esc(mcp)}</code> ${free ? `(the first ${free} successful calls are free)` : "(paid per call or with a prepaid key)"} and pay-per-call over HTTP. <a href="/agents">Agent catalogue and payment details</a> · <a href="/tools">all tools</a> · <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">OpenAPI</a>`,
  },
  final: { h2: "Give it a try.", h2Accent: "Type, play, download.", sub: "Free, no account, and nothing to install.", go: "Try it free, no account", app: "Get the app" },
  sticky: { tryFree: "Try it free", pro: (p) => `Get Pro: ${p}/month` },
  footer: { blurb: "Free text to speech and transcription in your browser, and simple APIs for voice, documents and search.", tts: "Text to speech", transcribe: "Transcribe", studio: "Audiobook studio", app: "App", docs: "Docs", pricing: "Pricing", agents: "For AI agents" },
  banned: [],
};

/** Every language's strings; tests/i18n.test.cjs checks each has every key of EN. */
export const HOME_STRINGS: Record<Lang, HomeStrings> = { en: EN, es: ES, de: DE, fr: FR };
