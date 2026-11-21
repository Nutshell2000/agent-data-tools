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
  let up = raw.trim().toUpperCase().replace(/^\$/, "");
  // 11 Nov 2026 truth audit: share classes written with a dot (BRK.B, BF.B, the common US form) resolved to other
  // instruments (a YieldMax ETF, an option). Yahoo writes US classes with a dash; exchange suffixes (VOLV-B.ST, SAP.DE)
  // keep their dot because the part after it is longer than one letter.
  if (/^[A-Z]{1,5}\.[A-Z]$/.test(up)) up = up.replace(".", "-");
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
/** Yahoo serves the chart API from two hosts. 12 Nov 2026: the quote's only failure in three days was a timeout on one of them. */
export const CHART_HOSTS = [CHART, CHART.replace("query1.", "query2.")];
/** 21 Nov 2026: "unknown ticker X" (and the source's own "No data found, symbol may be delisted") did not say what a symbol looks like or how to find one. */
const unknownTicker = (symbol: string) => `unknown ticker ${symbol.slice(0, 20)}: symbol is a Yahoo Finance ticker such as AAPL, VOLV-B.ST or BTC-USD; /stock/search finds the ticker for a company name; nothing was charged`;
type ChartBody = { chart?: { result?: ChartResult[] | null; error?: { description?: string } | null } };
/** The chart from the first host; on a timeout or a server error (502 from getJson) once more from the second, inside the same 8 s each. */
export async function chartBody(symbol: string, range: string, interval: string, get: typeof getJson = getJson): Promise<ChartBody> {
  const query = `${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  try {
    return await get<ChartBody>(`${CHART_HOSTS[0]}${query}`, { notFound: unknownTicker(symbol) });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 502) throw e;
    return get<ChartBody>(`${CHART_HOSTS[1]}${query}`, { notFound: unknownTicker(symbol) });
  }
}
async function chart(symbol: string, range: string, interval: string) {
  const r = await chartBody(symbol, range, interval);
  const res = r.chart?.result?.[0];
  // The source's own description is kept when it is about something other than a symbol it does not know.
  const said = r.chart?.error?.description;
  if (!res?.meta) throw new HttpError(404, said && !/no data found|not found|delisted/i.test(said) ? said : unknownTicker(symbol));
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
  // Yahoo's meta.previousClose is the authoritative close before the current session. Prefer it: on a non-trading
  // day or before the open the last daily bar is an older session, so the second-to-last bar can be two sessions back.
  const price = num(m.regularMarketPrice), prev = num(m.previousClose) ?? (closes.length >= 2 ? closes[closes.length - 2] : num(m.chartPreviousClose));
  const change = price !== null && prev !== null ? price - prev : null;
  return {
    symbol: String(m.symbol ?? symbol), name: (m.longName ?? m.shortName ?? null) as string | null, exchange: (m.fullExchangeName ?? m.exchangeName ?? null) as string | null,
    type: (m.instrumentType ?? null) as string | null, currency: (m.currency ?? null) as string | null,
    // Chart closes are 32-bit floats widened to doubles (4030.199951171875 for 4030.2); round like every other figure.
    price, previousClose: r4(prev), change: r4(change), changePercent: change !== null && prev ? r4((change / prev) * 100) : null,
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
 * Stock research brief (19 Nov 2026). Demand probe: "stock research" (21 searches, 10 buyer IPs), "ai stock research"
 * (16/13), "stock picks" (16/13, one competitor at $1.50), "S&P 500 thesis" (21/13) — a cluster of ~13-17 real buyers
 * per phrase, and the market price for dossiers and briefs is $0.18-1.25 a call (see this file's header). One chart
 * request carries everything: the quote plus a year of daily bars; the brief adds the computed analysis an agent would
 * otherwise have to write itself. Deterministic, no model call, so the answer is the same for the same market data.
 */
export async function stockBrief(raw: string) {
  const { symbol, c } = await chartOf(raw, "1y", "1d");
  const m = c.meta!;
  const q = c.indicators?.quote?.[0] ?? {};
  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const closes = (q.close ?? []).filter(isNum);
  const highs = (q.high ?? []).filter(isNum);
  const lows = (q.low ?? []).filter(isNum);
  const vols = (q.volume ?? []).filter(isNum);
  if (closes.length < 2) throw new HttpError(404, `not enough daily history for ${symbol} to build a brief`);
  const price = num(m.regularMarketPrice) ?? closes[closes.length - 1];
  const chgPct = num(m.regularMarketChangePercent);
  // With a one-year chart Yahoo omits meta.previousClose, so the previous close comes from the day's percent change.
  const prev = chgPct !== null ? price / (1 + chgPct / 100) : closes[closes.length - 2];
  const change = price - prev;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const sma = (n: number) => mean(closes.slice(-Math.min(n, closes.length)));
  const ret = (n: number) => {
    const i = Math.max(0, closes.length - 1 - n);
    return closes[i] ? (price / closes[i] - 1) * 100 : null;
  };
  // Annualized volatility from daily log returns (sample standard deviation, 252 trading days).
  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) logReturns.push(Math.log(closes[i] / closes[i - 1]));
  const lrMean = logReturns.length ? mean(logReturns) : 0;
  const variance = logReturns.length > 1 ? logReturns.reduce((a, b) => a + (b - lrMean) ** 2, 0) / (logReturns.length - 1) : 0;
  const volatility = Math.sqrt(variance * 252) * 100;
  let peak = closes[0], drawdown = 0;
  for (const close of closes) { peak = Math.max(peak, close); drawdown = Math.min(drawdown, close / peak - 1); }
  // RSI(14) over the last 14 sessions, simple averages of gains and losses.
  const window = closes.slice(-15);
  let gains = 0, losses = 0;
  for (let i = 1; i < window.length; i++) { const d = window[i] - window[i - 1]; if (d >= 0) gains += d; else losses -= d; }
  const periods = Math.max(1, window.length - 1);
  const avgGain = gains / periods, avgLoss = losses / periods;
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  const volumeTrend = vols.length >= 30 ? mean(vols.slice(-5)) / mean(vols.slice(-30)) : null;
  const high52 = num(m.fiftyTwoWeekHigh) ?? (highs.length ? Math.max(...highs) : null);
  const low52 = num(m.fiftyTwoWeekLow) ?? (lows.length ? Math.min(...lows) : null);
  const position = high52 !== null && low52 !== null && high52 > low52 ? ((price - low52) / (high52 - low52)) * 100 : null;
  const sma20 = sma(20), sma50 = sma(50), sma200 = sma(200);
  const r1m = ret(21), r3m = ret(63);
  const reasons: string[] = [];
  let score = 0;
  if (price > sma50) { score++; reasons.push("price is above its 50-day average"); }
  else reasons.push("price is below its 50-day average");
  if (price > sma200) { score++; reasons.push("price is above its 200-day average"); }
  else reasons.push("price is below its 200-day average");
  if (sma50 > sma200) { score++; reasons.push("the 50-day average is above the 200-day (uptrend structure)"); }
  else reasons.push("the 50-day average is below the 200-day (downtrend structure)");
  if (r1m !== null && r1m > 0) { score++; reasons.push("the one-month return is positive"); }
  if (r3m !== null && r3m > 0) { score++; reasons.push("the three-month return is positive"); }
  if (volumeTrend !== null && volumeTrend > 1.2 && r1m !== null && r1m > 0) { score++; reasons.push("volume is expanding while price rises"); }
  const flags: string[] = [];
  if (rsi > 70) flags.push("RSI above 70 (overbought)");
  if (rsi < 30) flags.push("RSI below 30 (oversold)");
  if (drawdown < -0.2) flags.push("one-year drawdown deeper than 20%");
  if (volatility > 50) flags.push("annualized volatility above 50%");
  if (position !== null && position > 95) flags.push("price is within 5% of its 52-week high");
  if (position !== null && position < 5) flags.push("price is within 5% of its 52-week low");
  const verdict = score >= 5 ? "bullish" : score >= 2 ? "neutral" : "bearish";
  return {
    symbol: String(m.symbol ?? symbol), name: (m.longName ?? m.shortName ?? null) as string | null,
    exchange: (m.fullExchangeName ?? m.exchangeName ?? null) as string | null, currency: (m.currency ?? null) as string | null,
    price: r4(price), previousClose: r4(prev), change: r4(change), changePercent: chgPct !== null ? r4(chgPct) : r4((change / prev) * 100),
    dayHigh: num(m.regularMarketDayHigh), dayLow: num(m.regularMarketDayLow), volume: num(m.regularMarketVolume),
    marketTime: typeof m.regularMarketTime === "number" ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    performance: { week1: r4(ret(5)), month1: r4(r1m), month3: r4(r3m), month6: r4(ret(126)), year1: r4(ret(252)) },
    risk: { volatilityAnnualizedPercent: r4(volatility), maxDrawdown1yPercent: r4(drawdown * 100) },
    trend: {
      sma20: r4(sma20), sma50: r4(sma50), sma200: r4(sma200),
      priceVsSma50Percent: r4((price / sma50 - 1) * 100), priceVsSma200Percent: r4((price / sma200 - 1) * 100),
      goldenCross: sma50 > sma200,
    },
    momentum: { rsi14: r4(rsi), volumeTrend5dVs30d: volumeTrend === null ? null : r4(volumeTrend) },
    range: { high52w: r4(high52), low52w: r4(low52), positionPercent: r4(position) },
    signal: { verdict, score, maxScore: 6, reasons, flags },
    analysisBasis: `${closes.length} daily closes over the past year`,
    note: NOTE,
  };
}

/**
 * Daily stock screen (19 Nov 2026). Demand probe: "daily stock screen" (28 searches, 15 buyer IPs), "stock picks"
 * (16/13), "daily stock picks with thesis" (21/11). The listing that sells this (PowaHub Daily Stock Screen, five S&P 500
 * picks with a thesis, $0.01) proves the price point: one cent. Yahoo's predefined screener answers in one request with
 * market cap, P/E, EPS, dividend, 52-week range, moving averages, volume and analyst rating, so the screen needs no
 * model call and costs us one upstream request. Screens are descriptive, not investment advice.
 */
const SCREENS: Readonly<Record<string, { id: string; summary: string }>> = Object.freeze({
  "day-gainers": { id: "day_gainers", summary: "the equities with the greatest gains in the trading day" },
  "day-losers": { id: "day_losers", summary: "the equities with the greatest losses in the trading day" },
  "most-active": { id: "most_actives", summary: "the most traded equities in the trading day" },
  "small-cap-gainers": { id: "small_cap_gainers", summary: "small caps with price momentum" },
  "undervalued-growth": { id: "undervalued_growth_stocks", summary: "growth stocks trading below their estimated fair value" },
  "growth-technology": { id: "growth_technology_stocks", summary: "technology stocks with growth characteristics" },
  "undervalued-large-caps": { id: "undervalued_large_caps", summary: "large caps trading below their estimated fair value" },
  "most-shorted": { id: "most_shorted_stocks", summary: "the most heavily shorted equities" },
  "aggressive-small-caps": { id: "aggressive_small_caps", summary: "small caps with aggressive growth characteristics" },
});
interface ScreenQuote {
  symbol?: string; shortName?: string; longName?: string; fullExchangeName?: string; currency?: string; quoteType?: string;
  regularMarketPrice?: number; regularMarketChangePercent?: number; regularMarketVolume?: number; averageDailyVolume3Month?: number;
  marketCap?: number; forwardPE?: number; trailingPE?: number; epsTrailingTwelveMonths?: number; dividendYield?: number;
  fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number; fiftyDayAverage?: number; twoHundredDayAverage?: number;
  averageAnalystRating?: string; earningsTimestamp?: number;
}
export async function stockScreen(screenIn?: string, countIn?: number) {
  const key = (screenIn ?? "day-gainers").trim().toLowerCase().replace(/[\s_]+/g, "-");
  // 21 Nov 2026: read with Object.hasOwn, so a prototype name (constructor, toString) sent as the value is not found in the table.
  const screen = Object.hasOwn(SCREENS, key) ? SCREENS[key] : undefined;
  if (!screen) throw new HttpError(400, `screen must be one of: ${Object.keys(SCREENS).join(", ")}`);
  const count = Math.min(25, Math.max(1, Math.trunc(countIn ?? 10)));
  const r = await getJson<{ finance?: { result?: { title?: string; description?: string; total?: number; quotes?: ScreenQuote[] }[] } }>(
    `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${screen.id}&count=${count}`,
  );
  const res = r.finance?.result?.[0];
  if (!res?.quotes?.length) throw new HttpError(502, "the stock screener returned no rows; try again shortly");
  const picks = res.quotes.slice(0, count).map((q) => {
    const price = num(q.regularMarketPrice), high = num(q.fiftyTwoWeekHigh), low = num(q.fiftyTwoWeekLow);
    const avg = num(q.averageDailyVolume3Month), volume = num(q.regularMarketVolume);
    const position = high !== null && low !== null && high > low && price !== null ? ((price - low) / (high - low)) * 100 : null;
    const dy = num(q.dividendYield);
    return {
      symbol: q.symbol ?? null, name: q.longName ?? q.shortName ?? null, exchange: q.fullExchangeName ?? null,
      type: q.quoteType ?? null, currency: q.currency ?? null,
      price: r4(price), changePercent: r4(num(q.regularMarketChangePercent)), volume,
      volumeVsAverage3m: volume !== null && avg ? r4(volume / avg) : null,
      marketCap: num(q.marketCap), pe: r4(num(q.forwardPE) ?? num(q.trailingPE)), eps: r4(num(q.epsTrailingTwelveMonths)),
      dividendYieldPercent: dy === null ? null : r4(dy * 100),
      fiftyTwoWeekHigh: r4(high), fiftyTwoWeekLow: r4(low), fiftyTwoWeekPositionPercent: r4(position),
      vsFiftyDayAveragePercent: r4(num(q.fiftyDayAverage) ? (price! / q.fiftyDayAverage! - 1) * 100 : null),
      vsTwoHundredDayAveragePercent: r4(num(q.twoHundredDayAverage) ? (price! / q.twoHundredDayAverage! - 1) * 100 : null),
      analystRating: q.averageAnalystRating ?? null,
      nextEarnings: typeof q.earningsTimestamp === "number" ? new Date(q.earningsTimestamp * 1000).toISOString() : null,
    };
  });
  return {
    screen: key, title: res.title ?? key, description: res.description ?? screen.summary,
    count: picks.length, totalMatching: res.total ?? null, picks,
    note: "A screen is descriptive, not investment advice: it lists what matches the criteria now, with delayed market data from Yahoo Finance.",
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
    ["stock-ohlcv-history", "stock-history", "ohlcv", "historical-stock-prices", "stocks"],
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
  entry("/stock/brief", "Stock research brief, technical analysis",
    "One-call stock research brief for any ticker or company: the quote plus one-year performance (1w, 1m, 3m, 6m, 1y), annualized volatility, maximum drawdown, 20/50/200-day moving averages, RSI(14), volume trend, 52-week range position and a rules-based bullish/neutral/bearish signal with the reasons and risk flags behind it. Deterministic, from one year of daily closes; no model call. Use to brief an agent or user on a stock before a decision.",
    ["stock-brief", "stock-research", "stock-analysis", "technical-analysis", "stock-dossier", "stocks", "equities"],
    { symbol: { type: "string", description: "Ticker (AAPL, ^GSPC, BTC-USD) or a company name", required: true, example: "AAPL" } },
    {
      symbol: "AAPL", name: "Apple Inc.", exchange: "NasdaqGS", currency: "USD", price: 270.37, previousClose: 268.5, change: 1.87, changePercent: 0.6965,
      dayHigh: 271.2, dayLow: 267.9, volume: 41234567, marketTime: "2026-11-05T21:00:00.000Z",
      performance: { week1: -1.6, month1: 1.52, month3: 12.89, month6: 14.5, year1: 31.16 },
      risk: { volatilityAnnualizedPercent: 25, maxDrawdown1yPercent: -13.82 },
      trend: { sma20: 267.74, sma50: 261.6, sma200: 232.91, priceVsSma50Percent: 3.35, priceVsSma200Percent: 16.08, goldenCross: true },
      momentum: { rsi14: 53.5, volumeTrend5dVs30d: 0.89 },
      range: { high52w: 280.1, low52w: 169.21, positionPercent: 91.2 },
      signal: { verdict: "bullish", score: 5, maxScore: 6, reasons: ["price is above its 50-day average", "price is above its 200-day average", "the 50-day average is above the 200-day (uptrend structure)", "the one-month return is positive", "the three-month return is positive"], flags: [] },
      analysisBasis: "251 daily closes over the past year", note: NOTE,
    },
    (_env, q) => stockBrief(need(q, "symbol", 100))),
  entry("/stock/screen", "Daily stock screen: gainers, losers, most active",
    "Daily stock screen in one call: gainers, losers, most-active, small-cap-gainers, undervalued-growth, growth-technology, undervalued-large-caps, most-shorted or aggressive-small-caps; up to 25 rows with price, day change, volume vs 3-month average, market cap, P/E, EPS, dividend, 52-week position, distance from 50/200-day averages, analyst rating and next earnings. Use to find stocks matching a screen. Delayed data; not investment advice.",
    ["stock-screener", "daily-stock-screen", "stock-picks", "stock-gainers", "stocks", "equities", "market-data"],
    {
      screen: { type: "string", description: `One of: ${Object.keys(SCREENS).join(", ")} (default day-gainers)`, example: "day-gainers" },
      count: { type: "integer", description: "Rows to return (1-25, default 10)", example: 10 },
    },
    {
      screen: "day-gainers", title: "Day Gainers", description: "Discover the equities with the greatest gains in the trading day.",
      count: 1, totalMatching: 31,
      picks: [{
        symbol: "INSM", name: "Insmed Incorporated", exchange: "NasdaqGS", type: "EQUITY", currency: "USD",
        price: 144.46, changePercent: 20.5843, volume: 14385785, volumeVsAverage3m: 5.12, marketCap: 31691679744,
        pe: 225.0612, eps: -2.81, dividendYieldPercent: 0, fiftyTwoWeekHigh: 212.75, fiftyTwoWeekLow: 90.39, fiftyTwoWeekPositionPercent: 44.2,
        vsFiftyDayAveragePercent: 30.72, vsTwoHundredDayAveragePercent: 17.79, analystRating: "1.3 - Strong Buy", nextEarnings: "2026-11-27T21:00:00.000Z",
      }],
      note: "A screen is descriptive, not investment advice: it lists what matches the criteria now, with delayed market data from Yahoo Finance.",
    },
    (_e, q) => stockScreen(opt(q, "screen", 40), Math.min(Math.max(Math.trunc(Number(q("count"))) || 10, 1), 25))),
  entry("/commodity/price", "Commodity prices: gold, oil, silver, gas, grains",
    "Commodity price now for gold, silver, platinum, palladium, copper, crude oil (WTI and Brent), natural gas, gasoline, heating oil, corn, wheat, soybeans, coffee, sugar, cocoa or cotton: the front-month futures price with its unit, the day's change and percent, previous close, day range and 52-week range. XAU, oil and similar names work. Use to price a commodity in an agent, track inflation inputs, or add market context to a brief.",
    ["commodity-prices", "gold-price", "oil-price", "silver-price", "commodities", "futures", "market-data"],
    { commodity: { type: "string", description: `One of: ${Object.keys(COMMODITIES).join(", ")}`, required: true, example: "gold" } },
    { commodity: "gold", name: "Gold", contract: "front-month futures", symbol: "GC=F", unit: "USD per troy ounce", price: 4105.3, previousClose: 4088.1, change: 17.2, changePercent: 0.4207, dayHigh: 4121.8, dayLow: 4079.5, fiftyTwoWeekHigh: 4398, fiftyTwoWeekLow: 2567.4, exchange: "COMEX", marketTime: "2026-11-10T21:59:00.000Z", note: NOTE },
    (_env, q) => commodityPrice(need(q, "commodity", 60))),
];
