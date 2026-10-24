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

// ---- technical indicators (1.54.0), pure arithmetic on closed candles --------------------------------------------------
const round = (v: number | null, d = 6) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
export function sma(xs: number[], p: number): number | null {
  if (xs.length < p) return null;
  return xs.slice(-p).reduce((s, x) => s + x, 0) / p;
}
/** EMA series seeded with the SMA of the first `p` values (the usual convention). */
export function emaSeries(xs: number[], p: number): number[] {
  if (xs.length < p) return [];
  const k = 2 / (p + 1);
  const out = [xs.slice(0, p).reduce((s, x) => s + x, 0) / p];
  for (let i = p; i < xs.length; i++) out.push(xs[i] * k + out[out.length - 1] * (1 - k));
  return out;
}
/** Wilder's RSI. */
export function rsi(xs: number[], p = 14): number | null {
  if (xs.length <= p) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= p; i++) { const d = xs[i] - xs[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= p; loss /= p;
  for (let i = p + 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    gain = (gain * (p - 1) + Math.max(d, 0)) / p;
    loss = (loss * (p - 1) + Math.max(-d, 0)) / p;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}
export function macd(xs: number[], fast = 12, slow = 26, signal = 9) {
  const f = emaSeries(xs, fast), s = emaSeries(xs, slow);
  if (!s.length) return null;
  const line = s.map((v, i) => f[i + (slow - fast)] - v);
  const sig = emaSeries(line, signal);
  if (!sig.length) return null;
  const m = line[line.length - 1], g = sig[sig.length - 1];
  return { macd: m, signal: g, histogram: m - g };
}
export function bollinger(xs: number[], p = 20, k = 2) {
  if (xs.length < p) return null;
  const w = xs.slice(-p), mid = w.reduce((s, x) => s + x, 0) / p;
  const sd = Math.sqrt(w.reduce((s, x) => s + (x - mid) ** 2, 0) / p);
  const upper = mid + k * sd, lower = mid - k * sd, last = xs[xs.length - 1];
  return { upper, middle: mid, lower, percentB: upper === lower ? null : (last - lower) / (upper - lower), bandwidth: mid ? (upper - lower) / mid : null };
}
/** Wilder's average true range. */
export function atr(rows: { high: number; low: number; close: number }[], p = 14): number | null {
  if (rows.length <= p) return null;
  const tr = rows.slice(1).map((r, i) => Math.max(r.high - r.low, Math.abs(r.high - rows[i].close), Math.abs(r.low - rows[i].close)));
  let a = tr.slice(0, p).reduce((s, x) => s + x, 0) / p;
  for (let i = p; i < tr.length; i++) a = (a * (p - 1) + tr[i]) / p;
  return a;
}
/** Annualised close-to-close volatility from log returns, in percent. */
export function realizedVol(xs: number[], barMs: number): number | null {
  if (xs.length < 3) return null;
  const r = xs.slice(1).map((x, i) => Math.log(x / xs[i]));
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1));
  return sd * Math.sqrt((365 * 86400e3) / barMs) * 100;
}

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

  entry("/hyperliquid/indicators", "Crypto technical indicators: RSI, MACD, moving averages, Bollinger bands and ATR",
    "Technical indicators for a Hyperliquid perpetual (BTC, ETH, SOL…) on closed candles of any interval from 1m to 1w: RSI 14, MACD 12/26/9, SMA 20/50/200, EMA 12/26/50, Bollinger bands 20/2 with %B, ATR 14, annualised realised volatility, and plain readings such as overbought or above the 200 SMA. Computed from Hyperliquid's public candles. Use as context for a trading agent or a market dashboard; not investment advice.",
    ["technical-indicators", "rsi", "macd", "moving-average", "hyperliquid", "crypto"], {
      coin: { type: "string", description: "Coin symbol such as BTC, ETH, SOL or HYPE (default BTC)", example: "BTC" },
      interval: { type: "string", description: "Candle length: 1m, 5m, 15m, 30m, 1h, 4h (default), 1d, 1w and others", example: "4h" },
    },
    { coin: "BTC", interval: "4h", bars: 250, close: 81870, rsi14: 48.21, macd: { macd: -152.3, signal: -98.4, histogram: -53.9 }, sma: { "20": 82110, "50": 83340, "200": 79870 }, ema: { "12": 81990, "26": 82240, "50": 82900 }, bollinger: { upper: 83560, middle: 82110, lower: 80660, percentB: 0.42, bandwidth: 0.035 }, atr14: 812.5, realizedVolPct: 41.2, readings: ["RSI neutral (30-70)", "MACD below its signal line", "price below SMA 50", "price above SMA 200"], source: SOURCE },
    async (_e, q) => {
      const coin = await coinInput(q("coin"));
      const interval = (q("interval")?.trim() || "4h").toLowerCase();
      const step = INTERVALS[interval];
      if (!step) throw new HttpError(400, `interval must be one of ${Object.keys(INTERVALS).join(", ")}`);
      const end = Date.now();
      const raw = await info<{ t: number; o: string; h: string; l: string; c: string }[]>({ type: "candleSnapshot", req: { coin, interval, startTime: end - step * 251, endTime: end } });
      // The newest bar is still forming; indicators use closed bars only.
      const rows = (raw ?? []).filter((r) => r.t + step <= end).slice(-250).map((r) => ({ high: Number(r.h), low: Number(r.l), close: Number(r.c) }));
      if (rows.length < 30) throw new HttpError(404, `Hyperliquid has only ${rows.length} closed ${interval} candles for ${coin}; try a shorter interval`);
      const closes = rows.map((r) => r.close), close = closes[closes.length - 1];
      const r14 = rsi(closes), m = macd(closes), bb = bollinger(closes);
      const s = { "20": sma(closes, 20), "50": sma(closes, 50), "200": sma(closes, 200) };
      const last = (xs: number[]) => (xs.length ? xs[xs.length - 1] : null);
      const e = { "12": last(emaSeries(closes, 12)), "26": last(emaSeries(closes, 26)), "50": last(emaSeries(closes, 50)) };
      const readings: string[] = [];
      if (r14 !== null) readings.push(r14 >= 70 ? "RSI overbought (70 or more)" : r14 <= 30 ? "RSI oversold (30 or less)" : "RSI neutral (30-70)");
      if (m) readings.push(m.histogram >= 0 ? "MACD above its signal line" : "MACD below its signal line");
      for (const p of ["50", "200"] as const) if (s[p] !== null) readings.push(`price ${close >= s[p]! ? "above" : "below"} SMA ${p}`);
      if (bb?.percentB != null) { if (bb.percentB > 1) readings.push("close above the upper Bollinger band"); else if (bb.percentB < 0) readings.push("close below the lower Bollinger band"); }
      const map = (o: Record<string, number | null>, d: number) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v, d)]));
      const dp = close >= 100 ? 2 : close >= 1 ? 4 : 8;
      return {
        coin, interval, bars: rows.length, close, rsi14: round(r14, 2),
        macd: m ? { macd: round(m.macd, dp), signal: round(m.signal, dp), histogram: round(m.histogram, dp) } : null,
        sma: map(s, dp), ema: map(e, dp),
        bollinger: bb ? { upper: round(bb.upper, dp), middle: round(bb.middle, dp), lower: round(bb.lower, dp), percentB: round(bb.percentB, 4), bandwidth: round(bb.bandwidth, 4) } : null,
        atr14: round(atr(rows), dp), realizedVolPct: round(realizedVol(closes, step), 2), readings, source: SOURCE,
      };
    }),

  entry("/hyperliquid/prices","Crypto prices, all coins: Hyperliquid mid prices",
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
