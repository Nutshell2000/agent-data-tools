const assert = require("node:assert/strict");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const { Hono } = require("hono");

async function loadTypeScript(entry, plugins = []) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins,
  });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let Metrics;
let metricsTest;
let productUsdMicros;
let queueMetricBump;
let requestMetricsMiddleware;
let sendBatchNow;
let settledApiRevenueMicros;
let settledMcpRevenueMicros;
let usdMicros;
let withMcpRevenue;

before(async () => {
  const workersStub = {
    name: "cloudflare-workers-test-stub",
    setup(build) {
      build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "workers", namespace: "test" }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
        contents: "export class DurableObject { constructor(ctx) { this.ctx = ctx; } }",
        loader: "js",
      }));
    },
  };
  ({ Metrics, __test: metricsTest } = await loadTypeScript(require.resolve("../src/metrics.ts"), [workersStub]));
  ({
    productUsdMicros,
    queueMetricBump,
    withMcpRevenue,
    settledApiRevenueMicros,
    settledMcpRevenueMicros,
    usdMicros,
  } = await loadTypeScript(require.resolve("../src/lib/revenue.ts")));
  ({ requestMetricsMiddleware } = await loadTypeScript(require.resolve("../src/lib/request-metrics.ts")));
  ({ sendBatchNow } = await loadTypeScript(require.resolve("../src/lib/metrics-batch.ts")));
});

function createMetrics(initial = new Map()) {
  const records = initial;
  let pending = Promise.resolve();
  const read = async (key) => structuredClone(records.get(key));
  const write = async (key, value) => records.set(key, structuredClone(value));
  const storage = {
    get: read,
    put: write,
    async list({ prefix, reverse, limit }) {
      let entries = [...records].filter(([key]) => key.startsWith(prefix));
      if (reverse) entries.reverse();
      return new Map(entries.slice(0, limit));
    },
    transaction(callback) {
      const result = pending.then(() => callback({ get: read, put: write }));
      pending = result.catch(() => {});
      return result;
    },
    async setAlarm() {},
  };
  return { metrics: new Metrics({ storage }), records };
}

const today = new Date().toISOString().slice(0, 10);
const dayKey = `day:${today}`;
const successfulSettlement = Buffer.from(JSON.stringify({ success: true })).toString("base64");

test("converts catalog prices to exact USD micro-units", () => {
  assert.equal(usdMicros("$0.20"), 200_000);
  assert.equal(usdMicros("$0.0002"), 200);
  assert.equal(usdMicros("$0.000001"), 1);
  assert.equal(usdMicros("$2"), 2_000_000);
  assert.equal(usdMicros("$0.0000001"), null);
  assert.equal(usdMicros("$1e-6"), null);
  assert.equal(productUsdMicros(1.9), 1_900_000);
  assert.equal(productUsdMicros(Number.NaN), null);
  assert.equal(productUsdMicros(Number.POSITIVE_INFINITY), null);
  assert.equal(productUsdMicros(Number.MAX_SAFE_INTEGER), null);
});

test("tracks only successful settled x402 catalog calls and product purchases", () => {
  const headers = new Headers({ "PAYMENT-RESPONSE": successfulSettlement });
  assert.equal(settledApiRevenueMicros("/package-audit", "paid", headers), 200_000);
  assert.equal(settledApiRevenueMicros("/buy/x402-seller-kit", "paid", headers), 1_900_000);
  assert.equal(settledApiRevenueMicros("/package-audit", "paid", new Headers()), undefined);
  assert.equal(settledApiRevenueMicros("/buy/x402-seller-kit", "paid", new Headers()), undefined);
  assert.equal(
    settledApiRevenueMicros("/package-audit", "paid", new Headers({ "PAYMENT-RESPONSE": Buffer.from('{"success":false}').toString("base64") })),
    undefined,
  );
  assert.equal(
    settledApiRevenueMicros("/buy/x402-seller-kit", "paid", new Headers({ "PAYMENT-RESPONSE": Buffer.from('{"success":false}').toString("base64") })),
    undefined,
  );
  assert.equal(settledApiRevenueMicros("/buy/unknown-product", "paid", headers), undefined);
  assert.equal(settledApiRevenueMicros("/store/x402-seller-kit", "paid", headers), undefined);
  assert.equal(settledApiRevenueMicros("/buy/x402-seller-kit", "marketplace", headers), undefined);
  for (const outcome of ["challenged", "unsettled", "trial", "failed", "marketplace"]) {
    assert.equal(settledApiRevenueMicros("/package-audit", outcome, headers), undefined);
  }
});

test("tracks MCP revenue only from successful structured settlements", () => {
  const meta = { "x402/payment-response": { success: true } };
  assert.equal(settledMcpRevenueMicros("/package-audit", { _meta: meta }), 200_000);
  assert.equal(settledMcpRevenueMicros("/package-audit", {}), undefined);
  assert.equal(settledMcpRevenueMicros("/package-audit", { _meta: { "x402/payment-response": { success: false } } }), undefined);
  assert.equal(settledMcpRevenueMicros("/package-audit", { isError: true, _meta: meta }), undefined);
  assert.equal(settledMcpRevenueMicros("/buy/x402-seller-kit", { _meta: meta }), undefined);
});

test("HTTP middleware records settled product revenue and excludes missing or failed settlements", async () => {
  const { metrics } = createMetrics();
  const pending = [];
  const app = new Hono();
  app.use(
    requestMetricsMiddleware(new Set(["/buy/x402-seller-kit"]), (_env, sent) => sent === "marketplace"),
  );
  app.get("/buy/x402-seller-kit", (c) => {
    const mode = c.req.query("mode");
    if (mode === "challenge") return c.json({ error: "payment required" }, 402, { "PAYMENT-RESPONSE": successfulSettlement });
    if (mode === "trial") return c.json({ ok: true }, 200, {
      "PAYMENT-RESPONSE": successfulSettlement,
      "X-Free-Trial-Remaining": "9",
    });
    if (mode === "failed-http") return c.json({ error: "failed" }, 503, { "PAYMENT-RESPONSE": successfulSettlement });
    if (mode === "invalid") return c.json({ ok: true }, 200, { "PAYMENT-RESPONSE": "not-a-valid-settlement" });
    const headers =
      mode === "missing"
        ? undefined
        : {
            "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: mode !== "failed" })).toString("base64"),
          };
    return c.json({ ok: true }, 200, headers);
  });
  const env = { METRICS: { idFromName: () => "global", get: () => metrics } };
  const executionCtx = { waitUntil: (promise) => pending.push(promise) };
  for (const mode of ["success", "failed", "missing", "invalid", "marketplace", "challenge", "trial", "failed-http"]) {
    const headers = mode === "marketplace" ? { "x-rapidapi-proxy-secret": "marketplace" } : undefined;
    await app.fetch(new Request(`https://example.test/buy/x402-seller-kit?mode=${mode}`, { headers }), env, executionCtx);
    await sendBatchNow(metrics); await Promise.all(pending.splice(0)); // sending ends the batch's self-send wait
  }

  const row = (await sendBatchNow(metrics), await metrics.report())[today]["/buy/x402-seller-kit"];
  assert.equal(row.revenueUsdMicros, 1_900_000);
  assert.equal(row.trackedPaidCalls, 1);
  assert.equal(row.paid, 1);
  assert.equal(row.unsettled, 3);
  assert.equal(row.marketplace, 1);
  assert.equal(row.challenged, 1);
  assert.equal(row.trial, 1);
  assert.equal(row.failed, undefined);
  assert.equal(row.errored, 1);
  // Callers are recorded by software family only: these requests send no User-Agent.
  const callers = (await metrics.callers())[today];
  assert.equal(callers.rapidapi.marketplace, 1);
  assert.equal(callers.none.challenged, 1);
  assert.equal(callers.none.paid, 1);
});

test("persists revenue and tracked-call count only for paid outcomes", async () => {
  const { metrics } = createMetrics();
  await Promise.all([
    metrics.bump("/package-audit", "paid", 200_000),
    metrics.bump("/package-audit", "challenged", 200_000),
    metrics.bump("/package-audit", "trial", 200_000),
    metrics.bump("/package-audit", "failed", 200_000),
    metrics.bump("/package-audit", "marketplace", 200_000),
    metrics.bump("/package-audit", "unsettled", 200_000),
  ]);
  const pathMetrics = (await sendBatchNow(metrics), await metrics.report())[today]["/package-audit"];
  assert.equal(pathMetrics.paid, 1);
  assert.equal(pathMetrics.challenged, 1);
  assert.equal(pathMetrics.trial, 1);
  assert.equal(pathMetrics.failed, 1);
  assert.equal(pathMetrics.marketplace, 1);
  assert.equal(pathMetrics.unsettled, 1);
  assert.equal(pathMetrics.revenueUsdMicros, 200_000);
  assert.equal(pathMetrics.trackedPaidCalls, 1);
});

test("preserves legacy paid counts without backfilling revenue", async () => {
  const { metrics } = createMetrics(new Map([
    [dayKey, { "/package-audit": { paid: 7, challenged: 3 } }],
  ]));
  const before = (await sendBatchNow(metrics), await metrics.report())[today]["/package-audit"];
  assert.equal(before.paid, 7);
  assert.equal(before.revenueUsdMicros, undefined);
  assert.equal(before.trackedPaidCalls, undefined);

  await metrics.bump("/package-audit", "paid", 200_000);
  const after = (await sendBatchNow(metrics), await metrics.report())[today]["/package-audit"];
  assert.equal(after.paid, 8);
  assert.equal(after.revenueUsdMicros, 200_000);
  assert.equal(after.trackedPaidCalls, 1);
});

test("records HTTP and MCP settlements once and excludes non-settled outcomes", async () => {
  const { metrics } = createMetrics();
  const pending = [];
  const waitUntil = (promise) => pending.push(promise);
  const trackHttp = (path, headers) => {
    const revenue = settledApiRevenueMicros(path, "paid", headers);
    const outcome = revenue === undefined ? "unsettled" : "paid";
    queueMetricBump(metrics, waitUntil, path, outcome, revenue);
  };

  trackHttp("/package-audit", new Headers({ "PAYMENT-RESPONSE": successfulSettlement }));
  await sendBatchNow(metrics); await Promise.all(pending.splice(0)); // sending ends the batch's self-send wait
  let row = (await sendBatchNow(metrics), await metrics.report())[today]["/package-audit"];
  assert.equal(row.revenueUsdMicros, 200_000);
  assert.equal(row.trackedPaidCalls, 1);

  const mcpCallback = withMcpRevenue(
    "/package-audit",
    async () => ({ _meta: { "x402/payment-response": { success: true } } }),
    () => metrics,
    waitUntil,
  );
  await mcpCallback();
  await sendBatchNow(metrics); await Promise.all(pending.splice(0)); // sending ends the batch's self-send wait
  row = (await sendBatchNow(metrics), await metrics.report())[today]["/package-audit"];
  assert.equal(row.revenueUsdMicros, 400_000);
  assert.equal(row.trackedPaidCalls, 2);
  assert.equal(row.paid, 2);

  const failedMcpCallback = withMcpRevenue(
    "/package-audit",
    async () => ({ isError: true, _meta: { "x402/payment-response": { success: true } } }),
    () => metrics,
    waitUntil,
  );
  await failedMcpCallback();
  const missingMcpCallback = withMcpRevenue(
    "/package-audit",
    async () => ({}),
    () => metrics,
    waitUntil,
  );
  await missingMcpCallback();
  await sendBatchNow(metrics); await Promise.all(pending.splice(0)); // sending ends the batch's self-send wait

  trackHttp("/buy/x402-seller-kit", new Headers({ "PAYMENT-RESPONSE": successfulSettlement }));
  await sendBatchNow(metrics); await Promise.all(pending.splice(0)); // sending ends the batch's self-send wait
  const purchaseRow = (await sendBatchNow(metrics), await metrics.report())[today]["/buy/x402-seller-kit"];
  assert.equal(purchaseRow.revenueUsdMicros, 1_900_000);
  assert.equal(purchaseRow.trackedPaidCalls, 1);

  queueMetricBump(metrics, waitUntil, "/package-audit", "challenged", 200_000);
  queueMetricBump(metrics, waitUntil, "/package-audit", "trial", 200_000);
  queueMetricBump(metrics, waitUntil, "/package-audit", "failed", 200_000);
  trackHttp("/package-audit", new Headers());
  await sendBatchNow(metrics); await Promise.all(pending.splice(0)); // sending ends the batch's self-send wait

  row = (await sendBatchNow(metrics), await metrics.report())[today]["/package-audit"];
  assert.equal(row.challenged, 1);
  assert.equal(row.trial, 1);
  assert.equal(row.failed, 1);
  assert.equal(row.paid, 2);
  assert.equal(row.unsettled, 1);
  assert.equal(row.revenueUsdMicros, 400_000);
  assert.equal(row.trackedPaidCalls, 2);
});

test("status reports success rate and last success from executed calls only", async () => {
  const { metrics } = createMetrics();
  for (const outcome of ["paid", "marketplace", "errored", "failed", "challenged", "challenged"]) await metrics.bump("/base/balance", outcome);
  const status = await metrics.status(["/base/balance", "/never-called"]);
  const [called, idle] = status.tools;
  assert.deepEqual([called.served, called.serverErrors, called.buyerErrors, called.successRate], [2, 1, 1, 0.667]);
  assert.match(called.lastSuccessAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual([idle.served, idle.successRate, idle.lastSuccessAt], [0, null, null]);
  assert.deepEqual([status.windowDays, status.served, status.serverErrors], [7, 2, 1]);
});

test("caller family names the software, never the full User-Agent", async () => {
  const { callerFamily } = await loadTypeScript(require.resolve("../src/lib/caller.ts"));
  assert.equal(callerFamily("Mozilla/5.0 (compatible; x402scan/1.0; +https://x402.org)"), "x402scan");
  assert.equal(callerFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0"), "browser");
  assert.equal(callerFamily("python-requests/2.32.3"), "python-requests");
  assert.equal(callerFamily("Go-http-client/2.0"), "go-http-client");
  assert.equal(callerFamily("agentcash/0.17.1 (+https://agentcash.dev)"), "agentcash");
  assert.equal(callerFamily("node"), "node");
  assert.equal(callerFamily(undefined), "none");
  assert.equal(callerFamily("  "), "none");
  assert.equal(callerFamily("123 weird"), "other");
  assert.equal(callerFamily("curl/8.7.1", true), "rapidapi");
  assert.ok(callerFamily("x".repeat(500)).length <= 32);
});

test("caller counts are per day and family, capped at 60 families with the rest as other", async () => {
  const { metrics } = createMetrics();
  for (let i = 0; i < 65; i++) await metrics.bump("/extract", "challenged", undefined, `bot${i}`);
  await metrics.bump("/extract", "challenged", undefined, "bot0");
  await metrics.bump("/extract", "paid", 2000);
  const day = (await metrics.callers())[today];
  assert.equal(Object.keys(day).length, 61);
  assert.equal(day.bot0.challenged, 2);
  assert.equal(day.other.challenged, 5);
  assert.equal(day.bot64, undefined);
});

test("MCP client name comes from initialize only, sanitized", async () => {
  const { mcpClientName } = await loadTypeScript(require.resolve("../src/lib/caller.ts"));
  const init = (name) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name, version: "1" } } });
  assert.equal(mcpClientName(init("claude-ai")), "claude-ai");
  assert.equal(mcpClientName(init("Cursor (VS Code) <script>")), "cursorvscodescript");
  assert.equal(mcpClientName(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })), "unnamed");
  assert.equal(mcpClientName(JSON.stringify([{ jsonrpc: "2.0", method: "notifications/initialized" }, JSON.parse(init("openai-mcp"))])), "openai-mcp");
  assert.equal(mcpClientName(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} })), undefined);
  assert.equal(mcpClientName("not json"), undefined);
});

test("unpaid counter updates reach the Metrics object in one batched call; paid ones go at once", async () => {
  const { metrics } = createMetrics();
  let ingests = 0, bumps = 0;
  const target = { ingest: (b) => { ingests++; return metrics.ingest(b); }, bump: (...a) => { bumps++; return metrics.bump(...a); } };
  const pending = [], paid = [];
  for (let i = 0; i < 300; i++) queueMetricBump(target, (p) => pending.push(p), "/weather", "challenged", undefined, "crawler");
  queueMetricBump(target, (p) => paid.push(p), "/weather", "paid", 3000);
  await Promise.all(paid);
  assert.equal(ingests, 0, "unpaid updates wait for the batch window");
  assert.equal(bumps, 1, "a paid outcome is sent at once");
  await sendBatchNow(target);
  await Promise.all(pending); // the batch's own send timer ends at once and sends nothing more
  assert.equal(ingests, 1, "one call per batch");
  const row = (await metrics.report())[today]["/weather"];
  assert.deepEqual([row.challenged, row.paid, row.revenueUsdMicros], [300, 1, 3000]);
});

test("an isolate with no later request sends its batch itself after the window", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { metrics } = createMetrics();
  let ingests = 0;
  const target = { ingest: (b) => { ingests++; return metrics.ingest(b); }, bump: (...a) => metrics.bump(...a) };
  const pending = [];
  for (let i = 0; i < 3; i++) queueMetricBump(target, (p) => pending.push(p), "/time", "challenged");
  assert.equal(ingests, 0);
  t.mock.timers.tick(10_000);
  await Promise.all(pending);
  assert.equal(ingests, 1, "sent once, without a later request or a report read");
  assert.equal((await metrics.report())[today]["/time"].challenged, 3);
});

test("counters are buffered and written once per flush, and kept when a write fails", async () => {
  const { metrics, records } = createMetrics();
  metrics.lastFlushMs = Date.now(); // a busy object that has just written
  for (let i = 0; i < 500; i++) await metrics.bump("/weather", "challenged", undefined, "crawler");
  await metrics.bumpMcpClient("glama", "open");
  assert.equal(records.size, 0, "nothing is written per request");
  // Reads include unwritten counts without writing (a failed write would reset the object mid-read).
  assert.equal((await sendBatchNow(metrics), await metrics.report())[today]["/weather"].challenged, 500);
  assert.equal((await metrics.callers())[today].crawler.challenged, 500);
  assert.equal((await metrics.status(["/weather"])).tools[0].buyerErrors, 0);
  assert.equal(records.size, 0, "reads do not write");
  await metrics.alarm();
  assert.equal(records.get(dayKey)["/weather"].challenged, 500);
  assert.equal(records.get(`callers:${today}`).crawler.challenged, 500);
  assert.equal(records.get(`mcpclients:${today}`).glama.open, 1);
  // A write over the storage limit keeps the counts for the next flush instead of losing them.
  const failing = createMetrics();
  failing.metrics.lastFlushMs = Date.now();
  await failing.metrics.bump("/weather", "challenged");
  const realTransaction = failing.metrics.ctx.storage.transaction;
  failing.metrics.ctx.storage.transaction = async () => { throw new Error("Exceeded allowed rows written"); };
  await assert.rejects(failing.metrics.alarm(), /Exceeded/);
  failing.metrics.ctx.storage.transaction = realTransaction;
  await failing.metrics.bump("/weather", "challenged");
  assert.equal((await failing.metrics.report())[today]["/weather"].challenged, 2);
  // After the limit error no buffered write is tried until 00:00 UTC (a failed write would reset the object).
  assert.equal(metricsTest.writesBlocked(), true);
  await failing.metrics.alarm();
  assert.equal(failing.records.size, 0);
  metricsTest.unblockWrites();
  await failing.metrics.alarm();
  assert.equal(failing.records.get(dayKey)["/weather"].challenged, 2);
});

test("a paid call is written at once, and a quiet object writes its first update at once, so eviction loses neither", async () => {
  // Staging, 21 Oct: a paid call's count was in /metrics at once and gone two minutes later, and a lone quote's
  // count never arrived, because the idle object was evicted with its memory before its alarm.
  const { metrics, records } = createMetrics();
  metrics.lastFlushMs = Date.now();
  await metrics.bump("/weather", "challenged", undefined, "crawler");
  assert.equal(records.size, 0, "a busy object buffers");
  await metrics.bump("/check/counterparty", "paid", 30_000, "node");
  const row = records.get(dayKey);
  assert.equal(row["/check/counterparty"].trackedPaidCalls, 1, "no alarm needed");
  assert.equal(row["/check/counterparty"].revenueUsdMicros, 30_000);
  assert.equal(row["/weather"].challenged, 1, "the buffered counts go with it");
  const evicted = new Metrics({ storage: metrics.ctx.storage });
  assert.equal((await evicted.report())[today]["/check/counterparty"].trackedPaidCalls, 1);

  const quiet = createMetrics();
  await quiet.metrics.ingest({ bumps: [["/weather", "challenged", undefined, "crawler"]], funnel: [], mcp: [] });
  assert.equal(quiet.records.get(dayKey)["/weather"].challenged, 1, "the first update of a quiet object is written at once");
  await quiet.metrics.bump("/weather", "challenged");
  assert.equal(quiet.records.get(dayKey)["/weather"].challenged, 1, "then it buffers for the flush interval");
  quiet.metrics.lastFlushMs = Date.now() - 31_000;
  await quiet.metrics.bump("/weather", "challenged");
  assert.equal(quiet.records.get(dayKey)["/weather"].challenged, 3, "an update after the interval writes the buffer");
});

test("MCP connections are counted per client and mode, capped like callers", async () => {
  const { metrics } = createMetrics();
  await metrics.bumpMcpClient("claude-ai", "account");
  await metrics.bumpMcpClient("claude-ai", "account");
  await metrics.bumpMcpClient("cursor", "key");
  const day = (await metrics.mcpClients())[today];
  assert.deepEqual(day, { "claude-ai": { account: 2 }, cursor: { key: 1 } });
});

test("payment attempts answered 402 are counted as v1_payment (X-PAYMENT) or v2_payment (PAYMENT-SIGNATURE), not as quotes", async () => {
  const { metrics } = createMetrics();
  const app = new Hono();
  app.use(requestMetricsMiddleware(new Set(["/tool"]), () => false));
  app.get("/tool", (c) => c.json({ error: "payment required" }, 402));
  const env = { METRICS: { idFromName: () => "global", get: () => metrics } };
  const pending = [];
  const executionCtx = { waitUntil: (p) => pending.push(p) };
  await app.fetch(new Request("https://x.test/tool", { headers: { "x-payment": "eyJ4NDAyVmVyc2lvbiI6MX0=" } }), env, executionCtx);
  await app.fetch(new Request("https://x.test/tool"), env, executionCtx);
  await app.fetch(new Request("https://x.test/tool", { headers: { "x-payment": "a", "payment-signature": "b" } }), env, executionCtx);
  await sendBatchNow(metrics); await Promise.all(pending);
  const row = (await metrics.report())[today]["/tool"];
  assert.equal(row.v1_payment, 1);
  assert.equal(row.v2_payment, 1);
  assert.equal(row.challenged, 1);
});
