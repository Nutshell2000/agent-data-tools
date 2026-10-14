import { HttpError, type Env } from "../lib/env";
import { tokenInfo } from "./token";

interface Pair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string };
  quoteToken: { symbol: string };
  priceUsd?: string;
  txns?: { h24?: { buys: number; sells: number } };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

async function pairs(address: string): Promise<Pair[]> {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new HttpError(502, "market data source unavailable");
  const body = (await res.json()) as { pairs?: Pair[] | null };
  return (body.pairs ?? []).filter((p) => p.chainId === "base" && p.baseToken.address.toLowerCase() === address.toLowerCase());
}

/** On-chain facts plus live DEX market data and a rule-based risk summary, in one call. */
export async function tokenReport(env: Env, address: string) {
  const [token, found] = await Promise.all([tokenInfo(env, address), pairs(address).catch(() => null)]);
  const flags: { level: "high" | "medium" | "info"; code: string; message: string }[] = [];
  const caps = (token as { capabilities?: Record<string, boolean> }).capabilities ?? {};
  const t = token as { ownershipRenounced?: boolean; paused?: boolean; proxy?: { isProxy?: boolean } };

  if (t.paused) flags.push({ level: "high", code: "paused", message: "Token transfers are currently paused." });
  if (caps.blacklist) flags.push({ level: "high", code: "blacklist", message: "Contract can blacklist or freeze addresses." });
  if (caps.feeSetter) flags.push({ level: "high", code: "fee_setter", message: "Owner can change transfer fees or tax." });
  if (caps.mint && !t.ownershipRenounced) flags.push({ level: "medium", code: "mintable", message: "Supply can be minted by a non-renounced owner." });
  if (t.proxy?.isProxy) flags.push({ level: "medium", code: "upgradeable", message: "Upgradeable proxy: contract logic can be replaced by its admin." });

  let market: Record<string, unknown> | null = null;
  if (found === null) {
    flags.push({ level: "info", code: "market_data_unavailable", message: "Market data source did not respond." });
  } else if (found.length === 0) {
    flags.push({ level: "high", code: "no_liquidity", message: "No DEX trading pair found on Base." });
  } else {
    const top = [...found].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const totalLiquidity = found.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0);
    const ageDays = top.pairCreatedAt ? Math.floor((Date.now() - top.pairCreatedAt) / 86_400_000) : null;
    const tx = top.txns?.h24;
    market = {
      priceUsd: top.priceUsd ? Number(top.priceUsd) : null,
      priceChange24hPct: top.priceChange?.h24 ?? null,
      volume24hUsd: top.volume?.h24 ?? null,
      liquidityUsdTotal: Math.round(totalLiquidity),
      fdvUsd: top.fdv ?? null,
      marketCapUsd: top.marketCap ?? null,
      pairCount: found.length,
      topPair: { dex: top.dexId, quote: top.quoteToken.symbol, address: top.pairAddress, url: top.url, ageDays },
      trades24h: tx ? { buys: tx.buys, sells: tx.sells } : null,
    };
    if (totalLiquidity < 10_000) flags.push({ level: "high", code: "low_liquidity", message: `Total liquidity is only about $${Math.round(totalLiquidity)}.` });
    else if (totalLiquidity < 100_000) flags.push({ level: "medium", code: "thin_liquidity", message: `Liquidity is thin (about $${Math.round(totalLiquidity)}).` });
    if (ageDays !== null && ageDays < 7) flags.push({ level: "medium", code: "new_pair", message: `Oldest listed pair is only ${ageDays} day(s) old.` });
    if (tx && tx.buys > 20 && tx.sells === 0) flags.push({ level: "high", code: "no_sells", message: "Buys but no sells in 24h, a possible honeypot pattern." });
  }

  const high = flags.filter((f) => f.level === "high").length;
  const medium = flags.filter((f) => f.level === "medium").length;
  const risk = high > 0 ? "high" : medium > 0 ? "medium" : "low";
  return {
    chain: "base",
    address,
    risk,
    summary: `${risk} risk: ${high} high and ${medium} medium flag(s). Heuristic screening, not a guarantee of safety.`,
    flags,
    token,
    market,
  };
}
