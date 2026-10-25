// Three tools to try next, for the bot that just bought (or was quoted) one of ours. Bot C reached
// /check/counterparty through our discovery file after buying /btc-fees; this puts that next step in the answer
// itself: a `Link: …; rel="related"` header on every tool response, and a `related` list in the readable 402 body.
// Same category first, then the best sellers (salesOrdered), never the tool itself. Nothing here changes a tool's
// output body or its output contract.
import { ENDPOINTS, type Endpoint } from "../endpoints";
import { categoryOf } from "../discovery";
import { listingName } from "./bazaar-extension";
import { salesOrdered } from "./discovery-index";

const cache = new Map<string, Endpoint[]>();

/**
 * The pack that runs a tool among others, for the tool's first related link (25 Oct 2026). Since every tool and pack costs
 * $0.01, a bot that just bought one tool gets four to six for the same price in the pack: the cheapest upsell we have.
 * Paths missing from the catalog are skipped, so the map may name tools that are paused.
 */
const PACK_OF: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(([
  ["/pack/wallet-profile", ["/wallet/balances", "/wallet/portfolio", "/wallet", "/base/is-contract", "/base/nonce", "/eth/nonce", "/base/token-transfers", "/sanctions/check", "/eth/balance", "/base/balance"]],
  ["/pack/crypto-market", ["/crypto/fear-greed", "/hyperliquid/market", "/hyperliquid/prices", "/btc-fees", "/btc-price"]],
  ["/pack/coin-research", ["/hyperliquid/indicators", "/hyperliquid/funding-history", "/hyperliquid/orderbook", "/hyperliquid/candles"]],
  ["/pack/token-analysis", ["/price/token", "/price/tokens", "/token", "/token-report", "/contract-risk", "/eth/token-info", "/base/token-info", "/eth/proxy", "/base/proxy"]],
  ["/pack/website-audit", ["/url/uptime", "/url/redirects", "/http/security-headers", "/robots", "/http/status"]],
  ["/pack/seo-toolkit", ["/seo/audit", "/text/keyword-density", "/url/meta", "/url/favicon"]],
  ["/pack/domain-intel", ["/tech/stack", "/domain", "/domain-report", "/company"]],
  ["/pack/ip-intelligence", ["/ip/info", "/ip/lookup"]],
  ["/pack/email-deliverability", ["/email", "/dns/lookup", "/dns/propagation"]],
  ["/pack/location-brief", ["/geocode", "/geocode/reverse", "/sun", "/country", "/weather"]],
  ["/pack/text-analysis", ["/text/stats", "/text/extract", "/text/prompt-injection", "/text/language"]],
  ["/pack/hash-toolbox", ["/hash", "/keccak", "/hmac"]],
  ["/pack/json-toolbox", ["/json/validate", "/json/format", "/json/minify", "/json/schema", "/json/repair", "/json/to-yaml", "/yaml/to-json"]],
  ["/pack/encoding-toolbox", ["/base64/encode", "/base64/decode", "/url/encode", "/url/decode"]],
  ["/pack/string-toolbox", ["/case", "/slug"]],
  ["/pack/id-toolbox", ["/uuid", "/random/password"]],
  ["/pack/evm-toolbox", ["/evm/checksum", "/evm/decode-calldata", "/evm/verify-signature"]],
  ["/pack/gas-tracker", ["/eth/gas", "/base-gas", "/arb/gas", "/op/gas", "/polygon/gas", "/eth/gas-history", "/base/gas-history"]],
  ["/pack/tx-explain", ["/eth/tx", "/eth/receipt", "/base-tx", "/base/receipt", "/arb/tx", "/op/tx", "/polygon/tx"]],
  ["/pack/nft-analysis", ["/eth/nft-owner", "/eth/nft-metadata", "/base/nft-owner", "/base/nft-metadata", "/polygon/nft-owner", "/polygon/nft-metadata"]],
  ["/pack/api-health", ["/x402/check", "/openapi/summary", "/mcp/inspect"]],
] as const).flatMap(([pack, tools]) => tools.map((t) => [t, pack]))));

export function packOf(path: string): Endpoint | undefined {
  const pack = PACK_OF[path];
  return pack ? ENDPOINTS.find((e) => e.path === pack) : undefined;
}

export function relatedTools(path: string, max = 3): Endpoint[] {
  let related = cache.get(path);
  if (!related) {
    const category = categoryOf(path);
    const pack = packOf(path);
    const others = salesOrdered(ENDPOINTS).filter((e) => e.path !== path && e.path !== pack?.path);
    related = [...(pack ? [pack] : []), ...others.filter((e) => categoryOf(e.path) === category), ...others.filter((e) => categoryOf(e.path) !== category)].slice(0, max);
    cache.set(path, related);
  }
  return related;
}

/** RFC 8288 Link header value: `<url>; rel="related"; title="…"` per tool. */
export function relatedLinkHeader(origin: string, path: string): string {
  return relatedTools(path).map((e) => `<${origin}${e.path}>; rel="related"; title="${listingName(e.summary).replace(/"/g, "")}"`).join(", ");
}

/** The same three tools for a JSON body: url, name and price. */
export function relatedList(origin: string, path: string) {
  return relatedTools(path).map((e) => ({ url: `${origin}${e.path}`, name: listingName(e.summary), price: e.price }));
}
