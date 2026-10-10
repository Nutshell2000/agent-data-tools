import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware } from "@x402/hono";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { ENDPOINTS, SERVICE_NAME, apiCatalog, homePage, llmsTxt, mcpServerCard, openApi, robotsTxt, serviceCard } from "./discovery";
import { HttpError, type Env } from "./lib/env";
import { resourceServer } from "./lib/payments";
import { handleMcp } from "./mcp";
import { PRODUCTS } from "./store/catalog";
import { BUY_PATHS, store } from "./store/routes";
import { TOOLS } from "./tools";

const app = new Hono<{ Bindings: Env }>();
const PAID_PATHS = new Set([...ENDPOINTS.map((e) => e.path), ...BUY_PATHS]);

app.use(
  cors({
    origin: "*",
    exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "EXTENSION-RESPONSES", "X-PAYMENT-RESPONSE", "Mcp-Session-Id"],
  }),
);

function buildPaywall(env: Env): MiddlewareHandler {
  const routes = Object.fromEntries(
    ENDPOINTS.map((e) => [
      `GET ${e.path}`,
      {
        accepts: [{ scheme: "exact", price: e.price, network: env.NETWORK, payTo: env.PAY_TO }],
        description: e.description,
        mimeType: "application/json",
        serviceName: SERVICE_NAME,
        tags: e.tags,
        extensions: {
          ...declareDiscoveryExtension({
            input: Object.fromEntries(
              Object.entries(e.params)
                .filter(([, p]) => p.required)
                .map(([k, p]) => [k, p.example]),
            ),
            inputSchema: {
              properties: Object.fromEntries(
                Object.entries(e.params).map(([k, p]) => [k, { type: p.type, description: p.description }]),
              ),
              required: Object.entries(e.params)
                .filter(([, p]) => p.required)
                .map(([k]) => k),
            },
            output: { example: e.outputExample },
          }),
        },
      },
    ]),
  );
  // Store products bought by agents: same paywall, one fixed price each.
  const purchases = Object.fromEntries(
    PRODUCTS.map((p) => [
      `GET /buy/${p.slug}`,
      {
        accepts: [{ scheme: "exact", price: `$${p.priceUsd}`, network: env.NETWORK, payTo: env.PAY_TO }],
        description: `${p.title}: ${p.tagline} Returns a download link for the product file.`,
        mimeType: "application/json",
        serviceName: SERVICE_NAME,
        tags: ["template", "x402", "starter", "guide"],
        extensions: {
          ...declareDiscoveryExtension({
            input: {},
            inputSchema: { properties: {} },
            output: {
              example: {
                product: p.title,
                orderId: "0123456789abcdef0123456789abcdef",
                downloadUrl: "https://example.com/order/0123456789abcdef0123456789abcdef/download",
                receiptUrl: "https://example.com/order/0123456789abcdef0123456789abcdef",
              },
            },
          }),
        },
      },
    ]),
  );
  return paymentMiddleware({ ...routes, ...purchases }, resourceServer(env));
}

// Built on first request: Workers expose env bindings per request, not at module load.
let paywall: MiddlewareHandler | undefined;

const TRIALS_PER_CALLER = 3;
const TRIALS_PER_DAY = 300;

/**
 * Free trial calls are opt-in (?trial=1) so that ordinary unpaid requests still get
 * the 402 challenge directories and validators probe for. Counts are per caller IP
 * and per UTC day; KV is eventually consistent, so the limits are approximate.
 */
async function takeTrial(env: Env, ip: string): Promise<number | null> {
  if (!env.TRIALS) return null;
  const day = new Date().toISOString().slice(0, 10);
  const [mine, all] = await Promise.all([env.TRIALS.get(`${day}:${ip}`), env.TRIALS.get(`${day}:all`)]);
  const used = Number(mine) || 0;
  const total = Number(all) || 0;
  if (used >= TRIALS_PER_CALLER || total >= TRIALS_PER_DAY) return null;
  const ttl = { expirationTtl: 172_800 };
  await Promise.all([env.TRIALS.put(`${day}:${ip}`, String(used + 1), ttl), env.TRIALS.put(`${day}:all`, String(total + 1), ttl)]);
  return TRIALS_PER_CALLER - used - 1;
}

app.use(async (c, next) => {
  if (!PAID_PATHS.has(c.req.path) || c.env.PAYWALL === "off") return next();
  // Trials cover the per-call tools only, never store purchases.
  const trialable = !c.req.path.startsWith("/buy/");
  if (trialable && c.req.method === "GET" && c.req.query("trial") === "1" && !c.req.header("payment-signature")) {
    const left = await takeTrial(c.env, c.req.header("cf-connecting-ip") ?? "unknown");
    if (left !== null) {
      await next();
      c.res.headers.set("X-Free-Trial-Remaining", String(left));
      return;
    }
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.json({ error: "method not allowed; use GET" }, 405);
  if (c.req.method === "HEAD") {
    // Crawlers probe with HEAD. Answer with the same 402 challenge a GET would get.
    const probe = await app.fetch(new Request(c.req.url, { method: "GET", headers: c.req.raw.headers }), c.env, c.executionCtx);
    return new Response(null, { status: probe.status, headers: probe.headers });
  }
  paywall ??= buildPaywall(c.env);
  return paywall(c, next);
});

for (const e of ENDPOINTS) {
  app.get(e.path, async (c) => c.json(await TOOLS[e.path](c.env, (name) => c.req.query(name))));
}

// The same tools over MCP. Listing tools is free; calling one requires payment.
app.all("/mcp", handleMcp);

// Store for people: product pages, orders paid by plain USDC transfer, downloads.
app.route("/", store);

const origin = (url: string) => new URL(url).origin;
app.get("/", (c) =>
  // Browsers get a readable page, programs get the JSON service card.
  (c.req.header("accept") ?? "").includes("text/html")
    ? c.html(homePage(origin(c.req.url), c.env.PAY_TO))
    : c.json(serviceCard(origin(c.req.url), c.env.PAY_TO, c.env.NETWORK)),
);
app.get("/openapi.json", (c) => c.json(openApi(origin(c.req.url))));
app.get("/llms.txt", (c) => c.text(llmsTxt(origin(c.req.url))));
app.get("/robots.txt", (c) => c.text(robotsTxt(origin(c.req.url))));
app.get("/health", (c) => c.json({ ok: true }));
app.get("/.well-known/x402", (c) =>
  c.json({ version: 1, resources: ENDPOINTS.map((e) => origin(c.req.url) + e.path) }),
);
app.get("/.well-known/mcp/server-card.json", (c) => c.json(mcpServerCard(origin(c.req.url))));
app.get("/.well-known/api-catalog", (c) =>
  c.body(JSON.stringify(apiCatalog(origin(c.req.url))), 200, { "content-type": "application/linkset+json" }),
);

app.notFound((c) => c.json({ error: "not found", docs: `${origin(c.req.url)}/llms.txt` }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
