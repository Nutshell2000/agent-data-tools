// Minimal A2A v1.0 endpoint: JSON-RPC framing, the unified Part shape, a real SendMessage answer,
// and an honest failure message when no tool matches. No network, no payment, no spend here.
const assert = require("node:assert/strict");
const Module = require("node:module");
const { before, test } = require("node:test");
const esbuild = require("esbuild");

async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let a2a, discovery;
const ORIGIN = "https://api.test";
before(async () => {
  a2a = await loadTypeScript(require.resolve("../src/routes/a2a.ts"));
  discovery = await loadTypeScript(require.resolve("../src/discovery.ts"));
});

const post = (body) => new Request(`${ORIGIN}/a2a`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const messageNeed = (need) => ({ role: "ROLE_USER", parts: [{ text: need, mediaType: "text/plain" }] });

test("A2A SendMessage finds paid tools and returns A2A 1.0 task artifacts", async () => {
  const res = await a2a.handleA2a(post({ jsonrpc: "2.0", id: 7, method: "SendMessage", params: { message: messageNeed("current gas price on Base") } }), {}, ORIGIN);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.jsonrpc, "2.0");
  assert.equal(out.id, 7);
  assert.equal(out.error, undefined);
  assert.equal(out.result.status.state, "TASK_STATE_COMPLETED");
  assert.match(out.result.status.timestamp, /^\d{4}-\d\d-\d\dT/);
  const [text, data] = out.result.artifacts[0].parts;
  assert.match(text.text, /paid data tools/);
  assert.match(text.text, /GET https:\/\/api\.test\/base-gas/);
  assert.match(text.text, /402/);
  assert.ok(data.data.picks.length >= 1);
  assert.equal(data.data.picks[0].price.startsWith("$"), true);
  assert.equal(data.data.catalog, `${ORIGIN}/discovery/resources`);
});

test("the v0.3 method alias and a v0.3 TextPart still work", async () => {
  const res = await a2a.handleA2a(post({ jsonrpc: "2.0", id: "x", method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: "bitcoin fee rates" }] } } }), {}, ORIGIN);
  const out = await res.json();
  assert.equal(out.id, "x");
  assert.match(out.result.artifacts[0].parts[0].text, /https:\/\/api\.test\//);
});

test("a job with no matching tool is an uncharged message, not a 5xx", async () => {
  const res = await a2a.handleA2a(post({ jsonrpc: "2.0", id: 3, method: "SendMessage", params: { message: messageNeed("xyzzy plugh") } }), {}, ORIGIN);
  const out = await res.json();
  assert.equal(out.error, undefined);
  assert.equal(out.result.role, "ROLE_AGENT");
  assert.match(out.result.parts[0].text, /catalog/);
});

test("JSON-RPC framing errors are the standard codes", async () => {
  assert.equal((await (await a2a.handleA2a(new Request(`${ORIGIN}/a2a`, { method: "POST", body: "not json" }), {}, ORIGIN)).json()).error.code, -32700);
  assert.equal((await (await a2a.handleA2a(post({ jsonrpc: "1.0", method: "SendMessage" }), {}, ORIGIN)).json()).error.code, -32600);
  assert.equal((await (await a2a.handleA2a(post({ jsonrpc: "2.0", id: 1, method: "tasks/get" }), {}, ORIGIN)).json()).error.code, -32601);
  assert.equal((await (await a2a.handleA2a(post({ jsonrpc: "2.0", id: 2, method: "SendMessage", params: { message: { parts: [] } } }), {}, ORIGIN)).json()).error.code, -32602);
  assert.equal((await a2a.handleA2a(new Request(`${ORIGIN}/a2a`), {}, ORIGIN)).status, 405);
});

test("the A2A card advertises a real v1.0 interface and keeps the v0.3 url", async () => {
  const card = discovery.agentCard(ORIGIN, ["eip155:8453"]);
  assert.deepEqual(card.supportedInterfaces, [{ url: `${ORIGIN}/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }]);
  assert.equal(card.capabilities.extendedAgentCard, false);
  assert.equal(card.url, ORIGIN);
});
