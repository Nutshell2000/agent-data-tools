// 21 Nov 2026 (safety audit): a read of a catalog file is counted at /read/<software name>, and that name is the
// caller's own User-Agent token. All of a day's funnel counts are one stored row, so thousands of made-up names could
// grow the row until no counter could be written. The names are now bounded before they reach the Metrics object:
// known software always keeps its name, and one isolate lets at most NEW_FAMILIES_PER_ISOLATE_DAY other names through
// a day; the rest are counted as "other".
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");
const path = require("node:path");

let C, F;
const load = async (entry, name) => {
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
  const mod = new Module(name, null); mod.filename = path.resolve(name); mod.paths = Module._nodeModulePaths(process.cwd()); mod._compile(out.outputFiles[0].text, mod.filename); return mod.exports;
};
before(async () => {
  C = await load(require.resolve("../src/lib/caller.ts"), "caller-bound-test.js");
  F = await load(require.resolve("../src/lib/funnel.ts"), "funnel-bound-test.js"); // its own copy of caller.ts: a second isolate, in effect
});

const DAY = Date.parse("2026-11-21T12:00:00Z");

test("known software keeps its name however many made-up names came first", () => {
  const limit = C.NEW_FAMILIES_PER_ISOLATE_DAY;
  assert.ok(limit >= 10 && limit <= 100, "a small fixed allowance");
  const kept = new Set();
  for (let i = 0; i < 3000; i++) kept.add(C.boundedFamily(`made-up-${i}`, DAY));
  assert.equal(kept.size, limit + 1, "the allowance of new names, plus other");
  assert.ok(kept.has("other"));
  assert.equal(C.boundedFamily("made-up-0", DAY), "made-up-0", "a name already let through keeps counting under itself");
  assert.equal(C.boundedFamily("made-up-2999", DAY), "other");
  for (const name of ["browser", "none", "curl", "python-requests", "node", "googlebot", "gptbot", "claudebot", "agentcash", "rapidapi", "fluxa", "go-http-client", "agent-data-tools-release-warm"]) {
    assert.ok(C.KNOWN_FAMILIES.has(name), `${name} is on the list`);
    assert.equal(C.boundedFamily(name, DAY), name);
  }
  assert.equal(C.boundedFamily("mcp_client", DAY), "mcp_client", "an underscore form of a listed name is the same name");
});

test("the allowance starts again each UTC day", () => {
  const next = DAY + 86_400_000;
  assert.equal(C.boundedFamily("made-up-2999", next), "made-up-2999");
  const kept = new Set();
  for (let i = 0; i < 500; i++) kept.add(C.boundedFamily(`tomorrow-${i}`, next));
  assert.equal(kept.size, C.NEW_FAMILIES_PER_ISOLATE_DAY, "one name was used above, the rest of the allowance here, then other");
  assert.ok(kept.has("other"));
});

test("every name on the list is one callerFamily can produce and the funnel accepts as a path", () => {
  for (const name of C.KNOWN_FAMILIES) {
    assert.equal(C.softwareName(name), name, name);
    assert.match(`/read/${name}`, /^\/[a-zA-Z0-9/.-]{0,80}$/, `${name} fits the funnel's path pattern`);
  }
  assert.equal(C.callerFamily("python-requests/2.32"), "python-requests");
  assert.equal(C.callerFamily("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"), "gptbot");
  assert.equal(C.callerFamily("agent-data-tools-release-warm/1"), "agent-data-tools-release-warm");
  assert.equal(C.callerFamily("agent-data-tools-seed/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)"), "agent-data-tools-seed");
});

test("the funnel bounds /read/<name> and /caller/<name> labels, and nothing else", async () => {
  const events = [];
  const env = { METRICS: { idFromName: () => "id", get: () => ({ recordFunnel: async (e) => { events.push(e); }, ingest: async (b) => { events.push(...b.funnel); } }) } };
  const pending = [];
  const mark = (stage, label, tracePath = "/llms.txt") => F.withRequestTrace(env, tracePath, null, (p) => pending.push(p), () => F.markStage(stage, label));
  for (let i = 0; i < 400; i++) mark("discovery_read", `/read/bot-${i}`);
  for (let i = 0; i < 400; i++) mark("free_exhausted_by", `/caller/agent-${i}`);
  mark("discovery_read", "/read/gptbot");
  mark("free_exhausted_by", "/caller/python-requests");
  mark("referral", "/from/google");
  mark("visit", undefined, "/read/this-is-a-request-path");
  mark("quote", undefined, "/btc-fees");
  // Counted-only stages wait in the isolate's batch: send it now (lib/metrics-batch.ts keeps it on globalThis).
  const state = globalThis.__adtMetricsBatch;
  events.push(...state.batch.funnel); state.batch.funnel = [];
  const paths = new Set(events.map((e) => e.path));
  const labels = [...paths].filter((p) => /^\/(read|caller)\/(bot|agent)-/.test(p));
  assert.equal(labels.length, C.NEW_FAMILIES_PER_ISOLATE_DAY, "800 made-up names became this many keys");
  assert.ok(paths.has("/read/other") && paths.has("/caller/other"), "the rest are counted as other");
  assert.equal(events.filter((e) => e.path === "/read/other").length + events.filter((e) => /^\/read\/bot-/.test(e.path)).length, 400, "no read was dropped, only renamed");
  for (const p of ["/read/gptbot", "/caller/python-requests", "/from/google", "/read/this-is-a-request-path", "/btc-fees"]) assert.ok(paths.has(p), `${p} is untouched`);
  for (const e of events) F.assertFunnelEvent(e);
  assert.ok(paths.size <= C.NEW_FAMILIES_PER_ISOLATE_DAY + 7, `the day row gets ${paths.size} keys from 805 requests`);
  await Promise.allSettled(pending.map((p) => Promise.race([p, new Promise((r) => setTimeout(r, 10))])));
  globalThis.__adtMetricsBatch?.wake?.();
});
