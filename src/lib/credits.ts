// Prepaid card credits: the second way to pay for tools, for agents and people without a USDC wallet.
// A Stripe payment link sells a pack; /credits/claim checks the Checkout Session with Stripe and issues
// an API key; each tool call then spends credits instead of an x402 payment. 1 credit = $0.001.
// The ledger lives in the Metrics Durable Object under the name "credits", so every spend is atomic.

export const CREDIT_KEY_PREFIX = "adt_";
export const MICROS_PER_CREDIT = 1000;

/** What each pack costs and gives. The Stripe payment links carry metadata adt_credits with the same number. */
export const CREDIT_PACKS = [
  { usdCents: 500, credits: 5_000, url: "https://buy.stripe.com/bJe4gz5ma1v99xMa33bII02" },
  { usdCents: 2_000, credits: 22_000, url: "https://buy.stripe.com/eVq3cv01Q3Dh4dsdffbII03" },
  { usdCents: 10_000, credits: 125_000, url: "https://buy.stripe.com/cNi8wP5ma6Pt8tI1wxbII04" },
] as const;

/**
 * Top-ups: a pack bought through a link carrying client_reference_id=topup_<key hash> adds its credits
 * to that existing key, so a buyer never has to reconfigure their apps with a new key. Only the
 * SHA-256 of the key travels through Stripe; anyone may pay into a key, nobody can spend from one.
 */
export const topUpReference = (keyHash: string) => `topup_${keyHash}`;
export const keyHashFromReference = (ref: unknown) => typeof ref === "string" && /^topup_[0-9a-f]{64}$/.test(ref) ? ref.slice(6) : undefined;
export const topUpLinks = (keyHash: string) => CREDIT_PACKS.map((p) => ({ price: `$${p.usdCents / 100}`, credits: p.credits, buy: `${p.url}?client_reference_id=${topUpReference(keyHash)}` }));

/** "$0.001" -> 1000 (USD micros). Throws on anything that is not a plain dollar price. */
export function priceMicros(price: string): number {
  const m = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec(price);
  if (!m) throw new Error(`not a dollar price: ${price}`);
  return Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
}

export const creditsFromMicros = (micros: number) => Math.round(micros / MICROS_PER_CREDIT * 1000) / 1000;

/** The API key from `Authorization: Bearer adt_…` (or a bare `adt_…`) or `X-API-Key: adt_…`, when it has our shape. */
export function apiKeyFrom(header: (name: string) => string | undefined): string | undefined {
  // MCP clients pass the Authorization value as typed, so accept the key with or without "Bearer ".
  const auth = /^(?:Bearer\s+)?(adt_\S+)$/i.exec((header("authorization") ?? "").trim())?.[1];
  const key = auth ?? header("x-api-key")?.trim();
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

interface Account { balanceMicros: number; purchasedMicros: number; spentMicros: number; calls: number; createdAt: string; sessions: string[] }
/** key is null for a top-up: the buyer already holds it and it is never seen here. */
interface SessionRecord { key: string | null; keyHash: string; credits: number; at: string }
interface Txn { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<boolean> }
export interface CreditStorage { transaction<T>(callback: (txn: Txn) => Promise<T>): Promise<T> }

const accountKey = (hash: string) => `credit:acct:${hash}`;
const sessionKey = (id: string) => `credit:session:${id}`;

/**
 * Credits a paid Checkout Session exactly once. A repeat claim of the same session returns the
 * key issued the first time, so a buyer who reloads the claim page sees the same key, never a second grant.
 * The raw key is kept with its session record for that reason; storage is private to this Worker.
 */
export async function issueCredits(storage: CreditStorage, grant: { sessionId: string; credits: number; key: string | null; keyHash: string }) {
  if (!Number.isSafeInteger(grant.credits) || grant.credits <= 0) throw new Error("invalid credit grant");
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
    await txn.put(accountKey(grant.keyHash), account);
    await txn.put(sessionKey(grant.sessionId), { key: grant.key, keyHash: grant.keyHash, credits: grant.credits, at } satisfies SessionRecord);
    return { key: grant.key, credits: grant.credits, balanceMicros: account.balanceMicros, repeated: false };
  });
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
    for (const id of account.sessions) {
      const record = await txn.get<SessionRecord>(sessionKey(id));
      if (record) await txn.put(sessionKey(id), { ...record, key: null, keyHash: newHash });
    }
    return { key: newKey, balanceMicros: account.balanceMicros };
  });
}

export type SpendResult = { ok: true; balanceMicros: number } | { ok: false; reason: "unknown_key" | "insufficient"; balanceMicros: number };

/** Takes the price before the tool runs; refundCredits gives it back if the call fails. */
export async function spendCredits(storage: CreditStorage, keyHash: string, micros: number): Promise<SpendResult> {
  if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error("invalid spend");
  return storage.transaction(async (txn) => {
    const account = await txn.get<Account>(accountKey(keyHash));
    if (!account) return { ok: false, reason: "unknown_key", balanceMicros: 0 };
    if (account.balanceMicros < micros) return { ok: false, reason: "insufficient", balanceMicros: account.balanceMicros };
    account.balanceMicros -= micros;
    account.spentMicros += micros;
    account.calls++;
    await txn.put(accountKey(keyHash), account);
    return { ok: true, balanceMicros: account.balanceMicros };
  });
}

export async function refundCredits(storage: CreditStorage, keyHash: string, micros: number): Promise<number> {
  return storage.transaction(async (txn) => {
    const account = await txn.get<Account>(accountKey(keyHash));
    if (!account) return 0;
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
    return a ? { balanceMicros: a.balanceMicros, purchasedMicros: a.purchasedMicros, spentMicros: a.spentMicros, calls: a.calls, createdAt: a.createdAt } : null;
  });
}

/** Checks a Checkout Session with Stripe and returns the credits it paid for. Throws CheckoutError otherwise. */
export class CheckoutError extends Error {
  constructor(public status: 400 | 402 | 404 | 502 | 503, message: string) { super(message); }
}

export const isCheckoutSessionId = (id: string) => /^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(id);

export interface PaidSession {
  id?: string; status?: string; payment_status?: string; currency?: string; amount_total?: number; mode?: string;
  metadata?: Record<string, string>; client_reference_id?: string | null;
}

/**
 * Reads a Checkout Session from Stripe and checks that it is a completed, paid one-time payment.
 * `query` adds expand[] parameters; `stripeVersion` pins a (preview) API version for fields such as
 * line_items.data.price.external_reference that agentic orders carry. Throws CheckoutError otherwise.
 */
export async function fetchPaidSession<T extends PaidSession = PaidSession>(stripeKey: string | undefined, sessionId: string, fetchImpl: typeof fetch = fetch, query = "", stripeVersion?: string): Promise<T> {
  if (!stripeKey) throw new CheckoutError(503, "card payments are being set up; your payment is safe and this link will work once they are. Keep this page's address.");
  if (!isCheckoutSessionId(sessionId)) throw new CheckoutError(400, "session_id is not a Stripe Checkout Session id");
  let res: Response;
  try {
    res = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${sessionId}${query ? `?${query}` : ""}`, {
      headers: { authorization: `Bearer ${stripeKey}`, ...(stripeVersion && { "stripe-version": stripeVersion }) },
    });
  } catch {
    throw new CheckoutError(502, "could not reach Stripe; reload this page in a minute");
  }
  if (res.status === 404) throw new CheckoutError(404, "no such checkout session");
  if (!res.ok) throw new CheckoutError(502, `Stripe answered ${res.status}; reload this page in a minute`);
  const s = await res.json() as T;
  if (s.mode !== "payment" || s.status !== "complete" || s.payment_status !== "paid") throw new CheckoutError(402, "this checkout is not paid yet");
  return s;
}

export async function verifyCheckout(stripeKey: string | undefined, sessionId: string, fetchImpl: typeof fetch = fetch) {
  const s = await fetchPaidSession(stripeKey, sessionId, fetchImpl);
  const pack = CREDIT_PACKS.find((p) => p.usdCents === s.amount_total && String(p.credits) === s.metadata?.adt_credits);
  if (s.currency !== "usd" || !pack) throw new CheckoutError(400, "this checkout is not a credits purchase");
  return { ...pack, topUpKeyHash: keyHashFromReference(s.client_reference_id) };
}
