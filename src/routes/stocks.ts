/**
 * Stock market data (5 Nov 2026). Demand: stock OHLCV history had a repeat buyer on Base (x402financialdata, 527 calls
 * from 4 payers at $0.01), and stock dossiers, briefs and screeners sell at $0.18-1.25 a call. Source: Yahoo Finance's
 * public chart and search endpoints (keyless). Yahoo's terms limit commercial reuse; the owner lifted our
 * commercial-licence rule on 5 Nov 2026 and accepts that risk (worst case Yahoo blocks Cloudflare's egress: then pause
 * these in PAUSED_FAMILY_TOOLS). Quotes can be delayed by the exchange; every answer says so.
 */
import { entry, getJson, need, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const CHART = "https://query1.finance.yahoo.com/v8/finance/chart/";
const SEARCH = "https://query2.finance.yahoo.com/v1/finance/search";
const NOTE = "Market data from Yahoo Finance's public endpoints; quotes may be delayed by the exchange (often 15 minutes). Not investment advice.";
const TICKER = /^[A-Z0-9^][A-Z0-9.\-=^]{0,14}$/;
const RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"] as [string, ...string[]];
const INTERVALS = ["1m", "5m", "15m", "30m", "60m", "1h", "1d", "1wk", "1mo"] as [string, ...string[]];

interface SearchHit { symbol?: string; shortname?: string; longname?: string; exchDisp?: string; quoteType?: string; typeDisp?: string; sector?: string; industry?: string }

export async function stockSearch(query: string, limit = 8) {
  const r = await getJson<{ quotes?: SearchHit[] }>(`${SEARCH}?q=${encodeURIComponent(query)}&quotesCount=${limit}&newsCount=0`);
  return (r.quotes ?? []).filter((x) => x.symbol).slice(0, limit).map((x) => ({
    symbol: x.symbol!, name: x.longname ?? x.shortname ?? null, exchange: x.exchDisp ?? null, type: x.typeDisp ?? x.quoteType ?? null,
    sector: x.sector ?? null, industry: x.industry ?? null,
  }));
}

/** A ticker as typed (AAPL, ^GSPC, BTC-USD, EURUSD=X, VOLV-B.ST) or a company name, resolved through search. */
async function resolveSymbol(raw: string) {
  const up = raw.trim().toUpperCase().replace(/^\$/, "");
  if (TICKER.test(up) && !/\s/.test(raw.trim())) return up;
  const hits = await stockSearch(raw, 1);
  if (!hits.length) throw new HttpError(404, `no ticker found for "${raw}"`);
  return hits[0].symbol;
}

interface ChartResult {
  meta?: Record<string, unknown>;
  timestamp?: number[];
  indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] };
}
async function chart(symbol: string, range: string, interval: string) {
  const r = await getJson<{ chart?: { result?: ChartResult[] | null; error?: { description?: string } | null } }>(
    `${CHART}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`, { notFound: `unknown ticker ${symbol}` });
  const res = r.chart?.result?.[0];
  if (!res?.meta) throw new HttpError(404, r.chart?.error?.description ?? `unknown ticker ${symbol}`);
  return res;
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r4 = (v: number | null) => (v === null ? null : Math.round(v * 10_000) / 10_000);

/** A word that passes for a ticker but is a company name ("Tesla", "Apple"): when no such ticker exists, search the name once. */
async function chartOf(raw: string, range: string, interval: string) {
  const symbol = await resolveSymbol(raw);
  try { return { symbol, c: await chart(symbol, range, interval) }; } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 404) throw e;
    const hit = (await stockSearch(raw, 1).catch(() => []))[0]?.symbol;
    if (!hit || hit === symbol) throw e;
    return { symbol: hit, c: await chart(hit, range, interval) };
  }
}

export async function stockQuote(raw: string) {
  const { symbol, c: quoted } = await chartOf(raw, "5d", "1d");
  const m = quoted.meta!;
  // The previous close is the daily bar before the latest one. Yahoo's chartPreviousClose is the close before the whole
  // chart window: with this 5-day chart it is the close of five sessions ago, and until 10 Nov 2026 the tool reported
  // that five-day move as the day's change (AAPL: +5.0% shown, -0.62% true). With a single bar it is the true previous close.
  const closes = (quoted.indicators?.quote?.[0]?.close ?? []).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const price = num(m.regularMarketPrice), prev = closes.length >= 2 ? closes[closes.length - 2] : num(m.chartPreviousClose) ?? num(m.previousClose);
  const change = price !== null && prev !== null ? price - prev : null;
  return {
    symbol: String(m.symbol ?? symbol), name: (m.longName ?? m.shortName ?? null) as string | null, exchange: (m.fullExchangeName ?? m.exchangeName ?? null) as string | null,
    type: (m.instrumentType ?? null) as string | null, currency: (m.currency ?? null) as string | null,
    price, previousClose: prev, change: r4(change), changePercent: change !== null && prev ? r4((change / prev) * 100) : null,
    dayHigh: num(m.regularMarketDayHigh), dayLow: num(m.regularMarketDayLow), volume: num(m.regularMarketVolume),
    fiftyTwoWeekHigh: num(m.fiftyTwoWeekHigh), fiftyTwoWeekLow: num(m.fiftyTwoWeekLow),
    marketTime: typeof m.regularMarketTime === "number" ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    timezone: (m.exchangeTimezoneName ?? null) as string | null, note: NOTE,
  };
}

export async function stockHistory(raw: string, rangeIn?: string, intervalIn?: string) {
  const range = (rangeIn ?? "1mo").toLowerCase();
  if (!RANGES.includes(range)) throw new HttpError(400, `range must be one of: ${RANGES.join(", ")}`);
  const interval = (intervalIn ?? (["1d", "5d"].includes(range) ? "15m" : ["1mo", "3mo", "6mo", "1y", "ytd"].includes(range) ? "1d" : "1wk")).toLowerCase();
  if (!INTERVALS.includes(interval)) throw new HttpError(400, `interval must be one of: ${INTERVALS.join(", ")}`);
  const { symbol, c } = await chartOf(raw, range, interval);
  const q = c.indicators?.quote?.[0] ?? {};
  const adj = c.indicators?.adjclose?.[0]?.adjclose;
  const bars = (c.timestamp ?? []).map((t, i) => ({
    time: new Date(t * 1000).toISOString(), open: r4(num(q.open?.[i])), high: r4(num(q.high?.[i])), low: r4(num(q.low?.[i])),
    close: r4(num(q.close?.[i])), ...(adj ? { adjClose: r4(num(adj[i])) } : {}), volume: num(q.volume?.[i]),
  })).filter((b) => b.close !== null);
  if (!bars.length) throw new HttpError(404, `no ${interval} bars for ${symbol} over ${range}; intraday intervals only reach back about 60 days`);
  const closes = bars.map((b) => b.close!) ;
  const first = closes[0], last = closes[closes.length - 1];
  return {
    symbol, currency: (c.meta?.currency ?? null) as string | null, range, interval, count: bars.length,
    first, last, changePercent: r4(((last - first) / first) * 100), high: Math.max(...bars.map((b) => b.high ?? -Infinity)), low: Math.min(...bars.map((b) => b.low ?? Infinity)),
    bars: bars.slice(-500), note: NOTE,
  };
}

/**
 * Commodity prices (10 Nov 2026). The Bazaar had 53 commodity listings that day (196 calls in 30 days, gold, oil, silver
 * and grains; one explorer wallet bought a commodities list ten times at $0.02) and we sold none. The price is the
 * front-month futures contract as Yahoo Finance names it (GC=F and so on), which is the figure quote pages show for a
 * commodity; same source, terms and risk as the stock tools above. Units are the contract's own quoting units.
 */
export const COMMODITIES: Readonly<Record<string, { symbol: string; name: string; unit: string }>> = Object.freeze({
  gold: { symbol: "GC=F", name: "Gold", unit: "USD per troy ounce" },
  silver: { symbol: "SI=F", name: "Silver", unit: "USD per troy ounce" },
  platinum: { symbol: "PL=F", name: "Platinum", unit: "USD per troy ounce" },
  palladium: { symbol: "PA=F", name: "Palladium", unit: "USD per troy ounce" },
  copper: { symbol: "HG=F", name: "Copper", unit: "USD per pound" },
  "crude-oil": { symbol: "CL=F", name: "Crude oil (WTI)", unit: "USD per barrel" },
  brent: { symbol: "BZ=F", name: "Crude oil (Brent)", unit: "USD per barrel" },
  "natural-gas": { symbol: "NG=F", name: "Natural gas (Henry Hub)", unit: "USD per MMBtu" },
  gasoline: { symbol: "RB=F", name: "Gasoline (RBOB)", unit: "USD per gallon" },
  "heating-oil": { symbol: "HO=F", name: "Heating oil", unit: "USD per gallon" },
  corn: { symbol: "ZC=F", name: "Corn", unit: "US cents per bushel" },
  wheat: { symbol: "ZW=F", name: "Wheat", unit: "US cents per bushel" },
  soybeans: { symbol: "ZS=F", name: "Soybeans", unit: "US cents per bushel" },
  coffee: { symbol: "KC=F", name: "Coffee (arabica)", unit: "US cents per pound" },
  sugar: { symbol: "SB=F", name: "Sugar (raw)", unit: "US cents per pound" },
  cocoa: { symbol: "CC=F", name: "Cocoa", unit: "USD per metric ton" },
  cotton: { symbol: "CT=F", name: "Cotton", unit: "US cents per pound" },
});
const COMMODITY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  xau: "gold", xauusd: "gold", "gc=f": "gold", xag: "silver", xagusd: "silver", "si=f": "silver", xpt: "platinum", xpd: "palladium",
  oil: "crude-oil", crude: "crude-oil", wti: "crude-oil", "crude oil": "crude-oil", crudeoil: "crude-oil", "wti crude": "crude-oil", "cl=f": "crude-oil",
  "brent crude": "brent", "brent oil": "brent", natgas: "natural-gas", "natural gas": "natural-gas", gas: "natural-gas", "nat gas": "natural-gas", "ng=f": "natural-gas",
  petrol: "gasoline", rbob: "gasoline", "heating oil": "heating-oil", diesel: "heating-oil", soybean: "soybeans", soy: "soybeans", maize: "corn",
});
/** "Gold", "XAU", "crude oil", "WTI", "GC=F" -> our commodity key; undefined when it is not one we quote. */
export function commodityKey(raw: string): string | undefined {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/ (price|futures|spot)$/g, "");
  const dashed = s.replace(/[ _]/g, "-");
  return Object.hasOwn(COMMODITIES, dashed) ? dashed : Object.hasOwn(COMMODITY_ALIASES, s) ? COMMODITY_ALIASES[s] : Object.hasOwn(COMMODITY_ALIASES, dashed) ? COMMODITY_ALIASES[dashed] : undefined;
}
export async function commodityPrice(raw: string, quote: typeof stockQuote = stockQuote) {
  const key = commodityKey(raw);
  if (!key) throw new HttpError(400, `commodity must be one of: ${Object.keys(COMMODITIES).join(", ")}`);
  const c = COMMODITIES[key];
  const q = await quote(c.symbol);
  return {
    commodity: key, name: c.name, contract: "front-month futures", symbol: c.symbol, unit: c.unit, price: q.price, previousClose: q.previousClose, change: q.change, changePercent: q.changePercent,
    dayHigh: q.dayHigh, dayLow: q.dayLow, fiftyTwoWeekHigh: q.fiftyTwoWeekHigh, fiftyTwoWeekLow: q.fiftyTwoWeekLow, exchange: q.exchange, marketTime: q.marketTime, note: NOTE,
  };
}

export const STOCKS: Entry[] = [
  entry("/stock/quote", "Stock price, stock quote",
    "Stock price and quote for any ticker or company name: last price, change and percent, previous close, day high and low, volume, 52-week high and low, currency, exchange and market time. Works for US and world stocks, ETFs, indices (^GSPC), currencies (EURUSD=X) and crypto pairs (BTC-USD). Use to price a stock in an agent, check a move, or value a portfolio line.",
    ["stock-price", "stock-quote", "stocks", "equities", "market-data"],
    { symbol: { type: "string", description: "Ticker (AAPL, VOLV-B.ST, ^GSPC, BTC-USD) or a company name", required: true, example: "AAPL" } },
    { symbol: "AAPL", name: "Apple Inc.", exchange: "NasdaqGS", type: "EQUITY", currency: "USD", price: 270.37, previousClose: 268.5, change: 1.87, changePercent: 0.6965, dayHigh: 271.2, dayLow: 267.9, volume: 41234567, fiftyTwoWeekHigh: 280.1, fiftyTwoWeekLow: 169.21, marketTime: "2026-11-05T21:00:00.000Z", timezone: "America/New_York", note: NOTE },
    (_env, q) => stockQuote(need(q, "symbol", 100))),
  entry("/stock/history", "Historical stock prices, OHLCV",
    "Stock price history as OHLCV bars for any ticker or company name: open, high, low, close, adjusted close and volume from 1-minute to monthly bars over 1 day to the full history, plus first, last, change, high and low. Use to chart a stock, backtest a signal, compute returns or feed indicators.",
    ["stock-history", "ohlcv", "historical-stock-prices", "candles", "stocks"],
    {
      symbol: { type: "string", description: "Ticker (AAPL, ^GSPC, BTC-USD) or a company name", required: true, example: "AAPL" },
      range: { type: "string", description: "1d, 5d, 1mo (default), 3mo, 6mo, 1y, 2y, 5y, 10y, ytd or max", enum: RANGES, example: "1mo" },
      interval: { type: "string", description: "1m, 5m, 15m, 30m, 60m, 1d, 1wk or 1mo (default suits the range; intraday bars reach back about 60 days)", enum: INTERVALS, example: "1d" },
    },
    { symbol: "AAPL", currency: "USD", range: "1mo", interval: "1d", count: 1, first: 255.1, last: 270.37, changePercent: 5.9859, high: 271.2, low: 252.4, bars: [{ time: "2026-11-05T14:30:00.000Z", open: 268.9, high: 271.2, low: 267.9, close: 270.37, adjClose: 270.37, volume: 41234567 }], note: NOTE },
    (_env, q) => stockHistory(need(q, "symbol", 100), opt(q, "range", 10), opt(q, "interval", 10))),
  entry("/stock/search", "Stock ticker lookup, symbol search",
    "Stock ticker lookup: find the ticker symbol for a company, fund, index or crypto by name, with exchange, type, sector and industry. Use before /stock/quote or /stock/history when you only have a company name, or to find a company's listings on several exchanges.",
    ["ticker-lookup", "symbol-search", "stock-ticker", "stocks", "company-ticker"],
    { q: { type: "string", description: "Company, fund or index name, e.g. volvo", required: true, example: "volvo" } },
    { query: "volvo", count: 1, results: [{ symbol: "VOLV-B.ST", name: "AB Volvo (publ)", exchange: "Stockholm", type: "Equity", sector: "Industrials", industry: "Farm & Heavy Construction Machinery" }], note: NOTE },
    async (_env, q) => { const query = need(q, "q", 100); const results = await stockSearch(query); if (!results.length) throw new HttpError(404, `no ticker found for "${query}"`); return { query, count: results.length, results, note: NOTE }; }),
  entry("/commodity/price", "Commodity prices: gold, oil, silver, gas, grains",
    "Commodity price now for gold, silver, platinum, palladium, copper, crude oil (WTI and Brent), natural gas, gasoline, heating oil, corn, wheat, soybeans, coffee, sugar, cocoa or cotton: the front-month futures price with its unit, the day's change and percent, previous close, day range and 52-week range. XAU, oil and similar names work. Use to price a commodity in an agent, track inflation inputs, or add market context to a brief.",
    ["commodity-prices", "gold-price", "oil-price", "silver-price", "commodities", "futures", "market-data"],
    { commodity: { type: "string", description: `One of: ${Object.keys(COMMODITIES).join(", ")}`, required: true, example: "gold" } },
    { commodity: "gold", name: "Gold", contract: "front-month futures", symbol: "GC=F", unit: "USD per troy ounce", price: 4105.3, previousClose: 4088.1, change: 17.2, changePercent: 0.4207, dayHigh: 4121.8, dayLow: 4079.5, fiftyTwoWeekHigh: 4398, fiftyTwoWeekLow: 2567.4, exchange: "COMEX", marketTime: "2026-11-10T21:59:00.000Z", note: NOTE },
    (_env, q) => commodityPrice(need(q, "commodity", 60))),
];
