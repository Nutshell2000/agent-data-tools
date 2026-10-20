// Token prices computed from Uniswap v3 pool state, read directly from the chain.
// No price-data provider is involved, so there are no resale terms to clear
// (CoinGecko's free tiers forbid it, which is why /crypto/price is paused).
import { getAddress, type PublicClient } from "viem";
import { entry, pick, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { erc20Abi } from "../lib/rpc";
import { CHAINS, USDC, client, rpc } from "./chain-reads";
import { DEFAULT_TOKENS } from "./wallet";

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

interface Priced { pool: PoolQuote | null; quotedIn: string; priceUsd: number }

/**
 * USD pricing on one network from Uniswap v3 pools. ETH/USD comes from the deepest WETH/USDC pool
 * and is read once per pricer, so pricing many tokens costs one reference lookup.
 */
export function pricer(cl: PublicClient, slug: string) {
  const { factory, weth } = UNISWAP[slug];
  const usdc = USDC[slug];
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
  let ethPool: Promise<PoolQuote> | undefined;
  const eth = () => (ethPool ??= deepest(weth, 18, usdc, 6, 1).then((p) => {
    if (!p) throw new HttpError(502, "the WETH/USDC reference pool could not be read; try again");
    return p;
  }));
  return {
    ethUsd: async () => (await eth()).price,
    /** Best-supported USD price of a token, or null when no USDC or WETH pool exists. */
    async price(token: Address, decimals: number): Promise<Priced | null> {
      if (token === getAddress(usdc)) return { pool: null, quotedIn: "USDC", priceUsd: 1 };
      const ref = await eth();
      if (token === getAddress(weth)) return { pool: ref, quotedIn: "USDC", priceUsd: ref.price };
      const [viaUsdc, viaWeth] = await Promise.all([deepest(token, decimals, usdc, 6, 1), deepest(token, decimals, weth, 18, ref.price)]);
      return [viaUsdc && { pool: viaUsdc, quotedIn: "USDC", priceUsd: viaUsdc.price }, viaWeth && { pool: viaWeth, quotedIn: "WETH", priceUsd: viaWeth.price * ref.price }]
        .filter((x): x is Priced & { pool: PoolQuote } => Boolean(x))
        .sort((a, b) => b.pool.quoteReserveUsd - a.pool.quoteReserveUsd)[0] ?? null;
    },
  };
}

const METHOD = "Uniswap v3 spot price from the pool with the largest USDC or WETH reserve";

/**
 * Tickers agents ask for, per network; each address was checked against the contract's symbol() on 2026-10-20
 * (Arbitrum's USDT now reports "USD₮0", the same contract). ETH and BTC name the wrapped tokens the pools trade.
 */
const TICKERS: Record<string, Record<string, Address>> = {
  base: { WETH: "0x4200000000000000000000000000000000000006", USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", CBETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", USDBC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA" },
  eth: { WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7", DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F", WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA", UNI: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", AAVE: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9" },
  arb: { WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548", WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", LINK: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", GMX: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a" },
  op: { WETH: "0x4200000000000000000000000000000000000006", USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", OP: "0x4200000000000000000000000000000000000042", DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", WBTC: "0x68f180fcCe6836688e9084f035309E29Bf0A2095", LINK: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6" },
};
const ALIASES: Record<string, Record<string, string>> = { base: { ETH: "WETH", BTC: "CBBTC" }, eth: { ETH: "WETH", BTC: "WBTC" }, arb: { ETH: "WETH", BTC: "WBTC" }, op: { ETH: "WETH", BTC: "WBTC" } };

/** A 0x address as given, or the address of a known ticker on this network; 400 lists the tickers otherwise. */
export function tokenAddress(input: string, slug: string): Address {
  const v = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return getAddress(v);
  const key = v.toUpperCase();
  const hit = TICKERS[slug]?.[ALIASES[slug]?.[key] ?? key];
  if (hit) return getAddress(hit);
  const known = ["ETH", "BTC", ...Object.keys(TICKERS[slug] ?? {})].join(", ");
  throw new HttpError(400, `"${v.slice(0, 20)}" is not a 0x token address or a ticker known on this network (${known}); pass the token's 0x address`);
}
const poolOut = (p: PoolQuote | null) => p && { address: p.pool, feeTier: p.feeTier, quoteReserve: sig(p.quoteReserve), quoteReserveUsd: sig(p.quoteReserveUsd) };

export const PRICES: Entry[] = [
  entry("/price/token", "Token USD price from Uniswap v3 pools",
    "Crypto token USD price by ticker (ETH, BTC, USDC, AERO, ARB, OP, LINK…) or by any ERC-20 0x address on Base, Ethereum, Arbitrum or Optimism, from the deepest Uniswap v3 pool against USDC or WETH, read live from the chain. Returns the pool, its fee tier, the quote reserve and a thin-liquidity flag. Spot price, not a time average. No pool returns 404, uncharged. Use to value a token or check a quote before a swap or payment.",
    ["price", "token", "crypto", "market-data", "uniswap", "defi"], {
      symbol: { type: "string", description: "Ticker such as ETH, BTC, USDC, AERO, ARB, OP or LINK (instead of address; ETH and BTC mean the wrapped tokens)", example: "ETH" },
      address: { type: "string", description: "0x ERC-20 token contract address (instead of symbol)", example: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
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
      const raw = (q("address") ?? q("symbol"))?.trim();
      if (!raw) throw new HttpError(400, "symbol (e.g. ETH) or address (a 0x token address) is required");
      const slug = pick(q, "chain", SLUGS, "base");
      const token = tokenAddress(raw, slug);
      const c = CHAINS.find((x) => x.slug === slug)!;
      const cl = client(env, c);
      const head = { chain: c.name, chainId: c.chain.id };

      const code = await rpc(() => cl.getCode({ address: token }));
      if (!code || code === "0x") throw new HttpError(404, "no contract at this address on this network");
      const [decimals, symbol, block] = await rpc(() => Promise.all([
        cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).then(Number),
        cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
        cl.getBlockNumber().then(Number),
      ])).catch((e) => { throw e instanceof HttpError && e.status === 502 ? e : new HttpError(422, "this contract does not behave like an ERC-20 token"); });

      const tokenInfo = { address: token, symbol, decimals };
      if (token === getAddress(USDC[slug])) {
        return { ...head, token: tokenInfo, priceUsd: 1, quotedIn: "USDC", pool: null, thinLiquidity: false, block, method: "USDC is the quote asset; its price is taken as 1 USD" };
      }
      const p = pricer(cl, slug);
      const best = await p.price(token, decimals);
      if (!best) throw new HttpError(404, "no Uniswap v3 pool pairs this token with USDC or WETH on this network");
      return {
        ...head, token: tokenInfo, priceUsd: sig(best.priceUsd), quotedIn: best.quotedIn, pool: poolOut(best.pool),
        ethUsd: sig(await p.ethUsd()), thinLiquidity: (best.pool?.quoteReserveUsd ?? 0) < THIN_USD, block, method: METHOD,
      };
    }, "$0.003"),

  entry("/price/tokens", "USD prices for up to 20 tokens in one call",
    "USD prices for up to 20 crypto tokens in one call, by ticker (ETH, BTC, USDC, AERO…) or ERC-20 0x address, on Base, Ethereum, Arbitrum or Optimism, each from its deepest Uniswap v3 pool against USDC or WETH, read live from the chain, with pool, reserve and a thin-liquidity flag. Tokens without a pool are listed under unpriced instead of failing the call. Spot prices. Use to value a basket of tokens or refresh a watchlist in one paid call.",
    ["price", "token", "batch", "crypto", "market-data", "uniswap", "defi"], {
      symbols: { type: "string", description: "Comma-separated tickers such as ETH,BTC,AERO (with or instead of addresses; 1-20 tokens in all)", example: "ETH,BTC,AERO" },
      addresses: { type: "string", description: "Comma-separated 0x ERC-20 token addresses (with or instead of symbols; 1-20 tokens in all)", example: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf,0x4200000000000000000000000000000000000006" },
      chain: { type: "string", description: "Network: base (default), eth, arb or op", enum: SLUGS, example: "base" },
    },
    {
      chain: "Base", chainId: 8453, ethUsd: 3850.12, block: 37000000,
      prices: [{ address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", symbol: "cbBTC", decimals: 8, priceUsd: 104250.5, quotedIn: "USDC", pool: { address: "0x…", feeTier: 500, quoteReserve: 2500000.25, quoteReserveUsd: 2500000.25 }, thinLiquidity: false }],
      unpriced: [{ address: "0x…", reason: "no Uniswap v3 pool against USDC or WETH" }], method: METHOD,
    },
    async (env, q) => {
      const raw = [q("symbols"), q("addresses")].flatMap((list) => (list ?? "").split(",")).map((a) => a.trim()).filter(Boolean);
      if (raw.length === 0 || raw.length > 20) throw new HttpError(400, "symbols and addresses must name 1 to 20 tokens in all");
      const slug = pick(q, "chain", SLUGS, "base");
      const tokens = [...new Set(raw.map((a) => tokenAddress(a, slug)))];
      const c = CHAINS.find((x) => x.slug === slug)!;
      const cl = client(env, c);
      const p = pricer(cl, slug);
      const [ethUsd, block] = await Promise.all([p.ethUsd(), rpc(() => cl.getBlockNumber().then(Number))]);
      const results = await Promise.all(tokens.map(async (token) => {
        try {
          const [decimals, symbol] = await Promise.all([
            cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).then(Number),
            cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
          ]);
          const best = await p.price(token, decimals);
          if (!best) return { address: token, reason: "no Uniswap v3 pool against USDC or WETH" };
          return { address: token, symbol, decimals, priceUsd: sig(best.priceUsd), quotedIn: best.quotedIn, pool: poolOut(best.pool), thinLiquidity: (best.pool?.quoteReserveUsd ?? Infinity) < THIN_USD };
        } catch {
          return { address: token, reason: "not an ERC-20 token on this network, or the node did not answer" };
        }
      }));
      return {
        chain: c.name, chainId: c.chain.id, ethUsd: sig(ethUsd), block,
        prices: results.filter((r) => "priceUsd" in r), unpriced: results.filter((r) => "reason" in r), method: METHOD,
      };
    }, "$0.005"),

  entry("/wallet/portfolio", "Wallet holdings valued in USD",
    "USD value of a wallet on Base, Ethereum, Arbitrum or Optimism: native ETH plus major tokens (USDC and WETH everywhere, the common Base tokens on Base) and up to 20 tokens you add, each priced from its deepest Uniswap v3 pool, read live from the chain. Returns holdings, total and anything that could not be priced. Not a full token inventory. Use to check what a wallet is worth before trading, lending or paying.",
    ["wallet", "portfolio", "balance", "price", "crypto", "defi"], {
      address: { type: "string", description: "0x wallet address", required: true, example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
      chain: { type: "string", description: "Network: base (default), eth, arb or op", enum: SLUGS, example: "base" },
      tokens: { type: "string", description: "Optional extra comma-separated 0x token addresses (up to 20)", example: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" },
    },
    {
      chain: "Base", chainId: 8453, address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", totalUsd: 1234.56, ethUsd: 3850.12, block: 37000000,
      holdings: [{ token: "native", symbol: "ETH", balance: "0.25", priceUsd: 3850.12, valueUsd: 962.53, quotedIn: "USDC" }, { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", balance: "272.03", priceUsd: 1, valueUsd: 272.03, quotedIn: "USDC" }],
      unpriced: [], tokensChecked: 9, method: METHOD, note: "Only native ETH, the listed major tokens and any tokens you pass are checked.",
    },
    async (env, q) => {
      const raw = q("address")?.trim();
      if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new HttpError(400, "address must be a 0x wallet address (40 hex characters)");
      const owner = getAddress(raw);
      const extras = (q("tokens") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      if (extras.length > 20) throw new HttpError(400, "tokens accepts at most 20 addresses");
      if (!extras.every((a) => /^0x[0-9a-fA-F]{40}$/.test(a))) throw new HttpError(400, "tokens must be comma-separated 0x token addresses");
      const slug = pick(q, "chain", SLUGS, "base");
      const c = CHAINS.find((x) => x.slug === slug)!;
      const defaults: string[] = slug === "base" ? [...DEFAULT_TOKENS] : [USDC[slug], UNISWAP[slug].weth];
      const tokens = [...new Set([...defaults, ...extras].map((a) => getAddress(a)))];
      const cl = client(env, c);
      const p = pricer(cl, slug);
      const [native, block, ethUsd, balances] = await Promise.all([
        rpc(() => cl.getBalance({ address: owner })),
        rpc(() => cl.getBlockNumber().then(Number)),
        p.ethUsd(),
        Promise.all(tokens.map(async (token) => {
          try {
            const [bal, decimals, symbol] = await Promise.all([
              cl.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
              cl.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).then(Number),
              cl.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
            ]);
            return { token, bal, decimals, symbol };
          } catch {
            return null;
          }
        })),
      ]);
      const holdings: Record<string, unknown>[] = [];
      const unpriced: Record<string, unknown>[] = [];
      if (native > 0n) {
        const amount = Number(native) / 1e18;
        holdings.push({ token: "native", symbol: "ETH", balance: String(amount), priceUsd: sig(ethUsd), valueUsd: sig(amount * ethUsd), quotedIn: "USDC" });
      }
      await Promise.all(balances.map(async (b) => {
        if (!b || b.bal === 0n) return;
        const amount = Number(b.bal) / 10 ** b.decimals;
        const best = await p.price(b.token, b.decimals).catch(() => null);
        if (!best) unpriced.push({ token: b.token, symbol: b.symbol, balance: String(amount), reason: "no Uniswap v3 pool against USDC or WETH" });
        else holdings.push({ token: b.token, symbol: b.symbol, balance: String(amount), priceUsd: sig(best.priceUsd), valueUsd: sig(amount * best.priceUsd), quotedIn: best.quotedIn });
      }));
      holdings.sort((a, b) => (b.valueUsd as number) - (a.valueUsd as number));
      const total = holdings.reduce((n, h) => n + (h.valueUsd as number), 0);
      return {
        chain: c.name, chainId: c.chain.id, address: owner, totalUsd: total >= 1 ? Math.round(total * 100) / 100 : sig(total), ethUsd: sig(ethUsd), block,
        holdings, unpriced, tokensChecked: tokens.length + 1, method: METHOD,
        note: "Only native ETH, the listed major tokens and any tokens you pass are checked.",
      };
    }, "$0.005"),
];
