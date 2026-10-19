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

/** One page of the discovery index: every paid tool as a Bazaar-style resource item. */
export function discoveryResources(env: Env, origin: string, limit = 100, offset = 0) {
  const items = ENDPOINTS.map((e) => ({
    resource: origin + e.path,
    type: "http",
    x402Version: 2,
    accepts: usdcRequirements(env, e.price),
    lastUpdated: LAST_UPDATED,
    metadata: { description: e.description, mimeType: "application/json", serviceName: SERVICE_NAME, tags: [...e.tags], openapi: `${origin}/openapi.json` },
  }));
  const size = Math.min(Math.max(1, Math.floor(limit) || 100), DISCOVERY_PAGE_LIMIT);
  const start = Math.max(0, Math.floor(offset) || 0);
  return { x402Version: 2, items: items.slice(start, start + size), pagination: { limit: size, offset: start, total: items.length } };
}
