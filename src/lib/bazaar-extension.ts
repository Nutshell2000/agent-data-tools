import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { BUILDER_CODE, declareBuilderCodeExtension } from "@x402/extensions/builder-code";
import type { Endpoint } from "../endpoints";

/**
 * Our Base Builder Code (ERC-8021, registered on base.dev). Every x402 v2 and MPP evm payment declares it as the app
 * code; a facilitator that supports the builder-code extension appends it to the settlement transaction, which
 * attributes our onchain volume to us on Base (a prerequisite of the Base Builder Grants). It changes no price or term.
 */
export const BUILDER_APP_CODE = "bc_09e30bdm";

export function builderCodeExtension() {
  return { [BUILDER_CODE]: declareBuilderCodeExtension(BUILDER_APP_CODE) };
}
import { exampleParams } from "../endpoints";
import { schemaFromExample } from "./output-schema";

/**
 * The Coinbase Bazaar discovery metadata for one tool: what the facilitator indexes after the first settled
 * payment. Shared by the x402 paywall (every 402 carries it) and the MPP evm settlement (lib/mpp-evm.ts), which
 * sends it with the payment payload so an MPP settlement can index the tool too.
 */
/** A pattern for inputs that only take a 0x address or a 32-byte hash, so agents can validate before paying. */
function formatOf(p: Endpoint["params"][string]): { pattern?: string } {
  if (typeof p.example !== "string" || /\bens\b|name/i.test(p.description)) return {};
  if (/^0x[0-9a-fA-F]{40}$/.test(p.example)) return { pattern: "^0x[0-9a-fA-F]{40}$" };
  if (/^0x[0-9a-fA-F]{64}$/.test(p.example)) return { pattern: "^0x[0-9a-fA-F]{64}$" };
  return {};
}

/** One input schema for every listing (HTTP 402 and MCP payments): types, enums, patterns and an example each. */
export function bazaarInputProperties(e: Endpoint) {
  return Object.fromEntries(
    Object.entries(e.params).map(([k, p]) => [k, { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}), ...formatOf(p), examples: [p.example] }]),
  );
}
export const requiredInputs = (e: Endpoint) => Object.entries(e.params).filter(([, p]) => p.required).map(([k]) => k);
/** The published example call's inputs: what the Bazaar sends when it checks a listed tool (HTTP and MCP alike). */
export const exampleInput = (e: Endpoint) => Object.fromEntries(exampleParams(e).map(([k, p]) => [k, p.example]));
/**
 * The listing travels base64-encoded in the PAYMENT-REQUIRED header, next to one accepts entry per network and the
 * MPP challenges. Node's fetch (undici) refuses responses with more than 16 KB of headers, and /extract's full
 * output schema (6.9 KB) pushed its 402 to 16.7 KB on 22 Oct, so Node agents could not read the quote. A schema
 * larger than this budget is listed in its compact form, derived from the example; OpenAPI keeps the full one.
 */
const LISTING_SCHEMA_BUDGET = 3000;
export const listingOutputSchema = (e: Endpoint) =>
  e.outputSchema && JSON.stringify(e.outputSchema).length <= LISTING_SCHEMA_BUDGET ? e.outputSchema : schemaFromExample(e.outputExample);

export function bazaarExtensionFor(e: Endpoint) {
  return declareDiscoveryExtension({
    input: exampleInput(e),
    inputSchema: { properties: bazaarInputProperties(e), required: requiredInputs(e) },
    output: { example: e.outputExample, schema: listingOutputSchema(e) },
  });
}

/** Tags that most tools share; they say little to a search, so they go after the specific ones. */
const GENERIC_TAGS = new Set(["blockchain", "evm", "utility", "chain-data", "data"]);

/**
 * The task phrases buyers type into the Bazaar search, as tags, per tool (business/agentic/base-bots/search-ranks.mjs
 * measures them daily). Inside a tier of equal 30-day payers the Bazaar orders by text relevance; a tag holding a query
 * word won 55% of 206 tied pairs on 22 Oct 2026, the name 56%, price and recency nothing. Each phrase must describe
 * what the tool does.
 */
export const SEARCH_TAGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "/search": ["web-search"],
  "/econ/gdp": ["gdp", "world-bank"], "/econ/inflation": ["inflation-rate"], "/econ/population": ["population"],
  "/econ/unemployment": ["unemployment-rate"], "/weather": ["weather-forecast"], "/price/token": ["token-price", "crypto-price", "dex-price"],
  "/sanctions/check": ["sanctions-check", "ofac-screening"], "/check/payee": ["payee-screening"],
  "/wallet/balances": ["wallet-balance", "usdc-balance"], "/wallet-audit": ["wallet-risk"], "/extract/rendered": ["web-page-to-markdown"],
  "/extract": ["scrape-website", "web-scraping"], "/email": ["email-verification"], "/company": ["company-data"],
  "/domain-report": ["domain-lookup", "trust-score"], "/domain": ["dns-lookup", "whois-lookup"], "/eth/gas": ["gas-price", "gas-fee-estimate"],
  "/btc-fees": ["bitcoin-fees"], "/pdf/text": ["pdf-to-text"], "/geocode": ["geocoding"], "/sec/filings": ["sec-filings"],
  "/token-report": ["honeypot-token-check", "token-security"], "/contract-risk": ["smart-contract-risk"], "/check/x402-seller": ["x402-audit"],
  "/ai/chat": ["chat-completions", "llm-chat-completion"], "/ai/embed": ["text-embeddings", "openai-compatible"],
  "/eth/balance": ["ethereum-balance"], "/hyperliquid/market": ["hyperliquid-funding"], "/airport/status": ["airport-delays"],
  "/fx": ["currency-exchange-rate", "forex", "exchange-rates"], "/screenshot": ["website-screenshot"], "/ai/translate": ["translate-text"],
  "/ai/summarize-text": ["summarize-text"], "/image": ["image-generation"], "/transcribe": ["speech-to-text"],
  "/package": ["npm-package"], "/wikipedia": ["wikipedia-summary"], "/earthquakes": ["earthquakes"],
  "/holidays": ["public-holidays"], "/feed": ["rss-feed"], "/sitemap": ["sitemap"],
  "/text/prompt-injection": ["prompt-injection-detection"], "/json/repair": ["json-repair"],
  "/validate/iban": ["iban-validation"], "/base/token-transfers": ["token-transfers"], "/ens": ["ens-resolver", "reverse-ens", "ens-name"],
  "/liquidity-pool-audit": ["liquidity-pool"], "/check/counterparty": ["counterparty-risk"], "/base-gas": ["base-gas", "gas-fee-estimate"],
  "/btc-price": ["btc-price"], "/wallet/portfolio": ["portfolio-value"], "/papers": ["research-papers"],
  "/dictionary": ["dictionary-definition"],
  // Second pass, 66 more searches measured on 22 Oct evening (absent or below #5 where the #1 has 1-4 payers).
  "/time": ["timezone", "time-converter", "time-zone", "current-time"], "/hash": ["sha256", "hash"], "/uuid": ["uuid", "uuid-generator", "id-generator"],
  "/units/convert": ["unit-conversion"], "/text/stats": ["word-count", "readability"], "/slug": ["slugify"],
  "/text/diff": ["text-diff"], "/date/diff": ["date-difference"], "/validate/isbn": ["isbn"], "/color/contrast": ["color-contrast"],
  "/jwt/decode": ["jwt-decode"], "/random/password": ["password-generator"], "/sun": ["sunrise-sunset"],
  "/ai/classify": ["text-classification"], "/ai/keywords": ["keyword-extraction"], "/ai/extract-json": ["extract-json"],
  "/hyperliquid/orderbook": ["order-book"], "/hyperliquid/candles": ["ohlcv", "candles"], "/hyperliquid/funding-history": ["funding-history", "funding-rate"],
  "/hyperliquid/prices": ["crypto-prices"], "/http/security-headers": ["security-headers", "http-headers"], "/url/meta": ["website-metadata", "link-preview"], "/cron/next": ["cron-expression"], "/case": ["case-converter"], "/keccak": ["keccak256", "function-selector"], "/crypto/fear-greed": ["fear-and-greed"], "/ip/lookup": ["ip-lookup"], "/geo/distance": ["distance-between"], "/date/info": ["week-number"], "/hyperliquid/indicators": ["technical-indicators", "rsi", "macd"], "/news": ["news-headlines", "latest-news", "crypto-news"],
  // Contract reads of 1.52.0 on every network, phrased like the most-paid single reads (onesource.io, 23 Oct).
  ...Object.fromEntries(["base", "eth", "arb", "op", "polygon"].flatMap((s) => [
    [`/${s}/nft-owner`, ["nft-owner"]], [`/${s}/nft-balance`, ["nft-balance"]], [`/${s}/nft-metadata`, ["nft-metadata"]],
    [`/${s}/storage`, ["storage-slot"]], [`/${s}/proxy`, ["proxy-implementation"]], [`/${s}/call`, ["eth-call", "contract-call"]],
    [`/${s}/estimate-gas`, ["estimate-gas", "gas-estimate"]], [`/${s}/gas-history`, ["gas-history", "gas-price-history"]], ...(s === "base" ? [] : [[`/${s}/allowance`, ["token-allowance"]]]),
  ])),
});

/** The tool's tags with its search-phrase tags first, without duplicates (the full list, for our own discovery index). */
export function searchTagged(tags: readonly string[], path?: string): string[] {
  return [...new Set([...(path ? SEARCH_TAGS[path] ?? [] : []), ...tags])];
}

/**
 * The tags a directory listing carries. The Bazaar keeps the first 5 and drops the rest without a warning, so the
 * search phrases go first, then the specific tags (usdc, payments, sanctions…), and the shared ones last.
 */
export function listingTags(tags: readonly string[], path?: string): string[] {
  const all = searchTagged(tags, path);
  return [...all.filter((t) => !GENERIC_TAGS.has(t)), ...all.filter((t) => GENERIC_TAGS.has(t))].slice(0, 5);
}

const TRAILING_FILLER = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "its", "of", "on", "or", "the", "to", "under", "up", "via", "with", "without"]);

/**
 * The per-tool `serviceName` in the 402 resource. Zero.xyz names a crawled capability after it and its search
 * is lexical on that name, so one shared "Agent Data Tools" matched no buyer query. The x402 schema allows
 * 32 printable ASCII characters: the summary's lead phrase (before a colon), cut at a word within 32 characters,
 * without trailing filler words. Example: "Weather forecast: current weather…" -> "Weather forecast".
 */
export function listingName(summary: string): string {
  const head = summary.split(":")[0].replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();
  if (head.length <= 32) return head || "Agent Data Tools";
  let words = head.slice(0, 33).split(" ");
  if (words.length > 1) words.pop(); // the last word may be cut
  // A connecting word near the end starts a phrase that no longer fits ("…filings for a US"): cut before it.
  const late = words.map((w) => TRAILING_FILLER.has(w.toLowerCase())).lastIndexOf(true);
  if (late >= 3 && late >= words.length - 3) words = words.slice(0, late);
  while (words.length > 1 && TRAILING_FILLER.has(words[words.length - 1].toLowerCase())) words.pop();
  let name = words.join(" ");
  if (name.lastIndexOf("(") > name.lastIndexOf(")")) name = name.slice(0, name.lastIndexOf("(")); // no open bracket
  return name.slice(0, 32).replace(/[\s,(]+$/, "");
}

/**
 * The description a directory listing carries: the tool's description, opened by its listing name when it does not
 * already start with it, so the searched phrase is in the first words (inside a tier of equal payers the Bazaar orders
 * by text relevance; a description starting with the query phrase won 56% of 206 tied pairs on 22 Oct 2026).
 */
export function listingDescription(e: { summary: string; description: string }): string {
  const name = listingName(e.summary);
  return e.description.toLowerCase().startsWith(name.toLowerCase()) ? e.description : `${name}. ${e.description}`;
}
