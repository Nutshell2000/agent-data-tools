/**
 * Option pricing (6 Nov 2026). Demand: a Black-Scholes "Price + Greeks" listing was paid by 4 of the 47 open shoppers in the
 * 5 Nov sample of Base transfers. Black-Scholes-Merton for European options with a continuous dividend (or funding/borrow)
 * yield, the Greeks, and implied volatility from a market price. Pure arithmetic: no source, no network.
 */
import { entry, num, opt, type Entry, type Input } from "../family";
import { HttpError } from "../lib/env";

/** Standard normal CDF via erfc (W. J. Cody's rational approximations are overkill here; this keeps 1e-9 absolute error). */
export function normCdf(x: number): number {
  // Hart's double-precision algorithm (as in West 2005, "Better approximations to cumulative normal functions").
  const a = Math.abs(x);
  let c: number;
  if (a > 37) c = 0;
  else {
    const e = Math.exp(-a * a / 2);
    if (a < 7.07106781186547) {
      let b = 3.52624965998911e-2 * a + 0.700383064443688;
      b = b * a + 6.37396220353165; b = b * a + 33.912866078383; b = b * a + 112.079291497871; b = b * a + 221.213596169931; b = b * a + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * a + 1.75566716318264;
      b = b * a + 16.064177579207; b = b * a + 86.7807322029461; b = b * a + 296.564248779674; b = b * a + 637.333633378831; b = b * a + 793.826512519948; b = b * a + 440.413735824752;
      c /= b;
    } else {
      let b = a + 0.65; b = a + 4 / b; b = a + 3 / b; b = a + 2 / b; b = a + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}
export const normPdf = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);

export interface BsInput { spot: number; strike: number; years: number; vol: number; rate: number; dividend: number }

/** Price and Greeks for a call and a put. vega and rho per 1 percentage point; theta per calendar day. */
export function blackScholes({ spot: S, strike: K, years: T, vol: v, rate: r, dividend: q }: BsInput) {
  const sq = v * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + v * v / 2) * T) / sq;
  const d2 = d1 - sq;
  const dq = Math.exp(-q * T), dr = Math.exp(-r * T);
  const callPrice = S * dq * normCdf(d1) - K * dr * normCdf(d2);
  const putPrice = K * dr * normCdf(-d2) - S * dq * normCdf(-d1);
  const gamma = dq * normPdf(d1) / (S * sq);
  const vega = S * dq * normPdf(d1) * Math.sqrt(T) / 100;
  const thetaCall = (-S * dq * normPdf(d1) * v / (2 * Math.sqrt(T)) - r * K * dr * normCdf(d2) + q * S * dq * normCdf(d1)) / 365;
  const thetaPut = (-S * dq * normPdf(d1) * v / (2 * Math.sqrt(T)) + r * K * dr * normCdf(-d2) - q * S * dq * normCdf(-d1)) / 365;
  return {
    d1, d2,
    call: { price: callPrice, delta: dq * normCdf(d1), gamma, vega, theta: thetaCall, rho: K * T * dr * normCdf(d2) / 100, probabilityItm: normCdf(d2) },
    put: { price: putPrice, delta: dq * (normCdf(d1) - 1), gamma, vega, theta: thetaPut, rho: -K * T * dr * normCdf(-d2) / 100, probabilityItm: normCdf(-d2) },
  };
}

/** Volatility that reproduces a market price: Newton steps on vega, bisection when Newton leaves the bracket. */
export function impliedVol(price: number, type: "call" | "put", base: Omit<BsInput, "vol">): number | null {
  const at = (v: number) => blackScholes({ ...base, vol: v })[type].price;
  let lo = 1e-4, hi = 5;
  if (price <= at(lo) - 1e-12 || price >= at(hi)) return null;
  let v = 0.3;
  for (let i = 0; i < 100; i++) {
    const p = at(v), diff = p - price;
    if (Math.abs(diff) < 1e-10) return v;
    if (diff > 0) hi = v; else lo = v;
    const vega = blackScholes({ ...base, vol: v })[type].vega * 100;
    const next = vega > 1e-12 ? v - diff / vega : NaN;
    v = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  return v;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const rounded = (g: Record<string, number>) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, r6(v)]));

/** Years to expiry from days=, years= or expiry= (a date). */
function yearsOf(q: Input): number {
  const expiry = opt(q, "expiry", 40);
  if (expiry) {
    const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(expiry) ? `${expiry}T16:00:00Z` : expiry);
    if (!Number.isFinite(t)) throw new HttpError(400, "expiry must be a date such as 2026-12-18");
    const years = (t - Date.now()) / (365 * 86_400_000);
    if (years <= 0) throw new HttpError(400, "expiry is in the past");
    return years;
  }
  if (q("years") !== undefined && q("years") !== "") return num(q, "years", { min: 1e-6, max: 50 });
  return num(q, "days", { min: 0.001, max: 18_250, fallback: 30 }) / 365;
}

/** Percent inputs: 20 means 20%. Volatility under 3 is read as a fraction (0.2 = 20%: no traded asset has a 3% annual vol worth
 * pricing this way); rates and yields are always percent, because 0.5% is a real rate. */
const pct = (q: Input, name: string, fallback: number, fractionBelow: number, max: number) => {
  const v = num(q, name, { min: 0, max, fallback });
  return v < fractionBelow ? v : v / 100;
};

export const OPTIONS: Entry[] = [
  entry("/options/price", "Option pricing, Black-Scholes and Greeks",
    "Price a European call and put with Black-Scholes-Merton and get delta, gamma, vega (per vol point), theta (per day), rho, d1, d2 and the probability of ending in the money; or give a market price and get the implied volatility. Inputs: spot, strike, expiry date or days, volatility, interest rate and dividend or funding yield in percent. Pure arithmetic, no data source. Use for crypto, stock or FX options, to price a quote or size a hedge.",
    ["option-pricing", "black-scholes", "option-greeks", "implied-volatility", "options", "derivatives"], {
      spot: { type: "number", description: "Price of the underlying", required: true, example: 100 },
      strike: { type: "number", description: "Strike price", required: true, example: 100 },
      days: { type: "number", description: "Days to expiry (default 30), or give expiry or years", example: 365 },
      expiry: { type: "string", description: "Expiry date (ISO), instead of days", example: "2026-12-18" },
      years: { type: "number", description: "Years to expiry, instead of days", example: 1 },
      vol: { type: "number", description: "Annual volatility in percent, e.g. 20 (default 50); not needed with price", example: 20 },
      rate: { type: "number", description: "Risk-free rate in percent per year, e.g. 5 for 5% (default 0)", example: 5 },
      dividend: { type: "number", description: "Dividend, funding or borrow yield in percent per year (default 0)", example: 0 },
      price: { type: "number", description: "A market option price: returns the implied volatility", example: 10.45 },
      type: { type: "string", description: "call or put, for the implied volatility (default call)", example: "call" },
    },
    {
      inputs: { spot: 100, strike: 100, years: 1, vol: 0.2, rate: 0.05, dividend: 0 },
      call: { price: 10.450584, delta: 0.636831, gamma: 0.018762, vega: 0.375240, theta: -0.017573, rho: 0.532325, probabilityItm: 0.559618 },
      put: { price: 5.573526, delta: -0.363169, gamma: 0.018762, vega: 0.375240, theta: -0.004542, rho: -0.418905, probabilityItm: 0.440382 },
      d1: 0.35, d2: 0.15, model: "Black-Scholes-Merton (European exercise)",
    },
    (_env, q) => {
      const spot = num(q, "spot", { min: 1e-12, max: 1e15 });
      const strike = num(q, "strike", { min: 1e-12, max: 1e15 });
      const years = yearsOf(q);
      const rate = pct(q, "rate", 0, 0, 100);
      const dividend = pct(q, "dividend", 0, 0, 100);
      const base = { spot, strike, years, rate, dividend };
      const priceIn = q("price") === undefined || q("price") === "" ? undefined : num(q, "price", { min: 0, max: 1e15 });
      let vol: number;
      let implied: number | null = null;
      if (priceIn !== undefined) {
        const type = (opt(q, "type", 10) ?? "call").toLowerCase();
        if (type !== "call" && type !== "put") throw new HttpError(400, "type must be call or put");
        implied = impliedVol(priceIn, type, base);
        if (implied === null) throw new HttpError(422, `no volatility from 0.01% to 500% gives a ${type} price of ${priceIn}: it is below intrinsic value or above the spot`);
        vol = implied;
      } else vol = pct(q, "vol", 50, 3, 1000);
      if (vol <= 0) throw new HttpError(400, "vol must be above 0");
      const out = blackScholes({ ...base, vol });
      return {
        inputs: { spot, strike, years: r6(years), vol: r6(vol), rate, dividend },
        ...(implied !== null ? { impliedVol: r6(implied), impliedVolPercent: Math.round(implied * 1e4) / 100 } : {}),
        call: rounded(out.call), put: rounded(out.put), d1: r6(out.d1), d2: r6(out.d2),
        model: "Black-Scholes-Merton (European exercise)",
      };
    }),
];
