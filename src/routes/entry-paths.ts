/**
 * Entry paths (7 Nov 2026): task-named doors to tools we already sell, for the buyer channels that read a tool's text once.
 *
 * Why: Zero.xyz writes each capability's `whatItDoes` at its FIRST crawl and never again, so the text it holds for our old
 * tools (/weather "lat/lon only", /price/token, /sanctions/check, /wallet/*) keeps them off page one for the tasks its agents
 * ask for most. Zero's demand intents (api.zero.xyz/v1/intents) held us in 1 of 66 on 7 Nov although we sell the tool for
 * about 25 of them, and the one real repeat buyer that week came through the two tasks where we rank #1-2. A NEW URL gets a
 * fresh write: /stock/quote (6 Nov, task-worded) was #2 for "stock price" at once. Each door below is a new path whose name
 * and first sentence are the buyer's task words; it runs the canonical tool's handler, shares its inputs, output and price,
 * and leaves the canonical path untouched (its Bazaar payers and history stay). One door per intent; at most two doors per
 * tool, each named with a different phrase (round 4, 9 Nov).
 */
import { entry, need, type Entry, type Input } from "../family";
import type { Env } from "../lib/env";
import { EXTRACT_OUTPUT_EXAMPLE } from "../lib/extract-example";
import { generateImage } from "./ai";
import { AI_TEXT } from "./ai-text";
import { CHAIN_READS } from "./chain-reads";
import { extract } from "./extract";
import { PAGES } from "./pages";
import { PACKS } from "./packs";
import { PACKS_INTEL } from "./packs-intel";
import { PACKS_MORE } from "./packs-more";
import { bitcoinFees } from "./bitcoin";
import { COMPANY } from "./company";
import { DEFI_YIELDS } from "./defi-yields";
import { domainInfo } from "./domain";
import { emailCheck } from "./email";
import { FEAR_GREED } from "./fear-greed";
import { POLYMARKET } from "./polymarket";
import { PRICES } from "./prices";
import { PUBLIC_DATA } from "./public-data";
import { bitcoinPriceIn, exchangeRates } from "./rates";
import { SANCTIONS } from "./sanctions";
import { screenshot } from "./screenshot";
import { SEARCH } from "./search";
import { weather } from "./weather";
import { CHAIN_MORE } from "./chain-more";
import { CONTRACT_AUDIT } from "./contract-audit";
import { GOV_DATA } from "./gov-data";
import { HYPERLIQUID } from "./hyperliquid";
import { CVE } from "./cve";
import { SEC_FINANCIALS } from "./sec-financials";
import { CRYPTO_TRENDING } from "./crypto-trending";
import { timeInZone } from "./time";
import { MEDIA_TEXT } from "./media-text";
import { PDF } from "./pdf";
import { UTILS } from "./utils";
import { WEB_CHECKS } from "./web-checks";
import { WHALE } from "./whale";

/** The canonical tool each entry path runs (read by tests, the handover notes and the Zero registration check). */
export const ENTRY_OF: Record<string, string> = {};

const from = (list: Entry[], path: string): Entry => {
  const e = list.find((x) => x.endpoint.path === path);
  if (!e) throw new Error(`entry path refers to an unknown tool ${path}`);
  return e;
};

/** A core tool (hand-written in endpoints.ts) as an Entry: its inputs and example are repeated here, because entry-paths
 *  is loaded while endpoints.ts is still being built (families -> entry-paths -> endpoints would be a cycle). */
const core = (path: string, price: string, params: Entry["endpoint"]["params"], outputExample: Record<string, unknown>, run: Entry["run"]): Entry =>
  ({ endpoint: { path, price, summary: "", description: "", tags: [], params, outputExample }, run });

function door(path: string, summary: string, description: string, tags: string[], src: Entry, run: Entry["run"] = src.run, params = src.endpoint.params, example = src.endpoint.outputExample): Entry {
  ENTRY_OF[path] = src.endpoint.path;
  return entry(path, summary, description, tags, params, example, run, src.endpoint.price);
}

/** /page/markdown: the page reader with Markdown as the format when the caller names none. */
export const markdownInput = (q: Input): Input => (name) => (name === "format" ? (q("format")?.trim() || "markdown") : q(name));
/** /defi/usdc-yield: the yields tool with stablecoin pools forced on and USDC as the default token. */
export const usdcYieldInput = (q: Input): Input => (name) => (name === "stablecoin" ? "true" : name === "symbol" ? (q("symbol")?.trim() || "USDC") : q(name));

const CORE_WEATHER = core("/weather", "$0.01", {
  city: { type: "string", description: "City or place name, e.g. London or Tokyo (used when lat and lon are not given; with no place at all the answer is for London)", example: "London" },
  lat: { type: "number", description: "Latitude in decimal degrees, -90 to 90 (with lon, instead of city)", example: 59.33 },
  lon: { type: "number", description: "Longitude in decimal degrees, -180 to 180 (with lat, instead of city)", example: 18.07 },
  hours: { type: "integer", description: "Hours of hourly forecast to return, 1-48 (default 12; 48 covers tomorrow)", example: 12 },
}, {
  latitude: 59.33, longitude: 18.07, elevationM: 23,
  current: { time: "2026-10-13T09:00:00Z", temperatureC: 7.5, conditions: "cloudy", precipitationMm: 0, windSpeedMs: 1.1, windFromDegrees: 317, humidityPercent: 85.9, cloudCoverPercent: 94.6, pressureHpa: 1024.2 },
  forecast: [{ time: "2026-10-13T10:00:00Z", temperatureC: 8.5, conditions: "partlycloudy_day", precipitationMm: 0, windSpeedMs: 1.2, windFromDegrees: 335, humidityPercent: 83.9, cloudCoverPercent: 73, pressureHpa: 1023.8 }],
  forecastUpdatedAt: "2026-10-13T08:30:57Z", source: "MET Norway (api.met.no), licensed CC BY 4.0", checkedAt: "2026-10-13T09:12:00.000Z",
}, (_env, q) => weather(q("lat"), q("lon"), q("hours"), q("city")));

// The two hand-written Bitcoin tools, for the /bitcoin/price and /bitcoin/fees doors. Inputs and examples repeat
// endpoints.ts; the price here is the tool's own, and ACQUISITION_PATHS gives the door the live acquisition price.
const CORE_BTC_PRICE = core("/btc-price", "$0.01", {
  currency: { type: "string", description: "Optional: also price BTC in this currency; the seven listed ones come from the source, others (SEK, NOK, INR, BRL and about 25 more) are converted from USD at the ECB reference rate", example: "SEK" },
}, {
  asset: "BTC",
  prices: { USD: 83463, EUR: 74624, GBP: 63152, CAD: 118855, CHF: 69423, AUD: 119532, JPY: 13210661 },
  satsPerUsd: 1198, usdPerSat: 0.00083463, priceTime: "2026-10-13T09:10:05.000Z",
  source: "mempool.space (average of major exchanges)", checkedAt: "2026-10-13T09:12:00.000Z",
}, (_env, q) => bitcoinPriceIn(q("currency")));

const CORE_BTC_FEES = core("/btc-fees", "$0.002", {}, {
  network: "bitcoin", unit: "sat/vB",
  fees: { nextBlock: 4, halfHour: 3, hour: 1, economy: 1, minimum: 1 },
  typicalPaymentSats: { nextBlock: 564, hour: 141 }, typicalPaymentVbytes: 141,
  source: "https://mempool.space/api",
  limitations: ["Estimates do not guarantee confirmation time", "141 vB is an illustrative one-input/two-output SegWit size; actual transaction size varies", "Source endpoints are fetched concurrently, not as an atomic snapshot"],
  mempool: { transactions: 83832, vsize: 42066150, totalFeesBtc: 0.1093664 },
  blockHeight: 970000, checkedAt: "2026-10-01T00:00:00.000Z",
}, () => bitcoinFees());
const CORE_DOMAIN = core("/domain", "$0.01", {
  name: { type: "string", description: "Domain name, e.g. cloudflare.com", required: true, example: "cloudflare.com" },
}, {
  domain: "cloudflare.com", exists: true,
  dns: { a: ["104.16.132.229", "104.16.133.229"], mx: [{ priority: 5, host: "mxa-canary.global.inbound.cf-emailsecurity.net" }], ns: ["ns3.cloudflare.com", "ns4.cloudflare.com"], dnssecValidated: true },
  email: { acceptsMail: true, spfPolicy: "-all", dmarcPolicy: "reject" },
  registration: { registrableDomain: "cloudflare.com", registrar: "Cloudflare, Inc.", registeredAt: "2009-02-17T22:07:54Z", expiresAt: "2033-02-17T22:07:54Z", ageDays: 6441, dnssecSigned: true },
}, (_env, q) => domainInfo(q("name") ?? ""));

const CORE_FX = core("/fx", "$0.01", {
  from: { type: "string", description: "Base currency as a three-letter ISO 4217 code, e.g. USD (an HTTP call with no input at all answers for USD)", required: true, example: "USD" },
  to: { type: "string", description: "Optional comma-separated target currency codes, e.g. EUR,GBP; default is all available currencies", example: "EUR,GBP,SEK" },
  amount: { type: "number", description: "Optional amount of the base currency to convert (default 1)", example: 100 },
}, {
  from: "USD", amount: 100, rateDate: "2026-10-12", rates: { EUR: 0.89437, GBP: 0.75555, SEK: 10.0139 }, converted: { EUR: 89.437, GBP: 75.555, SEK: 1001.39 },
  source: "European Central Bank reference rates (one rate per working day, published around 16:00 CET)", checkedAt: "2026-10-13T09:00:00.000Z",
}, (_env, q) => exchangeRates(q("from") ?? "", q("to"), q("amount")));

const CORE_SCREENSHOT = core("/screenshot", "$0.01", {
  url: { type: "string", description: "Absolute http(s) URL of the page to capture", required: true, example: "https://example.com" },
  fullPage: { type: "string", description: "Set to true to capture the full page height (max 4000 px) instead of the 1280x800 viewport", example: "true" },
}, {
  url: "https://example.com/", finalUrl: "https://example.com/", status: 200, title: "Example Domain", width: 1280, height: 800, contentType: "image/jpeg", imageBase64: "/9j/4AAQSkZJRgABAQAAAQABAAD...",
}, (env: Env, q) => screenshot(env, q("url"), q("fullPage")));

const CORE_IMAGE = core("/image", "$0.03", {
  prompt: { type: "string", description: "What the image should show (3-800 characters)", required: true, example: "a lighthouse on a cliff at sunset, watercolor" },
  steps: { type: "integer", description: "Diffusion steps, 1-8 (default 4)", example: 4 },
}, { prompt: "a lighthouse on a cliff at sunset, watercolor", steps: 4, model: "@cf/black-forest-labs/flux-1-schnell", contentType: "image/jpeg", imageBase64: "/9j/4AAQSkZJRgABAQAAAQABAAD..." },
(env: Env, q) => generateImage(env, q("prompt"), q("steps")));

const CORE_EXTRACT = core("/extract", "$0.002", {
  url: { type: "string", description: "Absolute http(s) URL of the page to scrape", required: true, example: "https://example.com" },
  maxChars: { type: "integer", description: "Maximum characters of body text to return (500-100000, default 20000)", example: 20000 },
  format: { type: "string", description: "Returned representation: text (default), markdown, or both", enum: ["text", "markdown", "both"], example: "text" },
  section: { type: "string", description: "Optional exact visible HTML ID within the main content, 1-500 characters", example: "retry-policy" },
}, EXTRACT_OUTPUT_EXAMPLE as Record<string, unknown>, (_env, q) => extract(q("url"), q("maxChars"), q("format"), q("section")));

const CORE_EMAIL = core("/email", "$0.01", {
  address: { type: "string", description: "The email address to verify", required: true, example: "support@cloudflare.com" },
}, { address: "support@cloudflare.com", validSyntax: true, domain: "cloudflare.com", domainExists: true, acceptsMail: true, disposable: false, roleAddress: true, freeProvider: false, hasSpf: true, hasDmarc: true, verdict: "likely-deliverable", reasons: ["role address, not a person"] },
(_env, q) => emailCheck(q("address") ?? ""));

const YIELDS = from(DEFI_YIELDS, "/defi/yields");
const MARKETS = from(POLYMARKET, "/polymarket/markets");
const CORE_TIME = core("/time", "$0.01", {
  zone: { type: "string", description: "IANA time zone or city, e.g. Europe/Stockholm, America/New_York or Tokyo (default UTC)", example: "Europe/Stockholm" },
  at: { type: "string", description: "Optional moment to convert, as ISO 8601 with an offset or Unix seconds (default: now)", example: "2026-03-01T09:00:00+01:00" },
  to: { type: "string", description: "Optional comma-separated time zones to convert the same moment into (max 10)", example: "America/New_York,Asia/Tokyo" },
}, {
  utc: "2026-10-13T09:12:00.000Z", unixSeconds: 1791882720, zone: "Europe/Stockholm", localTime: "2026-10-13T11:12:00", isoWithOffset: "2026-10-13T11:12:00+02:00",
  utcOffset: "+02:00", weekday: "Tuesday", abbreviation: "CEST",
  converted: [{ zone: "America/New_York", localTime: "2026-10-13T05:12:00", isoWithOffset: "2026-10-13T05:12:00-04:00", utcOffset: "-04:00", weekday: "Tuesday", abbreviation: "EDT" }],
}, (_env, q) => timeInZone(q("zone"), q("at"), q("to")));const NEWS = from(SEARCH, "/news");
/** /crypto/news: the news tool with a default topic and the past day as the default window. */
export const cryptoNewsInput = (q: Input): Input => (name) => (name === "q" ? (q("q")?.trim() || "cryptocurrency") : name === "freshness" ? (q("freshness")?.trim() || "day") : q(name));

export const ENTRY_PATHS: Entry[] = [
  door("/weather/forecast", "Weather forecast by city: current weather and hourly forecast for any city or coordinates",
    "Weather forecast by city name or coordinates: current temperature, conditions, precipitation, wind, humidity, cloud cover and pressure, plus an hourly forecast up to 48 hours ahead, for any city on Earth (MET Norway data). Give a city such as London or Tokyo, or lat and lon. Use when an agent needs today's weather or tomorrow's forecast for travel, events, logistics or a daily brief.",
    ["weather-forecast", "weather", "forecast", "city-weather", "temperature", "rain"], CORE_WEATHER),

  door("/sanctions/screen", "OFAC sanctions check, wallet: screen a crypto address or a name against the SDN list",
    "OFAC sanctions check for a crypto wallet address or a person or company name: screens against the OFAC SDN list (EVM, Bitcoin, Tron, USDT and more) and returns a verdict (block, review, pass) with every match, its SDN id and programs. A screening aid, not legal advice. Use before paying or accepting funds from an address, when onboarding a counterparty, or as the compliance step of an agent payment flow.",
    ["sanctions-check", "ofac", "ofac-screening", "aml", "compliance", "wallet-screening"], from(SANCTIONS, "/sanctions/check")),

  door("/wallet/balance", "Wallet balance lookup, EVM: native coin and USDC balance on 5 networks in one call",
    "Wallet balance lookup for any EVM address: the native coin (ETH, POL) and USDC balances on Base, Ethereum, Arbitrum, Optimism and Polygon in one call, read live from each network, with the USDC total. Use to check what a wallet holds before a payment, bridge or airdrop, or to confirm that funds arrived.",
    ["wallet-balance", "balance-lookup", "usdc-balance", "evm", "multichain", "onchain-data"], from(CHAIN_READS, "/wallet/balances")),

  door("/token/price", "Token price lookup, USD: live crypto price by symbol or contract address",
    "Token price in USD for any crypto token by symbol (ETH, BTC, LINK, AERO, ARB, OP), coin name or ERC-20 address on Base, Ethereum, Arbitrum or Optimism, read live from the deepest Uniswap v3 pool, with the pool, fee tier, reserve and a thin-liquidity flag. Use to get a crypto price for a quote, a portfolio valuation or a trade check.",
    ["token-price", "crypto-price", "price-lookup", "uniswap", "defi", "market-data"], from(PRICES, "/price/token")),

  door("/defi/usdc-yield", "USDC yield, stablecoin APY: the best stablecoin lending and vault yields now",
    "USDC yield right now: the best stablecoin APY across DeFi lending, vault and LP pools (Aave, Morpho, Compound, Pendle and more) on Ethereum, Base, Arbitrum, Solana and other chains, with APY base and reward, 30-day mean, TVL, exposure and risk flags, from DefiLlama. Filter by chain, protocol or another stablecoin (USDT, DAI). Use to find where an agent can earn yield on USDC or any stablecoin. Not investment advice.",
    ["usdc-yield", "stablecoin-yield", "stablecoin-apy", "defi-yields", "lending-rates", "defillama"], YIELDS,
    async (env, q) => YIELDS.run(env, usdcYieldInput(q)),
    {
      symbol: { type: "string", description: "Stablecoin symbol (default USDC): USDC, USDT, DAI, USDe…", example: "USDC" },
      chain: { type: "string", description: "Chain name(s), comma-separated: Ethereum, Base, Arbitrum, Solana…", example: "Base" },
      project: { type: "string", description: "Protocol slug(s): aave-v3, morpho-blue, compound-v3, pendle…", example: "aave-v3" },
      minTvl: { type: "number", description: "Minimum pool TVL in USD (default 1,000,000)", example: 1000000 },
      limit: { type: "integer", description: "Number of pools (1-50, default 20)", example: 10 },
    }),

  door("/polymarket/search", "Prediction market search: Polymarket odds for any event by keyword",
    "Search Polymarket prediction markets by keyword (election, bitcoin, fed, world cup) and get the matching open markets with outcome odds as implied probabilities, best bid and ask, volume, liquidity, end date and token ids. Use to look up the odds on an event, find a market before reading its order book, or feed a forecasting agent.",
    ["prediction-market", "polymarket", "odds", "market-search", "event-odds", "betting-odds"], MARKETS,
    async (env, q) => { need(q, "q", 200); return MARKETS.run(env, q); },
    {
      q: { type: "string", description: "Search words, e.g. bitcoin, election, fed rates", required: true, example: "bitcoin" },
      limit: { type: "integer", description: "Markets to return, 1-20 (default 10)", example: 5 },
      closed: { type: "string", description: "true for resolved or closed markets instead of open ones", example: "false" },
    }),

  door("/search/web", "Web search API: search the web and get the top results as JSON",
    "Web search API for agents: search the web and get the top results as JSON (title, URL, snippet, published date, domain), optionally with the page text, highlights and a summary of each result, and filters by domain, date range and category. Results are for immediate use only (Brave API terms); failures are uncharged. Use when an agent needs current information, sources or links from the open web.",
    ["web-search", "search-api", "web-search-api", "search-engine", "research", "rag"], from(SEARCH, "/search")),

  door("/domain/whois", "WHOIS lookup, domain lookup: registrar, age, DNS records and email setup of a domain",
    "WHOIS and domain lookup in one call: registrar, registration and expiry dates with the domain's age (RDAP/WHOIS), DNS records (A, AAAA, CNAME, MX, NS, TXT, CAA), DNSSEC, and email authentication (SPF, DMARC). Use to check who owns a domain, how old it is, where it is hosted or whether it accepts mail, for lead research, trust and phishing checks.",
    ["whois-lookup", "domain-lookup", "whois", "dns-records", "domain-age", "registrar"], CORE_DOMAIN),

  door("/company/lookup", "Company lookup, company data: profile of any company by name, domain or id",
    "Company lookup by name, website domain or Wikidata id: official website, founding date, country, headquarters, industries, CEO, founders, parent, employee count, stock tickers and LEI, from Wikidata (CC0). No match is an uncharged 422. Use to enrich a lead, vendor or counterparty with company data, or to ground an answer about a business.",
    ["company-lookup", "company-data", "company-enrichment", "business-data", "kyb", "wikidata"], from(COMPANY, "/company")),

  door("/geocode/address", "Geocode an address, coordinates: place or address name to latitude and longitude",
    "Geocode a place or address to latitude and longitude: a city, town, landmark or address name becomes coordinates, with country, region, population and elevation where known, best match first (Wikidata, CC0). Use to turn a place name into coordinates for maps, distance, weather or routing.",
    ["geocoding", "geocode", "coordinates", "latitude-longitude", "address-lookup", "places"], from(PUBLIC_DATA, "/geocode")),

  door("/fx/rates", "Currency exchange rates API: live rates and conversion for 30 major currencies",
    "Currency exchange rates and conversion: rates from a base currency to one or many currencies (USD, EUR, GBP, JPY, CHF, SEK, CAD, AUD, CNY, INR and about 20 more), with an optional amount to convert, from European Central Bank reference rates. Use to convert prices, settle an invoice in another currency or show a rate in an agent's answer.",
    ["exchange-rates", "currency-exchange-rates", "forex", "currency-conversion", "fx-rates", "finance"], CORE_FX),

  door("/ai/tts", "Text to speech API, TTS: natural voices, MP3 audio from text",
    "Text to speech API: turn up to 300 characters of text into natural, human-sounding speech as an MP3 (base64) with Deepgram Aura-2 voices, in English (40 voices) or Spanish (10). Pick a voice by name or keep the default. Use for voice replies, narration, audio notes, IVR prompts and accessibility.",
    ["text-to-speech", "tts", "tts-api", "voice", "speech-synthesis", "audio"], from(AI_TEXT, "/ai/speech")),

  door("/news/search", "News search API: current news articles on any topic as JSON",
    "News search API: current news articles on any topic from the Brave news index, as JSON with title, URL, snippet, publisher and age, 1-20 results, optionally only from the past day, week or month. Results are for immediate use only (Brave API terms). Use when an agent needs the latest news or headlines on a company, coin, person or event.",
    ["news-search", "news-api", "latest-news", "headlines", "news", "research"], from(SEARCH, "/news")),

  door("/ai/summarize", "Summarize text API: short summary and key points from any text",
    "Summarize text with an LLM: send up to 12,000 characters and get a short summary plus bullet key points. Use for long emails, articles, transcripts, meeting notes and tool outputs; for a web page by URL use /summarize.",
    ["summarize-text", "summarization", "text-summary", "summarizer", "llm", "nlp"], from(AI_TEXT, "/ai/summarize-text")),

  door("/ai/sentiment-analysis", "Sentiment analysis API: positive or negative with a confidence score",
    "Sentiment analysis of text: positive or negative with a confidence score, from a DistilBERT model fine-tuned on SST-2, for English text. Use to classify reviews, support tickets, social posts, headlines and replies at scale, or as the scoring step of a monitoring agent.",
    ["sentiment-analysis", "sentiment", "text-classification", "opinion-mining", "nlp", "reviews"], from(AI_TEXT, "/ai/sentiment")),

  door("/ai/translate-text", "Translate text API: any language to any language with detection",
    "Translate text between languages with an open LLM (gpt-oss-20b; M2M100 for less common languages): the source language is detected, the target is an ISO code such as en, sv, de, fr, es, zh or ja, and long text is split at sentence ends and checked so a cut-off translation is never charged. Use to localise messages, documents, product copy and support replies.",
    ["translate-text", "translation", "translation-api", "localization", "language", "nlp"], from(AI_TEXT, "/ai/translate")),

  door("/ai/embeddings", "Text embeddings API: 1,024-dimension vectors for semantic search and RAG",
    "Text embeddings API: a 1,024-dimension vector for up to 4,000 characters of text in 100+ languages (BAAI BGE-M3), also OpenAI-compatible at /v1/embeddings. Use for semantic search, RAG retrieval, clustering, deduplication and similarity scoring.",
    ["text-embeddings", "embeddings", "embeddings-api", "vector", "semantic-search", "rag"], from(AI_TEXT, "/ai/embed")),

  door("/screenshot/website", "Website screenshot API: capture any web page as an image",
    "Website screenshot API: render any public web page in a real headless Chrome browser with JavaScript executed and get a JPEG screenshot (1280 px wide, base64) plus the final URL, HTTP status and title; fullPage=true captures up to 4000 px of height. Use for visual checks, previews, monitoring and archiving a page as an agent sees it.",
    ["website-screenshot", "screenshot-api", "screenshot", "page-capture", "browser", "monitoring"], CORE_SCREENSHOT),

  // Round 2 (7 Nov 2026, afternoon): Zero's four biggest intents we sell for and had no door to: image generation (98+87
  // agents/90 d), web scraping (79), static hosting (46), LLM chat (9+37 members, our /ai/chat sat at #8).
  door("/image/generate", "Generate image from text prompt: AI image generation, a JPEG in seconds",
    "Generate an image from a text prompt with FLUX.1 schnell: send a prompt, get a 1024x1024 JPEG back as base64 in a few seconds, with an optional steps setting (1-8) for more detail. Use for illustrations, thumbnails, mockups, avatars, product shots and social media images inside an agent workflow.",
    ["image-generation", "text-to-image", "generate-image", "ai-image", "flux", "art"], CORE_IMAGE),

  door("/scrape", "Web scraping API: scrape any web page to clean text or Markdown",
    "Web scraping API: fetch any public web page URL and get its main content as clean text or Markdown (headings, code blocks, tables and links kept), ready for an LLM, RAG or an agent's context; static HTML, Markdown or text pages, up to 100,000 characters. JavaScript-rendered pages: /extract/rendered. Empty pages, bot walls and errors are never charged. Use to read articles, docs and product pages at scale.",
    ["web-scraping", "scrape", "scraper", "web-page-to-markdown", "extract", "rag"], CORE_EXTRACT),

  door("/page/host", "Host static website, web page: a public URL for HTML your agent made",
    "Host a static web page: send HTML (up to 200,000 characters) and an optional title and get a public URL at once, valid up to 7 days; the page is sanitised (no scripts, styles, frames or forms), screened by content moderation and served with noindex. Use to hand a person a report, dashboard or summary your agent produced, or to share results between agents.",
    ["host-static-website", "web-hosting", "publish-html", "host-web-page", "static-site", "share-page"], from(PAGES, "/page/publish")),

  door("/llm/chat", "LLM chat completion API: text generation with Llama 4 Scout",
    "LLM chat completion and text generation: send a prompt (or an OpenAI messages array with tools and JSON mode) and get an answer from Meta's Llama 4 Scout, up to 1,024 output tokens, in a couple of seconds; OpenAI-compatible at /v1/chat/completions. Use for drafting, summaries, classification, reasoning steps and any quick LLM call without an AI provider account.",
    ["llm", "chat-completion", "text-generation", "llm-inference", "openai-compatible", "llama"], from(AI_TEXT, "/ai/chat")),

  // Round 3 (7 Nov 2026): Zero's two email-verification intents (23+21 agents, the #1 member has 375 routed calls) and
  // its llm-inference / gpu-inference intents. The email door says exactly what /email checks: DNS and syntax, no mailbox contact.
  door("/email/verify", "Email address verification: deliverability signals without sending mail",
    "Verify an email address without sending mail: syntax, domain and MX records, disposable and free providers, role addresses, SPF and DMARC presence, with a verdict (likely-deliverable, risky, undeliverable, invalid) and reasons. DNS and syntax signals only: the mailbox itself is not contacted, so this is not proof that a mailbox exists. Use before sending mail, saving a signup or scoring a lead.",
    ["email-verification", "verify-email", "email-validation", "deliverability", "mx-check", "leads"], CORE_EMAIL),

  door("/llm/inference", "LLM inference API, large model: Llama 3.3 70B or gpt-oss-120b",
    "LLM inference with a large open model: send a prompt (optional system prompt, up to 1,024 output tokens) and get an answer from Llama 3.3 70B Instruct or OpenAI gpt-oss-120b in one call, with no provider account; OpenAI-compatible at /v1/chat/completions by model name. Use when a small model is not enough: reasoning, drafting, analysis and Q&A inside an agent workflow.",
    ["llm-inference", "large-language-model", "gpu-inference", "llama-70b", "gpt-oss", "text-generation"], from(AI_TEXT, "/ai/chat-large")),

  door("/crypto/fear-and-greed", "Crypto fear and greed index: today's value, label, changes and history",
    "Crypto Fear and Greed Index today (0 = extreme fear, 100 = extreme greed) from alternative.me: the value and its label, the change against 1, 7 and 30 days ago, the low, high and average over the window, and daily history up to 90 days. Use as a market-sentiment input for a trading agent, a dashboard or a daily brief.",
    ["fear-and-greed-index", "crypto-fear-greed", "market-sentiment", "crypto-sentiment", "bitcoin", "indicator"], from(FEAR_GREED, "/crypto/fear-greed")),

  // Round 4 (9 Nov 2026): short names. Zero picks ~50 candidates per search by similarity to the query, and a long
  // multi-phrase name falls outside that pool for a short query: /token/price is #1 for "token price lookup" but absent
  // from all 53 results for "token price", where the winners are named just "Token Price". So each name below is the bare
  // phrase agents type, and the first sentence repeats it. At most two doors per tool, each with its own phrase.
  door("/price/crypto", "Crypto price: live USD price of a coin or token",
    "Crypto price and token price in USD, live: give a symbol (ETH, BTC, LINK, AERO, ARB, OP), a coin name or an ERC-20 address and get its price from the deepest Uniswap v3 pool on Base, Ethereum, Arbitrum or Optimism, with the pool and a thin-liquidity flag. Use to price a token for a quote, a portfolio or a trade.",
    ["crypto-price", "token-price", "coin-price", "price", "defi", "market-data"], from(PRICES, "/price/token")),

  door("/web/search", "Web search: top results for any query",
    "Web search: send a query and get the top web results as JSON (title, URL, snippet, published date), optionally with page text and highlights, filtered by domain, date or category. Results are for immediate use only (Brave API terms); failures are uncharged. Use when an agent needs current facts, sources or links.",
    ["web-search", "search", "search-engine", "internet-search", "research", "rag"], from(SEARCH, "/search")),

  door("/balance/wallet", "Wallet balance: ETH and USDC of an address",
    "Wallet balance of any EVM address: the native coin (ETH, POL) and USDC on Base, Ethereum, Arbitrum, Optimism and Polygon in one call, read live, with the USDC total. Use to check what a wallet holds before a payment or to confirm funds arrived.",
    ["wallet-balance", "balance", "eth-balance", "usdc-balance", "evm", "multichain"], from(CHAIN_READS, "/wallet/balances")),

  // 10 Nov 2026: named for the search that carries the market's biggest flow of new wallets. "current weather" is led by one
  // listing with 315 payers in 30 days (+266 in three days); a listing named "Current weather" with 2 payers sat at #2
  // behind it, and our /weather was #7. Agent402's router scores the URL slug most and its winner is /weather/current, so the
  // door moved here from /weather/today (9 Nov, never listed on the Bazaar); index.ts redirects the old path.
  door("/weather/current", "Current weather: any city, right now",
    "Current weather for any city or coordinates: temperature, conditions, rain, wind, humidity and pressure right now, plus an hourly forecast up to 48 hours ahead (MET Norway data). Give a city such as London or lat and lon. Use when an agent needs the weather now or today's forecast for travel, events, logistics or a daily brief.",
    ["current-weather", "weather", "weather-now", "temperature", "forecast", "city-weather"], CORE_WEATHER),
  door("/ofac/check", "OFAC sanctions check: wallet or name",
    "OFAC sanctions check: screen a crypto wallet address (EVM, Bitcoin, Tron and more) or a person or company name against the OFAC SDN list and get a verdict (block, review, pass) with every match, SDN id and program. A screening aid, not legal advice. Use before paying or accepting funds, or when onboarding a counterparty.",
    ["ofac", "sanctions-screening", "sanctions-check", "sdn", "aml", "compliance"], from(SANCTIONS, "/sanctions/check")),

  door("/whois/lookup", "WHOIS lookup: who owns a domain",
    "WHOIS lookup for a domain: registrar, creation and expiry date and age (RDAP/WHOIS), plus its DNS records and email setup (SPF, DMARC). Use to check who registered a domain, how old it is and where it is hosted, for lead research and phishing checks.",
    ["whois", "whois-lookup", "domain-whois", "registrar", "domain-age", "rdap"], CORE_DOMAIN),

  door("/dns/records", "DNS lookup: records of a domain",
    "DNS lookup of a domain: A, AAAA, MX, TXT, CNAME, NS, CAA, SOA and other records through Cloudflare DNS over HTTPS, with TTLs, the response code and DNSSEC validation. Use to check where a domain points, its mail servers or a TXT verification record.",
    ["dns-lookup", "dns", "dns-records", "mx-records", "txt-records", "domain"], from(WEB_CHECKS, "/dns/lookup")),

  door("/sec/edgar", "SEC filings: 10-K, 10-Q, 8-K by ticker",
    "SEC filings of a US public company from EDGAR by ticker or CIK: the latest 10-K, 10-Q, 8-K, Form 4 and other forms with dates and document links, optionally one form type. Use to find a company's annual or quarterly report, insider trades or recent events.",
    ["sec-filings", "edgar", "10-k", "10-q", "8-k", "financial-data"], from(GOV_DATA, "/sec/filings")),

  door("/language/detect", "Detect language: which language a text is",
    "Detect language of a text: the language as an ISO 639-1 and 639-3 code with its English name, from 82 languages (franc), offline and fast. Use to route a message to the right translator, model or support team, or to tag content by language.",
    ["detect-language", "language-detection", "language", "nlp", "text", "translation"], from(MEDIA_TEXT, "/text/language")),

  door("/whales", "Whale transfers: big USDC and USDT moves",
    "Whale transfers: the largest USDC and USDT transfers of the last minutes on Base, Ethereum, Arbitrum, Optimism or Polygon above a size you choose (default 100,000 USD), with sender, receiver, amount and transaction. Use for whale alerts, flow monitoring and market-moving transfers.",
    ["whale-transfers", "whale-alert", "large-transfers", "stablecoin", "onchain-data", "monitoring"], from(WHALE, "/whale/transfers")),

  door("/json/validator", "JSON validator: is this valid JSON",
    "JSON validator: check whether a text is valid JSON and get the error position and message when it is not, plus the parsed type. Use before parsing an LLM's JSON output, saving a config or sending a request body.",
    ["json-validator", "validate-json", "json", "json-lint", "developer-tools", "parser"], from(UTILS, "/json/validate")),

  door("/holidays/public", "Public holidays: dates for any country",
    "Public holidays for a country and year: date, local and English name, whether it is nationwide and the observed day, for over 100 countries. Use to plan deliveries, schedules and business days, or to tell whether today is a holiday somewhere.",
    ["public-holidays", "holidays", "bank-holidays", "calendar", "country", "business-days"], from(PUBLIC_DATA, "/holidays")),

  door("/pdf/extract", "Extract text from a PDF URL",
    "Extract text from a PDF by URL: the text of each page of a public PDF file (up to 10 MB), with the page count, title and author; scanned PDFs without a text layer fail uncharged. Use to read reports, papers, invoices and filings into an LLM, RAG or an agent's context.",
    ["pdf-to-text", "extract-pdf-text", "pdf", "pdf-parser", "document", "rag"], from(PDF, "/pdf/text")),

  door("/uniswap/liquidity", "Uniswap pool liquidity: reserves and price",
    "Uniswap pool liquidity for a token pair: every Uniswap v3 pool by fee tier with its in-range liquidity, both token balances held, price and current tick, deepest first, read live on Base, Ethereum, Arbitrum, Optimism or Polygon. Use to check a pool's depth before a swap or to price a token from its pool.",
    ["uniswap-pool", "pool-liquidity", "liquidity", "uniswap", "defi", "dex"], from(CHAIN_MORE, "/uniswap/pool")),

  // Round 8 (10 Nov 2026): five more jobs sold elsewhere under a path that names them. Evidence the same day: Mercator's
  // router sent "page to Markdown" listings about 520 calls in 30 days (/md 210, /proxy/web-scrape 258) and for that search
  // ranked our /markdown/to-html, not /extract; Zero's intent "web page to markdown" has 55 searches; the Bazaar's
  // "markdown" listings 1,135 calls. Agent402's router gave /cve nothing for "cve lookup" (every winner's slug is
  // cve_lookup). Wikipedia summary listings 537 calls (the leader, /summary, 24 payers), "trending" 2,686 calls (36 payers
  // on /market/trending), "ohlcv" 647 calls (35-42 payers on the two leaders) against 2 payers on ours.
  // /extract gets a third door here: its first two are named for scraping and fetching, and neither holds "markdown".
  door("/page/markdown", "Web page to Markdown: any URL",
    "Web page to Markdown: give a public URL and get the page's main content as clean Markdown for an LLM, with headings, links, lists, tables and code blocks kept and navigation, ads and scripts removed, up to 100,000 characters; static HTML, Markdown and text pages. Bot walls, empty pages and errors are never charged. Use to put an article, documentation page or blog post into a prompt, a RAG index or an agent's notes.",
    ["web-page-to-markdown", "url-to-markdown", "html-to-markdown", "page-markdown", "markdown", "llm-ready"], CORE_EXTRACT,
    (env, q) => CORE_EXTRACT.run(env, markdownInput(q)),
    {
      url: { type: "string", description: "Absolute http(s) URL of the page to convert", required: true, example: "https://www.iana.org/help/example-domains" },
      maxChars: CORE_EXTRACT.endpoint.params.maxChars,
      format: { type: "string", description: "Returned representation: markdown (default), text, or both", enum: ["text", "markdown", "both"], example: "markdown" },
      section: CORE_EXTRACT.endpoint.params.section,
    },
    // A real answer for the example URL (10 Nov 2026), body shortened.
    {
      url: "https://www.iana.org/help/example-domains", finalUrl: "https://www.iana.org/help/example-domains", status: 200, contentType: "text/html; charset=utf-8", sourceFormat: "html",
      linkBaseUrl: "https://www.iana.org/help/example-domains", sourceMetadata: { verification: "not_verified", authors: [], dates: [], truncated: false },
      title: "Example Domains", description: null, lang: null, canonical: null,
      headings: [{ level: 1, text: "Example Domains", id: "example-domains" }, { level: 2, text: "Further Reading", id: "further-reading" }],
      section: null, links: [{ href: "https://www.iana.org/domains/reserved", text: "IANA-managed Reserved Domains" }], tables: [], codeBlocks: [], contentSelection: "main", warnings: [],
      format: "markdown",
      markdown: "# Example Domains\n\nA number of domains such as `example.com` and `example.org` are maintained for documentation purposes. …\n\n## Further Reading\n\n- [IANA-managed Reserved Domains](https://www.iana.org/domains/reserved)",
      textLength: 788, truncated: false, contentHash: "sha256:1a422ba91cd1edcba03aef51b09aaba9bc677a48efa55065b9284cf2bfec0ddd", hashFormat: "markdown", fetchedAt: "2026-11-10T22:01:30.410Z",
    }),

  // Round 9 (11 Nov 2026): the two phrases the Bazaar's statement sellers are found by. Listings with "fundamentals" in the
  // path or name had 60 calls in 30 days (three payers at $0.10 on the leader), "income-statement" and "balance-sheet" paths
  // 3-4 payers each at $0.02 (financialdatasets.ai); /sec/financials keeps the SEC name for agents that search EDGAR.
  door("/stock/fundamentals", "Stock fundamentals: financials by ticker",
    "Stock fundamentals by ticker (AAPL, MSFT, NVDA): revenue, gross, operating and net income, EPS, margins, revenue and earnings growth, ROE, cash, debt, equity, free cash flow, dividends and buybacks for the last fiscal years or quarters, from the company's SEC 10-K and 10-Q filings. Use to screen a stock, value a company or compare two businesses.",
    ["stock-fundamentals", "fundamentals", "financial-statements", "stocks", "earnings", "valuation"], from(SEC_FINANCIALS, "/sec/financials")),

  door("/income-statement", "Income statement, balance sheet: by ticker",
    "Income statement, balance sheet and cash flow statement of a US-listed company by ticker: revenue, cost of revenue, gross profit, R&D, operating income, net income, EPS, assets, liabilities, equity, cash and debt, operating cash flow and capex, annual or quarterly, read from its SEC 10-K and 10-Q XBRL filings. Use to read a company's financial statements without parsing the filing.",
    ["income-statement", "balance-sheet", "cash-flow-statement", "financial-statements", "sec", "xbrl"], from(SEC_FINANCIALS, "/sec/financials")),
  door("/cve/lookup", "CVE vulnerability lookup: by CVE ID",
    "CVE vulnerability lookup by ID (CVE-2021-44228): the description, CVSS score and severity, whether CISA lists it as exploited in the wild (KEV) and since when, the EPSS probability of exploitation in the next 30 days, the weakness (CWE), affected products with fixed versions, and patch and advisory links. Use to triage a security alert, decide what to patch first, or check an advisory before upgrading a dependency.",
    ["cve-lookup", "vulnerability-lookup", "cve", "security-advisory", "kev", "epss"], from(CVE, "/cve")),

  door("/wiki/summary", "Wikipedia summary: by article title",
    "Wikipedia summary of an article by its title: the one-paragraph extract in plain text with the short description, the page link and the thumbnail image, from the English edition or any other language edition, with the CC BY-SA attribution to show. Use to get quick background on a subject, ground an answer in a citable encyclopedia source, or check what a name refers to.",
    ["wikipedia-summary", "wiki-summary", "wikipedia", "encyclopedia", "knowledge", "background"], from(PUBLIC_DATA, "/wikipedia")),

  door("/market/trending", "Trending crypto: coins trending now",
    "Trending crypto right now: the coins people search most on CoinGecko in the last 24 hours, with symbol, market-cap rank, price and 24-hour change, plus the trending categories. No input needed. Use to see what the market is watching today, seed a watchlist, or give a trading agent or daily brief its market context.",
    ["trending-crypto", "market-trending", "trending-coins", "crypto", "market-data", "watchlist"], from(CRYPTO_TRENDING, "/crypto/trending")),

  door("/market/ohlcv", "Crypto OHLCV: candles for any coin",
    "Crypto OHLCV candles for any coin (BTC, ETH, SOL, HYPE…): open, high, low, close and volume per bar from Hyperliquid perpetuals, on intervals from 1 minute to 1 week, up to 500 bars, newest last. Without a coin the answer is for BTC. Use to chart a price, compute indicators, backtest a rule or give a trading agent recent price history.",
    ["crypto-ohlcv", "ohlcv", "candles", "price-history", "klines", "market-data"], from(HYPERLIQUID, "/hyperliquid/candles")),
  // Round 7 (10 Nov 2026, placed here so it does not collide with round 6 at the end of the list): three jobs buyers pay other sellers for under a path that names the job, while ours sat under
  // /time and /hyperliquid/market. Bazaar snapshot of 9 Nov, 30-day figures: listings with "timezone" in the path 850 calls
  // (the leader /timezone-convert 9 payers), /current-time 34 calls from 9 payers at $0.005, listings with "funding" 1,629
  // calls (agent402's /perp-funding 1,042 calls from 14 payers; Mercator's gateway bought it 73 times in a week). Mercator's
  // search matches path words first: for "timezone convert" our /time was #18 and for "perp funding" we were absent
  // (business/agentic/base-bots/mercator-jobs.mjs). All three answer a call with no input.
  door("/timezone/convert", "Timezone convert: a time in other zones",
    "Timezone convert: turn a moment (or now) into up to 10 other time zones in one call, with each zone's local time, UTC offset, weekday and abbreviation, daylight saving time handled. Zones as IANA names or cities (Europe/Stockholm, New York, Tokyo, UTC+2). Use to schedule a meeting across time zones, convert a timestamp for a user, or check business hours somewhere else.",
    ["timezone-convert", "time-zone-converter", "timezone", "convert-time", "world-clock", "scheduling"], CORE_TIME, CORE_TIME.run,
    // `to` comes first so the published example (the first input with an example) is a real conversion, not just "now".
    {
      to: { type: "string", description: "Time zones or cities to convert into, comma-separated, up to 10 (e.g. America/New_York,Asia/Tokyo)", example: "America/New_York,Asia/Tokyo" },
      at: CORE_TIME.endpoint.params.at,
      zone: { type: "string", description: "Time zone or city the result is shown in first, e.g. Europe/Stockholm (default UTC)", example: "Europe/Stockholm" },
    }),

  door("/time/now", "Current time: now in any time zone",
    "Current time in any time zone or city: the exact date and time now with UTC offset, weekday, zone abbreviation and Unix timestamp (UTC when no zone is given), daylight saving time handled. Use when an agent needs to know what time or date it is right now, to timestamp a record, or to check whether a place is inside business hours.",
    ["current-time", "time-now", "world-clock", "date-today", "unix-timestamp", "timezone"], CORE_TIME),

  door("/perp/funding", "Perp funding rate: live, by coin",
    "Perp funding rate now for a coin (BTC, ETH, SOL, HYPE…): the hourly funding rate and its APR, premium, mark and oracle price, open interest in coins and USD, 24-hour volume and price change on Hyperliquid perpetual futures. Without a coin, the 20 most traded markets. Use to compare funding before opening a perp position, to find a basis or carry trade, or to feed a derivatives dashboard.",
    ["perp-funding", "funding-rate", "perpetuals", "open-interest", "hyperliquid", "derivatives"], from(HYPERLIQUID, "/hyperliquid/market")),

  // Round 5 (10 Nov 2026): the tasks most open shoppers pay for that we already sell under another name. Counted in a
  // two-day sample of 50 wallets that each pay 8+ sellers: website technology detection 10 buyers, email auth 8, URL fetch
  // 7-8, crypto news 9. In the Bazaar search the top results for those phrases are named with the phrase ("Email Auth
  // Check", "Website technology detector", "Crypto News"); ours were absent or lower under "Email deliverability", "Tech
  // stack detection", "Scrape website page" and "News headlines". The 7 Nov weather door is the proof that a task-named
  // door works: it had 19 distinct payers three days later, more than any older listing of ours.
  door("/web/fetch", "Web fetch: get a URL as clean text",
    "Web fetch for agents: fetch any public URL and get the page's main content as clean text or Markdown (headings, links, tables and code blocks kept), up to 100,000 characters; static HTML, Markdown and text pages. Bot walls, empty pages and errors are never charged. Use to read a web page, article or documentation URL into an LLM's context or a RAG pipeline.",
    ["web-fetch", "fetch-url", "url-fetch", "read-url", "http-fetch", "web-page"], CORE_EXTRACT),

  door("/email/auth", "Email auth check: SPF, DKIM, DMARC",
    "Email authentication check for a domain: the SPF record and its all-policy, DKIM keys at the common selectors, the DMARC record and policy, plus MX, MTA-STS, TLS-RPT and BIMI, with a 0-100 score, a grade and a list of fixes. Public DNS only; no mail is sent. Use to verify a sender domain's SPF, DKIM and DMARC setup, to debug mail landing in spam, or to vet a domain before trusting its mail.",
    ["email-auth", "spf-dkim-dmarc", "spf-check", "dmarc-check", "dkim", "email-security"], from(PACKS, "/pack/email-deliverability")),

  door("/tech/detect", "Website technology detection: CMS and stack",
    "Website technology detection: which CMS or site builder, JavaScript framework, analytics and ad pixels, payment, support and captcha widgets, CDN, hosting and web server a site runs on, read from its home page HTML and response headers, each with the evidence found. Use for lead qualification, competitor research, security reviews and sales prospecting by technology.",
    ["technology-detection", "website-technology", "tech-detect", "tech-stack", "cms-detection", "lead-qualification"], from(PACKS_INTEL, "/tech/stack")),

  // A call with no topic answers with general crypto headlines of the past day, so a router that plans it empty succeeds.
  door("/crypto/news", "Crypto news: latest headlines",
    "Crypto news today: the latest cryptocurrency headlines (bitcoin, ethereum, DeFi, regulation, markets), or news on any coin or topic you name, as JSON with title, URL, snippet, publisher and age, 1-20 results, from the past day unless you choose a week or month. Results are for immediate use only (Brave API terms). Use to brief a trading agent, follow a coin's news or build a daily crypto digest.",
    ["crypto-news", "cryptocurrency-news", "bitcoin-news", "market-news", "headlines", "news"], NEWS,
    (env, q) => NEWS.run(env, cryptoNewsInput(q)),
    { ...NEWS.endpoint.params, q: { type: "string", description: "Coin or topic, e.g. bitcoin ETF (default: cryptocurrency news in general)", example: "bitcoin ETF" } }),

  // Round 6 (11 Nov 2026), written for the full re-settle of that day: a settlement is the one moment a listing's name
  // reaches the Bazaar, and a new URL starts its listing age (about 30 days outside the scored tier) from its first
  // payment, so the phrases we were missing go out together. Each is a search where the tool exists and the name lacked
  // the phrase (base-bots/name-plan.mjs, flip-candidates.mjs): "bitcoin price" (vAPI Call: one result), "bitcoin fee
  // estimate" (Zero: absent), "gas price" (#8), "company enrichment" (absent, 11 results, leader with one payer),
  // "transaction decoder" (#2), "url unshortener" (#3), "exif" (#3), "market sentiment"
  // (#9). Three take no input at all, which is what a marketplace console's empty form sends.
  door("/bitcoin/price", "Bitcoin price: BTC in USD, EUR and more",
    "Bitcoin price now: the current BTC spot price in USD, EUR, GBP, CAD, CHF, AUD and JPY, averaged across major exchanges, with satoshis per US dollar and the time of the price; name a currency such as SEK or INR for one more. No input needed. Use to value a Bitcoin or Lightning payment, convert between sats and fiat, or check the BTC price before a trade.",
    ["bitcoin-price", "btc-price", "btc-usd", "crypto-price", "bitcoin", "market-data"], CORE_BTC_PRICE),

  door("/bitcoin/fees", "Bitcoin fee estimate: sat/vB now",
    "Bitcoin fee estimate: current fee rates in sat/vB for next-block, half-hour, one-hour and economy confirmation, what a typical payment costs in sats, mempool size and pending fees, and the latest block height, from mempool.space. No input needed. Use before sending a Bitcoin transaction or to decide whether to wait for lower fees.",
    ["bitcoin-fees", "bitcoin-fee-estimate", "mempool", "btc-fees", "sat-vb", "bitcoin"], CORE_BTC_FEES),

  door("/gas/price", "Gas price: every major EVM chain",
    "Gas price now on Base, Ethereum, Arbitrum, Optimism and Polygon in one call: gas price, base fee and priority fee in gwei, what a plain transfer costs in the native coin and, for the ETH chains, in US dollars, sorted cheapest first, plus Bitcoin fee rates. No input needed. Use to pick the cheapest chain, time a transaction or show current fees in a wallet.",
    ["gas-price", "gas-fees", "gwei", "gas-tracker", "multichain-gas", "evm"], from(PACKS_INTEL, "/pack/gas-tracker")),

  door("/company/enrichment", "Company enrichment: from a domain",
    "Company enrichment from a domain: the site's name, description and logo, its tech stack (CMS, frameworks, analytics, hosting), email provider and email security (SPF, DMARC), who hosts the server, DNS records, and the domain's registrar, age and expiry. Public DNS, RDAP and the home page only. Use for lead enrichment, company research, vendor checks or sales prospecting.",
    ["company-enrichment", "lead-enrichment", "company-research", "domain-enrichment", "firmographics", "sales-prospecting"], from(PACKS_INTEL, "/pack/domain-intel")),

  door("/tx/decode", "Transaction decoder: what a tx did",
    "Transaction decoder for EVM chains: success or revert, sender and contract, ETH value, fee, the function called (decoded for common ERC-20, ERC-721, WETH, permit and multicall calls), and every token transfer, mint, burn and approval it emitted with amounts and symbols, plus one-line summaries. Base, Ethereum, Arbitrum, Optimism or Polygon. Use to check what a payment or contract call really did before trusting or reporting it.",
    ["transaction-decoder", "decode-transaction", "tx-decoder", "explain-transaction", "evm", "onchain-data"], from(PACKS_MORE, "/pack/tx-explain")),

  // 1.131.0: the same audit under the path order other sellers and searches use ("contract audit").
  door("/contract/audit", "Contract audit: Solidity security review by address or source",
    "Contract audit for Solidity and Vyper: give a verified contract address (Ethereum, Base, Arbitrum, Optimism, Polygon) or paste the source, and one call returns security findings by severity with function, line, exploit scenario and fix, who holds the owner and upgrade keys on chain, a score and a Markdown report, in about a minute. Automated review, not a manual audit. Use before deploying, integrating with or buying into a contract.",
    ["contract-audit", "solidity-audit", "smart-contract-audit", "security-review", "audit", "evm"], from(CONTRACT_AUDIT, "/audit/contract")),

  door("/url/unshorten", "URL unshortener: final destination",
    "URL unshortener: expand a short link (bit.ly, t.co and others) to its final destination without loading the page, with every redirect hop's status code and Location, total hops, timing and whether it loops. Each hop is checked before it is requested; redirects to private addresses are reported, not followed. Use to see where a link really goes before opening or sharing it.",
    ["url-unshortener", "unshorten-url", "expand-url", "link-expander", "redirects", "link-safety"], from(WEB_CHECKS, "/url/redirects")),

  door("/exif", "EXIF data: camera, date and GPS",
    "EXIF data of a photo from its URL: camera make and model, lens, date taken, exposure, aperture, ISO, focal length, orientation, software and the GPS position (latitude, longitude, altitude) when it was recorded, with the image format, width and height. JPEG EXIF; PNG, GIF and WebP give size only. Up to 15 MB. Use to check where and when a photo was taken or to verify an upload.",
    ["exif", "exif-data", "photo-metadata", "image-metadata", "gps-from-photo", "image"], from(MEDIA_TEXT, "/image/metadata")),

  door("/market/sentiment", "Market sentiment: crypto fear and funding",
    "Market sentiment for crypto in one call: the Fear & Greed index with its 7-day change (alternative.me, attributed), the 10 most traded Hyperliquid perpetuals with price, 24-hour change, funding and open interest, and technical readings (RSI, MACD, moving averages) for up to three coins. No input needed. Use for a daily market brief, a trading agent's context or a risk-on, risk-off check.",
    ["market-sentiment", "crypto-sentiment", "fear-and-greed", "funding-rates", "market-brief", "crypto"], from(PACKS, "/pack/crypto-market")),
];
