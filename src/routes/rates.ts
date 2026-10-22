import { HttpError } from "../lib/env";

const HEADERS = { "user-agent": "AgentDataTools/1.0" };
const CODE = /^[A-Z]{3}$/;

async function getJson<T>(url: string, source: string, notFound: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: HEADERS });
  } catch {
    throw new HttpError(502, `the ${source} data source did not respond`);
  }
  if (res.status === 404 || res.status === 422) throw new HttpError(404, notFound);
  if (!res.ok) throw new HttpError(502, `the ${source} data source returned HTTP ${res.status}`);
  return res.json();
}

/** European Central Bank reference rates, published once per working day. */
export async function exchangeRates(fromInput: string, toInput?: string, amountInput?: string) {
  const from = fromInput.trim().toUpperCase();
  if (!CODE.test(from)) throw new HttpError(400, "from must be a three-letter currency code such as USD");
  const to = (toInput ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (to.some((c) => !CODE.test(c))) throw new HttpError(400, "to must be three-letter currency codes separated by commas, e.g. EUR,GBP");
  const amount = amountInput === undefined || amountInput === "" ? 1 : Number(amountInput);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "amount must be a positive number");

  const query = new URLSearchParams({ base: from });
  if (to.length) query.set("symbols", to.join(","));
  const data = await getJson<{ base: string; date: string; rates: Record<string, number> }>(
    `https://api.frankfurter.dev/v1/latest?${query}`,
    "exchange rate",
    "unknown currency code; the European Central Bank publishes rates for about 30 major currencies",
  );
  return {
    from: data.base,
    amount,
    rateDate: data.date,
    rates: data.rates,
    converted: Object.fromEntries(Object.entries(data.rates).map(([code, rate]) => [code, Math.round(amount * rate * 10_000) / 10_000])),
    source: "European Central Bank reference rates (one rate per working day, published around 16:00 CET)",
    checkedAt: new Date().toISOString(),
  };
}

const BTC_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "CHF", "AUD", "JPY"] as const;

/** Bitcoin spot price in major fiat currencies. */
/** The last good answer, kept 30 s as plain data (never a shared promise), so bursts do not spend the sources' limits. */
let btcSnapshot: { at: number; value: Awaited<ReturnType<typeof readBitcoinPrice>> } | null = null;
const BTC_SNAPSHOT_MS = 30_000;

/** mempool.space (all currencies) with Coinbase spot (USD only) as the second source; neither answer is trusted blindly. */
async function readBitcoinPrice() {
  const checkedAt = new Date().toISOString();
  try {
    const data = await getJson<Record<string, unknown>>("https://mempool.space/api/v1/prices", "Bitcoin price", "price not available");
    if (!data || typeof data !== "object") throw new HttpError(502, "the Bitcoin price data source sent an unreadable answer");
    const prices = Object.fromEntries(BTC_CURRENCIES.filter((c) => typeof data[c] === "number" && (data[c] as number) > 0).map((c) => [c, data[c] as number]));
    if (!prices.USD) throw new HttpError(502, "the Bitcoin price data source returned no USD price");
    const time = typeof data.time === "number" && Number.isFinite(data.time) ? new Date(data.time * 1000) : new Date();
    return {
      asset: "BTC", prices, satsPerUsd: Math.round(100_000_000 / prices.USD), usdPerSat: prices.USD / 100_000_000,
      priceTime: time.toISOString(), source: "mempool.space (average of major exchanges)", checkedAt,
    };
  } catch (first) {
    if (!(first instanceof HttpError)) throw first;
    // Second source: Coinbase's public spot price (USD only). The same endpoint prices ETH in mev-simulator.ts.
    const spot = await getJson<{ data?: { amount?: string } }>("https://api.coinbase.com/v2/prices/BTC-USD/spot", "Bitcoin price", "price not available").catch(() => { throw first; });
    const usd = Number(spot?.data?.amount);
    if (!Number.isFinite(usd) || usd <= 0) throw first;
    return {
      asset: "BTC", prices: { USD: usd }, satsPerUsd: Math.round(100_000_000 / usd), usdPerSat: usd / 100_000_000,
      priceTime: checkedAt, source: "Coinbase spot (USD only; mempool.space unavailable)", checkedAt,
    };
  }
}

export async function bitcoinPrice({ fresh = false } = {}) {
  if (!fresh && btcSnapshot && Date.now() - btcSnapshot.at < BTC_SNAPSHOT_MS) return btcSnapshot.value;
  const value = await readBitcoinPrice();
  btcSnapshot = { at: Date.now(), value };
  return value;
}
