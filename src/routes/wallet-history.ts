/**
 * A wallet's balances at past dates on Base (5 Nov 2026). Demand: Nansen's "address historical balances" had 41 payers
 * at $0.01 on the Bazaar and we sold nothing like it. Free Base nodes answer eth_call at blocks 30 days back (probed
 * 5 Nov on mainnet.base.org, publicnode and Tenderly), so each day is one multicall at that day's block: no outside data
 * licence. ETH and WETH are valued from the Uniswap v3 WETH/USDC pool's slot0 at the same block; USDC, USDbC and EURC
 * are not converted (EURC stays unvalued); other tokens are shown without a value.
 */
import { formatEther, formatUnits, getAddress, type PublicClient } from "viem";
import { entry, num, opt, type Entry } from "../family";
import { HttpError, isAddress } from "../lib/env";
import { blockAtTime, recentBlockSeconds, type Sample } from "../lib/block-time";
import { erc20Abi } from "../lib/rpc";
import { CHAINS, client, rpc } from "./chain-reads";
import { priceFromSqrt } from "./prices";
import { DEFAULT_TOKENS } from "./wallet";

type Address = `0x${string}`;
const BASE = CHAINS.find((c) => c.slug === "base")!;
const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const WETH: Address = "0x4200000000000000000000000000000000000006";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const UNI_FACTORY: Address = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const USD_STABLES = new Set(["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca"]);
const MAX_EXTRA = 5;
const EX_ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const multicallAbi = [{ type: "function", name: "getEthBalance", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const factoryAbi = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] }] as const;
const slot0Abi = [{
  type: "function", name: "slot0", stateMutability: "view", inputs: [],
  outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" }],
}] as const;

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Runs `fn` over `items` with at most `limit` in flight, keeping order. */
async function inBatches<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

export async function balanceHistory(cl: PublicClient, address: string, days: number, extraTokens: string[]) {
  const a = getAddress(address);
  const tokens = [...new Set([...DEFAULT_TOKENS, ...extraTokens].map((t) => t.toLowerCase()))].map((t) => getAddress(t)) as Address[];
  const [latest, meta, pool] = await rpc(() => Promise.all([
    cl.getBlock(),
    cl.multicall({ allowFailure: true, contracts: tokens.flatMap((t) => [
      { address: t, abi: erc20Abi, functionName: "symbol" } as const,
      { address: t, abi: erc20Abi, functionName: "decimals" } as const,
    ]) }),
    cl.readContract({ address: UNI_FACTORY, abi: factoryAbi, functionName: "getPool", args: [WETH, USDC, 500] }),
  ]));
  const info = tokens.map((t, i) => ({
    address: t,
    symbol: meta[i * 2].status === "success" ? String(meta[i * 2].result) : t,
    decimals: meta[i * 2 + 1].status === "success" ? Number(meta[i * 2 + 1].result) : null,
  })).filter((t): t is typeof t & { decimals: number } => t.decimals !== null);
  const head: Sample = { block: latest.number, ts: Number(latest.timestamp) };
  // One block per day, found from real block times: Base went from 2 s to 0.2 s blocks around 5 Nov 2026, so a fixed
  // blocks-per-day count labelled points 2.4 hours apart as days. The oldest point first, then eight headers spread
  // between it and now, so every other day is one interpolation (and usually one check) away.
  const secs = await recentBlockSeconds(cl, "base", head.block);
  const samples: Sample[] = [head];
  const oldest = await rpc(() => blockAtTime(cl, head, head.ts - days * 86_400, { secs, tolerance: 300, samples }));
  const step = (head.block - oldest.block) / 9n;
  if (step > 0n) {
    const spread = await Promise.all(Array.from({ length: 8 }, (_, i) => oldest.block + step * BigInt(i + 1)).map(async (b) => ({ block: b, ts: Number((await rpc(() => cl.getBlock({ blockNumber: b }))).timestamp) })));
    samples.push(...spread);
  }
  const backs = Array.from({ length: days + 1 }, (_, i) => days - i);
  const points = await inBatches(backs, 6, async (back) => {
    const at = back === days ? oldest : await rpc(() => blockAtTime(cl, head, head.ts - back * 86_400, { secs, tolerance: 300, samples }));
    return { back, block: at.block, ts: at.ts };
  });
  const rows = await inBatches(points, 6, async ({ block, ts }) => {
    // Three ABIs in one multicall: viem's tuple typing cannot mix them, so the list is passed untyped and read back by index.
    const contracts = [
      { address: MULTICALL3, abi: multicallAbi, functionName: "getEthBalance", args: [a] },
      { address: pool, abi: slot0Abi, functionName: "slot0" },
      ...info.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [a] })),
    ];
    const r = (await rpc(() => cl.multicall({ allowFailure: true, blockNumber: block, multicallAddress: MULTICALL3, contracts: contracts as never }))) as unknown as { status: string; result?: unknown }[];
    const wei = r[0].status === "success" ? (r[0].result as bigint) : null;
    const sqrt = r[1].status === "success" ? (r[1].result as readonly [bigint, ...unknown[]])[0] : null;
    const ethUsd = sqrt ? priceFromSqrt(sqrt, WETH.toLowerCase() < USDC.toLowerCase(), 18, 6) : null;
    const balances: Record<string, string> = {};
    let valueUsd = wei !== null && ethUsd ? Number(formatEther(wei)) * ethUsd : 0;
    info.forEach((t, i) => {
      const res = r[i + 2];
      if (res.status !== "success" || (res.result as bigint) === 0n) return;
      const amount = formatUnits(res.result as bigint, t.decimals);
      balances[t.symbol] = amount;
      const lower = t.address.toLowerCase();
      if (USD_STABLES.has(lower)) valueUsd += Number(amount);
      else if (lower === WETH.toLowerCase() && ethUsd) valueUsd += Number(amount) * ethUsd;
    });
    return {
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      block: Number(block),
      blockTime: new Date(ts * 1000).toISOString(),
      eth: wei === null ? null : formatEther(wei),
      tokens: balances,
      ethUsd: ethUsd === null ? null : round(ethUsd),
      valueUsd: wei === null ? null : round(valueUsd),
    };
  });
  if (rows.every((p) => p.eth === null)) throw new HttpError(502, "the network's public nodes did not answer for past blocks; try again");
  const first = rows.find((p) => p.valueUsd !== null);
  const last = [...rows].reverse().find((p) => p.valueUsd !== null);
  const change = first && last ? round(last.valueUsd! - first.valueUsd!) : null;
  return {
    address: a, chain: "Base", chainId: 8453, days, points: rows,
    change: { valueUsd: change, percent: first?.valueUsd && change !== null ? round((change / first.valueUsd) * 100) : null },
    tokensChecked: info.map((t) => t.symbol),
    note: "Balances read at one block per day, each found from real block times (blockTime is that block's own time). valueUsd counts ETH, WETH (Uniswap v3 WETH/USDC pool price at that block), USDC and USDbC only; other tokens are listed without a value. A value change includes deposits and withdrawals, so it is not profit.",
  };
}

const BALANCE_HISTORY: Entry = entry("/wallet/balance-history", "Historical balances, wallet history",
  "Historical balances of any 0x address on Base: ETH and the main tokens (USDC, WETH, cbBTC, DAI, USDbC, cbETH, AERO, EURC, plus up to 5 more) read at one block per day for up to 30 days, with ETH priced from the on-chain Uniswap pool at each date and the USD value change. Use to see how a wallet's holdings moved, check a balance on a past date, or chart a treasury.",
  ["historical-balances", "balance-history", "wallet-history", "portfolio-history", "wallet", "base"],
  {
    address: { type: "string", description: "0x wallet or contract address on Base", required: true, example: EX_ADDR },
    days: { type: "integer", description: "How many days back, one point per day (1-30, default 7)", example: 7 },
    tokens: { type: "string", description: "Optional extra token addresses on Base, comma-separated (up to 5)", example: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed" },
  },
  {
    address: EX_ADDR, chain: "Base", chainId: 8453, days: 1,
    points: [
      { date: "2026-11-04", block: 37900000, blockTime: "2026-11-04T20:00:01.000Z", eth: "0.5", tokens: { USDC: "120.5" }, ethUsd: 3500.12, valueUsd: 1870.56 },
      { date: "2026-11-05", block: 37943200, blockTime: "2026-11-05T20:00:01.000Z", eth: "0.4", tokens: { USDC: "480.5" }, ethUsd: 3550.4, valueUsd: 1900.66 },
    ],
    change: { valueUsd: 30.1, percent: 1.61 },
    tokensChecked: ["USDC", "WETH", "cbBTC", "DAI", "USDbC", "cbETH", "AERO", "EURC"],
    note: "Balances read at one block per day, each found from real block times. valueUsd counts ETH, WETH, USDC and USDbC only.",
  },
  async (env, q) => {
    const address = q("address")?.trim() ?? "";
    if (!isAddress(address)) throw new HttpError(400, "address must be a 0x address (40 hex characters)");
    const days = num(q, "days", { min: 1, max: 30, fallback: 7, integer: true });
    const extras = (opt(q, "tokens", 500) ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    if (extras.length > MAX_EXTRA) throw new HttpError(400, `tokens accepts at most ${MAX_EXTRA} addresses`);
    if (!extras.every(isAddress)) throw new HttpError(400, "tokens must be comma-separated 0x addresses");
    return balanceHistory(client(env, BASE), address, days, extras);
  });

export const WALLET_HISTORY: Entry[] = [BALANCE_HISTORY];
