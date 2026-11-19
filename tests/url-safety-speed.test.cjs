// 19 Nov 2026: speed for our biggest buyer (Mercator's URL-safety fan-out). domainReport keeps a report per domain in the
// edge cache for DOMAIN_REPORT_TTL seconds, so a second link on the same domain makes no DNS or registry request; a broken
// cache never fails a report. /pack/url-safety starts the starting host's blocklist lookup while redirects are followed.
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { readFileSync } = require("node:fs");
const esbuild = require("esbuild");
const Module = require("node:module");

let M, realFetch, realCaches, calls;
const store = new Map();
const fakeCache = {
  async match(req) { const v = store.get(typeof req === "string" ? req : req.url); return v ? new Response(v) : undefined; },
  async put(req, res) { store.set(typeof req === "string" ? req : req.url, await res.text()); },
};
const dnsAnswer = (type) => ({ Status: 0, AD: false, Answer: type === 1 ? [{ name: "example.com.", type: 1, data: "93.184.215.14" }] : type === 2 ? [{ name: "example.com.", type: 2, data: "a.iana-servers.net." }, { name: "example.com.", type: 2, data: "b.iana-servers.net." }] : [] });

before(async () => {
  const entry = require.resolve("../src/routes/domain-report.ts");
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
  const mod = new Module(entry, null); mod.filename = entry; mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(out.outputFiles[0].text, entry); M = mod.exports;
  realFetch = globalThis.fetch; realCaches = globalThis.caches;
  globalThis.caches = { default: fakeCache };
  globalThis.fetch = async (input) => {
    calls++;
    const url = new URL(typeof input === "string" ? input : input.url);
    const type = { A: 1, NS: 2, AAAA: 28, CNAME: 5, MX: 15, TXT: 16 }[url.searchParams.get("type")] ?? Number(url.searchParams.get("type") ?? 0);
    if (/dns|resolve/.test(url.hostname + url.pathname)) return Response.json(dnsAnswer(type), { headers: { "content-type": "application/dns-json" } });
    return new Response("not found", { status: 404 });
  };
});
after(() => { globalThis.fetch = realFetch; globalThis.caches = realCaches; });

test("a second report for the same domain is served from the cache without any network request", async () => {
  store.clear(); calls = 0;
  const first = await M.domainReport({}, "example.com");
  const afterFirst = calls;
  assert.ok(afterFirst > 0, "the first report reads DNS/registry");
  const second = await M.domainReport({}, "EXAMPLE.com");
  assert.equal(calls, afterFirst, "no request on the cached report (case-insensitive key)");
  assert.deepEqual(second, first, "same report, including its own checkedAt");
  assert.equal(M.DOMAIN_REPORT_TTL, 21600);
});

test("a different domain is not served from another domain's cache entry", async () => {
  calls = 0;
  await M.domainReport({}, "example.org");
  assert.ok(calls > 0);
});

test("a cache that throws never fails the report", async () => {
  const saved = globalThis.caches;
  globalThis.caches = { default: { match: async () => { throw new Error("cache down"); }, put: async () => { throw new Error("cache down"); } } };
  try {
    const r = await M.domainReport({}, "example.net");
    assert.equal(typeof r.trust, "string");
  } finally { globalThis.caches = saved; }
});

test("the url-safety pack starts the starting host's blocklist lookup before following redirects", () => {
  const src = readFileSync(require.resolve("../src/routes/packs-research.ts"), "utf8");
  const pack = src.slice(src.indexOf('entry("/pack/url-safety"'));
  assert.ok(pack.indexOf("const early") > -1 && pack.indexOf("const early") < pack.indexOf('call(env, "/url/redirects"'), "early lookup is set up before the redirects call");
  assert.match(pack, /early\.get\(h\) \?\? blocklist\(env, h\)/, "the early result is reused, other hosts are looked up as before");
});
