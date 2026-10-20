// The OpenAPI `x-payment-info` of a paid operation, read by two kinds of directory. AgentCash, x402scan and MPPScan read
// `price` (decimal USD) and `protocols`. MPP discovery (draft-payment-discovery, the mppx parser, mpp.dev) reads
// `offers`: one per MPP method with the amount in the currency's base units, null when the price depends on the
// request. Unknown fields pass through both, so the operation carries both shapes.

type MppProtocol = { mpp: { method: string; intent: string; currency: string } };

/** Base units of a decimal USD amount: 6 decimals for USDC and USDC.e, cents for Stripe's "usd". */
function baseUnits(usd: string, currency: string): string {
  const decimals = currency.toLowerCase() === "usd" ? 2 : 6;
  const [whole, frac = ""] = usd.split(".");
  return BigInt(`${whole}${frac.padEnd(decimals, "0").slice(0, decimals)}`).toString();
}

export function paymentInfo(price: { amount: string } | { min: string; max: string }, mpp: readonly unknown[], x402 = true) {
  const usd = (p: string) => p.replace("$", "");
  const fixed = "amount" in price ? usd(price.amount) : null;
  const offers = (mpp as MppProtocol[]).filter((p) => p?.mpp?.method).map(({ mpp: m }) => ({
    amount: fixed === null ? null : baseUnits(fixed, m.currency), currency: m.currency, method: m.method, intent: m.intent,
  }));
  return {
    price: fixed !== null ? { mode: "fixed", currency: "USD", amount: fixed } : { mode: "dynamic", currency: "USD", min: usd((price as { min: string }).min), max: usd((price as { max: string }).max) },
    protocols: [...(x402 ? [{ x402: {} }] : []), ...mpp],
    ...(offers.length ? { offers } : {}),
  };
}
