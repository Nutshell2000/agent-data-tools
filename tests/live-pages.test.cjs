// Live answers on tool pages (10 Nov 2026): which pages, the quarter-hour cache, and never a broken or slow page.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let L, E, P;
before(async () => {
  L = await load(require.resolve("../src/lib/live-pages.ts"));
  E = await load(require.resolve("../src/endpoints.ts"));
  P = await load(require.resolve("../src/lib/tool-pages.ts"));
});

const tool = (path) => E.ENDPOINTS.find((e) => e.path === path);
function memoryCache() {
  const kept = new Map();
  return { kept, match: async (req) => kept.get(req.url)?.clone(), put: async (req, res) => { kept.set(req.url, res.clone()); } };
}

test("live pages are the tools with a current answer, never one that costs us per run", () => {
  const live = new Set(L.LIVE_PAGE_PATHS());
  for (const p of ["/eth/gas", "/avax/gas", "/base/block", "/btc-price", "/fx", "/weather/current", "/crypto/fear-greed", "/econ/national-debt"]) assert.ok(live.has(p), p);
  for (const p of ["/search", "/news", "/ai/chat-large", "/image", "/screenshot", "/extract", "/hash", "/github/repo"]) assert.ok(!live.has(p), p);
  // Every name in the list is a real tool, or a paused one that is not listed at all.
  const all = new Set(E.ENDPOINTS.map((e) => e.path));
  const unknown = [...L.LIVE_EXACT].filter((p) => !all.has(p) && !Object.hasOwn(E.PAUSED_FAMILY_TOOLS, p));
  assert.deepEqual(unknown, []);
  assert.ok(live.size >= 40 && live.size <= 120, `${live.size} live pages`);
});

test("the answer is the tool's published example, run once per quarter hour", async () => {
  const cache = memoryCache(); const runs = []; const waited = [];
  const run = async (path, _env, input) => { runs.push([path, input("from"), input("to")]); return { from: "USD", rates: { EUR: 0.9 } }; };
  const first = await L.liveAnswer(tool("/fx"), {}, (p) => waited.push(p), run, cache);
  assert.deepEqual(first.result, { from: "USD", rates: { EUR: 0.9 } });
  assert.match(first.at, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(runs, [["/fx", "USD", undefined]], "only the published example's inputs are sent");
  await Promise.all(waited);
  const second = await L.liveAnswer(tool("/fx"), {}, () => {}, async () => { throw new Error("must not run again"); }, cache);
  assert.deepEqual(second, first);
  assert.equal(cache.kept.size, 1);
});

test("a failing or slow source, a missing cache, or a tool outside the list leaves the page with its static example", async () => {
  assert.equal(await L.liveAnswer(tool("/fx"), {}, () => {}, async () => { throw new Error("upstream down"); }, memoryCache()), undefined);
  assert.equal(await L.liveAnswer(tool("/search"), {}, () => {}, async () => ({ never: true }), memoryCache()), undefined);
  // No cache at all (tests, local runs): still answers.
  assert.deepEqual((await L.liveAnswer(tool("/time"), {}, () => {}, async () => ({ utc: "now" }), undefined)).result, { utc: "now" });
  const started = Date.now(); let finished;
  const slow = L.liveAnswer(tool("/fx"), {}, (p) => { finished = p; }, () => new Promise((r) => setTimeout(() => r({ late: true }), 4_200)), memoryCache());
  assert.equal(await slow, undefined, "the page does not wait for a slow source");
  assert.ok(Date.now() - started < 4_100);
  assert.deepEqual((await finished).result, { late: true }, "but the read still completes and is cached for the next visitor");
});

test("the page shows the live answer with its time, and the static example without one", () => {
  const e = tool("/eth/gas");
  const live = P.toolDocPage(e, "https://example.test", true, { result: { network: "ethereum", gasPriceGwei: 0.4242 }, at: "2026-11-10T12:34:56.000Z" });
  assert.match(live, /<h2>Live result<\/h2>/);
  assert.match(live, /read 2026-11-10 12:34 UTC and refreshed every 15 minutes/);
  assert.match(live, /0\.4242/);
  const fixed = P.toolDocPage(e, "https://example.test", true);
  assert.match(fixed, /<h2>Example result<\/h2>/);
  assert.ok(!/Live result/.test(fixed));
  // A live answer is escaped like any other text.
  assert.ok(!P.toolDocPage(e, "https://example.test", true, { result: { x: "<script>alert(1)</script>" }, at: "2026-11-10T12:34:56.000Z" }).includes("<script>alert(1)"));
});
