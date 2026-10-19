// Card credits over HTTP: the /credits pages, the API-key charge used by the paywall, and the MCP charge.
import { Hono, type Context, type Next } from "hono";
import { trialsEnabled, type Env } from "./env";
import { callerHash, utcDay } from "./free-calls";
import {
  CREDIT_PACKS, CheckoutError, apiKeyFrom, creditsFromMicros, hashCreditKey, newCreditKey, priceMicros, verifyCheckout,
} from "./credits";
import { prefersHtml } from "./negotiate";
import { markStage } from "./funnel";

type C = Context<{ Bindings: Env }>;
const ledger = (env: Env) => env.METRICS?.get(env.METRICS.idFromName("credits"));
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function creditsInfo(origin: string) {
  return {
    what: "Prepaid credits, paid by card through Stripe, for agents and people without a USDC wallet. 1 credit = $0.001, so every tool costs the same as with x402.",
    packs: CREDIT_PACKS.map((p) => ({ price: `$${p.usdCents / 100}`, credits: p.credits, buy: p.url })),
    afterPayment: `Stripe returns you to ${origin}/credits/claim, which shows your API key once the payment is confirmed. Reopening that page shows the same key.`,
    use: "Send the key with any tool call as `Authorization: Bearer adt_…` or `X-API-Key: adt_…` (HTTP GET or the MCP server at /mcp). No x402 payment is needed then.",
    charging: "The tool's price is taken before it runs and given back if the call fails (any 4xx or 5xx, or an MCP error). Responses carry X-Credits-Charged and X-Credits-Remaining.",
    balance: `${origin}/credits/balance with the same header.`,
    refunds: "Unused credits do not expire. For a refund of unused credits, write to the support address in /openapi.json.",
  };
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="robots" content="noindex"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 16px;color:#1b1b1b;background:#fff}code,pre{background:#f2f2f2;padding:.1rem .3rem;border-radius:4px;overflow-wrap:anywhere}pre{padding:.75rem;white-space:pre-wrap}a.buy{display:inline-block;margin:.25rem .5rem .25rem 0;padding:.5rem .9rem;border:1px solid #1b1b1b;border-radius:6px;text-decoration:none;color:inherit}@media (prefers-color-scheme:dark){body{background:#151515;color:#eee}code,pre{background:#262626}a.buy{border-color:#eee}}</style></head><body>${body}</body></html>`;
}

export const credits = new Hono<{ Bindings: Env }>();

credits.get("/credits", (c) => {
  const origin = new URL(c.req.url).origin;
  const info = creditsInfo(origin);
  if (!prefersHtml(c.req.header("accept"), c.req.header("user-agent"))) return c.json(info);
  const packs = info.packs.map((p) => `<a class="buy" href="${esc(p.buy)}">${p.price}: ${p.credits.toLocaleString("en-US")} credits</a>`).join("");
  return c.html(page("Pay by card: Agent Data Tools credits", `<h1>Pay by card</h1><p>${esc(info.what)}</p><p>${packs}</p>
<h2>After paying</h2><p>${esc(info.afterPayment)}</p><h2>Using the key</h2><pre>curl -H "Authorization: Bearer adt_…" "${esc(origin)}/eth/balance?address=0x…"</pre><p>${esc(info.charging)}</p><p>${esc(info.refunds)}</p><p>Prefer USDC? Every tool also takes x402 payments: see <a href="/llms.txt">llms.txt</a>.</p>`));
});

credits.get("/credits/claim", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const html = prefersHtml(c.req.header("accept"), c.req.header("user-agent"));
  const origin = new URL(c.req.url).origin;
  const store = ledger(c.env);
  try {
    if (!store) throw new CheckoutError(503, "credits are unavailable right now");
    const pack = await verifyCheckout(c.env.STRIPE_READ_KEY, c.req.query("session_id") ?? "");
    const key = newCreditKey();
    const issued = await store.issueCredits({ sessionId: c.req.query("session_id")!, credits: pack.credits, key, keyHash: await hashCreditKey(key) });
    const result = { apiKey: issued.key, creditsAdded: issued.credits, balanceCredits: creditsFromMicros(issued.balanceMicros), use: creditsInfo(origin).use };
    if (!html) return c.json(result);
    return c.html(page("Your API key", `<h1>Payment received</h1><p>${issued.credits.toLocaleString("en-US")} credits added. Your API key:</p><pre>${esc(issued.key)}</pre><p><strong>Save it now.</strong> Anyone with the key can spend its credits. Reopening this page shows the same key.</p><h2>Use it</h2><pre>curl -H "Authorization: Bearer ${esc(issued.key)}" "${esc(origin)}/eth/balance?address=0x4200000000000000000000000000000000000006"</pre><p>MCP clients: add the same header to the server at <code>${esc(origin)}/mcp</code>. Balance: <code>${esc(origin)}/credits/balance</code>.</p>`));
  } catch (err) {
    if (!(err instanceof CheckoutError)) throw err;
    if (!html) return c.json({ error: err.message }, err.status);
    return c.html(page("Credits", `<h1>Not ready</h1><p>${esc(err.message)}</p>`), err.status);
  }
});

credits.get("/credits/balance", async (c) => {
  const key = apiKeyFrom((n) => c.req.header(n));
  if (!key) return c.json({ error: "send your key as Authorization: Bearer adt_… or X-API-Key" }, 401);
  const store = ledger(c.env);
  if (!store) return c.json({ error: "credits are unavailable right now" }, 503);
  const account = await store.creditBalance(await hashCreditKey(key));
  if (!account) return c.json({ error: "unknown API key" }, 401);
  return c.json({ balanceCredits: creditsFromMicros(account.balanceMicros), purchasedCredits: creditsFromMicros(account.purchasedMicros), spentCredits: creditsFromMicros(account.spentMicros), calls: account.calls, since: account.createdAt });
});

/** Paywall branch for a request that carries an API key: spend, run, refund on failure. */
export async function chargeCredits(c: C, price: string, key: string, next: Next) {
  const store = ledger(c.env);
  if (!store) return c.json({ error: "credits are unavailable right now; pay with x402 instead. Not charged." }, 503);
  const keyHash = await hashCreditKey(key);
  const micros = priceMicros(price);
  const spent = await store.spendCredits(keyHash, micros);
  if (!spent.ok) {
    const origin = new URL(c.req.url).origin;
    return spent.reason === "unknown_key"
      ? c.json({ error: "unknown API key. Not charged.", buy: `${origin}/credits` }, 401)
      : c.json({ error: `not enough credits: this call costs ${creditsFromMicros(micros)}, the key has ${creditsFromMicros(spent.balanceMicros)}. Not charged.`, buy: `${origin}/credits` }, 402);
  }
  let remaining = spent.balanceMicros;
  try {
    await next();
  } catch (err) {
    await store.refundCredits(keyHash, micros);
    throw err;
  }
  if (c.res.status >= 400) {
    remaining = await store.refundCredits(keyHash, micros);
    c.res.headers.set("X-Credits-Charged", "0");
  } else {
    c.res.headers.set("X-Credits-Charged", String(creditsFromMicros(micros)));
    markStage("credits_call");
  }
  c.res.headers.set("X-Credits-Remaining", String(creditsFromMicros(remaining)));
}

/** One free call for this caller, or null. The returned refund gives it back when the tool fails. */
export async function useFreeCall(env: Env, ip: string | undefined) {
  const store = ledger(env);
  if (!store || !trialsEnabled(env)) return null;
  const caller = await callerHash(ip ?? "unknown");
  const day = utcDay();
  const left = await store.takeFreeCall(caller, day);
  return left === null ? null : { left, refund: () => store.refundFreeCall(caller, day) };
}

/** What an agent should relay to its user when its MCP client cannot pay with x402. */
export function paymentHint(origin: string, price: string) {
  return `PAYMENT NEEDED (${price} per successful call; failed calls are free). If your client cannot pay with x402 (USDC), tell your user: `
    + `buy a prepaid key by card at ${origin}/credits ($5 = 5,000 calls at $0.001), then add the header "Authorization: Bearer <key>" `
    + `to this MCP server's connection settings and retry. The key works for every tool on this server.`;
}

/** MCP: wraps a tool handler so a call with an API key spends credits; isError results are refunded. */
export function creditCharger(env: Env, key: string, price: string) {
  return async <R extends { isError?: boolean; content?: unknown[] }>(run: () => Promise<R>): Promise<R | { isError: true; content: { type: "text"; text: string }[] }> => {
    const store = ledger(env);
    const fail = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });
    if (!store) return fail("credits are unavailable right now; not charged");
    const keyHash = await hashCreditKey(key);
    const micros = priceMicros(price);
    const spent = await store.spendCredits(keyHash, micros);
    if (!spent.ok) return fail(spent.reason === "unknown_key" ? "unknown API key; not charged. Buy credits at /credits" : `not enough credits (${creditsFromMicros(spent.balanceMicros)} left, this call costs ${creditsFromMicros(micros)}); not charged. Buy more at /credits`);
    let result: R;
    try { result = await run(); } catch (err) { await store.refundCredits(keyHash, micros); throw err; }
    if (result.isError) await store.refundCredits(keyHash, micros);
    return result;
  };
}
