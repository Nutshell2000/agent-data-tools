import { LOCAL_PATHS } from "../families";
import { ENTRY_OF } from "../routes/entry-paths";
import { KEY_PRICES, callsAt } from "./credits";

/**
 * What a prepaid key pays where that is less than a tool's public price.
 *
 * Two sources:
 * - `KEY_PRICES` (lib/credits.ts): tools named one by one (PDF reading, the owner, 10 Nov 2026).
 * - Every tool that only computes from its own inputs or from data bundled with the code (`LOCAL_PATHS`: hashes,
 *   converters, calculators, validators, generators, the toolboxes) costs one credit, $0.001, with a key. The owner,
 *   11 Nov 2026: "Yes, all three" to, among others, "A key price of 1 credit ($0.001) for pure lookups and converters".
 *   Why: a developer comparing prices sees lookups and converters sold at cents per 1,000 calls elsewhere, and ours at
 *   $2 to $10 per 1,000. A wallet or router paying per call keeps the public price: $0.001 per call would net nothing
 *   there, because each on-chain settlement above 1,000 a month costs us $0.001. A key call settles nothing.
 *
 * An entry path pays what its tool pays. This module imports the catalog, so lib/credits.ts (which the catalog reaches
 * through lib/env.ts and metrics.ts) must not import it.
 */
export const LOCAL_KEY_PRICE = "$0.001";

const inCredits = (price: string) => Math.round(Number(price.slice(1)) * 1000);

/** The key price of a tool when it is below the public price; undefined when a key pays the public price. */
export function keyPriceFor(path: string, price: string): string | undefined {
  const tool = Object.hasOwn(ENTRY_OF, path) ? ENTRY_OF[path] : path;
  const named = Object.hasOwn(KEY_PRICES, path) ? KEY_PRICES[path] : Object.hasOwn(KEY_PRICES, tool) ? KEY_PRICES[tool] : undefined;
  const candidate = named ?? (LOCAL_PATHS.has(tool) ? LOCAL_KEY_PRICE : undefined);
  return candidate !== undefined && inCredits(candidate) < inCredits(price) ? candidate : undefined;
}

/** The price a prepaid key is charged for this tool. */
export const keyPrice = (path: string, price: string) => keyPriceFor(path, price) ?? price;

/** "$0.001 a call ... $1 pays for 1,000 calls": the numbers every surface shows for a tool with a key price. */
export function keyOfferNumbers(path: string, price: string): { price: string; callsPerDollar: string } | undefined {
  const withKey = keyPriceFor(path, price);
  return withKey ? { price: withKey, callsPerDollar: callsAt(1000, withKey) } : undefined;
}

/** One sentence for a refusal: what this tool costs with a prepaid key, when that is less than its price. */
export function keyPriceLine(path: string, price: string, origin: string): string | undefined {
  const offer = keyOfferNumbers(path, price);
  return offer && `With a prepaid key this tool costs ${offer.price} a call instead of the price above: $1 pays for ${offer.callsPerDollar} calls. Buy one by card at ${origin}/credits (from $1, no account) or with USDC at ${origin}/credits/usdc/1, and send it as Authorization: Bearer or as api_key= in the URL.`;
}
