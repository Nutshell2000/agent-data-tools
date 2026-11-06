/**
 * DeFi TVL (6 Nov 2026). Bazaar search that day: "defi tvl" 20 results with 75 payers summed and "protocol tvl" 16 with 89,
 * spread over many sellers (ApiToll 9-10, agentsvc 8, Genexxis 6, x402atlas 5, openverbs 5, kadec0 4); we had none.
 * Source: DefiLlama's public API (api.llama.fi/protocols ~2.4 MB and /v2/chains, keyless, served from Cloudflare's cache),
 * kept 10 minutes as plain module data. Same licence note as /defi/yields (owner's decision of 5 Nov 2026).
 */
import { entry, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const SOURCE = "DefiLlama (api.llama.fi)";

interface Protocol {
  name: string; slug: string; category?: string; chains?: string[]; tvl?: number | null; change_1h?: number | null; change_1d?: number | null; change_7d?: number | null;
  mcap?: number | null; chainTvls?: Record<string, number>; url?: string; symbol?: string; logo?: string; twitter?: string | null;
}
interface Chain { name: string; tvl: number; tokenSymbol?: string | null; chainId?: number | null; gecko_id?: string | null }

const cache: { protocols?: { at: number; data: Protocol[] }; chains?: { at: number; data: Chain[] } } = {};

async function llama<T>(path: "protocols" | "chains", url: string): Promise<T[]> {
  const hit = cache[path];
  if (hit && Date.now() - hit.at < 600_000) return hit.data as T[];
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0" }, signal: AbortSignal.timeout(20_000) });
  } catch {
    if (hit) return hit.data as T[];
    throw new HttpError(502, "DefiLlama did not answer in time; try again");
  }
  if (!res.ok) {
    if (hit) return hit.data as T[];
    throw new HttpError(502, `DefiLlama answered HTTP ${res.status}; try again`);
  }
  const data = (await res.json().catch(() => null)) as T[] | null;
  if (!Array.isArray(data) || !data.length) throw new HttpError(502, "DefiLlama sent an unreadable answer");
  (cache as Record<string, { at: number; data: unknown[] }>)[path] = { at: Date.now(), data };
  return data;
}

const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const usd = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v));
/** Chain TVL keys that are a chain, not a breakdown ("Ethereum-borrowed", "staking", "pool2", "Binance-OwnTokens"). */
const isChainKey = (k: string) => !k.includes("-") && !["staking", "pool2", "borrowed", "doublecounted", "liquidstaking", "vesting", "offers", "treasury"].includes(k.toLowerCase());
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function protocolView(p: Protocol, chain?: string) {
  const chains = Object.entries(p.chainTvls ?? {}).filter(([k, v]) => isChainKey(k) && v > 0).sort((a, b) => b[1] - a[1]);
  return {
    name: p.name, slug: p.slug, category: p.category ?? null, symbol: p.symbol && p.symbol !== "-" ? p.symbol : null,
    tvlUsd: usd(chain ? p.chainTvls?.[chain] : p.tvl), ...(chain ? { totalTvlUsd: usd(p.tvl) } : {}),
    change: { h1: r2(p.change_1h), d1: r2(p.change_1d), d7: r2(p.change_7d) },
    mcapUsd: usd(p.mcap), mcapToTvl: p.mcap && p.tvl ? r2(p.mcap / p.tvl) : null,
    chainCount: chains.length, topChains: chains.slice(0, 5).map(([c, v]) => ({ chain: c, tvlUsd: usd(v) })),
    url: `https://defillama.com/protocol/${p.slug}`,
  };
}

/** The protocol a caller names: exact slug, then exact name, then the largest whose slug or name starts with it. */
export function findProtocol(all: Protocol[], raw: string): Protocol | undefined {
  const want = norm(raw);
  return all.find((p) => p.slug === raw.toLowerCase()) ?? all.find((p) => norm(p.name) === want || norm(p.slug) === want)
    ?? all.filter((p) => norm(p.slug).startsWith(want) || norm(p.name).startsWith(want)).sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))[0];
}

export const DEFI_TVL: Entry[] = [
  entry("/defi/tvl", "DeFi TVL, protocol TVL",
    "Total value locked of DeFi protocols from DefiLlama: name one protocol (Aave, Lido, Uniswap, a slug) for its TVL, 1h/1d/7d change, market cap to TVL and top chains; or list the top protocols by TVL, filtered by category (Lending, Dexs, Liquid Staking…) or chain, sorted by TVL or 1d/7d change. CEXs are left out unless asked for. Use to size a protocol, compare competitors or track where liquidity moves.",
    ["defi-tvl", "protocol-tvl", "tvl", "defi", "defillama", "total-value-locked"], {
      protocol: { type: "string", description: "One protocol by name or slug (aave, lido, uniswap-v3); leave out for a ranking", example: "aave" },
      category: { type: "string", description: "Only this category: Lending, Dexs, Liquid Staking, Bridge, CDP, Yield, Derivatives, CEX…", example: "Lending" },
      chain: { type: "string", description: "Rank by TVL on this chain: Ethereum, Base, Arbitrum, Solana…", example: "Base" },
      sort: { type: "string", description: "tvl (default), change_1d or change_7d", example: "tvl" },
      limit: { type: "integer", description: "Number of protocols (1-50, default 20)", example: 10 },
    },
    {
      count: 1, matched: 1, protocols: [{ name: "Aave V3", slug: "aave-v3", category: "Lending", symbol: "AAVE", tvlUsd: 34512000000, change: { h1: 0.1, d1: -1.2, d7: 2.4 }, mcapUsd: null, mcapToTvl: null, chainCount: 18, topChains: [{ chain: "Ethereum", tvlUsd: 25100000000 }], url: "https://defillama.com/protocol/aave-v3" }],
      source: SOURCE,
    },
    async (_env, q) => {
      const all = await llama<Protocol>("protocols", "https://api.llama.fi/protocols");
      const name = opt(q, "protocol", 100);
      if (name) {
        const hit = findProtocol(all, name);
        if (!hit) throw new HttpError(404, `no DeFi protocol named ${name.slice(0, 60)}; nothing was charged`);
        // A parent name ("aave") also lists its versions, largest first.
        const family = all.filter((p) => p !== hit && norm(p.name).startsWith(norm(hit.name.split(" ")[0]))).sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0)).slice(0, 5);
        return { count: 1, matched: 1, protocols: [protocolView(hit)], related: family.map((p) => ({ name: p.name, slug: p.slug, tvlUsd: usd(p.tvl) })), source: SOURCE };
      }
      const category = opt(q, "category", 60)?.toLowerCase();
      const chainIn = opt(q, "chain", 60);
      const chain = chainIn ? Object.keys(Object.assign({}, ...all.slice(0, 400).map((p) => p.chainTvls ?? {}))).find((k) => isChainKey(k) && k.toLowerCase() === chainIn.toLowerCase()) ?? chainIn : undefined;
      const sort = (opt(q, "sort", 20) ?? "tvl").toLowerCase();
      if (!["tvl", "change_1d", "change_7d"].includes(sort)) throw new HttpError(400, "sort must be tvl, change_1d or change_7d");
      const limit = num(q, "limit", { min: 1, max: 50, fallback: 20, integer: true });
      let rows = all.filter((p) => (category ? (p.category ?? "").toLowerCase() === category : (p.category ?? "") !== "CEX"));
      if (chain) rows = rows.filter((p) => (p.chainTvls?.[chain] ?? 0) > 0);
      // Change rankings skip dust and relaunches: under $10M TVL, or a move above 1,000% (6 Nov 2026: a curator vault that
      // grew from a few dollars topped the 7-day list at +135,285%).
      if (sort !== "tvl") rows = rows.filter((p) => (p.tvl ?? 0) >= 10_000_000 && Math.abs((sort === "change_1d" ? p.change_1d : p.change_7d) ?? Infinity) <= 1_000);
      const value = (p: Protocol) => (sort === "tvl" ? (chain ? p.chainTvls?.[chain] : p.tvl) : sort === "change_1d" ? p.change_1d : p.change_7d) ?? -Infinity;
      rows.sort((a, b) => value(b) - value(a));
      if (!rows.length) throw new HttpError(404, "no protocol matches these filters; nothing was charged");
      return { count: Math.min(limit, rows.length), matched: rows.length, sort, ...(chain ? { chain } : {}), protocols: rows.slice(0, limit).map((p) => protocolView(p, chain)), source: SOURCE };
    }),

  entry("/defi/chains", "Chain TVL ranking, blockchain TVL",
    "Total value locked in DeFi on every blockchain from DefiLlama: up to 100 chains ranked by TVL with their share of the total, native token and chain id, or one chain by name. Use to compare L1s and L2s, size an ecosystem or pick where to deploy.",
    ["chain-tvl", "blockchain-tvl", "defi-tvl", "tvl", "defillama"], {
      chain: { type: "string", description: "One chain by name (Base, Solana); leave out for the ranking", example: "Base" },
      limit: { type: "integer", description: "Number of chains (1-100, default 25)", example: 10 },
    },
    {
      totalTvlUsd: 98000000000, count: 1,
      chains: [{ rank: 1, name: "Ethereum", tvlUsd: 61000000000, share: 62.24, token: "ETH", chainId: 1 }],
      source: SOURCE,
    },
    async (_env, q) => {
      const all = (await llama<Chain>("chains", "https://api.llama.fi/v2/chains")).filter((c) => Number.isFinite(c.tvl) && c.tvl > 0).sort((a, b) => b.tvl - a.tvl);
      const total = all.reduce((s, c) => s + c.tvl, 0);
      const ranked = all.map((c, i) => ({ rank: i + 1, name: c.name, tvlUsd: Math.round(c.tvl), share: r2((100 * c.tvl) / total), token: c.tokenSymbol ?? null, chainId: c.chainId ?? null }));
      const one = opt(q, "chain", 60);
      if (one) {
        const hit = ranked.find((c) => norm(c.name) === norm(one));
        if (!hit) throw new HttpError(404, `no chain named ${one.slice(0, 40)} in DefiLlama; nothing was charged`);
        return { totalTvlUsd: Math.round(total), count: 1, chains: [hit], source: SOURCE };
      }
      const limit = num(q, "limit", { min: 1, max: 100, fallback: 25, integer: true });
      return { totalTvlUsd: Math.round(total), count: Math.min(limit, ranked.length), chains: ranked.slice(0, limit), source: SOURCE };
    }),
];
