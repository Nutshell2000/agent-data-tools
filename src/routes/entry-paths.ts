/**
 * Entry paths (7 Nov 2026): task-named doors to tools we already sell, for the buyer channels that read a tool's text once.
 *
 * Why: Zero.xyz writes each capability's `whatItDoes` at its FIRST crawl and never again, so the text it holds for our old
 * tools (/weather "lat/lon only", /price/token, /sanctions/check, /wallet/*) keeps them off page one for the tasks its agents
 * ask for most. Zero's demand intents (api.zero.xyz/v1/intents) held us in 1 of 66 on 7 Nov although we sell the tool for
 * about 25 of them, and the one real repeat buyer that week came through the two tasks where we rank #1-2. A NEW URL gets a
 * fresh write: /stock/quote (6 Nov, task-worded) was #2 for "stock price" at once. Each door below is a new path whose name
 * and first sentence are the buyer's task words; it runs the canonical tool's handler, shares its inputs, output and price,
 * and leaves the canonical path untouched (its Bazaar payers and history stay). One door per intent, no more.
 */
import { entry, need, type Entry, type Input } from "../family";
import type { Env } from "../lib/env";
import { AI_TEXT } from "./ai-text";
import { CHAIN_READS } from "./chain-reads";
import { COMPANY } from "./company";
import { DEFI_YIELDS } from "./defi-yields";
import { domainInfo } from "./domain";
import { FEAR_GREED } from "./fear-greed";
import { POLYMARKET } from "./polymarket";
import { PRICES } from "./prices";
import { PUBLIC_DATA } from "./public-data";
import { exchangeRates } from "./rates";
import { SANCTIONS } from "./sanctions";
import { screenshot } from "./screenshot";
import { SEARCH } from "./search";
import { weather } from "./weather";

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

/** /defi/usdc-yield: the yields tool with stablecoin pools forced on and USDC as the default token. */
export const usdcYieldInput = (q: Input): Input => (name) => (name === "stablecoin" ? "true" : name === "symbol" ? (q("symbol")?.trim() || "USDC") : q(name));

const CORE_WEATHER = core("/weather", "$0.01", {
  city: { type: "string", description: "City or place name, e.g. London or Tokyo (used when lat and lon are not given)", example: "London" },
  lat: { type: "number", description: "Latitude in decimal degrees, -90 to 90 (with lon, instead of city)", example: 59.33 },
  lon: { type: "number", description: "Longitude in decimal degrees, -180 to 180 (with lat, instead of city)", example: 18.07 },
  hours: { type: "integer", description: "Hours of hourly forecast to return, 1-48 (default 12; 48 covers tomorrow)", example: 12 },
}, {
  latitude: 59.33, longitude: 18.07, elevationM: 23,
  current: { time: "2026-10-13T09:00:00Z", temperatureC: 7.5, conditions: "cloudy", precipitationMm: 0, windSpeedMs: 1.1, windFromDegrees: 317, humidityPercent: 85.9, cloudCoverPercent: 94.6, pressureHpa: 1024.2 },
  forecast: [{ time: "2026-10-13T10:00:00Z", temperatureC: 8.5, conditions: "partlycloudy_day", precipitationMm: 0, windSpeedMs: 1.2, windFromDegrees: 335, humidityPercent: 83.9, cloudCoverPercent: 73, pressureHpa: 1023.8 }],
  forecastUpdatedAt: "2026-10-13T08:30:57Z", source: "MET Norway (api.met.no), licensed CC BY 4.0", checkedAt: "2026-10-13T09:12:00.000Z",
}, (_env, q) => weather(q("lat"), q("lon"), q("hours"), q("city")));

const CORE_DOMAIN = core("/domain", "$0.01", {
  name: { type: "string", description: "Domain name, e.g. cloudflare.com", required: true, example: "cloudflare.com" },
}, {
  domain: "cloudflare.com", exists: true,
  dns: { a: ["104.16.132.229", "104.16.133.229"], mx: [{ priority: 5, host: "mxa-canary.global.inbound.cf-emailsecurity.net" }], ns: ["ns3.cloudflare.com", "ns4.cloudflare.com"], dnssecValidated: true },
  email: { acceptsMail: true, spfPolicy: "-all", dmarcPolicy: "reject" },
  registration: { registrableDomain: "cloudflare.com", registrar: "Cloudflare, Inc.", registeredAt: "2009-02-17T22:07:54Z", expiresAt: "2033-02-17T22:07:54Z", ageDays: 6441, dnssecSigned: true },
}, (_env, q) => domainInfo(q("name") ?? ""));

const CORE_FX = core("/fx", "$0.01", {
  from: { type: "string", description: "Base currency as a three-letter ISO 4217 code, e.g. USD", required: true, example: "USD" },
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

const YIELDS = from(DEFI_YIELDS, "/defi/yields");
const MARKETS = from(POLYMARKET, "/polymarket/markets");

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
    "Company lookup by name, website domain or Wikidata id: official website, founding date, country, headquarters, industries, CEO, founders, parent, employee count, stock tickers and LEI, from Wikidata (CC0). No match is an uncharged 404. Use to enrich a lead, vendor or counterparty with company data, or to ground an answer about a business.",
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

  door("/crypto/fear-and-greed", "Crypto fear and greed index: today's value, label, changes and history",
    "Crypto Fear and Greed Index today (0 = extreme fear, 100 = extreme greed) from alternative.me: the value and its label, the change against 1, 7 and 30 days ago, the low, high and average over the window, and daily history up to 90 days. Use as a market-sentiment input for a trading agent, a dashboard or a daily brief.",
    ["fear-and-greed-index", "crypto-fear-greed", "market-sentiment", "crypto-sentiment", "bitcoin", "indicator"], from(FEAR_GREED, "/crypto/fear-greed")),
];
