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
export async function bitcoinPrice() {
  const data = await getJson<Record<string, number>>("https://mempool.space/api/v1/prices", "Bitcoin price", "price not available");
  const prices = Object.fromEntries(BTC_CURRENCIES.filter((c) => data[c] > 0).map((c) => [c, data[c]]));
  if (!prices.USD) throw new HttpError(502, "the Bitcoin price data source returned no price");
  return {
    asset: "BTC",
    prices,
    satsPerUsd: Math.round(100_000_000 / prices.USD),
    usdPerSat: prices.USD / 100_000_000,
    priceTime: new Date(data.time * 1000).toISOString(),
    source: "mempool.space (average of major exchanges)",
    checkedAt: new Date().toISOString(),
  };
}
