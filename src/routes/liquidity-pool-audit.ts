import { dexscreener } from "../lib/dexscreener";
import { HttpError, isAddress, type Env } from "../lib/env";
import { erc20Abi, getAddress, parseAbi } from "viem";
import { CHAINS, client, rpc } from "./chain-reads";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface LiquidityPoolAudit {
  chain: "base";
  source: "DexScreener" | "Base on-chain";
  retrievedAt: string;
  pairAddress: string;
  dex: string | null;
  url: string | null;
  baseToken: { address: string | null; name: string | null; symbol: string | null };
  quoteToken: { address: string | null; name: string | null; symbol: string | null };
  priceUsd: string | null;
  priceChange24hPct: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  trades24h: { buys: number | null; sells: number | null } | null;
  pairCreatedAt: string | null;
  ageDays: number | null;
}

/** DEX factories on Base, to name the DEX of a pool read on chain. */
const FACTORIES: Record<string, string> = {
  "0x8909dc15e40173ff4699343b6eb8132c65e18ec6": "uniswap-v2",
  "0x33128a8fc17869897dce68ed026d694621f6fdfd": "uniswap-v3",
  "0x420dd381b31aef6683db6b902084cb0ffece40da": "aerodrome",
  "0x5e7bb104d84c7cb9b682aac2f3d509f5f406809a": "aerodrome-slipstream",
  "0x71524b4f93c58fcbf659783284e38825f0622859": "sushiswap",
  "0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e": "pancakeswap-v2",
  "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865": "pancakeswap-v3",
};
/** USD stablecoins on Base: a pool holding one is valued at twice that side's balance. */
const STABLES: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6, // USDC
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": 6, // USDbC
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": 18, // DAI
};
const poolAbi = parseAbi(["function token0() view returns (address)", "function token1() view returns (address)", "function factory() view returns (address)"]);

/** The pool read directly from Base: verified tokens, DEX by factory, and depth when one side is a USD stablecoin. */
async function onChainPool(env: Env, address: string): Promise<LiquidityPoolAudit> {
  const cl = client(env, CHAINS.find((c) => c.slug === "base")!);
  const pool = getAddress(address);
  const [t0, t1, factory] = await rpc(() => cl.multicall({ allowFailure: true, contracts: [
    { address: pool, abi: poolAbi, functionName: "token0" }, { address: pool, abi: poolAbi, functionName: "token1" }, { address: pool, abi: poolAbi, functionName: "factory" },
  ] }));
  if (t0.status !== "success" || t1.status !== "success") throw new HttpError(404, "No verified Base DEX pair found for this address");
  const tokens = [t0.result, t1.result];
  const reads = await rpc(() => cl.multicall({ allowFailure: true, contracts: tokens.flatMap((t) => [
    { address: t, abi: erc20Abi, functionName: "name" }, { address: t, abi: erc20Abi, functionName: "symbol" },
    { address: t, abi: erc20Abi, functionName: "decimals" }, { address: t, abi: erc20Abi, functionName: "balanceOf", args: [pool] },
  ]) }));
  const at = (i: number) => (reads[i]?.status === "success" ? reads[i].result : null);
  const info = tokens.map((t, k) => ({ address: getAddress(t), name: text(at(k * 4)), symbol: text(at(k * 4 + 1)), decimals: at(k * 4 + 2) as number | null, balance: at(k * 4 + 3) as bigint | null }));
  const stable = info.find((t) => t.address.toLowerCase() in STABLES && t.balance !== null);
  const liquidityUsd = stable ? 2 * (Number(stable.balance) / 10 ** STABLES[stable.address.toLowerCase()]) : null;
  return {
    chain: "base", source: "Base on-chain", retrievedAt: new Date().toISOString(), pairAddress: pool,
    dex: factory.status === "success" ? FACTORIES[String(factory.result).toLowerCase()] ?? `factory ${factory.result}` : null,
    url: null,
    baseToken: { address: info[0].address, name: info[0].name, symbol: info[0].symbol },
    quoteToken: { address: info[1].address, name: info[1].name, symbol: info[1].symbol },
    priceUsd: null, priceChange24hPct: null,
    liquidityUsd: liquidityUsd === null ? null : Math.round(liquidityUsd * 100) / 100,
    volume24hUsd: null, trades24h: null, pairCreatedAt: null, ageDays: null,
  };
}

export async function liquidityPoolAudit(_env: Env, address: string): Promise<LiquidityPoolAudit> {
  if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address");

  let response: Response | undefined;
  try {
    response = await dexscreener(`/latest/dex/pairs/base/${address}`);
  } catch (error) {
    console.warn(`dexscreener pairs fetch failed: ${String((error as Error)?.message ?? error).slice(0, 160)}`);
  }
  // DexScreener rate-limits Cloudflare's shared egress (429 on most Worker calls on 22 Oct): read the pool on chain
  // instead, so the buyer still gets a verified pool, its tokens and its depth rather than an error.
  if (!response?.ok) return onChainPool(_env, address);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HttpError(502, "DexScreener returned invalid market data");
  }

  const pair = object(object(body)?.pair);
  const pairAddress = text(pair?.pairAddress);
  if (
    !pair ||
    pairAddress?.toLowerCase() !== address.toLowerCase() ||
    text(pair.chainId)?.toLowerCase() !== "base"
  ) {
    throw new HttpError(404, "No verified Base DEX pair found for this address");
  }

  const retrievedAt = new Date().toISOString();
  const baseToken = object(pair.baseToken);
  const quoteToken = object(pair.quoteToken);
  const createdAtMs = number(pair.pairCreatedAt);
  const createdAt =
    createdAtMs !== null && createdAtMs > 0 && Number.isFinite(new Date(createdAtMs).getTime())
      ? new Date(createdAtMs)
      : null;
  const ageDays =
    createdAt && createdAt.getTime() <= Date.now()
      ? Math.floor((Date.now() - createdAt.getTime()) / 86_400_000)
      : null;
  const h24 = object(object(pair.txns)?.h24);

  return {
    chain: "base",
    source: "DexScreener",
    retrievedAt,
    pairAddress: getAddress(pairAddress),
    dex: text(pair.dexId),
    url: text(pair.url),
    baseToken: {
      address: text(baseToken?.address),
      name: text(baseToken?.name),
      symbol: text(baseToken?.symbol),
    },
    quoteToken: {
      address: text(quoteToken?.address),
      name: text(quoteToken?.name),
      symbol: text(quoteToken?.symbol),
    },
    priceUsd: text(pair.priceUsd),
    priceChange24hPct: number(object(pair.priceChange)?.h24),
    liquidityUsd: number(object(pair.liquidity)?.usd),
    volume24hUsd: number(object(pair.volume)?.h24),
    trades24h: h24
      ? { buys: number(h24.buys), sells: number(h24.sells) }
      : null,
    pairCreatedAt: createdAt?.toISOString() ?? null,
    ageDays,
  };
}
