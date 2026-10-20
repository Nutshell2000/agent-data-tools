import { sitemapGuideHtml, sitemapGuideMarkdown } from "./guides/sitemap";
import { sendBatchNow } from "./lib/metrics-batch";
import { localMcpHtml, localMcpMarkdown } from "./guides/local-mcp";
import { readerSkillMarkdown, readerSkillIndex } from "./guides/reader-skill";
import { loadReaderDemo } from "./guides/reader-buying";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware } from "@x402/hono";
import type { RouteConfig } from "@x402/core/server";
import { readable402 } from "./lib/readable-402";
import { browserTrialResultPage, isBrowser } from "./lib/browser-402";
import { toolBySlug, toolDocPage, toolIndexPage } from "./lib/tool-pages";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { payV1, v1Requirements } from "./lib/x402-v1";
import { CAPACITY_LIMITED, ENDPOINTS, PAUSED_FAMILY_TOOLS, READER_VERSION, SERVICE_NAME, apiCatalog, byCategory, homePage, llmsTxt, marketplaceOpenApi, mcpServerCard, openApi, robotsTxt, sitemapXml, serviceCard } from "./discovery";
import { HttpError, trialsEnabled, type Env } from "./lib/env";
import { resourceServer } from "./lib/payments";
import { auditGuideHtml, auditGuideMarkdown } from "./guides/dependency-audit";
import { toolGuideHtml, toolGuideMarkdown } from "./guides/tool-buying";
import { headPaymentProbe } from "./lib/payment-probe";
import { prefersHtml } from "./lib/negotiate";
import { requestMetricsMiddleware } from "./lib/request-metrics";
import { activeTrace, isDiscoveryVisit, isHumanPage, markStage, referrerFamily, withRequestTrace } from "./lib/funnel";
import { handleMcp } from "./mcp";
import { Metrics } from "./metrics";
import { PRODUCTS } from "./store/catalog";
import { buyAssetPreflight, BUY_PATHS, buyOpenApiPaths, store } from "./store/routes";
import { TOOLS } from "./tools";
import { viaMarketplace } from "./lib/marketplace";
import { FAVICON_ICO_BASE64 } from "./lib/favicon";
import { OG_IMAGE_PNG_BASE64 } from "./lib/og-image";
import { FAVICON_SVG, LOGO_PNG_BASE64 } from "./lib/logo";
import { SERVICE_ICON_URL, SUPPORT_EMAIL } from "./endpoints";
import { paymentOptions, priceOn } from "./lib/networks";
import { discoveryResources } from "./lib/discovery-index";
import { apiKeyFrom } from "./lib/credits";
import { chargeCredits, credits, useFreeCall } from "./lib/credit-routes";
import { legal } from "./lib/legal";
import { mppCreditOpenApiPaths, mppEnabled } from "./lib/mpp-credits";
import { payTempo, tempoChallenge, tempoEnabled, tempoProtocol } from "./lib/mpp-tempo";
import { credentialMethod, evmChallenge, evmEnabled, evmProtocol, payEvm } from "./lib/mpp-evm";
import { bazaarExtensionFor, listingTags } from "./lib/bazaar-extension";
import { pickFields } from "./lib/fields";
import { OPENAI_CHAT_PATH, OPENAI_MODELS_PATH, openAiChatCompletions, openAiModels } from "./lib/openai-chat";
import { OPENAI_EMBEDDINGS_PATH, openAiEmbeddings } from "./lib/openai-embeddings";
import { OPENAI_RESPONSES_PATH, openAiResponses } from "./lib/openai-responses";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { grantFromRequest, oauth, unauthorized } from "./lib/oauth";

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
    exposeHeaders: ["WWW-Authenticate", "PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "EXTENSION-RESPONSES", "X-PAYMENT-RESPONSE", "Payment-Receipt", "Mcp-Session-Id", "X-Request-ID"],
  }),
);

// HSTS on every response: the Worker is HTTPS-only, and MCP directories score this header.
app.use(async (c, next) => {
  await next();
  try {
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000");
  } catch {
    c.res = new Response(c.res.body, c.res); // immutable headers (e.g. asset responses): copy first
    c.res.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
});

// A POST to a tool with a flat JSON body ({"url": …}, {"address": …}) is the same call as the GET with those fields
// in the query: agents and directories that default to POST get the quote and a paid answer instead of a 405. It is
// forwarded before tracing and metrics, so only the GET is counted. An empty or unreadable body gets the quote.
app.use(async (c, next) => {
  if (c.req.method !== "POST" || !PAID_PATHS.has(c.req.path)) return next();
  const endpoint = ENDPOINTS.find((e) => e.path === c.req.path);
  if (!endpoint) return next();
  const target = new URL(c.req.url);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [name, value] of Object.entries(body)) {
      if (!(name in endpoint.params) && !["only", "trial", "sample"].includes(name)) continue;
      if (["string", "number", "boolean"].includes(typeof value)) target.searchParams.set(name, String(value));
      else if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) target.searchParams.set(name, value.join(","));
    }
  }
  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return app.fetch(new Request(target.href, { method: "GET", headers }), c.env, c.executionCtx);
});

app.use(async (c, next) => withRequestTrace(c.env, c.req.path, c.req.header("X402-Source") ?? null,
  p => c.executionCtx.waitUntil(p), async () => {
    const id = activeTrace()!.requestId;
    c.header("X-Request-ID", id);
    if (c.req.method === "GET" && ENDPOINTS.some(e => e.path === c.req.path) && c.req.header("payment-signature")) markStage("attempt");
    await next();
    if (isDiscoveryVisit(c.req.method, c.req.path, c.res.status)) markStage("visit");
    // People (browsers) reading the pages that lead to a purchase, and the referrer family they came from.
    if (c.req.method === "GET" && c.res.status === 200 && isHumanPage(c.req.path) && isBrowser(c.req.header("accept"), c.req.header("user-agent"))) {
      markStage("page_view");
      markStage("referral", `/from/${referrerFamily(c.req.header("referer"), new URL(c.req.url).hostname)}`);
    }
    if (c.req.method === "GET" && ENDPOINTS.some(e => e.path === c.req.path)) {
      if (c.res.status === 402 && !c.req.header("payment-signature")) markStage("quote");
      if (c.res.status >= 400 && activeTrace()?.stages.has("verified") && !activeTrace()?.stages.has("settlement_failed")) markStage("execution_failed");
      if (c.res.ok && (c.res.headers.has("PAYMENT-RESPONSE") || c.res.headers.has("Payment-Receipt"))) markStage("completed");
    }
  }));

// Paused store purchases answer 503 here, before the paywall and before the counters: a crawler retrying
// /buy/* is neither a sale nor a server error worth counting against the tools' reliability.
app.use(buyAssetPreflight());

// Counts requests after their response is decided; telemetry never delays or fails it.
app.use(requestMetricsMiddleware(PAID_PATHS, viaMarketplace));


function buildPaywall(env: Env): MiddlewareHandler {
  const routes = Object.fromEntries(
    ENDPOINTS.map((e): [string, RouteConfig] => [
      `GET ${e.path}`,
      {
        accepts: paymentOptions(env).map(({ network, payTo }) => ({ scheme: "exact" as const, price: priceOn(network, e.price), network, payTo })),
        description: e.description,
        mimeType: "application/json",
        serviceName: SERVICE_NAME,
        iconUrl: SERVICE_ICON_URL,
        tags: listingTags(e.tags),
        extensions: { ...bazaarExtensionFor(e) },
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
        iconUrl: SERVICE_ICON_URL,
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

// Cache only a gateway whose initialization finished in its own request.
// Sharing the SDK's pending startup promise lets one interrupted request stall others.
let paywall: MiddlewareHandler | undefined;

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
  // Free preview of what a tool returns: its static documented example, never a live run.
  if (endpoint && c.req.method === "GET" && c.req.query("sample") === "1") {
    return c.json({
      sample: true,
      note: `Static example of what ${endpoint.path} returns; not live data and not charged. Call without sample=1 and pay ${endpoint.price} with any x402 client for a live result.`,
      tool: endpoint.path, price: endpoint.price, example: endpoint.outputExample,
    }, 200, { "X-Sample": "1", "Cache-Control": "public, max-age=3600" });
  }
  // Prepaid card credits: a valid-looking API key replaces the x402 payment for this call.
  const creditKey = endpoint && c.req.method === "GET" ? apiKeyFrom((name) => c.req.header(name)) : undefined;
  if (endpoint && creditKey) return chargeCredits(c, endpoint.price, creditKey, next);
  // MPP clients pay one call with Authorization: Payment: evm/charge (USDC on our x402 network, lib/mpp-evm.ts,
  // on by default) or tempo/charge (lib/mpp-tempo.ts, only while TEMPO_PAY_TO is set). The credential names its method.
  const mppCredential = endpoint && c.req.method === "GET" && (evmEnabled(c.env) || tempoEnabled(c.env)) ? c.req.header("authorization") : undefined;
  if (endpoint && mppCredential && /(^|,)\s*Payment\s/i.test(mppCredential)) {
    const method = credentialMethod(mppCredential);
    if (method === "evm" && evmEnabled(c.env)) return payEvm(c, endpoint, mppCredential, next);
    if (method === "tempo" && tempoEnabled(c.env)) return payTempo(c, endpoint, mppCredential, next);
    markStage("attempt"); markStage("refused_format");
    console.warn(`mpp refused_format ${c.req.path}: credential method ${method ?? "unreadable"} is not offered`);
  }
  // x402 version 1 clients pay with X-PAYMENT (lib/x402-v1.ts); v2 clients use PAYMENT-SIGNATURE below.
  const v1Payment = endpoint && c.req.method === "GET" && !c.req.header("payment-signature") ? c.req.header("x-payment") : undefined;
  if (endpoint && v1Payment) return payV1(c, endpoint, v1Payment, next);
  // Trials cover the per-call tools only, never store purchases.
  const trialable = !c.req.path.startsWith("/buy/");
  if (trialable && c.req.method === "GET" && viaMarketplace(c.env, c.req.header("x-rapidapi-proxy-secret")) && !CAPACITY_LIMITED.has(c.req.path)) return next();
  // Free calls (lib/free-calls.ts): opt-in with trial=1 over HTTP so plain unpaid requests still get the 402.
  if (endpoint && trialable && !CAPACITY_LIMITED.has(c.req.path) && c.req.method === "GET" && c.req.query("trial") === "1" && !c.req.header("payment-signature")) {
    const free = await useFreeCall(c.env, c.req.header("cf-connecting-ip"));
    if (free) {
      await next();
      if (c.res.status >= 400) await free.refund();
      else markStage("free_call");
      c.res.headers.set("X-Free-Trial-Remaining", String(c.res.status >= 400 ? free.left + 1 : free.left));
      // A person who clicked "Run it free" sees the result on a page with what to do next; clients keep the JSON.
      if (c.res.status < 400 && isBrowser(c.req.header("accept"), c.req.header("user-agent")) && (c.res.headers.get("content-type") ?? "").includes("application/json")) {
        const { status } = c.res;
        const headers = new Headers(c.res.headers);
        headers.set("content-type", "text/html; charset=utf-8");
        headers.delete("content-length");
        const page = browserTrialResultPage(endpoint, await c.res.text(), free.left);
        c.res = undefined as never; // Hono copies an existing response's headers into the next one
        c.res = new Response(page, { status, headers });
      }
      return;
    }
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.json({ error: "method not allowed; use GET" }, 405);
  if (c.req.method === "HEAD") {
    return headPaymentProbe(c.req.raw, (probe) => app.fetch(probe, c.env, c.executionCtx));
  }
  const candidate = paywall ?? buildPaywall(c.env);
  const result = await candidate(c, next);
  if (c.res.status < 500) paywall ??= candidate;
  const response = result instanceof Response ? result : c.res;
  // A signed v2 request answered 402 is a refused payment. The hooks in lib/payments.ts cover facilitator
  // rejections; anything else (no matching terms, unreadable header) is refused by the library before verify.
  if (response.status === 402 && c.req.header("payment-signature")) {
    const trace = activeTrace();
    if (!trace?.stages.has("verification_failed") && !trace?.stages.has("facilitator_unavailable")) {
      const reason = decodedChallengeError(response.headers.get("payment-required"));
      const stage = /network|chain|unsupported/i.test(reason) ? "refused_network" : /amount|price|value/i.test(reason) ? "refused_amount" : "refused_format";
      markStage(stage);
      console.warn(`x402 v2 ${stage} ${c.req.path}: ${reason}`);
    }
  }
  if (!(result instanceof Response)) return result;
  const answer = await readable402(result, origin(c.req.url), Boolean(endpoint) && trialsEnabled(c.env) && !CAPACITY_LIMITED.has(c.req.path), endpoint ? v1Requirements(c.env, endpoint, c.req.url) : [], endpoint ? { endpoint, url: c.req.url } : undefined);
  // The same call offered over MPP next to the x402 terms: evm/charge (on by default) and tempo/charge (while
  // TEMPO_PAY_TO is set), as separate challenges in one WWW-Authenticate header.
  if (answer.status !== 402 || !endpoint) return answer;
  const offers: string[] = [];
  // A broken MPP setup must never take the x402 quote down with it: the x402 terms go out alone then.
  // Tempo goes first: AgentCash's client (mppx 0.8) reads only the first Payment challenge and pays only on Tempo, so
  // with evm first its buyers were refused for an "unsupported token". Newer mppx clients pick by method either way.
  if (tempoEnabled(c.env)) offers.push(await tempoChallenge(c, endpoint).catch((e) => { console.error("mpp tempo challenge failed", e); return ""; }));
  if (evmEnabled(c.env)) offers.push(await evmChallenge(c, endpoint).catch((e) => { console.error("mpp evm challenge failed", e); return ""; }));
  const live = offers.filter(Boolean);
  if (!live.length) return answer;
  const withMpp = new Response(answer.body, answer);
  withMpp.headers.delete("WWW-Authenticate");
  for (const offer of live) withMpp.headers.append("WWW-Authenticate", offer);
  return withMpp;
});

/** The `error` the v2 library put in a 402's PAYMENT-REQUIRED header, for logs; never the request's payment data. */
function decodedChallengeError(header: string | null): string {
  if (!header) return "no PAYMENT-REQUIRED header";
  try { return String(decodePaymentRequiredHeader(header).error ?? "payment refused").slice(0, 160); } catch { return "unreadable PAYMENT-REQUIRED header"; }
}

for (const e of ENDPOINTS) {
  app.get(e.path, async (c) => c.json(pickFields(await TOOLS[e.path](c.env, (name) => c.req.query(name)), c.req.query("only"))));
}

for (const [path, reason] of Object.entries(PAUSED_FAMILY_TOOLS)) {
  app.all(path, c => c.json({ code: "TOOL_PAUSED", error: reason + " This request was not charged." }, 503));
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
app.all("/mcp", (c) => handleMcp(c));
// Signed-in MCP (OAuth, lib/oauth.ts): what app directories list. Registered before /mcp/:bundle.
app.all("/mcp/account", async (c) => {
  const grant = await grantFromRequest(c.env, c.req.header("authorization"));
  return grant ? handleMcp(c, "", undefined, grant) : unauthorized(c);
});
app.all("/mcp/account/:bundle", async (c) => {
  const grant = await grantFromRequest(c.env, c.req.header("authorization"));
  return grant ? handleMcp(c, c.req.param("bundle"), undefined, grant) : unauthorized(c);
});
app.all("/mcp/:bundle", (c) => handleMcp(c, c.req.param("bundle")));
// Card-credit key in the connector URL, for MCP clients that cannot send headers (Claude.ai, ChatGPT and others).
app.all("/mcp/k/:key", (c) => handleMcp(c, "", c.req.param("key")));
app.all("/mcp/k/:key/:bundle", (c) => handleMcp(c, c.req.param("bundle"), c.req.param("key")));

// Card payments: prepaid credits and their API keys.
// OpenAI-compatible chat completions (lib/openai-chat.ts): a front for /ai/chat that goes through the same
// middleware, so every payment path and price applies unchanged. POST takes the OpenAI body; GET takes the same
// inputs in the query (directories that index every route as GET send agents that way). GET /v1/models is free.
app.on(["GET", "HEAD", "POST"], OPENAI_CHAT_PATH, (c) => openAiChatCompletions(c, (req) => app.fetch(req, c.env, c.executionCtx)));
app.get(OPENAI_MODELS_PATH, (c) => c.json(openAiModels(), 200, { "Cache-Control": "public, max-age=3600" }));
app.on(["GET", "HEAD", "POST"], OPENAI_RESPONSES_PATH, (c) => openAiResponses(c, (req) => app.fetch(req, c.env, c.executionCtx)));
app.on(["GET", "HEAD", "POST"], OPENAI_EMBEDDINGS_PATH, (c) => openAiEmbeddings(c, (req) => app.fetch(req, c.env, c.executionCtx)));

app.route("/", credits);
// Privacy policy, terms and support.
app.route("/", legal);
// OAuth sign-in for MCP apps.
app.route("/", oauth);

// Store for people: product pages, orders paid by plain USDC transfer, downloads.
app.route("/", store);

const origin = (url: string) => new URL(url).origin;
app.get("/", async (c) =>
  // Browsers and directory scrapers get a readable page, programs get the JSON service card.
  prefersHtml(c.req.header("accept"), c.req.header("user-agent"))
    ? c.html(homePage(origin(c.req.url), c.env.PAY_TO, trialsEnabled(c.env), await loadReaderDemo(c.env.ASSETS, origin(c.req.url))))
    : c.json(serviceCard(origin(c.req.url), c.env.PAY_TO, c.env.NETWORK)),
);
// Every agent that discovers us downloads this; it only changes with a deploy, so build it once per isolate.
const openApiDocs = new Map<string, string>();
app.get("/openapi.json", (c) => {
  const mpp = mppEnabled(c.env);
  const offers = [...(tempoEnabled(c.env) ? [tempoProtocol(c.env)] : []), ...(evmEnabled(c.env) ? [evmProtocol(c.env)] : [])];
  const key = `${origin(c.req.url)}|${trialsEnabled(c.env)}|${mpp}|${offers.map((o) => `${o.mpp.method}:${o.mpp.currency}`).join(",")}`;
  let body = openApiDocs.get(key);
  if (!body) {
    const doc = openApi(origin(c.req.url), trialsEnabled(c.env), offers);
    // MPP credit packs are listed only while agent card payments are switched on, so a listed route always pays.
    body = JSON.stringify({ ...doc, paths: { ...doc.paths, ...buyOpenApiPaths(), ...(mpp ? mppCreditOpenApiPaths() : {}) } });
    openApiDocs.set(key, body);
  }
  return c.body(body, 200, { "content-type": "application/json; charset=UTF-8" });
});
app.get("/openapi-marketplace.json", (c) => c.json(marketplaceOpenApi(origin(c.req.url), trialsEnabled(c.env))));
app.get("/llms.txt", (c) => c.text(llmsTxt(origin(c.req.url), trialsEnabled(c.env), c.env.PAY_TO)));
app.get("/guides/local-mcp", c => c.html(localMcpHtml(origin(c.req.url), READER_VERSION)));
app.get("/guides/local-mcp.md", c => c.text(localMcpMarkdown(origin(c.req.url), READER_VERSION)));
app.get("/guides/sitemap", c => c.html(sitemapGuideHtml(origin(c.req.url))));
app.get("/guides/sitemap.md", c => c.text(sitemapGuideMarkdown(origin(c.req.url))));
app.get("/guides/dependency-audit", (c) => c.html(auditGuideHtml(origin(c.req.url), c.env.PAY_TO)));
app.get("/guides/dependency-audit.md", (c) => c.text(auditGuideMarkdown(origin(c.req.url), c.env.PAY_TO)));
for (const kind of ["web-reading", "bitcoin-fees"] as const) {
  app.get(`/guides/${kind}`, async c => c.html(toolGuideHtml(kind, origin(c.req.url), c.env.PAY_TO, kind === "web-reading" ? await loadReaderDemo(c.env.ASSETS, origin(c.req.url)) : undefined)));
  app.get(`/guides/${kind}.md`, c => c.text(toolGuideMarkdown(kind, origin(c.req.url), c.env.PAY_TO)));
}
app.get("/tools", (c) => c.html(toolIndexPage(origin(c.req.url), byCategory())));
app.get("/tools/:slug", (c) => {
  const tool = toolBySlug(c.req.param("slug"));
  // Capacity-limited tools (AI, rendering, transcription, search) are outside the free calls, so no free button.
  return tool ? c.html(toolDocPage(tool, origin(c.req.url), trialsEnabled(c.env) && !CAPACITY_LIMITED.has(tool.path))) : c.notFound();
});
// IndexNow (Bing, Yandex, Seznam, Naver): the key is public by design; it proves the submitter controls this host.
const INDEXNOW_KEY = "d0d511e1d96310e1565397ebc5e3fe54";
app.get(`/${INDEXNOW_KEY}.txt`, (c) => c.text(INDEXNOW_KEY));
app.get("/sitemap.xml", (c) => c.body(sitemapXml(origin(c.req.url)), 200, { "Content-Type": "application/xml; charset=utf-8" }));
app.get("/robots.txt", (c) => c.text(robotsTxt(origin(c.req.url))));
const FAVICON = Uint8Array.from(atob(FAVICON_ICO_BASE64), (ch) => ch.charCodeAt(0));
app.get("/favicon.ico", (c) => c.body(FAVICON, 200, { "Content-Type": "image/x-icon", "Cache-Control": "public, max-age=86400" }));
const LOGO = Uint8Array.from(atob(LOGO_PNG_BASE64), (ch) => ch.charCodeAt(0));
for (const path of ["/logo.png", "/favicon.png", "/apple-touch-icon.png"]) app.get(path, (c) => c.body(LOGO, 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }));
// VerifyMCP ownership claim (https://verifymcp.io/docs/build/owners-json): host-wide and for /mcp.
for (const path of ["/.well-known/owners.json", "/mcp/.well-known/owners.json"]) {
  app.get(path, (c) => c.json({ $schema: "https://verifymcp.io/schemas/owners.json", owners: [SUPPORT_EMAIL] }, 200, { "Cache-Control": "public, max-age=3600" }));
}
app.get("/favicon.svg", (c) => c.body(FAVICON_SVG, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" }));
const OG_IMAGE = Uint8Array.from(atob(OG_IMAGE_PNG_BASE64), (ch) => ch.charCodeAt(0));
app.get("/og.png", (c) => c.body(OG_IMAGE, 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }));
app.get("/health", (c) => c.json({ ok: true }));
// Owned buyer instructions only. No installation, wallet work or paid execution.
app.on(["GET","HEAD"],"/skills/index.json",c=>c.json(readerSkillIndex(origin(c.req.url),READER_VERSION)));
app.on(["GET","HEAD"],"/skills/spellzcode-x402-reader/SKILL.md",c=>c.body(readerSkillMarkdown(origin(c.req.url),READER_VERSION),200,{"Content-Type":"text/markdown; charset=utf-8"}));

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
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.5.0/${file}`),
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.5.1/${file}`),
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.6.0/${file}`),
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.7.0/${file}`),
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.7.1/${file}`),
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.7.2/${file}`),
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.7.3/${file}`),
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.7.4/${file}`),
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.7.5/${file}`),
  ...["reader-client.mjs", "reader-mcp.mjs", "command-builder.js", "SHA256SUMS", "reader-client.mjs.sha256", "reader-mcp.mjs.sha256"].map(file=>`/clients/reader/1.7.6/${file}`),
  "/examples/extract/section-result.json", "/examples/extract/sources/job-flow.svg",
  "/examples/extract/markdown-guide.json", "/examples/extract/sources/markdown-guide.md",
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
  const metrics = c.env.METRICS.get(c.env.METRICS.idFromName("global"));
  await sendBatchNow(metrics);
  return c.json(await metrics.report());
});
// Requests per day by calling software family (bots, HTTP libraries, agents) and outcome.
// Only the software name is stored, never the full User-Agent or any caller address.
app.get("/metrics/callers", async (c) => {
  if (!c.env.METRICS) return c.json({});
  const metrics = c.env.METRICS.get(c.env.METRICS.idFromName("global"));
  await sendBatchNow(metrics);
  const [http, mcp] = await Promise.all([metrics.callers(), metrics.mcpClients()]);
  return c.json({ http, mcpConnections: mcp });
});
// Reliability per tool over 7 days: executed calls only (unpaid quotes are not counted).
app.get("/status", async (c) => {
  const generatedAt = new Date().toISOString();
  const note = "Counts calls the tool actually ran (paid, marketplace or trial). successRate excludes caller errors (4xx), which are never charged; server errors (5xx) are never charged either.";
  if (!c.env.METRICS) return c.json({ generatedAt, note, windowDays: 7, served: 0, serverErrors: 0, successRate: null, tools: [] });
  const metrics = c.env.METRICS.get(c.env.METRICS.idFromName("global"));
  await sendBatchNow(metrics);
  return c.json({ generatedAt, note, ...await metrics.status(ENDPOINTS.map((e) => e.path)) });
});
/** True when `header` is "Bearer <token>" for the configured token; digests compared, so no early exit on a prefix. */
async function ownerToken(token: string | undefined, header: string | undefined): Promise<boolean> {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(token), digest(header.slice(7))]);
  return a.every((byte, i) => byte === b[i]);
}
app.get("/revenue", async (c) => {
  if (!c.env.METRICS) return c.json({ error: "revenue storage unavailable" }, 503);
  const global = c.env.METRICS.get(c.env.METRICS.idFromName("global"));
  await sendBatchNow(global);
  const x402 = await global.revenueSummary();
  // Card-credit sales are private business figures: shown only with the owner's REVENUE_TOKEN.
  if (!(await ownerToken(c.env.REVENUE_TOKEN, c.req.header("authorization")))) return c.json(x402);
  const cardCredits = await c.env.METRICS.get(c.env.METRICS.idFromName("credits")).creditSummary();
  return c.json({ ...x402, cardCredits });
});
// The resource manifest, also at the ".json" spelling some crawlers (gold-402 entries, agent kits) look for.
for (const path of ["/.well-known/x402", "/.well-known/x402.json"]) {
  app.get(path, (c) => c.json({ version: 1, resources: ENDPOINTS.map((e) => origin(c.req.url) + e.path), discovery: `${origin(c.req.url)}/discovery/resources` }));
}
// Bazaar-shaped discovery index of every tool (lib/discovery-index.ts): paged like the facilitator's own.
app.get("/discovery/resources", (c) =>
  c.json(discoveryResources(c.env, origin(c.req.url), Number(c.req.query("limit")), Number(c.req.query("offset"))), 200, { "Cache-Control": "public, max-age=300" }),
);
// Proves to the 402 Index directory that we run this domain. A hash, not a secret.
app.get("/.well-known/402index-verify.txt", (c) => c.text("97ea469f48e8639eaabd19626b4e62fbecf181f91cbb7554b25413a977f2a427"));
// Glama connector ownership claim (public token bound to our Glama account; keep it published).
app.get("/.well-known/glama.json", (c) => c.json({ $schema: "https://glama.ai/mcp/schemas/connector.json", claim: "glama_claim_n6dyHp-kpVDnsj1SvyWEhoeenwlxpGQj" }));
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
