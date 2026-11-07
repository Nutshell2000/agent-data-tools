/**
 * Swap quotes, bridge quotes and bridge status through LI.FI's public API (li.quest, keyless; 65 chains, DEX aggregators and
 * bridges). Bazaar search on 6 Nov 2026: "swap quote" 20 results with 58 payers summed, "bridge quote" 11 with 38, "bridge
 * status" 11 with 34 (chainhilt's status endpoint alone 9 payers and 109 calls); 5-6 of the 47 open shoppers paid swap-quote and
 * bridge-status sellers in the 5 Nov sample. Quotes are read-only: nothing is signed or sent; with fromAddress the answer
 * includes LI.FI's unsigned transaction for the caller's own wallet to sign.
 */
import { entry, need, num, opt, type Entry, type Input } from "../family";
import { HttpError } from "../lib/env";
import { TICKERS } from "../lib/tickers";

const API = "https://li.quest/v1";
const SOURCE = "LI.FI (li.quest)";
const DEAD = "0x000000000000000000000000000000000000dEaD";
// Quote-only placeholder for Solana ends: the wrapped-SOL mint address, which LI.FI accepts as a syntactically valid account
// (6 Nov 2026; the system program address made its simulation revert). Never anyone's wallet.
const SOL_PLACEHOLDER = "So11111111111111111111111111111111111111112";
const SOLANA = "1151111081099710";
const placeholder = (chain: string) => (chain === SOLANA || chain === "sol" ? SOL_PLACEHOLDER : DEAD);

/** Chain names agents type, to LI.FI chain ids. Unknown values pass through (LI.FI also takes its own keys: bas, arb, sol). */
const CHAIN_IDS: Record<string, string> = {
  ethereum: "1", eth: "1", mainnet: "1", base: "8453", arbitrum: "42161", arb: "42161", optimism: "10", op: "10", polygon: "137", matic: "137", pol: "137",
  avalanche: "43114", avax: "43114", bsc: "56", bnb: "56", binance: "56", gnosis: "100", linea: "59144", scroll: "534352", zksync: "324", mantle: "5000",
  celo: "42220", sonic: "146", unichain: "130", blast: "81457", mode: "34443", berachain: "80094", bera: "80094", sei: "1329", ink: "57073",
  solana: "1151111081099710", sol: "1151111081099710", bitcoin: "20000000000001", btc: "20000000000001", sui: "9270000000000000",
};
export const chainId = (raw: string) => {
  const s = raw.trim().toLowerCase();
  return Object.hasOwn(CHAIN_IDS, s) ? CHAIN_IDS[s] : s;
};

/** Optional free LI.FI API key (Worker secret LIFI_API_KEY): lifts the keyless per-IP limit on quotes. Same value for every request. */
let lifiKey: string | undefined;

async function lifi<T>(path: string, params: Record<string, string>): Promise<{ status: number; body: T | null }> {
  let res: Response | undefined;
  // Keyless LI.FI limits per IP and Workers share egress IPs (1.99.0 production: a 429 on /bridge/quote), so a 429 is retried
  // once after the wait it asks for, up to 2 s.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0", ...(lifiKey ? { "x-lifi-api-key": lifiKey } : {}) }, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new HttpError(502, "LI.FI did not answer in time; try again");
    }
    if (res.status !== 429 || attempt === 1) break;
    const wait = Math.min(2_000, Math.max(500, Number(res.headers.get("retry-after")) * 1000 || 1_200));
    await res.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, wait));
  }
  if (!res) throw new HttpError(502, "LI.FI did not answer; try again");
  if (res.status === 429 || res.status >= 500) throw new HttpError(502, `LI.FI answered HTTP ${res.status}; try again`);
  return { status: res.status, body: (await res.json().catch(() => null)) as T | null };
}

interface Token { address: string; symbol: string; decimals: number; priceUSD?: string; name?: string; chainId: number }
// Token metadata barely changes: kept a day per chain and symbol, so a quote usually costs one LI.FI request, not three.
const tokens = new Map<string, { at: number; token: Token }>();
async function token(chain: string, raw: string): Promise<Token> {
  const key = `${chain}:${raw.trim().toLowerCase()}`;
  const hit = tokens.get(key);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.token;
  let lookup: { status: number; body: (Token & { message?: string }) | null };
  try {
    lookup = await lifi<Token & { message?: string }>("/token", { chain, token: raw.trim() });
  } catch (e) {
    // 7 Nov 2026: LI.FI's token lookup is rate-limited on Cloudflare's shared egress too (429), and it runs before the quote,
    // so the KyberSwap/Across fallbacks were never reached and the listed example (USDC -> ETH on Base) failed. Common
    // tokens resolve from our own checked table instead.
    const known = knownToken(chain, raw);
    if (known) return known;
    throw e;
  }
  const { status, body } = lookup;
  if (status !== 200 || !body?.address) throw new HttpError(400, `unknown token ${raw.slice(0, 50)} on chain ${chain}: give a symbol LI.FI lists or the token address`);
  if (tokens.size > 2_000) tokens.clear();
  tokens.set(key, { at: Date.now(), token: body });
  return body;
}

/** chain id -> the network key of TICKERS (src/lib/tickers.ts, addresses checked against symbol()). */
const TICKER_NETWORK: Record<string, string> = { "8453": "base", "1": "eth", "42161": "arb", "10": "op", "137": "polygon" };
/** Decimals of the tickers whose decimals are the same on every network we list. */
const KNOWN_DECIMALS: Record<string, number> = { USDC: 6, USDT: 6, WETH: 18, DAI: 18, WBTC: 8, CBBTC: 8 };
/** Chains whose native coin is ETH (LI.FI writes native coins as the zero address). */
const ETH_NATIVE = new Set(["8453", "1", "42161", "10"]);
/** A token from our own table when LI.FI cannot be asked: native ETH, or a ticker with known decimals. Null otherwise. */
export function knownToken(chain: string, raw: string): Token | null {
  const sym = raw.trim().toUpperCase();
  const network = Object.hasOwn(TICKER_NETWORK, chain) ? TICKER_NETWORK[chain] : null;
  if (!network) return null;
  if (sym === "ETH" && ETH_NATIVE.has(chain)) return { address: NATIVE, symbol: "ETH", decimals: 18, chainId: Number(chain) };
  const table = TICKERS[network] ?? {};
  const ticker = sym === "ETH" ? "WETH" : sym;
  if (!Object.hasOwn(table, ticker) || !Object.hasOwn(KNOWN_DECIMALS, ticker)) return null;
  return { address: table[ticker], symbol: ticker === "CBBTC" ? "cbBTC" : ticker, decimals: KNOWN_DECIMALS[ticker], chainId: Number(chain) };
}

/** "1.5" in a token with 6 decimals -> "1500000", exactly, without floating point. */
export function toUnits(amount: string, decimals: number): string {
  const s = amount.trim().replace(/[,_ ]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new HttpError(400, "amount must be a positive number of tokens, e.g. 100 or 0.5");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new HttpError(400, `amount has more than ${decimals} decimals`);
  const units = BigInt(whole + frac.padEnd(decimals, "0"));
  if (units <= 0n) throw new HttpError(400, "amount must be above 0");
  return units.toString();
}
export function fromUnits(units: string | undefined, decimals: number): string | null {
  if (!units || !/^\d+$/.test(units)) return null;
  const s = units.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

interface Quote {
  tool?: string; toolDetails?: { name?: string };
  action?: { fromChainId: number; toChainId: number; fromToken: Token; toToken: Token; slippage?: number };
  estimate?: { fromAmount: string; toAmount: string; toAmountMin: string; approvalAddress?: string; executionDuration?: number; fromAmountUSD?: string; toAmountUSD?: string; gasCosts?: { amountUSD?: string }[]; feeCosts?: { amountUSD?: string; name?: string; included?: boolean }[] };
  includedSteps?: { type: string; toolDetails?: { name?: string }; action?: { fromChainId: number; toChainId: number } }[];
  transactionRequest?: { to: string; data: string; value: string; gasLimit?: string; chainId: number };
  message?: string;
}

async function quote(q: Input, mode: "swap" | "bridge") {
  const fromChain = chainId(need(q, "fromChain", 40));
  const toChain = chainId(opt(q, "toChain", 40) ?? (mode === "swap" ? fromChain : ""));
  if (!toChain) throw new HttpError(400, "toChain is required for a bridge quote");
  if (mode === "bridge" && toChain === fromChain) throw new HttpError(400, "a bridge quote needs two different chains; use /swap/quote on one chain");
  const fromToken = await token(fromChain, need(q, "fromToken", 60));
  const toToken = await token(toChain, opt(q, "toToken", 60) ?? fromToken.symbol);
  const amount = toUnits(need(q, "amount", 60), fromToken.decimals);
  const fromAddress = opt(q, "fromAddress", 60);
  const toAddress = opt(q, "toAddress", 60);
  const wallet = /^0x[0-9a-fA-F]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (fromAddress && !wallet.test(fromAddress)) throw new HttpError(400, "fromAddress must be the wallet that would send (0x… or a Solana address)");
  if (toAddress && !wallet.test(toAddress)) throw new HttpError(400, "toAddress must be the receiving wallet (0x… or a Solana address)");
  const slippage = num(q, "slippage", { min: 0.01, max: 50, fallback: 0.5 }) / 100;
  let answer: { status: number; body: Quote | null };
  try {
    answer = await lifi<Quote>("/quote", {
      fromChain, toChain, fromToken: fromToken.address, toToken: toToken.address, fromAmount: amount,
      fromAddress: fromAddress ?? placeholder(fromChain), slippage: String(slippage),
      // A different destination family (EVM to Solana and back) needs a receiver of that family.
      ...(toAddress ? { toAddress } : placeholder(toChain) !== placeholder(fromChain) ? { toAddress: placeholder(toChain) } : {}),
    });
  } catch (e) {
    // Keyless LI.FI quotes are rate-limited on Cloudflare's shared egress (1.100.0 production, 6 Nov 2026): answer from a
    // keyless aggregator instead when one covers the request.
    if (!(e instanceof HttpError) || !/429/.test(e.message)) throw e;
    // 7 Nov 2026: KyberSwap answered from the PC with a forced LI.FI 429 but not from Cloudflare (staging, paid example), so
    // ParaSwap's keyless prices API (200 from Cloudflare the same day) is tried after it.
    const alt = mode === "swap"
      ? (await kyberQuote(fromChain, fromToken, toToken, amount, slippage)) ?? (await paraswapQuote(fromChain, fromToken, toToken, amount, slippage))
      : await acrossQuote(fromChain, toChain, fromToken, toToken, amount);
    if (alt) return alt;
    throw e;
  }
  const { status, body } = answer;
  if (status !== 200 || !body?.estimate) throw new HttpError(404, `no route for this ${mode}: ${String(body?.message ?? "LI.FI found none").slice(0, 160)}; nothing was charged`);
  const e = body.estimate;
  const usd = (xs?: { amountUSD?: string }[]) => Math.round((xs ?? []).reduce((s, x) => s + Number(x.amountUSD ?? 0), 0) * 100) / 100;
  const fromUsd = Number(e.fromAmountUSD ?? NaN), toUsd = Number(e.toAmountUSD ?? NaN);
  return {
    route: body.toolDetails?.name ?? body.tool ?? null,
    steps: (body.includedSteps ?? []).filter((s) => s.type !== "protocol").map((s) => ({ type: s.type, via: s.toolDetails?.name ?? null, fromChainId: s.action?.fromChainId ?? null, toChainId: s.action?.toChainId ?? null })),
    from: { chainId: Number(fromChain) || fromChain, token: fromToken.symbol, address: fromToken.address, amount: fromUnits(e.fromAmount, fromToken.decimals), amountUsd: Number.isFinite(fromUsd) ? fromUsd : null },
    to: { chainId: Number(toChain) || toChain, token: toToken.symbol, address: toToken.address, amount: fromUnits(e.toAmount, toToken.decimals), amountMin: fromUnits(e.toAmountMin, toToken.decimals), amountUsd: Number.isFinite(toUsd) ? toUsd : null },
    rate: Number(fromUnits(e.toAmount, toToken.decimals)) / Number(fromUnits(e.fromAmount, fromToken.decimals)),
    costs: { gasUsd: usd(e.gasCosts), feesUsd: usd(e.feeCosts), totalLossPercent: Number.isFinite(fromUsd) && Number.isFinite(toUsd) && fromUsd > 0 ? Math.round(((fromUsd - toUsd) / fromUsd) * 10_000) / 100 : null },
    slippagePercent: slippage * 100, estimatedSeconds: e.executionDuration ?? null, approvalAddress: e.approvalAddress ?? null,
    ...(fromAddress && body.transactionRequest ? { unsignedTransaction: body.transactionRequest } : {}),
    note: "A quote, not an order: prices move, and nothing was signed or sent. With fromAddress, unsignedTransaction is LI.FI's transaction for that wallet to check and sign itself.",
    source: SOURCE,
  };
}

// ---------- keyless fallbacks ----------
const NATIVE = "0x0000000000000000000000000000000000000000";
const KYBER_CHAINS: Record<string, string> = { "1": "ethereum", "56": "bsc", "42161": "arbitrum", "137": "polygon", "10": "optimism", "43114": "avalanche", "8453": "base", "59144": "linea", "534352": "scroll", "324": "zksync", "5000": "mantle", "146": "sonic", "80094": "berachain", "130": "unichain" };
const KYBER_ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const NOTE_FALLBACK = "A quote, not an order: prices move, and nothing was signed or sent. Answered by a keyless fallback; no unsigned transaction is included.";
const usdN = (s?: string) => { const n = Number(s); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

/** KyberSwap's keyless aggregator (aggregator-api.kyberswap.com), for single-chain swaps on the chains it serves. */
export async function kyberQuote(chain: string, from: Token, to: Token, amount: string, slippage: number, fetcher: typeof fetch = fetch) {
  const slug = KYBER_CHAINS[chain];
  if (!slug) return null;
  const evm = (a: string) => (a.toLowerCase() === NATIVE ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : a);
  let body: { data?: { routeSummary?: { amountIn: string; amountOut: string; amountInUsd?: string; amountOutUsd?: string; gasUsd?: string; route?: { exchange?: string }[][] } } } | null = null;
  try {
    const res = await fetcher(`https://aggregator-api.kyberswap.com/${slug}/api/v1/routes?${new URLSearchParams({ tokenIn: evm(from.address), tokenOut: evm(to.address), amountIn: amount })}`, { headers: { accept: "application/json", "x-client-id": "agentdatatools" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) { console.warn(`kyberswap ${slug}: HTTP ${res.status}`); return null; }
    body = await res.json();
  } catch (e) {
    console.warn(`kyberswap ${slug}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  const r = body?.data?.routeSummary;
  if (!r?.amountOut) return null;
  const minOut = ((BigInt(r.amountOut) * BigInt(Math.round((1 - slippage) * 1_000_000))) / 1_000_000n).toString();
  const fromUsd = usdN(r.amountInUsd), toUsd = usdN(r.amountOutUsd);
  const dexes = [...new Set((r.route ?? []).flat().map((h) => h.exchange).filter(Boolean))];
  return {
    route: `KyberSwap${dexes.length ? ` (${dexes.slice(0, 4).join(", ")})` : ""}`, steps: [{ type: "swap", via: "KyberSwap", fromChainId: Number(chain), toChainId: Number(chain) }],
    from: { chainId: Number(chain), token: from.symbol, address: from.address, amount: fromUnits(r.amountIn, from.decimals), amountUsd: fromUsd },
    to: { chainId: Number(chain), token: to.symbol, address: to.address, amount: fromUnits(r.amountOut, to.decimals), amountMin: fromUnits(minOut, to.decimals), amountUsd: toUsd },
    rate: Number(fromUnits(r.amountOut, to.decimals)) / Number(fromUnits(r.amountIn, from.decimals)),
    costs: { gasUsd: usdN(r.gasUsd), feesUsd: null, totalLossPercent: fromUsd && toUsd !== null ? Math.round(((fromUsd - toUsd) / fromUsd) * 10_000) / 100 : null },
    slippagePercent: slippage * 100, estimatedSeconds: null, approvalAddress: KYBER_ROUTER, note: NOTE_FALLBACK, source: "KyberSwap aggregator (keyless fallback)",
  };
}

/** ParaSwap's keyless prices API (api.paraswap.io/prices), the second single-chain swap fallback after KyberSwap. */
const PARASWAP_CHAINS = new Set(["1", "10", "56", "137", "8453", "42161", "43114", "100", "1101"]);
export async function paraswapQuote(chain: string, from: Token, to: Token, amount: string, slippage: number, fetcher: typeof fetch = fetch) {
  if (!PARASWAP_CHAINS.has(chain)) return null;
  const evm = (a: string) => (a.toLowerCase() === NATIVE ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : a);
  type Swap = { swapExchanges?: { exchange?: string }[] };
  let body: { priceRoute?: { srcAmount: string; destAmount: string; srcUSD?: string; destUSD?: string; gasCostUSD?: string; tokenTransferProxy?: string; bestRoute?: { swaps?: Swap[] }[] } } | null = null;
  try {
    const params = new URLSearchParams({ srcToken: evm(from.address), destToken: evm(to.address), amount, srcDecimals: String(from.decimals), destDecimals: String(to.decimals), side: "SELL", network: chain });
    const res = await fetcher(`https://api.paraswap.io/prices?${params}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) { console.warn(`paraswap ${chain}: HTTP ${res.status}`); return null; }
    body = await res.json();
  } catch (e) {
    console.warn(`paraswap ${chain}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  const p = body?.priceRoute;
  if (!p?.destAmount) return null;
  const minOut = ((BigInt(p.destAmount) * BigInt(Math.round((1 - slippage) * 1_000_000))) / 1_000_000n).toString();
  const fromUsd = usdN(p.srcUSD), toUsd = usdN(p.destUSD);
  const dexes = [...new Set((p.bestRoute ?? []).flatMap((r) => r.swaps ?? []).flatMap((s) => s.swapExchanges ?? []).map((x) => x.exchange).filter(Boolean))];
  return {
    route: `ParaSwap${dexes.length ? ` (${dexes.slice(0, 4).join(", ")})` : ""}`, steps: [{ type: "swap", via: "ParaSwap", fromChainId: Number(chain), toChainId: Number(chain) }],
    from: { chainId: Number(chain), token: from.symbol, address: from.address, amount: fromUnits(p.srcAmount, from.decimals), amountUsd: fromUsd },
    to: { chainId: Number(chain), token: to.symbol, address: to.address, amount: fromUnits(p.destAmount, to.decimals), amountMin: fromUnits(minOut, to.decimals), amountUsd: toUsd },
    rate: Number(fromUnits(p.destAmount, to.decimals)) / Number(fromUnits(p.srcAmount, from.decimals)),
    costs: { gasUsd: usdN(p.gasCostUSD), feesUsd: null, totalLossPercent: fromUsd && toUsd !== null ? Math.round(((fromUsd - toUsd) / fromUsd) * 10_000) / 100 : null },
    slippagePercent: slippage * 100, estimatedSeconds: null, approvalAddress: p.tokenTransferProxy ?? null, note: NOTE_FALLBACK, source: "ParaSwap prices API (keyless fallback)",
  };
}

/** Across's keyless suggested-fees API, for moving the same token between EVM chains it supports. */
export async function acrossQuote(fromChain: string, toChain: string, from: Token, to: Token, amount: string, fetcher: typeof fetch = fetch) {
  if (!/^\d+$/.test(fromChain) || !/^\d+$/.test(toChain) || fromChain.length > 8 || toChain.length > 8) return null;
  if (from.symbol.replace(/^W/, "").toUpperCase() !== to.symbol.replace(/^W/, "").toUpperCase()) return null;
  let b: { outputAmount?: string; totalRelayFee?: { total?: string }; lpFee?: { total?: string }; estimatedFillTimeSec?: number; isAmountTooLow?: boolean; spokePoolAddress?: string; limits?: { minDeposit?: string; maxDeposit?: string } } | null = null;
  try {
    const res = await fetcher(`https://app.across.to/api/suggested-fees?${new URLSearchParams({ inputToken: from.address === NATIVE ? "" : from.address, outputToken: to.address === NATIVE ? "" : to.address, originChainId: fromChain, destinationChainId: toChain, amount })}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    b = await res.json();
  } catch {
    return null;
  }
  if (!b?.outputAmount) return null;
  if (b.isAmountTooLow) throw new HttpError(422, `amount is below the bridge minimum of ${fromUnits(b.limits?.minDeposit, from.decimals)} ${from.symbol}; nothing was charged`);
  const fee = (BigInt(b.totalRelayFee?.total ?? "0") + BigInt(b.lpFee?.total ?? "0")).toString();
  const price = Number(from.priceUSD ?? NaN);
  const inN = Number(fromUnits(amount, from.decimals)), outN = Number(fromUnits(b.outputAmount, to.decimals)), feeN = Number(fromUnits(fee, from.decimals));
  return {
    route: "Across", steps: [{ type: "cross", via: "Across", fromChainId: Number(fromChain), toChainId: Number(toChain) }],
    from: { chainId: Number(fromChain), token: from.symbol, address: from.address, amount: fromUnits(amount, from.decimals), amountUsd: Number.isFinite(price) ? Math.round(inN * price * 100) / 100 : null },
    to: { chainId: Number(toChain), token: to.symbol, address: to.address, amount: fromUnits(b.outputAmount, to.decimals), amountMin: fromUnits(b.outputAmount, to.decimals), amountUsd: Number.isFinite(price) ? Math.round(outN * price * 100) / 100 : null },
    rate: outN / inN,
    costs: { gasUsd: null, feesUsd: Number.isFinite(price) ? Math.round(feeN * price * 100) / 100 : null, totalLossPercent: Math.round(((inN - outN) / inN) * 10_000) / 100 },
    slippagePercent: 0, estimatedSeconds: b.estimatedFillTimeSec ?? null, approvalAddress: b.spokePoolAddress ?? null, note: NOTE_FALLBACK, source: "Across (keyless fallback)",
  };
}

const QUOTE_PARAMS = {
  fromToken: { type: "string" as const, description: "Token to sell: symbol (USDC, ETH) or address", required: true, example: "USDC" },
  amount: { type: "string" as const, description: "Amount of fromToken in token units, e.g. 100 or 0.5", required: true, example: "1000" },
  fromAddress: { type: "string" as const, description: "Optional wallet that would send: adds the unsigned transaction to the answer", example: "0x000000000000000000000000000000000000dEaD" },
  toAddress: { type: "string" as const, description: "Optional receiving wallet, e.g. a Solana address when bridging to Solana", example: "0x000000000000000000000000000000000000dEaD" },
  slippage: { type: "number" as const, description: "Slippage tolerance in percent (default 0.5)", example: 0.5 },
};

export const LIFI: Entry[] = [
  entry("/swap/quote", "Swap quote, best DEX route",
    "Best price to swap one token for another on 30+ chains (Base, Ethereum, Arbitrum, Solana, BSC…) across DEX aggregators, via LI.FI: amount out, minimum after slippage, USD values, gas and fees, total cost in percent, route and approval address; with fromAddress, the unsigned transaction for your wallet to sign. Tokens by symbol or address, amounts in token units. A quote only: nothing is signed or sent. Use before a trading agent swaps.",
    ["swap-quote", "dex-aggregator", "best-route", "token-swap", "trading", "lifi"], {
      fromChain: { type: "string", description: "Chain name or id: base, ethereum, arbitrum, solana…", required: true, example: "base" },
      ...QUOTE_PARAMS, toToken: { type: "string", description: "Token to buy: symbol or address", required: true, example: "ETH" },
    },
    {
      route: "Fly", steps: [{ type: "swap", via: "Fly", fromChainId: 8453, toChainId: 8453 }],
      from: { chainId: 8453, token: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "1000", amountUsd: 999.9 },
      to: { chainId: 8453, token: "ETH", address: "0x0000000000000000000000000000000000000000", amount: "0.448115540014", amountMin: "0.445874290140619979", amountUsd: 1000.92 },
      rate: 0.000448115540014, costs: { gasUsd: 0.02, feesUsd: 2.5, totalLossPercent: 0.25 }, slippagePercent: 0.5, estimatedSeconds: 0, approvalAddress: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
      note: "A quote, not an order…", source: SOURCE,
    },
    (env, q) => { lifiKey = env.LIFI_API_KEY; return quote(q, "swap"); }),

  entry("/bridge/quote", "Bridge quote, cross-chain transfer",
    "Cheapest route to move tokens between chains (Ethereum to Base, Arbitrum to Solana…) across 20+ bridges via LI.FI: amount received, minimum, USD values, gas, bridge fees, total cost in percent, estimated time, steps and approval address; with fromAddress, the unsigned transaction to sign. Swaps on either side are included when the tokens differ. A quote only: nothing is signed or sent. Use before an agent moves funds across chains.",
    ["bridge-quote", "cross-chain", "bridge", "cross-chain-transfer", "lifi"], {
      fromChain: { type: "string", description: "Source chain name or id", required: true, example: "ethereum" },
      toChain: { type: "string", description: "Destination chain name or id", required: true, example: "base" },
      ...QUOTE_PARAMS, toToken: { type: "string", description: "Token to receive (default: the same token)", example: "USDC" },
    },
    {
      route: "Polymer (Standard)", steps: [{ type: "cross", via: "Polymer (Standard)", fromChainId: 1, toChainId: 8453 }],
      from: { chainId: 1, token: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", amount: "1000", amountUsd: 999.9 },
      to: { chainId: 8453, token: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "999.2", amountMin: "994.2", amountUsd: 999.1 },
      rate: 0.9992, costs: { gasUsd: 1.1, feesUsd: 0.8, totalLossPercent: 0.08 }, slippagePercent: 0.5, estimatedSeconds: 60, approvalAddress: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
      note: "A quote, not an order…", source: SOURCE,
    },
    (env, q) => { lifiKey = env.LIFI_API_KEY; return quote(q, "bridge"); }),

  entry("/bridge/status", "Bridge status, cross-chain transfer tracker",
    "Status of a cross-chain transfer by its source transaction hash, for transfers made through LI.FI and the bridges it routes (Stargate, Across, CCTP, Hop, Polymer and more): DONE, PENDING, FAILED or NOT_FOUND, the sub-status and its message, sending and receiving transaction hashes, chains, tokens, amounts and explorer links. Use to check whether funds arrived before an agent continues.",
    ["bridge-status", "cross-chain", "bridge-tracker", "transaction-status", "lifi"], {
      txHash: { type: "string", description: "Hash of the transaction on the source chain", required: true, example: "0x8f9e2c2a7a6e0f5b1c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123" },
      fromChain: { type: "string", description: "Optional source chain name or id, to speed up the lookup", example: "ethereum" },
    },
    { txHash: "0x8f9e…0123", status: "NOT_FOUND", substatus: null, message: "Transaction hash is not found in any chain.", bridge: null, sending: null, receiving: null, explorer: null, source: SOURCE },
    async (_env, q) => {
      const txHash = need(q, "txHash", 100).trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash) && !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(txHash)) throw new HttpError(400, "txHash must be a transaction hash (0x + 64 hex, or a Solana signature)");
      const fromChain = opt(q, "fromChain", 40);
      const { status, body } = await lifi<{ status?: string; substatus?: string; substatusMessage?: string; tool?: string; lifiExplorerLink?: string; message?: string; code?: number; sending?: Record<string, unknown>; receiving?: Record<string, unknown> }>("/status", { txHash, ...(fromChain ? { fromChain: chainId(fromChain) } : {}) });
      const side = (s?: Record<string, unknown>) => {
        if (!s) return null;
        const tok = s.token as Token | undefined;
        return { chainId: s.chainId ?? null, txHash: s.txHash ?? null, txLink: s.txLink ?? null, token: tok?.symbol ?? null, amount: tok && typeof s.amount === "string" ? fromUnits(s.amount, tok.decimals) : null, amountUsd: s.amountUSD ? Number(s.amountUSD) : null, timestamp: typeof s.timestamp === "number" ? new Date(s.timestamp * 1000).toISOString() : null };
      };
      if (status === 404 || body?.code === 1003) return { txHash, status: "NOT_FOUND", substatus: null, message: body?.message ?? "not found", bridge: null, sending: null, receiving: null, explorer: null, source: SOURCE };
      if (status !== 200 || !body) throw new HttpError(502, `LI.FI answered HTTP ${status}; try again`);
      return { txHash, status: body.status ?? null, substatus: body.substatus ?? null, message: body.substatusMessage ?? null, bridge: body.tool ?? null, sending: side(body.sending), receiving: side(body.receiving), explorer: body.lifiExplorerLink ?? null, source: SOURCE };
    }),
];
