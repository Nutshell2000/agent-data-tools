const assert = require("node:assert/strict");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const { Hono } = require("hono");

async function loadTypeScript(entry) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let buyAssetPreflight;
let store;

before(async () => {
  ({ buyAssetPreflight, store } = await loadTypeScript(require.resolve("../src/store/routes.ts")));
});

test("missing seller-kit asset fails before the unpaid x402 challenge", async () => {
  const app = new Hono();
  let challengeReached = false;
  const assetRequests = [];
  app.onError((error, c) => c.json({ error: error.message }, error.status ?? 500));

  // Exercise the production preflight middleware before a challenge stub; this avoids booting the x402 Worker.
  app.use(buyAssetPreflight());
  app.use((c, next) => {
    if (c.req.path === "/buy/x402-seller-kit") {
      challengeReached = true;
      return c.json({ error: "payment required" }, 402, { "PAYMENT-REQUIRED": "challenge" });
    }
    return next();
  });
  app.get("/buy/x402-seller-kit", (c) => c.json({ ok: true }));

  const response = await app.fetch(new Request("https://example.test/buy/x402-seller-kit"), {
    ASSETS: {
      async fetch(request) {
        assetRequests.push({ method: request.method, pathname: new URL(request.url).pathname });
        return new Response(null, { status: 404 });
      },
    },
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.has("PAYMENT-REQUIRED"), false);
  assert.equal(challengeReached, false);
  assert.deepEqual(assetRequests, [{ method: "HEAD", pathname: "/_files/x402-seller-kit.zip" }]);
  await response.body?.cancel();
});

function createStoreApp(assetFetch) {
  const app = new Hono();
  app.route("/", store);
  return {
    app,
    env: { ASSETS: { fetch: assetFetch } },
  };
}

test("storefront shows product details but hides purchase controls when asset HEAD is 404", async () => {
  const assetRequests = [];
  const { app, env } = createStoreApp(async (request) => {
    assetRequests.push({ method: request.method, pathname: new URL(request.url).pathname });
    return new Response(null, { status: 404 });
  });

  const storeResponse = await app.fetch(new Request("https://example.test/store"), env);
  const storeHtml = await storeResponse.text();
  const productResponse = await app.fetch(new Request("https://example.test/store/x402-seller-kit"), env);
  const productHtml = await productResponse.text();

  assert.equal(storeResponse.status, 200);
  assert.match(storeHtml, /Temporarily unavailable: purchase is paused until the download is verified/);
  assert.match(storeHtml, /\$1\.90/);
  assert.match(storeHtml, /Browse product details; purchase availability depends on download verification/);
  assert.doesNotMatch(storeHtml, /Pay in USDC, download straight away/);
  assert.match(storeHtml, /See what's inside/);
  assert.equal(productResponse.status, 200);
  assert.match(productHtml, /x402 Seller Kit/);
  assert.match(productHtml, /\$1\.90/);
  assert.match(productHtml, /Purchasing is temporarily unavailable because the download asset cannot be verified/);
  assert.doesNotMatch(productHtml, /<form method="post" action="\/store\/x402-seller-kit\/order">/);
  assert.doesNotMatch(productHtml, /Agents can buy it too/);
  assert.deepEqual(assetRequests, [
    { method: "HEAD", pathname: "/_files/x402-seller-kit.zip" },
    { method: "HEAD", pathname: "/_files/x402-seller-kit.zip" },
  ]);
});

test("storefront preserves purchase controls when asset HEAD succeeds", async () => {
  const { app, env } = createStoreApp(async (request) => {
    assert.equal(request.method, "HEAD");
    assert.equal(new URL(request.url).pathname, "/_files/x402-seller-kit.zip");
    return new Response(null, { status: 200 });
  });

  const storeResponse = await app.fetch(new Request("https://example.test/store"), env);
  const storeHtml = await storeResponse.text();
  const productResponse = await app.fetch(new Request("https://example.test/store/x402-seller-kit"), env);
  const productHtml = await productResponse.text();

  assert.equal(storeResponse.status, 200);
  assert.doesNotMatch(storeHtml, /Temporarily unavailable/);
  assert.match(storeHtml, /Pay in USDC and download after confirmation, no account/);
  assert.match(storeHtml, /See what's inside/);
  assert.equal(productResponse.status, 200);
  assert.match(productHtml, /<form method="post" action="\/store\/x402-seller-kit\/order">/);
  assert.match(productHtml, /Agents can buy it too/);
  assert.doesNotMatch(productHtml, /Temporarily unavailable/);
});

test("storefront fails closed when asset HEAD cannot be verified", async () => {
  const { app, env } = createStoreApp(async () => {
    throw new Error("asset binding unavailable");
  });
  const originalError = console.error;
  const logged = [];
  console.error = (message) => logged.push(String(message));
  try {
    const response = await app.fetch(new Request("https://example.test/store/x402-seller-kit"), env);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Purchasing is temporarily unavailable/);
    assert.doesNotMatch(html, /<form method="post" action="\/store\/x402-seller-kit\/order">/);
    assert.ok(logged.some((message) => message.includes("x402-seller-kit")));
  } finally {
    console.error = originalError;
  }
});
