// Credit packs bought by the agent itself with MPP (Machine Payments Protocol, Stripe and Tempo): an agent
// holding a Shared Payment Token from a Link agent wallet pays a pack by card with no checkout page and gets
// the API key in the response. Card charges have a $0.50 minimum, so MPP sells packs, never single calls.
// Off until Peter sets STRIPE_MPP_KEY (restricted: PaymentIntents write) and STRIPE_PROFILE_ID.
import type { Context } from "hono";
import { Mppx, stripe } from "mppx/server";
import { Receipt } from "mppx";
import type { Env } from "./env";
import { CREDIT_PACKS, creditsFromMicros, hashCreditKey, newCreditKey } from "./credits";

type C = Context<{ Bindings: Env }>;

/** The challenge-binding secret, derived from the Stripe key as Stripe's MPP guide does. */
async function challengeSecret(stripeKey: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(stripeKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("mpp-challenge-signing")));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const mppEnabled = (env: Env) => Boolean(env.STRIPE_MPP_KEY && env.STRIPE_PROFILE_ID);

export async function buyCreditsWithMpp(c: C) {
  c.header("Cache-Control", "no-store");
  const usd = Number(c.req.param("usd"));
  const pack = CREDIT_PACKS.find((p) => p.usdCents === usd * 100);
  if (!pack) return c.json({ error: `unknown pack; use one of: ${CREDIT_PACKS.map((p) => `/credits/buy/${p.usdCents / 100}`).join(", ")}` }, 404);
  const store = c.env.METRICS?.get(c.env.METRICS.idFromName("credits"));
  if (!mppEnabled(c.env) || !store) {
    return c.json({ error: `Agent card payments (MPP) are not switched on yet. Buy this pack by card at ${new URL(c.req.url).origin}/credits instead. Not charged.` }, 503);
  }
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
  const key = newCreditKey();
  const issued = await store.issueCredits({ sessionId: `mpp:${reference}`, credits: pack.credits, key, keyHash: await hashCreditKey(key) });
  return result.withReceipt(Response.json({
    apiKey: issued.key,
    creditsAdded: issued.credits,
    balanceCredits: creditsFromMicros(issued.balanceMicros),
    use: "Send the key as Authorization: Bearer <key> (or X-API-Key) on any tool call or MCP connection. Save it: it is shown in this response only.",
  }, { headers: { "Cache-Control": "no-store" } })) as Response;
}
