// Hyperliquid perpetuals market data from its public L1 info API (keyless; the interface terms say nothing about the
// API; Peter approved this tool on 2026-10-20). Funding, open interest and volume are the most-paid derivatives data.
import { entry, opt, type Entry } from "../family";
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
];
