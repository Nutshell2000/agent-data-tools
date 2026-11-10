// Prepaid credits bought with USDC over x402 (1.110.0, 10 Nov 2026; the owner's decision: $1, $5 and $20 packs with
// the card packs' bonuses). Why: a wallet that paid us was a stranger again on its next call: every call a new signature and
// a new on-chain settlement (which costs us $0.001 above 1,000 a month, half the price of a $0.002 call), and only card
// buyers could hold a balance. Explorer and task wallets do buy top-ups elsewhere ($2 and $1 purchases seen that week).
// One x402 payment here returns an API key from the same ledger the card packs use (lib/credits.ts), so the key pays every
// tool over HTTP and MCP with no payment per call.
//
// Order of events, and why: the x402 library runs the handler first and settles after it. A handler that granted
// credits could be left unpaid by a settlement that fails (the buyer moves the funds between verify and settle), which
// for a top-up of an existing key would be free credits. So the handler grants nothing; the credits are written only
// after the library has returned a successful settlement, keyed by the settlement transaction so a repeat cannot grant twice.
import type { Context, MiddlewareHandler } from "hono";
import { paymentMiddleware } from "@x402/hono";
import type { RouteConfig } from "@x402/core/server";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import type { Env } from "./env";
import { USDC_PACKS, apiKeyFrom, creditsFromMicros, hashCreditKey, newCreditKey, usdcPackList, usdcPackPath } from "./credits";
import { paymentOptions, priceOn, NETWORK_NAMES } from "./networks";
import { resourceServer } from "./payments";
import { builderCodeExtension } from "./bazaar-extension";
import { paymentInfo } from "./payment-info";
import { markStage } from "./funnel";
import { SERVICE_ICON_URL } from "../endpoints";

type C = Context<{ Bindings: Env }>;
type Pack = (typeof USDC_PACKS)[number];

const usd = (p: Pack) => p.usdCents / 100;
const packOf = (param: string | undefined) => USDC_PACKS.find((p) => String(usd(p)) === param);

/** What the listing says (Bazaar limit 500 characters; no instruction to the reader beyond "use when"). */
export const usdcPackDescription = (p: Pack) =>
  `Prepaid API credits for Agent Data Tools, paid once in USDC: returns an API key worth ${p.credits.toLocaleString("en-US")} credits (1 credit = $0.001) that pays any of the service's tools over HTTP (Authorization: Bearer) or MCP, with no payment signature per call. Failed calls are refunded and credits never expire. Use when an agent will make many calls and wants one payment instead of one per call. An existing key in the X-API-Key header is topped up instead of a new key being issued.`;

const example = (origin: string, p: Pack) => ({
  apiKey: "adt_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample0",
  mcpUrl: `${origin}/mcp/k/adt_EXAMPLEexampleEXAMPLEexampleEXAMPLEexample0`,
  creditsAdded: p.credits,
  balanceCredits: p.credits,
  toppedUp: false,
  use: "Send the key as Authorization: Bearer <key> (or X-API-Key) on any tool call or MCP connection.",
});

function routes(env: Env): Record<string, RouteConfig> {
  return Object.fromEntries(USDC_PACKS.map((p): [string, RouteConfig] => [
    `GET ${usdcPackPath(p)}`,
    {
      accepts: paymentOptions(env).map(({ network, payTo }) => ({ scheme: "exact" as const, price: priceOn(network, `$${usd(p)}`), network, payTo })),
      description: usdcPackDescription(p),
      mimeType: "application/json",
      serviceName: `API credits, prepaid $${usd(p)}`,
      iconUrl: SERVICE_ICON_URL,
      tags: ["api-credits", "prepaid", "api-key", "top-up", "credits"],
      extensions: {
        ...declareDiscoveryExtension({ input: {}, inputSchema: { properties: {} }, output: { example: example("https://example.com", p) } }),
        ...builderCodeExtension(),
      },
    },
  ]));
}

/** OpenAPI entries, so x402 directories that read /openapi.json list the packs next to the tools. */
export function usdcCreditOpenApiPaths() {
  return Object.fromEntries(USDC_PACKS.map((p) => [usdcPackPath(p), {
    get: {
      operationId: `buy-credits-usdc-${usd(p)}`,
      summary: `Prepay ${p.credits.toLocaleString("en-US")} tool credits with $${usd(p)} USDC (x402)`,
      description: usdcPackDescription(p),
      tags: ["credits"],
      "x-payment-info": paymentInfo({ amount: usd(p).toFixed(2) }, []),
      parameters: [{ name: "X-API-Key", in: "header", required: false, description: "Optional existing adt_ key to top up instead of creating a new one", schema: { type: "string", pattern: "^adt_[A-Za-z0-9_-]{20,}$" } }],
      responses: {
        "200": {
          description: "Credits issued; a new key is shown only in this response",
          content: { "application/json": { schema: { type: "object", properties: {
            apiKey: { type: "string", description: "New adt_ key (absent on a top-up)" },
            mcpUrl: { type: "string", description: "MCP connector URL with the key embedded (absent on a top-up)" },
            creditsAdded: { type: "integer" }, balanceCredits: { type: "number" }, toppedUp: { type: "boolean" },
            paid: { type: "object", properties: { network: { type: "string" }, transaction: { type: "string" } } },
            use: { type: "string" },
          } } } },
        },
        "402": { description: "Payment Required (x402 v2: PAYMENT-REQUIRED header, exact scheme, USDC)" },
      },
    },
  }]));
}

// Cached like the tools' gateway: only one whose first request finished.
let gateway: MiddlewareHandler | undefined;
const unsavedKey = (keyHash: string, sessionId: string) => `credit-unsaved:${keyHash}:${sessionId}`;

/**
 * Credits that were paid for but could not be written at the time (the credit store was unavailable right after the
 * settlement). The grant waits in KV under the key's hash and is applied here; issueCredits is idempotent on the
 * settlement, so applying it twice adds nothing. Called from /credits/balance, where a buyer looks first.
 */
export async function applyUnsavedCredits(env: Env, keyHash: string): Promise<number> {
  const kv = env.TRIALS, store = env.METRICS?.get(env.METRICS.idFromName("credits"));
  if (!kv || !store) return 0;
  const listed = await kv.list({ prefix: `credit-unsaved:${keyHash}:` }).catch(() => null);
  let applied = 0;
  for (const { name } of listed?.keys ?? []) {
    const grant = await kv.get<{ sessionId: string; credits: number }>(name, "json").catch(() => null);
    if (!grant || !Number.isSafeInteger(grant.credits) || grant.credits <= 0) continue;
    await store.issueCredits({ sessionId: grant.sessionId, credits: grant.credits, key: null, keyHash });
    await kv.delete(name);
    applied += grant.credits;
  }
  return applied;
}

export async function buyCreditsWithUsdc(c: C): Promise<Response> {
  c.header("Cache-Control", "no-store");
  const pack = packOf(c.req.param("usd"));
  const origin = new URL(c.req.url).origin;
  if (!pack) return c.json({ error: `unknown pack; use one of: ${USDC_PACKS.map((p) => usdcPackPath(p)).join(", ")}. Not charged.` }, 404);
  const store = c.env.METRICS?.get(c.env.METRICS.idFromName("credits"));
  if (!store || c.env.PAYWALL === "off") return c.json({ error: `Prepaid credits are unavailable right now. Not charged; pay per call with x402 meanwhile, or buy a pack by card at ${origin}/credits.` }, 503, { "Retry-After": "300" });
  // A buyer that already holds a key names it in X-API-Key: the pack tops that key up. An unknown key is refused before
  // any payment is verified, and a payment is only taken while the credit store answers.
  const existing = apiKeyFrom((n) => c.req.header(n));
  const topUpHash = existing ? await hashCreditKey(existing) : undefined;
  const paying = Boolean(c.req.header("payment-signature"));
  let known: unknown = null;
  if (topUpHash || paying) {
    try { known = await store.creditBalance(topUpHash ?? "health-check"); } catch (e) {
      console.error("usdc credits: credit store unavailable before payment", e);
      return c.json({ error: "Credit storage is unavailable right now. Not charged; try again in a few minutes." }, 503, { "Retry-After": "300" });
    }
  }
  if (topUpHash && !known) return c.json({ error: "unknown API key in X-API-Key; remove it to buy a new key. Not charged." }, 401);

  let ran = false;
  const inner = async () => { ran = true; c.res = Response.json({ pending: true }); };
  let candidate = gateway ?? paymentMiddleware(routes(c.env), resourceServer(c.env));
  let result = await candidate(c, inner);
  if (!ran && result instanceof Response && result.status === 500) {
    // The library's own start-up failure (see the tools' paywall in index.ts): nothing ran or was charged; one fresh try.
    gateway = undefined;
    candidate = paymentMiddleware(routes(c.env), resourceServer(c.env));
    result = await candidate(c, inner);
    if (!ran && result instanceof Response && result.status === 500) return c.json({ error: "payment terms could not be prepared just now; nothing was charged, retry in a few seconds", code: "PAYWALL_UNAVAILABLE" }, 503, { "Retry-After": "5" });
  }
  const response = result instanceof Response ? result : c.res;
  if (response.status < 500) gateway ??= candidate;
  // Once the inner handler has set a response, Hono ignores a returned one: the answer must replace c.res itself
  // (cleared first, because Hono copies an existing response's headers into the next one).
  const send = (r: Response): Response => { c.res = undefined as never; c.res = r; return r; };

  const receipt = response.headers.get("PAYMENT-RESPONSE");
  let settled: { success?: boolean; transaction?: string; network?: string } | undefined;
  try { settled = receipt ? decodePaymentResponseHeader(receipt) as typeof settled : undefined; } catch { settled = undefined; }

  if (!ran || !response.ok || !settled?.success || !settled.transaction) {
    // The quote, or a refused or failed payment: the library's 402 with the terms, with a body a reader can act on.
    if (response.status !== 402) return send(response);
    const headers = new Headers(response.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.delete("content-length");
    headers.set("Cache-Control", "no-store");
    const networks = paymentOptions(c.env).map(({ network }) => NETWORK_NAMES[network] ?? network).join(", ");
    return send(new Response(JSON.stringify({
      error: paying ? "payment was not accepted; nothing was charged and no credits were added" : "payment required",
      what: usdcPackDescription(pack),
      price: `$${usd(pack)}`,
      credits: pack.credits,
      pay: `x402 v2, exact scheme, USDC on ${networks}: the terms are in the PAYMENT-REQUIRED header. Pay with any x402 client and repeat this GET.`,
      topUp: "To add the credits to a key you already hold, send it as X-API-Key on the same request.",
      otherPacks: usdcPackList(origin).filter((p) => p.buy !== `${origin}${usdcPackPath(pack)}`),
      byCard: `${origin}/credits`,
    }), { status: 402, headers }));
  }

  // Settled. The transaction identifies the purchase: a second write for the same one adds nothing.
  const sessionId = `x402:${settled.network ?? "unknown"}:${String(settled.transaction).toLowerCase()}`;
  const fresh = topUpHash ? null : newCreditKey();
  const keyHash = topUpHash ?? await hashCreditKey(fresh!);
  let issued: { key: string | null; credits: number; balanceMicros: number } | undefined;
  for (let attempt = 0; attempt < 2 && !issued; attempt++) {
    try { issued = await store.issueCredits({ sessionId, credits: pack.credits, key: fresh, keyHash }); } catch (e) {
      console.error(`usdc credits: settled ${sessionId} but the grant could not be written (attempt ${attempt + 1})`, e);
    }
  }
  markStage("credits_bought");
  const headers = new Headers({ "Cache-Control": "no-store", "content-type": "application/json; charset=utf-8" });
  for (const name of ["PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE", "X-Request-ID"]) { const v = response.headers.get(name); if (v) headers.set(name, v); }
  const paid = { network: settled.network, transaction: settled.transaction };
  const use = "Send the key as Authorization: Bearer <key> (or X-API-Key) on any tool call, or connect MCP clients to the mcpUrl. Each successful call spends the tool's price in credits; failed calls are refunded. Balance: GET /credits/balance with the key.";
  if (!issued) {
    // Paid, and the ledger still cannot be written: keep the grant where the next balance check applies it.
    const parked = await c.env.TRIALS?.put(unsavedKey(keyHash, sessionId), JSON.stringify({ sessionId, credits: pack.credits })).then(() => true).catch(() => false);
    console.error(`usdc credits: CREDITS_UNSAVED ${sessionId} keyHash ${keyHash.slice(0, 12)} credits ${pack.credits} parked=${parked ?? false}; operator reconciliation may be needed`);
    return send(new Response(JSON.stringify({
      ...(fresh ? { apiKey: fresh, mcpUrl: `${origin}/mcp/k/${fresh}` } : {}),
      creditsAdded: 0, creditsPending: pack.credits, toppedUp: Boolean(topUpHash), paid,
      note: `Your payment settled (${settled.transaction}) but the credits could not be saved this minute. GET ${origin}/credits/balance with the key in a few minutes adds them; you are not charged again. If they are still missing, write to the support address on /credits with the transaction.`,
      use,
    }), { status: 200, headers }));
  }
  return send(new Response(JSON.stringify({
    ...(fresh ? { apiKey: issued.key ?? fresh, mcpUrl: `${origin}/mcp/k/${issued.key ?? fresh}` } : {}),
    creditsAdded: issued.credits, balanceCredits: creditsFromMicros(issued.balanceMicros), toppedUp: Boolean(topUpHash), paid,
    use: fresh ? `${use} Save the key: it is shown in this response only.` : "Added to the key you sent in X-API-Key; keep using it.",
  }), { status: 200, headers }));
}
