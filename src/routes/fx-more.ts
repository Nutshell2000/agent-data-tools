/**
 * All FX pairs in one call and the FX symbol list (5 Nov 2026). Demand: tick.hugen.tokyo's "all FX pairs" and "FX symbols"
 * listings had 103 and 114 payers at $0.005 on the Bazaar. Same source as /fx: European Central Bank reference rates via
 * Frankfurter (the ECB allows reuse, commercial included, with the source named and the figures unchanged), so these are
 * daily reference mid rates, never live bid/ask quotes; every answer says so.
 */
import { entry, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { exchangeRates } from "./rates";

const SOURCE = "Source: ECB statistics (euro foreign exchange reference rates via Frankfurter), one rate per working day around 16:00 CET; reference mid rates, not tradable bid/ask quotes.";
const MAJORS = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY"] as const;

/** Every currency the ECB publishes, with its English name. */
export async function fxSymbols() {
  let res: Response;
  try {
    res = await fetch("https://api.frankfurter.dev/v1/currencies", { signal: AbortSignal.timeout(8_000), headers: { "user-agent": "AgentDataTools/1.0" } });
  } catch {
    throw new HttpError(502, "the exchange rate data source did not respond");
  }
  if (!res.ok) throw new HttpError(502, `the exchange rate data source returned HTTP ${res.status}`);
  const names = (await res.json()) as Record<string, string>;
  const symbols = Object.entries(names).filter(([code, name]) => /^[A-Z]{3}$/.test(code) && typeof name === "string")
    .map(([code, name]) => ({ code, name })).sort((x, y) => x.code.localeCompare(y.code));
  if (!symbols.length) throw new HttpError(502, "the exchange rate data source returned no currencies");
  return { count: symbols.length, symbols, pairs: symbols.length * (symbols.length - 1), source: SOURCE, checkedAt: new Date().toISOString() };
}

/** Every pair among the major currencies (or a chosen list) from one ECB fetch, as cross rates. */
export async function fxAllPairs(currenciesInput?: string) {
  const wanted = currenciesInput ? currenciesInput.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) : [...MAJORS];
  if (wanted.length < 2 || wanted.length > 12) throw new HttpError(400, "currencies takes 2 to 12 three-letter codes, e.g. USD,EUR,GBP");
  if (!wanted.every((c) => /^[A-Z]{3}$/.test(c))) throw new HttpError(400, "currencies must be three-letter currency codes separated by commas");
  const fx = await exchangeRates("EUR");
  const perEur: Record<string, number> = { ...fx.rates, EUR: 1 };
  const missing = wanted.filter((c) => !Object.hasOwn(perEur, c));
  if (missing.length) throw new HttpError(404, `no ECB reference rate for ${missing.join(", ")}; /fx/symbols lists the currencies`);
  const pairs: Record<string, number> = {};
  for (const base of wanted) for (const quote of wanted) {
    if (base !== quote) pairs[`${base}/${quote}`] = Number((perEur[quote] / perEur[base]).toPrecision(6));
  }
  return { rateDate: fx.rateDate, currencies: wanted, count: Object.keys(pairs).length, pairs, source: SOURCE, checkedAt: new Date().toISOString() };
}

export const FX_MORE: Entry[] = [
  entry("/fx/all", "All FX pairs, forex cross rates",
    "All FX pairs in one call: cross rates for every pair among the major currencies (USD, EUR, GBP, JPY, CHF, CAD, AUD, CNY) or up to 12 chosen ones, from the European Central Bank's daily reference rates, with the date they apply to. Use to fill a forex rate table, convert between many currencies at once, or check a cross rate. Reference mid rates, not live bid/ask.",
    ["fx-pairs", "forex", "cross-rates", "exchange-rates", "currency"],
    { currencies: { type: "string", description: "Optional comma-separated currency codes (2-12); default the eight majors", example: "USD,EUR,GBP" } },
    { rateDate: "2026-11-05", currencies: ["USD", "EUR", "GBP"], count: 6, pairs: { "USD/EUR": 0.86, "USD/GBP": 0.76, "EUR/USD": 1.16279, "EUR/GBP": 0.883721, "GBP/USD": 1.31579, "GBP/EUR": 1.13158 }, source: SOURCE, checkedAt: "2026-11-05T16:30:00.000Z" },
    (_env, q) => fxAllPairs(opt(q, "currencies", 100))),
  entry("/fx/symbols", "FX symbols, currency list",
    "FX symbols: the list of currencies with daily European Central Bank reference rates (about 30), each with its ISO 4217 code and English name, plus how many pairs they make. Use to check which currencies /fx and /fx/all can convert before calling them, or to fill a currency picker.",
    ["fx-symbols", "currency-list", "forex", "currency-codes", "exchange-rates"],
    {},
    { count: 2, symbols: [{ code: "EUR", name: "Euro" }, { code: "USD", name: "United States Dollar" }], pairs: 2, source: SOURCE, checkedAt: "2026-11-05T16:30:00.000Z" },
    () => fxSymbols()),
];
