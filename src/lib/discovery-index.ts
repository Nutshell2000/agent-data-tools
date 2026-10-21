import { listingName } from "./bazaar-extension";
// The x402 discovery index of this service at /discovery/resources, in the shape the facilitator-run Bazaar
// (`GET /discovery/resources`) and the @x402/extensions bazaar client use, so crawlers that read sellers directly
// (x402-discovery-index and the like) can index every tool without a first settled payment. Nothing here is a
// quote: the paywall still issues the real terms on each 402.
import { ENDPOINTS, SERVICE_NAME } from "../endpoints";
import type { Env } from "./env";
import { paymentOptions, USDC_BY_NETWORK, USDC_DOMAIN } from "./networks";
import { usdMicros } from "./revenue";

/** When this isolate started; the catalog changes only with a deploy. */
const LAST_UPDATED = new Date().toISOString();
export const DISCOVERY_PAGE_LIMIT = 500;

/** x402 v2 "exact" requirements for one price on every EVM network we accept with a known USDC domain. */
export function usdcRequirements(env: Pick<Env, "NETWORK" | "EXTRA_NETWORKS" | "PAY_TO" | "SOLANA_PAY_TO">, price: string) {
  const atomic = usdMicros(price);
  if (atomic === null) return [];
  return paymentOptions(env)
    .filter(({ network }) => USDC_BY_NETWORK[network] && USDC_DOMAIN[network])
    .map(({ network, payTo }) => ({
      scheme: "exact" as const,
      network,
      amount: String(atomic), // USDC has 6 decimals, so micro-dollars are atomic units
      asset: USDC_BY_NETWORK[network],
      payTo,
      maxTimeoutSeconds: 300,
      extra: { ...USDC_DOMAIN[network] },
    }));
}

/**
 * The order buyers see in the discovery files (/discovery/resources and /.well-known/x402). Paying bots reach a
 * seller through its Bazaar listings and then pick a tool by task from these files (21 Oct 2026: bot 0x171d…0fCA
 * bought /check/counterparty, then 98th of 179). Jobs the Bazaar's buyers pay for most come first: payee and risk
 * checks, prices, chain reads and the data tools with measured competitor demand. Then the rest of the catalog
 * in its own order, and the toys last.
 */
const SALES_FIRST = [
  "/check/counterparty", "/sanctions/check", "/token-report", "/token", "/wallet-audit", "/contract-risk",
  "/liquidity-pool-audit", "/x402/check", "/price/token", "/price/tokens", "/wallet/portfolio", "/wallet/balances",
  "/hyperliquid/market", "/sec/filings", "/airport/status", "/btc-fees", "/btc-price", "/eth/balance", "/eth/gas",
  "/base-gas", "/extract", "/extract/rendered", "/email", "/company", "/domain", "/domain-report", "/weather",
  "/pdf/text", "/package", "/package-audit",
];
const SALES_LAST = /^\/(coin|dice|magic-8-ball|yes-no|echo|ping)$|^\/random\//;
export function salesOrdered<T extends { path: string }>(list: readonly T[]): T[] {
  const rank = (path: string) => {
    const first = SALES_FIRST.indexOf(path);
    return first >= 0 ? first : SALES_LAST.test(path) ? SALES_FIRST.length + 2 : SALES_FIRST.length + 1;
  };
  return list.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e.path) - rank(b.e.path) || a.i - b.i).map(({ e }) => e);
}

/** One page of the discovery index: every paid tool as a Bazaar-style resource item. Without a limit the page
 *  holds the whole catalog, so a crawler that reads only the first page still sees every tool. */
export function discoveryResources(env: Env, origin: string, limit = DISCOVERY_PAGE_LIMIT, offset = 0) {
  const items = salesOrdered(ENDPOINTS).map((e) => ({
    resource: origin + e.path,
    type: "http",
    x402Version: 2,
    accepts: usdcRequirements(env, e.price),
    lastUpdated: LAST_UPDATED,
    metadata: { description: e.description, mimeType: "application/json", serviceName: listingName(e.summary), tags: [...e.tags], openapi: `${origin}/openapi.json` },
  }));
  const size = Math.min(Math.max(1, Math.floor(limit) || DISCOVERY_PAGE_LIMIT), DISCOVERY_PAGE_LIMIT);
  const start = Math.max(0, Math.floor(offset) || 0);
  return { x402Version: 2, items: items.slice(start, start + size), pagination: { limit: size, offset: start, total: items.length } };
}
