// Token prices computed from Uniswap v3 pool state, read directly from the chain.
// No price-data provider is involved, so there are no resale terms to clear
// (CoinGecko's free tiers forbid it, which is why /crypto/price is paused).
import { getAddress } from "viem";
import { entry, pick, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { erc20Abi } from "../lib/rpc";
import { CHAINS, USDC, client, rpc } from "./chain-reads";

type Address = `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000";
const FEES = [100, 500, 3000, 10000] as const;
/** Pools holding less than this in USDC or WETH value are flagged as thin. */
const THIN_USD = 10_000;

// Uniswap v3 factory and wrapped ether per network (Uniswap's deployment table).
const UNISWAP: Record<string, { factory: Address; weth: Address }> = {
  base: { factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", weth: "0x4200000000000000000000000000000000000006" },
  eth: { factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984", weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
  arb: { factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984", weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" },
  op: { factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984", weth: "0x4200000000000000000000000000000000000006" },
};
const SLUGS = Object.keys(UNISWAP) as [string, ...string[]];

const factoryAbi = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] },
] as const;
const poolAbi = [
  {
    type: "function", name: "slot0", stateMutability: "view", inputs: [],
    outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" }],
  },
] as const;

interface PoolQuote {
  pool: Address;
  feeTier: number;
  price: number;
  quoteReserve: number;
  quoteReserveUsd: number;
}

/** Quote-token units per token from a pool's sqrtPriceX96, adjusted for both tokens' decimals. */
export function priceFromSqrt(sqrtPriceX96: bigint, tokenIsToken0: boolean, tokenDecimals: number, quoteDecimals: number): number {
  const s = Number(sqrtPriceX96) / 2 ** 96;
  const raw1Per0 = s * s;
  const rawQuotePerToken = tokenIsToken0 ? raw1Per0 : 1 / raw1Per0;
  return rawQuotePerToken * 10 ** (tokenDecimals - quoteDecimals);
}

const sig = (n: number) => Number(n.toPrecision(6));

export const PRICES: Entry[] = [
  entry("/price/token", "Token USD price from Uniswap v3 pools",
    "USD price of any ERC-20 token on Base, Ethereum, Arbitrum or Optimism, computed from the deepest Uniswap v3 pool against USDC or WETH, read live from the chain. Returns the pool, its fee tier, the quote-token reserve and a thin-liquidity flag. Spot price, not a time average. No pool returns 404, uncharged. Use to value a token or check a quote before a swap or payment.",
    ["price", "token", "crypto", "market-data", "uniswap", "defi"], {
      address: { type: "string", description: "0x ERC-20 token contract address", required: true, example: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
      chain: { type: "string", description: "Network: base (default), eth, arb or op", enum: SLUGS, example: "base" },
    },
    {
      chain: "Base", chainId: 8453,
      token: { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC", decimals: 8 },
      priceUsd: 104250.5, quotedIn: "USDC",
      pool: { address: "0x…", feeTier: 500, quoteReserve: 2500000.25, quoteReserveUsd: 2500000.25 },
      ethUsd: 3850.12, thinLiquidity: false, block: 37000000,
      method: "Uniswap v3 spot price from the pool with the largest USDC or WETH reserve",
    },
    async (env, q) => {
      const raw = q("address")?.trim();
      if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new HttpError(400, "address must be a 0x token address (40 hex characters)");
      const token = getAddress(raw);
      const slug = pick(q, "chain", SLUGS, "base");
      const c = CHAINS.find((x) => x.slug === slug)!;
      const { factory, weth } = UNISWAP[slug];
      const usdc = USDC[slug];
      const cl = client(env, c);
      const head = { chain: c.name, chainId: c.chain.id };

      const code = await rpc(() => cl.getCode({ address: token }));
      if (!code || code === "0x") throw new HttpError(404, "no contract at this address on this network");
      const [decimals, symbol, block] = await rpc(() => Promise.all([
        cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).then(Number),
        cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
        cl.getBlockNumber().then(Number),
      ])).catch((e) => { throw e instanceof HttpError && e.status === 502 ? e : new HttpError(422, "this contract does not behave like an ERC-20 token"); });

      const deepest = async (base: Address, baseDecimals: number, quote: Address, quoteDecimals: number, quoteUsd: number): Promise<PoolQuote | null> => {
        const pools = await rpc(() => Promise.all(FEES.map((fee) => cl.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [base, quote, fee] }))));
        const quotes = await rpc(() => Promise.all(pools.map(async (pool, i): Promise<PoolQuote | null> => {
          if (pool === ZERO) return null;
          const [slot0, reserve] = await Promise.all([
            cl.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
            cl.readContract({ address: quote, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
          ]);
          if (slot0[0] === 0n) return null;
          const quoteReserve = Number(reserve) / 10 ** quoteDecimals;
          const price = priceFromSqrt(slot0[0], base.toLowerCase() < quote.toLowerCase(), baseDecimals, quoteDecimals);
          return { pool, feeTier: FEES[i], price, quoteReserve, quoteReserveUsd: quoteReserve * quoteUsd };
        })));
        return quotes.filter((x): x is PoolQuote => x !== null).sort((a, b) => b.quoteReserveUsd - a.quoteReserveUsd)[0] ?? null;
      };

      const tokenInfo = { address: token, symbol, decimals };
      if (token === getAddress(usdc)) {
        return { ...head, token: tokenInfo, priceUsd: 1, quotedIn: "USDC", pool: null, thinLiquidity: false, block, method: "USDC is the quote asset; its price is taken as 1 USD" };
      }
      const ethPool = await deepest(weth, 18, usdc, 6, 1);
      if (!ethPool) throw new HttpError(502, "the WETH/USDC reference pool could not be read; try again");
      const ethUsd = ethPool.price;
      const done = (q: PoolQuote, quotedIn: string, priceUsd: number) => ({
        ...head, token: tokenInfo, priceUsd: sig(priceUsd), quotedIn,
        pool: { address: q.pool, feeTier: q.feeTier, quoteReserve: sig(q.quoteReserve), quoteReserveUsd: sig(q.quoteReserveUsd) },
        ethUsd: sig(ethUsd), thinLiquidity: q.quoteReserveUsd < THIN_USD, block,
        method: "Uniswap v3 spot price from the pool with the largest USDC or WETH reserve",
      });
      if (token === getAddress(weth)) return done(ethPool, "USDC", ethUsd);

      const [viaUsdc, viaWeth] = await Promise.all([deepest(token, decimals, usdc, 6, 1), deepest(token, decimals, weth, 18, ethUsd)]);
      const best = [viaUsdc && { q: viaUsdc, quotedIn: "USDC", usd: viaUsdc.price }, viaWeth && { q: viaWeth, quotedIn: "WETH", usd: viaWeth.price * ethUsd }]
        .filter((x): x is { q: PoolQuote; quotedIn: string; usd: number } => Boolean(x))
        .sort((a, b) => b.q.quoteReserveUsd - a.q.quoteReserveUsd)[0];
      if (!best) throw new HttpError(404, "no Uniswap v3 pool pairs this token with USDC or WETH on this network");
      return done(best.q, best.quotedIn, best.usd);
    }, "$0.002"),
];
