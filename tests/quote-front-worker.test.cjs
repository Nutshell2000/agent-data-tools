// Quote front (19 Nov 2026), step 3: the front Worker (src/front/index.ts) in front of the real core over a service binding.
// - A repeated unpaid quote is answered by the front ("X-Quote-Front: hit") with the core's exact status, headers,
//   PAYMENT-REQUIRED and body, plus MPP challenges minted fresh that carry the core's terms and verify with its secret.
// - Payments, keys, browsers, free calls, Origin requests and HEAD always reach the core.
// - A new core release retires every stored quote; FRONT=off passes everything through.
// - A credential built on a front challenge gets past the core's challenge check (same as one built on a core challenge).
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");

const recipient = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", asset = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SECRET = "test-mpp-secret-0123456789abcdef";
const O = "https://agent-data-tools.revmesh2074.workers.dev";
let mf, mppx, F;

const load = async (entry, name) => {
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
  const mod = new Module(name, null); mod.filename = path.resolve(name); mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(out.outputFiles[0].text, mod.filename); return mod.exports;
};

const coreOptions = (script) => ({ name: "core", modules: true, script, serviceBindings: { FRONT_SECRETS: { name: "front", entrypoint: "Secrets" } }, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
  durableObjects: { METRICS: { className: "Metrics", useSQLite: true } }, kvNamespaces: ["TRIALS"],
  bindings: { PAY_TO: recipient, NETWORK: "eip155:8453", PAYWALL: "on", TRIALS_ENABLED: "on", MPP_EVM: "on", MPP_SECRET_KEY: SECRET, QUOTE_CACHE: "off",
    FACILITATOR_URL: "https://fixture.invalid", BASE_RPC_URL: "https://fixture.invalid", PUBLIC_SITE_ORIGIN: "https://glyphcall.com", PUBLIC_BRAND: "Glyphcall", STRIPE_READ_KEY: "rk_test_fixture" },
  outboundService: async () => new Response("offline", { status: 503 }) });

let frontScript, coreScript;
const start = async (frontBindings = {}) => {
  await mf?.dispose();
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "front", modules: true, script: frontScript, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"], kvNamespaces: ["QUOTES"],
      serviceBindings: { CORE: "core" }, bindings: { MPP_SECRET_KEY: SECRET, REVENUE_TOKEN: "front-held-revenue-token", PAY_TO: "0x000000000000000000000000000000000000dead", ...frontBindings } },
    coreOptions(coreScript),
  ] }));
};

before(async () => {
  mppx = await load(require.resolve("mppx"), "mppx-core-front-test.js");
  F = await load(require.resolve("../src/front/challenges.ts"), "front-challenges-worker-test.js");
  const fb = await esbuild.build({ entryPoints: ["src/front/index.ts"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", minify: true, external: ["cloudflare:workers"] });
  frontScript = fb.outputFiles[0].text;
  const b = await esbuild.build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", external: ["cloudflare:workers", "node:*"], alias: { "ajv/dist/2020.js": path.resolve("src/lib/ajv-unavailable.ts") }, plugins: [{ name: "fixture-facilitator", setup(p) {
    p.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true }));
    p.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: "fixture", namespace: "fixture" }));
    p.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async()=>({isValid:false,invalidReason:'fixture'}), settle:async()=>({success:false})
    }}` }));
  } }] });
  coreScript = b.outputFiles[0].text;
  await start();
});
after(async () => { await mf?.dispose(); });

const PER_ANSWER = new Set(["www-authenticate", "x-request-id", "date", "content-length", "set-cookie", "x-quote-cache", "cf-ray", "report-to", "nel", "server", "alt-svc", "x-quote-front", "x-quote-release",
  // Miniflare's entry negotiates encoding on dispatchFetch answers only (a direct worker fetch has none): harness headers.
  "mf-content-encoding", "transfer-encoding", "content-encoding"]);
const comparable = (headers) => [...headers.entries()].filter(([n]) => !PER_ANSWER.has(n.toLowerCase())).map(([n, v]) => [n.toLowerCase(), v]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
const JSON_CLIENT = { accept: "application/json", "user-agent": "node" };
const ask = (url, headers = JSON_CLIENT, init = {}) => mf.dispatchFetch(url, { headers, redirect: "manual", ...init });
const core = async () => mf.getWorker("core");
const challenges = (res) => (res.headers.get("www-authenticate") ?? "").split(/,\s*(?=Payment\s)/).filter(Boolean).map((c) => mppx.Challenge.deserialize(c));
const terms = (ch) => { const m = mppx.Challenge.meta(ch) ?? {}; return { method: ch.method, intent: ch.intent, request: ch.request, description: ch.description, realm: ch.realm, scope: m._mppx_scope }; };

test("a bare tool quote is stored on the first miss and answered by the front after that, equal to the core's", async () => {
  for (const p of ["/pack/url-safety", "/weather", "/merchant/trust"]) {
    const first = await ask(O + p);
    await first.text();
    assert.equal(first.status, 402);
    assert.equal(first.headers.get("x-quote-front"), null, `${p}: first answer comes from the core`);
    assert.ok(first.headers.get("x-quote-release"), "the core stamps its release");
    let hit;
    for (let i = 0; i < 20 && !hit; i++) { const r = await ask(O + p); const text = await r.text(); if (r.headers.get("x-quote-front") === "hit") hit = { r, text }; else await new Promise((s) => setTimeout(s, 25)); }
    assert.ok(hit, `${p}: the front answers the repeat`);
    const direct = await (await core()).fetch(O + p, { headers: JSON_CLIENT });
    const directText = await direct.text();
    assert.equal(hit.r.status, direct.status);
    assert.equal(hit.text, directText, `${p}: body byte for byte`);
    assert.deepEqual(comparable(hit.r.headers), comparable(direct.headers), `${p}: headers incl. PAYMENT-REQUIRED`);
    const fromFront = challenges(hit.r), fromCore = challenges(direct);
    assert.ok(fromCore.length >= 1, "the core offers MPP here");
    assert.deepEqual(fromFront.map(terms), fromCore.map(terms), `${p}: same MPP terms in the same order`);
    for (const ch of fromFront) {
      assert.equal(mppx.Challenge.verify(ch, { secretKey: await F.challengeSecretHex(SECRET, ch.method) }), true, `${p}: ${ch.method} challenge verifies with the core's secret`);
      assert.ok(!fromCore.some((c) => c.id === ch.id), "never a stored challenge");
    }
  }
});

const hitAfter = async (url, headers = JSON_CLIENT, tries = 20) => {
  for (let i = 0; i < tries; i++) { const r = await ask(url, headers); await r.text(); if (r.headers.get("x-quote-front") === "hit") return true; await new Promise((s) => setTimeout(s, 25)); }
  return false;
};

test("paid tools under a reserved prefix are answered by the front; their page siblings never are (21 Nov 2026)", async () => {
  // /sitemap, /robots, /openapi/summary and /mcp/inspect are paid tools that share a prefix with /sitemap.xml,
  // /robots.txt, /openapi.json and the /mcp servers. Until 1.323.0 the prefix kept all four away from the front.
  const source = require("node:fs").readFileSync(path.resolve("src/front/index.ts"), "utf8");
  const never = new RegExp(source.match(/const NEVER = \/(.+)\/;/)[1]);
  const listed = new Set(JSON.parse(`[${source.match(/const TOOLS_UNDER_NEVER = new Set\(\[([^\]]+)\]\)/)[1]}]`));
  const { ENDPOINTS } = await load(require.resolve("../src/endpoints.ts"), "endpoints-front-never-test.js");
  const caught = ENDPOINTS.map((e) => e.path).filter((p) => never.test(p));
  assert.deepEqual([...caught].sort(), [...listed].sort(), "every catalogue path a NEVER prefix catches is listed in TOOLS_UNDER_NEVER, and nothing else is");
  for (const p of listed) {
    const first = await ask(O + p);
    await first.text();
    assert.equal(first.status, 402, `${p}: a paid tool`);
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) { const r = await ask(O + p); await r.text(); hit = r.headers.get("x-quote-front") === "hit"; if (!hit) await new Promise((s) => setTimeout(s, 25)); }
    assert.ok(hit, `${p}: the front answers the repeat`);
  }
  for (const p of ["/sitemap.xml", "/robots.txt", "/openapi.json", "/mcp", "/llms.txt"]) {
    for (let i = 0; i < 3; i++) { const r = await ask(O + p); await r.arrayBuffer(); assert.equal(r.headers.get("x-quote-front"), null, `${p}: always the core`); }
  }
});

test("a URL with a query is stored only after a second miss, then answered with its own resource URL", async () => {
  const url = O + "/pack/url-safety?url=https%3A%2F%2Fexample.com%2Fa%20b";
  const kv = await mf.getKVNamespace("QUOTES", "front");
  const r1 = await ask(url); await r1.text();
  await new Promise((s) => setTimeout(s, 100));
  assert.ok(!(await kv.list()).keys.some((k) => k.name.endsWith(url)), "a one-off URL is never written");
  assert.ok(await hitAfter(url), "a repeated URL is answered by the front");
  const hit = await ask(url); const body = JSON.parse(await hit.text());
  assert.equal(hit.headers.get("x-quote-front"), "hit");
  assert.equal(body.resource.url, url);
  assert.equal(JSON.parse(Buffer.from(hit.headers.get("payment-required"), "base64").toString()).resource.url, url);
});

test("payments, keys, browsers, free calls, Origin requests, HEAD and pages always reach the core", async () => {
  const p = O + "/weather";
  assert.ok(await hitAfter(p), "warm-up: the bare quote is stored");
  const cases = [
    [p, { ...JSON_CLIENT, "payment-signature": "e30=" }],
    [p, { ...JSON_CLIENT, "x-payment": "e30=" }],
    [p, { ...JSON_CLIENT, authorization: "Payment e30" }],
    [p, { ...JSON_CLIENT, "x-api-key": "adt_test" }],
    [p, { ...JSON_CLIENT, cookie: "a=b" }],
    [p, { ...JSON_CLIENT, origin: "https://example.com" }],
    [p, { accept: "text/html", "user-agent": "Mozilla/5.0 Chrome/130" }],
    [p + "?trial=1", JSON_CLIENT],
    [p + "?sample=1", JSON_CLIENT],
    [p + "?api_key=adt_x", JSON_CLIENT],
    [O + "/", JSON_CLIENT],
    [O + "/tools", JSON_CLIENT],
    [O + "/.well-known/x402", JSON_CLIENT],
  ];
  for (const [url, headers] of cases) {
    const r = await ask(url, headers); await r.text();
    assert.equal(r.headers.get("x-quote-front"), null, `${url} ${JSON.stringify(headers)} goes to the core`);
    assert.ok(r.headers.get("x-quote-release"), "answered by the core");
  }
  const head = await ask(p, JSON_CLIENT, { method: "HEAD" });
  assert.equal(head.headers.get("x-quote-front"), null, "HEAD goes to the core");
  const post = await ask(p, { ...JSON_CLIENT, "content-type": "application/json" }, { method: "POST", body: "{}" });
  await post.text();
  assert.equal(post.headers.get("x-quote-front"), null, "POST goes to the core");
});

test("a credential built on a front challenge passes the core's challenge check; a forged challenge does not", async () => {
  const p = O + "/pack/url-safety";
  assert.ok(await hitAfter(p));
  const hit = await ask(p); await hit.text();
  const evm = challenges(hit).find((c) => c.method === "evm");
  assert.ok(evm, "the front offers an evm challenge");
  const payload = { type: "authorization", signature: "0x" + "11".repeat(65), from: "0x" + "22".repeat(20), to: recipient, value: "10000", validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: "0x" + "33".repeat(32) };
  const types = await load(path.resolve("node_modules/mppx/dist/evm/Types.js"), "mppx-evm-types-test.js");
  const send = async (challenge) => {
    const r = await ask(p, { ...JSON_CLIENT, authorization: mppx.Credential.serialize(mppx.Credential.from({ challenge, payload: { ...payload, nonce: types.challengeHash(challenge) } })) });
    return { status: r.status, error: String((await r.json()).error ?? "") };
  };
  const genuine = await send(evm);
  const forged = await send({ ...evm, id: evm.id.slice(0, -4) + (evm.id.endsWith("AAAA") ? "BBBB" : "AAAA") });
  assert.match(forged.error, /challenge/i, "the core refuses a challenge it did not sign");
  assert.doesNotMatch(genuine.error, /challenge/i, `the core accepts the front's challenge and judges the payment itself: ${genuine.error}`);
  // Past the challenge HMAC, recipient, amount and the nonce bound to the challenge hash: only the fake signature fails.
  assert.match(genuine.error, /yParity|signature|signer/i, "it got as far as the signature");
  assert.match(forged.error, /not issued by this server/);
});

test("a new core release retires every stored quote; FRONT=off passes everything", async () => {
  const p = O + "/btc-fees";
  assert.ok(await hitAfter(p));
  const kv = await mf.getKVNamespace("QUOTES", "front");
  const real = await kv.get("q:release");
  await kv.put("q:release", "older-release");
  await start({ FRONT: "on" });
  const kv2 = await mf.getKVNamespace("QUOTES", "front");
  await kv2.put("q:release", "older-release");
  await kv2.put(`q:older-release:${p}`, JSON.stringify({ v: 1, release: "older-release", status: 402, headers: [["content-type", "application/json"]], body: "{\"stale\":true}", mpp: [] }));
  const pre = await ask(p); await pre.text(); // may still be the stale quote: the front has not seen the new core yet
  const page = await ask(O + "/health"); await page.text(); // any answer from the core carries its release
  const r = await ask(p); const text = await r.text();
  assert.ok(!text.includes("stale"), "the stored quote of an older release is not served once the core has answered");
  assert.notEqual(await kv2.get("q:release"), "older-release", "the front records the core's release");
  assert.ok(real);
  await start({ FRONT: "off" });
  for (let i = 0; i < 4; i++) { const x = await ask(p); await x.text(); assert.equal(x.headers.get("x-quote-front"), null, "FRONT=off: the core answers"); }
  await start();
});

test("only a tool's own address is stored: other spellings go to the core every time and never reach KV (21 Nov 2026)", async () => {
  // Safety audit: "/btc-%66ees" was a KV key of its own, stored on its first miss, so anyone could fill the store and
  // use up the write allowance with spellings of one tool. The core answers these spellings as the tool (a 402 quote),
  // so they must stay 402s: only never stored, never looked up, never an error.
  const source = require("node:fs").readFileSync(path.resolve("src/front/index.ts"), "utf8");
  const plain = new RegExp(source.match(/const PLAIN_PATH = \/(.+)\/;/)[1]);
  const { ENDPOINTS } = await load(require.resolve("../src/endpoints.ts"), "endpoints-front-plain-test.js");
  const odd = ENDPOINTS.map((e) => e.path).filter((p) => !plain.test(p));
  assert.deepEqual(odd, [], "every catalogue path has the plain shape the front stores");
  for (const p of ["/btc-%66ees", "/BTC-FEES", "/btc-fees/", "//btc-fees", "/btc-fees//", "/Btc-Fees?x=1", "/btc-fees%2F"]) assert.equal(plain.test(new URL(O + p).pathname), false, `${p} is not a plain path`);
  const kv = await mf.getKVNamespace("QUOTES", "front");
  const spellings = ["/btc-%66ees", "/BTC-FEES", "/btc-fees/", "//btc-fees", "/btc-fees.json"];
  for (const p of spellings) {
    for (let i = 0; i < 4; i++) {
      const r = await ask(O + p); await r.text();
      assert.equal(r.status, 402, `${p}: still the tool's quote, try ${i + 1}`);
      assert.ok(r.headers.get("payment-required"), `${p}: with its payment terms`);
      assert.equal(r.headers.get("x-quote-front"), null, `${p}: answered by the core, try ${i + 1}`);
      assert.ok(r.headers.get("x-quote-release"), `${p}: the core's stamp`);
    }
  }
  await new Promise((s) => setTimeout(s, 150));
  const keys = (await kv.list()).keys.map((k) => k.name);
  for (const p of spellings) assert.ok(!keys.some((k) => k.endsWith(O + p)), `${p}: no KV key`);
  assert.ok(!keys.some((k) => /%66|BTC|btc-fees\/$|\/\/btc-fees|\.json$/.test(k.slice(k.indexOf("https://") + 8))), `no spelling of the tool in KV: ${keys.filter((k) => /btc/i.test(k)).join(" ")}`);
  // The tool's own address is stored and served as before.
  assert.ok(await hitAfter(O + "/btc-fees"), "the plain path is answered by the front");
  assert.ok(keys.length === 0 || keys.every((k) => k === "q:release" || /^q:[^:]+:https:\/\//.test(k)));
});

test("a location that has used its hourly write allowance stores nothing more; quotes are still answered (21 Nov 2026)", async () => {
  // The per-isolate limit multiplies with the number of isolates, so the front also counts writes in the location's
  // edge cache, shared by its isolates. The count is put above the limit here, as many isolates' writes would.
  const cache = (await mf.getCaches()).default;
  const hour = Math.floor(Date.now() / 3_600_000);
  const marks = [hour, hour + 1].map((h) => `https://quote-front-writes.invalid/${h}`);
  for (const key of marks) await cache.put(key, new Response("999999", { headers: { "cache-control": "max-age=3600" } }));
  const kv = await mf.getKVNamespace("QUOTES", "front");
  const p = O + "/uuid";
  for (let i = 0; i < 6; i++) {
    const r = await ask(p); await r.text();
    assert.equal(r.status, 402, "the quote is answered all the same");
    assert.equal(r.headers.get("x-quote-front"), null, "by the core: nothing was stored");
    await new Promise((s) => setTimeout(s, 25));
  }
  assert.ok(!(await kv.list()).keys.some((k) => k.name.endsWith(p)), "no KV write above the location's allowance");
  for (const key of marks) await cache.delete(key);
  assert.ok(await hitAfter(p), "with the allowance back, the quote is stored and the front answers");
  const held = await cache.match(marks[0]) ?? await cache.match(marks[1]);
  assert.ok(held && Number(await held.text()) >= 1, "each stored quote is counted in the location's cache");
});

test("the core gets the secrets the front holds, and its own settings win", async () => {
  const withToken = await ask(O + "/revenue", { ...JSON_CLIENT, authorization: "Bearer front-held-revenue-token" });
  const body = await withToken.json();
  assert.equal(withToken.status, 200);
  assert.ok("cardCredits" in body, "REVENUE_TOKEN held only by the front unlocks the private figures in the core");
  const without = await (await ask(O + "/revenue")).json();
  assert.ok(!("cardCredits" in without), "and nothing without it");
  const quote = await ask(O + "/weather?city=Paris", JSON_CLIENT); await quote.text();
  const pr = JSON.parse(Buffer.from(quote.headers.get("payment-required"), "base64").toString());
  assert.equal(pr.accepts[0].payTo.toLowerCase(), recipient, "the core's own PAY_TO is never replaced by a front value");
});