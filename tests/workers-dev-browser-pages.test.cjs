// 16 Nov 2026, the owner's rule: on the paid workers.dev origin ONLY a browser's GET (Accept asks for text/html) of a
// human page that answers 200 text/html moves, with a 301 to the same path and query on glyphcall.com. Every tool
// path, quote, paid or free call, MCP, /v1, /credits, /.well-known, catalog, asset, HEAD, POST and every client
// that does not ask for HTML is answered on workers.dev exactly as before. This file walks a table of such requests
// against two Workers built from the same code, one with BROWSER_PAGES_MOVED_HOSTS and one without ("as before"),
// and pays a tool on the workers.dev host with a prepaid key and over x402 with Accept: text/html.
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { readFileSync } = require("node:fs");
const esbuild = require("esbuild");
const Module = require("node:module");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");

const W = "https://agent-data-tools.revmesh2074.workers.dev", SITE = "https://glyphcall.com", STAGING = "https://agent-data-tools-staging.revmesh2074.workers.dev";
const recipient = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", asset = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", payer = "0x" + "1".repeat(40);
const BROWSER = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" };
const CURL = { accept: "*/*", "user-agent": "curl/8.5.0" };
const JSON_CLIENT = { accept: "application/json", "user-agent": "node" };

let S, moved, asBefore;
before(async () => {
  const entry = require.resolve("../src/lib/public-site.ts");
  const lib = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const mod = new Module(entry, null); mod.filename = entry; mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(lib.outputFiles[0].text, entry); S = mod.exports;
  // The facilitator is a fixture (as in tests/payment-delivery-runtime.test.cjs): no network, no signer, no money.
  const b = await esbuild.build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", external: ["cloudflare:workers", "node:*"], alias: { "ajv/dist/2020.js": require("node:path").resolve("src/lib/ajv-unavailable.ts") }, plugins: [{ name: "fixture-facilitator", setup(p) {
    p.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true }));
    p.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: "fixture", namespace: "fixture" }));
    p.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async p=>({isValid:true,payer:'${payer}'}),
      settle:async p=>({success:true,network:'eip155:8453',transaction:'0x'+'2'.repeat(64),payer:'${payer}',amount:'2000'})
    }}` }));
  } }] });
  const worker = (extra) => new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { METRICS: { className: "Metrics", useSQLite: true } }, kvNamespaces: ["TRIALS"],
    bindings: { PAY_TO: recipient, NETWORK: "eip155:8453", PAYWALL: "on", TRIALS_ENABLED: "on", MPP_EVM: "off", QUOTE_CACHE: "off", FACILITATOR_URL: "https://fixture.invalid", BASE_RPC_URL: "https://fixture.invalid", STRIPE_READ_KEY: "rk_test_fixture",
      PUBLIC_SITE_ORIGIN: SITE, RETIRED_PUBLIC_HOSTS: "tools.funwords.eu,www.glyphcall.com", PUBLIC_BRAND: "Glyphcall", ...extra },
    outboundService: async (r) => {
      const url = new URL(r.url);
      if (url.hostname === "api.stripe.com") return Response.json({ mode: "payment", status: "complete", payment_status: "paid", currency: "usd", amount_total: 500, metadata: { adt_credits: "5000" } });
      return new Response("<html><title>Paid fixture</title><main><h1>Useful result</h1><p>Static page for the paid call on the workers.dev host.</p></main></html>", { headers: { "content-type": "text/html" } });
    } }));
  moved = worker({ BROWSER_PAGES_MOVED_HOSTS: new URL(W).hostname });
  asBefore = worker({});
});
after(async () => { await moved?.dispose(); await asBefore?.dispose(); });

const ask = (mf, url, { method = "GET", headers = BROWSER, body } = {}) => mf.dispatchFetch(url, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body, redirect: "manual" });

// Human pages: a browser is sent on, page for page, with its query.
const PAGES = ["/", "/docs?utm_source=x&b=2", "/agents", "/tools", "/tools/time", "/guides", "/pdf-to-text-api", "/speech-to-text-api?ref=a%20b", "/compare", "/vat-number-check", "/benchmarks", "/about", "/terms", "/privacy", "/changelog"];

test("a browser's GET of a human page on workers.dev answers 301 to the same path and query on glyphcall.com", async () => {
  for (const path of PAGES) {
    const was = await ask(asBefore, W + path);
    assert.equal(was.status, 200, `${path} is a 200 page without the rule`);
    assert.match(was.headers.get("content-type"), /text\/html/, path);
    await was.arrayBuffer();
    const r = await ask(moved, W + path);
    assert.equal(r.status, 301, path);
    assert.equal(r.headers.get("location"), SITE + path, path);
    assert.match(r.headers.get("vary") ?? "", /Accept/i, "the answer depends on the Accept header");
    assert.equal(await r.text(), "");
    // The page is at home on glyphcall.com: 200, names itself as canonical, no further redirect.
    const home = await ask(moved, SITE + path);
    assert.equal(home.status, 200, `${SITE}${path}`);
    assert.equal(home.headers.get("location"), null);
    const html = await home.text();
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    if (canonical) assert.ok(canonical === SITE + new URL(SITE + path).pathname || (path === "/agents" && canonical === `${SITE}/`), `${path}: canonical ${canonical}`);
  }
  const front = await (await ask(moved, `${SITE}/docs`)).text();
  assert.match(front, /<link rel="canonical" href="https:\/\/glyphcall\.com\/docs"/, "the same page on glyphcall.com has a self canonical");
});

// Everything else: [label, path, options]. Each is sent to both Workers; the one with the rule must answer as the
// one without it (status, Location, content type, payment header, body).
const UNCHANGED = [
  // The same human pages for clients that do not ask for HTML, and for methods other than GET.
  ["JSON root for a program", "/", { headers: JSON_CLIENT }],
  ["root for curl", "/", { headers: CURL }],
  ["docs page for curl", "/docs", { headers: CURL }],
  ["tool page for a JSON client", "/tools/time", { headers: JSON_CLIENT }],
  ["tool page with no Accept header", "/tools/time", { headers: { "user-agent": "python-requests/2.32" } }],
  ["HEAD of a page by a browser", "/docs", { method: "HEAD" }],
  ["POST to a page", "/docs", { method: "POST", body: "{}" }],
  // Tool paths, whatever the Accept header.
  ["browser on a tool URL: the HTML 402 page", "/time?zone=UTC", {}],
  ["unpaid quote for a program", "/time?zone=UTC", { headers: JSON_CLIENT }],
  ["unpaid quote for curl", "/uuid", { headers: CURL }],
  ["POST with a flat JSON body", "/uuid", { method: "POST", headers: JSON_CLIENT, body: '{"count":1}' }],
  ["HEAD of a tool", "/uuid", { method: "HEAD" }],
  ["tool sample", "/uuid?sample=1", {}],
  ["store product over x402", "/buy/x402-starter-kit", { headers: JSON_CLIENT }],
  // MCP, /v1, catalogs.
  ["GET /mcp by a browser", "/mcp", {}],
  ["GET /mcp/compact by a browser", "/mcp/compact", {}],
  ["GET /mcp/voice by a browser", "/mcp/voice", {}],
  ["GET /mcp/account by a browser", "/mcp/account", {}],
  ["/v1/models", "/v1/models", {}],
  ["/v1/audio/voices", "/v1/audio/voices", {}],
  ["/v1/chat/completions by GET", "/v1/chat/completions", {}],
  ["/v1/chat/completions by POST", "/v1/chat/completions", { method: "POST", headers: JSON_CLIENT, body: '{"model":"x","messages":[{"role":"user","content":"hi"}]}' }],
  ["/openapi.json", "/openapi.json", {}],
  ["/llms.txt", "/llms.txt", {}],
  ["/.well-known/x402", "/.well-known/x402", {}],
  ["/.well-known/agent-card.json", "/.well-known/agent-card.json", {}],
  ["/.well-known/mcp.json", "/.well-known/mcp.json", {}],
  ["/.well-known/security.txt", "/.well-known/security.txt", {}],
  ["OAuth metadata", "/.well-known/oauth-authorization-server", {}],
  ["OAuth protected resource", "/.well-known/oauth-protected-resource/mcp/chatgpt", {}],
  ["OAuth authorize", "/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fexample.com%2Fcb&response_type=code", {}],
  ["OAuth token", "/oauth/token", { method: "POST", headers: JSON_CLIENT, body: "{}" }],
  ["OAuth register", "/oauth/register", { method: "POST", headers: JSON_CLIENT, body: "{}" }],
  ["/discovery/resources", "/discovery/resources?limit=2", {}],
  ["/find", "/find?need=weather", {}],
  // /credits and keys: all of it, pages too.
  ["/credits page for a browser", "/credits", {}],
  ["/credits for a program", "/credits", { headers: JSON_CLIENT }],
  ["/credits/balance", "/credits/balance", {}],
  ["/credits/claim without a session", "/credits/claim", {}],
  ["/credits/usdc/5 quote", "/credits/usdc/5", { headers: JSON_CLIENT }],
  ["/credits/buy/5", "/credits/buy/5", {}],
  ["/keys/free", "/keys/free", {}],
  ["/keys/free/confirm link", "/keys/free/confirm?token=abc123&x=1", {}],
  // Search files, assets, reports, the store and the payee registry.
  ["/sitemap.xml", "/sitemap.xml", { headers: CURL }],
  ["/sitemap.xml for a browser", "/sitemap.xml", {}],
  ["/robots.txt", "/robots.txt", {}],
  ["IndexNow key file", "/d0d511e1d96310e1565397ebc5e3fe54.txt", {}],
  ["/logo.png", "/logo.png", {}],
  ["/og.png", "/og.png", {}],
  ["/og-glyphcall.png", "/og-glyphcall.png", {}],
  ["/favicon.svg", "/favicon.svg", {}],
  ["/status", "/status", {}],
  ["/health", "/health", {}],
  ["/store page", "/store", {}],
  ["/payee page", "/payee", {}],
  ["a published page that is gone", "/p/abcdef123456", {}],
  ["an unknown path", "/no-such-page-here", {}],
];

// Values that differ between any two answers of the same Worker (request ids, clocks) are blanked before comparing.
const steady = (text) => text
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<time>")
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
  .replace(/"(uptimeSeconds|generatedAt|now|timestamp|unix|ms|startedAt)":\s*"?[\d.]+"?/g, '"$1":0');

test(`${UNCHANGED.length} other requests on workers.dev answer exactly as without the rule, never with a redirect to glyphcall.com`, async () => {
  assert.ok(UNCHANGED.length + PAGES.length >= 25);
  const htmlKept = [];
  for (const [label, path, options] of UNCHANGED) {
    // Each answer is read in full before the next request: two large bodies left open at once made undici report the second one as already read (/openapi.json, about 2 MB).
    const a = await ask(moved, W + path, options); const aBytes = Buffer.from(await a.arrayBuffer());
    const b = await ask(asBefore, W + path, options); const bBytes = Buffer.from(await b.arrayBuffer());
    assert.equal(a.status, b.status, `${label}: status`);
    assert.notEqual(a.status, 301, `${label}: not moved`);
    assert.equal(a.headers.get("location"), b.headers.get("location"), `${label}: Location`);
    assert.ok(!(a.headers.get("location") ?? "").startsWith(SITE), `${label}: never sent to the public site`);
    assert.equal(a.headers.get("content-type"), b.headers.get("content-type"), `${label}: content type`);
    assert.equal(a.headers.get("payment-required"), b.headers.get("payment-required"), `${label}: PAYMENT-REQUIRED`);
    assert.equal(a.headers.get("www-authenticate"), b.headers.get("www-authenticate"), `${label}: WWW-Authenticate`);
    assert.equal(a.headers.get("cache-control"), b.headers.get("cache-control"), `${label}: Cache-Control`);
    const [ta, tb] = [aBytes.toString("latin1"), bBytes.toString("latin1")];
    assert.equal(steady(ta) === steady(tb), true, `${label}: body differs (${ta.length} / ${tb.length} bytes)`);
    if (a.status === 200 && /text\/html/.test(a.headers.get("content-type") ?? "") && (options.method ?? "GET") === "GET" && /text\/html/.test((options.headers ?? BROWSER).accept ?? "")) htmlKept.push(path);
  }
  // The table must hold the hard cases: 200 text/html answers to a browser's GET that stay because of where they are.
  for (const path of ["/credits", "/store", "/payee"]) assert.ok(htmlKept.includes(path), `${path} is a 200 HTML page that stays`);
});

test("what those answers are: the quote stays a 402 with its payment header, MCP and /v1 answer, /credits is a page here", async () => {
  const page402 = await ask(moved, `${W}/time?zone=UTC`);
  assert.equal(page402.status, 402, "a browser on a tool URL gets the 402 page, never a redirect");
  assert.match(page402.headers.get("content-type"), /text\/html/);
  const terms = JSON.parse(Buffer.from(page402.headers.get("PAYMENT-REQUIRED"), "base64"));
  assert.equal(terms.resource.url, `${W}/time?zone=UTC`, "the quote names the host that was called");
  await page402.arrayBuffer();
  const init = await ask(moved, `${W}/mcp`, { method: "POST", headers: { accept: "application/json, text/event-stream", "user-agent": "mcp-client" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
  assert.equal(init.status, 200);
  assert.match(await init.text(), /"serverInfo"/);
  const models = await ask(moved, `${W}/v1/models`);
  assert.equal(models.status, 200);
  assert.equal((await models.json()).object, "list");
  const credits = await ask(moved, `${W}/credits`);
  assert.equal(credits.status, 200);
  assert.match(credits.headers.get("content-type"), /text\/html/);
  await credits.arrayBuffer();
  const root = await ask(moved, `${W}/`, { headers: JSON_CLIENT });
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type"), /application\/json/);
  // The JSON root is the short first-call document since 1.213.0 (no endpoint list): it still answers here, unmoved.
  const rootJson = await root.json();
  assert.ok(rootJson.firstCall && rootJson.mcp, "the JSON root answers on workers.dev");
  const curlDocs = await ask(moved, `${W}/docs`, { headers: CURL });
  assert.equal(curlDocs.status, 200, "curl keeps the page where it asked");
  assert.match(await curlDocs.text(), /<link rel="canonical" href="https:\/\/glyphcall\.com\/docs"/, "and the page names the public site as canonical, as before");
});

test("a free trial call on workers.dev answers there for a browser (a 200 HTML result page) and for a program", async () => {
  const page = await ask(moved, `${W}/uuid?count=1&trial=1`, { headers: { ...BROWSER, "cf-connecting-ip": "203.0.113.7" } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/, "the worst case: a 200 text/html answer to a browser's GET");
  assert.equal(page.headers.get("location"), null);
  assert.ok(page.headers.get("X-Free-Trial-Remaining"));
  assert.match(await page.text(), /[0-9a-f]{8}-[0-9a-f]{4}-/);
  const json = await ask(moved, `${W}/uuid?count=1&trial=1`, { headers: { ...JSON_CLIENT, "cf-connecting-ip": "203.0.113.8" } });
  assert.equal(json.status, 200);
  assert.equal((await json.json()).uuids.length, 1);
});

test("a PAID tool request on the workers.dev host is not redirected: prepaid key, with Accept: text/html", async () => {
  // The card checkout returns to /credits/claim on the host that sold it; a browser gets the key page there.
  const claim = await ask(moved, `${W}/credits/claim?session_id=cs_test_PaidOnWorkersDev01`);
  assert.equal(claim.status, 200, "the checkout return is answered on workers.dev, with its query");
  assert.equal(claim.headers.get("location"), null);
  const key = /<pre>(adt_[A-Za-z0-9_-]+)<\/pre>/.exec(await claim.text())[1];
  const before = await (await ask(moved, `${W}/credits/balance`, { headers: { ...BROWSER, authorization: `Bearer ${key}` } })).json();
  for (const headers of [{ ...BROWSER, authorization: `Bearer ${key}` }, { ...BROWSER, "x-api-key": key }]) {
    const paid = await ask(moved, `${W}/uuid?count=2`, { headers });
    assert.equal(paid.status, 200);
    assert.equal(paid.headers.get("location"), null);
    assert.match(paid.headers.get("content-type"), /application\/json/);
    assert.equal((await paid.json()).uuids.length, 2, "the tool's normal answer");
  }
  const byQuery = await ask(moved, `${W}/uuid?count=1&api_key=${key}`);
  assert.equal(byQuery.status, 200);
  assert.equal(byQuery.headers.get("location"), null);
  assert.equal((await byQuery.json()).uuids.length, 1);
  const afterCalls = await (await ask(moved, `${W}/credits/balance`, { headers: { ...BROWSER, authorization: `Bearer ${key}` } })).json();
  assert.ok(afterCalls.balanceCredits < before.balanceCredits, "the calls were charged to the key");
  // The same key works on glyphcall.com: both hosts are one Worker with one key store.
  const home = await ask(moved, `${SITE}/uuid?count=1`, { headers: { ...JSON_CLIENT, authorization: `Bearer ${key}` } });
  assert.equal(home.status, 200);
  await home.arrayBuffer();
});

test("a PAID tool request on the workers.dev host is not redirected: x402 payment, with Accept: text/html", async () => {
  const url = `${W}/extract?url=https%3A%2F%2Fpublic.example%2Farticle`;
  const quote = await ask(moved, url, { headers: JSON_CLIENT });
  assert.equal(quote.status, 402);
  const required = JSON.parse(Buffer.from(quote.headers.get("PAYMENT-REQUIRED"), "base64"));
  await quote.arrayBuffer();
  assert.equal(required.resource.url, url);
  assert.equal(required.resource.iconUrl, `${SITE}/logo.png`, "the icon in the quote is on the public site");
  const requirements = required.accepts[0];
  const payment = { x402Version: 2, resource: { url }, accepted: requirements, payload: { signature: "0x" + "a".repeat(130), authorization: { from: payer, to: recipient, value: requirements.amount, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: "0x" + "5".repeat(64) } } };
  const paid = await ask(moved, url, { headers: { ...BROWSER, "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payment)).toString("base64") } });
  assert.equal(paid.status, 200);
  assert.equal(paid.headers.get("location"), null);
  assert.ok(paid.headers.has("PAYMENT-RESPONSE"), "the payment settled on this answer");
  assert.match(paid.headers.get("content-type"), /application\/json/);
  assert.match((await paid.json()).text, /Useful result/, "the tool's normal answer");
});

test("no loop: www goes to the apex in one step, the apex and the staging host never redirect", async () => {
  for (const path of ["/", "/docs?a=1", "/tools/time"]) {
    const www = await ask(moved, `https://www.glyphcall.com${path}`);
    assert.equal(www.status, 301);
    assert.equal(www.headers.get("location"), SITE + path);
    await www.arrayBuffer();
    const apex = await ask(moved, SITE + path);
    assert.equal(apex.status, 200, "the target of both redirects answers itself");
    await apex.arrayBuffer();
    const staging = await ask(moved, STAGING + path);
    assert.equal(staging.status, 200, "an unlisted workers.dev host keeps its pages");
    assert.equal(staging.headers.get("location"), null);
    await staging.arrayBuffer();
  }
});

test("robots.txt on workers.dev names the public site's sitemap and keeps its rules; glyphcall.com names its own", async () => {
  const there = await (await ask(moved, `${W}/robots.txt`, { headers: CURL })).text();
  assert.match(there, /^Sitemap: https:\/\/glyphcall\.com\/sitemap\.xml$/m);
  assert.ok(!there.includes("workers.dev"));
  for (const line of ["User-agent: *", "Allow: /", "Disallow: /*trial=1"]) assert.ok(there.split("\n").includes(line), line);
  const home = await (await ask(moved, `${SITE}/robots.txt`, { headers: CURL })).text();
  assert.equal(home, there, "one robots.txt, one sitemap");
  const map = await ask(moved, `${SITE}/sitemap.xml`, { headers: CURL });
  assert.equal(map.status, 200);
  assert.match(await map.text(), /<loc>https:\/\/glyphcall\.com\/docs<\/loc>/);
  assert.equal(S.withPublicSitemap("Allow: /\n\nSitemap: https://x.test/sitemap.xml", "https://x.test", undefined), "Allow: /\n\nSitemap: https://x.test/sitemap.xml", "no public site, no change (staging)");
});

test("the rule itself: every condition must hold, and tool paths and the never-moved prefixes always stay", () => {
  const host = "agent-data-tools.revmesh2074.workers.dev";
  const go = (over = {}, res = {}, ...rest) => S.movedBrowserPageUrl(
    { method: over.method ?? "GET", url: over.url ?? `${W}/docs?a=1`, header: (n) => ({ accept: "text/html", ...over.headers })[n] },
    { status: res.status ?? 200, contentType: "contentType" in res ? res.contentType : "text/html; charset=UTF-8" }, ...(rest.length ? rest : [SITE, host]), rest[2] ?? (() => false));
  assert.equal(go(), "https://glyphcall.com/docs?a=1");
  assert.equal(go({}, {}, `${SITE}/`, ` other.example , ${host.toUpperCase()} `), "https://glyphcall.com/docs?a=1");
  for (const method of ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) assert.equal(go({ method }), null, method);
  for (const accept of [undefined, "", "*/*", "application/json", "application/xhtml+xml", "text/plain"]) assert.equal(go({ headers: { accept } }), null, `Accept: ${accept}`);
  for (const status of [201, 206, 301, 302, 304, 400, 402, 404, 500]) assert.equal(go({}, { status }), null, String(status));
  for (const contentType of [null, "application/json", "text/plain", "application/xml", "image/png", "text/event-stream"]) assert.equal(go({}, { contentType }), null, String(contentType));
  for (const name of ["payment-signature", "x-payment", "authorization", "x-api-key"]) assert.equal(go({ headers: { [name]: "x" } }), null, name);
  for (const [site, hosts] of [[undefined, host], ["", host], [SITE, undefined], [SITE, ""], ["glyphcall.com", host], ["http://glyphcall.com", host], [`${SITE}/x`, host], [SITE, "tools.funwords.eu"], [W, host]]) assert.equal(go({}, {}, site, hosts), null, `${site} / ${hosts}`);
  assert.equal(go({ url: `${STAGING}/docs` }), null, "staging is another host");
  assert.equal(go({ url: `${SITE}/docs` }, {}, SITE, `glyphcall.com,${host}`), null, "the public site never redirects to itself");
  assert.equal(go({ url: `${W}/time?zone=UTC` }, {}, SITE, host, (p) => p === "/time"), null, "a tool path, even with a 200 HTML answer");
  for (const p of S.NEVER_MOVED_PREFIXES) for (const tail of ["", "/", "/x", "/x/y?z=1"]) assert.equal(go({ url: W + p + tail }), null, p + tail);
  for (const p of ["/mcp", "/v1", "/credits", "/.well-known", "/keys", "/oauth", "/discovery", "/openapi.json", "/llms.txt", "/store", "/buy", "/order", "/p", "/payee"]) assert.ok(S.NEVER_MOVED_PREFIXES.includes(p), `${p} is on the list`);
  // A prefix is a whole path segment: pages whose names merely start the same way still move.
  for (const page of ["/pdf-to-text-api", "/pricing-notes", "/v1x", "/creditsx", "/payee-check-api"]) assert.equal(go({ url: W + page }), `${SITE}${page}`, page);
});

test("production lists only the paid workers.dev host for the browser rule; staging has none", () => {
  const prod = readFileSync("wrangler.jsonc", "utf8");
  assert.match(prod, /"BROWSER_PAGES_MOVED_HOSTS": "agent-data-tools\.revmesh2074\.workers\.dev"/);
  assert.ok(!/"RETIRED_PUBLIC_HOSTS": "[^"]*workers\.dev/.test(prod), "the paid origin is never a retired host: that rule moves every 200 HTML answer");
  assert.ok(!/BROWSER_PAGES_MOVED_HOSTS|PUBLIC_SITE_ORIGIN/.test(readFileSync("wrangler.staging.jsonc", "utf8")));
});
