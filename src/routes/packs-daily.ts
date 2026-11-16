// Daily market brief (pack, 16 Nov 2026). Measured 16 Nov: the daily buyer 0x0fcb…a8 (a scheduled agent that pays 25 sellers
// between 07:00 and 08:10 UTC) buys a token price, a stock history, keyword research, a USDC yield and prediction-market odds
// from separate sellers at $0.01-0.10 each. One call here runs our own tools for the same jobs and returns one report. Every
// section runs the same code as the single tool; a section that fails is reported in `failed` and the rest still answer.
import { entry, num, opt, type Entry, type Input } from "../family";
import { type Env } from "../lib/env";
import { call, runSections } from "./packs";
import { DEFI_YIELDS } from "./defi-yields";
import { POLYMARKET } from "./polymarket";
import { stockQuote } from "./stocks";

const EXTRA = new Map<string, Entry>([...DEFI_YIELDS, ...POLYMARKET].map((e) => [e.endpoint.path, e]));
/** Runs one of the tools outside packs.ts's own list in-process, with the given inputs. */
const callExtra = (env: Env, path: string, inputs: Record<string, string | number | undefined>) => {
  const e = EXTRA.get(path);
  if (!e) throw new Error(`daily brief references unknown tool ${path}`);
  const q: Input = (n) => (inputs[n] === undefined ? undefined : String(inputs[n]));
  return Promise.resolve().then(() => e.run(env, q));
};
const some = <T extends Record<string, unknown>>(o: unknown, keys: (keyof T)[]) =>
  o && typeof o === "object" ? Object.fromEntries(keys.filter((k) => k in (o as T)).map((k) => [k, (o as T)[k]])) : null;
const list = (v: string | undefined, fallback: string, max: number) =>
  (v ?? fallback).split(",").map((s) => s.trim()).filter(Boolean).slice(0, max);

export const PACKS_DAILY: Entry[] = [
  entry("/pack/daily-brief", "Daily market brief: crypto prices, stocks, USDC yield, gas and prediction markets",
    "A morning brief in one call for a scheduled agent or a dashboard: USD prices for up to 5 crypto tokens, quotes for up to 4 stock tickers or indexes, the Crypto Fear & Greed index, the best USDC yields, Ethereum and Arbitrum gas, the top Polymarket markets by 24-hour volume and the UTC time. Cheaper than the six tools bought one by one. Use for a daily market brief, a trading or treasury agent's context, or a morning report.",
    ["daily-brief", "market-brief", "morning-brief", "crypto-prices", "stock-quotes", "usdc-yield", "gas", "pack"], {
      tokens: { type: "string", description: "Up to 5 crypto tickers, comma separated (default BTC,ETH,SOL)", example: "BTC,ETH,SOL" },
      stocks: { type: "string", description: "Up to 4 stock tickers or indexes, comma separated (default AAPL,MSFT,NVDA,^GSPC)", example: "AAPL,MSFT,NVDA" },
      markets: { type: "integer", description: "Prediction markets to include, 1-5 (default 3)", example: 3 },
    },
    {
      pack: "daily-brief", asOf: "2026-11-16T07:30:00.000Z",
      crypto: [{ symbol: "BTC", priceUsd: 95120.4, chain: "Base", thinLiquidity: false }],
      stocks: [{ symbol: "AAPL", name: "Apple Inc.", price: 270.37, change: 1.87, changePercent: 0.6965, currency: "USD" }],
      sentiment: { value: 51, classification: "Neutral", change7d: -4, attribution: "Crypto Fear & Greed Index by alternative.me" },
      usdcYield: [{ chain: "Base", project: "morpho-blue", symbol: "USDC", apy: 7.42, tvlUsd: 48211230 }],
      gas: { ethereum: { gasPriceGwei: "0.4" }, arbitrum: { gasPriceGwei: "0.02" } },
      predictionMarkets: [{ question: "Will bitcoin be above $100,000 on December 31?", outcomes: [{ name: "Yes", price: 0.42 }], volume24h: 1250000 }],
      failed: {},
    },
    async (env, q) => {
      const tokens = list(opt(q, "tokens", 80), "BTC,ETH,SOL", 5).map((t) => t.toUpperCase());
      const stocks = list(opt(q, "stocks", 80), "AAPL,MSFT,NVDA,^GSPC", 4);
      const markets = num(q, "markets", { min: 1, max: 5, fallback: 3, integer: true });
      const { data, failed } = await runSections({
        prices: call(env, "/price/tokens", { symbols: tokens.join(",") }),
        sentiment: call(env, "/crypto/fear-greed", { days: 8 }),
        yields: callExtra(env, "/defi/yields", { stablecoin: "true", symbol: "USDC", minTvl: 5_000_000, maxApy: 50, limit: 3 }),
        ethGas: call(env, "/eth/gas", {}),
        l2Gas: call(env, "/arb/gas", {}),
        odds: callExtra(env, "/polymarket/markets", { limit: markets }),
        ...Object.fromEntries(stocks.map((s) => [`stock:${s}`, stockQuote(s)])),
      });
      const pr = data.prices as { prices?: Record<string, unknown>[] } | undefined;
      const fg = data.sentiment as { value: number; classification: string; change?: { vs7d: number | null }; attribution: string } | undefined;
      const yl = data.yields as { pools?: Record<string, unknown>[] } | undefined;
      const od = data.odds as { markets?: Record<string, unknown>[] } | undefined;
      const stockRows = stocks.filter((s) => data[`stock:${s}`]).map((s) => some(data[`stock:${s}`], ["symbol", "name", "price", "change", "changePercent", "currency", "marketState"]));
      return {
        pack: "daily-brief", asOf: new Date().toISOString(),
        crypto: pr?.prices ? pr.prices.map((p) => some(p, ["symbol", "address", "priceUsd", "chain", "thinLiquidity"])) : null,
        stocks: stockRows.length ? stockRows : null,
        sentiment: fg ? { value: fg.value, classification: fg.classification, change7d: fg.change?.vs7d ?? null, attribution: fg.attribution } : null,
        usdcYield: yl?.pools ? yl.pools.slice(0, 3).map((p) => some(p, ["chain", "project", "symbol", "apy", "apyBase", "tvlUsd"])) : null,
        gas: data.ethGas || data.l2Gas ? { ethereum: data.ethGas ?? null, arbitrum: data.l2Gas ?? null } : null,
        predictionMarkets: od?.markets ? od.markets.slice(0, markets).map((m) => ({ ...some(m, ["question", "volume24h", "endDate"]), outcomes: ((m.outcomes as { name: string; price: number }[] | undefined) ?? []).map((o) => ({ name: o.name, price: o.price })) })) : null,
        failed,
      };
    }, "$0.01"),
];
