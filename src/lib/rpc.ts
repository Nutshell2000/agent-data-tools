import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import type { Env } from "./env";
import { activeTrace } from "./funnel";

/**
 * Keyless public RPCs per chain, best first, ordered by how they answer from Cloudflare's network (Workers share
 * egress IPs, so providers that rate-limit by IP fail far more often here than from a PC). Measured 2026-10-19 with
 * a probe Worker, 8 calls each (eth_getBalance + JSON-RPC batch): Base: BlastAPI 8/8, publicnode 6/8,
 * mainnet.base.org 2/8, drpc 0/8. Ethereum: drpc 8/8, MEV Blocker 8/8, BlastAPI 7/8, publicnode 4/8, llamarpc dead.
 * Arbitrum: all 7-8/8. Optimism: publicnode 8/8, official 6/8, drpc and BlastAPI 0/8. Polygon: publicnode 8/8,
 * drpc 6/8, polygon-rpc.com and BlastAPI 0/8. Second probe: POKT gateway (nodies) 8/8 on Base and Optimism, 0/8 on
 * Polygon; meowrpc, subquery and omniatech 0/8 everywhere. Re-measure before reordering.
 * Last fallbacks, added 2026-10-20 for eth_getLogs (not yet measured from Cloudflare): Tenderly's public gateway answers
 * 1,000-block log scans on all five chains, and QuickNode's public Polygon endpoint too. BlastAPI caps eth_getLogs at
 * 10 blocks and has shut down on Polygon; drpc's free plan refuses Polygon and Base log scans.
 */
export const EDGE_RPCS = {
  base: ["https://base-mainnet.public.blastapi.io", "https://base-pokt.nodies.app", "https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.gateway.tenderly.co"],
  eth: ["https://eth.drpc.org", "https://rpc.mevblocker.io", "https://eth-mainnet.public.blastapi.io", "https://ethereum-rpc.publicnode.com", "https://mainnet.gateway.tenderly.co"],
  arb: ["https://arbitrum-one-rpc.publicnode.com", "https://arbitrum.drpc.org", "https://arbitrum-one.public.blastapi.io", "https://arb1.arbitrum.io/rpc", "https://arbitrum.gateway.tenderly.co"],
  op: ["https://optimism-rpc.publicnode.com", "https://op-pokt.nodies.app", "https://mainnet.optimism.io", "https://optimism.gateway.tenderly.co"],
  polygon: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org", "https://polygon.gateway.tenderly.co", "https://rpc-mainnet.matic.quiknode.pro"],
} as const;

/**
 * eth_getLogs order per chain: the providers that answered a 1,000-block filtered USDC Transfer scan go first, the rest
 * stay as fallbacks. Measured 2026-10-22 from a PC: Base publicnode and Tenderly (BlastAPI refuses, nodies caps at 50
 * blocks, mainnet.base.org refuses); Ethereum MEV Blocker and Tenderly (drpc, BlastAPI, publicnode refuse); Arbitrum
 * arbitrum.io and Tenderly (publicnode, drpc, BlastAPI refuse); Optimism publicnode, Tenderly, optimism.io (nodies caps
 * at 50); Polygon publicnode, Tenderly, QuickNode (drpc refuses). With the general order, /base/token-transfers spent
 * its budget on refusals and answered 502 on its own published example. Re-measure from Cloudflare before reordering.
 */
export const LOG_RPCS: { readonly [K in keyof typeof EDGE_RPCS]: readonly string[] } = {
  base: ["https://base-rpc.publicnode.com", "https://base.gateway.tenderly.co", "https://mainnet.base.org", "https://base-mainnet.public.blastapi.io", "https://base-pokt.nodies.app"],
  eth: ["https://mainnet.gateway.tenderly.co", "https://rpc.mevblocker.io", "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://eth-mainnet.public.blastapi.io"],
  arb: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.gateway.tenderly.co", "https://arbitrum-one-rpc.publicnode.com", "https://arbitrum.drpc.org", "https://arbitrum-one.public.blastapi.io"],
  op: ["https://optimism-rpc.publicnode.com", "https://optimism.gateway.tenderly.co", "https://mainnet.optimism.io", "https://op-pokt.nodies.app"],
  polygon: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.gateway.tenderly.co", "https://rpc-mainnet.matic.quiknode.pro", "https://polygon.drpc.org"],
};

/**
 * The RPC list for a chain. BASE_RPC_URL goes first only when it is a private endpoint (not one of the public ones
 * above), so a stale public default in configuration cannot push a rate-limited node to the front.
 */
export function rpcUrls(slug: keyof typeof EDGE_RPCS, env?: Pick<Env, "BASE_RPC_URL">): string[] {
  const list: string[] = [...EDGE_RPCS[slug]];
  const custom = slug === "base" ? env?.BASE_RPC_URL?.trim() : undefined;
  return custom && !list.includes(custom) ? [custom, ...list] : list;
}

const perRequest = new WeakMap<object, Map<string, PublicClient>>();

/**
 * One viem client per request (shared by that request's calls, so multicall batching still works), never per
 * isolate: viem caches block numbers and batches calls in promises that a later request would await, and workerd
 * cancels promises that cross requests, so concurrent calls hung with "Worker's code had hung" (5xx).
 */
export function requestClient(key: string, make: () => PublicClient): PublicClient {
  const trace = activeTrace();
  if (!trace) return make();
  let clients = perRequest.get(trace);
  if (!clients) perRequest.set(trace, (clients = new Map()));
  let client = clients.get(key);
  if (!client) clients.set(key, (client = make()));
  return client;
}

/** Read-only Base client. Batches eth_calls through Multicall3; falls back across the measured RPC list. */
export function baseClient(env: Env): PublicClient {
  const urls = rpcUrls("base", env);
  const options = { timeout: 8_000, retryCount: 0 };
  return requestClient(`base|${urls.join("|")}`, () => createPublicClient({
    chain: base,
    transport: fallback(urls.map((u) => http(u, options)), { rank: false }),
    batch: { multicall: true },
  }) as PublicClient);
}

export const erc20Abi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
