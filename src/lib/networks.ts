import type { Env } from "./env";

/**
 * EVM networks where a tool can be paid in native USDC through the CDP facilitator (one API key,
 * 1,000 free settlements a month across all networks). One EVM PAY_TO address receives on all of
 * them. Base stays first: it is the default quote, and the Coinbase Bazaar lists Base settlements.
 * USDC addresses are the @x402/evm defaults the "$" prices resolve to.
 */
export const USDC_BY_NETWORK: Readonly<Record<string, string>> = Object.freeze({
  "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base
  "eip155:137": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // Polygon PoS
  "eip155:42161": "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // Arbitrum One
  "eip155:143": "0x754704bc059f8c67012fed69bc8a327a5aafb603", // Monad
});

export const NETWORK_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "eip155:8453": "Base", "eip155:137": "Polygon", "eip155:42161": "Arbitrum", "eip155:143": "Monad",
});

type Network = `${string}:${string}`;

/** env.NETWORK first, then each supported network in EXTRA_NETWORKS (comma-separated); unknown ones are ignored. */
export function paymentNetworks(env: Pick<Env, "NETWORK" | "EXTRA_NETWORKS">): Network[] {
  const extra = (env.EXTRA_NETWORKS ?? "").split(",").map((n) => n.trim()).filter((n) => n && n in USDC_BY_NETWORK && n !== env.NETWORK);
  return [env.NETWORK, ...new Set(extra)] as Network[];
}
