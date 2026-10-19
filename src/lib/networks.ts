import type { Env } from "./env";

/**
 * EVM networks where a tool can be paid in native USDC through the CDP facilitator (one API key,
 * 1,000 free settlements a month across all networks). One EVM PAY_TO address receives on all of
 * them. Base stays first: it is the default quote, and the Coinbase Bazaar lists Base settlements.
 * Most USDC addresses are the @x402/evm defaults the "$" prices resolve to; networks without a library
 * default (World Chain) get an explicit asset and EIP-712 domain in CUSTOM_USDC.
 */
export const USDC_BY_NETWORK: Readonly<Record<string, string>> = Object.freeze({
  "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base
  "eip155:137": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // Polygon PoS
  "eip155:42161": "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // Arbitrum One
  "eip155:143": "0x754704bc059f8c67012fed69bc8a327a5aafb603", // Monad
  "eip155:480": "0x79a02482a880bce3f13e09da970dc34db4cd24d1", // World Chain (native Circle USDC)
  "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // Base Sepolia testnet (staging only, faucet USDC)
});

export const NETWORK_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "eip155:8453": "Base", "eip155:137": "Polygon", "eip155:42161": "Arbitrum", "eip155:143": "Monad", "eip155:480": "World Chain", "eip155:84532": "Base Sepolia",
});

type Network = `${string}:${string}`;

/** Solana mainnet (CAIP-2) and its native USDC mint; settled by the same CDP facilitator. */
export const SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Every way a tool can be paid: each EVM network to PAY_TO, then Solana to SOLANA_PAY_TO when it is set. */
export function paymentOptions(env: Pick<Env, "NETWORK" | "EXTRA_NETWORKS" | "PAY_TO" | "SOLANA_PAY_TO">): { network: Network; payTo: string }[] {
  const options = paymentNetworks(env).map((network) => ({ network, payTo: env.PAY_TO }));
  const solana = env.SOLANA_PAY_TO?.trim();
  if (solana && SOLANA_ADDRESS.test(solana)) options.push({ network: SOLANA_NETWORK as Network, payTo: solana });
  return options;
}

/** env.NETWORK first, then each supported network in EXTRA_NETWORKS (comma-separated); unknown ones are ignored. */
export function paymentNetworks(env: Pick<Env, "NETWORK" | "EXTRA_NETWORKS">): Network[] {
  const extra = (env.EXTRA_NETWORKS ?? "").split(",").map((n) => n.trim()).filter((n) => n && n in USDC_BY_NETWORK && n !== env.NETWORK);
  return [env.NETWORK, ...new Set(extra)] as Network[];
}

/** USDC on networks @x402/evm has no default for; domain values read from the token contract (EIP-3009). */
const CUSTOM_USDC: Readonly<Record<string, { asset: string; name: string; version: string }>> = Object.freeze({
  "eip155:480": { asset: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", name: "USDC", version: "2" },
});

/** The route price for one network: the "$" price where the library knows USDC, else an explicit USDC amount. */
export function priceOn(network: string, price: string): string | { asset: string; amount: string; extra: { name: string; version: string } } {
  const custom = CUSTOM_USDC[network];
  if (!custom) return price;
  const match = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec(price);
  if (!match) throw new Error(`Cannot express ${price} as six-decimal USDC`);
  const amount = (BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0")).toString();
  return { asset: custom.asset, amount, extra: { name: custom.name, version: custom.version } };
}