// The OFAC mirror republishes with --clobber every six hours, so its files 404 for about half a minute and OFAC's
// own hosts refuse Workers. /sanctions/screen lost 4 of 9 calls that way in the week to 14 Nov 2026.
// sdnIndex() must keep answering from the last good copy (in memory, or the edge cache for a new isolate).
const test = require("node:test");
const assert = require("node:assert/strict");
const esbuild = require("esbuild");

async function loadFresh() {
  const result = await esbuild.build({ entryPoints: [require.resolve("../src/routes/sanctions.ts")], bundle: true, platform: "node", format: "cjs", write: false });
  const mod = { exports: {} };
  new Function("module", "exports", "require", result.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const compact = () => ({ v: 1, listDate: "2026-11-14T06:00:00.000Z", parties: Array.from({ length: 1200 }, (_, i) => [String(i + 1), i === 0 ? "LAZARUS GROUP" : `PARTY ${i}`, "entity", ["DPRK3"]]), aliases: [], addresses: [["0x098B716B8Aaf21512996dC57EB0615e2383E2f96", "1", "ETH"]] });

function edgeCache() {
  const store = new Map();
  return { store, match: async (k) => (store.has(k) ? new Response(store.get(k)) : undefined), put: async (k, res) => { store.set(k, await res.text()); } };
}

test("a failed refresh keeps the last good copy, and a new isolate reads it from the edge cache", async (t) => {
  const realFetch = globalThis.fetch, realNow = Date.now, hadCaches = "caches" in globalThis, realCaches = globalThis.caches;
  const cache = edgeCache();
  globalThis.caches = { default: cache };
  let mirrorUp = true, now = realNow();
  Date.now = () => now;
  const origTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => origTimeout(fn, 0); // skip the 1.5 s retry wait
  globalThis.fetch = async () => (mirrorUp ? new Response(JSON.stringify(compact()), { status: 200 }) : new Response("Not Found", { status: 404 }));
  t.after(() => { globalThis.fetch = realFetch; Date.now = realNow; globalThis.setTimeout = origTimeout; if (hadCaches) globalThis.caches = realCaches; else delete globalThis.caches; });

  const a = await loadFresh();
  const first = await a.sdnIndex();
  assert.equal(first.parties.size, 1200);
  assert.equal(cache.store.size, 1, "the good copy is saved to the edge cache");

  // Seven hours later the mirror is mid-republish: the isolate copy is past six hours but still served.
  mirrorUp = false;
  now += 7 * 3600 * 1000;
  const stale = await a.sdnIndex();
  assert.equal(stale.parties.size, 1200);
  assert.equal(a.screen(stale, "0x098b716b8aaf21512996dc57eb0615e2383e2f96", undefined)[0].name, "LAZARUS GROUP");

  // A brand-new isolate during the outage answers from the edge cache.
  const b = await loadFresh();
  const fromEdge = await b.sdnIndex();
  assert.equal(fromEdge.listDate, "2026-11-14T06:00:00.000Z");

  // With nothing saved anywhere, the outage is still an uncharged 502.
  cache.store.clear();
  const c = await loadFresh();
  await assert.rejects(c.sdnIndex(), (e) => e.status === 502);

  // Past the stale limit an old in-memory copy is no longer served.
  now += a.STALE_LIMIT_MS;
  await assert.rejects(a.sdnIndex(), (e) => e.status === 502);
});
