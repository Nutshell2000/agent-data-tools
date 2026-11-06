/**
 * DeFi yields (6 Nov 2026). Demand: four different sellers' DeFi-yield listings (tanod defi/yields, GetDigitalCraft
 * defi-yields, dt0ur market/yields, bunnvault apy) were each paid by 4-5 of the 47 open shoppers in the 5 Nov sample of
 * Base transfers; we had nothing. Source: DefiLlama's public yields API (yields.llama.fi, keyless). /pools is ~10 MB but sits
 * in Cloudflare's cache (17 ms to first byte from a Worker, 6 Nov; ~48 s from a home PC), and the parsed pools are kept
 * 10 minutes as plain module data. DefiLlama's terms limit resale; the owner lifted our commercial-licence rule on
 * 5 Nov 2026 and accepts that risk (if DefiLlama blocks us, pause these in PAUSED_FAMILY_TOOLS).
 */
import { entry, flag, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const POOLS = "https://yields.llama.fi/pools";
const SOURCE = "DefiLlama yields (yields.llama.fi)";

interface Pool {
  chain: string; project: string; symbol: string; tvlUsd: number; apy: number | null; apyBase: number | null; apyReward: number | null;
  pool: string; apyPct1D: number | null; apyPct7D: number | null; apyPct30D: number | null; stablecoin: boolean; ilRisk: string; exposure: string;
  apyMean30d: number | null; poolMeta: string | null; rewardTokens: string[] | null; underlyingTokens: string[] | null;
  predictions?: { predictedClass?: string | null; predictedProbability?: number | null } | null; outlier?: boolean;
}

let snapshot: { at: number; pools: Pool[] } | undefined;

async function pools(): Promise<Pool[]> {
  if (snapshot && Date.now() - snapshot.at < 600_000) return snapshot.pools;
  let res: Response;
  try {
    res = await fetch(POOLS, { headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0" }, signal: AbortSignal.timeout(25_000) });
  } catch {
    if (snapshot) return snapshot.pools;
    throw new HttpError(502, "DefiLlama did not answer in time; try again");
  }
  if (!res.ok) {
    if (snapshot) return snapshot.pools;
    throw new HttpError(502, `DefiLlama answered HTTP ${res.status}; try again`);
  }
  const body = (await res.json().catch(() => null)) as { data?: Pool[] } | null;
  if (!body?.data?.length) throw new HttpError(502, "DefiLlama sent an unreadable answer");
  snapshot = { at: Date.now(), pools: body.data };
  return body.data;
}

const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

export function poolView(p: Pool) {
  return {
    chain: p.chain, project: p.project, symbol: p.symbol, meta: p.poolMeta ?? null,
    tvlUsd: Math.round(p.tvlUsd), apy: r2(p.apy), apyBase: r2(p.apyBase), apyReward: r2(p.apyReward), apyMean30d: r2(p.apyMean30d),
    apyChange: { d1: r2(p.apyPct1D), d7: r2(p.apyPct7D), d30: r2(p.apyPct30D) },
    stablecoin: p.stablecoin, impermanentLossRisk: p.ilRisk, exposure: p.exposure,
    outlook: p.predictions?.predictedClass ?? null, poolId: p.pool, url: `https://defillama.com/yields/pool/${p.pool}`,
  };
}

/** Case-insensitive match on a name list ("ethereum,base" or one word). */
const anyOf = (raw: string | undefined) => (raw ? raw.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean) : []);

export function filterPools(all: Pool[], o: { chains: string[]; projects: string[]; symbol?: string; stable: boolean; noIl: boolean; single: boolean; minTvl: number; minApy: number; maxApy: number; includeOutliers: boolean }) {
  return all.filter((p) =>
    p.apy !== null && Number.isFinite(p.apy) &&
    p.tvlUsd >= o.minTvl && p.apy >= o.minApy && p.apy <= o.maxApy &&
    (!o.chains.length || o.chains.includes(p.chain.toLowerCase())) &&
    (!o.projects.length || o.projects.some((x) => p.project.toLowerCase() === x || p.project.toLowerCase().startsWith(`${x}-`))) &&
    (!o.symbol || p.symbol.toLowerCase().split(/[-/ ]/).includes(o.symbol) || p.symbol.toLowerCase() === o.symbol) &&
    (!o.stable || p.stablecoin) && (!o.noIl || p.ilRisk === "no") && (!o.single || p.exposure === "single") &&
    (o.includeOutliers || !p.outlier));
}

export const DEFI_YIELDS: Entry[] = [
  entry("/defi/yields", "DeFi yields, best APY pools",
    "The best DeFi yields now across ~15,000 lending, staking, LP and vault pools: APY (base, reward), 30-day mean and change, TVL, stablecoin flag, impermanent-loss risk and exposure. Filter by chain, protocol, token, stablecoins, no IL, single exposure, TVL and APY range; sort by APY, TVL or 30-day mean. Source: DefiLlama. Use to find where to earn yield on a token or stablecoin. Not investment advice.",
    ["defi-yields", "best-apy", "yield-farming", "stablecoin-yield", "staking-apy", "defi", "defillama"], {
      chain: { type: "string", description: "Chain name(s), comma-separated: Ethereum, Base, Arbitrum, Solana…", example: "Base" },
      project: { type: "string", description: "Protocol slug(s): aave-v3, lido, morpho-blue, pendle…", example: "aave-v3" },
      symbol: { type: "string", description: "A token in the pool: USDC, ETH, WBTC…", example: "USDC" },
      stablecoin: { type: "string", description: "true: stablecoin pools only", example: "true" },
      noIl: { type: "string", description: "true: only pools without impermanent-loss risk", example: "true" },
      single: { type: "string", description: "true: single-asset exposure only", example: "false" },
      minTvl: { type: "number", description: "Minimum TVL in USD (default 1,000,000)", example: 1000000 },
      minApy: { type: "number", description: "Minimum APY in percent (default 0)", example: 3 },
      maxApy: { type: "number", description: "Maximum APY in percent, to drop farm spikes (default 1,000)", example: 50 },
      sort: { type: "string", description: "apy (default), tvl or apyMean30d", example: "apy" },
      limit: { type: "integer", description: "Number of pools (1-50, default 20)", example: 10 },
    },
    {
      count: 1, matched: 37, sort: "apy",
      pools: [{ chain: "Base", project: "morpho-blue", symbol: "USDC", meta: null, tvlUsd: 48211230, apy: 7.42, apyBase: 6.1, apyReward: 1.32, apyMean30d: 6.95, apyChange: { d1: 0.12, d7: -0.4, d30: 0.8 }, stablecoin: true, impermanentLossRisk: "no", exposure: "single", outlook: "Stable/Up", poolId: "7e0661bf-8cf3-45e6-9424-31916d4c7b84", url: "https://defillama.com/yields/pool/7e0661bf-8cf3-45e6-9424-31916d4c7b84" }],
      source: SOURCE, note: "Yields change constantly and carry smart-contract, depeg and liquidation risk. Not investment advice.",
    },
    async (_env, q) => {
      const sort = (opt(q, "sort", 20) ?? "apy").toLowerCase();
      const key: Record<string, (p: Pool) => number> = { apy: (p) => p.apy ?? -Infinity, tvl: (p) => p.tvlUsd, apymean30d: (p) => p.apyMean30d ?? -Infinity };
      if (!Object.hasOwn(key, sort)) throw new HttpError(400, "sort must be apy, tvl or apyMean30d");
      const limit = num(q, "limit", { min: 1, max: 50, fallback: 20, integer: true });
      const rows = filterPools(await pools(), {
        chains: anyOf(opt(q, "chain", 200)), projects: anyOf(opt(q, "project", 200)), symbol: opt(q, "symbol", 40)?.toLowerCase(),
        stable: flag(q, "stablecoin"), noIl: flag(q, "noIl"), single: flag(q, "single"),
        minTvl: num(q, "minTvl", { min: 0, max: 1e13, fallback: 1_000_000 }), minApy: num(q, "minApy", { min: -100, max: 1e6, fallback: 0 }),
        maxApy: num(q, "maxApy", { min: 0, max: 1e7, fallback: 1_000 }), includeOutliers: false,
      }).sort((a, b) => key[sort](b) - key[sort](a));
      if (!rows.length) throw new HttpError(404, "no pool matches these filters; nothing was charged");
      return { count: Math.min(limit, rows.length), matched: rows.length, sort, pools: rows.slice(0, limit).map(poolView), source: SOURCE, note: "Yields change constantly and carry smart-contract, depeg and liquidation risk. Not investment advice." };
    }),

  entry("/defi/yield-history", "DeFi pool APY history",
    "Daily APY and TVL history of one DeFi pool (a poolId from /defi/yields or a DefiLlama pool URL): up to 365 days with APY base and reward, plus the average, min, max and latest APY over the window. Source: DefiLlama. Use to check whether a yield is steady or a short spike before an agent deposits. Not investment advice.",
    ["apy-history", "defi-yields", "yield-history", "tvl-history", "defi", "defillama"], {
      pool: { type: "string", description: "DefiLlama pool id (UUID) or pool URL", required: true, example: "747c1d2a-c668-4682-b9f9-296708a3dd90" },
      days: { type: "integer", description: "Days of history (1-365, default 30)", example: 30 },
    },
    {
      pool: "747c1d2a-c668-4682-b9f9-296708a3dd90", days: 2, summary: { avgApy: 2.61, minApy: 2.58, maxApy: 2.64, latestApy: 2.64, latestTvlUsd: 21770402294 },
      history: [{ date: "2026-11-05", apy: 2.58, apyBase: 2.58, apyReward: null, tvlUsd: 21712345678 }, { date: "2026-11-06", apy: 2.64, apyBase: 2.64, apyReward: null, tvlUsd: 21770402294 }],
      url: "https://defillama.com/yields/pool/747c1d2a-c668-4682-b9f9-296708a3dd90", source: SOURCE,
    },
    async (_env, q) => {
      const raw = need(q, "pool", 200);
      const id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(raw)?.[1]?.toLowerCase();
      if (!id) throw new HttpError(400, "pool must be a DefiLlama pool id (a UUID) or a defillama.com/yields/pool/… URL");
      const days = num(q, "days", { min: 1, max: 365, fallback: 30, integer: true });
      let res: Response;
      try {
        res = await fetch(`https://yields.llama.fi/chart/${id}`, { headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0" }, signal: AbortSignal.timeout(15_000) });
      } catch {
        throw new HttpError(502, "DefiLlama did not answer in time; try again");
      }
      if (!res.ok) throw new HttpError(502, `DefiLlama answered HTTP ${res.status}; try again`);
      const body = (await res.json().catch(() => null)) as { data?: { timestamp: string; tvlUsd: number; apy: number | null; apyBase: number | null; apyReward: number | null }[] } | null;
      const all = body?.data ?? [];
      if (!all.length) throw new HttpError(404, `no history for pool ${id}; nothing was charged`);
      const rows = all.slice(-days).map((d) => ({ date: d.timestamp.slice(0, 10), apy: r2(d.apy), apyBase: r2(d.apyBase), apyReward: r2(d.apyReward), tvlUsd: Math.round(d.tvlUsd) }));
      const apys = rows.map((r) => r.apy).filter((v): v is number => v !== null);
      const last = rows[rows.length - 1];
      return {
        pool: id, days: rows.length,
        summary: { avgApy: r2(apys.reduce((s, v) => s + v, 0) / (apys.length || 1)), minApy: apys.length ? Math.min(...apys) : null, maxApy: apys.length ? Math.max(...apys) : null, latestApy: last.apy, latestTvlUsd: last.tvlUsd },
        history: rows, url: `https://defillama.com/yields/pool/${id}`, source: SOURCE,
      };
    }),
];
