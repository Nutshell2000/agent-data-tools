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

let utils, fun, data, families;
before(async () => {
  utils = await loadTypeScript(require.resolve("../src/routes/utils.ts"));
  fun = await loadTypeScript(require.resolve("../src/routes/fun.ts"));
  data = await loadTypeScript(require.resolve("../src/routes/public-data.ts"));
  ({ FAMILIES: families } = await loadTypeScript(require.resolve("../src/families.ts")));
});

const inputFrom = (params) => (name) => (params[name] ? String(params[name].example) : undefined);

test("family catalog: unique paths, floor price, bounded metadata and examples for every parameter", () => {
  const paths = families.map((f) => f.endpoint.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(families.length, 133);
  for (const { endpoint: e } of families) {
    assert.equal(e.price, e.path === "/search" ? "$0.01" : e.path.startsWith("/ai/") || e.path === "/price/token" ? "$0.002" : "$0.001", e.path);
    assert.ok(e.description.length >= 40 && e.description.length <= 450, e.path);
    assert.match(e.path.slice(1).replaceAll("/", "_"), /^[A-Za-z0-9_-]{1,64}$/, e.path);
    for (const [name, p] of Object.entries(e.params)) assert.notEqual(p.example, undefined, `${e.path} ${name}`);
  }
});

test("every utility and fun endpoint runs on its own example input without network access", async () => {
  for (const f of [...utils.UTILS, ...fun.FUN]) {
    const out = await f.run({}, inputFrom(f.endpoint.params));
    assert.ok(out && typeof out === "object", f.endpoint.path);
  }
});

test("JSON repair handles typical model output", () => {
  assert.deepEqual(JSON.parse(utils.repairJson("```json\n{name: 'Ada', tags: ['x',],}\n```")), { name: "Ada", tags: ["x"] });
  assert.deepEqual(JSON.parse(utils.repairJson('Sure! Here it is: {"a": True, "b": None, // note\n "c": [1, 2')), { a: true, b: null, c: [1, 2] });
  assert.deepEqual(JSON.parse(utils.repairJson("{'say': \"it's\"}")), { say: "it's" });
});

test("JSON repair leaves valid input unchanged and only corrects syntax outside quoted data", () => {
  for (const source of ['{"message":"True story,}","label":"None","enabled":true}', '  {"text":"{bare: True,}","escaped":"a\\\"True"}  ', '"False"'])
    assert.equal(utils.repairJson(source), source);
  assert.deepEqual(JSON.parse(utils.repairJson("{message: 'True story,}', label: 'None', enabled: True,}")), {message:'True story,}',label:'None',enabled:true});
  assert.deepEqual(JSON.parse(utils.repairJson("{text: 'it\\'s True', ok: False, value: None,}")), {text:"it's True",ok:false,value:null});
});

test("paused family tools remain implemented but cannot be advertised or directly executed", async () => {
  const {ENDPOINTS,PAUSED_FAMILY_TOOLS}=await loadTypeScript(require.resolve('../src/endpoints.ts'));
  const {TOOLS}=await loadTypeScript(require.resolve('../src/tools.ts'));
  assert.equal(ENDPOINTS.length,154);
  for(const path of Object.keys(PAUSED_FAMILY_TOOLS)){
    assert.ok(families.some(f=>f.endpoint.path===path));
    assert.ok(!ENDPOINTS.some(e=>e.path===path));
    await assert.rejects(TOOLS[path]({},()=>{throw Error('Paused tools must not read inputs or call upstreams');}),e=>e.status===503&&e.code==='TOOL_PAUSED');
  }
});

test("CSV, case, slug, HTML and Markdown helpers", () => {
  assert.deepEqual(utils.parseCsv('a;b\n"x;1";2'), [["a", "b"], ["x;1", "2"]]);
  assert.deepEqual(utils.parseCsv('n,q\n1,"say ""hi"""'), [["n", "q"], ["1", 'say "hi"']]);
  assert.equal(utils.convertCase("user profile ID", "camel"), "userProfileId");
  assert.equal(utils.convertCase("userProfileId", "snake"), "user_profile_id");
  assert.equal(utils.slugify("Crème Brûlée & Straße!"), "creme-brulee-strasse");
  assert.equal(utils.htmlToText("<h1>Hi</h1><p>A &amp; B</p><script>x()</script><ul><li>one</li></ul>"), "Hi\nA & B\n• one");
  const html = utils.markdownToHtml("# T\n**b** <script>[x](javascript:alert(1))\n- a\n- b");
  assert.ok(html.includes("<h1>T</h1>") && html.includes("<strong>b</strong>") && html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("javascript:"), "unsafe link schemes are dropped");
  assert.deepEqual(utils.lineDiff("a\nb", "a\nc").map((d) => d.op), ["=", "-", "+"]);
});

test("numbers and validators", () => {
  assert.equal(utils.numberToWords(1234), "one thousand two hundred thirty-four");
  assert.equal(utils.toRoman(2026), "MMXXVI");
  assert.equal(utils.fromRoman("mcmxciv"), 1994);
  assert.throws(() => utils.fromRoman("IIII"));
  assert.equal(utils.ibanCheck("GB82 WEST 1234 5698 7654 32").valid, true);
  assert.equal(utils.ibanCheck("GB82 WEST 1234 5698 7654 33").valid, false);
  assert.equal(utils.isbnCheck("9780306406157").valid, true);
  assert.equal(utils.luhn("79927398713"), true);
  assert.equal(utils.luhn("79927398710"), false);
});

test("cron next runs and unit conversion", () => {
  const from = new Date("2026-10-19T08:50:00Z");
  assert.deepEqual(utils.cronNext("*/15 9-17 * * MON-FRI", from, 3), ["2026-10-19T09:00:00.000Z", "2026-10-19T09:15:00.000Z", "2026-10-19T09:30:00.000Z"]);
  assert.deepEqual(utils.cronNext("0 0 1 JAN *", from, 1), ["2027-01-01T00:00:00.000Z"]);
  assert.throws(() => utils.cronNext("* * *", from, 1));
  assert.equal(utils.convertUnit(100, "c", "f").result, 212);
  assert.throws(() => utils.convertUnit(1, "kg", "m"));
});

test("sun and moon are computed locally", () => {
  const s = data.sunTimes(new Date("2026-12-21T12:00:00Z"), 59.33, 18.07);
  const mins = (iso) => { const d = new Date(iso); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  assert.ok(Math.abs(mins(s.sunrise) - (7 * 60 + 43)) <= 6, `sunrise ${s.sunrise}`);
  assert.ok(Math.abs(mins(s.sunset) - (13 * 60 + 48)) <= 6, `sunset ${s.sunset}`);
  assert.equal(data.sunTimes(new Date("2026-06-21T12:00:00Z"), 78.2, 15.6).polar, "day");
  assert.equal(data.moonPhase(new Date("2024-01-25T18:00:00Z")).phase, "Full Moon");
});

test("random integers stay in range and cover it", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const v = fun.randInt(6); assert.ok(v >= 0 && v < 6); seen.add(v); }
  assert.equal(seen.size, 6);
});

test("basic helpers: echo, ping, keccak and network", async () => {
  const { BASICS } = await loadTypeScript(require.resolve("../src/routes/ai-text.ts"));
  const run = (path, input = {}) => BASICS.find((f) => f.endpoint.path === path).run({}, (n) => input[n]);
  assert.equal((await run("/echo", { message: "hi" })).length, 2);
  assert.equal((await run("/ping")).pong, true);
  const k = await run("/keccak", { text: "transfer(address,uint256)" });
  assert.equal(k.selector, "0xa9059cbb");
  assert.equal((await run("/keccak", { text: "0x" })).keccak256, "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal((await run("/network")).usdc.decimals, 6);
});

test("AI tools parse model output, keep labels and fields within what was asked, and report failures", async () => {
  const { AI_TEXT } = await loadTypeScript(require.resolve("../src/routes/ai-text.ts"));
  const tool = (path) => AI_TEXT.find((f) => f.endpoint.path === path);
  const env = (reply) => ({ AI: { run: async (model, input) => (typeof reply === "function" ? reply(model, input) : reply) } });
  const call = (path, reply, input) => tool(path).run(env(reply), (n) => input[n]);

  const c = await call("/ai/classify", { response: 'Sure: {"label":"Billing","reason":"double charge","ranking":["billing","other","nonsense"]}' }, { text: "charged twice", labels: "billing, shipping, other" });
  assert.equal(c.label, "billing");
  assert.deepEqual(c.ranking, ["billing", "other", "shipping"]);
  await assert.rejects(call("/ai/classify", { response: '{"label":"refund"}' }, { text: "x", labels: "billing,shipping" }), (e) => e.status === 502);
  await assert.rejects(call("/ai/classify", { response: "{}" }, { text: "x", labels: "only" }), (e) => e.status === 400);

  const x = await call("/ai/extract-json", { response: '```json\n{"company":"Acme AB","total":2450,"extra":"ignored"}\n```' }, { text: "Acme AB 2450", fields: "company,total,due_date" });
  assert.deepEqual(x.data, { company: "Acme AB", total: 2450, due_date: null });
  assert.deepEqual(x.missing, ["due_date"]);

  const kw = await call("/ai/keywords", { response: '["a","b","a","c"]' }, { text: "t", count: "3" });
  assert.deepEqual(kw.keywords, ["a", "b", "c"]);

  const s = await call("/ai/sentiment", [{ label: "NEGATIVE", score: 0.1 }, { label: "POSITIVE", score: 0.9 }], { text: "great" });
  assert.equal(s.label, "POSITIVE");

  const e = await call("/ai/embed", { data: [[0.1234567, -0.5]] }, { text: "hello" });
  assert.equal(e.dimensions, 2);

  await assert.rejects(call("/ai/chat", () => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); }, { prompt: "hi" }), (err) => err.status === 503);
  await assert.rejects(call("/ai/translate", {}, { text: "hi", to: "sv" }), (err) => err.status === 502);
  await assert.rejects(call("/ai/translate", {}, { text: "hi", to: "swedish" }), (err) => err.status === 400);
});

test("Uniswap v3 sqrtPriceX96 converts to quote units per token in both token orders", async () => {
  const { priceFromSqrt } = await loadTypeScript(require.resolve("../src/routes/prices.ts"));
  // 1 WETH (token0, 18 decimals) = 2000 USDC (token1, 6 decimals): raw ratio 2000e6/1e18.
  const sqrt = BigInt(Math.round(Math.sqrt(2000e6 / 1e18) * 2 ** 96));
  assert.ok(Math.abs(priceFromSqrt(sqrt, true, 18, 6) - 2000) < 1e-6);
  // Same pool seen from USDC: 1 USDC = 1/2000 WETH.
  assert.ok(Math.abs(priceFromSqrt(sqrt, false, 6, 18) - 1 / 2000) < 1e-12);
});

test("web search maps Brave results, stays within the daily cap and fails uncharged without a key", async () => {
  const { SEARCH } = await loadTypeScript(require.resolve("../src/routes/search.ts"));
  const run = SEARCH[0].run;
  const store = new Map();
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
  const q = (params) => (name) => params[name];
  const realFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, init) => {
    seen.push({ url: String(url), token: init.headers["x-subscription-token"] });
    return new Response(JSON.stringify({ web: { results: [{ title: "<strong>x402</strong> spec", url: "https://x402.org/", description: "Pay &amp; go", age: "1 day ago" }, { title: "no url" }] } }));
  };
  try {
    await assert.rejects(run({ TRIALS: kv }, q({ q: "x402" })), (e) => e.status === 503 && e.code === "SEARCH_UNAVAILABLE");
    assert.equal(seen.length, 0);
    const env = { TRIALS: kv, SEARCH_API_KEY: "k", SEARCH_DAILY_CAP: "1" };
    const out = await run(env, q({ q: "x402", count: "5" }));
    assert.deepEqual(out, { query: "x402", provider: "Brave Search", count: 1, results: [{ title: "x402 spec", url: "https://x402.org/", snippet: "Pay & go", age: "1 day ago" }] });
    assert.match(seen[0].url, /q=x402&count=5$/);
    assert.equal(seen[0].token, "k");
    await assert.rejects(run(env, q({ q: "again" })), (e) => e.status === 503 && e.code === "SEARCH_CAPACITY");
    assert.equal(seen.length, 1);
  } finally {
    global.fetch = realFetch;
  }
});
