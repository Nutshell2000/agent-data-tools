// 1.260.0 (19 Nov 2026): tts.glyphcall.com answers ONLY the text-to-speech tools, so routers that group listings by host
// (Mercator imports one service per host from the Bazaar) see a text-to-speech service. Checked against the real Worker:
// the speech tools quote on that host with a resource URL on that host and a speech service name; every other tool path
// answers 404 (so nothing else can ever be settled and listed there); and every other host is unchanged.
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");

const TTS = "https://tts.glyphcall.com", API = "https://api.glyphcall.com", W = "https://agent-data-tools.revmesh2074.workers.dev";
const recipient = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", asset = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", payer = "0x" + "1".repeat(40);
const JSON_CLIENT = { accept: "application/json", "user-agent": "node" };

let H, mf;
before(async () => {
  const entry = require.resolve("../src/lib/tts-host.ts");
  const lib = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const mod = new Module(entry, null); mod.filename = entry; mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(lib.outputFiles[0].text, entry); H = mod.exports;
  const b = await esbuild.build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", external: ["cloudflare:workers", "node:*"], alias: { "ajv/dist/2020.js": require("node:path").resolve("src/lib/ajv-unavailable.ts") }, plugins: [{ name: "fixture-facilitator", setup(p) {
    p.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true }));
    p.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: "fixture", namespace: "fixture" }));
    p.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async p=>({isValid:true,payer:'${payer}'}),
      settle:async p=>({success:true,network:'eip155:8453',transaction:'0x'+'2'.repeat(64),payer:'${payer}',amount:'10000'})
    }}` }));
  } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { METRICS: { className: "Metrics", useSQLite: true } }, kvNamespaces: ["TRIALS"],
    bindings: { PAY_TO: recipient, NETWORK: "eip155:8453", PAYWALL: "on", TRIALS_ENABLED: "on", MPP_EVM: "off", QUOTE_CACHE: "off", FACILITATOR_URL: "https://fixture.invalid", BASE_RPC_URL: "https://fixture.invalid",
      PUBLIC_SITE_ORIGIN: "https://glyphcall.com", PUBLIC_BRAND: "Glyphcall" },
    outboundService: async () => new Response("offline", { status: 503 }) }));
});
after(async () => { await mf?.dispose(); });

const ask = (url, init = {}) => mf.dispatchFetch(url, { headers: JSON_CLIENT, redirect: "manual", ...init });
const quoteOf = (r) => JSON.parse(Buffer.from(r.headers.get("payment-required"), "base64").toString("utf8"));

test("the host serves exactly the speech tools and the speech front", () => {
  assert.equal(H.TTS_HOST, "tts.glyphcall.com");
  assert.deepEqual([...H.TTS_HOST_PATHS].sort(), ["/ai/speech", "/ai/tts", "/text-to-speech", "/text-to-speech/lite", "/v1/audio/speech"]);
  assert.equal(H.ttsHostAnswer(`${API}/weather`), null, "other hosts are never touched");
  assert.equal(H.ttsHostAnswer(`${W}/`), null);
  assert.equal(H.ttsHostAnswer(`${TTS}/ai/speech?text=hi`), null);
});

test("each speech tool quotes on the TTS host, under that host and a speech service name", async () => {
  for (const path of ["/ai/speech", "/ai/tts", "/text-to-speech", "/text-to-speech/lite"]) {
    const r = await ask(TTS + path);
    assert.equal(r.status, 402, path);
    const q = quoteOf(r);
    assert.equal(q.resource.url, TTS + path, `${path}: the listing a settlement writes names this host`);
    assert.match(q.resource.serviceName, /text to speech/i, `${path}: ${q.resource.serviceName}`);
    assert.ok(q.accepts.some((a) => a.payTo.toLowerCase() === recipient), `${path}: same wallet`);
    await r.arrayBuffer();
  }
});

test("the speech tools cost the same on the TTS host as on the API host", async () => {
  for (const path of ["/ai/speech", "/ai/tts", "/text-to-speech", "/text-to-speech/lite"]) {
    const [a, b] = await Promise.all([ask(TTS + path), ask(API + path)]);
    assert.deepEqual(quoteOf(a).accepts.map((x) => x.amount), quoteOf(b).accepts.map((x) => x.amount), path);
    await a.arrayBuffer(); await b.arrayBuffer();
  }
});

test("every other path answers 404 on the TTS host and names where it lives; nothing else can be listed there", async () => {
  for (const path of ["/weather", "/btc-fees", "/pack/url-safety", "/transcribe", "/mcp", "/openapi.json", "/.well-known/x402", "/discovery/resources", "/credits", "/tools/ai-speech", "/v1/chat/completions"]) {
    const r = await ask(TTS + path + "?city=London");
    assert.equal(r.status, 404, path);
    assert.equal(r.headers.get("payment-required"), null, `${path}: no payment terms`);
    const body = await r.json();
    assert.equal(body.code, "NOT_ON_THIS_HOST", path);
    assert.equal(body.use, `${API}${path}?city=London`, path);
  }
  const post = await ask(TTS + "/v1/chat/completions", { method: "POST", body: "{}", headers: { ...JSON_CLIENT, "content-type": "application/json" } });
  assert.equal(post.status, 404); await post.arrayBuffer();
});

test("the TTS host root describes the service and lists only speech tools", async () => {
  const r = await ask(TTS + "/");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.service, "Text to speech");
  assert.ok(body.tools.length === 5 && body.tools.every((t) => t.startsWith(TTS + "/")), JSON.stringify(body.tools));
});

test("other hosts answer exactly as before", async () => {
  const w = await ask(W + "/weather");
  assert.equal(w.status, 402, "a tool on workers.dev still quotes");
  assert.equal(quoteOf(w).resource.url, W + "/weather");
  await w.arrayBuffer();
  const a = await ask(API + "/ai/speech");
  assert.equal(a.status, 402);
  assert.equal(quoteOf(a).resource.url, API + "/ai/speech");
  await a.arrayBuffer();
});

const WEB = "https://web.glyphcall.com";

test("web.glyphcall.com quotes the web-reading tools under its own host, at the same price as the API host", async () => {
  for (const path of ["/page/markdown", "/scrape", "/extract", "/pdf/text", "/audit/website"]) {
    const [a, b] = await Promise.all([ask(WEB + path), ask(API + path)]);
    assert.equal(a.status, 402, path);
    assert.equal(quoteOf(a).resource.url, WEB + path, `${path}: a settlement here lists the web host`);
    assert.deepEqual(quoteOf(a).accepts.map((x) => x.amount), quoteOf(b).accepts.map((x) => x.amount), path);
    await a.arrayBuffer(); await b.arrayBuffer();
  }
});

test("web.glyphcall.com refuses speech, weather and, deliberately, URL safety (no second URL-safety vendor)", async () => {
  for (const path of ["/ai/speech", "/weather", "/pack/url-safety", "/url/safety-check", "/phishing/check", "/merchant/trust", "/mcp"]) {
    const r = await ask(WEB + path);
    assert.equal(r.status, 404, path);
    assert.equal(r.headers.get("payment-required"), null, path);
    assert.equal((await r.json()).code, "NOT_ON_THIS_HOST", path);
  }
});

test("each category host's root describes only its own tools, and the TTS host still refuses web tools", async () => {
  const w = await (await ask(WEB + "/")).json();
  assert.equal(w.service, "Web page to Markdown");
  assert.ok(w.tools.every((t) => t.startsWith(WEB + "/")) && w.tools.includes(WEB + "/page/markdown"));
  const r = await ask(TTS + "/page/markdown");
  assert.equal(r.status, 404); await r.arrayBuffer();
  assert.equal(H.categoryHostAnswer("https://api.glyphcall.com/page/markdown"), null);
});
