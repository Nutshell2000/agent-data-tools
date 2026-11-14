// Prepaid card credits: the second way to pay for tools, for agents and people without a USDC wallet.
// A Stripe payment link sells a pack; /credits/claim checks the Checkout Session with Stripe and issues
// an API key; each tool call then spends credits instead of an x402 payment. 1 credit = $0.001.
// The ledger lives in the Metrics Durable Object under the name "credits", so every spend is atomic.

export const CREDIT_KEY_PREFIX = "adt_";
export const MICROS_PER_CREDIT = 1000;

/**
 * What each pack costs and gives. The Stripe payment links carry metadata adt_credits with the same number.
 * The $1 pack (25 Oct 2026, the owner's decision: a first card step cheaper than $5 for the people who land on a tool page) is
 * sold over MPP at /credits/buy/1; its Stripe payment link ($1.00 USD, metadata adt_credits=1000, success URL
 * /credits/claim?session_id={CHECKOUT_SESSION_ID}, automatic tax off so the total stays $1.00) was created on 25 Oct.
 */
export const CREDIT_PACKS = [
  { usdCents: 100, credits: 1_000, url: "https://buy.stripe.com/fZufZhdSGgq3bFU5MNbII06" },
  { usdCents: 500, credits: 5_000, url: "https://buy.stripe.com/bJe4gz5ma1v99xMa33bII02" },
  { usdCents: 2_000, credits: 22_000, url: "https://buy.stripe.com/eVq3cv01Q3Dh4dsdffbII03" },
  { usdCents: 10_000, credits: 125_000, url: "https://buy.stripe.com/cNi8wP5ma6Pt8tI1wxbII04" },
] as const;

/**
 * The packs a wallet can buy with USDC over x402 (lib/usdc-credits.ts; 10 Nov 2026, the owner's decision: $1, $5 and $20
 * with the same credits as the card packs, so the $20 pack carries the same 10% bonus). The $100 pack stays card-only.
 */
export const USDC_PACKS = CREDIT_PACKS.filter((p) => p.usdCents <= 2_000);
export const usdcPackPath = (p: { usdCents: number }) => `/credits/usdc/${p.usdCents / 100}`;
/** The packs as data for /credits and catalogs. */
export const usdcPackList = (origin: string) => USDC_PACKS.map((p) => ({ price: `$${p.usdCents / 100}`, credits: p.credits, buy: `${origin}${usdcPackPath(p)}`, pay: "x402 (USDC)" }));
/** One sentence for hints: where a wallet prepays and what it gets. The $5 pack leads; the others are named. */
export const usdcPrepayLine = (origin: string) => {
  const lead = USDC_PACKS.find((p) => p.usdCents === 500) ?? USDC_PACKS[0];
  const others = USDC_PACKS.filter((p) => p !== lead).map((p) => `$${p.usdCents / 100}`).join(" or ");
  return `Calling often with a wallet? Prepay once: GET ${origin}${usdcPackPath(lead)} with your x402 client ($${lead.usdCents / 100} USDC for ${lead.credits.toLocaleString("en-US")} credits; ${others} at ${origin}/credits/usdc/<amount>) returns an API key. Send it as Authorization: Bearer on later calls and they need no payment each.`;
};

/**
 * Top-ups: a pack bought through a link carrying client_reference_id=topup_<key hash> adds its credits
 * to that existing key, so a buyer never has to reconfigure their apps with a new key. Only the
 * SHA-256 of the key travels through Stripe; anyone may pay into a key, nobody can spend from one.
 */
export const topUpReference = (keyHash: string) => `topup_${keyHash}`;
export const keyHashFromReference = (ref: unknown) => typeof ref === "string" && /^topup_[0-9a-f]{64}$/.test(ref) ? ref.slice(6) : undefined;
/** The packs with a Stripe checkout page: what browsers, hints and top-up lists show. MPP sells every pack. */
/** How many calls a pack pays for at a tool's price, for hints (1 credit = $0.001). */
export const callsAt = (credits: number, price: string) => Math.floor(credits / Math.round(Number(price.slice(1)) * 1000)).toLocaleString("en-US");
export const WEB_PACKS = CREDIT_PACKS.filter((p) => (p.url as string) !== "");
export const topUpLinks = (keyHash: string) => WEB_PACKS.map((p) => ({ price: `$${p.usdCents / 100}`, credits: p.credits, buy: `${p.url}?client_reference_id=${topUpReference(keyHash)}` }));

/** "$0.001" -> 1000 (USD micros). Throws on anything that is not a plain dollar price. */
export function priceMicros(price: string): number {
  const m = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec(price);
  if (!m) throw new Error(`not a dollar price: ${price}`);
  return Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
}

export const creditsFromMicros = (micros: number) => Math.round(micros / MICROS_PER_CREDIT * 1000) / 1000;

/**
 * The API key from `Authorization: Bearer adt_…` (or a bare `adt_…`) or `X-API-Key: adt_…`, when it has our shape; with
 * `query`, also from `?api_key=adt_…`. The query form exists for clients that can only fetch a URL (31 Oct 2026: Keenable's
 * and Exa's page readers made 1,200 free /pdf/text and /extract calls a day for their agents and then hit the limit with no
 * way to send a header). A key in a URL can land in logs, so /credits says to rotate a key that was shared.
 */
export function apiKeyFrom(header: (name: string) => string | undefined, query?: (name: string) => string | undefined): string | undefined {
  // MCP clients pass the Authorization value as typed, so accept the key with or without "Bearer ".
  const auth = /^(?:Bearer\s+)?(adt_\S+)$/i.exec((header("authorization") ?? "").trim())?.[1];
  const key = auth ?? header("x-api-key")?.trim() ?? query?.("api_key")?.trim();
  return key && isCreditKey(key) ? key : undefined;
}

export const isCreditKey = (key: string) => /^adt_[A-Za-z0-9_-]{32,64}$/.test(key);

export function newCreditKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return CREDIT_KEY_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashCreditKey(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The monthly plan (the owner, 11 Nov 2026: "$9 a month for 15,000 credits and $19 a month for 40,000 credits, with unused
 * credits kept"; no free allowance; she creates the Stripe objects herself). A plan is an automatic monthly top-up of one
 * key: a Stripe subscription whose every paid invoice adds the plan's credits to the same ledger the packs use, so credits
 * never expire and nothing else about a key changes. Each payment link is a recurring price with metadata adt_credits
 * equal to `credits`, automatic tax off, success URL /credits/claim?session_id={CHECKOUT_SESSION_ID}.
 * A plan with an empty `url` is not offered anywhere; while both are empty the service behaves exactly as before.
 * `PLAN_PORTAL_URL` is Stripe's customer portal login link, where a subscriber cancels; plans are offered only when it is set.
 * No webhook: renewals are read from Stripe when the key is used (lib/credit-routes.ts `syncPlan`), which needs read
 * access to Invoices on STRIPE_READ_KEY. The portal must not allow switching plans: a renewal grants the credits of the
 * plan the key was bought with.
 */
// The links were created on 11 Nov 2026 in the owner's Stripe account on her instruction ("you do it all"): payment links
// plink_1UaY2EDhGrPcm8Sc0Ng5cNSZ ($9) and plink_1UaY2NDhGrPcm8ScJrv9YvFo ($19), recurring monthly in USD, automatic tax
// off like the packs, metadata adt_credits 15000 and 40000, redirect to /credits/claim. The portal link is the account's
// default portal configuration: cancel at the end of the period on, switching plans and changing quantity off.
export const CREDIT_PLANS = [
  { usdCents: 900, credits: 15_000, url: "https://buy.stripe.com/4gMbJ19Cq8XBbFU5MNbII07" },
  { usdCents: 1_900, credits: 40_000, url: "https://buy.stripe.com/fZu7sLdSG0r5dO22ABbII08" },
] as const;
export const PLAN_PORTAL_URL: string = "https://billing.stripe.com/p/login/dRm28r15U4Hl9xMfnnbII00";
export const WEB_PLANS = PLAN_PORTAL_URL === "" ? [] : CREDIT_PLANS.filter((p) => (p.url as string) !== "");
export const planLinks = (keyHash?: string) => WEB_PLANS.map((p) => ({ price: `$${p.usdCents / 100} a month`, creditsEachMonth: p.credits, buy: keyHash ? `${p.url}?client_reference_id=${topUpReference(keyHash)}` : p.url }));
/** How long a key's plan may go unread before a call reads Stripe again for a paid renewal. */
export const PLAN_SYNC_MS = 12 * 3_600_000;

interface PlanState { subscriptionId: string; credits: number; since: string; syncedAt: string }
/** A free key's monthly allowance of calls (14 Nov 2026): `used` counts this `month` (UTC, "2026-11") and starts again in the next. */
export interface FreeAllowance { emailHash: string; perMonth: number; month: string; used: number }
interface Account { balanceMicros: number; purchasedMicros: number; spentMicros: number; calls: number; createdAt: string; sessions: string[]; plans?: PlanState[]; free?: FreeAllowance }
/** key is null for a top-up: the buyer already holds it and it is never seen here. */
interface SessionRecord { key: string | null; keyHash: string; credits: number; at: string }
interface Txn { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<boolean> }
export interface CreditStorage { transaction<T>(callback: (txn: Txn) => Promise<T>): Promise<T> }

const accountKey = (hash: string) => `credit:acct:${hash}`;
const sessionKey = (id: string) => `credit:session:${id}`;
/** One record per subscription invoice whose credits were granted, so a renewal is never granted twice. */
const invoiceKey = (id: string) => `credit:invoice:${id}`;
/** One record per confirmed e-mail address (its hash), so an address gets one free key however often it signs up. */
const freeKey = (emailHash: string) => `credit:free:${emailHash}`;
interface FreeRecord { key: string | null; keyHash: string; at: string }
const isInvoiceId = (id: unknown): id is string => typeof id === "string" && /^in_[A-Za-z0-9]{8,200}$/.test(id);
const isSubscriptionId = (id: unknown): id is string => typeof id === "string" && /^sub_[A-Za-z0-9]{8,200}$/.test(id);

/**
 * Credits a paid Checkout Session exactly once. A repeat claim of the same session returns the
 * key issued the first time, so a buyer who reloads the claim page sees the same key, never a second grant.
 * The raw key is kept with its session record for that reason; storage is private to this Worker.
 */
export async function issueCredits(storage: CreditStorage, grant: { sessionId: string; credits: number; key: string | null; keyHash: string; plan?: { subscriptionId: string; invoiceId: string } }) {
  if (!Number.isSafeInteger(grant.credits) || grant.credits <= 0) throw new Error("invalid credit grant");
  if (grant.plan && !(isSubscriptionId(grant.plan.subscriptionId) && isInvoiceId(grant.plan.invoiceId))) throw new Error("invalid plan grant");
  return storage.transaction(async (txn) => {
    const existing = await txn.get<SessionRecord>(sessionKey(grant.sessionId));
    if (existing) {
      const account = await txn.get<Account>(accountKey(existing.keyHash));
      return { key: existing.key, credits: existing.credits, balanceMicros: account?.balanceMicros ?? 0, repeated: true };
    }
    const at = new Date().toISOString();
    const micros = grant.credits * MICROS_PER_CREDIT;
    const account: Account = (await txn.get<Account>(accountKey(grant.keyHash)))
      ?? { balanceMicros: 0, purchasedMicros: 0, spentMicros: 0, calls: 0, createdAt: at, sessions: [] };
    account.balanceMicros += micros;
    account.purchasedMicros += micros;
    account.sessions.push(grant.sessionId);
    if (grant.plan) {
      // The checkout paid the subscription's first invoice: mark it granted, so the first renewal read does not add it again.
      // A key can hold more than one subscription (a second checkout into the same key): each grants its own credits.
      const subscriptionId = grant.plan.subscriptionId;
      account.plans = [...(account.plans ?? []).filter((p) => p.subscriptionId !== subscriptionId), { subscriptionId, credits: grant.credits, since: at, syncedAt: at }];
      await txn.put(invoiceKey(grant.plan.invoiceId), { keyHash: grant.keyHash, credits: grant.credits, at });
    }
    await txn.put(accountKey(grant.keyHash), account);
    await txn.put(sessionKey(grant.sessionId), { key: grant.key, keyHash: grant.keyHash, credits: grant.credits, at } satisfies SessionRecord);
    return { key: grant.key, credits: grant.credits, balanceMicros: account.balanceMicros, repeated: false };
  });
}

/**
 * Adds the plan's credits once for each paid invoice of the key's subscription that has not been granted yet, and
 * stamps the read. Returns null when the key has no plan or the subscription is not the key's own.
 */
export async function grantPlanInvoices(storage: CreditStorage, keyHash: string, subscriptionId: string, invoiceIds: string[]) {
  return storage.transaction(async (txn) => {
    const account = await txn.get<Account>(accountKey(keyHash));
    const plan = account?.plans?.find((p) => p.subscriptionId === subscriptionId);
    if (!account || !plan) return null;
    const at = new Date().toISOString();
    const micros = plan.credits * MICROS_PER_CREDIT;
    let added = 0;
    for (const id of [...new Set(invoiceIds)].filter(isInvoiceId).slice(0, 36)) {
      if (await txn.get(invoiceKey(id))) continue;
      account.balanceMicros += micros;
      account.purchasedMicros += micros;
      account.sessions.push(id);
      await txn.put(invoiceKey(id), { keyHash, credits: plan.credits, at });
      // A renewal is a purchase into an existing key: it shows as a top-up in the card-credit summary.
      await txn.put(sessionKey(id), { key: null, keyHash, credits: plan.credits, at } satisfies SessionRecord);
      added += plan.credits;
    }
    plan.syncedAt = at;
    await txn.put(accountKey(keyHash), account);
    return { added, balanceMicros: account.balanceMicros };
  });
}

/** The ids of a subscription's paid invoices, newest first, or null when Stripe could not be read (nothing is granted then). */
export async function paidPlanInvoices(stripeKey: string | undefined, subscriptionId: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  if (!stripeKey || !isSubscriptionId(subscriptionId)) return null;
  let res: Response;
  try {
    res = await fetchImpl(`https://api.stripe.com/v1/invoices?subscription=${subscriptionId}&status=paid&limit=36`, { headers: { authorization: `Bearer ${stripeKey}` } });
  } catch {
    return null;
  }
  if (!res.ok) { console.warn(`credits: Stripe answered ${res.status} for a plan's invoices (STRIPE_READ_KEY needs read access to Invoices)`); return null; }
  const body = await res.json().catch(() => null) as { data?: { id?: unknown; status?: unknown; amount_paid?: unknown }[] } | null;
  if (!Array.isArray(body?.data)) return null;
  // A zero invoice (a trial, a full discount) pays for nothing.
  return body.data.filter((i) => isInvoiceId(i.id) && i.status === "paid" && typeof i.amount_paid === "number" && i.amount_paid > 0).map((i) => i.id as string);
}

/**
 * Card-credit sales and use, for the revenue scorecard: totals over every key plus purchases per
 * day. Aggregates only; no key, hash or session id leaves this function. Owner test purchases, if
 * any were made, are included and must be subtracted by hand.
 */
export async function creditSummary(storage: { list<T>(options: { prefix: string }): Promise<Map<string, T>> }) {
  const accounts = [...(await storage.list<Account>({ prefix: "credit:acct:" })).values()];
  const sessions = [...(await storage.list<SessionRecord>({ prefix: "credit:session:" })).values()];
  const perDay: Record<string, { purchases: number; credits: number }> = {};
  for (const s of sessions) {
    const day = (perDay[s.at.slice(0, 10)] ??= { purchases: 0, credits: 0 });
    day.purchases++;
    day.credits += s.credits;
  }
  const sum = (pick: (a: Account) => number) => accounts.reduce((n, a) => n + pick(a), 0);
  return {
    purchases: sessions.length,
    // Repeat purchases into an existing key (top-up links): the clearest sign buyers keep paying.
    topUps: sessions.filter((s) => s.key === null).length,
    buyers: accounts.filter((a) => a.purchasedMicros > 0).length,
    purchasedUsd: sum((a) => a.purchasedMicros) / 1e6,
    spentUsd: sum((a) => a.spentMicros) / 1e6,
    balanceUsd: sum((a) => a.balanceMicros) / 1e6,
    creditCalls: sum((a) => a.calls),
    activeBuyers: accounts.filter((a) => a.calls > 0).length,
    perDay,
  };
}

/**
 * Replaces a key: the balance and history move to the new key and the old one stops working at once.
 * Purchase records stop showing the old key (a claim page reload then says the key was replaced), so a
 * leaked claim URL does not leak the new key either. Returns null for an unknown key.
 */
export async function rotateKey(storage: CreditStorage, oldHash: string, newKey: string, newHash: string) {
  return storage.transaction(async (txn) => {
    const account = await txn.get<Account>(accountKey(oldHash));
    if (!account || oldHash === newHash) return null;
    await txn.put(accountKey(newHash), account);
    await txn.delete(accountKey(oldHash));
    // A free key's e-mail record follows the account and stops showing the old key.
    if (account.free) await txn.put(freeKey(account.free.emailHash), { key: null, keyHash: newHash, at: new Date().toISOString() } satisfies FreeRecord);
    for (const id of account.sessions) {
      const record = await txn.get<SessionRecord>(sessionKey(id));
      if (record) await txn.put(sessionKey(id), { ...record, key: null, keyHash: newHash });
    }
    return { key: newKey, balanceMicros: account.balanceMicros };
  });
}

/** `plans` is present for a key on the monthly plan: which subscriptions, and when their invoices were last read. */
export type PlanRead = { subscriptionId: string; syncedAt: string };
export type SpendResult = { ok: true; balanceMicros: number; plans?: PlanRead[]; free?: { left: number; perMonth: number } } | { ok: false; reason: "unknown_key" | "insufficient"; balanceMicros: number; plans?: PlanRead[]; freeKey?: boolean };
const planRead = (a: Account): { plans?: PlanRead[] } => a.plans?.length ? { plans: a.plans.map((p) => ({ subscriptionId: p.subscriptionId, syncedAt: p.syncedAt })) } : {};

/** Takes the price before the tool runs; refundCredits gives it back if the call fails. */
export async function spendCredits(storage: CreditStorage, keyHash: string, micros: number, freeMonth?: string): Promise<SpendResult> {
  if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error("invalid spend");
  return storage.transaction(async (txn) => {
    const account = await txn.get<Account>(accountKey(keyHash));
    if (!account) return { ok: false, reason: "unknown_key", balanceMicros: 0 };
    // A free key's monthly calls come first, for a tool they cover (the caller passes the month only then): nothing is spent.
    if (account.free && freeMonth) {
      if (account.free.month !== freeMonth) { account.free.month = freeMonth; account.free.used = 0; }
      if (account.free.used < account.free.perMonth) {
        account.free.used++;
        account.calls++;
        await txn.put(accountKey(keyHash), account);
        return { ok: true, balanceMicros: account.balanceMicros, free: { left: account.free.perMonth - account.free.used, perMonth: account.free.perMonth }, ...planRead(account) };
      }
    }
    if (account.balanceMicros < micros) return { ok: false, reason: "insufficient", balanceMicros: account.balanceMicros, ...(account.free ? { freeKey: true } : {}), ...planRead(account) };
    account.balanceMicros -= micros;
    account.spentMicros += micros;
    account.calls++;
    await txn.put(accountKey(keyHash), account);
    return { ok: true, balanceMicros: account.balanceMicros, ...planRead(account) };
  });
}

export async function refundCredits(storage: CreditStorage, keyHash: string, micros: number, freeCall = false): Promise<number> {
  return storage.transaction(async (txn) => {
    const account = await txn.get<Account>(accountKey(keyHash));
    if (!account) return 0;
    if (freeCall) {
      // A failed call that used one of the month's free calls gives it back; no credits moved.
      if (account.free && account.free.used > 0) account.free.used--;
      account.calls--;
      await txn.put(accountKey(keyHash), account);
      return account.balanceMicros;
    }
    account.balanceMicros += micros;
    account.spentMicros -= micros;
    account.calls--;
    await txn.put(accountKey(keyHash), account);
    return account.balanceMicros;
  });
}

export async function creditBalance(storage: CreditStorage, keyHash: string) {
  return storage.transaction(async (txn) => {
    const a = await txn.get<Account>(accountKey(keyHash));
    return a ? { balanceMicros: a.balanceMicros, purchasedMicros: a.purchasedMicros, spentMicros: a.spentMicros, calls: a.calls, createdAt: a.createdAt, ...(a.plans?.length ? { plans: a.plans.map((p) => ({ ...p })) } : {}), ...(a.free ? { free: { perMonth: a.free.perMonth, month: a.free.month, used: a.free.used } } : {}) } : null;
  });
}

/** Checks a Checkout Session with Stripe and returns the credits it paid for. Throws CheckoutError otherwise. */
export class CheckoutError extends Error {
  constructor(public status: 400 | 402 | 404 | 502 | 503, message: string) { super(message); }
}

export async function verifyCheckout(stripeKey: string | undefined, sessionId: string, fetchImpl: typeof fetch = fetch) {
  if (!stripeKey) throw new CheckoutError(503, "card payments are being set up; your payment is safe and this link will work once they are. Keep this page's address.");
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(sessionId)) throw new CheckoutError(400, "session_id is not a Stripe Checkout Session id");
  let res: Response;
  try {
    res = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, { headers: { authorization: `Bearer ${stripeKey}` } });
  } catch {
    throw new CheckoutError(502, "could not reach Stripe; reload this page in a minute");
  }
  if (res.status === 404) throw new CheckoutError(404, "no such checkout session");
  if (!res.ok) throw new CheckoutError(502, `Stripe answered ${res.status}; reload this page in a minute`);
  const s = await res.json() as { status?: string; payment_status?: string; currency?: string; amount_total?: number; mode?: string; metadata?: Record<string, string>; client_reference_id?: string | null; currency_conversion?: { amount_total?: number; source_currency?: string } | null; subscription?: unknown; invoice?: unknown };
  if ((s.mode !== "payment" && s.mode !== "subscription") || s.status !== "complete" || s.payment_status !== "paid") throw new CheckoutError(402, "this checkout is not paid yet");
  // Adaptive Pricing (on for the account): a buyer outside the US pays in their own currency, and the session then
  // carries that currency at the top level and the USD price in currency_conversion. Judge the pack on the USD price.
  const cc = s.currency_conversion;
  const usdTotal = cc?.source_currency === "usd" && typeof cc.amount_total === "number" ? cc.amount_total : s.currency === "usd" ? s.amount_total : undefined;
  const topUpKeyHash = keyHashFromReference(s.client_reference_id);
  if (s.mode === "subscription") {
    // The monthly plan: the checkout paid the subscription's first invoice. Renewals are read later (paidPlanInvoices).
    const plan = CREDIT_PLANS.find((p) => p.usdCents === usdTotal && String(p.credits) === s.metadata?.adt_credits);
    if (usdTotal === undefined || !plan || !isSubscriptionId(s.subscription) || !isInvoiceId(s.invoice)) throw new CheckoutError(400, "this checkout is not a credits plan");
    return { usdCents: plan.usdCents as number, credits: plan.credits as number, topUpKeyHash, plan: { subscriptionId: s.subscription, invoiceId: s.invoice } };
  }
  const pack = CREDIT_PACKS.find((p) => p.usdCents === usdTotal && String(p.credits) === s.metadata?.adt_credits);
  if (usdTotal === undefined || !pack) throw new CheckoutError(400, "this checkout is not a credits purchase");
  return { usdCents: pack.usdCents as number, credits: pack.credits as number, topUpKeyHash, plan: undefined };
}

// What a prepaid key pays where that is less than the tool's public price (the owner, 10 Nov 2026: "I meant only that low
// price for our regular buyer to entice it into buying"). The one large direct demand we have is a web caller reading
// hundreds of PDFs a day on free calls; a caller cannot be identified, but the way a caller pays can: a prepaid key is
// what a web user buys, and wallets and routers paying per call keep the public price. Entry paths are listed with their tool.
// These are the tools named one by one. lib/key-prices.ts adds the one-credit price of the tools that only compute and is
// where every caller reads a key price (`keyPrice`, `keyPriceFor`, `keyPriceLine`): it needs the catalog, which this
// file must not import (the catalog reaches this file through lib/env.ts and metrics.ts).
export const KEY_PRICES: Readonly<Record<string, string>> = { "/pdf/text": "$0.002", "/pdf/extract": "$0.002" };

/** Calls a free key may make each calendar month (UTC). The owner, 14 Nov 2026: "Yes, 100 a month". */
export const FREE_KEY_CALLS = 100;
export const utcMonth = (now = new Date()) => now.toISOString().slice(0, 7);

/**
 * The free key of one confirmed e-mail address, made on first use. A repeat for the same address returns the same key
 * (or `key: null` once it was rotated), never a second one. It is an ordinary key in the same ledger with a monthly
 * allowance of calls and no credits: credits bought later go to it like to any key. Not a purchase: no session record,
 * so the card-sales summary does not count it.
 */
export async function issueFreeKey(storage: CreditStorage, grant: { emailHash: string; key: string; keyHash: string; perMonth: number; month: string }) {
  if (!/^[0-9a-f]{64}$/.test(grant.emailHash) || !Number.isSafeInteger(grant.perMonth) || grant.perMonth <= 0) throw new Error("invalid free key grant");
  return storage.transaction(async (txn) => {
    const existing = await txn.get<FreeRecord>(freeKey(grant.emailHash));
    if (existing) {
      const account = await txn.get<Account>(accountKey(existing.keyHash));
      return { key: existing.key, repeated: true, perMonth: account?.free?.perMonth ?? grant.perMonth };
    }
    const at = new Date().toISOString();
    const account: Account = { balanceMicros: 0, purchasedMicros: 0, spentMicros: 0, calls: 0, createdAt: at, sessions: [], free: { emailHash: grant.emailHash, perMonth: grant.perMonth, month: grant.month, used: 0 } };
    await txn.put(accountKey(grant.keyHash), account);
    await txn.put(freeKey(grant.emailHash), { key: grant.key, keyHash: grant.keyHash, at } satisfies FreeRecord);
    return { key: grant.key, repeated: false, perMonth: grant.perMonth };
  });
}
