// More chain data (1.78.0, 25 Oct 2026), read from the networks themselves or from Sourcify's open verification repository.
// Bazaar searches that day with nothing of ours: "stablecoin supply" (36 payers summed over the top 20), "contract abi" (34),
// "uniswap pool" (30), "token supply" (26), "abi" (26) and "verified contract" (25); each #1 had 2 to 6 payers.
import { formatUnits, getAddress, type PublicClient } from "viem";
import { entry, need, num, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";
import { erc20Abi } from "../lib/rpc";
import { tokenAddress } from "../lib/tickers";
import { CHAINS, client, codeKind, logsClient, recentLogs, rpc, topicLogsClient } from "./chain-reads";
import { chainSlug } from "./whale";

const CHAIN_IDS: Record<string, number> = { eth: 1, base: 8453, arb: 42161, op: 10, polygon: 137 };
const def = (slug: string) => CHAINS.find((c) => c.slug === slug)!;
const supplyOf = (cl: PublicClient, token: `0x${string}`) => Promise.all([
  cl.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }) as Promise<bigint>,
  cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
]);

const tokenInput = (raw: string, slug: string) => {
  try { return tokenAddress(raw, slug); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, "token must be a 0x address or a known ticker"); }
};

/** Function and event signatures with their 4-byte selectors / topics from an ABI. */
export function abiSummary(abi: { type?: string; name?: string; inputs?: { type: string; name?: string }[]; stateMutability?: string }[]) {
  const sig = (x: { name?: string; inputs?: { type: string }[] }) => `${x.name}(${(x.inputs ?? []).map((i) => i.type).join(",")})`;
  return {
    functions: abi.filter((x) => x.type === "function").map((x) => ({ signature: sig(x), stateMutability: x.stateMutability ?? null })),
    events: abi.filter((x) => x.type === "event").map((x) => sig(x)),
    errors: abi.filter((x) => x.type === "error").map((x) => sig(x)),
  };
}

type Sourcify = { match?: string; abi?: unknown[]; compilation?: { name?: string; compilerVersion?: string; language?: string; fullyQualifiedName?: string }; proxyResolution?: { isProxy?: boolean; proxyType?: string | null; implementations?: { address: string; name?: string }[] }; verifiedAt?: string; sources?: Record<string, { content?: string }> };
async function sourcify(chainId: number, address: string, fields: string): Promise<Sourcify | null> {
  let res: Response;
  try { res = await fetch(`https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=${fields}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 86_400, cacheEverything: true } }); }
  catch { throw new HttpError(502, "Sourcify did not answer in time; try again"); }
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `Sourcify answered HTTP ${res.status}; try again`);
  return (await res.json()) as Sourcify;
}

const poolAbi = [
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
] as const;
const factoryAbi = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] }] as const;
const FACTORY: Record<string, `0x${string}`> = { base: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", eth: "0x1F98431c8aD98523631AE4a59f267346ea31F984", arb: "0x1F98431c8aD98523631AE4a59f267346ea31F984", op: "0x1F98431c8aD98523631AE4a59f267346ea31F984", polygon: "0x1F98431c8aD98523631AE4a59f267346ea31F984" };
const FEES = [100, 500, 3000, 10000] as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const sig6 = (n: number) => Number(n.toPrecision(6));

// New-pool feeds (1.83.3, 31 Oct 2026). A task shopper paid a competitor $0.10 a call, 82 times, for new and trending DEX
// pools (business/agentic/base-bots/buyer-wants.mjs); nothing of ours answered "new pools" or "new pairs". The factories'
// creation events are the primary source: Uniswap v3 PoolCreated on five networks, Uniswap v2 PairCreated on the same
// five, Aerodrome PoolCreated on Base. Every address below was checked live on 31 Oct 2026 by counting recent events.
type Dex = "uniswap-v3" | "uniswap-v2" | "aerodrome";
type DexFactory = { dex: Dex; address: `0x${string}`; topic: `0x${string}` };
const V3_CREATED = "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118" as const; // PoolCreated(address,address,uint24,int24,address)
const V2_CREATED = "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9" as const; // PairCreated(address,address,address,uint256)
const AERO_CREATED = "0x2128d88d14c80cb081c1252a5acff7a264671bf199ce226b53788fb26065005e" as const; // PoolCreated(address,address,bool,address,uint256)
const V2_FACTORY: Record<string, `0x${string}`> = { eth: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", base: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6", arb: "0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9", op: "0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf", polygon: "0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C" };
export const DEX_FACTORIES: Record<string, DexFactory[]> = Object.fromEntries(Object.keys(FACTORY).map((slug) => [slug, [
  { dex: "uniswap-v3" as Dex, address: FACTORY[slug], topic: V3_CREATED },
  { dex: "uniswap-v2" as Dex, address: V2_FACTORY[slug], topic: V2_CREATED },
  ...(slug === "base" ? [{ dex: "aerodrome" as Dex, address: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as `0x${string}`, topic: AERO_CREATED }] : []),
]]));
const BLOCK_SECONDS: Record<string, number> = { eth: 12, base: 2, arb: 0.25, op: 2, polygon: 2 };
const topicAddr = (t: string) => getAddress("0x" + t.slice(26));
const word = (data: string, i: number) => data.slice(2 + 64 * i, 2 + 64 * (i + 1));

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

/** Swap event topics (5 Nov 2026): Uniswap v3 and Aerodrome Slipstream share one signature; Uniswap v2; Aerodrome v2 pools. */
const SWAP_TOPICS: `0x${string}`[] = [
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822",
  "0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b",
];
const pairAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;
/** Base majors left out of trending by default: WETH, USDC, USDbC, cbBTC, cbETH, DAI, USDT, EURC, wstETH. */
const BASE_MAJORS: ReadonlySet<string> = new Set([
  "0x4200000000000000000000000000000000000006", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",
]);

export type NewPool = { dex: Dex; pool: string; token0: string; token1: string; feeTier: number | null; stable: boolean | null; block: number; txHash: string };
/** One factory creation event as a plain record; null when the log is not the shape the factory emits. */
export function decodePoolCreated(log: { blockNumber: string; transactionHash: string; topics: string[]; data: string }, dex: Dex): NewPool | null {
  const t = log.topics;
  const base = { dex, block: Number(BigInt(log.blockNumber)), txHash: log.transactionHash };
  if (dex === "uniswap-v3" && t.length === 4 && log.data.length >= 2 + 128) return { ...base, token0: topicAddr(t[1]), token1: topicAddr(t[2]), feeTier: Number(BigInt(t[3])), stable: null, pool: getAddress("0x" + word(log.data, 1).slice(24)) };
  if (dex === "uniswap-v2" && t.length === 3 && log.data.length >= 2 + 64) return { ...base, token0: topicAddr(t[1]), token1: topicAddr(t[2]), feeTier: 3000, stable: null, pool: getAddress("0x" + word(log.data, 0).slice(24)) };
  if (dex === "aerodrome" && t.length === 4 && log.data.length >= 2 + 64) return { ...base, token0: topicAddr(t[1]), token1: topicAddr(t[2]), feeTier: null, stable: BigInt(t[3]) === 1n, pool: getAddress("0x" + word(log.data, 0).slice(24)) };
  return null;
}

export const CHAIN_MORE: Entry[] = [
  entry("/stablecoin/supply", "Stablecoin supply: USDC and USDT on 5 networks",
    "Live total supply of USDC and USDT on Ethereum, Base, Arbitrum, Optimism and Polygon, read from each token contract (totalSupply), per network and summed per token, plus the grand total. A network whose nodes do not answer is listed with an error instead of failing the call. Use to track stablecoin issuance, liquidity on a chain or mints and burns over time.",
    ["stablecoin-supply", "usdc-supply", "usdt-supply", "stablecoins", "total-supply"], {
      token: { type: "string", description: "USDC, USDT or both (default both)", example: "both" },
    },
    { tokens: { USDC: { totalUsd: 61000000000, networks: [{ chain: "Ethereum", supply: 40000000000, error: null }] }, USDT: { totalUsd: 72000000000, networks: [] } }, totalUsd: 133000000000, source: "token contracts (totalSupply), read live" },
    async (env, q) => {
      const want = (opt(q, "token", 10) ?? "both").toUpperCase();
      const symbols = want === "BOTH" || want === "ALL" ? ["USDC", "USDT"] : [want];
      if (symbols.some((s) => s !== "USDC" && s !== "USDT")) throw new HttpError(400, "token must be USDC, USDT or both");
      const tokens: Record<string, { totalUsd: number; networks: { chain: string; supply: number | null; error: string | null }[] }> = {};
      await Promise.all(symbols.map(async (sym) => {
        const nets = await Promise.all(CHAINS.map(async (c) => {
          let address: `0x${string}`;
          try { address = tokenAddress(sym, c.slug); } catch { return null; }
          try { const [s, d] = await rpc(() => supplyOf(client(env, c), address)); return { chain: c.name, supply: Math.round(Number(formatUnits(s, d))), error: null }; }
          catch { return { chain: c.name, supply: null, error: "the network's public nodes did not answer" }; }
        }));
        const list = nets.filter((n): n is NonNullable<typeof n> => n !== null);
        tokens[sym] = { totalUsd: list.reduce((a, n) => a + (n.supply ?? 0), 0), networks: list };
      }));
      if (Object.values(tokens).every((t) => t.networks.every((n) => n.supply === null))) throw new HttpError(502, "no network answered; nothing was charged");
      return { tokens, totalUsd: Object.values(tokens).reduce((a, t) => a + t.totalUsd, 0), source: "token contracts (totalSupply), read live" };
    }),

  entry("/token/supply", "Token supply, total supply: any ERC-20",
    "Total supply of any ERC-20 token on Ethereum, Base, Arbitrum, Optimism or Polygon, read live from the contract: raw and decimal-adjusted supply, decimals, name and symbol. Give a 0x address or a known ticker (USDC, USDT, WETH, DAI…). Use to check a token's circulating maximum or compare supply across chains.",
    ["token-supply", "total-supply", "erc20", "token", "blockchain"], {
      token: { type: "string", description: "Token 0x address or ticker", required: true, example: "USDC" },
      chain: { type: "string", description: "ethereum (default), base, arbitrum, optimism or polygon", example: "base" },
    },
    { chain: "Base", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", symbol: "USDC", decimals: 6, totalSupply: 4100000000.5, totalSupplyRaw: "4100000000500000" },
    async (env, q) => {
      const slug = chainSlug(opt(q, "chain", 30));
      const token = tokenInput(need(q, "token", 60), slug);
      const cl = client(env, def(slug));
      const [supply, decimals, name, symbol] = await rpc(() => Promise.all([
        cl.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }) as Promise<bigint>,
        cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
        (cl.readContract({ address: token, abi: erc20Abi, functionName: "name" }) as Promise<string>).catch(() => null),
        (cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }) as Promise<string>).catch(() => null),
      ]));
      return { chain: def(slug).name, token: getAddress(token), name, symbol, decimals: Number(decimals), totalSupply: Number(formatUnits(supply, Number(decimals))), totalSupplyRaw: supply.toString() };
    }),

  entry("/contract/abi", "Contract ABI, verified contract: ABI and source",
    "The verified ABI of a smart contract on Ethereum, Base, Arbitrum, Optimism or Polygon from Sourcify's open verification repository: contract name, compiler, match quality, every function and event signature, the full ABI, and for proxies the implementation contract with its ABI. Optional source=true adds the main source file (up to 20,000 characters). Unverified contracts are an uncharged 422. Use before calling or decoding a contract.",
    ["contract-abi", "abi", "verified-contract", "contract-source", "evm"], {
      address: { type: "string", description: "Contract 0x address", required: true, example: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
      chain: { type: "string", description: "ethereum (default), base, arbitrum, optimism or polygon", example: "base" },
      source: { type: "string", description: "true to include the main source file", example: "false" },
    },
    { chain: "Ethereum", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", name: "FiatTokenProxy", match: "exact_match", compiler: "0.6.12+commit.27d51765", proxy: { type: "ZeppelinOSProxy", implementation: "0x2Ce6311ddAE708829bc0784C967b7d77D19FD779", implementationName: "FiatTokenV2_2" }, functions: [{ signature: "transfer(address,uint256)", stateMutability: "nonpayable" }], events: ["Transfer(address,address,uint256)"], errors: [], abi: [], source: "Sourcify (sourcify.dev)" },
    async (_env, q) => {
      const slug = chainSlug(opt(q, "chain", 30));
      const raw = need(q, "address", 60);
      if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new HttpError(400, "address must be a 0x contract address");
      const address = getAddress(raw);
      const withSource = /^(true|1|yes)$/i.test(opt(q, "source", 5) ?? "");
      const chainId = CHAIN_IDS[slug];
      const c = await sourcify(chainId, address, `abi,compilation,proxyResolution,verifiedAt${withSource ? ",sources" : ""}`);
      if (!c) throw new HttpError(404, `${address} is not verified on Sourcify for ${def(slug).name}; nothing was charged`);
      const impl = c.proxyResolution?.isProxy ? c.proxyResolution.implementations?.[0] : undefined;
      const implData = impl ? await sourcify(chainId, getAddress(impl.address), "abi,compilation").catch(() => null) : null;
      const abi = (implData?.abi ?? c.abi ?? []) as Parameters<typeof abiSummary>[0];
      const main = withSource && c.sources ? (() => {
        const want = c.compilation?.fullyQualifiedName?.split(":")[0];
        const entryPath = (want && c.sources[want] ? want : Object.keys(c.sources)[0]) ?? null;
        const content = entryPath ? c.sources[entryPath]?.content ?? "" : "";
        return entryPath ? { path: entryPath, content: content.slice(0, 20_000), truncated: content.length > 20_000, files: Object.keys(c.sources).length } : null;
      })() : undefined;
      return {
        chain: def(slug).name, address, name: c.compilation?.name ?? null, match: c.match ?? null, compiler: c.compilation?.compilerVersion ?? null, language: c.compilation?.language ?? null, verifiedAt: c.verifiedAt ?? null,
        proxy: c.proxyResolution?.isProxy ? { type: c.proxyResolution.proxyType ?? null, implementation: impl?.address ?? null, implementationName: impl?.name ?? implData?.compilation?.name ?? null, abiFrom: implData?.abi ? "implementation" : "proxy" } : null,
        ...abiSummary(abi), abi, ...(main !== undefined ? { sourceFile: main } : {}), source: "Sourcify (sourcify.dev)",
      };
    }),

  entry("/uniswap/pool", "Uniswap pool, V3 pool: state and price",
    "Uniswap v3 pools for a token pair on Ethereum, Base, Arbitrum, Optimism or Polygon, read live from the factory and each pool: pool address per fee tier (0.01%, 0.05%, 0.3%, 1%), price of each token in the other, current tick, in-range liquidity and both token balances held, deepest pool first. Tokens by 0x address or ticker. Use to find the right pool, check depth before a swap or read a spot price.",
    ["uniswap-pool", "uniswap", "liquidity-pool", "pool-liquidity", "defi"], {
      tokenA: { type: "string", description: "First token: 0x address or ticker", required: true, example: "WETH" },
      tokenB: { type: "string", description: "Second token: 0x address or ticker", required: true, example: "USDC" },
      chain: { type: "string", description: "ethereum (default), base, arbitrum, optimism or polygon", example: "base" },
    },
    { chain: "Base", tokenA: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH" }, tokenB: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC" }, pools: [{ address: "0xd0b53D9277642d899DF5C87A3966A349A798F224", feeTier: 500, priceAinB: 2338.2, priceBinA: 0.000427679, tick: -199500, liquidity: "1234567890123", balanceA: 5100.2, balanceB: 9800000.5 }], source: "Uniswap v3 factory and pool contracts, read live" },
    async (env, q) => {
      const slug = chainSlug(opt(q, "chain", 30));
      // pair=WETH/USDC as agents write it (26 Oct 2026 probe), when tokenA/tokenB are not given.
      const pair = q("pair")?.split(/[/\s,:-]+/).filter(Boolean);
      const pq = (n: string) => q(n) ?? (pair?.length === 2 ? pair[n === "tokenA" ? 0 : 1] : undefined);
      const a = tokenInput(need(pq, "tokenA", 60), slug), b = tokenInput(need(pq, "tokenB", 60), slug);
      if (a.toLowerCase() === b.toLowerCase()) throw new HttpError(400, "tokenA and tokenB must differ");
      const cl = client(env, def(slug));
      const meta = async (t: `0x${string}`) => {
        const [d, s] = await Promise.all([cl.readContract({ address: t, abi: erc20Abi, functionName: "decimals" }) as Promise<number>, (cl.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }) as Promise<string>).catch(() => null)]);
        return { decimals: Number(d), symbol: s };
      };
      const [ma, mb, addrs] = await rpc(() => Promise.all([meta(a), meta(b), Promise.all(FEES.map((fee) => cl.readContract({ address: FACTORY[slug], abi: factoryAbi, functionName: "getPool", args: [a, b, fee] })))]));
      const aIs0 = a.toLowerCase() < b.toLowerCase();
      const pools = (await rpc(() => Promise.all(addrs.map(async (pool, i) => {
        if (pool === ZERO) return null;
        const [slot0, liquidity, balA, balB] = await Promise.all([
          cl.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
          cl.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
          cl.readContract({ address: a, abi: erc20Abi, functionName: "balanceOf", args: [pool] }) as Promise<bigint>,
          cl.readContract({ address: b, abi: erc20Abi, functionName: "balanceOf", args: [pool] }) as Promise<bigint>,
        ]);
        if (slot0[0] === 0n) return null;
        const s = Number(slot0[0]) / 2 ** 96, raw1per0 = s * s;
        const rawBperA = aIs0 ? raw1per0 : 1 / raw1per0;
        const priceAinB = rawBperA * 10 ** (ma.decimals - mb.decimals);
        return { address: pool, feeTier: FEES[i], priceAinB: sig6(priceAinB), priceBinA: priceAinB ? sig6(1 / priceAinB) : null, tick: Number(slot0[1]), liquidity: liquidity.toString(), balanceA: sig6(Number(formatUnits(balA, ma.decimals))), balanceB: sig6(Number(formatUnits(balB, mb.decimals))) };
      })))).filter((p): p is NonNullable<typeof p> => p !== null).sort((x, y) => y.balanceB - x.balanceB);
      if (!pools.length) throw new HttpError(404, `no Uniswap v3 pool for this pair on ${def(slug).name}; nothing was charged`);
      return { chain: def(slug).name, tokenA: { address: getAddress(a), symbol: ma.symbol }, tokenB: { address: getAddress(b), symbol: mb.symbol }, pools, source: "Uniswap v3 factory and pool contracts, read live" };
    }),

  entry("/dex/new-pools", "New pools, new token pairs: Uniswap and Aerodrome",
    "Newest liquidity pools on Uniswap v3, Uniswap v2 and (on Base) Aerodrome, read live from the factories' PoolCreated and PairCreated events on Base, Ethereum, Arbitrum, Optimism or Polygon: pool address, both tokens with symbol and decimals, fee tier or stable flag, block, transaction and approximate age, newest first. Use to spot new token listings, watch pool launches or feed a new-pair screener; check token_report before trading.",
    ["new-pools", "new-pairs", "new-tokens", "dex", "uniswap", "aerodrome", "liquidity-pool", "token-launch"], {
      chain: { type: "string", description: "base (default), ethereum, arbitrum, optimism or polygon", example: "base" },
      dex: { type: "string", description: "all (default), uniswap-v3, uniswap-v2 or aerodrome (Base only)", example: "all" },
      blocks: { type: "string", description: "How many recent blocks to scan, 100 to 20000 (default 3000: about 100 minutes on Base, 10 hours on Ethereum)", example: "3000" },
      limit: { type: "string", description: "Most pools to return, 1 to 30 (default 20)", example: "20" },
    },
    { chain: "Base", blocksScanned: 3000, fromBlock: 37000000, toBlock: 37002999, count: 2, pools: [{ dex: "uniswap-v2", pool: "0x1111111111111111111111111111111111111111", token0: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 }, token1: { address: "0x2222222222222222222222222222222222222222", symbol: "NEW", decimals: 18 }, feeTier: 3000, stable: null, block: 37002990, txHash: "0xabc", approxAgeMinutes: 0.3 }], source: "Uniswap v3, Uniswap v2 and Aerodrome factory events, read live" },
    async (env, q) => {
      const slug = chainSlug(opt(q, "chain", 30) ?? "base");
      const want = (opt(q, "dex", 20) ?? "all").toLowerCase();
      const factories = DEX_FACTORIES[slug].filter((f) => want === "all" || f.dex === want);
      if (!factories.length) throw new HttpError(400, want === "aerodrome" ? "aerodrome is on Base only" : "dex must be all, uniswap-v3, uniswap-v2 or aerodrome");
      const span = BigInt(num(q, "blocks", { min: 100, max: 20_000, fallback: 3000, integer: true }));
      const limit = num(q, "limit", { min: 1, max: 30, fallback: 20, integer: true });
      const cl = client(env, def(slug));
      // Log scans go through the log-capable node order (logsClient) and a block a few behind the head, as /token/buyers
      // does: the general client's first nodes refuse eth_getLogs, and /status showed 5 of 9 calls failing (6 Nov 2026).
      // One factory's failure leaves the others' pools in the answer; only a total failure is a 502.
      const logs = logsClient(env, def(slug));
      const latest = (await rpc(() => logs.getBlockNumber())) - 3n;
      let lastError: unknown;
      const settled = await Promise.all(factories.map(async (f) => {
        try { return { f, ...(await recentLogs(logs, { address: f.address, topics: [f.topic] }, latest, span, limit)) }; }
        catch (e) { lastError = e; return null; }
      }));
      const scans = settled.filter((s): s is NonNullable<typeof s> => s !== null);
      if (!scans.length) throw lastError;
      const found = scans.flatMap((s) => s.logs.map((l) => decodePoolCreated(l, s.f.dex)).filter((p): p is NewPool => p !== null));
      found.sort((x, y) => y.block - x.block);
      const pools = found.slice(0, limit);
      const tokens = [...new Set(pools.flatMap((p) => [p.token0, p.token1]))] as `0x${string}`[];
      const meta = new Map(await Promise.all(tokens.map(async (t) => {
        const [symbol, decimals] = await Promise.all([
          (cl.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }) as Promise<string>).catch(() => null),
          (cl.readContract({ address: t, abi: erc20Abi, functionName: "decimals" }) as Promise<number>).then(Number).catch(() => null),
        ]);
        return [t, { symbol, decimals }] as const;
      })));
      const fromBlock = Number(scans.reduce((m, s) => (s.fromBlock < m ? s.fromBlock : m), latest));
      const secs = BLOCK_SECONDS[slug];
      return {
        chain: def(slug).name, blocksScanned: Number(latest) - fromBlock + 1, fromBlock, toBlock: Number(latest), count: pools.length,
        pools: pools.map((p) => ({ ...p, token0: { address: p.token0, ...meta.get(p.token0 as `0x${string}`) }, token1: { address: p.token1, ...meta.get(p.token1 as `0x${string}`) }, approxAgeMinutes: sig6((Number(latest) - p.block) * secs / 60) })),
        source: "Uniswap v3, Uniswap v2 and Aerodrome factory events, read live",
      };
    }),

  // Who bought and who sold (5 Nov 2026): Nansen's who-bought-sold had 61 payers at $0.01 and we sold nothing like it.
  // Net flow per address from the token's own Transfer logs (address-filtered, so every log node answers); contracts
  // (pools, routers, vaults) are left out so the list is wallets.
  entry("/token/buyers", "Token buyers and sellers",
    "Who bought and who sold a token lately: the wallets that took the most of an ERC-20 from DEX pools and routers (buyers) or sent the most to them (sellers) over recent blocks, from its live Transfer logs on Base (default), Ethereum, Arbitrum, Optimism or Polygon, with bought, sold, net and transfers. Contracts are left out; plain wallet-to-wallet moves only count in netAll. Use to see who accumulates or dumps a token before you trade it.",
    ["token-buyers", "who-bought", "smart-money", "token-flows", "wallet", "dex", "blockchain"], {
      token: { type: "string", description: "Token: 0x ERC-20 address, or a ticker such as AERO, DEGEN or USDC", required: true, example: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
      chain: { type: "string", description: "base (default), ethereum, arbitrum, optimism or polygon", example: "base" },
      blocks: { type: "integer", description: "How many recent blocks to read, 100 to 10000 (default 1800: about an hour on Base, 6 hours on Ethereum)", example: 1800 },
      limit: { type: "integer", description: "Buyers and sellers to return each, 1 to 20 (default 10)", example: 10 },
    },
    { chain: "Base", token: { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", symbol: "AERO", decimals: 18 }, fromBlock: 37001200, toBlock: 37002999, transfersRead: 1840, truncated: false,
      dexContractsSeen: 12, buyers: [{ address: "0x3333333333333333333333333333333333333333", bought: "15230.5", sold: "0", netViaDex: "15230.5", netAll: "15230.5", transfers: 4 }],
      sellers: [{ address: "0x4444444444444444444444444444444444444444", bought: "0", sold: "8800", netViaDex: "-8800", netAll: "-8800", transfers: 2 }],
      note: "Bought and sold count transfers from and to DEX pools, routers and other busy contracts; netAll includes plain wallet-to-wallet moves. Contracts are left out of the lists." },
    async (env, q) => {
      const slug = chainSlug(opt(q, "chain", 30) ?? "base");
      const token = tokenInput(need(q, "token", 80), slug) as `0x${string}`;
      const span = BigInt(num(q, "blocks", { min: 100, max: 10_000, fallback: 1800, integer: true }));
      const limit = num(q, "limit", { min: 1, max: 20, fallback: 10, integer: true });
      const c = def(slug);
      const cl = client(env, c);
      const logs = logsClient(env, c);
      const latest = (await rpc(() => logs.getBlockNumber())) - 3n;
      // A busy token fills 3,000 transfers in a few blocks: the window then shrinks to what was read (fromBlock says so).
      const scan = await recentLogs(logs, { address: token, topics: [TRANSFER] }, latest, span, 3000);
      const [decimals, symbol] = await Promise.all([
        (cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }) as Promise<number>).then(Number).catch(() => null),
        (cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }) as Promise<string>).catch(() => null),
      ]);
      if (decimals === null) throw new HttpError(404, "that address is not an ERC-20 token on this network (nothing was charged)");
      const edges: { from: string; to: string; amount: bigint }[] = [];
      for (const l of scan.logs) {
        if (l.topics.length !== 3) continue;
        edges.push({ from: `0x${l.topics[1].slice(26)}`, to: `0x${l.topics[2].slice(26)}`, amount: BigInt(l.data === "0x" ? 0 : l.data.slice(0, 66)) });
      }
      // Hubs: addresses that dealt with 3+ others in 4+ transfers (pools, routers, aggregators). The 30 busiest are checked
      // for code; a wallet's buys are what it got from those contracts, its sells what it sent to them. A plain move between
      // two wallets (5 Nov test: 3.9 million AERO) is not a buy and only shows in netAll.
      const degree = new Map<string, { n: number; peers: Set<string> }>();
      for (const e of edges) for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
        const d = degree.get(a) ?? { n: 0, peers: new Set<string>() };
        d.n++; d.peers.add(b); degree.set(a, d);
      }
      const isCode = (a: string) => cl.getCode({ address: a as `0x${string}` }).then((code) => codeKind(code ?? "0x").isContract).catch(() => false);
      const hubCandidates = [...degree.entries()].filter(([a, d]) => a !== ZERO && d.n >= 4 && d.peers.size >= 3).sort((x, y) => y[1].n - x[1].n).slice(0, 30).map(([a]) => a);
      const hubCode = await Promise.all(hubCandidates.map(isCode));
      const hubs = new Set(hubCandidates.filter((_, i) => hubCode[i]));
      type Flow = { inn: bigint; out: bigint; dexIn: bigint; dexOut: bigint; n: number };
      const flows = new Map<string, Flow>();
      const at = (a: string) => { const v = flows.get(a) ?? { inn: 0n, out: 0n, dexIn: 0n, dexOut: 0n, n: 0 }; flows.set(a, v); return v; };
      for (const e of edges) {
        if (e.from !== ZERO) { const v = at(e.from); v.out += e.amount; v.n++; if (hubs.has(e.to)) v.dexOut += e.amount; }
        if (e.to !== ZERO) { const v = at(e.to); v.inn += e.amount; v.n++; if (hubs.has(e.from)) v.dexIn += e.amount; }
      }
      const rows = [...flows.entries()].filter(([a]) => !hubs.has(a)).map(([a, v]) => ({ a, v, dex: v.dexIn - v.dexOut, all: v.inn - v.out }));
      // With no hub seen (a quiet token), fall back to plain net flow.
      const score = (x: (typeof rows)[number]) => (hubs.size ? x.dex : x.all);
      const byScore = (desc: boolean) => (x: (typeof rows)[number], y: (typeof rows)[number]) => { const d = score(y) - score(x); return (desc ? 1 : -1) * (d > 0n ? 1 : d < 0n ? -1 : 0); };
      const pick = async (side: typeof rows) => {
        const code = await Promise.all(side.map((x) => isCode(x.a)));
        return side.filter((_, i) => !code[i]).slice(0, limit);
      };
      const [buyers, sellers] = await Promise.all([
        pick(rows.filter((x) => score(x) > 0n).sort(byScore(true)).slice(0, 30)),
        pick(rows.filter((x) => score(x) < 0n).sort(byScore(false)).slice(0, 30)),
      ]);
      const f = (n: bigint) => formatUnits(n, decimals);
      const fmt = (x: (typeof rows)[number]) => ({ address: getAddress(x.a), bought: f(x.v.dexIn), sold: f(x.v.dexOut), netViaDex: f(x.dex), netAll: f(x.all), transfers: x.v.n });
      return {
        chain: c.name, token: { address: getAddress(token), symbol, decimals }, fromBlock: Number(scan.fromBlock), toBlock: Number(latest),
        transfersRead: scan.logs.length, truncated: !scan.complete, dexContractsSeen: hubs.size,
        buyers: buyers.map(fmt), sellers: sellers.map(fmt),
        note: (hubs.size ? "Bought and sold count transfers from and to DEX pools, routers and other busy contracts; netAll includes plain wallet-to-wallet moves." : "No DEX contract seen in the window: ranked by plain net flow.") + " Contracts are left out of the lists." + (scan.complete ? "" : " A busy token filled the read early: fromBlock shows where it started."),
      };
    }),

  entry("/dex/trending", "Trending tokens, Base DEX",
    "Trending tokens on Base now: the tokens with the most DEX swaps in the last minutes (default 5, up to 10), counted live from Uniswap v2/v3, Aerodrome and Slipstream Swap events, with swaps, pools, share of swaps, symbol, name and busiest pool. Majors (WETH, USDC, cbBTC, stables) are left out unless asked; symbolClash marks copied symbols, so match by address. Use to spot what traders buy now; check token_report before trading.",
    ["trending-tokens", "trending", "dex", "base", "memecoins", "uniswap", "aerodrome"], {
      blocks: { type: "integer", description: "How many recent Base blocks to count, 30 to 300 (default 150, about 5 minutes; a block every 2 s)", example: 150 },
      limit: { type: "integer", description: "Most tokens to return, 1 to 25 (default 15)", example: 15 },
      majors: { type: "string", description: "include to keep WETH, USDC, cbBTC and stables in the list (default: left out)", enum: ["exclude", "include"], example: "exclude" },
    },
    { chain: "Base", fromBlock: 37002850, toBlock: 37002999, minutes: 5, swapsCounted: 9120, poolsSeen: 980, count: 1, tokens: [
      { rank: 1, address: "0x2222222222222222222222222222222222222222", symbol: "NEW", name: "New Token", swaps: 412, pools: 2, shareOfSwaps: 0.045, topPool: { address: "0x1111111111111111111111111111111111111111", swaps: 380 }, symbolClash: false },
    ], source: "Uniswap v2/v3, Aerodrome and Slipstream Swap events on Base, read live" },
    async (_env, q) => {
      const span = BigInt(num(q, "blocks", { min: 30, max: 300, fallback: 150, integer: true }));
      const limit = num(q, "limit", { min: 1, max: 25, fallback: 15, integer: true });
      const majors = (opt(q, "majors", 10) ?? "exclude").toLowerCase() === "include";
      const c = def("base");
      // One answer per minute for each choice: the same swaps for every caller, and Tenderly is the one node that answers.
      const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : undefined;
      const key = new Request(`https://dex-trending.internal/?b=${span}&l=${limit}&m=${majors ? 1 : 0}&t=${Math.floor(Date.now() / 60_000)}`);
      const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
      if (hit) return hit.json();
      const logs = topicLogsClient(c);
      const latest = (await rpc(() => logs.getBlockNumber())) - 3n;
      // 25-block slices, three at a time: one 150-block answer is about 6 MB, which the staging proof from Cloudflare could
      // not get back in time (5 Nov 2026), while 25 blocks is about 1 MB. A slice that fails is retried once.
      const SLICE = 25n;
      const from0 = latest - span + 1n;
      const slices: [bigint, bigint][] = [];
      for (let to = latest; to >= from0; to -= SLICE) slices.push([to - SLICE + 1n > from0 ? to - SLICE + 1n : from0, to]);
      const getSlice = ([a, b]: [bigint, bigint]) => rpc(() => logs.request({ method: "eth_getLogs", params: [{ topics: [SWAP_TOPICS], fromBlock: `0x${a.toString(16)}`, toBlock: `0x${b.toString(16)}` }] }) as Promise<{ address?: string }[]>);
      const chunks: { address?: string }[][] = [];
      for (let i = 0; i < slices.length; i += 3) chunks.push(...await Promise.all(slices.slice(i, i + 3).map((s) => getSlice(s).catch(() => getSlice(s)))).catch((e) => { throw e instanceof HttpError && e.status === 502 ? new HttpError(502, "Base's log nodes did not answer; try again (nothing was charged)") : e; }));
      const scan = { logs: chunks.flat(), fromBlock: from0 };
      const perPool = new Map<string, number>();
      for (const l of scan.logs as { address?: string }[]) if (l.address) perPool.set(l.address.toLowerCase(), (perPool.get(l.address.toLowerCase()) ?? 0) + 1);
      const total = scan.logs.length;
      if (!total) throw new HttpError(502, "no swaps came back for that range; try again (nothing was charged)");
      const cl = client(_env, c);
      const topPools = [...perPool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
      const pairs = await Promise.all(topPools.map(async ([pool, n]) => {
        const [t0, t1] = await Promise.all([
          (cl.readContract({ address: pool as `0x${string}`, abi: pairAbi, functionName: "token0" }) as Promise<string>).catch(() => null),
          (cl.readContract({ address: pool as `0x${string}`, abi: pairAbi, functionName: "token1" }) as Promise<string>).catch(() => null),
        ]);
        return { pool, n, tokens: [t0, t1].filter((t): t is string => !!t).map((t) => t.toLowerCase()) };
      }));
      const perToken = new Map<string, { swaps: number; pools: number; topPool: { address: string; swaps: number } }>();
      for (const p of pairs) for (const t of p.tokens) {
        if (!majors && BASE_MAJORS.has(t)) continue;
        const v = perToken.get(t) ?? { swaps: 0, pools: 0, topPool: { address: getAddress(p.pool), swaps: p.n } };
        v.swaps += p.n; v.pools++;
        if (p.n > v.topPool.swaps) v.topPool = { address: getAddress(p.pool), swaps: p.n };
        perToken.set(t, v);
      }
      const ranked = [...perToken.entries()].sort((a, b) => b[1].swaps - a[1].swaps).slice(0, limit);
      const meta = await Promise.all(ranked.map(async ([t]) => Promise.all([
        (cl.readContract({ address: t as `0x${string}`, abi: erc20Abi, functionName: "symbol" }) as Promise<string>).catch(() => null),
        (cl.readContract({ address: t as `0x${string}`, abi: erc20Abi, functionName: "name" }) as Promise<string>).catch(() => null),
      ])));
      const fromBlock = Number(scan.fromBlock);
      const out = {
        chain: "Base", fromBlock, toBlock: Number(latest), minutes: sig6(((Number(latest) - fromBlock + 1) * BLOCK_SECONDS.base) / 60),
        swapsCounted: total, poolsSeen: perPool.size, count: ranked.length,
        tokens: ranked.map(([t, v], i) => ({ rank: i + 1, address: getAddress(t), symbol: meta[i][0], name: meta[i][1], swaps: v.swaps, pools: v.pools, shareOfSwaps: sig6(v.swaps / total), topPool: v.topPool,
          // Copycat tokens reuse a famous symbol (two "AERO" in one list, 5 Nov 2026): flag every symbol that appears twice.
          symbolClash: meta.filter((m) => m[0] && m[0] === meta[i][0]).length > 1 })),
        source: "Uniswap v2/v3, Aerodrome and Slipstream Swap events on Base, read live",
      };
      if (cache) await cache.put(key, new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "max-age=60" } })).catch(() => undefined);
      return out;
    }),
];
