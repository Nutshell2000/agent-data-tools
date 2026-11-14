// Card credits over HTTP: the /credits pages, the API-key charge used by the paywall, and the MCP charge.
import { Hono, type Context, type Next } from "hono";
import { trialsEnabled, type Env } from "./env";
import { FREE_CALLS_PER_CALLER, FREE_HTTP_CALLS_PER_CALLER, callerHash, utcDay } from "./free-calls";



import {
  CREDIT_PACKS, PLAN_PORTAL_URL, PLAN_SYNC_MS, WEB_PACKS, WEB_PLANS, CheckoutError, apiKeyFrom, callsAt, creditsFromMicros, hashCreditKey, newCreditKey, paidPlanInvoices, planLinks, priceMicros, topUpLinks, usdcPackList, usdcPrepayLine, utcMonth, verifyCheckout,
  type PlanRead, type SpendResult,
} from "./credits";
import { applyUnsavedCredits, buyCreditsWithUsdc } from "./usdc-credits";
import { prefersHtml } from "./negotiate";
import { buyCreditsWithMpp, mppEnabled } from "./mpp-credits";
import { markStage } from "./funnel";
import { REVIEW_CALLS_PER_DAY, REVIEW_CALLS_TOTAL_PER_DAY, REVIEW_MAX_PRICE, REVIEW_NOTE, isReviewKey, reviewAllows, reviewCaller } from "./review-keys";

type C = Context<{ Bindings: Env }>;
const ledger = (env: Env) => env.METRICS?.get(env.METRICS.idFromName("credits"));
type Ledger = NonNullable<ReturnType<typeof ledger>>;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A key that is out of credits reads its plan again at most this often, so a failing key cannot make us call Stripe per request. */
const PLAN_RETRY_MS = 60_000;
/** What the pages and answers say about the monthly plan. */
export const PLAN_TERMS = "A plan is a monthly top-up of one key: the credits are added when each month's payment succeeds, unused credits stay, and it renews until you cancel.";

/**
 * The monthly plan has no webhook: a key's paid renewals are read from Stripe here and their credits added once each
 * (lib/credits.ts `grantPlanInvoices`). `onlyStale` reads a plan only when its last read is older than PLAN_SYNC_MS.
 * Never throws; a read that fails grants nothing, and a stale read that fails is stamped so the next calls do not repeat it.
 * Returns the balance after the last grant, or undefined when nothing was read.
 */
async function syncPlans(env: Env, store: Ledger, keyHash: string, plans: PlanRead[], onlyStale: boolean): Promise<number | undefined> {
  let balance: number | undefined;
  for (const plan of plans) {
    const age = Date.now() - Date.parse(plan.syncedAt);
    if (age < (onlyStale ? PLAN_SYNC_MS : PLAN_RETRY_MS)) continue;
    try {
      const invoices = await paidPlanInvoices(env.STRIPE_READ_KEY, plan.subscriptionId);
      const granted = await store.grantPlanInvoices(keyHash, plan.subscriptionId, invoices ?? []);
      if (granted) balance = granted.balanceMicros;
      if (granted?.added) console.log(`credits: plan renewal, ${granted.added} credits added to key ${keyHash.slice(0, 12)}`);
    } catch (e) {
      console.error("credits: plan read failed", e);
    }
  }
  return balance;
}

/** Takes the price from a key. A key on the plan that is short gets its paid renewals applied first, then one more try. */
async function spendWithPlans(env: Env, store: Ledger, keyHash: string, micros: number, freeMonth?: string): Promise<SpendResult> {
  let spent: SpendResult = await store.spendCredits(keyHash, micros, freeMonth);
  if (!spent.plans) return spent;
  if (spent.ok) {
    const balance = await syncPlans(env, store, keyHash, spent.plans, true);
    return balance === undefined ? spent : { ...spent, balanceMicros: balance };
  }
  if (spent.reason === "insufficient" && await syncPlans(env, store, keyHash, spent.plans, false) !== undefined) spent = await store.spendCredits(keyHash, micros, freeMonth);
  return spent;
}

/**
 * cardReady is false while STRIPE_READ_KEY is unset: /credits/claim cannot issue keys then, so no pack
 * is offered at all rather than taking a card payment we cannot fulfil yet.
 */
export function creditsInfo(origin: string, agentPurchase = false, cardReady = true): Record<string, unknown> & { use: string; what: string; afterPayment: string; charging: string; refunds: string; agentPurchase?: string; packs: { price: string; credits: number; buy: string }[] } {
  return {
    ...(agentPurchase ? { agentPurchase: `Agents with an MPP client and a Link agent wallet can buy a pack themselves, with no checkout page: GET ${origin}/credits/buy/1, /credits/buy/5, /credits/buy/20 or /credits/buy/100 answers 402 with a Stripe card challenge; pay it and the response carries the API key. To top up a key you already have, send it as X-API-Key on the same request.` } : {}),
    what: cardReady
      ? "Prepaid credits, paid by card through Stripe, for agents and people without a USDC wallet. 1 credit = $0.001. A key pays the listed price of a tool or less: PDF reading costs 2 credits, and the tools that only compute (hashes, converters, calculators, validators, generators) cost 1 credit a call."
      : "Card payments are being set up and are not available yet, so no pack can be bought here today. Pay per call with x402 (USDC) in the meantime.",
    cardReady,
    usdc: { what: usdcPrepayLine(origin), packs: usdcPackList(origin), topUp: "Send a key you already hold as X-API-Key on the same request to add the credits to it." },
    packs: cardReady ? WEB_PACKS.map((p) => ({ price: `$${p.usdCents / 100}`, credits: p.credits, buy: p.url })) : [],
    // The monthly plan is offered only once its Stripe links and the cancel page exist (lib/credits.ts CREDIT_PLANS).
    ...(cardReady && WEB_PLANS.length ? { monthlyPlans: { what: PLAN_TERMS, plans: planLinks(), manageOrCancel: PLAN_PORTAL_URL } } : {}),
    afterPayment: `Stripe returns you to ${origin}/credits/claim, which shows your API key once the payment is confirmed. Reopening that page shows the same key.`,
    use: "Send the key with any tool call as `Authorization: Bearer adt_…` or `X-API-Key: adt_…` (HTTP GET or the MCP server at /mcp), or as `?api_key=adt_…` in the tool URL where a client can only fetch a URL. In Claude, ChatGPT and other apps, add the connector /mcp/account and sign in with the key (or use /mcp/k/<key> where an app takes only a URL). No x402 payment is needed then. A key that travels in URLs can end up in logs: rotate it at POST /credits/rotate if it was shared.",
    charging: "The tool's price is taken before it runs and given back if the call fails (any 4xx or 5xx, or an MCP error). Responses carry X-Credits-Charged and X-Credits-Remaining.",
    balance: `${origin}/credits/balance with the same header.`,
    rotate: `Key leaked or shared by mistake? POST ${origin}/credits/rotate with the key: the balance moves to a new key and the old one stops working.`,
    refunds: "Unused credits do not expire. For a refund of unused credits, write to the support address in /openapi.json.",
  };
}

/** What people buy elsewhere, with each tool's price in credits (tests/credit-jobs pins these to the catalog). */
export const CARD_JOBS = [
  { path: "/pdf/text", job: "Read a PDF as text", unit: "PDFs", credits: 2 },
  { path: "/extract", job: "Read a web page as clean text or Markdown", unit: "web pages", credits: 2 },
  { path: "/screenshot", job: "Screenshot a web page", unit: "screenshots", credits: 10 },
  { path: "/transcribe", job: "Transcribe an audio clip", unit: "audio clips", credits: 10 },
  { path: "/pack/website-audit", job: "Audit a website: uptime, SEO, security headers", unit: "website audits", credits: 10 },
  // One credit with a key (lib/key-prices.ts): the tools that only compute. /hash stands for all of them here.
  { path: "/hash", job: "Hash, convert, validate or calculate: about 100 tools that only compute", unit: "small jobs", credits: 1 },
];
const AGENT_JOBS = [
  { path: "/check/counterparty", job: "Vet an address before paying it" },
  { path: "/price/token", job: "Price any token from its Uniswap pool" },
  { path: "/sanctions/check", job: "OFAC sanctions screening" },
];

function page(title: string, body: string, indexable = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${indexable ? "" : `<meta name="robots" content="noindex">`}<style>body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 16px;color:#1b1b1b;background:#fff}code,pre{background:#f2f2f2;padding:.1rem .3rem;border-radius:4px;overflow-wrap:anywhere}pre{padding:.75rem;white-space:pre-wrap}a.buy{display:inline-block;margin:.25rem .5rem .25rem 0;padding:.5rem .9rem;border:1px solid #1b1b1b;border-radius:6px;text-decoration:none;color:inherit}@media (prefers-color-scheme:dark){body{background:#151515;color:#eee}code,pre{background:#262626}a.buy{border-color:#eee}}</style></head><body>${body}</body></html>`;
}

export const credits = new Hono<{ Bindings: Env }>();

credits.get("/credits", (c) => {
  const origin = new URL(c.req.url).origin;
  const info = creditsInfo(origin, mppEnabled(c.env), Boolean(c.env.STRIPE_READ_KEY));
  if (!prefersHtml(c.req.header("accept"), c.req.header("user-agent"))) return c.json(info);
  // Calls per pack at the most common price, so a buyer sees what the money gets.
  const calls = (credits: number) => Math.floor(credits / 10).toLocaleString("en-US");
  const packs = info.packs.map((p) => `<a class="buy" href="${esc(p.buy)}">${p.price}: ${p.credits.toLocaleString("en-US")} credits<br><small>about ${calls(p.credits)} calls at $0.01</small></a>`).join("");
  const previews = [...CARD_JOBS, ...AGENT_JOBS].map(({ path, job }) => `<li><a href="${path}?sample=1">${esc(job)}</a> <code>${path}</code></li>`).join("");
  const dollarBuys = CARD_JOBS.map(({ job, credits: cost, unit }) => `<li><strong>${Math.floor(1000 / cost).toLocaleString("en-US")} ${esc(unit)}</strong>: ${esc(job)}</li>`).join("");
  const planLinksHtml = info.cardReady ? planLinks().map((p) => `<a class="buy" href="${esc(p.buy)}">${esc(p.price)}: ${p.creditsEachMonth.toLocaleString("en-US")} credits each month<br><small>about ${calls(p.creditsEachMonth)} calls at $0.01</small></a>`).join("") : "";
  const plansHtml = planLinksHtml ? `<h2>Or a monthly plan</h2><p>${esc(PLAN_TERMS)}</p><p>${planLinksHtml}</p><p><a href="${esc(PLAN_PORTAL_URL)}">Manage or cancel a plan</a> at any time; Stripe asks for the e-mail you paid with.</p>` : "";
  return c.html(page("API credits by card: $1, no subscription", `<h1>$1, once. No subscription, no account, and credits never expire.</h1><p>What $1 buys:</p><ul>${dollarBuys}</ul><p>Failed calls are never charged. Try most tools free first, with no card: ${FREE_HTTP_CALLS_PER_CALLER} calls from a browser or plain HTTP, ${FREE_CALLS_PER_CALLER} through an AI app (MCP). ${esc(info.what)}</p><p>${packs}</p>${plansHtml}
<h2>Use it in your AI app</h2><ul>
<li><b>Claude or ChatGPT:</b> add a custom connector with the URL <code>${esc(origin)}/mcp/account</code> and sign in with your key.</li>
<li><b>Cursor, Claude Code and other MCP clients:</b> connect to <code>${esc(origin)}/mcp</code> with the header <code>Authorization: Bearer adt_…</code>, or use <code>${esc(origin)}/mcp/k/&lt;key&gt;</code> where only a URL fits.</li>
<li><b>HTTP:</b> <code>curl -H "Authorization: Bearer adt_…" "${esc(origin)}/eth/balance?address=0x…"</code></li>
<li><b>Fetch-only clients</b> (an agent's URL reader that cannot set headers): <code>${esc(origin)}/eth/balance?address=0x…&amp;api_key=adt_…</code>. A key in a URL can end up in logs; rotate it at <code>POST /credits/rotate</code> if it was shared.</li></ul>
<h2>See what you get (free previews)</h2><ul>${previews}</ul><p>All tools and prices: <a href="/#tools">catalog</a>.</p>
<h2>Agents with a USDC wallet: prepay once</h2><p>${esc(usdcPrepayLine(origin))} Packs: ${usdcPackList(origin).map((p) => `<code>${esc(p.buy.replace(origin, ""))}</code> ${p.price} = ${p.credits.toLocaleString("en-US")} credits`).join(", ")}. To top up a key, send it as <code>X-API-Key</code> on the same request.</p>
${info.agentPurchase ? `<h2>Agents: buy without a checkout page</h2><p>${esc(info.agentPurchase)}</p>` : ""}<h2>After paying</h2><p>${esc(info.afterPayment)}</p><h2>Charging and refunds</h2><p>${esc(info.charging)}</p><p>${esc(info.refunds)}</p><p>Prefer USDC? Every tool also takes x402 payments: see <a href="/llms.txt">llms.txt</a>. <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/support">Support</a></p>`, true));
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
    // A top-up link names an existing key by its hash; credits go to it and no new key is issued.
    // An unknown hash (mistyped link) falls back to a new key, so a payment is never lost.
    const topUp = pack.topUpKeyHash && await store.creditBalance(pack.topUpKeyHash) ? pack.topUpKeyHash : undefined;
    // A monthly plan: the same grant, plus the subscription on the key so its renewals are found (lib/credits.ts).
    const plan = pack.plan ? { plan: pack.plan } : {};
    const planNote = pack.plan ? { monthlyPlan: `${pack.credits.toLocaleString("en-US")} credits are added to this key each month when the payment renews. ${PLAN_TERMS}`, managePlan: PLAN_PORTAL_URL } : {};
    const planHtml = pack.plan ? `<h2>Your monthly plan</h2><p>${pack.credits.toLocaleString("en-US")} credits are added to this key each month when the payment renews. ${esc(PLAN_TERMS)} <a href="${esc(PLAN_PORTAL_URL)}">Manage or cancel the plan</a> (Stripe asks for the e-mail you paid with).</p>` : "";
    const added = topUp ? await store.issueCredits({ sessionId: c.req.query("session_id")!, credits: pack.credits, key: null, keyHash: topUp, ...plan }) : undefined;
    if (added) {
      const result = { toppedUp: true, creditsAdded: added.credits, balanceCredits: creditsFromMicros(added.balanceMicros), note: "Added to your existing key; keep using it as before.", ...planNote };
      if (!html) return c.json(result);
      return c.html(page("Credits added", `<h1>Payment received</h1><p>${added.credits.toLocaleString("en-US")} credits were added to your existing key. Balance: ${result.balanceCredits.toLocaleString("en-US")} credits.</p><p>Nothing to change: keep using the same key in your apps.</p>${planHtml}`));
    }
    const fresh = newCreditKey();
    const issued = await store.issueCredits({ sessionId: c.req.query("session_id")!, credits: pack.credits, key: fresh, keyHash: await hashCreditKey(fresh), ...plan });
    // A repeat claim returns the key stored for this session. Only a top-up session stores none,
    // and those are answered above, so this cannot show a key that was never issued.
    const key = issued.key;
    if (!key) throw new CheckoutError(400, "the key from this purchase was replaced, or the purchase topped up an existing key: use your current key (check it at /credits/balance)");
    const refill = topUpLinks(await hashCreditKey(key)).map((l) => `<a class="buy" href="${esc(l.buy)}">${l.price}: ${l.credits.toLocaleString("en-US")} credits</a>`).join("");
    const result = { apiKey: key, mcpUrl: `${origin}/mcp/k/${key}`, creditsAdded: issued.credits, balanceCredits: creditsFromMicros(issued.balanceMicros), use: creditsInfo(origin).use, ...planNote };
    if (!html) return c.json(result);
    return c.html(page("Your API key", `<h1>Payment received</h1><p>${issued.credits.toLocaleString("en-US")} credits added. Your API key:</p><pre>${esc(key)}</pre><p><strong>Save it now.</strong> Anyone with the key can spend its credits. Reopening this page shows the same key.</p><h2>Use it</h2><pre>curl -H "Authorization: Bearer ${esc(key)}" "${esc(origin)}/eth/balance?address=0x4200000000000000000000000000000000000006"</pre><h2>Use it in Claude, ChatGPT, Cursor and other AI apps</h2><p>Best: add a custom connector with <code>${esc(origin)}/mcp/account</code> and sign in with the key when the app asks. Or add this URL, which carries your key (keep it private):</p><pre>${esc(origin)}/mcp/k/${esc(key)}</pre><p>Clients that support headers can instead use <code>${esc(origin)}/mcp</code> with the header above. Balance: <code>${esc(origin)}/credits/balance</code>.</p>${planHtml}<h2>Add credits to this key later</h2><p>These links top up this same key, so nothing in your apps changes. Bookmark this page; it keeps working.</p><p>${refill}</p>`));
  } catch (err) {
    if (!(err instanceof CheckoutError)) throw err;
    if (!html) return c.json({ error: err.message }, err.status);
    return c.html(page("Credits", `<h1>Not ready</h1><p>${esc(err.message)}</p>`), err.status);
  }
});

// Agents with a Link wallet buy a pack themselves over MPP (lib/mpp-credits.ts). GET only, as OpenAPI declares it:
// directory probes (MPPScan) flag a paid POST or HEAD answer that has no input schema of its own.
const getOnly = (c: C) => c.json({ error: "use GET to buy a pack; not charged" }, 405, { Allow: "GET" });
credits.get("/credits/buy/:usd", async (c) => c.req.method === "HEAD" ? getOnly(c) : buyCreditsWithMpp(c));
credits.on(["POST", "PUT", "PATCH", "DELETE"], "/credits/buy/:usd", (c) => getOnly(c));

// Wallets prepay with USDC over x402 (lib/usdc-credits.ts): one payment, a key from the same ledger as the card packs.
credits.get("/credits/usdc/:usd", async (c) => c.req.method === "HEAD" ? getOnly(c) : buyCreditsWithUsdc(c));
credits.on(["POST", "PUT", "PATCH", "DELETE"], "/credits/usdc/:usd", (c) => getOnly(c));

// Replace a leaked key: POST with the current key; the balance moves to a new key and the old one stops working.
credits.post("/credits/rotate", async (c) => {
  c.header("Cache-Control", "no-store");
  const key = apiKeyFrom((n) => c.req.header(n));
  if (!key) return c.json({ error: "send the key to replace as Authorization: Bearer adt_… or X-API-Key" }, 401);
  const store = ledger(c.env);
  if (!store) return c.json({ error: "credits are unavailable right now; try again later" }, 503);
  const fresh = newCreditKey();
  const rotated = await store.rotateKey(await hashCreditKey(key), fresh, await hashCreditKey(fresh));
  if (!rotated) return c.json({ error: "unknown API key" }, 401);
  const origin = new URL(c.req.url).origin;
  return c.json({
    apiKey: rotated.key, mcpUrl: `${origin}/mcp/k/${rotated.key}`, balanceCredits: creditsFromMicros(rotated.balanceMicros),
    note: "The old key no longer works. Update your apps: sign in again on /mcp/account connectors, and replace the header or /mcp/k/ URL elsewhere. Save this key now; it is shown only here.",
  });
});

/**
 * One call of the day for a review key (lib/review-keys.ts), or why not: "price" (the tool is above the review ceiling),
 * "used" (the day is used up), "unavailable" (the counter cannot be reached). Nothing is written to the credit ledger.
 */
async function takeReviewCall(env: Env, keyHash: string, price: string): Promise<{ left: number; refund: () => Promise<void> } | "price" | "used" | "unavailable"> {
  if (!reviewAllows(price)) return "price";
  const store = ledger(env);
  if (!store) return "unavailable";
  const caller = reviewCaller(keyHash);
  const day = utcDay();
  const left = await store.takeDailyCall(caller, day, REVIEW_CALLS_PER_DAY, REVIEW_CALLS_TOTAL_PER_DAY).catch((e: unknown) => { console.error("review key: counter unavailable", e); return undefined; });
  if (left === undefined) return "unavailable";
  if (left === null) return "used";
  return { left, refund: () => store.refundDailyCall(caller, day).catch((e: unknown) => { console.error("review key: refund failed", e); }) };
}
const reviewRefusal = (why: "price" | "used" | "unavailable") => why === "price"
  ? `a review key runs tools priced up to ${REVIEW_MAX_PRICE}; this one costs more. Not charged.`
  : why === "used" ? `this review key has used its ${REVIEW_CALLS_PER_DAY} calls for today (UTC). Not charged.`
  : "the review key's counter cannot be read right now. Not charged; try again in a few minutes.";

credits.get("/credits/balance", async (c) => {
  const key = apiKeyFrom((n) => c.req.header(n));
  if (!key) return c.json({ error: "send your key as Authorization: Bearer adt_… or X-API-Key" }, 401);
  const store = ledger(c.env);
  if (!store) return c.json({ error: "credits are unavailable right now" }, 503);
  const keyHash = await hashCreditKey(key);
  if (isReviewKey(c.env, keyHash)) return c.json({ reviewKey: true, callsPerDay: REVIEW_CALLS_PER_DAY, maxPrice: REVIEW_MAX_PRICE, note: REVIEW_NOTE });
  // A USDC purchase whose credits could not be written when it settled is applied here (lib/usdc-credits.ts).
  await applyUnsavedCredits(c.env, keyHash).catch((e: unknown) => { console.error("credits: applying parked credits failed", e); });
  let account = await store.creditBalance(keyHash);
  if (!account) return c.json({ error: "unknown API key" }, 401);
  // A key on the monthly plan: apply any renewal Stripe has been paid for since the last read, then answer.
  if (account.plans && await syncPlans(c.env, store, keyHash, account.plans, false) !== undefined) account = await store.creditBalance(keyHash) ?? account;
  const monthly = account.plans?.length
    ? { monthlyPlan: { creditsEachMonth: account.plans.reduce((n, p) => n + p.credits, 0), since: account.plans[0].since, what: PLAN_TERMS, manageOrCancel: PLAN_PORTAL_URL } }
    : WEB_PLANS.length ? { monthlyPlans: planLinks(keyHash) } : {};
  return c.json({ balanceCredits: creditsFromMicros(account.balanceMicros), purchasedCredits: creditsFromMicros(account.purchasedMicros), spentCredits: creditsFromMicros(account.spentMicros), calls: account.calls, since: account.createdAt, ...(account.free ? { freeCalls: freeCallsView(account.free) } : {}), topUp: topUpLinks(keyHash), ...monthly });
});

export const FREE_KEY_NOTE = "A free key makes this many successful calls each calendar month (UTC); failed calls do not count. It does not cover web search, news, AI models, speech, images, browser rendering or screenshots: those need credits on the key.";
/** What a free key's allowance looks like to its holder: the month is UTC and a new one starts the count again. */
const freeCallsView = (free: { perMonth: number; month: string; used: number }) => {
  const used = free.month === utcMonth() ? free.used : 0;
  return { eachMonth: free.perMonth, usedThisMonth: used, leftThisMonth: Math.max(0, free.perMonth - used), note: FREE_KEY_NOTE };
};

/** Below this many credits (about 20 calls at $0.01) a key is "low"; the call that crosses it says so once. */
export const LOW_BALANCE_MICROS = 200_000;
/** True for the one successful call that takes the balance from at or above the threshold to below it. */
export const crossedLow = (before: number, after: number) => before >= LOW_BALANCE_MICROS && after < LOW_BALANCE_MICROS;

/** Paywall branch for a request that carries an API key: spend, run, refund on failure. */
export async function chargeCredits(c: C, price: string, key: string, next: Next, freeEligible = false) {
  const store = ledger(c.env);
  if (!store) return c.json({ error: "credits are unavailable right now; pay with x402 instead. Not charged." }, 503);
  const keyHash = await hashCreditKey(key);
  if (isReviewKey(c.env, keyHash)) {
    const call = await takeReviewCall(c.env, keyHash, price);
    if (typeof call === "string") return c.json({ error: reviewRefusal(call) }, call === "unavailable" ? 503 : call === "price" ? 402 : 429, call === "unavailable" ? { "Retry-After": "300" } : undefined);
    try { await next(); } catch (err) { await call.refund(); throw err; }
    if (c.res.status >= 400) await call.refund();
    c.res.headers.set("X-Credits-Charged", "0");
    c.res.headers.set("X-Review-Calls-Left", String(c.res.status >= 400 ? call.left + 1 : call.left));
    return;
  }
  const micros = priceMicros(price);
  // The credit store can be out of its daily Durable Object quota: nothing is spent then, so say so and when to retry.
  const spent = await spendWithPlans(c.env, store, keyHash, micros, freeEligible ? utcMonth() : undefined).catch((e: unknown) => { console.error("credits: spend failed", e); return null; });
  if (!spent) return c.json({ error: "credits cannot be checked right now. Not charged; try again in a few minutes, or pay this call with x402." }, 503, { "Retry-After": "300" });
  if (spent.ok && spent.free) {
    // One of a free key's monthly calls: nothing is spent, and a failed call gives it back.
    const giveBack = () => store.refundCredits(keyHash, 0, true).catch((e: unknown) => console.error("free key: giving a call back failed", keyHash.slice(0, 12), e));
    try { await next(); } catch (err) { await giveBack(); throw err; }
    const failed = c.res.status >= 400;
    if (failed) await giveBack(); else markStage("free_key_call");
    c.res.headers.set("X-Credits-Charged", "0");
    c.res.headers.set("X-Free-Calls-Left", String(failed ? spent.free.left + 1 : spent.free.left));
    return;
  }
  if (!spent.ok) {
    const origin = new URL(c.req.url).origin;
    return spent.reason === "unknown_key"
      ? c.json({ error: "unknown API key. Not charged.", buy: `${origin}/credits` }, 401)
      : c.json({ error: `not enough credits: this call costs ${creditsFromMicros(micros)}, the key has ${creditsFromMicros(spent.balanceMicros)}. Not charged. Top up this key by card (no new key needed):`, ...(spent.freeKey ? { freeKey: freeEligible ? "this free key has used its calls for this month (UTC); they start again next month, or add credits to keep going" : "a free key's monthly calls do not cover this tool; add credits to use it" } : {}), topUp: topUpLinks(keyHash) }, 402);
  }
  let remaining = spent.balanceMicros;
  try {
    await next();
  } catch (err) {
    await store.refundCredits(keyHash, micros).catch((e: unknown) => console.error("credits: refund failed; reconcile", keyHash.slice(0, 12), e));
    throw err;
  }
  if (c.res.status >= 400) {
    remaining = await store.refundCredits(keyHash, micros);
    c.res.headers.set("X-Credits-Charged", "0");
  } else {
    c.res.headers.set("X-Credits-Charged", String(creditsFromMicros(micros)));
    markStage("credits_call");
    if (crossedLow(remaining + micros, remaining)) c.res.headers.set("X-Credits-Low", `${creditsFromMicros(remaining)} credits left; top up this key: ${topUpLinks(keyHash)[0].buy}`);
  }
  c.res.headers.set("X-Credits-Remaining", String(creditsFromMicros(remaining)));
}

/** One free call for this caller, or null. The returned refund gives it back when the tool fails. */
export async function useFreeCall(env: Env, ip: string | undefined, onUnavailable?: () => void, limit: number = FREE_CALLS_PER_CALLER) {
  const store = ledger(env);
  if (!store || !trialsEnabled(env)) return null;
  const caller = await callerHash(ip ?? "unknown");
  const day = utcDay();
  // If the allowance cannot be counted (storage over its daily write limit), the caller gets the payment
  // request like any unpaid call instead of a 500, and onUnavailable lets the caller say why.
  const left = await store.takeFreeCall(caller, day, limit).catch((err: unknown) => { console.error(`free calls: unavailable (${err instanceof Error ? err.message : err})`); return undefined; });
  if (left === undefined) { onUnavailable?.(); return null; }
  if (left === null) markStage("free_exhausted");
  return left === null ? null : { left, refund: () => store.refundFreeCall(caller, day) };
}

/**
 * One call of the day for a signed-in ChatGPT user (lib/free-calls.ts takeDailyCall), or null when the user or the day
 * is used up. Not tied to TRIALS_ENABLED: inside ChatGPT this allowance is the whole product.
 */
export async function useDailyCall(env: Env, caller: string, perCaller: number, total: number, onUnavailable?: () => void) {
  const store = ledger(env);
  if (!store) { onUnavailable?.(); return null; }
  const hash = await callerHash(caller);
  const day = utcDay();
  const left = await store.takeDailyCall(hash, day, perCaller, total).catch((err: unknown) => { console.error(`daily calls: unavailable (${err instanceof Error ? err.message : err})`); return undefined; });
  if (left === undefined) { onUnavailable?.(); return null; }
  if (left === null) markStage("free_exhausted");
  return left === null ? null : { left, refund: () => store.refundDailyCall(hash, day) };
}

/** MCP initialize instructions: how calls are paid, so the model can plan and tell its user what to do. */
/** Where a newly bought key goes: signed-in connectors sign in again; others add a header or use the key URL. */
const keyPlacement = (origin: string, signedIn: boolean) => signedIn
  ? "then reconnect this connector and sign in with the key"
  : `and add the header "Authorization: Bearer <key>" to this server's connection settings (or, in apps that only take a URL, connect to ${origin}/mcp/k/<key>)`;

/** The tool for the common jobs, so a model does not have to read all tool descriptions to pick one. */
const PICK_BY_TASK = "Pick by task: an LLM answer, draft or chat turn → ai_chat (stronger model: ai_chat_large; OpenAI-compatible at /v1/chat/completions); embeddings → ai_embed; speech to text → transcribe; text to speech → ai_speech (up to 2,000 characters: text_to_speech); an image from a prompt → image; what is in an image → describe; current information from the web → search, news; is it safe to pay an address → check_counterparty; OFAC only → sanctions_check; token price by ticker or address → price_token (many: price_tokens); a wallet's holdings in USD → wallet_portfolio (5 chains: wallet_balances); chain state on base, eth, arb, op or polygon → <chain>_balance, _token_balance (tickers work), _tx, _receipt, _logs, _gas, _block; read a web page → extract (JavaScript sites: extract_rendered); PDF → pdf_text; company → company; FX → fx; weather by city → weather; several checks on one input in one call → pack_website_audit, pack_token_analysis, pack_wallet_profile, pack_coin_research, pack_domain_intel. Smaller servers per section: /mcp/prices, /mcp/chain, /mcp/web, /mcp/compliance, /mcp/ai, /mcp/everyday, /mcp/utilities. Three tools for the whole catalog (find a tool, read its inputs, call it): /mcp/compact.";

export function mcpInstructions(origin: string, hasKey: boolean, toolCount: number, agentPurchase = false, signedIn = false) {
  const pay = signedIn
    ? (hasKey
      ? "You are signed in with a card-credit key: each successful call spends the tool's price from its credits (1 credit = $0.001); failed calls are refunded."
      : `You are signed in without credits: ${FREE_CALLS_PER_CALLER} free successful calls are included (not for the image, speech, rendering, screenshot, transcription, search and large-model tools); failed calls never count. After that, tools need credits, which the user can get at ${origin}/credits before reconnecting and signing in with the key.`)
    : hasKey
    ?"This connection carries a card-credit API key: each successful call spends the tool's price from it (1 credit = $0.001); failed calls are refunded. Balance: GET " + origin + "/credits/balance with the same header."
    : `Each caller gets ${FREE_CALLS_PER_CALLER} free successful calls, used automatically (not for the image, speech, rendering, screenshot, transcription, search and large-model tools); failed calls never count. Here they are counted per network address, which cloud apps such as Claude and ChatGPT share between users: there, ${origin}/mcp/account gives each person their own. `
      + `After that a call returns a payment request. If your client pays x402 (USDC on Base, Polygon, Arbitrum or Solana) or MPP (Tempo) it can pay it, or prepay once: GET ${origin}/credits/usdc/5 with x402 returns a key worth 5,000 credits for later calls. Otherwise tell your user they can buy a prepaid key by card at ${origin}/credits (from $1 = 1,000 credits, about 100 calls at $0.01) ${keyPlacement(origin, signedIn)}.${agentPurchase ? ` If your client supports MPP with a Link agent wallet, it can buy a pack itself: GET ${origin}/credits/buy/5 (or /20, /100) and pay the 402; the response carries the key (send an existing key as X-API-Key to top it up instead).` : ""}`;
  // The signed-in server has the directory tool set (mcp.ts): no generative media, no web search or news.
  const kinds = signedIn ? DIRECTORY_KINDS : "LLM chat and embeddings, speech to text and text to speech, image generation and description, web search and news, blockchain reads, token prices, sanctions and company checks, web and PDF text, weather, time, utilities";
  return `Agent Data Tools: ${toolCount} pay-per-call tools: ${kinds}. Most cost $0.01 per successful call. ${pay} Every tool's result shape is in its output schema. ${signedIn ? DIRECTORY_PICK : PICK_BY_TASK}`;
}

/** Server instructions for the ChatGPT plugin server: no prices, payment methods or links (ChatGPT plugin rules). */
export function directoryInstructions(toolCount: number, callsPerDay: number) {
  return `Agent Data Tools: ${toolCount} read-only lookups of public data: sanctions screening and company records (OFAC, LEI, SEC filings), domains, DNS and website checks, text of PDFs and feeds, software packages and repositories, public blockchain balances, transactions and token prices, currency rates, economic statistics, weather, time and public holidays. Every tool only reads or computes: nothing is bought, sent, signed or changed. Each signed-in user can make ${callsPerDay} calls a day; failed calls do not count. Every tool's result shape is in its output schema. Pick by task: is an address or a name on the OFAC list → sanctions_check; a company → company, lei_lookup, sec_filings; a domain → domain, dns_lookup; is a site up, where it redirects, its headers or its SEO → url_uptime, url_redirects, http_security_headers, seo_audit; the text of a PDF → pdf_text; an RSS or Atom feed → feed; a software package → package, package_audit; a repository → github_repo; a wallet's balances → wallet_balances, wallet_portfolio; a token price → price_token; a transaction → eth_tx, base_tx; currency conversion → fx; weather by city → weather; the time in a zone → time.`;
}// What the signed-in directory servers offer (mcp.ts leaves out generative media and the Brave search tools there).
const DIRECTORY_KINDS = "LLM chat and embeddings, speech to text, image description, blockchain reads, token prices, sanctions and company checks, web and PDF text, weather, time and utilities";
// The task guide without the tools the signed-in servers leave out and without other server addresses.
const DIRECTORY_PICK = PICK_BY_TASK.replace(" (stronger model: ai_chat_large; OpenAI-compatible at /v1/chat/completions)", " (stronger model: ai_chat_large)")
  .replace("; text to speech → ai_speech (up to 2,000 characters: text_to_speech)", "").replace("; an image from a prompt → image", "").replace("; current information from the web → search, news", "").replace(/ Smaller servers per section:.*$/, "");

/** What an agent should relay to its user when its MCP client cannot pay with x402. */
export function paymentHint(origin: string, price: string, signedIn = false, cardReady = false) {
  // People reach this through an assistant (Claude, ChatGPT) with no USDC wallet: 12 of them ran out of free
  // MCP calls on 22 Oct and none bought, so the card checkout is offered as one link the assistant can show.
  const [starter] = WEB_PACKS;
  const card = cardReady
    ? `pay $${starter.usdCents / 100} by card in one step at ${starter.url} (Stripe; ${starter.credits.toLocaleString("en-US")} credits, about ${callsAt(starter.credits, price)} calls at ${price}; the key is shown right after payment; other packs at ${origin}/credits) ${keyPlacement(origin, signedIn)}`
    : `buy a prepaid key by card at ${origin}/credits (from $1 = 1,000 credits, about ${callsAt(1000, price)} calls at ${price}) ${keyPlacement(origin, signedIn)}`;
  return `PAYMENT NEEDED (${price} per successful call; failed calls are free). If your client cannot pay with x402 (USDC), tell your user: `
    + `${card}, and retry. The key works for every tool on this server; a client that can only fetch a URL adds it as &api_key=adt_… to the tool URL.`
    // Cloud apps (Claude, ChatGPT) reach /mcp from shared addresses, so the per-address free calls may
    // already be used by someone else; signing in gives this person their own allowance.
    + (signedIn ? "" : ` In Claude, ChatGPT or another app that connects from the cloud, the free calls are shared with everyone behind the same address; connect to ${origin}/mcp/account instead and continue without a key to get your own ${FREE_CALLS_PER_CALLER} free calls.`);
}

/** MCP: wraps a tool handler so a call with an API key spends credits; isError results are refunded. */
export function creditCharger(env: Env, key: string, price: string, origin: string, directory = false, freeEligible = false) {
  return async <R extends { isError?: boolean; content?: unknown[] }>(run: () => Promise<R>): Promise<R | { isError: true; content: { type: "text"; text: string }[] }> => {
    const store = ledger(env);
    const fail = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });
    if (!store) return fail("credits are unavailable right now; not charged");
    const keyHash = await hashCreditKey(key);
    if (isReviewKey(env, keyHash)) {
      const call = await takeReviewCall(env, keyHash, price);
      if (typeof call === "string") return fail(reviewRefusal(call));
      let reviewed: R;
      try { reviewed = await run(); } catch (err) { await call.refund(); throw err; }
      if (reviewed.isError) await call.refund();
      return reviewed;
    }
    const micros = priceMicros(price);
    const spent = await spendWithPlans(env, store, keyHash, micros, freeEligible ? utcMonth() : undefined).catch((e: unknown) => { console.error("credits: spend failed", e); return null; });
    if (!spent) return fail("credits cannot be checked right now; not charged. Try again in a few minutes.");
    if (spent.ok && spent.free) {
      // One of a free key's monthly calls: nothing is spent, and a failed call gives it back.
      const giveBack = () => store.refundCredits(keyHash, 0, true).catch((e: unknown) => console.error("free key: giving a call back failed", keyHash.slice(0, 12), e));
      let free: R;
      try { free = await run(); } catch (err) { await giveBack(); throw err; }
      if (free.isError) await giveBack();
      return free;
    }
    // The ChatGPT plugin server may not link to checkout: say the tool is not available on the current balance.
    if (!spent.ok && directory) return fail(spent.reason === "unknown_key"
      ? "this account's credits could not be found; sign in again. Nothing was charged."
      : `not enough credits on this account (${creditsFromMicros(spent.balanceMicros)} left, this call needs ${creditsFromMicros(micros)}), so this tool is not available on the current balance. Nothing was charged.`);
    if (!spent.ok) return fail(spent.reason === "unknown_key"
      ? `unknown API key; not charged. Buy credits at ${origin}/credits`
      : `not enough credits (${creditsFromMicros(spent.balanceMicros)} left, this call costs ${creditsFromMicros(micros)}); not charged. Tell your user to top up this same key by card, with nothing to reconfigure: ${topUpLinks(keyHash).map((l) => `${l.price} (${l.credits.toLocaleString("en-US")} credits): ${l.buy}`).join(" · ")}${mppEnabled(env) ? `. If your client pays MPP with a Link agent wallet, it can top up itself: GET ${origin}/credits/buy/5 with this key as X-API-Key.` : ""}`);
    let result: R;
    const refund = () => store.refundCredits(keyHash, micros).catch((e: unknown) => console.error("credits: refund failed; reconcile", keyHash.slice(0, 12), e));
    try { result = await run(); } catch (err) { await refund(); throw err; }
    if (result.isError) await refund();
    else if (crossedLow(spent.balanceMicros + micros, spent.balanceMicros)) {
      // Said once, on the call that crosses the line, so the agent can warn its user before calls stop.
      const links = topUpLinks(keyHash).map((l) => `${l.price}: ${l.buy}`).join(" · ");
      return { ...result, content: [...(result.content ?? []), { type: "text", text: `Credits running low: ${creditsFromMicros(spent.balanceMicros)} left on this key. Tell your user they can top up the same key by card (nothing to reconfigure): ${links}` }] };
    }
    return result;
  };
}
