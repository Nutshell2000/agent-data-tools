// 21 Nov 2026 codebase audit: a dead link's domain is the caller's input, a same-currency rate is 1, and our own
// discovery files carry the same method and tag order as the live 402.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"], logLevel: "silent" });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

let F, R, D, B, E;
before(async () => {
  F = await load(require.resolve("../src/lib/fetch.ts"));
  R = await load(require.resolve("../src/routes/rates.ts"));
  D = await load(require.resolve("../src/lib/discovery-index.ts"));
  B = await load(require.resolve("../src/lib/bazaar-extension.ts"));
  E = await load(require.resolve("../src/endpoints.ts"));
});

test("hostMissing is true only for NXDOMAIN; any doubt keeps the 502", async () => {
  assert.equal(await F.hostMissing("gone.example", async () => json({ Status: 3 })), true);
  assert.equal(await F.hostMissing("ok.example", async () => json({ Status: 0 })), false);
  assert.equal(await F.hostMissing("servfail.example", async () => json({ Status: 2 })), false);
  assert.equal(await F.hostMissing("slow.example", async () => { throw new Error("timeout"); }), false);
  assert.equal(await F.hostMissing("busy.example", async () => new Response("no", { status: 503 })), false);
  assert.equal(await F.hostMissing("1.2.3.4", async () => json({ Status: 3 })), false, "an IP literal is never NXDOMAIN");
});

test("a target equal to the base currency is rate 1, alone or in a list", async () => {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => { asked.push(String(url)); return json({ base: "USD", date: "2026-11-20", rates: { EUR: 0.9, GBP: 0.76 } }); };
  try {
    const one = await R.exchangeRates("USD", "USD", "100");
    assert.deepEqual(one.rates, { USD: 1 });
    assert.deepEqual(one.converted, { USD: 100 });
    assert.equal(one.rateDate, "2026-11-20");
    const list = await R.exchangeRates("USD", "EUR,USD,GBP", "1");
    assert.deepEqual(Object.keys(list.rates), ["EUR", "USD", "GBP"]);
    assert.equal(list.rates.USD, 1);
    assert.ok(!asked.at(-1).includes("USD%2C") && !/symbols=[^&]*USD/.test(asked.at(-1)), "the base is never asked of the source");
  } finally { globalThis.fetch = real; }
});

test("our discovery files name the GET method and keep the 402's tag order", () => {
  const env = { PAY_TO: "0x6293ded2684F1A76E26bEcef87c137D691Fbf800", NETWORK: "base" };
  const items = D.discoveryResources(env, "https://api.test").items;
  assert.ok(items.length > 100);
  for (const it of items.slice(0, 50)) {
    assert.equal(it.extensions.bazaar.info.input.method, "GET", it.resource);
    const path = new URL(it.resource).pathname;
    const e = E.ENDPOINTS.find((x) => x.path === path);
    if (e) assert.deepEqual(it.tags.slice(0, 5), B.listingTags(e.tags, e.path), e.path);
  }
});

test("readUpTo keeps a small body and streams a large one on without holding it", async () => {
  const stream = (parts) => new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
  const small = await F.readUpTo(stream(["ab", "cd"]), 10);
  assert.equal(new TextDecoder().decode(small.bytes), "abcd");
  assert.equal(small.rest, undefined);
  const big = await F.readUpTo(stream(["abcd", "efgh", "ij"]), 5);
  assert.equal(big.bytes, undefined);
  assert.equal(await new Response(big.rest).text(), "abcdefghij", "nothing is lost when the body streams on");
});

test("an upload with no Content-Length is read through a byte cap", async () => {
  const FI = await load(require.resolve("../src/lib/file-input.ts"));
  const chunked = (bytes) => new Request("https://api.test/pdf/text", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), duplex: "half" });
  const tooBig = await FI.sentFile(chunked(new Uint8Array(5000)), 1000);
  assert.equal(tooBig.kind, "too-large");
  const fine = await FI.sentFile(chunked(new TextEncoder().encode("%PDF-1.4 small")), 1000);
  assert.notEqual(fine.kind, "too-large");
});
