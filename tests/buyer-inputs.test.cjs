// 10 Nov 2026: paying buyers were refused after their payment verified because they named an input differently
// (/weather 9 of 19 paid attempts, /llm/chat 3 of 4). These pin the names a buyer may send and the guard that keeps an
// alias from shadowing a tool's own input.
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

let T, E, R, B;
before(async () => {
  T = await load(require.resolve("../src/tools.ts"));
  E = await load(require.resolve("../src/endpoints.ts"));
  R = await load(require.resolve("../src/lib/request-metrics.ts"));
  B = await load(require.resolve("../src/lib/bazaar-extension.ts"));
});

const sent = (o) => (n) => o[n];

test("a weather buyer may say location, place or q instead of city", async () => {
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ geometry: { coordinates: [-0.13, 51.51, 25] }, properties: { meta: { updated_at: "2026-11-10T08:00:00Z" }, timeseries: [
      { time: "2026-11-10T09:00:00Z", data: { instant: { details: { air_temperature: 9 } }, next_1_hours: { summary: { symbol_code: "cloudy" }, details: { precipitation_amount: 0 } } } },
      { time: "2026-11-10T10:00:00Z", data: { instant: { details: { air_temperature: 10 } } } }] } }), { headers: { "content-type": "application/json" } });
  };
  try {
    for (const path of ["/weather", "/weather/forecast", "/weather/today"]) {
      for (const name of ["location", "place", "q", "query", "name", "town"]) {
        const out = await T.TOOLS[path]({}, sent({ [name]: "London" }));
        assert.equal(out.place, "London", `${path}?${name}=London`);
      }
    }
    assert.ok(asked.every((u) => u.includes("api.met.no")), "the built-in city table needs no lookup");
    // An empty alias is no input and does not hide the next one.
    assert.equal((await T.TOOLS["/weather"]({}, sent({ location: " ", q: "Tokyo" }))).place, "Tokyo");
    // lat and lon still win over nothing else being sent.
    assert.equal((await T.TOOLS["/weather"]({}, sent({ latitude: "59.33", lng: "18.07" }))).latitude, 59.33);
  } finally { globalThis.fetch = realFetch; }
});

test("an OpenAI messages array is a prompt and a system prompt for the tools without a messages input", () => {
  const one = JSON.stringify([{ role: "system", content: "Be brief." }, { role: "user", content: "What is x402?" }]);
  assert.equal(T.messagePart(one, "prompt"), "What is x402?");
  assert.equal(T.messagePart(one, "system"), "Be brief.");
  const parts = JSON.stringify([{ role: "developer", content: "Rules" }, { role: "user", content: [{ type: "text", text: "Hello" }, { type: "image_url", image_url: { url: "https://example.com/a.png" } }] }]);
  assert.equal(T.messagePart(parts, "prompt"), "Hello");
  assert.equal(T.messagePart(parts, "system"), "Rules");
  const talk = JSON.stringify([{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello." }, { role: "user", content: "And now?" }]);
  assert.equal(T.messagePart(talk, "prompt"), "User: Hi\nAssistant: Hello.\nUser: And now?");
  for (const bad of [undefined, "", "hello", "{}", "[", "[]", JSON.stringify([{ role: "system", content: "only" }])]) assert.equal(T.messagePart(bad, "prompt"), undefined);

  const q = T.normalizedInput(sent({ messages: one, max_tokens: "50" }));
  assert.equal(q("prompt"), "What is x402?");
  assert.equal(q("system"), "Be brief.");
  assert.equal(q("maxTokens"), "50");
  assert.equal(T.normalizedInput(sent({ message: "Hi there" }))("prompt"), "Hi there");
  assert.equal(T.normalizedInput(sent({ input: "Hi there" }))("prompt"), "Hi there");
});

test("more names buyers send: ip address, website, coin, hash, query words", () => {
  const q = (o) => T.normalizedInput(sent(o));
  assert.equal(q({ address: "8.8.8.8" })("ip"), "8.8.8.8");
  assert.equal(q({ website: "example.com" })("url"), "https://example.com");
  assert.equal(q({ image_url: "https://example.com/a.png" })("url"), "https://example.com/a.png");
  assert.equal(q({ symbol: "BTC" })("coin"), "BTC");
  assert.equal(q({ asset: "ETH" })("symbol"), "ETH");
  assert.equal(q({ txHash: "0xabc" })("hash"), "0xabc");
  assert.equal(q({ keywords: "x402 payments" })("q"), "x402 payments");
  assert.equal(q({ company_name: "Spotify" })("name"), "Spotify");
  assert.equal(q({ email_address: "a@b.co" })("address"), "a@b.co");
  // The real name always wins over an alias.
  assert.equal(q({ city: "Paris", location: "London" })("city"), "Paris");
});

test("an alias that is one of the tool's own inputs is never read as another input", () => {
  const one = JSON.stringify([{ role: "user", content: "What is x402?" }]);
  const declared = new Map(E.ENDPOINTS.map((e) => [e.path, new Set(Object.keys(e.params))]));
  // /ai/chat and its door have their own `messages` input (the native path reads it): prompt is not derived from it.
  for (const path of ["/ai/chat", "/llm/chat"]) {
    assert.ok(declared.get(path).has("messages"));
    assert.equal(T.normalizedInput(T.declaredInputFor(path, sent({ messages: one })))("prompt"), undefined, path);
  }
  // The prompt tools without one read it as the prompt.
  for (const path of ["/ai/chat-large", "/llm/inference", "/ai/model/qwen3-30b"]) {
    assert.ok(!declared.get(path).has("messages"));
    assert.equal(T.normalizedInput(T.declaredInputFor(path, sent({ messages: one })))("prompt"), "What is x402?", path);
  }
  // Catalog-wide: wherever a tool declares both an input and one of that input's aliases, sending only the alias leaves
  // the input unset.
  let pairs = 0;
  for (const [path, own] of declared) for (const [alias, inputs] of Object.entries(T.ALIAS_OF)) {
    if (!own.has(alias)) continue;
    for (const input of inputs) {
      if (!own.has(input)) continue;
      pairs++;
      assert.equal(T.normalizedInput(T.declaredInputFor(path, sent({ [alias]: "x" })))(input), undefined, `${path}: ${alias} must not be read as ${input}`);
    }
  }
  assert.ok(pairs > 0, `the guard is exercised (${pairs} pairs)`);
});
test("refused paid calls keep the names of the inputs that were sent, never the values", () => {
  assert.equal(R.sentInputNames(new URLSearchParams("Location=London&units=metric")), " [sent location,units]");
  assert.equal(R.sentInputNames(new URLSearchParams("")), " [sent nothing]");
  assert.equal(R.sentInputNames(new URLSearchParams("a=1&b=2&c=3&d=4&e=5&f=6&g=7")), " [sent a,b,c,d,e,f]");
  // Names that are not plain identifiers (a value pasted as a key, an address) are dropped.
  assert.equal(R.sentInputNames(new URLSearchParams("0xabc=1&me@example.com=2&city=x")), " [sent city]");
});

test("a tool that refuses an empty call lists an input as required, so a router never plans it empty", async () => {
  // Mercator planned /weather with no input (its schema listed none as required) and failed 5 of 5 on 10 Nov 2026.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("NET"); };
  const env = new Proxy({}, { get: () => undefined });
  try {
    for (const e of E.ENDPOINTS) {
      if (Object.values(e.params).some((p) => p.required)) { assert.ok(!B.ONE_OF_INPUT_PATHS.has(e.path), `${e.path} already has a required input`); continue; }
      let refused = false;
      try { await Promise.race([T.TOOLS[e.path](env, () => undefined), new Promise((_, r) => setTimeout(() => r(new Error("NET timeout")), 300))]); }
      catch (err) { refused = err?.status === 400; }
      assert.equal(B.ONE_OF_INPUT_PATHS.has(e.path), refused, `${e.path}: ${refused ? "refuses an empty call, so add it to ONE_OF_INPUT_PATHS" : "answers an empty call, so it must not be in ONE_OF_INPUT_PATHS"}`);
      if (refused) {
        const required = B.requiredInputs(e);
        assert.ok(required.length >= 1, `${e.path} lists a required input`);
        // The published example carries exactly those inputs, so the listing's own example satisfies its schema.
        assert.deepEqual(Object.keys(B.exampleInput(e)), required, e.path);
      }
    }
  } finally { globalThis.fetch = realFetch; }
  for (const p of B.ONE_OF_INPUT_PATHS) assert.ok(E.ENDPOINTS.some((e) => e.path === p), `${p} is a tool`);
});