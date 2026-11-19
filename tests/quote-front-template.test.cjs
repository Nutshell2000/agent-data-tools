// Quote front (19 Nov 2026), step 2: a quote rebuilt from a template (src/front/template.ts) must equal what the real core
// Worker answers for the same URL: status, headers (minus per-answer ones and the fresh MPP challenges), the exact
// PAYMENT-REQUIRED string and the exact body text. Several tools, queries with tricky encoding, two hosts.
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");

const recipient = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", asset = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
let T, mf;
before(async () => {
  const entry = require.resolve("../src/front/template.ts");
  const lib = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
  const mod = new Module(entry, null); mod.filename = entry; mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(lib.outputFiles[0].text, entry); T = mod.exports;
  const b = await esbuild.build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", external: ["cloudflare:workers", "node:*"], alias: { "ajv/dist/2020.js": path.resolve("src/lib/ajv-unavailable.ts") }, plugins: [{ name: "fixture-facilitator", setup(p) {
    p.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true }));
    p.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: "fixture", namespace: "fixture" }));
    p.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async()=>({isValid:false}), settle:async()=>({success:false})
    }}` }));
  } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { METRICS: { className: "Metrics", useSQLite: true } }, kvNamespaces: ["TRIALS"],
    bindings: { PAY_TO: recipient, NETWORK: "eip155:8453", PAYWALL: "on", TRIALS_ENABLED: "on", MPP_EVM: "on", MPP_SECRET_KEY: "test-mpp-secret-0123456789abcdef", QUOTE_CACHE: "off",
      FACILITATOR_URL: "https://fixture.invalid", BASE_RPC_URL: "https://fixture.invalid", PUBLIC_SITE_ORIGIN: "https://glyphcall.com", PUBLIC_BRAND: "Glyphcall", STRIPE_READ_KEY: "rk_test_fixture" },
    outboundService: async () => new Response("offline", { status: 503 }) }));
});
after(async () => { await mf?.dispose(); });

const PER_ANSWER = new Set(["www-authenticate", "x-request-id", "date", "content-length", "set-cookie", "x-quote-cache", "cf-ray", "report-to", "nel", "server", "alt-svc"]);
const ask = (url) => mf.dispatchFetch(url, { headers: { accept: "application/json", "user-agent": "node" }, redirect: "manual" });
const comparable = (headers) => headers.filter(([n]) => !PER_ANSWER.has(n.toLowerCase())).map(([n, v]) => [n.toLowerCase(), v]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

const HOSTS = ["https://agent-data-tools.revmesh2074.workers.dev", "https://api.glyphcall.com"];
const PATHS = ["/pack/url-safety", "/weather", "/btc-fees", "/page/markdown", "/merchant/trust"];
const QUERIES = ["", "?url=https://example.com", "?url=https%3A%2F%2Fexample.com&foo=a%20b", "?city=S%C3%A3o%20Paulo&units=metric"];

for (const host of HOSTS) for (const p of PATHS) {
  test(`${host.replace("https://", "")}${p}: rebuilt quotes equal the core's for bare and query URLs`, async () => {
    const bare = await ask(host + p);
    const bareText = await bare.text();
    assert.equal(bare.status, 402, `${p} quotes`);
    const tpl = T.toTemplate(bare.status, bare.headers, bareText);
    assert.ok(tpl.mpp.length >= 1, "template keeps the MPP route terms");
    // A blank scope minted challenges for no route: Challenge.meta() is undefined on a deserialized challenge (19 Nov).
    for (const t of tpl.mpp) assert.ok(t.scope.length > 0 && t.request && t.intent, `${p}: ${t.method} terms carry the route scope`);
    for (const q of QUERIES) {
      const url = host + p + q;
      const core = await ask(url);
      const coreText = await core.text();
      const rebuilt = T.fromTemplate(tpl, core.url || url);
      assert.equal(rebuilt.status, core.status, `${url} status`);
      assert.equal(rebuilt.body, coreText, `${url} body text`);
      assert.deepEqual(comparable(rebuilt.headers), comparable([...core.headers.entries()]), `${url} headers incl. PAYMENT-REQUIRED`);
      const coreTerms = T.toTemplate(core.status, core.headers, coreText).mpp;
      assert.deepEqual(tpl.mpp, coreTerms, `${url} MPP route terms`);
    }
  });
}
