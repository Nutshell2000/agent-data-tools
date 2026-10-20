// Spreadsheet kits paid by card through Stripe: Agentic Commerce Suite orders placed by AI agents (Stripe-managed
// checkout) and any Stripe Checkout or payment link whose line items name a kit. Stripe sends checkout.session.completed
// to POST /stripe/webhook; the order is read back from Stripe (verifyCheckout's session check), each kit becomes a
// paid store order, and the buyer collects a signed download link at /kits/claim with the Checkout Session id or
// the receipt number from Stripe's receipt. Nothing is emailed and nothing about the buyer is stored: only the
// session id, the kit slugs and a hash of the receipt number. Credit packs keep their own claim flow (/credits/claim).
import { Hono } from "hono";
import type { Env } from "./env";
import { CheckoutError, fetchPaidSession, isCheckoutSessionId, type PaidSession } from "./credits";
import { prefersHtml } from "./negotiate";
import { findKit, KITS, KIT_LICENCE, kitByFeedId, type Kit } from "../store/kits";
import { putStripeOrder } from "../store/orders";
import { CSS, esc } from "../store/pages";
import { SERVICE_NAME, SUPPORT_EMAIL } from "../endpoints";

/** Stripe's default tolerance: a signed event older than this is refused, so a captured request cannot be replayed later. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;
/** How long one download link works; the claim page issues a fresh one at any time. */
export const DOWNLOAD_LINK_SECONDS = 7 * 24 * 60 * 60;
const KEEP_SECONDS = 30 * 24 * 60 * 60;
/** Agentic orders carry the feed id in price.external_reference, a preview field (docs: checkout/orders). */
export const AGENTIC_STRIPE_VERSION = "2025-12-15.preview";
const SESSION_EXPAND = "expand[]=line_items.data.price.product&expand[]=payment_intent.latest_charge";

const enc = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks a Stripe-Signature header (t=<unix>,v1=<hex>[,v1=…]) against the raw body, as Stripe's libraries do:
 * HMAC-SHA256 of "<t>.<body>" with the endpoint secret, and t within the tolerance of now.
 */
export async function verifyStripeSignature(secret: string, header: string | undefined, body: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!header) return { ok: false as const, reason: "missing Stripe-Signature header" };
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isSafeInteger(t) || !signatures.length) return { ok: false as const, reason: "malformed Stripe-Signature header" };
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false as const, reason: "signature timestamp outside the tolerance (replayed or delayed event)" };
  const expected = await hmacHex(secret, `${t}.${body}`);
  if (!signatures.some((s) => timingSafeEqual(s, expected))) return { ok: false as const, reason: "signature does not match" };
  return { ok: true as const, timestamp: t };
}

/** Kit orders and download links are signed with a key derived from the webhook secret, never with the secret itself. */
const signingKey = (webhookSecret: string) => hmacHex(webhookSecret, "adt-kit-download-v1");

/** One order per session and kit: deterministic, so repeated events and claims never create a second order. */
export async function kitOrderId(webhookSecret: string, sessionId: string, slug: string) {
  return (await hmacHex(await signingKey(webhookSecret), `order:${sessionId}:${slug}`)).slice(0, 32);
}

export async function signDownload(webhookSecret: string, orderId: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const exp = nowSeconds + DOWNLOAD_LINK_SECONDS;
  return { exp, sig: await hmacHex(await signingKey(webhookSecret), `download:${orderId}:${exp}`) };
}

export async function validDownload(webhookSecret: string | undefined, orderId: string, exp: string | undefined, sig: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!webhookSecret || !exp || !sig || !/^\d{1,12}$/.test(exp) || Number(exp) < nowSeconds) return false;
  return timingSafeEqual(sig, await hmacHex(await signingKey(webhookSecret), `download:${orderId}:${exp}`));
}

interface LineItem { quantity?: number; amount_subtotal?: number; currency?: string; price?: { external_reference?: string | null; unit_amount?: number | null; product?: { metadata?: Record<string, string> } | string } }
export interface KitSession extends PaidSession {
  line_items?: { data?: LineItem[] };
  payment_intent?: { latest_charge?: { receipt_number?: string | null } | string | null } | string | null;
}

/** The kit a line item pays for: the feed id (agentic orders) or product metadata adt_kit (payment links Peter makes by hand). */
function kitFor(item: LineItem): Kit | undefined {
  const product = typeof item.price?.product === "object" ? item.price.product : undefined;
  return kitByFeedId(item.price?.external_reference) ?? (product?.metadata?.adt_kit ? findKit(product.metadata.adt_kit) : undefined);
}

/** Kits in a paid session, each checked to be paid in USD at no less than its feed price. */
export function kitsInSession(s: KitSession): Kit[] {
  const kits: Kit[] = [];
  for (const item of s.line_items?.data ?? []) {
    const kit = kitFor(item);
    if (!kit) continue;
    const quantity = Math.max(1, item.quantity ?? 1);
    if ((item.currency ?? s.currency) !== "usd" || (item.amount_subtotal ?? 0) < kit.usdCents * quantity) {
      console.warn(`stripe kit ${kit.slug}: paid ${item.amount_subtotal} ${item.currency ?? s.currency}, below the feed price; not fulfilled`);
      continue;
    }
    if (!kits.includes(kit)) kits.push(kit);
  }
  return kits;
}

const receiptNumber = (s: KitSession) => {
  const pi = typeof s.payment_intent === "object" ? s.payment_intent : undefined;
  const charge = pi && typeof pi.latest_charge === "object" ? pi.latest_charge : undefined;
  return charge?.receipt_number ?? undefined;
};
const normaliseReceipt = (r: string) => r.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
const receiptKey = async (r: string) => `kit:receipt:${hex(await crypto.subtle.digest("SHA-256", enc.encode(normaliseReceipt(r))))}`;
const sessionKey = (id: string) => `kit:session:${id}`;

interface SessionRecord { orders: { slug: string; orderId: string }[]; at: string }

function kv(env: Env) {
  if (!env.TRIALS) throw new CheckoutError(503, "kit downloads are not available in this environment");
  return env.TRIALS;
}

/**
 * Turns a paid session into one paid order per kit. Idempotent: a session already fulfilled returns its record
 * (repeated: true) without writing. Returns null when the session pays for no kit (credit packs, other products).
 */
export async function fulfilKitSession(env: Env, secret: string, s: KitSession & { id: string }) {
  const known = await kv(env).get<SessionRecord>(sessionKey(s.id), "json");
  if (known) return { ...known, repeated: true };
  const kits = kitsInSession(s);
  if (!kits.length) return null;
  const orders = [];
  for (const kit of kits) {
    const order = await putStripeOrder(env, await kitOrderId(secret, s.id, kit.slug), kit.slug, kit.usdCents);
    orders.push({ slug: kit.slug, orderId: order.id });
  }
  const record: SessionRecord = { orders, at: new Date().toISOString() };
  await kv(env).put(sessionKey(s.id), JSON.stringify(record), { expirationTtl: KEEP_SECONDS });
  const receipt = receiptNumber(s);
  if (receipt) await kv(env).put(await receiptKey(receipt), s.id, { expirationTtl: KEEP_SECONDS });
  return { ...record, repeated: false };
}

const readSession = (env: Env, id: string, fetchImpl: typeof fetch) =>
  fetchPaidSession<KitSession & { id: string }>(env.STRIPE_READ_KEY, id, fetchImpl, SESSION_EXPAND, AGENTIC_STRIPE_VERSION)
    .then((s) => ({ ...s, id }));

const HANDLED = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

export function stripeKits(fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/stripe/webhook", async (c) => {
    const secret = c.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return c.json({ error: "webhook not configured" }, 503);
    const body = await c.req.text();
    const verified = await verifyStripeSignature(secret, c.req.header("stripe-signature"), body);
    if (!verified.ok) {
      console.warn(`stripe webhook refused: ${verified.reason}`);
      return c.json({ error: verified.reason }, 400);
    }
    let event: { id?: string; type?: string; data?: { object?: { id?: string; object?: string } } };
    try { event = JSON.parse(body); } catch { return c.json({ error: "body is not JSON" }, 400); }
    const sessionId = event.data?.object?.id ?? "";
    if (!event.type || !HANDLED.has(event.type) || !isCheckoutSessionId(sessionId)) return c.json({ received: true, ignored: event.type ?? "unknown" });
    try {
      // The event body is only a pointer: the paid state and the line items are read back from Stripe.
      const result = await fulfilKitSession(c.env, secret, await readSession(c.env, sessionId, fetchImpl));
      if (!result) {
        console.log(`stripe webhook ${event.id}: session pays for no spreadsheet kit; nothing to fulfil`);
        return c.json({ received: true, fulfilled: 0, ignored: "no spreadsheet kit in this checkout" });
      }
      console.log(`stripe webhook ${event.id}: kits ${result.orders.map((o) => o.slug).join(",")}${result.repeated ? " (repeat)" : ""}`);
      return c.json({ received: true, fulfilled: result.orders.length, repeated: result.repeated });
    } catch (err) {
      if (!(err instanceof CheckoutError)) throw err;
      // 402 (not paid yet) and 400 are final for this event; Stripe retries 5xx, which is what an outage needs.
      if (err.status >= 500) return c.json({ error: err.message }, 503);
      return c.json({ received: true, fulfilled: 0, ignored: err.message });
    }
  });

  app.get("/kits/claim", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Robots-Tag", "noindex");
    const html = prefersHtml(c.req.header("accept"), c.req.header("user-agent"));
    const origin = new URL(c.req.url).origin;
    const secret = c.env.STRIPE_WEBHOOK_SECRET;
    const sessionParam = (c.req.query("session_id") ?? "").trim();
    const receipt = (c.req.query("receipt") ?? "").trim();
    try {
      if (!secret) throw new CheckoutError(503, "card orders for kits are being set up; your payment is safe. Write to " + SUPPORT_EMAIL + " with your receipt and we will send the file.");
      if (!sessionParam && !receipt) return html ? c.html(claimPage()) : c.json({ error: "send session_id=cs_… or receipt=<receipt number>" }, 400);
      let sessionId = sessionParam;
      if (!sessionId) {
        sessionId = (await kv(c.env).get(await receiptKey(receipt))) ?? "";
        if (!sessionId) throw new CheckoutError(404, "no kit order with that receipt number yet. Orders appear a minute after payment; check the number on your Stripe receipt, or write to " + SUPPORT_EMAIL);
      }
      // A missed or delayed webhook never strands a buyer: the session is read from Stripe and fulfilled here.
      const record = await kv(c.env).get<SessionRecord>(sessionKey(sessionId), "json")
        ?? await fulfilKitSession(c.env, secret, await readSession(c.env, sessionId, fetchImpl));
      if (!record) throw new CheckoutError(400, "this checkout did not buy a spreadsheet kit");
      const downloads = await Promise.all(record.orders.map(async ({ slug, orderId }) => {
        const { exp, sig } = await signDownload(secret, orderId);
        return { kit: findKit(slug)?.title ?? slug, downloadUrl: `${origin}/order/${orderId}/download?exp=${exp}&sig=${sig}`, expires: new Date(exp * 1000).toISOString() };
      }));
      if (!html) return c.json({ downloads, note: "Each link works for 7 days; open this claim URL again for fresh links." });
      return c.html(kitShell("Your download", "Your spreadsheet kit download", `<h1>Payment received</h1>
<p>Thank you. Your download${downloads.length > 1 ? "s" : ""}:</p>
${downloads.map((d) => `<div class="card"><p><strong>${esc(d.kit)}</strong></p><p><a class="btn" href="${esc(d.downloadUrl)}">Download</a></p></div>`).join("")}
<p class="note">Each link works for 7 days. Bookmark this page: it gives you fresh links whenever you need them.</p>`));
    } catch (err) {
      if (!(err instanceof CheckoutError)) throw err;
      if (!html) return c.json({ error: err.message }, err.status);
      return c.html(claimPage(err.message), err.status);
    }
  });

  app.get("/kits", (c) => c.html(kitShell("Spreadsheet kits", "Ready-made spreadsheet workbooks, one-time download, paid by card.",
    `<h1>Spreadsheet kits</h1><p class="lead">Ready-made workbooks for small businesses. One-time download, paid by card.</p>
${KITS.map((k) => `<div class="card"><h2 style="margin-top:0"><a href="/kits/${k.slug}">${esc(k.title)}</a></h2><p>${esc(k.summary)}</p><p class="price">$${(k.usdCents / 100).toFixed(2)}</p></div>`).join("")}`,
    `${new URL(c.req.url).origin}/kits`)));

  app.get("/kits/:slug", (c) => {
    const kit = findKit(c.req.param("slug"));
    if (!kit) return c.json({ error: "no such kit" }, 404);
    const url = `${new URL(c.req.url).origin}/kits/${kit.slug}`;
    return c.html(kitShell(kit.title, kit.summary, `<h1>${esc(kit.title)}</h1><p class="lead">${esc(kit.summary)}</p>
<p><img src="${esc(kit.image)}" alt="${esc(kit.title)} cover" style="max-width:100%;height:auto;border-radius:8px"></p>
${kit.description.map((p) => `<p>${esc(p)}</p>`).join("")}
<p>${esc(KIT_LICENCE)}</p>
<p class="price">$${(kit.usdCents / 100).toFixed(2)}</p>
<h2>How you get the file</h2>
<p>Buy it through an AI shopping assistant that sells SpellzCode products. After paying, open <a href="/kits/claim">${esc(new URL(c.req.url).host)}/kits/claim</a> and enter the receipt number from your Stripe receipt: the download appears there. Nothing to sign up for.</p>`, url));
  });

  return app;
}

function claimPage(error?: string) {
  return kitShell("Get your download", "Download a spreadsheet kit you bought", `<h1>Get your download</h1>
${error ? `<div class="status">${esc(error)}</div>` : ""}
<p>Enter the receipt number from your Stripe receipt (for example 1234-5678).</p>
<form method="get" action="/kits/claim"><p><input name="receipt" required autocomplete="off" style="font:inherit;padding:10px;width:100%;max-width:22rem"></p><p><button type="submit">Show my download</button></p></form>`);
}

function kitShell(title: string, description: string, body: string, canonical?: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | SpellzCode</title><meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : `<meta name="robots" content="noindex">`}<style>${CSS}</style></head>
<body><main><nav><a href="/kits">SpellzCode spreadsheet kits</a></nav>${body}
<footer><p>Sold by SpellzCode, the maintainer of ${esc(SERVICE_NAME)}. Card payments by Stripe. If a file is broken or not what was described, write to <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a>. <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p></footer>
</main></body></html>`;
}
