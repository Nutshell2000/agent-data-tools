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
let productUsdMicros;
let queueMetricBump;
let requestMetricsMiddleware;
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
  ({ Metrics } = await loadTypeScript(require.resolve("../src/metrics.ts"), [workersStub]));
  ({
    productUsdMicros,
    queueMetricBump,
    withMcpRevenue,
    settledApiRevenueMicros,
    settledMcpRevenueMicros,
    usdMicros,
  } = await loadTypeScript(require.resolve("../src/lib/revenue.ts")));
  ({ requestMetricsMiddleware } = await loadTypeScript(require.resolve("../src/lib/request-metrics.ts")));
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
    await Promise.all(pending.splice(0));
  }

  const row = (await metrics.report())[today]["/buy/x402-seller-kit"];
  assert.equal(row.revenueUsdMicros, 1_900_000);
  assert.equal(row.trackedPaidCalls, 1);
  assert.equal(row.paid, 1);
  assert.equal(row.unsettled, 3);
  assert.equal(row.marketplace, 1);
  assert.equal(row.challenged, 1);
  assert.equal(row.trial, 1);
  assert.equal(row.failed, undefined);
  assert.equal(row.errored, 1);
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
  const pathMetrics = (await metrics.report())[today]["/package-audit"];
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
  const before = (await metrics.report())[today]["/package-audit"];
  assert.equal(before.paid, 7);
  assert.equal(before.revenueUsdMicros, undefined);
  assert.equal(before.trackedPaidCalls, undefined);

  await metrics.bump("/package-audit", "paid", 200_000);
  const after = (await metrics.report())[today]["/package-audit"];
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
  await Promise.all(pending.splice(0));
  let row = (await metrics.report())[today]["/package-audit"];
  assert.equal(row.revenueUsdMicros, 200_000);
  assert.equal(row.trackedPaidCalls, 1);

  const mcpCallback = withMcpRevenue(
    "/package-audit",
    async () => ({ _meta: { "x402/payment-response": { success: true } } }),
    () => metrics,
    waitUntil,
  );
  await mcpCallback();
  await Promise.all(pending.splice(0));
  row = (await metrics.report())[today]["/package-audit"];
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
  await Promise.all(pending.splice(0));

  trackHttp("/buy/x402-seller-kit", new Headers({ "PAYMENT-RESPONSE": successfulSettlement }));
  await Promise.all(pending.splice(0));
  const purchaseRow = (await metrics.report())[today]["/buy/x402-seller-kit"];
  assert.equal(purchaseRow.revenueUsdMicros, 1_900_000);
  assert.equal(purchaseRow.trackedPaidCalls, 1);

  queueMetricBump(metrics, waitUntil, "/package-audit", "challenged", 200_000);
  queueMetricBump(metrics, waitUntil, "/package-audit", "trial", 200_000);
  queueMetricBump(metrics, waitUntil, "/package-audit", "failed", 200_000);
  trackHttp("/package-audit", new Headers());
  await Promise.all(pending.splice(0));

  row = (await metrics.report())[today]["/package-audit"];
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
