// More chain data (1.78.0, 25 Oct 2026), read from the networks themselves or from Sourcify's open verification repository.
// Bazaar searches that day with nothing of ours: "stablecoin supply" (36 payers summed over the top 20), "contract abi" (34),
// "uniswap pool" (30), "token supply" (26), "abi" (26) and "verified contract" (25); each #1 had 2 to 6 payers.
import { formatUnits, getAddress, type PublicClient } from "viem";
import { entry, need, opt, type Entry } from "../family";
import { HttpError, type Env } from "../lib/env";
import { erc20Abi } from "../lib/rpc";
import { tokenAddress } from "../lib/tickers";
import { CHAINS, client, rpc } from "./chain-reads";
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
    "The verified ABI of a smart contract on Ethereum, Base, Arbitrum, Optimism or Polygon from Sourcify's open verification repository: contract name, compiler, match quality, every function and event signature, the full ABI, and for proxies the implementation contract with its ABI. Optional source=true adds the main source file (up to 20,000 characters). Unverified contracts are an uncharged 404. Use before calling or decoding a contract.",
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
      const a = tokenInput(need(q, "tokenA", 60), slug), b = tokenInput(need(q, "tokenB", 60), slug);
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
];
