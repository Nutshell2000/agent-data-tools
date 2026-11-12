// Our own hosts go through the SELF binding (12 Nov 2026): over the network a Worker cannot reach its own hostname, so
// /agent-readiness on our origin and on tools.funwords.eu answered "the site did not answer".
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

let S, A;
before(async () => {
  S = await load(require.resolve("../src/lib/self-fetch.ts"));
  A = await load(require.resolve("../src/routes/agent-readiness.ts"));
});

test("our hosts are self hosts; others, and look-alikes, are not", () => {
  const env = { PUBLIC_SITE_ORIGIN: "https://tools.funwords.eu" };
  assert.equal(S.isSelfHost(env, "agent-data-tools.revmesh2074.workers.dev"), true);
  assert.equal(S.isSelfHost(env, "TOOLS.FUNWORDS.EU"), true);
  assert.equal(S.isSelfHost(env, "funwords.eu"), false);
  assert.equal(S.isSelfHost(env, "agent-data-tools.revmesh2074.workers.dev.evil.com"), false);
  assert.equal(S.isSelfHost({ PUBLIC_SITE_ORIGIN: "not a url" }, "stripe.com"), false);
  assert.equal(S.selfFetch({}, new URL("https://tools.funwords.eu/x"), "*/*"), null, "no binding: the network as before");
});

test("agent readiness on our own origin reads through SELF and never the network", async () => {
  const seen = [];
  const files = {
    "/": ["<html><title>Agent Data Tools</title></html>", "text/html"],
    "/robots.txt": ["User-agent: *\nAllow: /\n", "text/plain"],
    "/llms.txt": ["# Agent Data Tools\n\n> Pay-per-call tools for agents.\n\n- [Tools](/tools)\n", "text/plain"],
    "/openapi.json": ['{"openapi":"3.1.0","info":{"title":"x","version":"1"},"paths":{}}', "application/json"],
  };
  const env = { PUBLIC_SITE_ORIGIN: "https://tools.funwords.eu", SELF: { fetch: async (url) => { const p = new URL(url).pathname; seen.push(p); const f = files[p]; return f ? new Response(f[0], { headers: { "content-type": f[1] } }) : new Response("no", { status: 404 }); } } };
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error("the network must not be used for our own host"); };
  try {
    const run = A.AGENT_READINESS.find((e) => e.endpoint.path === "/agent-readiness").run;
    const out = await run(env, (n) => ({ url: "https://agent-data-tools.revmesh2074.workers.dev" })[n]);
    assert.equal(out.origin, "https://agent-data-tools.revmesh2074.workers.dev");
    assert.ok(out.checks.find((c) => c.id === "llms_txt").found);
    assert.ok(seen.includes("/llms.txt") && seen.includes("/robots.txt"));
  } finally {
    global.fetch = realFetch;
  }
});
