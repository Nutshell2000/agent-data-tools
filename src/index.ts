import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware } from "@x402/hono";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { ENDPOINTS, SERVICE_NAME, apiCatalog, homePage, llmsTxt, mcpServerCard, openApi, robotsTxt, serviceCard } from "./discovery";
import { HttpError, type Env } from "./lib/env";
import { resourceServer } from "./lib/payments";
import { handleMcp } from "./mcp";
import { TOOLS } from "./tools";

const app = new Hono<{ Bindings: Env }>();
const PAID_PATHS = new Set(ENDPOINTS.map((e) => e.path));

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
  return paymentMiddleware(routes, resourceServer(env));
}

// Built on first request: Workers expose env bindings per request, not at module load.
let paywall: MiddlewareHandler | undefined;

app.use(async (c, next) => {
  if (!PAID_PATHS.has(c.req.path) || c.env.PAYWALL === "off") return next();
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
