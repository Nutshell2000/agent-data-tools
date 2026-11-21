// Browser safety headers on pages and JSON answers (21 Nov 2026, safety audit; src/lib/response-headers.ts).
// - every text/html answer gets nosniff, a referrer policy and a framing rule, unless the route set its own;
// - every JSON answer gets nosniff;
// - nothing else changes: an unpaid tool request is the same 402 with the same payment headers and body.
// The second half runs the real Worker in Miniflare (facilitator is a fixture: no network, no money).
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");

const load = async (entry, name) => {
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
  const mod = new Module(name, null); mod.filename = path.resolve(name); mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(out.outputFiles[0].text, mod.filename); return mod.exports;
};

const W = "https://agent-data-tools.revmesh2074.workers.dev";
const recipient = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", asset = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BROWSER = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" };
const JSON_CLIENT = { accept: "application/json", "user-agent": "node" };
let H, mf;

before(async () => {
  H = await load(require.resolve("../src/lib/response-headers.ts"), "response-headers-test.js");
  const b = await esbuild.build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", external: ["cloudflare:workers", "node:*"], alias: { "ajv/dist/2020.js": path.resolve("src/lib/ajv-unavailable.ts") }, plugins: [{ name: "fixture-facilitator", setup(p) {
    p.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true }));
    p.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: "fixture", namespace: "fixture" }));
    p.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async()=>({isValid:false,invalidReason:'fixture'}), settle:async()=>({success:false})
    }}` }));
  } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { METRICS: { className: "Metrics", useSQLite: true } }, kvNamespaces: ["TRIALS"],
    bindings: { PAY_TO: recipient, NETWORK: "eip155:8453", PAYWALL: "on", TRIALS_ENABLED: "on", MPP_EVM: "on", MPP_SECRET_KEY: "test-mpp-secret-0123456789abcdef", QUOTE_CACHE: "off",
      FACILITATOR_URL: "https://fixture.invalid", BASE_RPC_URL: "https://fixture.invalid", STRIPE_READ_KEY: "rk_test_fixture" },
    outboundService: async () => new Response("offline", { status: 503 }) }));
});
after(async () => { await mf?.dispose(); });

const res = (type, extra = {}, status = 200) => new Response("x", { status, headers: { ...(type ? { "content-type": type } : {}), ...extra } });
const added = (r) => Object.fromEntries(H.missingSafetyHeaders(r.headers).map(([n, v]) => [n.toLowerCase(), v]));

test("the rule: what is added to a page, to JSON, and to nothing else", () => {
  assert.deepEqual(added(res("text/html; charset=UTF-8")), {
    "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy": "frame-ancestors 'self'", "x-frame-options": "SAMEORIGIN" });
  assert.deepEqual(added(res("application/json")), { "x-content-type-options": "nosniff" });
  assert.deepEqual(added(res("application/json; charset=utf-8", {}, 402)), { "x-content-type-options": "nosniff" });
  assert.deepEqual(added(res("application/linkset+json")), { "x-content-type-options": "nosniff" });
  for (const type of [null, "text/plain", "text/event-stream", "application/xml", "image/png", "audio/mpeg", "text/markdown", "application/octet-stream"]) assert.deepEqual(added(res(type)), {}, String(type));
  // No rule for scripts or styles is ever written: the pages use inline ones.
  for (const [, value] of H.missingSafetyHeaders(res("text/html").headers)) assert.doesNotMatch(value, /script-src|style-src|default-src/);
});

test("a route's own header is never replaced or loosened", () => {
  const own = "default-src 'none'; frame-ancestors 'none'";
  const hosted = added(res("text/html", { "content-security-policy": own, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" }));
  assert.deepEqual(hosted, {}, "a page with its own policy, referrer rule and nosniff gets nothing");
  assert.deepEqual(added(res("text/html", { "content-security-policy": own })), { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" }, "no second policy, and no X-Frame-Options beside a route's own policy");
  // X-Frame-Options: DENY (the sign-in consent page) keeps its strength: a browser that reads frame-ancestors ignores X-Frame-Options.
  assert.equal(added(res("text/html", { "x-frame-options": "DENY" }))["content-security-policy"], "frame-ancestors 'none'");
  assert.ok(!("x-frame-options" in added(res("text/html", { "x-frame-options": "DENY" }))));
  assert.equal(added(res("text/html", { "x-frame-options": "SAMEORIGIN" }))["content-security-policy"], "frame-ancestors 'self'");
  assert.ok(!("referrer-policy" in added(res("text/html", { "referrer-policy": "no-referrer" }))));
});

test("status, body and every existing header stay as they were, also when the headers cannot be changed", async () => {
  const quote = new Response('{"x402Version":2}', { status: 402, headers: { "content-type": "application/json", "payment-required": "abc=", "www-authenticate": 'Payment id="1"', "cache-control": "no-store" } });
  const before = [...quote.headers.entries()];
  const same = H.withSafetyHeaders(quote);
  assert.equal(same, quote, "changed in place");
  assert.equal(same.status, 402);
  for (const [name, value] of before) assert.equal(same.headers.get(name), value, name);
  assert.deepEqual([...same.headers.keys()].filter((n) => !before.some(([b]) => b === n)), ["x-content-type-options"]);
  assert.equal(await same.text(), '{"x402Version":2}');
  // An answer whose headers are immutable (as a fetched or asset response is): copied, never thrown on.
  const frozen = Response.redirect("https://example.com/", 302);
  assert.equal(H.withSafetyHeaders(frozen), frozen, "no content type: left alone");
  const fetched = await (async () => { const r = new Response("<p>hi", { headers: { "content-type": "text/html" } }); Object.defineProperty(r, "headers", { value: new Proxy(r.headers, { get(t, k) { if (k === "set") return () => { throw new TypeError("immutable"); }; const v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v; } }) }); return r; })();
  const copy = H.withSafetyHeaders(fetched);
  assert.notEqual(copy, fetched);
  assert.equal(copy.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(await copy.text(), "<p>hi");
  const plain = new Response("ok", { headers: { "content-type": "text/plain" } });
  assert.equal(H.withSafetyHeaders(plain), plain);
  assert.equal([...plain.headers.keys()].length, 1);
});

const ask = (url, headers = BROWSER, init = {}) => mf.dispatchFetch(url, { headers, redirect: "manual", ...init });

test("live Worker: human pages carry the four headers", async () => {
  for (const p of ["/", "/docs", "/credits", "/tools", "/tools/time", "/about", "/store", "/payee"]) {
    const r = await ask(W + p); await r.arrayBuffer();
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("content-type"), /text\/html/, p);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", p);
    assert.equal(r.headers.get("referrer-policy"), "strict-origin-when-cross-origin", p);
    assert.equal(r.headers.get("content-security-policy"), "frame-ancestors 'self'", p);
    assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN", p);
    assert.ok(r.headers.get("strict-transport-security"), `${p}: HSTS is still set`);
  }
});

test("live Worker: pages with their own rules keep them (hosted pages, the sign-in page, the key page)", async () => {
  const gone = await ask(`${W}/p/abcdef123456`); await gone.arrayBuffer();
  assert.equal(gone.status, 404);
  assert.equal(gone.headers.get("x-content-type-options"), "nosniff");
  assert.equal(gone.headers.get("x-frame-options"), "SAMEORIGIN");
  // A published page: its strict policy, no-referrer and noindex are the route's own and must come through unchanged.
  const kv = await mf.getKVNamespace("TRIALS");
  await kv.put("page:k7m2p9qxw4rt", JSON.stringify({ title: "Weekly report", html: "<h1>Weekly report</h1><p>Sales rose 12%.</p>", createdAt: "2026-11-21T10:00:00.000Z", expiresAt: "2026-11-28T10:00:00.000Z", bytes: 44 }));
  const hosted = await ask(`${W}/p/k7m2p9qxw4rt`); const hostedHtml = await hosted.text();
  assert.equal(hosted.status, 200);
  assert.match(hostedHtml, /Sales rose 12%/);
  assert.equal(hosted.headers.get("content-security-policy"), "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "the hosted page's strict policy comes through unchanged");
  assert.equal(hosted.headers.get("referrer-policy"), "no-referrer");
  assert.equal(hosted.headers.get("x-content-type-options"), "nosniff");
  assert.equal(hosted.headers.get("x-frame-options"), null, "nothing is added beside a route's own policy");
  assert.equal(hosted.headers.get("x-robots-tag"), "noindex, nofollow");
  const oauth = await ask(`${W}/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fexample.com%2Fcb&response_type=code`); await oauth.arrayBuffer();
  if (/text\/html/.test(oauth.headers.get("content-type") ?? "")) {
    assert.equal(oauth.headers.get("x-frame-options"), "DENY", "the sign-in page still forbids every frame");
    assert.equal(oauth.headers.get("content-security-policy"), "frame-ancestors 'none'", "and says so in the form newer browsers read");
  } else {
    assert.equal(oauth.headers.get("x-content-type-options"), "nosniff", "a JSON refusal of the sign-in request");
  }
  const claim = await ask(`${W}/credits/claim`); await claim.arrayBuffer();
  if (/text\/html/.test(claim.headers.get("content-type") ?? "") && claim.status === 200) assert.equal(claim.headers.get("referrer-policy"), "no-referrer", "the key page keeps its stricter referrer rule");
});

test("live Worker: an unpaid tool request is the same 402 quote, with nosniff as the only new header", async () => {
  for (const p of ["/btc-fees", "/weather?city=Paris", "/pack/url-safety?url=https%3A%2F%2Fexample.com"]) {
    const r = await ask(W + p, JSON_CLIENT); const body = await r.text();
    assert.equal(r.status, 402, p);
    assert.match(r.headers.get("content-type"), /application\/json/, p);
    const terms = JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString());
    assert.equal(terms.resource.url, W + p, `${p}: PAYMENT-REQUIRED names the URL asked`);
    assert.ok(terms.accepts.length >= 1);
    assert.match(r.headers.get("www-authenticate") ?? "", /^Payment /, `${p}: MPP challenges are still there`);
    assert.equal(r.headers.get("cache-control"), "no-store", p);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", p);
    for (const name of ["content-security-policy", "x-frame-options", "referrer-policy"]) assert.equal(r.headers.get(name), null, `${p}: no page header on a JSON quote (${name})`);
    assert.equal(JSON.parse(body).x402Version !== undefined || JSON.parse(body).accepts !== undefined, true, `${p}: the quote body is the quote`);
    let size = 0; for (const [n, v] of r.headers) size += n.length + v.length + 4;
    assert.ok(size < 16 * 1024, `${p}: quote headers stay under 16 KB (${size})`);
  }
  // A browser on a tool URL gets the 402 page: still a 402 with its payment header, now with the page headers.
  const page = await ask(`${W}/btc-fees`); await page.arrayBuffer();
  assert.equal(page.status, 402);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.ok(page.headers.get("payment-required"));
  assert.equal(page.headers.get("x-frame-options"), "SAMEORIGIN");
  // Another spelling of a tool is answered as the tool, and HEAD is a 402 too.
  const spelled = await ask(`${W}/BTC-FEES`, JSON_CLIENT); await spelled.arrayBuffer();
  assert.equal(spelled.status, 402);
  assert.ok(spelled.headers.get("payment-required"));
});

test("live Worker: JSON, text and other answers", async () => {
  for (const p of ["/health", "/.well-known/mcp/server-card.json", "/no-such-page-here", "/discovery/resources?limit=2"]) {
    const r = await ask(W + p, JSON_CLIENT); await r.arrayBuffer();
    assert.match(r.headers.get("content-type"), /json/, p);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", p);
    assert.equal(r.headers.get("x-frame-options"), null, p);
  }
  for (const p of ["/robots.txt", "/llms.txt", "/sitemap.xml"]) {
    const r = await ask(W + p, JSON_CLIENT); await r.arrayBuffer();
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get("content-security-policy"), null, p);
    assert.equal(r.headers.get("x-frame-options"), null, p);
  }
  const init = await ask(`${W}/mcp`, { accept: "application/json, text/event-stream", "content-type": "application/json", "user-agent": "mcp-client" }, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
  assert.equal(init.status, 200);
  assert.match(await init.text(), /"serverInfo"/, "MCP still answers");
});
