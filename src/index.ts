import { sitemapGuideHtml, sitemapGuideMarkdown } from "./guides/sitemap";
import { localMcpHtml, localMcpMarkdown } from "./guides/local-mcp";
import { readerSkillMarkdown, readerSkillIndex } from "./guides/reader-skill";
import { loadReaderDemo } from "./guides/reader-buying";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware } from "@x402/hono";
import type { RouteConfig } from "@x402/core/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { CAPACITY_LIMITED, ENDPOINTS, MCP_SERVER_VERSION, SERVICE_NAME, apiCatalog, homePage, llmsTxt, marketplaceOpenApi, mcpServerCard, openApi, robotsTxt, sitemapXml, serviceCard } from "./discovery";
import { HttpError, trialsEnabled, type Env } from "./lib/env";
import { resourceServer } from "./lib/payments";
import { auditGuideHtml, auditGuideMarkdown } from "./guides/dependency-audit";
import { toolGuideHtml, toolGuideMarkdown } from "./guides/tool-buying";
import { headPaymentProbe } from "./lib/payment-probe";
import { requestMetricsMiddleware } from "./lib/request-metrics";
import { activeTrace, isDiscoveryVisit, markStage, withRequestTrace } from "./lib/funnel";
import { handleMcp } from "./mcp";
import { Metrics } from "./metrics";
import { PRODUCTS } from "./store/catalog";
import { buyAssetPreflight, BUY_PATHS, buyOpenApiPaths, store } from "./store/routes";
import { TOOLS } from "./tools";

const app = new Hono<{ Bindings: Env }>();
const PAID_PATHS = new Set([...ENDPOINTS.map((e) => e.path), ...BUY_PATHS]);
const DEFERRED_PATHS = [
  "/airdrop-scanner",
  "/liquidity-return-analyzer",
  "/token-holder-analysis",
  "/pair-analyzer",
  "/wallet-history",
] as const;

app.use(
  cors({
    origin: "*",
    exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "EXTENSION-RESPONSES", "X-PAYMENT-RESPONSE", "Mcp-Session-Id", "X-Request-ID"],
  }),
);

app.use(async (c, next) => withRequestTrace(c.env, c.req.path, c.req.header("X402-Source") ?? null,
  p => c.executionCtx.waitUntil(p), async () => {
    const id = activeTrace()!.requestId;
    c.header("X-Request-ID", id);
    if (c.req.method === "GET" && ENDPOINTS.some(e => e.path === c.req.path) && c.req.header("payment-signature")) markStage("attempt");
    await next();
    if (isDiscoveryVisit(c.req.method, c.req.path, c.res.status)) markStage("visit");
    if (c.req.method === "GET" && ENDPOINTS.some(e => e.path === c.req.path)) {
      if (c.res.status === 402 && !c.req.header("payment-signature")) markStage("quote");
      if (c.res.status >= 400 && activeTrace()?.stages.has("verified") && !activeTrace()?.stages.has("settlement_failed")) markStage("execution_failed");
      if (c.res.ok && c.res.headers.has("PAYMENT-RESPONSE")) markStage("completed");
    }
  }));

// Counts requests after their response is decided; telemetry never delays or fails it.
app.use(requestMetricsMiddleware(PAID_PATHS, viaMarketplace));

/**
 * True for a call that came through RapidAPI's proxy. Those callers pay RapidAPI, which
 * pays us, so they skip the x402 paywall. Off until the secret is configured.
 */
function viaMarketplace(env: Env, sent: string | undefined): boolean {
  const secret = env.RAPIDAPI_PROXY_SECRET;
  if (!secret || secret.length < 16 || !sent || sent.length !== secret.length) return false;
  // Compare every character so the time taken does not reveal how much matched.
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ sent.charCodeAt(i);
  return diff === 0;
}

function buildPaywall(env: Env): MiddlewareHandler {
  const routes = Object.fromEntries(
    ENDPOINTS.map((e): [string, RouteConfig] => [
      `GET ${e.path}`,
      {
        accepts: [{ scheme: "exact", price: e.price, network: env.NETWORK, payTo: env.PAY_TO }],
        description: e.description,
        mimeType: "application/json",
        serviceName: SERVICE_NAME,
        tags: [...e.tags],
        extensions: {
          ...declareDiscoveryExtension({
            input: Object.fromEntries(
              Object.entries(e.params)
                .filter(([, p]) => p.required)
                .map(([k, p]) => [k, p.example]),
            ),
            inputSchema: {
              properties: Object.fromEntries(
                Object.entries(e.params).map(([k, p]) => [k, { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) }]),
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
    PRODUCTS.map((p): [string, RouteConfig] => [
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

const TRIALS_PER_CALLER = 10;
const TRIALS_PER_DAY = 1000;

/**
 * Free trial calls require TRIALS_ENABLED=on and ?trial=1 so ordinary unpaid requests get
 * the 402 challenge directories and validators probe for. Counts are per caller IP
 * and per UTC day; KV is eventually consistent, so the limits are approximate.
 */
async function takeTrial(env: Env, ip: string): Promise<number | null> {
  if (!trialsEnabled(env) || !env.TRIALS) return null;
  const day = new Date().toISOString().slice(0, 10);
  const [mine, all] = await Promise.all([env.TRIALS.get(`${day}:${ip}`), env.TRIALS.get(`${day}:all`)]);
  const used = Number(mine) || 0;
  const total = Number(all) || 0;
  if (used >= TRIALS_PER_CALLER || total >= TRIALS_PER_DAY) return null;
  const ttl = { expirationTtl: 172_800 };
  await Promise.all([env.TRIALS.put(`${day}:${ip}`, String(used + 1), ttl), env.TRIALS.put(`${day}:all`, String(total + 1), ttl)]);
  return TRIALS_PER_CALLER - used - 1;
}

app.use(buyAssetPreflight());

app.use(async (c, next) => {
  if (!PAID_PATHS.has(c.req.path) || c.env.PAYWALL === "off") return next();
  const endpoint = ENDPOINTS.find((e) => e.path === c.req.path);
  if (endpoint && (c.req.method === "GET" || c.req.method === "HEAD")) {
    for (const [name, param] of Object.entries(endpoint.params)) {
      const value = c.req.query(name);
      if (value !== undefined && param.enum && !param.enum.some((allowed: string) => allowed === value)) {
        return c.json({ error: `${name} must be one of: ${param.enum.join(", ")}` }, 400);
      }
    }
  }
  // Trials cover the per-call tools only, never store purchases.
  const trialable = !c.req.path.startsWith("/buy/");
  if (trialable && c.req.method === "GET" && viaMarketplace(c.env, c.req.header("x-rapidapi-proxy-secret")) && !CAPACITY_LIMITED.has(c.req.path)) return next();
  if (trialable && trialsEnabled(c.env) && c.req.method === "GET" && c.req.query("trial") === "1" && !c.req.header("payment-signature")) {
    const left = await takeTrial(c.env, c.req.header("cf-connecting-ip") ?? "unknown");
    if (left !== null) {
      await next();
      c.res.headers.set("X-Free-Trial-Remaining", String(left));
      return;
    }
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.json({ error: "method not allowed; use GET" }, 405);
  if (c.req.method === "HEAD") {
    return headPaymentProbe(c.req.raw, (probe) => app.fetch(probe, c.env, c.executionCtx));
  }
  paywall ??= buildPaywall(c.env);
  return paywall(c, next);
});

for (const e of ENDPOINTS) {
  app.get(e.path, async (c) => c.json(await TOOLS[e.path](c.env, (name) => c.req.query(name))));
}

for (const path of DEFERRED_PATHS) {
  app.get(path, (c) =>
    c.json(
      { error: `${path} is temporarily unavailable: no verified live data source is configured. This request was not charged.` },
      503,
    ),
  );
}

// The same tools over MCP. Listing tools is free; calling one requires payment.
app.all("/mcp", handleMcp);

// Store for people: product pages, orders paid by plain USDC transfer, downloads.
app.route("/", store);

const origin = (url: string) => new URL(url).origin;
app.get("/", async (c) =>
  // Browsers get a readable page, programs get the JSON service card.
  (c.req.header("accept") ?? "").includes("text/html")
    ? c.html(homePage(origin(c.req.url), c.env.PAY_TO, trialsEnabled(c.env), await loadReaderDemo(c.env.ASSETS, origin(c.req.url))))
    : c.json(serviceCard(origin(c.req.url), c.env.PAY_TO, c.env.NETWORK)),
);
app.get("/openapi.json", (c) => {
  const doc = openApi(origin(c.req.url), trialsEnabled(c.env));
  return c.json({ ...doc, paths: { ...doc.paths, ...buyOpenApiPaths() } });
});
app.get("/openapi-marketplace.json", (c) => c.json(marketplaceOpenApi(origin(c.req.url), trialsEnabled(c.env))));
app.get("/llms.txt", (c) => c.text(llmsTxt(origin(c.req.url), trialsEnabled(c.env), c.env.PAY_TO)));
app.get("/guides/local-mcp", c => c.html(localMcpHtml(origin(c.req.url), MCP_SERVER_VERSION)));
app.get("/guides/local-mcp.md", c => c.text(localMcpMarkdown(origin(c.req.url), MCP_SERVER_VERSION)));
app.get("/guides/sitemap", c => c.html(sitemapGuideHtml(origin(c.req.url))));
app.get("/guides/sitemap.md", c => c.text(sitemapGuideMarkdown(origin(c.req.url))));
app.get("/guides/dependency-audit", (c) => c.html(auditGuideHtml(origin(c.req.url), c.env.PAY_TO)));
app.get("/guides/dependency-audit.md", (c) => c.text(auditGuideMarkdown(origin(c.req.url), c.env.PAY_TO)));
for (const kind of ["web-reading", "bitcoin-fees"] as const) {
  app.get(`/guides/${kind}`, async c => c.html(toolGuideHtml(kind, origin(c.req.url), c.env.PAY_TO, kind === "web-reading" ? await loadReaderDemo(c.env.ASSETS, origin(c.req.url)) : undefined)));
  app.get(`/guides/${kind}.md`, c => c.text(toolGuideMarkdown(kind, origin(c.req.url), c.env.PAY_TO)));
}
app.get("/sitemap.xml", (c) => c.body(sitemapXml(origin(c.req.url)), 200, { "Content-Type": "application/xml; charset=utf-8" }));
app.get("/robots.txt", (c) => c.text(robotsTxt(origin(c.req.url))));
app.get("/health", (c) => c.json({ ok: true }));
// Owned buyer instructions only. No installation, wallet work or paid execution.
app.on(["GET","HEAD"],"/skills/index.json",c=>c.json(readerSkillIndex(origin(c.req.url),MCP_SERVER_VERSION)));
app.on(["GET","HEAD"],"/skills/spellzcode-x402-reader/SKILL.md",c=>c.body(readerSkillMarkdown(origin(c.req.url),MCP_SERVER_VERSION),200,{"Content-Type":"text/markdown; charset=utf-8"}));

// Static, generated public examples and client artifacts. No arbitrary-URL proxy or paid work.
const readerAssets = new Set([
  "/clients/reader/1.1.1/reader-client.mjs", "/clients/reader/1.1.1/SHA256SUMS",
  "/clients/reader/1.1.2/reader-client.mjs", "/clients/reader/1.1.2/SHA256SUMS", "/clients/reader/1.1.2/command-builder.js",
  "/clients/reader/1.2.0/reader-client.mjs", "/clients/reader/1.2.0/SHA256SUMS", "/clients/reader/1.2.0/command-builder.js",
  "/clients/reader/1.2.1/reader-client.mjs", "/clients/reader/1.2.1/SHA256SUMS", "/clients/reader/1.2.1/command-builder.js", "/clients/reader/1.2.1/reader-mcp.mjs",
  "/clients/reader/1.3.0/reader-client.mjs", "/clients/reader/1.3.0/SHA256SUMS", "/clients/reader/1.3.0/command-builder.js", "/clients/reader/1.3.0/reader-mcp.mjs",
  "/clients/reader/1.3.0/reader-client.mjs.sha256", "/clients/reader/1.3.0/reader-mcp.mjs.sha256",
  ...["reader-client.mjs","reader-mcp.mjs","command-builder.js","SHA256SUMS","reader-client.mjs.sha256","reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.3.1/${file}`),
  ...["reader-client.mjs","reader-mcp.mjs","command-builder.js","SHA256SUMS","reader-client.mjs.sha256","reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.4.0/${file}`),
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.4.1/${file}`),
  "/examples/extract/section-result.json", "/examples/extract/sources/job-flow.svg",
  ...["source.xml", "index.xml", "result.json", "manifest.json", "index.html"].map(file => `/examples/sitemap/${file}`),
  "/examples/extract/manifest.json", "/examples/extract/index.html", "/examples/extract/benchmark.json",
  ...["technical-guide", "short-article", "long-document"].flatMap(id => [`/examples/extract/${id}.json`, `/examples/extract/sources/${id}.html`]),
]);
app.get("/examples/sitemap", c => c.redirect("/examples/sitemap/", 308));
app.on(["GET", "HEAD"], "/examples/sitemap/", c => c.env.ASSETS.fetch(new Request(new URL("/examples/sitemap/index.html", c.req.url), c.req.raw)));
app.get("/examples/extract", c => c.redirect("/examples/extract/", 308));
app.on(["GET", "HEAD"], "/examples/extract/", c => c.env.ASSETS.fetch(new Request(new URL("/examples/extract/index.html", c.req.url), c.req.raw)));
for (const prefix of ["/examples/extract/*", "/examples/sitemap/*", "/clients/reader/*"]) {
  app.on(["GET", "HEAD"], prefix, async c => readerAssets.has(c.req.path) ? await c.env.ASSETS.fetch(c.req.raw) : c.json({ error: "not found" }, 404));
}
// Daily request counts per paid path. Aggregates only, so it is safe to leave public.
app.get("/metrics", async (c) => {
  if (!c.env.METRICS) return c.json({});
  return c.json(await c.env.METRICS.get(c.env.METRICS.idFromName("global")).report());
});
app.get("/revenue", async (c) => {
  if (!c.env.METRICS) return c.json({ error: "revenue storage unavailable" }, 503);
  return c.json(await c.env.METRICS.get(c.env.METRICS.idFromName("global")).revenueSummary());
});
app.get("/.well-known/x402", (c) =>
  c.json({ version: 1, resources: ENDPOINTS.map((e) => origin(c.req.url) + e.path) }),
);
// Proves to the 402 Index directory that we run this domain. A hash, not a secret.
app.get("/.well-known/402index-verify.txt", (c) => c.text("97ea469f48e8639eaabd19626b4e62fbecf181f91cbb7554b25413a977f2a427"));
app.get("/.well-known/mcp/server-card.json", (c) => c.json(mcpServerCard(origin(c.req.url))));
app.get("/.well-known/api-catalog", (c) =>
  c.body(JSON.stringify(apiCatalog(origin(c.req.url))), 200, { "content-type": "application/linkset+json" }),
);

app.notFound((c) => c.json({ error: "not found", docs: `${origin(c.req.url)}/llms.txt` }, 404));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status);
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
export { Metrics };
