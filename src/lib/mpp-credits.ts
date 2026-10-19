// Credit packs bought by the agent itself with MPP (Machine Payments Protocol, Stripe and Tempo): an agent
// holding a Shared Payment Token from a Link agent wallet pays a pack by card with no checkout page and gets
// the API key in the response. Card charges have a $0.50 minimum, so MPP sells packs, never single calls.
// Off until Peter sets STRIPE_MPP_KEY (restricted: PaymentIntents write) and STRIPE_PROFILE_ID.
import type { Context } from "hono";
import { Mppx, stripe } from "mppx/server";
import { Receipt } from "mppx";
import type { Env } from "./env";
import { CREDIT_PACKS, apiKeyFrom, creditsFromMicros, hashCreditKey, newCreditKey } from "./credits";

type C = Context<{ Bindings: Env }>;

/** The challenge-binding secret, derived from the Stripe key as Stripe's MPP guide does. */
async function challengeSecret(stripeKey: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(stripeKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("mpp-challenge-signing")));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const mppEnabled = (env: Env) => Boolean(env.STRIPE_MPP_KEY && env.STRIPE_PROFILE_ID);

/**
 * OpenAPI entries for the MPP credit packs, so MPP directories (MPPScan, mpp.dev) can list them: each GET answers
 * 402 with a WWW-Authenticate Payment challenge (Stripe card, charge intent). Only x402-free MPP routes are added
 * here; x402 tooling (402 Index, x402scan) reads x-payment-info.protocols and skips entries without x402.
 */
export function mppCreditOpenApiPaths() {
  return Object.fromEntries(CREDIT_PACKS.map((p) => {
    const usd = p.usdCents / 100;
    return [`/credits/buy/${usd}`, {
      get: {
        operationId: `buy-credits-${usd}`,
        summary: `Buy ${p.credits.toLocaleString("en-US")} prepaid tool credits for $${usd} (card, MPP)`,
        description: `An agent pays $${usd} by card through MPP (Stripe, Link agent wallet) and gets an API key worth ${p.credits.toLocaleString("en-US")} credits (1 credit = $0.001) in the response, with no checkout page. The key pays any of the service's tools over HTTP (Authorization: Bearer <key>) or MCP (/mcp/k/<key>); most tools cost 3 credits per call and failed calls are refunded. To add credits to a key you already hold, send it as X-API-Key.`,
        tags: ["credits"],
        "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: usd.toFixed(2) }, protocols: [{ mpp: { method: "stripe", intent: "charge", currency: "usd" } }] },
        parameters: [{ name: "X-API-Key", in: "header", required: false, description: "Optional existing adt_ key to top up instead of creating a new one", schema: { type: "string", pattern: "^adt_[A-Za-z0-9_-]{20,}$" } }],
        responses: {
          "200": {
            description: "Credits issued; the new key is shown only in this response",
            content: { "application/json": { schema: { type: "object", properties: {
              apiKey: { type: "string", description: "New adt_ key (absent on a top-up)" },
              mcpUrl: { type: "string", description: "MCP connector URL with the key embedded" },
              creditsAdded: { type: "integer" }, balanceCredits: { type: "integer" },
              toppedUp: { type: "boolean" }, use: { type: "string" },
            } } } },
          },
          "402": { description: "Payment Required (MPP: WWW-Authenticate: Payment, method stripe, intent charge)" },
        },
      },
    }];
  }));
}

export async function buyCreditsWithMpp(c: C) {
  c.header("Cache-Control", "no-store");
  const usd = Number(c.req.param("usd"));
  const pack = CREDIT_PACKS.find((p) => p.usdCents === usd * 100);
  if (!pack) return c.json({ error: `unknown pack; use one of: ${CREDIT_PACKS.map((p) => `/credits/buy/${p.usdCents / 100}`).join(", ")}` }, 404);
  const store = c.env.METRICS?.get(c.env.METRICS.idFromName("credits"));
  if (!mppEnabled(c.env) || !store) {
    return c.json({ error: `Agent card payments (MPP) are not switched on yet. Buy this pack by card at ${new URL(c.req.url).origin}/credits instead. Not charged.` }, 503);
  }
  // An agent that already holds a key names it in X-API-Key (Authorization carries the MPP credential):
  // the pack then tops up that key, so its connections keep working. Unknown keys are refused before
  // any charge rather than silently creating a second key.
  const existing = apiKeyFrom((n) => c.req.header(n));
  const topUpHash = existing ? await hashCreditKey(existing) : undefined;
  if (topUpHash && !(await store.creditBalance(topUpHash))) return c.json({ error: "unknown API key in X-API-Key; remove it to buy a new key. Not charged." }, 401);
  const secretKey = c.env.STRIPE_MPP_KEY!;
  const mppx = Mppx.create({
    methods: [stripe.charge({ secretKey, networkId: c.env.STRIPE_PROFILE_ID!, currency: "usd", decimals: 2, paymentMethodTypes: ["card"] })],
    secretKey: await challengeSecret(secretKey),
    realm: new URL(c.req.url).host,
  });
  const result = await mppx.stripe.charge({
    amount: (pack.usdCents / 100).toFixed(2),
    description: `${pack.credits.toLocaleString("en-US")} Agent Data Tools credits (1 credit = $0.001)`,
    metadata: { adt_credits: String(pack.credits) },
  })(c.req.raw);
  if (result.status === 402) return result.challenge as Response;
  // The PaymentIntent id makes the grant idempotent: a replayed credential returns the same key.
  const reference = Receipt.fromResponse(result.withReceipt(new Response(null)) as Response).reference;
  if (topUpHash) {
    const added = await store.issueCredits({ sessionId: `mpp:${reference}`, credits: pack.credits, key: null, keyHash: topUpHash });
    return result.withReceipt(Response.json({
      toppedUp: true, creditsAdded: added.credits, balanceCredits: creditsFromMicros(added.balanceMicros),
      use: "Added to the key you sent in X-API-Key; keep using it.",
    }, { headers: { "Cache-Control": "no-store" } })) as Response;
  }
  const key = newCreditKey();
  const issued = await store.issueCredits({ sessionId: `mpp:${reference}`, credits: pack.credits, key, keyHash: await hashCreditKey(key) });
  return result.withReceipt(Response.json({
    apiKey: issued.key,
    mcpUrl: `${new URL(c.req.url).origin}/mcp/k/${issued.key}`,
    creditsAdded: issued.credits,
    balanceCredits: creditsFromMicros(issued.balanceMicros),
    use: "Send the key as Authorization: Bearer <key> (or X-API-Key) on any tool call or MCP connection. Save it: it is shown in this response only.",
  }, { headers: { "Cache-Control": "no-store" } })) as Response;
}
