import { HttpError, isAddress, type Env } from "../lib/env";
import { getAddress } from "viem";

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
  source: "DexScreener";
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

export async function liquidityPoolAudit(_env: Env, address: string): Promise<LiquidityPoolAudit> {
  if (!isAddress(address)) throw new HttpError(400, "address must be a 0x-prefixed 20-byte hex address");

  let response: Response;
  try {
    response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/base/${address}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new HttpError(502, "DexScreener market data source unavailable");
  }
  if (!response.ok) throw new HttpError(502, "DexScreener market data source unavailable");

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
