import { dexscreener } from "../lib/dexscreener";
import { HttpError, type Env } from "../lib/env";
import { tokenInfo } from "./token";
import { TICKERS } from "../lib/tickers";

/** Base tokens other tokens are quoted in: stablecoins, wrapped ether and wrapped bitcoin from the shared ticker table. */
const QUOTE_ASSETS = new Set(["WETH", "USDC", "USDBC", "DAI", "EURC", "USDT", "CBBTC"].map((t) => TICKERS.base[t].toLowerCase()));
export const isQuoteAsset = (address: string) => QUOTE_ASSETS.has(address.toLowerCase());

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

async function pairs(address: string): Promise<{ pairs: Pair[]; retrievedAt: string }> {
  const res = await dexscreener(`/latest/dex/tokens/${address}`);
  if (!res.ok) throw new HttpError(502, "market data source unavailable");
  const body = (await res.json()) as { pairs?: Pair[] | null };
  return {
    pairs: (body.pairs ?? []).filter((p) => p.chainId === "base" && p.baseToken.address.toLowerCase() === address.toLowerCase()),
    retrievedAt: new Date().toISOString(),
  };
}

/** On-chain facts plus live DEX market data and a rule-based risk summary, in one call. */
export async function tokenReport(env: Env, address: string) {
  const [token, marketData] = await Promise.all([tokenInfo(env, address), pairs(address).catch(() => null)]);
  const found = marketData?.pairs ?? null;
  const flags: { level: "high" | "medium" | "info"; code: string; message: string }[] = [];
  const caps = (token as { capabilities?: Record<string, boolean> }).capabilities ?? {};
  const t = token as { ownershipRenounced?: boolean; paused?: boolean; proxy?: { isProxy?: boolean } };

  if (t.paused) flags.push({ level: "high", code: "paused", message: "Token transfers are currently paused." });
  if (caps.blacklist) flags.push({ level: "high", code: "blacklist", message: "Contract can blacklist or freeze addresses." });
  if (caps.feeSetter) flags.push({ level: "high", code: "fee_setter", message: "Owner can change transfer fees or tax." });
  if (caps.mint && t.ownershipRenounced === false) {
    flags.push({
      level: "medium",
      code: "mintable",
      message: "Bytecode contains a mint selector and owner() reports a nonzero owner; this heuristic does not prove the selector is callable or owner-controlled.",
    });
  } else if (caps.mint) {
    flags.push({
      level: "info",
      code: "mint_selector_unverified",
      message: "Bytecode contains a mint selector, but an active minting authority is not verified; selector presence alone does not prove mintability.",
    });
  }
  if (t.proxy?.isProxy) flags.push({ level: "medium", code: "upgradeable", message: "Upgradeable proxy: contract logic can be replaced by its admin." });

  let market: Record<string, unknown> | null = null;
  // DexScreener lists a token's pairs where it is the base token. For the assets other tokens are priced in (USDC, WETH,
  // DAI…) most trading sits in pairs where they are the quote, so the figures below would read as a thin, quiet market
  // (11 Nov 2026 audit: Base USDC showed $2,754 of 24-hour volume). They are kept, labelled, and raise no liquidity flags.
  const quoteAsset = isQuoteAsset(address);
  if (quoteAsset) flags.push({ level: "info", code: "quote_asset", message: "This is a quote asset: DexScreener's pairs for it cover only markets where it is the base token, so volume and liquidity here understate its real trading." });
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
      ...(quoteAsset ? { coverage: "pairs where this token is the base token only", representative: false } : {}),
    };
    if (quoteAsset) { /* liquidity and pair-age flags would describe a side market, not the token */ }
    else if (totalLiquidity < 10_000) flags.push({ level: "high", code: "low_liquidity", message: `Total liquidity is only about $${Math.round(totalLiquidity)}.` });
    else if (totalLiquidity < 100_000) flags.push({ level: "medium", code: "thin_liquidity", message: `Liquidity is thin (about $${Math.round(totalLiquidity)}).` });
    if (!quoteAsset && ageDays !== null && ageDays < 7) flags.push({ level: "medium", code: "new_pair", message: `Top-liquidity listed pair is only ${ageDays} day(s) old.` });
    if (tx && tx.buys > 20 && tx.sells === 0) flags.push({ level: "high", code: "no_sells", message: "Buys but no sells in 24h, a possible honeypot pattern." });
  }

  const high = flags.filter((f) => f.level === "high").length;
  const medium = flags.filter((f) => f.level === "medium").length;
  const risk = high > 0 ? "high" : medium > 0 ? "medium" : "low";
  return {
    chain: "base",
    address,
    marketDataSource: "DexScreener",
    marketRetrievedAt: marketData?.retrievedAt ?? null,
    risk,
    summary: `${risk} risk: ${high} high and ${medium} medium flag(s). Heuristic screening, not a guarantee of safety.`,
    flags,
    token,
    market,
  };
}
