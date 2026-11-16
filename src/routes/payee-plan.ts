/**
 * Payment plan across rails (step A of the all-rails plan, owner's go 15 Nov 2026; plan file section 10). Non-custodial:
 * we read the payee's verified record and what it accepts, then tell the buyer's agent which rail to use and exactly
 * what to pay where. The buyer's own wallet or payment provider carries the payment out. We never execute, hold or
 * route money, never store card data, and never ask for a buyer's account.
 */
import { entry, num, opt, need, type Entry } from "../family";
import { HttpError, isAddress, type Env } from "../lib/env";
import { RAILS, attest, checkVerdict, ISSUER, payeeDeps, payeeDomain, recordFor, type Accepted, type PayeeRecord, type Verdict } from "./payee";

type Rail = (typeof RAILS)[number];
export interface PlanInput { amount: number | null; currency: string; can: Rail[]; network: string | null }

const STABLE = new Set(["USD", "USDC"]);
const BASE_SCORE: Record<Rail, number> = { x402: 100, mpp: 90, "sepa-instant": 70, swish: 65, card: 50 };
/** A rough floor per rail in the payment's own currency (card processors' minimum charge; Swish 1 SEK). */
const MIN: Partial<Record<Rail, number>> = { card: 0.5, swish: 1, "sepa-instant": 0.01 };

export interface PlanOption {
  rail: Rail; score: number; final: boolean; chargebacks: boolean;
  instruction: Record<string, unknown>; proof: string; notes: string[];
}

function option(a: Accepted, record: PayeeRecord, input: PlanInput): PlanOption | { rail: Rail; excluded: string } {
  const notes: string[] = [];
  let score = BASE_SCORE[a.rail];
  const amount = input.amount;
  const min = MIN[a.rail];
  if (amount !== null && min !== undefined && amount < min) return { rail: a.rail, excluded: `below the rail's minimum of ${min} ${input.currency}` };
  switch (a.rail) {
    case "x402":
    case "mpp": {
      if (!STABLE.has(input.currency)) { score -= 30; notes.push(`priced in ${input.currency}: the buyer pays the USD stablecoin equivalent, so an exchange step comes first`); }
      let payTo = a.rail === "x402" ? a.payTo : null;
      const signed = record.wallets.filter((w) => w.proof === "signature" && w.network === (a.rail === "x402" ? a.network : "tempo"));
      if (!payTo) payTo = signed[0]?.address ?? record.wallets.find((w) => w.network === (a.rail === "x402" ? a.network : "tempo"))?.address ?? null;
      if (!payTo && !a.url) return { rail: a.rail, excluded: "no wallet or endpoint is declared for it" };
      const wallet = payTo ? record.wallets.find((w) => w.address.toLowerCase() === payTo!.toLowerCase()) : undefined;
      if (wallet?.sanctions === "block") return { rail: a.rail, excluded: `${payTo} is on the OFAC list` };
      if (payTo && wallet?.proof !== "signature") { score -= 20; notes.push(`${payTo} is declared but not proven by a signature`); }
      const instruction = a.rail === "x402"
        ? { network: a.network, asset: "USDC", payTo, ...(amount !== null ? { amount: STABLE.has(input.currency) ? amount : null } : {}), ...(a.url ? { endpoint: a.url, how: "call the endpoint; pay the 402 quote with your x402 client after checking its payTo equals this one" } : { how: "send USDC on this network to payTo" }) }
        : { method: a.method, payTo, ...(a.url ? { endpoint: a.url } : {}), how: "pay the endpoint's MPP challenge with your MPP client" };
      return { rail: a.rail, score, final: true, chargebacks: false, instruction, proof: "after paying: /x402/receipt?hash=<transaction hash> for a filed receipt", notes };
    }
    case "card":
      if (!a.provider) { score -= 25; notes.push("the checkout page is not on a payment provider we know: confirm the host before entering card details"); }
      return { rail: "card", score, final: false, chargebacks: true, instruction: { checkoutUrl: a.checkoutUrl, provider: a.provider, how: "open the checkout with your own card or card agent token; we never see card data" }, proof: "keep the payment provider's receipt", notes };
    case "sepa-instant":
      if (input.currency !== "EUR") return { rail: a.rail, excluded: "SEPA Instant pays in euros only" };
      return { rail: a.rail, score, final: true, chargebacks: false, instruction: { instructionsUrl: a.instructionsUrl, how: "pay from your own bank or provider with the details on the business's page; check the account name matches the verified company" }, proof: "keep your bank's payment confirmation", notes };
    case "swish":
      if (input.currency !== "SEK") return { rail: a.rail, excluded: "Swish pays in Swedish kronor only" };
      return { rail: a.rail, score, final: true, chargebacks: false, instruction: { number: a.number, ...(amount !== null ? { amount } : {}), how: "pay the Swish business number from your own Swish; check the recipient name shown matches the verified company" }, proof: "keep the Swish confirmation", notes };
  }
}

export function planPayment(record: PayeeRecord | null, verdict: { verdict: Verdict; reasons: string[] }, input: PlanInput) {
  if (!record || verdict.verdict === "unknown") return { verdict: verdict.verdict, chosen: null, options: [], excluded: [], reasons: [...verdict.reasons, "ask the seller to publish its payee record before paying"] };
  if (verdict.verdict === "block") return { verdict: verdict.verdict, chosen: null, options: [], excluded: [], reasons: verdict.reasons };
  const accepts: Accepted[] = record.accepts?.length ? record.accepts
    // Before declaration v2: the wallets in payTo are x402 rails on their own networks.
    : record.wallets.filter((w) => isAddress(w.address)).map((w) => ({ rail: "x402" as const, network: w.network, payTo: w.address, url: null }));
  const options: PlanOption[] = [];
  const excluded: { rail: Rail; excluded: string }[] = [];
  for (const a of accepts) {
    if (!input.can.includes(a.rail)) { excluded.push({ rail: a.rail, excluded: "the buyer cannot pay on this rail" }); continue; }
    if (input.network && a.rail === "x402" && a.network !== input.network) { excluded.push({ rail: a.rail, excluded: `on ${a.network}, not ${input.network}` }); continue; }
    const o = option(a, record, input);
    if ("excluded" in o) excluded.push(o); else options.push(o);
  }
  if (verdict.verdict !== "pass") for (const o of options) o.score -= 10;
  options.sort((x, y) => y.score - x.score);
  return { verdict: verdict.verdict, chosen: options[0] ?? null, options, excluded, reasons: verdict.verdict === "pass" ? [] : verdict.reasons };
}

const EX_DOMAIN = "agent-data-tools.revmesh2074.workers.dev";

export const PAYEE_PLAN: Entry[] = [
  entry("/payee/plan", "Payment plan: which rail to pay a verified payee on",
    "Plan a payment to a payee before paying it: from its verified record (company, sanctions, signed wallets) and the rails it accepts (x402 USDC, MPP, card checkout, SEPA Instant, Swish), the best rail for the amount and currency and exactly what to pay where, plus finality, chargebacks and how to get a receipt. Never pays, routes or holds money. Use before paying when the buyer can pay several ways.",
    ["payment-routing", "payment-plan", "payee-check", "x402", "stablecoin-payments"], {
      domain: { type: "string", description: "The payee's domain, e.g. shop.example.com", required: true, example: EX_DOMAIN },
      amount: { type: "number", description: "Amount to pay, in currency (optional; used for rail minimums)", example: 0.01 },
      currency: { type: "string", description: "ISO currency of the price: USD (default), EUR, SEK… USDC counts as USD", example: "USD" },
      can: { type: "string", description: "Rails the buyer can pay on, comma-separated: x402, mpp, card, sepa-instant, swish (default all)", example: "x402,card" },
      network: { type: "string", description: "Only x402 rails on this network, e.g. base", example: "base" },
    },
    {
      domain: EX_DOMAIN, verdict: "partial",
      chosen: { rail: "x402", score: 70, final: true, chargebacks: false, instruction: { network: "base", asset: "USDC", payTo: "0x6293ded2684F1A76E26bEcef87c137D691Fbf800", amount: 0.01, how: "send USDC on this network to payTo" }, proof: "after paying: /x402/receipt?hash=<transaction hash> for a filed receipt", notes: ["0x6293ded2684F1A76E26bEcef87c137D691Fbf800 is declared but not proven by a signature"] },
      options: [], excluded: [{ rail: "x402", excluded: "on solana, not base" }],
      reasons: ["no registered business is declared, so the payee is a domain and its wallets, not a verified company"],
      attestation: { alg: "EdDSA", kid: "…", signature: "…" },
      note: "A plan tells your own wallet or payment provider what to do. Nothing is paid, routed or held by this service.",
    },
    async (env: Env, q) => {
      const domain = payeeDomain(need(q, "domain", 300));
      const rawAmount = opt(q, "amount", 30);
      const amount = rawAmount === undefined ? null : num(q, "amount", { min: 0, max: 1e9 });
      const currency = (opt(q, "currency", 10) ?? "USD").toUpperCase();
      if (!/^[A-Z]{3,4}$/.test(currency)) throw new HttpError(400, "currency must be an ISO code such as USD, EUR or SEK");
      const canRaw = opt(q, "can", 200);
      const can = canRaw ? canRaw.toLowerCase().split(/[\s,]+/).filter(Boolean).map((r) => (r === "sepa" ? "sepa-instant" : r)) : [...RAILS];
      const unknown = can.filter((r) => !(RAILS as readonly string[]).includes(r));
      if (unknown.length) throw new HttpError(400, `unknown rail ${unknown[0]}; known: ${RAILS.join(", ")}`);
      const network = opt(q, "network", 20)?.toLowerCase() ?? null;
      const { record } = await recordFor(env, domain, payeeDeps(env));
      const plan = planPayment(record, checkVerdict(record, [], false), { amount, currency, can: can as Rail[], network });
      return {
        domain, ...plan,
        attestation: record.status !== "none" ? await attest(record, env, ISSUER) : null,
        note: "A plan tells your own wallet or payment provider what to do. Nothing is paid, routed or held by this service.",
      };
    }),
];

export const __test = { planPayment };
