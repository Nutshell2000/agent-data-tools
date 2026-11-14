/**
 * Stablecoin charts (14 Nov 2026). Why: the returning outside agent 0xe629 paid another seller 170 times in three days
 * ($0.005 a call) for "stablecoin charts by chain", and the Bazaar search for "stablecoin charts" and "defillama" showed
 * several such listings with 4-8 payers each and none of ours (/stablecoin/supply reads USDC and USDT on-chain on five
 * networks: today's number, no history, no other coins).
 * Source: DefiLlama's public stablecoins API (stablecoins.llama.fi, keyless). Its terms restrict resale; using such sources
 * is the owner's decision of 5 Nov 2026, with the risk hers (an IP block or a takedown request). Kept 10 minutes as plain
 * module data, never a shared promise.
 */
import { entry, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const SOURCE = "DefiLlama stablecoins (stablecoins.llama.fi)";
const TTL_MS = 600_000;

interface Point { date: string; totalCirculatingUSD?: Record<string, number> }
interface ChainRow { name: string; totalCirculatingUSD?: Record<string, number>; tokenSymbol?: string | null }

const cache = new Map<string, { at: number; data: unknown }>();

async function llama<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    if (hit) return hit.data as T;
    throw new HttpError(502, "DefiLlama did not answer in time; try again");
  }
  if (!res.ok) {
    if (hit) return hit.data as T;
    throw new HttpError(502, `DefiLlama answered HTTP ${res.status}; try again`);
  }
  const data = (await res.json().catch(() => null)) as T | null;
  if (!Array.isArray(data) || !data.length) throw new HttpError(502, "DefiLlama sent an unreadable answer");
  if (cache.size > 40) cache.clear();
  cache.set(url, { at: Date.now(), data });
  return data;
}

/** Every peg (USD, EUR, JPY…) of one record added up, in US dollars. */
export const sumUsd = (v: Record<string, number> | undefined): number =>
  Object.values(v ?? {}).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** Names agents use for chains DefiLlama spells differently. Read with Object.hasOwn (caller input). */
const CHAIN_ALIASES: Record<string, string> = { optimism: "opmainnet", op: "opmainnet", bnb: "bsc", bnbchain: "bsc", binance: "bsc", binancesmartchain: "bsc", zksync: "zksyncera", hyperliquid: "hyperliquidl1", hyperevm: "hyperliquidl1", eth: "ethereum", arb: "arbitrum", avax: "avalanche", matic: "polygon", sol: "solana", xlayer: "xlayer", worldchain: "worldchain" };
export const chainKey = (s: string): string => { const k = norm(s); return Object.hasOwn(CHAIN_ALIASES, k) ? CHAIN_ALIASES[k] : k; };
const pct = (now: number, then: number | undefined) => (then && then > 0 ? Math.round(((now - then) / then) * 10_000) / 100 : null);

/** The daily series as dated dollar totals, oldest first, days without a figure dropped. */
export function series(points: Point[]) {
  return points
    .map((p) => ({ date: new Date(Number(p.date) * 1000).toISOString().slice(0, 10), circulatingUsd: Math.round(sumUsd(p.totalCirculatingUSD)) }))
    .filter((p) => p.circulatingUsd > 0 && !p.date.startsWith("1970"));
}

/** Latest figure, its change over 1, 7 and 30 days, and the last `days` points. */
export function chartView(points: Point[], days: number) {
  const all = series(points);
  if (!all.length) throw new HttpError(502, "DefiLlama sent no usable history");
  const last = all[all.length - 1];
  const back = (n: number) => all[all.length - 1 - n]?.circulatingUsd;
  return {
    asOf: last.date, circulatingUsd: last.circulatingUsd,
    changePercent: { d1: pct(last.circulatingUsd, back(1)), d7: pct(last.circulatingUsd, back(7)), d30: pct(last.circulatingUsd, back(30)) },
    days: Math.min(days, all.length), history: all.slice(-days),
  };
}

export const STABLECOIN_CHARTS: Entry[] = [
  entry("/stablecoin/charts", "Stablecoin charts: supply by chain",
    "Stablecoin charts from DefiLlama: the total stablecoin supply in US dollars on one blockchain (Base, Ethereum, Solana, Tron, Arbitrum…) or on all chains together, day by day for up to 365 days, with the latest figure and its 1, 7 and 30-day change. Without a chain, also the ten largest chains by supply. Use to track stablecoin inflows to a chain, chart liquidity growth, or compare ecosystems.",
    ["stablecoin-charts", "stablecoin-supply", "defillama", "stablecoins", "chain-liquidity", "defi"], {
      chain: { type: "string", description: "Blockchain by name, e.g. Base, Ethereum, Solana, Tron; leave out for all chains together", example: "Base" },
      days: { type: "integer", description: "Days of daily history to return, 1-365 (default 30)", example: 2 },
    },
    {
      chain: "Base", asOf: "2026-11-14", circulatingUsd: 5180838088, changePercent: { d1: -1.5, d7: 0.89, d30: -1.78 }, days: 2,
      history: [{ date: "2026-11-13", circulatingUsd: 5259932305 }, { date: "2026-11-14", circulatingUsd: 5180838088 }],
      source: SOURCE,
    },
    async (_env, q) => {
      const days = num(q, "days", { min: 1, max: 365, fallback: 30, integer: true });
      const asked = opt(q, "chain", 60);
      const chains = (await llama<ChainRow[]>("https://stablecoins.llama.fi/stablecoinchains"))
        .map((c) => ({ name: c.name, circulatingUsd: Math.round(sumUsd(c.totalCirculatingUSD)) }))
        .filter((c) => c.name && c.circulatingUsd > 0)
        .sort((a, b) => b.circulatingUsd - a.circulatingUsd);
      if (asked && !/^(all|all chains|total)$/i.test(asked.trim())) {
        const hit = chains.find((c) => norm(c.name) === chainKey(asked));
        if (!hit) throw new HttpError(404, `no chain named ${asked.slice(0, 40)} in DefiLlama's stablecoin data; nothing was charged`);
        const points = await llama<Point[]>(`https://stablecoins.llama.fi/stablecoincharts/${encodeURIComponent(hit.name)}`);
        return { chain: hit.name, ...chartView(points, days), source: SOURCE };
      }
      const points = await llama<Point[]>("https://stablecoins.llama.fi/stablecoincharts/all");
      return { chain: "all", ...chartView(points, days), topChains: chains.slice(0, 10), source: SOURCE };
    }),
];
