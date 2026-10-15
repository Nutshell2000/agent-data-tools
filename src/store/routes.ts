import { Hono, type MiddlewareHandler } from "hono";
import { HttpError, type Env } from "../lib/env";
import { findOrderProduct, findProduct, PRODUCTS, NEW_PRODUCT_SALES_ENABLED, type Product } from "./catalog";
import { findPayment } from "./chain";
import { createOrder, getOrder, markTestPaid, orderState, refreshOrder } from "./orders";
import { orderPage, productPage, storePage } from "./pages";

export const store = new Hono<{ Bindings: Env }>();
store.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
  console.error(error); return c.json({ error: "internal error" }, 500);
});

/** Paths agents pay for with x402. The paywall in index.ts covers these. */
export const BUY_PATHS = PRODUCTS.map((p) => `/buy/${p.slug}`);

/** OpenAPI entries for the purchase routes, so directories that read /openapi.json list the products. */
export const buyOpenApiPaths = () =>
  Object.fromEntries(
    (NEW_PRODUCT_SALES_ENABLED ? PRODUCTS : []).map((p) => [
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

const orderProduct = (slug: string) => {
  const p = findOrderProduct(slug);
  if (!p) throw new HttpError(404, "no such product");
  return p;
};

export async function productAssetAvailable(env: Env, p: Product): Promise<boolean> {
  try {
    const response = await env.ASSETS.fetch(
      new Request(`https://assets.local/_files/${encodeURIComponent(p.file)}`, { method: "HEAD" }),
    );
    return response.ok;
  } catch (error) {
    console.error(`product asset availability check failed for ${p.slug}: ${error}`);
    return false;
  }
}

export async function assertProductAssetAvailable(env: Env, p: Product): Promise<void> {
  if (!(await productAssetAvailable(env, p))) {
    throw new HttpError(503, "the product download is unavailable; purchase was not created");
  }
}

function assertNewSalesEnabled() {
  if (!NEW_PRODUCT_SALES_ENABLED) throw new HttpError(503, "new seller-kit purchases are paused for template verification; no payment requested. Existing paid downloads remain available");
}

export function buyAssetPreflight(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (!NEW_PRODUCT_SALES_ENABLED && PRODUCTS.some(p => c.req.path === `/buy/${p.slug}`)) {
      // Older directories still link here as API documentation. Preserve the pause
      // and error status, but give those visitors a route to the current reader.
      c.header("Cache-Control", "no-store");
      c.header("Link", '</guides/web-reading>; rel="help"; type="text/html"');
      if (c.req.method === "GET" && (c.req.header("accept") ?? "").includes("text/html")) {
        return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Seller kit paused | Current API documentation</title><style>:root{color-scheme:light dark}body{font:18px/1.6 system-ui;max-width:720px;margin:60px auto;padding:0 20px}a{color:LinkText}h1{line-height:1.2}</style></head><body><main><h1>Seller-kit purchases are paused</h1><p>This request did not request or settle a payment. Existing paid orders retain their download access.</p><h2>Looking for our API documentation?</h2><p>Some older directory links point here. Our current reader turns public static documentation into text, Markdown, code and tables for $0.002 USDC per successful call.</p><p><a href="/guides/web-reading">View a real result, inspect a free quote, then choose whether to buy one page</a></p><p>No JavaScript rendering, authenticated pages or paywall access. Opening the guide does not make a purchase.</p><p><a href="/">Current tools and documentation</a></p></main></body></html>`, 503);
      }
      return c.json({ error: "new seller-kit purchases are paused for template verification; no payment requested. Existing paid downloads remain available", documentationUrl: "/guides/web-reading", paymentRequested: false }, 503);
    }
    const p =
      c.req.method === "GET" ? PRODUCTS.find((product) => c.req.path === `/buy/${product.slug}`) : undefined;
    if (p) await assertProductAssetAvailable(c.env, p);
    await next();
  };
}

async function order(env: Env, id: string) {
  const o = await getOrder(env, id);
  if (!o) throw new HttpError(404, "no such order");
  return o;
}

store.get("/store", async (c) => {
  const availability = Object.fromEntries(
    await Promise.all(PRODUCTS.map(async (p) => [p.slug, NEW_PRODUCT_SALES_ENABLED && await productAssetAvailable(c.env, p)] as const)),
  );
  return c.html(storePage(new URL(c.req.url).origin, availability));
});

store.get("/store/:slug", async (c) => {
  const p = product(c.req.param("slug"));
  const available = NEW_PRODUCT_SALES_ENABLED && await productAssetAvailable(c.env, p);
  return c.html(productPage(p, new URL(c.req.url).origin, available));
});

store.post("/store/:slug/order", async (c) => {
  const p = product(c.req.param("slug"));
  assertNewSalesEnabled();
  await assertProductAssetAvailable(c.env, p);
  const o = await createOrder(c.env, p);
  return c.redirect(`/order/${o.id}`, 303);
});

store.get("/order/:id", async (c) => {
  const o = await refreshOrder(c.env, await order(c.env, c.req.param("id")));
  c.header("cache-control", "no-store");
  return c.html(orderPage(o, orderProduct(o.slug), c.env.PAY_TO));
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
  const p = orderProduct(o.slug);
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
  assertNewSalesEnabled();
  await assertProductAssetAvailable(c.env, p);
  const o = await createOrder(c.env, p, c.env.PAYWALL === "off" ? "test" : "x402");
  const origin = new URL(c.req.url).origin;
  return c.json({ product: p.title, orderId: o.id, downloadUrl: `${origin}/order/${o.id}/download`, receiptUrl: `${origin}/order/${o.id}` });
});
