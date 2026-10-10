import { parseAbiItem } from "viem";
import type { Env } from "../lib/env";
import { baseClient } from "../lib/rpc";

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
// Public RPC endpoints cap the block range of a log query.
const CHUNK = 2000n;

export interface Payment {
  tx: string;
  from: string;
  block: bigint;
}

/** Finds a USDC transfer of exactly `amount` (6-decimal units) to `to`, at or after `fromBlock`. */
export async function findPayment(env: Env, to: string, amount: bigint, fromBlock: bigint, toBlock?: bigint): Promise<Payment | null> {
  const client = baseClient(env);
  const latest = toBlock ?? (await client.getBlockNumber());
  for (let start = fromBlock; start <= latest; start += CHUNK) {
    const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
    const logs = await client.getLogs({
      address: USDC_BASE,
      event: TRANSFER,
      args: { to: to as `0x${string}` },
      fromBlock: start,
      toBlock: end,
    });
    const hit = logs.find((l) => l.args.value === amount);
    if (hit) return { tx: hit.transactionHash, from: hit.args.from ?? "", block: hit.blockNumber };
  }
  return null;
}
