import { Hono } from "hono";
import { HttpError, type Env } from "../lib/env";
import { findProduct, PRODUCTS } from "./catalog";
import { findPayment } from "./chain";
import { createOrder, getOrder, markTestPaid, orderState, refreshOrder } from "./orders";
import { orderPage, productPage, storePage } from "./pages";

export const store = new Hono<{ Bindings: Env }>();

/** Paths agents pay for with x402. The paywall in index.ts covers these. */
export const BUY_PATHS = PRODUCTS.map((p) => `/buy/${p.slug}`);

/** OpenAPI entries for the purchase routes, so directories that read /openapi.json list the products. */
export const buyOpenApiPaths = () =>
  Object.fromEntries(
    PRODUCTS.map((p) => [
      `/buy/${p.slug}`,
      {
        get: {
          operationId: `buy-${p.slug}`,
          summary: `Buy: ${p.title}`,
          description: `${p.tagline} ${p.description[0]} Returns a download link for the product file.`,
          tags: ["store"],
          "x-payment-info": { price: { mode: "fixed", currency: "USD", amount: String(p.priceUsd) }, protocols: [{ x402: {} }] },
          parameters: [],
          responses: {
            "200": {
              description: "Purchase receipt with the download link",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { product: { type: "string" }, orderId: { type: "string" }, downloadUrl: { type: "string" }, receiptUrl: { type: "string" } },
                  },
                },
              },
            },
            "402": { description: "Payment Required" },
          },
        },
      },
    ]),
  );

const product = (slug: string) => {
  const p = findProduct(slug);
  if (!p) throw new HttpError(404, "no such product");
  return p;
};

async function order(env: Env, id: string) {
  const o = await getOrder(env, id);
  if (!o) throw new HttpError(404, "no such order");
  return o;
}

store.get("/store", (c) => c.html(storePage()));
store.get("/store/:slug", (c) => c.html(productPage(product(c.req.param("slug")))));

store.post("/store/:slug/order", async (c) => {
  const o = await createOrder(c.env, product(c.req.param("slug")));
  return c.redirect(`/order/${o.id}`, 303);
});

store.get("/order/:id", async (c) => {
  const o = await refreshOrder(c.env, await order(c.env, c.req.param("id")));
  c.header("cache-control", "no-store");
  return c.html(orderPage(o, product(o.slug), c.env.PAY_TO));
});

store.get("/order/:id/status", async (c) => {
  let o = await order(c.env, c.req.param("id"));
  // Local testing only: the paywall is never off in production.
  o = c.env.PAYWALL === "off" && c.req.query("simulate") === "1" ? await markTestPaid(c.env, o) : await refreshOrder(c.env, o);
  c.header("cache-control", "no-store");
  return c.json({ state: orderState(o) });
});

store.get("/order/:id/download", async (c) => {
  const o = await order(c.env, c.req.param("id"));
  if (orderState(o) !== "paid") throw new HttpError(404, "this order has not been paid");
  const p = product(o.slug);
  const file = await c.env.ASSETS.fetch(new URL(`/_files/${p.file}`, c.req.url));
  if (!file.ok) throw new HttpError(502, "the download is temporarily unavailable");
  return new Response(file.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${p.file}"`,
      "cache-control": "private, no-store",
    },
  });
});

// Local testing only: checks payment detection against any real past transfer.
store.get("/order-debug/find", async (c) => {
  if (c.env.PAYWALL !== "off") throw new HttpError(404, "not found");
  const q = (k: string) => c.req.query(k) ?? "";
  const hit = await findPayment(c.env, q("to"), BigInt(q("amount")), BigInt(q("from")), BigInt(q("until")));
  return c.json(hit ? { found: true, tx: hit.tx, from: hit.from, block: String(hit.block) } : { found: false });
});

// Reached only after the x402 paywall has verified a payment for this path.
store.get("/buy/:slug", async (c) => {
  const p = product(c.req.param("slug"));
  const o = await createOrder(c.env, p, c.env.PAYWALL === "off" ? "test" : "x402");
  const origin = new URL(c.req.url).origin;
  return c.json({ product: p.title, orderId: o.id, downloadUrl: `${origin}/order/${o.id}/download`, receiptUrl: `${origin}/order/${o.id}` });
});
