// Hyperliquid perpetuals market data from its public L1 info API (keyless; the interface terms say nothing about the
// API; Peter approved this tool on 2026-10-20). Funding, open interest and volume are the most-paid derivatives data.
import { entry, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

type Universe = { name: string; maxLeverage: number; isDelisted?: boolean }[];
type Ctx = { funding: string; openInterest: string; prevDayPx: string; dayNtlVlm: string; premium: string | null; oraclePx: string; markPx: string; midPx: string | null };

// One snapshot is shared for 15 s (plain data, never a pending promise: workerd cancels promises that cross requests).
// The API allows 1,200 weight a minute per IP and this call weighs 20, and Workers share egress IPs.
let snapshot: { at: number; universe: Universe; ctxs: Ctx[] } | undefined;

async function markets() {
  if (snapshot && Date.now() - snapshot.at < 15_000) return snapshot;
  let res: Response;
  try {
    res = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }), signal: AbortSignal.timeout(8000) });
  } catch {
    throw new HttpError(502, "Hyperliquid did not answer in time; try again");
  }
  if (!res.ok) throw new HttpError(502, `Hyperliquid answered HTTP ${res.status}; try again`);
  const [meta, ctxs] = (await res.json()) as [{ universe: Universe }, Ctx[]];
  snapshot = { at: Date.now(), universe: meta.universe, ctxs };
  return snapshot;
}

/** One info request; failures and timeouts are an uncharged 502. Weights: l2Book and allMids 2, candles and funding 20+. */
async function info<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  } catch {
    throw new HttpError(502, "Hyperliquid did not answer in time; try again");
  }
  if (res.status === 422 || res.status === 400) throw new HttpError(404, "Hyperliquid has no market for that coin");
  if (!res.ok) throw new HttpError(502, `Hyperliquid answered HTTP ${res.status}; try again`);
  return (await res.json()) as T;
}

/** A perp coin symbol (BTC, ETH, kPEPE…); Hyperliquid's own names are case-sensitive, so the listed spelling is used. */
async function coinInput(raw: string | undefined, fallback = "BTC") {
  const want = (raw?.trim() || fallback).toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(want)) throw new HttpError(400, "coin must be a symbol such as BTC or ETH");
  const { universe } = await markets();
  const hit = universe.find((u) => !u.isDelisted && u.name.toUpperCase() === want);
  if (!hit) throw new HttpError(404, `no Hyperliquid perpetual for ${want}`);
  return hit.name;
}

const INTERVALS: Record<string, number> = { "1m": 60e3, "3m": 180e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1h": 3600e3, "2h": 7200e3, "4h": 14400e3, "8h": 28800e3, "12h": 43200e3, "1d": 86400e3, "3d": 259200e3, "1w": 604800e3 };
const SOURCE = "Hyperliquid public info API";

const n = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

function market(u: Universe[number], c: Ctx) {
  const mark = n(c.markPx)!, prev = n(c.prevDayPx), funding = n(c.funding)!, oi = n(c.openInterest)!;
  return {
    coin: u.name, markPx: mark, oraclePx: n(c.oraclePx), midPx: n(c.midPx),
    fundingRateHourly: funding, fundingAprPct: Math.round(funding * 24 * 365 * 100 * 100) / 100, premium: n(c.premium),
    openInterest: Math.round(oi * 1e4) / 1e4, openInterestUsd: Math.round(oi * mark), dayVolumeUsd: Math.round(n(c.dayNtlVlm)!),
    prevDayPx: prev, change24hPct: prev ? Math.round(((mark - prev) / prev) * 10_000) / 100 : null, maxLeverage: u.maxLeverage,
  };
}

export const HYPERLIQUID: Entry[] = [
  entry("/hyperliquid/market", "Hyperliquid perp funding rate, open interest and price",
    "Live Hyperliquid perpetual futures data for a coin (BTC, ETH, SOL, HYPE…): mark, oracle and mid price, hourly funding rate and its APR, premium, open interest in coins and USD, 24-hour volume and price change, and max leverage. Without a coin, the 20 most traded markets by 24-hour volume. Read from Hyperliquid's public API. Use for funding-rate checks, basis trades, derivatives dashboards and market context.",
    ["hyperliquid", "perps", "funding-rate", "derivatives", "crypto", "market-data"], {
      coin: { type: "string", description: "Coin symbol such as BTC, ETH, SOL or HYPE (default: the 20 most traded markets)", example: "BTC" },
    },
    {
      count: 1,
      markets: [{ coin: "BTC", markPx: 82478, oraclePx: 82505, midPx: 82478.5, fundingRateHourly: 0.0000125, fundingAprPct: 10.95, premium: -0.000315, openInterest: 41244.6, openInterestUsd: 3401847000, dayVolumeUsd: 2604051652, prevDayPx: 81939, change24hPct: 0.66, maxLeverage: 40 }],
      source: "Hyperliquid public info API",
    },
    async (_e, q) => {
      const coin = opt(q, "coin", 20)?.toUpperCase();
      if (coin && !/^[A-Z0-9]{1,20}$/.test(coin)) throw new HttpError(400, "coin must be a symbol such as BTC or ETH");
      const { universe, ctxs } = await markets();
      const live = universe.map((u, i) => ({ u, c: ctxs[i] })).filter(({ u, c }) => c && !u.isDelisted);
      if (coin) {
        const hit = live.find(({ u }) => u.name.toUpperCase() === coin);
        if (!hit) {
          const close = live.filter(({ u }) => u.name.toUpperCase().startsWith(coin.slice(0, 2))).slice(0, 8).map(({ u }) => u.name);
          throw new HttpError(404, `no Hyperliquid perpetual for ${coin}${close.length ? `; similar: ${close.join(", ")}` : ""}`);
        }
        return { count: 1, markets: [market(hit.u, hit.c)], source: "Hyperliquid public info API" };
      }
      const top = live.sort((a, b) => Number(b.c.dayNtlVlm) - Number(a.c.dayNtlVlm)).slice(0, 20);
      return { count: top.length, markets: top.map(({ u, c }) => market(u, c)), source: "Hyperliquid public info API" };
    }),

  // 1.53.0: order book, candles, funding history and all mids, the derivatives data with the most one-call payers on the
  // Bazaar after funding (onesource.io deepstate book 207 payers, candles 193, tick.hugen.tokyo latest/all 136/116).
  entry("/hyperliquid/orderbook", "Crypto order book, Hyperliquid: bids, asks, spread and depth of a perp",
    "Live order book of a Hyperliquid perpetual (BTC, ETH, SOL, HYPE…): the best bid and ask levels with price, size and order count, the mid price, the spread in USD and basis points, and the summed depth on each side. Up to 20 levels a side (default 10). Read from Hyperliquid's public API. Use to judge liquidity and slippage before a trade, or for market-making and arbitrage checks.",
    ["order-book", "orderbook", "hyperliquid", "liquidity", "crypto", "market-data"], {
      coin: { type: "string", description: "Coin symbol such as BTC, ETH, SOL or HYPE (default BTC)", example: "BTC" },
      levels: { type: "integer", description: "Levels per side, 1-20 (default 10)", example: 10 },
    },
    { coin: "BTC", time: "2026-10-23T13:24:02.893Z", mid: 81870.5, spread: 1, spreadBps: 0.12, bids: [{ px: 81870, sz: 3.89437, n: 22 }], asks: [{ px: 81871, sz: 1.2, n: 4 }], bidDepth: 12.3, askDepth: 9.8, bidDepthUsd: 1007000, askDepthUsd: 802000, source: SOURCE },
    async (_e, q) => {
      const coin = await coinInput(q("coin"));
      const levels = num(q, "levels", { min: 1, max: 20, fallback: 10, integer: true });
      const book = await info<{ coin: string; time: number; levels: { px: string; sz: string; n: number }[][] }>({ type: "l2Book", coin });
      const side = (rows: { px: string; sz: string; n: number }[] = []) => rows.slice(0, levels).map((r) => ({ px: Number(r.px), sz: Number(r.sz), n: r.n }));
      const bids = side(book.levels?.[0]), asks = side(book.levels?.[1]);
      const bestBid = bids[0]?.px, bestAsk = asks[0]?.px;
      const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : null;
      const sum = (rows: { px: number; sz: number }[], usd: boolean) => Math.round(rows.reduce((s, r) => s + r.sz * (usd ? r.px : 1), 0) * (usd ? 1 : 1e5)) / (usd ? 1 : 1e5);
      return {
        coin: book.coin, time: new Date(book.time).toISOString(), mid,
        spread: mid === null ? null : Math.round((bestAsk! - bestBid!) * 1e6) / 1e6,
        spreadBps: mid === null ? null : Math.round(((bestAsk! - bestBid!) / mid) * 1e6) / 100,
        bids, asks, bidDepth: sum(bids, false), askDepth: sum(asks, false), bidDepthUsd: sum(bids, true), askDepthUsd: sum(asks, true), source: SOURCE,
      };
    }),

  entry("/hyperliquid/candles", "Crypto OHLCV candles: open, high, low, close and volume of Hyperliquid perps",
    "Historical price candles (OHLCV) of a Hyperliquid perpetual such as BTC, ETH or SOL: open, high, low, close, volume in coins and trade count per bar, newest last. Intervals 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w and more; up to 500 bars (default 50). Read from Hyperliquid's public API. Use for charts, backtests, volatility and trend checks, or as context for a trading agent.",
    ["ohlcv", "candles", "hyperliquid", "price-history", "crypto", "market-data"], {
      coin: { type: "string", description: "Coin symbol such as BTC, ETH, SOL or HYPE (default BTC)", example: "BTC" },
      interval: { type: "string", description: "Bar length: 1m, 3m, 5m, 15m, 30m, 1h (default), 2h, 4h, 8h, 12h, 1d, 3d or 1w", example: "1h" },
      bars: { type: "integer", description: "Number of bars, 1-500 (default 50)", example: 50 },
    },
    { coin: "BTC", interval: "1h", count: 1, candles: [{ time: "2026-10-23T08:00:00.000Z", open: 81574, high: 81916, low: 81543, close: 81761, volume: 575.87267, trades: 9106 }], source: SOURCE },
    async (_e, q) => {
      const coin = await coinInput(q("coin"));
      const interval = (q("interval")?.trim() || "1h").toLowerCase().replace(/^1mo?$/, "1m");
      const step = INTERVALS[interval];
      if (!step) throw new HttpError(400, `interval must be one of ${Object.keys(INTERVALS).join(", ")}`);
      const bars = num(q, "bars", { min: 1, max: 500, fallback: 50, integer: true });
      const end = Date.now();
      const rows = await info<{ t: number; o: string; h: string; l: string; c: string; v: string; n: number }[]>({ type: "candleSnapshot", req: { coin, interval, startTime: end - step * bars, endTime: end } });
      const candles = (rows ?? []).slice(-bars).map((r) => ({ time: new Date(r.t).toISOString(), open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c), volume: Number(r.v), trades: r.n }));
      return { coin, interval, count: candles.length, candles, source: SOURCE };
    }),

  entry("/hyperliquid/funding-history", "Funding rate history: hourly Hyperliquid perp funding rates and APR",
    "Past hourly funding rates of a Hyperliquid perpetual (BTC, ETH, SOL…): each rate with its premium and time, plus the average rate and its annualised APR over the window. Up to 500 hours back (default 24). Read from Hyperliquid's public API. Use to compare carry over time, spot funding regime changes, or backtest basis and funding-arbitrage strategies; for the current rate use hyperliquid_market.",
    ["funding-rate", "funding-history", "hyperliquid", "perps", "crypto", "derivatives"], {
      coin: { type: "string", description: "Coin symbol such as BTC, ETH, SOL or HYPE (default ETH)", example: "ETH" },
      hours: { type: "integer", description: "Hours of history, 1-500 (default 24)", example: 24 },
    },
    { coin: "ETH", hours: 24, count: 1, averageRateHourly: 0.0000125, averageAprPct: 10.95, rates: [{ time: "2026-10-23T09:00:00.089Z", fundingRateHourly: 0.0000022519, premium: -0.0004819852 }], source: SOURCE },
    async (_e, q) => {
      const coin = await coinInput(q("coin"), "ETH");
      const hours = num(q, "hours", { min: 1, max: 500, fallback: 24, integer: true });
      const rows = await info<{ fundingRate: string; premium: string; time: number }[]>({ type: "fundingHistory", coin, startTime: Date.now() - hours * 3600e3 });
      const rates = (rows ?? []).slice(-hours).map((r) => ({ time: new Date(r.time).toISOString(), fundingRateHourly: Number(r.fundingRate), premium: Number(r.premium) }));
      const avg = rates.length ? rates.reduce((s, r) => s + r.fundingRateHourly, 0) / rates.length : null;
      return { coin, hours, count: rates.length, averageRateHourly: avg === null ? null : Math.round(avg * 1e12) / 1e12, averageAprPct: avg === null ? null : Math.round(avg * 24 * 365 * 100 * 100) / 100, rates, source: SOURCE };
    }),

  entry("/hyperliquid/prices", "Crypto prices, all coins: Hyperliquid mid prices",
    "Current mid prices of every Hyperliquid perpetual in one call (BTC, ETH, SOL, HYPE and about 200 more), as a coin-to-price map, or only the coins you name. Read live from Hyperliquid's public API. Use for a quick price snapshot of many coins at once, portfolio marks or a price ticker; for funding and open interest use hyperliquid_market.",
    ["crypto-prices", "price-ticker", "hyperliquid", "crypto", "market-data", "prices"], {
      coins: { type: "string", description: "Optional comma-separated symbols such as BTC,ETH,SOL (default: every perpetual)", example: "BTC,ETH,SOL" },
    },
    { count: 3, prices: { BTC: 81870.5, ETH: 3920.15, SOL: 187.42 }, time: "2026-10-23T13:24:02.893Z", source: SOURCE },
    async (_e, q) => {
      const raw = opt(q, "coins", 400);
      const wanted = raw ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : [];
      if (wanted.length > 50) throw new HttpError(400, "at most 50 coins");
      if (wanted.some((c) => !/^[A-Z0-9]{1,20}$/.test(c))) throw new HttpError(400, "coins must be symbols such as BTC,ETH");
      const mids = await info<Record<string, string>>({ type: "allMids" });
      // Perpetuals only: spot pairs are keyed "@123" and outcome markets "#123".
      const perps = Object.entries(mids).filter(([k]) => /^[A-Za-z0-9]+$/.test(k));
      const byUpper = new Map(perps.map(([k, v]) => [k.toUpperCase(), [k, Number(v)] as const]));
      const picked = wanted.length ? wanted.map((c) => byUpper.get(c)).filter((x): x is readonly [string, number] => !!x) : perps.map(([k, v]) => [k, Number(v)] as const);
      if (wanted.length && !picked.length) throw new HttpError(404, "none of those coins has a Hyperliquid perpetual");
      const missing = wanted.filter((c) => !byUpper.has(c));
      return { count: picked.length, prices: Object.fromEntries(picked), ...(missing.length ? { notFound: missing } : {}), time: new Date().toISOString(), source: SOURCE };
    }),
];
