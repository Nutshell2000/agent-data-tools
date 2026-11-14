// 14 Nov 2026: the OPS "Lost after a payment attempt" table showed /weather (4, "send city or lat and lon") and /llm/chat
// (3, "prompt is required") as the main paid-call losses of the week. The /revenue funnel dates them to 6-10 Nov and 9 Nov,
// before 1.106.0 (aliases) and 1.109.3 (weather default). These pin every name the task names, on every path that sells
// the job, through the shared TOOLS wrapper (HTTP and MCP both call it) and through the POST-body flattener's rule
// (src/index.ts keeps a body field when ALIAS_OF maps it to one of the path's own inputs). They also cover the shapes
// of `messages` that were still refused after payment: one message object, and plain text.
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

let T, E, C;
before(async () => {
  T = await load(require.resolve("../src/tools.ts"));
  E = await load(require.resolve("../src/endpoints.ts"));
  C = await load(require.resolve("../src/lib/chat-messages.ts"));
});

const sent = (o) => (n) => o[n];
const WEATHER_PATHS = ["/weather", "/weather/forecast", "/weather/current"];
const WEATHER_ALIASES = ["q", "location", "place", "query", "name"];
const CHAT_PATHS = ["/llm/chat", "/ai/chat"];
const CHAT_ALIASES = ["message", "messages", "input", "text", "query"];

/** A Workers AI stand-in that records what the chat model was asked. */
function fakeAi() {
  const calls = [];
  return { calls, env: { AI: { run: async (model, input) => { calls.push({ model, input }); return { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }; } } } };
}
const userText = (call) => call.input.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");

test("every weather alias the task names reaches city on every weather path", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ geometry: { coordinates: [139.65, 35.68, 40] }, properties: { meta: { updated_at: "2026-11-14T08:00:00Z" }, timeseries: [
    { time: "2026-11-14T09:00:00Z", data: { instant: { details: { air_temperature: 12 } } } },
    { time: "2026-11-14T10:00:00Z", data: { instant: { details: { air_temperature: 13 } } } }] } }), { headers: { "content-type": "application/json" } });
  try {
    for (const path of WEATHER_PATHS) for (const name of WEATHER_ALIASES) {
      const out = await T.TOOLS[path]({}, sent({ [name]: "Tokyo" }));
      assert.equal(out.place, "Tokyo", `${path}?${name}=Tokyo`);
      assert.equal(out.note, undefined, `${path}?${name}=Tokyo is a named place, not the default`);
    }
  } finally { globalThis.fetch = realFetch; }
});

test("a POST body with a weather or chat alias is forwarded, not dropped (the flattener's rule)", () => {
  const params = new Map(E.ENDPOINTS.map((e) => [e.path, e.params]));
  const kept = (path, field) => field in params.get(path) || (T.ALIAS_OF[field] ?? []).some((input) => input in params.get(path));
  for (const path of WEATHER_PATHS) for (const name of WEATHER_ALIASES) assert.ok(kept(path, name), `${path} body field ${name}`);
  for (const path of CHAT_PATHS) for (const name of CHAT_ALIASES) assert.ok(kept(path, name), `${path} body field ${name}`);
});

test("every chat alias the task names becomes the prompt on /llm/chat and /ai/chat", async () => {
  for (const path of CHAT_PATHS) for (const name of CHAT_ALIASES) {
    const ai = fakeAi();
    const value = name === "messages" ? JSON.stringify([{ role: "user", content: "Say hi" }]) : "Say hi";
    const out = await T.TOOLS[path](ai.env, sent({ [name]: value }));
    assert.equal(out.response, "ok", `${path} ${name}`);
    assert.equal(ai.calls.length, 1, `${path} ${name}: one model call`);
    assert.equal(userText(ai.calls[0]), "Say hi", `${path} ${name}: the model got the buyer's words`);
  }
});

test("messages as one object or as plain text is answered, not refused after payment", async () => {
  for (const path of CHAT_PATHS) {
    for (const messages of [JSON.stringify({ role: "user", content: "Say hi" }), "Say hi"]) {
      const ai = fakeAi();
      const out = await T.TOOLS[path](ai.env, sent({ messages }));
      assert.equal(out.response, "ok", `${path} messages=${messages}`);
      assert.equal(userText(ai.calls[0]), "Say hi", `${path} messages=${messages}`);
    }
    // A malformed array and a role-less object are still refused, with the reason, before any model call.
    for (const messages of ["[{\"role\":\"user\"", "{\"content\":\"hi\"}"]) {
      const ai = fakeAi();
      await assert.rejects(T.TOOLS[path](ai.env, sent({ messages })), (e) => e.status === 400, `${path} messages=${messages}`);
      assert.equal(ai.calls.length, 0);
    }
  }
});

test("a Responses-style input array is read as the conversation on the prompt tools", async () => {
  const items = JSON.stringify([{ role: "system", content: "Be brief." }, { role: "user", content: "Say hi" }]);
  for (const path of [...CHAT_PATHS, "/ai/chat-large"]) {
    const ai = fakeAi();
    await T.TOOLS[path](ai.env, sent({ input: items }));
    assert.equal(userText(ai.calls[0]), "Say hi", path);
  }
  // Plain text in input stays the prompt as sent.
  assert.equal(T.normalizedInput(sent({ input: "[draft] notes" }))("prompt"), "[draft] notes");
});

test("messagesAsArray keeps arrays, wraps one message and plain text, leaves the rest as sent", () => {
  const arr = JSON.stringify([{ role: "user", content: "a" }]);
  assert.equal(C.messagesAsArray(arr), arr);
  assert.equal(C.messagesAsArray(JSON.stringify({ role: "user", content: "a" })), arr);
  assert.equal(C.messagesAsArray("a"), arr);
  assert.equal(C.messagesAsArray("  "), undefined);
  assert.equal(C.messagesAsArray(undefined), undefined);
  assert.equal(C.messagesAsArray("{\"content\":\"a\"}"), "{\"content\":\"a\"}");
  assert.equal(C.messagesAsArray("{oops"), "{oops");
});
