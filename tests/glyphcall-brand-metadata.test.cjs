// 16 Nov 2026: the brand in the service-level fields of payment terms and service cards, and the icon on glyphcall.com.
// A tool's own listing name (the 402 resource's serviceName) still opens with its task: the Bazaar matches the phrase
// at the start of the name, so the brand goes only where the field names the service or the seller's own product.
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const esbuild = require("esbuild");
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");

const W = "https://agent-data-tools.revmesh2074.workers.dev", SITE = "https://glyphcall.com", OLD_ICON = `${W}/logo.png`;
let branded, plain;
before(async () => {
  const b = await esbuild.build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", external: ["cloudflare:workers", "node:*"], alias: { "ajv/dist/2020.js": require("node:path").resolve("src/lib/ajv-unavailable.ts") }, plugins: [{ name: "node-url", setup(p) { p.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true })); } }] });
  const worker = (extra) => new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { METRICS: { className: "Metrics", useSQLite: true } }, kvNamespaces: ["TRIALS"],
    bindings: { PAY_TO: "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", NETWORK: "eip155:8453", PAYWALL: "on", TRIALS_ENABLED: "off", MPP_EVM: "off", QUOTE_CACHE: "off", FACILITATOR_URL: "https://fixture.invalid", BASE_RPC_URL: "https://fixture.invalid", ...extra },
    outboundService: async (r) => new URL(r.url).hostname === "fixture.invalid" ? Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453", extra: { name: "USD Coin", version: "2" } }], extensions: [] }) : new Response("not used", { status: 500 }) }));
  branded = worker({ PUBLIC_SITE_ORIGIN: SITE, PUBLIC_BRAND: "Glyphcall" });
  plain = worker({}); // staging and the tests: no public site
});
after(async () => { await branded?.dispose(); await plain?.dispose(); });

const get = (mf, url) => mf.dispatchFetch(url, { headers: { accept: "application/json", "user-agent": "node" }, redirect: "manual" });
const quote = async (mf, url) => {
  const r = await get(mf, url);
  assert.equal(r.status, 402, url);
  await r.arrayBuffer();
  return JSON.parse(Buffer.from(r.headers.get("PAYMENT-REQUIRED"), "base64"));
};

test("the icon in a quote is on glyphcall.com when the public site is set, and that address serves a PNG", async () => {
  for (const host of [W, SITE]) {
    const terms = await quote(branded, `${host}/time?zone=UTC`);
    assert.equal(terms.resource.iconUrl, `${SITE}/logo.png`, host);
    assert.equal(terms.resource.url, `${host}/time?zone=UTC`, "the resource keeps the host that was called");
  }
  const icon = await get(branded, `${SITE}/logo.png`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await icon.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(bytes.readUInt32BE(16), 512, "512 pixels wide, as the cards say");
  // Without a public site (staging, tests) the icon is the address it always was.
  assert.equal((await quote(plain, `${W}/time?zone=UTC`)).resource.iconUrl, OLD_ICON);
});

test("a tool's own listing name and description still open with its task; only its icon changed", async () => {
  const [now, was] = [await quote(branded, `${W}/weather?city=Oslo`), await quote(plain, `${W}/weather?city=Oslo`)];
  assert.ok(!/glyphcall/i.test(now.resource.serviceName), `the name buyers search stays first: ${now.resource.serviceName}`);
  assert.ok(now.resource.serviceName.length <= 32);
  assert.ok(!/^glyphcall/i.test(now.resource.description));
  assert.deepEqual({ ...now.resource, iconUrl: OLD_ICON }, was.resource, "name, description and tags are untouched");
  assert.deepEqual(now.accepts, was.accepts, "the payment terms are untouched");
  assert.deepEqual(now.extensions, was.extensions, "the Bazaar extension is untouched (a payer echoes it back)");
});

test("service-level fields lead with Glyphcall: store products, credit packs and the agent card", async () => {
  // Store purchases over x402 are paused (410, no payment requested), so their terms are read from the source.
  assert.match(require("node:fs").readFileSync("src/index.ts", "utf8"), /`GET \/buy\/\$\{p\.slug\}`,[\s\S]{0,400}?serviceName: SERVICE_BRAND,\s*iconUrl: serviceIconUrl\(env\.PUBLIC_SITE_ORIGIN, SERVICE_ICON_URL\),/);
  assert.match(require("node:fs").readFileSync("src/lib/public-brand.ts", "utf8"), /export const SERVICE_BRAND = "Glyphcall";/);
  for (const usd of [1, 5, 20]) {
    const pack = await quote(branded, `${W}/credits/usdc/${usd}`);
    assert.equal(pack.resource.serviceName, `Glyphcall API credits, $${usd}`);
    assert.ok(pack.resource.serviceName.length <= 32, "the x402 name limit");
    assert.match(pack.resource.description, /^Glyphcall prepaid API credits, paid once in USDC: returns an API key worth /);
    assert.ok(pack.resource.description.length <= 500, "the Bazaar description limit");
    assert.equal(pack.resource.iconUrl, `${SITE}/logo.png`);
  }
  for (const path of ["/.well-known/agent-card.json", "/.well-known/agent.json"]) {
    const card = await (await get(branded, W + path)).json();
    assert.equal(card.name, "Glyphcall");
    assert.match(card.description, /^Glyphcall: \d+ pay-per-call tools for AI agents/);
    assert.equal(card.iconUrl, `${SITE}/logo.png`);
    assert.equal(card.url, W, "the card still names the origin that was asked");
    assert.equal(card.provider.organization, "SpellzCode");
  }
  assert.equal((await (await get(plain, `${W}/.well-known/agent-card.json`)).json()).iconUrl, OLD_ICON);
});

test("the MCP server keeps its machine name and title; its icon is on the public site", async () => {
  const init = (mf, host) => mf.dispatchFetch(`${host}/mcp`, { method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json", "user-agent": "mcp-client" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
  const info = async (mf, host) => JSON.parse(/\{.*\}/s.exec(await (await init(mf, host)).text())[0]).result.serverInfo;
  const there = await info(branded, W);
  assert.equal(there.name, "agent-data-tools", "installed clients know the server by this name");
  assert.equal(there.icons[0].src, `${SITE}/logo.png`);
  assert.equal(there.websiteUrl, W);
  const staging = await info(plain, "https://agent-data-tools-staging.revmesh2074.workers.dev");
  assert.equal(staging.icons[0].src, "https://agent-data-tools-staging.revmesh2074.workers.dev/logo.png", "no public site: the host that was asked, as before");
  assert.equal(staging.title, there.title);
});
