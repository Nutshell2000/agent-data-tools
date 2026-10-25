// Card credits over HTTP: the /credits pages, the API-key charge used by the paywall, and the MCP charge.
import { Hono, type Context, type Next } from "hono";
import { trialsEnabled, type Env } from "./env";
import { FREE_CALLS_PER_CALLER, callerHash, utcDay } from "./free-calls";



import {
  CREDIT_PACKS, WEB_PACKS, CheckoutError, apiKeyFrom, creditsFromMicros, hashCreditKey, newCreditKey, priceMicros, topUpLinks, verifyCheckout,
} from "./credits";
import { prefersHtml } from "./negotiate";
import { buyCreditsWithMpp, mppEnabled } from "./mpp-credits";
import { markStage } from "./funnel";

type C = Context<{ Bindings: Env }>;
const ledger = (env: Env) => env.METRICS?.get(env.METRICS.idFromName("credits"));
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/**
 * cardReady is false while STRIPE_READ_KEY is unset: /credits/claim cannot issue keys then, so no pack
 * is offered at all rather than taking a card payment we cannot fulfil yet.
 */
export function creditsInfo(origin: string, agentPurchase = false, cardReady = true): Record<string, unknown> & { use: string; what: string; afterPayment: string; charging: string; refunds: string; agentPurchase?: string; packs: { price: string; credits: number; buy: string }[] } {
  return {
    ...(agentPurchase ? { agentPurchase: `Agents with an MPP client and a Link agent wallet can buy a pack themselves, with no checkout page: GET ${origin}/credits/buy/1, /credits/buy/5, /credits/buy/20 or /credits/buy/100 answers 402 with a Stripe card challenge; pay it and the response carries the API key. To top up a key you already have, send it as X-API-Key on the same request.` } : {}),
    what: cardReady
      ? "Prepaid credits, paid by card through Stripe, for agents and people without a USDC wallet. 1 credit = $0.001, so every tool costs the same as with x402."
      : "Card payments are being set up and are not available yet, so no pack can be bought here today. Pay per call with x402 (USDC) in the meantime.",
    cardReady,
    packs: cardReady ? WEB_PACKS.map((p) => ({ price: `$${p.usdCents / 100}`, credits: p.credits, buy: p.url })) : [],
    afterPayment: `Stripe returns you to ${origin}/credits/claim, which shows your API key once the payment is confirmed. Reopening that page shows the same key.`,
    use: "Send the key with any tool call as `Authorization: Bearer adt_…` or `X-API-Key: adt_…` (HTTP GET or the MCP server at /mcp). In Claude, ChatGPT and other apps, add the connector /mcp/account and sign in with the key (or use /mcp/k/<key> where an app takes only a URL). No x402 payment is needed then.",
    charging: "The tool's price is taken before it runs and given back if the call fails (any 4xx or 5xx, or an MCP error). Responses carry X-Credits-Charged and X-Credits-Remaining.",
    balance: `${origin}/credits/balance with the same header.`,
    rotate: `Key leaked or shared by mistake? POST ${origin}/credits/rotate with the key: the balance moves to a new key and the old one stops working.`,
    refunds: "Unused credits do not expire. For a refund of unused credits, write to the support address in /openapi.json.",
  };
}

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
  const previews = [
    ["/check/counterparty", "Vet an address before paying it"],
    ["/extract", "Read a web page as clean text"],
    ["/price/token", "Price any token from its Uniswap pool"],
    ["/sanctions/check", "OFAC sanctions screening"],
  ].map(([path, label]) => `<li><a href="${path}?sample=1">${esc(label)}</a> <code>${path}</code></li>`).join("");
  return c.html(page("Pay by card: Agent Data Tools credits", `<h1>Pay by card</h1><p>${esc(info.what)} Try ${FREE_CALLS_PER_CALLER} calls free first; no card needed for those.</p><p>${packs}</p>
<h2>Use it in your AI app</h2><ul>
<li><b>Claude or ChatGPT:</b> add a custom connector with the URL <code>${esc(origin)}/mcp/account</code> and sign in with your key.</li>
<li><b>Cursor, Claude Code and other MCP clients:</b> connect to <code>${esc(origin)}/mcp</code> with the header <code>Authorization: Bearer adt_…</code>, or use <code>${esc(origin)}/mcp/k/&lt;key&gt;</code> where only a URL fits.</li>
<li><b>HTTP:</b> <code>curl -H "Authorization: Bearer adt_…" "${esc(origin)}/eth/balance?address=0x…"</code></li></ul>
<h2>See what you get (free previews)</h2><ul>${previews}</ul><p>All tools and prices: <a href="/#tools">catalog</a>.</p>
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
    const added = topUp ? await store.issueCredits({ sessionId: c.req.query("session_id")!, credits: pack.credits, key: null, keyHash: topUp }) : undefined;
    if (added) {
      const result = { toppedUp: true, creditsAdded: added.credits, balanceCredits: creditsFromMicros(added.balanceMicros), note: "Added to your existing key; keep using it as before." };
      if (!html) return c.json(result);
      return c.html(page("Credits added", `<h1>Payment received</h1><p>${added.credits.toLocaleString("en-US")} credits were added to your existing key. Balance: ${result.balanceCredits.toLocaleString("en-US")} credits.</p><p>Nothing to change: keep using the same key in your apps.</p>`));
    }
    const fresh = newCreditKey();
    const issued = await store.issueCredits({ sessionId: c.req.query("session_id")!, credits: pack.credits, key: fresh, keyHash: await hashCreditKey(fresh) });
    // A repeat claim returns the key stored for this session. Only a top-up session stores none,
    // and those are answered above, so this cannot show a key that was never issued.
    const key = issued.key;
    if (!key) throw new CheckoutError(400, "the key from this purchase was replaced, or the purchase topped up an existing key: use your current key (check it at /credits/balance)");
    const refill = topUpLinks(await hashCreditKey(key)).map((l) => `<a class="buy" href="${esc(l.buy)}">${l.price}: ${l.credits.toLocaleString("en-US")} credits</a>`).join("");
    const result = { apiKey: key, mcpUrl: `${origin}/mcp/k/${key}`, creditsAdded: issued.credits, balanceCredits: creditsFromMicros(issued.balanceMicros), use: creditsInfo(origin).use };
    if (!html) return c.json(result);
    return c.html(page("Your API key", `<h1>Payment received</h1><p>${issued.credits.toLocaleString("en-US")} credits added. Your API key:</p><pre>${esc(key)}</pre><p><strong>Save it now.</strong> Anyone with the key can spend its credits. Reopening this page shows the same key.</p><h2>Use it</h2><pre>curl -H "Authorization: Bearer ${esc(key)}" "${esc(origin)}/eth/balance?address=0x4200000000000000000000000000000000000006"</pre><h2>Use it in Claude, ChatGPT, Cursor and other AI apps</h2><p>Best: add a custom connector with <code>${esc(origin)}/mcp/account</code> and sign in with the key when the app asks. Or add this URL, which carries your key (keep it private):</p><pre>${esc(origin)}/mcp/k/${esc(key)}</pre><p>Clients that support headers can instead use <code>${esc(origin)}/mcp</code> with the header above. Balance: <code>${esc(origin)}/credits/balance</code>.</p><h2>Add credits to this key later</h2><p>These links top up this same key, so nothing in your apps changes. Bookmark this page; it keeps working.</p><p>${refill}</p>`));
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

credits.get("/credits/balance", async (c) => {
  const key = apiKeyFrom((n) => c.req.header(n));
  if (!key) return c.json({ error: "send your key as Authorization: Bearer adt_… or X-API-Key" }, 401);
  const store = ledger(c.env);
  if (!store) return c.json({ error: "credits are unavailable right now" }, 503);
  const keyHash = await hashCreditKey(key);
  const account = await store.creditBalance(keyHash);
  if (!account) return c.json({ error: "unknown API key" }, 401);
  return c.json({ balanceCredits: creditsFromMicros(account.balanceMicros), purchasedCredits: creditsFromMicros(account.purchasedMicros), spentCredits: creditsFromMicros(account.spentMicros), calls: account.calls, since: account.createdAt, topUp: topUpLinks(keyHash) });
});

/** Below this many credits (about 20 calls at $0.01) a key is "low"; the call that crosses it says so once. */
export const LOW_BALANCE_MICROS = 200_000;
/** True for the one successful call that takes the balance from at or above the threshold to below it. */
export const crossedLow = (before: number, after: number) => before >= LOW_BALANCE_MICROS && after < LOW_BALANCE_MICROS;

/** Paywall branch for a request that carries an API key: spend, run, refund on failure. */
export async function chargeCredits(c: C, price: string, key: string, next: Next) {
  const store = ledger(c.env);
  if (!store) return c.json({ error: "credits are unavailable right now; pay with x402 instead. Not charged." }, 503);
  const keyHash = await hashCreditKey(key);
  const micros = priceMicros(price);
  // The credit store can be out of its daily Durable Object quota: nothing is spent then, so say so and when to retry.
  const spent = await store.spendCredits(keyHash, micros).catch((e: unknown) => { console.error("credits: spend failed", e); return null; });
  if (!spent) return c.json({ error: "credits cannot be checked right now. Not charged; try again in a few minutes, or pay this call with x402." }, 503, { "Retry-After": "300" });
  if (!spent.ok) {
    const origin = new URL(c.req.url).origin;
    return spent.reason === "unknown_key"
      ? c.json({ error: "unknown API key. Not charged.", buy: `${origin}/credits` }, 401)
      : c.json({ error: `not enough credits: this call costs ${creditsFromMicros(micros)}, the key has ${creditsFromMicros(spent.balanceMicros)}. Not charged. Top up this key by card (no new key needed):`, topUp: topUpLinks(keyHash) }, 402);
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
export async function useFreeCall(env: Env, ip: string | undefined, onUnavailable?: () => void) {
  const store = ledger(env);
  if (!store || !trialsEnabled(env)) return null;
  const caller = await callerHash(ip ?? "unknown");
  const day = utcDay();
  // If the allowance cannot be counted (storage over its daily write limit), the caller gets the payment
  // request like any unpaid call instead of a 500, and onUnavailable lets the caller say why.
  const left = await store.takeFreeCall(caller, day).catch((err: unknown) => { console.error(`free calls: unavailable (${err instanceof Error ? err.message : err})`); return undefined; });
  if (left === undefined) { onUnavailable?.(); return null; }
  if (left === null) markStage("free_exhausted");
  return left === null ? null : { left, refund: () => store.refundFreeCall(caller, day) };
}

/** MCP initialize instructions: how calls are paid, so the model can plan and tell its user what to do. */
/** Where a newly bought key goes: signed-in connectors sign in again; others add a header or use the key URL. */
const keyPlacement = (origin: string, signedIn: boolean) => signedIn
  ? "then reconnect this connector and sign in with the key"
  : `and add the header "Authorization: Bearer <key>" to this server's connection settings (or, in apps that only take a URL, connect to ${origin}/mcp/k/<key>)`;

/** The tool for the common jobs, so a model does not have to read all tool descriptions to pick one. */
const PICK_BY_TASK = "Pick by task: an LLM answer, draft or chat turn → ai_chat (stronger model: ai_chat_large; OpenAI-compatible at /v1/chat/completions); embeddings → ai_embed; speech to text → transcribe; text to speech → ai_speech; an image from a prompt → image; what is in an image → describe; current information from the web → search, news; is it safe to pay an address → check_counterparty; OFAC only → sanctions_check; token price by ticker or address → price_token (many: price_tokens); a wallet's holdings in USD → wallet_portfolio (5 chains: wallet_balances); chain state on base, eth, arb, op or polygon → <chain>_balance, _token_balance (tickers work), _tx, _receipt, _logs, _gas, _block; read a web page → extract (JavaScript sites: extract_rendered); PDF → pdf_text; company → company; FX → fx; weather by city → weather. Smaller servers per section: /mcp/prices, /mcp/chain, /mcp/web, /mcp/compliance, /mcp/ai, /mcp/everyday, /mcp/utilities.";

export function mcpInstructions(origin: string, hasKey: boolean, toolCount: number, agentPurchase = false, signedIn = false) {
  const pay = signedIn
    ? (hasKey
      ? "You are signed in with a card-credit key: each successful call spends the tool's price from its credits (1 credit = $0.001); failed calls are refunded."
      : `You are signed in without credits: ${FREE_CALLS_PER_CALLER} free successful calls are included (not for the AI, rendering, screenshot, transcription and search tools); failed calls never count. After that, tools need credits, which the user can get at ${origin}/credits before reconnecting and signing in with the key.`)
    : hasKey
    ?"This connection carries a card-credit API key: each successful call spends the tool's price from it (1 credit = $0.001); failed calls are refunded. Balance: GET " + origin + "/credits/balance with the same header."
    : `Each caller gets ${FREE_CALLS_PER_CALLER} free successful calls, used automatically (not for the AI, rendering, screenshot, transcription and search tools); failed calls never count. Here they are counted per network address, which cloud apps such as Claude and ChatGPT share between users: there, ${origin}/mcp/account gives each person their own. `
      + `After that a call returns a payment request. If your client pays x402 (USDC on Base, Polygon, Arbitrum, Monad or World Chain) it can pay it. Otherwise tell your user they can buy a prepaid key by card at ${origin}/credits ($5 = 5,000 credits, about 500 calls at $0.01) ${keyPlacement(origin, signedIn)}.${agentPurchase ? ` If your client supports MPP with a Link agent wallet, it can buy a pack itself: GET ${origin}/credits/buy/5 (or /20, /100) and pay the 402; the response carries the key (send an existing key as X-API-Key to top it up instead).` : ""}`;
  return `Agent Data Tools: ${toolCount} pay-per-call tools: LLM chat and embeddings, speech to text and text to speech, image generation and description, web search and news, blockchain reads, token prices, sanctions and company checks, web and PDF text, weather, time, utilities. Most cost $0.01 per successful call. ${pay} Every tool's result shape is in its output schema. ${PICK_BY_TASK}`;
}

/** Server instructions for the ChatGPT plugin server: no prices, payment methods or links (ChatGPT plugin rules). */
export function directoryInstructions(hasKey: boolean, toolCount: number) {
  const plan = hasKey
    ? "This account has prepaid credits: each successful call uses some; failed calls never count."
    : `This account includes ${FREE_CALLS_PER_CALLER} free successful calls (not for the AI, rendering, screenshot, transcription and search tools); failed calls never count. When they are used up, tools answer that they are not available on the current plan.`;
  return `Agent Data Tools: ${toolCount} live data tools: LLM chat and embeddings, speech to text, image description, web search and news, blockchain reads, token prices, sanctions and company checks, web and PDF text, weather, time and utilities. ${plan} Every tool's result shape is in its output schema. ${DIRECTORY_PICK}`;
}
// The task guide without the generative-media tools (not on the signed-in servers) and without other server addresses.
const DIRECTORY_PICK = PICK_BY_TASK.replace(" (stronger model: ai_chat_large; OpenAI-compatible at /v1/chat/completions)", " (stronger model: ai_chat_large)")
  .replace("; text to speech → ai_speech", "").replace("; an image from a prompt → image", "").replace(/ Smaller servers per section:.*$/, "");

/** What an agent should relay to its user when its MCP client cannot pay with x402. */
export function paymentHint(origin: string, price: string, signedIn = false, cardReady = false) {
  // People reach this through an assistant (Claude, ChatGPT) with no USDC wallet: 12 of them ran out of free
  // MCP calls on 22 Oct and none bought, so the card checkout is offered as one link the assistant can show.
  const [starter] = WEB_PACKS;
  const card = cardReady
    ? `pay $${starter.usdCents / 100} by card in one step at ${starter.url} (Stripe; ${starter.credits.toLocaleString("en-US")} credits, about ${Math.floor(starter.credits / 10).toLocaleString("en-US")} calls at $0.01; the key is shown right after payment; other packs at ${origin}/credits) ${keyPlacement(origin, signedIn)}`
    : `buy a prepaid key by card at ${origin}/credits ($5 = 5,000 credits, about 500 calls at $0.01) ${keyPlacement(origin, signedIn)}`;
  return `PAYMENT NEEDED (${price} per successful call; failed calls are free). If your client cannot pay with x402 (USDC), tell your user: `
    + `${card}, and retry. The key works for every tool on this server.`
    // Cloud apps (Claude, ChatGPT) reach /mcp from shared addresses, so the per-address free calls may
    // already be used by someone else; signing in gives this person their own allowance.
    + (signedIn ? "" : ` In Claude, ChatGPT or another app that connects from the cloud, the free calls are shared with everyone behind the same address; connect to ${origin}/mcp/account instead and continue without a key to get your own ${FREE_CALLS_PER_CALLER} free calls.`);
}

/** MCP: wraps a tool handler so a call with an API key spends credits; isError results are refunded. */
export function creditCharger(env: Env, key: string, price: string, origin: string, directory = false) {
  return async <R extends { isError?: boolean; content?: unknown[] }>(run: () => Promise<R>): Promise<R | { isError: true; content: { type: "text"; text: string }[] }> => {
    const store = ledger(env);
    const fail = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });
    if (!store) return fail("credits are unavailable right now; not charged");
    const keyHash = await hashCreditKey(key);
    const micros = priceMicros(price);
    const spent = await store.spendCredits(keyHash, micros).catch((e: unknown) => { console.error("credits: spend failed", e); return null; });
    if (!spent) return fail("credits cannot be checked right now; not charged. Try again in a few minutes.");
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
