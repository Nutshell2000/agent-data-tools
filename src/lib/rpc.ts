import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import type { Env } from "./env";

let cached: { url: string; client: PublicClient } | undefined;

/** Read-only Base client. Batches eth_calls through Multicall3. */
export function baseClient(env: Env): PublicClient {
  const url = env.BASE_RPC_URL || "https://mainnet.base.org";
  if (cached?.url !== url) {
    cached = {
      url,
      client: createPublicClient({
        chain: base,
        transport: http(url, { timeout: 8_000, retryCount: 1 }),
        batch: { multicall: true },
      }) as PublicClient,
    };
  }
  return cached.client;
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
