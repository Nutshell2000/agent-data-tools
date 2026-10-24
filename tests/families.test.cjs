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

let utils, fun, data, families, exampleParams;
before(async () => {
  ({ exampleParams } = await loadTypeScript(require.resolve("../src/endpoints.ts")));
  utils = await loadTypeScript(require.resolve("../src/routes/utils.ts"));
  fun = await loadTypeScript(require.resolve("../src/routes/fun.ts"));
  data = await loadTypeScript(require.resolve("../src/routes/public-data.ts"));
  ({ FAMILIES: families } = await loadTypeScript(require.resolve("../src/families.ts")));
});

const inputFrom = (params) => (name) => (params[name] ? String(params[name].example) : undefined);
// Exactly the inputs of the published example (the Bazaar `input` and the listing payment's URL): a tool that needs
// more than its required inputs fails its first payment (/calc/loan without a term, 23 Oct 2026).
const publishedInput = (endpoint) => { const p = Object.fromEntries(exampleParams(endpoint)); return (name) => (p[name] ? String(p[name].example) : undefined); };

test("family catalog: unique paths, floor price, bounded metadata and examples for every parameter", () => {
  const paths = families.map((f) => f.endpoint.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(families.length, 224);
  for (const { endpoint: e } of families) {
    assert.equal(e.price, e.path === "/ai/chat" ? "$0.002" : e.path === "/search" || e.path === "/extract/rendered" || e.path === "/ai/chat-large" ? "$0.01" : e.path === "/check/counterparty" ? "$0.03" : e.path === "/check/x402-seller" ? "$0.01" : e.path === "/check/payee" ? "$0.005" : ["/pdf/text", "/sanctions/check", "/price/tokens", "/wallet/portfolio", "/wallet/balances"].includes(e.path) ? "$0.005" : e.path === "/company" || e.path === "/ai/speech" ? "$0.01" : e.path === "/x402/check" || e.path === "/feed" ? "$0.01" : e.path.startsWith("/ai/") || e.path === "/price/token" ? "$0.01" : "$0.01", e.path);
    assert.ok(e.description.length >= 40 && e.description.length <= 450, e.path);
    assert.match(e.path.slice(1).replace(/[/-]/g, "_"), /^[a-z0-9_]{1,64}$/, e.path);
    for (const [name, p] of Object.entries(e.params)) assert.notEqual(p.example, undefined, `${e.path} ${name}`);
  }
});

test("every utility and fun endpoint runs on its own example input without network access", async () => {
  for (const f of [...utils.UTILS, ...fun.FUN]) {
    const out = await f.run({}, inputFrom(f.endpoint.params));
    assert.ok(out && typeof out === "object", f.endpoint.path);
    const published = await f.run({}, publishedInput(f.endpoint));
    assert.ok(published && typeof published === "object", `${f.endpoint.path} published example`);
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
  assert.equal(ENDPOINTS.length,247);
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
  // A JSON array that does not parse (cut off, single quotes, trailing comma) still yields clean keywords:
  // a paid staging call on 21 Oct returned "[" and "\"Cloudflare Workers" as keywords.
  for (const response of ['[\n  "Cloudflare Workers",\n  "JavaScript",\n  "edge computing"', "['Cloudflare Workers', 'JavaScript', 'edge computing']", '["Cloudflare Workers", "JavaScript", "edge computing",]']) {
    const broken = await call("/ai/keywords", { response }, { text: "t" });
    assert.deepEqual(broken.keywords, ["Cloudflare Workers", "JavaScript", "edge computing"], response);
  }

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

test("calculators and converters: examples run offline and edge cases are refused or handled", async () => {
  const calc = await loadTypeScript(require.resolve("../src/routes/calc.ts"));
  for (const f of calc.CALC) {
    const out = await f.run({}, inputFrom(f.endpoint.params));
    assert.ok(out && typeof out === "object", f.endpoint.path);
    const published = await f.run({}, publishedInput(f.endpoint));
    assert.ok(published && typeof published === "object", `${f.endpoint.path} published example`);
  }
  assert.equal((await calc.CALC.find((f) => f.endpoint.path === "/calc/loan").run({}, publishedInput(calc.CALC.find((f) => f.endpoint.path === "/calc/loan").endpoint))).payments, 360, "the loan term defaults to 30 years");
  const run = async (path, params) => calc.CALC.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);
  // QR: UTF-8 survives, an over-long text is a 400, the data URL is the SVG.
  const qr = await run("/qr", { text: "Smörgåsbord ✓" });
  assert.match(qr.svg, /^<svg/);
  assert.equal(atob(qr.dataUrl.split(",")[1]), qr.svg);
  // 1,000 two-byte characters are 2,000 bytes, more than version 40 holds at H (1,273).
  await assert.rejects(run("/qr", { text: "é".repeat(1000), ecc: "H" }), (e) => e.status === 400);
  // Money: a textbook mortgage, a 0% loan, compound growth with no rate.
  assert.equal((await run("/calc/loan", { principal: "300000", rate: "4.5", years: "30" })).monthlyPayment, 1520.06);
  const zero = await run("/calc/loan", { principal: "1200", rate: "0", months: "12", rows: "12" });
  assert.equal(zero.monthlyPayment, 100); assert.equal(zero.totalInterest, 0); assert.equal(zero.schedule.at(-1).balance, 0);
  const flat = await run("/calc/compound-interest", { principal: "1000", rate: "0", years: "2", monthly: "10" });
  assert.equal(flat.futureValue, 1240); assert.equal(flat.interestEarned, 0);
  assert.equal((await run("/calc/compound-interest", { principal: "1000", rate: "10", years: "1", compound: "yearly" })).futureValue, 1100);
  // Dates and health.
  const leap = await run("/calc/age", { birthdate: "2000-02-29", on: "2026-10-23" });
  assert.equal(leap.years, 26); assert.equal(leap.nextBirthday, "2027-02-28");
  await assert.rejects(run("/calc/age", { birthdate: "2030-01-01", on: "2026-10-23" }), (e) => e.status === 400);
  await assert.rejects(run("/calc/age", { birthdate: "2026-02-30" }), (e) => e.status === 400);
  const imperial = await run("/calc/bmi", { weight: "154", height: "69", units: "imperial" });
  assert.equal(imperial.bmi, 22.7); assert.equal(imperial.normalWeightRange.unit, "lb");
  assert.equal(calc.bmiCategory(31), "obesity class I");
  assert.equal((await run("/calc/tip", { bill: "100", percent: "20", people: "3", roundUp: "true" })).perPerson, 40);
  // Text.
  assert.deepEqual(await run("/text/morse", { text: "... --- ... / .... . .-.. .--." }), { mode: "decode", result: "SOS HELP", unknown: [] });
  assert.deepEqual((await run("/text/morse", { text: "hi #1" })).skipped, ["#"]);
  assert.equal((await run("/text/caesar", { text: "Uryyb, Jbeyq!" })).result, "Hello, World!");
  assert.equal((await run("/text/caesar", { text: "abc", shift: "3", decode: "true" })).result, "xyz");
  const l1 = await run("/text/lorem", { paragraphs: "2", seed: "7" }), l2 = await run("/text/lorem", { paragraphs: "2", seed: "7" });
  assert.deepEqual(l1, l2); assert.equal(l1.paragraphs.length, 2); assert.match(l1.paragraphs[0], /^Lorem ipsum dolor sit amet/);
  // XML: no DOCTYPE (so no external entities), malformed input is a 400, CDATA and single children read naturally.
  await assert.rejects(run("/xml/to-json", { xml: '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>' }), (e) => e.status === 400);
  await assert.rejects(run("/xml/to-json", { xml: "<a><b></a>" }), (e) => e.status === 400);
  assert.deepEqual((await run("/xml/to-json", { xml: "<r><n><![CDATA[1 < 2]]></n><m k=\"v\"/></r>" })).json, { r: { n: "1 < 2", m: { "@k": "v" } } });
  // JSON schema: array items merge, integer and number widen to number, keys missing in some items are optional.
  const { schema } = await run("/json/schema", { json: '[{"a":1,"b":"x"},{"a":2.5}]' });
  assert.deepEqual(schema.items, { type: "object", properties: { a: { type: "number" }, b: { type: "string" } }, required: ["a"] });
  await assert.rejects(run("/json/schema", { json: "{nope" }), (e) => e.status === 400);
});

test("economic indicators answer from the World Bank snapshot without network access, by code, name or alias", async () => {
  const econ = await loadTypeScript(require.resolve("../src/routes/econ.ts"));
  for (const f of econ.ECON) {
    const out = await f.run({}, inputFrom(f.endpoint.params));
    assert.equal(out.country.code, "SWE", f.endpoint.path);
    assert.ok(await f.run({}, publishedInput(f.endpoint)), `${f.endpoint.path} published example`);
    assert.match(out.source, /World Bank Open Data \(CC BY 4\.0\), snapshot \d{4}-\d{2}-\d{2}/);
    const series = Object.values(out).filter((v) => v && typeof v === "object" && "values" in v);
    assert.ok(series.length >= 1 && series.every((s) => s.latest && s.values.length >= 1 && s.values.length <= 5 && s.values[0].year >= s.values.at(-1).year), f.endpoint.path);
  }
  const gdp = econ.ECON.find((f) => f.endpoint.path === "/econ/gdp");
  for (const [input, code] of [["se", "SWE"], ["SWE", "SWE"], ["Sweden", "SWE"], ["united states", "USA"], ["UK", "GBR"], ["South Korea", "KOR"], ["Côte d'Ivoire", "CIV"], ["Russian Federation", "RUS"]])
    assert.equal(econ.resolveCountry(input), code, input);
  const two = await gdp.run({}, (n) => ({ country: "Germany", years: "2" })[n]);
  assert.equal(two.country.name, "Germany");
  assert.equal(two.gdp.values.length, 2);
  assert.ok(two.gdp.latest.value > 3e12 && two.gdp.latest.year >= 2023);
  await assert.rejects(gdp.run({}, (n) => ({ country: "Atlantis" })[n]), (e) => e.status === 404);
  await assert.rejects(gdp.run({}, (n) => ({ country: "SE", years: "11" })[n]), (e) => e.status === 400);
});

test("news search maps Brave news results, validates freshness and shares the search daily cap", async () => {
  const { SEARCH } = await loadTypeScript(require.resolve("../src/routes/search.ts"));
  const run = SEARCH.find((f) => f.endpoint.path === "/news").run;
  const store = new Map();
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
  const q = (params) => (name) => params[name];
  const realFetch = global.fetch;
  const seen = [];
  global.fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ results: [{ title: "Bitcoin <b>ETF</b> inflows", url: "https://news.example.com/a", description: "Record &amp; rising", age: "3 hours ago", meta_url: { hostname: "news.example.com" } }, { title: "no url" }] }));
  };
  try {
    const env = { TRIALS: kv, SEARCH_API_KEY: "k", SEARCH_DAILY_CAP: "1" };
    await assert.rejects(run(env, q({ q: "bitcoin", freshness: "yesterday" })), (e) => e.status === 400);
    assert.equal(seen.length, 0);
    const out = await run(env, q({ q: "bitcoin", count: "5", freshness: "day" }));
    assert.deepEqual(out, { query: "bitcoin", provider: "Brave News", count: 1, results: [{ title: "Bitcoin ETF inflows", url: "https://news.example.com/a", snippet: "Record & rising", source: "news.example.com", age: "3 hours ago" }], terms: SEARCH[0].endpoint.outputExample.terms });
    assert.match(seen[0], /\/res\/v1\/news\/search\?q=bitcoin&count=5&freshness=pd$/);
    await assert.rejects(run(env, q({ q: "again" })), (e) => e.status === 503 && e.code === "SEARCH_CAPACITY");
    assert.equal(seen.length, 1);
  } finally {
    global.fetch = realFetch;
  }
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
    assert.deepEqual(out, { query: "x402", provider: "Brave Search", count: 1, results: [{ title: "x402 spec", url: "https://x402.org/", snippet: "Pay & go", age: "1 day ago" }], terms: SEARCH[0].endpoint.outputExample.terms });
    assert.match(out.terms, /no storing or caching .* no resale and no model training \(Brave Search API terms\)/);
    assert.match(seen[0].url, /q=x402&count=5$/);
    assert.equal(seen[0].token, "k");
    await assert.rejects(run(env, q({ q: "again" })), (e) => e.status === 503 && e.code === "SEARCH_CAPACITY");
    assert.equal(seen.length, 1);
  } finally {
    global.fetch = realFetch;
  }
});

/** Minimal valid PDF with one line of Helvetica text per page. */
function makePdf(pageTexts, title) {
  const objs = [];
  const kids = pageTexts.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const [i, t] of pageTexts.entries()) {
    const stream = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objs.push(`<< /Title (${title}) >>`);
  let out = "%PDF-1.4\n";
  const offsets = objs.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

test("PDF text extraction reads chosen pages, caps characters and refuses non-PDF bytes", async () => {
  const { readPdf } = await loadTypeScript(require.resolve("../src/routes/pdf.ts"));
  // PDF.js detaches the buffer it parses, so each call gets its own copy.
  const pdf = makePdf(["Hello page one", "Second page text", "Third"], "Test doc");
  const all = await readPdf(pdf.slice(), 1, 50, 50000);
  assert.equal(all.totalPages, 3);
  assert.equal(all.title, "Test doc");
  assert.deepEqual(all.pages.map((p) => p.text), ["Hello page one", "Second page text", "Third"]);
  assert.equal(all.truncated, false);
  const part = await readPdf(pdf.slice(), 2, 1, 50000);
  assert.deepEqual(part.pages.map((p) => p.page), [2]);
  assert.equal(part.truncated, true);
  const capped = await readPdf(pdf.slice(), 1, 50, 20);
  assert.equal(capped.chars, 20);
  assert.equal(capped.truncated, true);
  await assert.rejects(readPdf(new TextEncoder().encode("<html>"), 1, 1, 1000), (e) => e.status === 415);
  await assert.rejects(readPdf(pdf.slice(), 9, 1, 1000), (e) => e.status === 400);
});

test("company profile picks the first business among Wikidata hits and resolves linked labels", async () => {
  const { COMPANY, companyFacts } = await loadTypeScript(require.resolve("../src/routes/company.ts"));
  const item = (id) => ({ datavalue: { value: { id } } });
  const band = { id: "Q2", labels: { en: { value: "Spotify (band)" } }, claims: { P31: [{ mainsnak: item("Q215380") }] } };
  const firm = {
    id: "Q689141", labels: { en: { value: "Spotify" } }, descriptions: { en: { value: "audio streaming service" } },
    sitelinks: { enwiki: { title: "Spotify" } },
    claims: {
      P856: [{ rank: "normal", mainsnak: { datavalue: { value: "https://www.spotify.com/" } } }],
      P571: [{ mainsnak: { datavalue: { value: { time: "+2006-04-23T00:00:00Z", precision: 11 } } } }],
      P17: [{ mainsnak: item("Q34") }], P159: [{ mainsnak: item("Q1754") }], P452: [{ mainsnak: item("Q100") }],
      P169: [{ rank: "deprecated", mainsnak: item("Q900") }, { rank: "preferred", mainsnak: item("Q901") }, { rank: "normal", mainsnak: item("Q902") }],
      P1128: [{ mainsnak: { datavalue: { value: { amount: "+7000", unit: "1" } } } }],
      P414: [{ mainsnak: item("Q13677"), qualifiers: { P249: [{ datavalue: { value: "SPOT" } }] } }],
    },
  };
  const labels = { Q34: "Sweden", Q1754: "Stockholm", Q100: "music streaming", Q901: "Current CEO", Q900: "Old CEO", Q13677: "New York Stock Exchange" };
  const out = companyFacts([band, firm], labels);
  assert.equal(out.name, "Spotify");
  assert.equal(out.founded, "2006-04-23");
  assert.equal(out.ceo, "Current CEO");
  assert.equal(out.employees, 7000);
  assert.deepEqual(out.stockListings, [{ exchange: "New York Stock Exchange", ticker: "SPOT" }]);
  assert.equal(out.headquarters, "Stockholm");
  assert.equal(out.wikipediaUrl, "https://en.wikipedia.org/wiki/Spotify");
  assert.equal(companyFacts([band], {}), null);

  const realFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    const u = new URL(String(url));
    if (u.searchParams.get("action") === "wbsearchentities") return Response.json({ search: [{ id: "Q2" }, { id: "Q689141" }] });
    if (u.searchParams.get("props") === "labels") return Response.json({ entities: Object.fromEntries(Object.entries(labels).map(([id, v]) => [id, { labels: { en: { value: v } } }])) });
    return Response.json({ entities: { Q2: band, Q689141: firm } });
  };
  try {
    const live = await COMPANY[0].run({}, (n) => ({ name: "Spotify" })[n]);
    assert.equal(live.wikidataId, "Q689141");
    assert.equal(live.country, "Sweden");
    assert.equal(urls.length, 3);
    await assert.rejects(COMPANY[0].run({}, (n) => ({ id: "nope" })[n]), (e) => e.status === 400);
    await assert.rejects(COMPANY[0].run({}, () => undefined), (e) => e.status === 400);
  } finally {
    global.fetch = realFetch;
  }
});

test("OFAC screening matches listed addresses case-insensitively and names through aliases", async () => {
  const { buildIndex, screen } = await loadTypeScript(require.resolve("../src/routes/sanctions.ts"));
  // Rows in the shape of sdn.csv and alt.csv: no header, "-0-" for empty fields, remarks last.
  const sdn = [
    '100,"EXAMPLE GROUP",-0- ,"CYBER2] [DPRK3",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"Digital Currency Address - ETH 0xAbC0000000000000000000000000000000000001; alt. Digital Currency Address - XBT 1ExampleBtcAddr;"',
    '200,"DOE, John",individual,"SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 01 Jan 1970."',
    "\x1a",
  ].join("\r\n");
  const alt = '200,1,"aka","SMITH, Johnny",-0- \r\n';
  const index = buildIndex(sdn, alt);
  assert.equal(index.parties.size, 2);
  const byAddr = screen(index, "0xabc0000000000000000000000000000000000001", undefined);
  assert.equal(byAddr.length, 1);
  assert.deepEqual([byAddr[0].sdnId, byAddr[0].currency, byAddr[0].programs], ["100", "ETH", ["CYBER2", "DPRK3"]]);
  assert.equal(screen(index, "1ExampleBtcAddr", undefined)[0].currency, "XBT");
  assert.equal(screen(index, "0x0000000000000000000000000000000000000002", undefined).length, 0);
  const byAlias = screen(index, undefined, "johnny smith");
  assert.deepEqual([byAlias[0].sdnId, byAlias[0].matchedName, byAlias[0].score], ["200", "SMITH, Johnny", 1]);
  assert.equal(screen(index, undefined, "John Doe")[0].type, "individual");
  assert.equal(screen(index, undefined, "Jane Doe").length, 0);
  await assert.rejects(async () => screen(index, undefined, "!"), (e) => e.status === 400);
});

test("public holidays follow each country's rules, including weekend substitutes", async () => {
  const h = await loadTypeScript(require.resolve("../src/routes/holidays.ts"));
  assert.deepEqual([2024, 2025, 2026].map((y) => h.easter(y).toISOString().slice(0, 10)), ["2024-03-31", "2025-04-20", "2026-04-05"]);
  const one = (c, y, name) => h.holidaysFor(c, y).holidays.find((x) => x.name === name);
  assert.equal(one("US", 2026, "Thanksgiving Day").date, "2026-11-26");
  assert.equal(one("US", 2026, "Independence Day").observed, "2026-07-03");
  assert.equal(one("SE", 2026, "Midsummer Day").date, "2026-06-20");
  assert.equal(one("SE", 2026, "All Saints' Day").date, "2026-10-31");
  // England and Wales: Christmas on Sunday moves to Tuesday because Boxing Day already holds Monday.
  assert.deepEqual([one("GB", 2022, "Christmas Day").observed, one("GB", 2022, "Boxing Day").observed], ["2022-12-27", null]);
  assert.deepEqual([one("GB", 2027, "Christmas Day").observed, one("GB", 2027, "Boxing Day").observed], ["2027-12-27", "2027-12-28"]);
  assert.equal(one("DE", 2026, "Whit Monday").date, "2026-05-25");
  assert.equal(h.holidaysFor("SE", 2026).count, 13);
  assert.equal(h.holidaysFor("XX", 2026), null);
  for (const code of Object.keys(h.COUNTRIES)) {
    const dates = h.holidaysFor(code, 2026).holidays.map((x) => x.date);
    assert.deepEqual(dates, [...dates].sort(), code);
  }
});

test("dictionary reads English senses from Wiktionary as plain text with attribution", async () => {
  const realFetch = global.fetch;
  let asked;
  global.fetch = async (url) => {
    asked = String(url);
    return Response.json({
      en: [
        { partOfSpeech: "Noun", definitions: [{ definition: "", examples: [] }, { definition: 'An <a href="/wiki/x">unexpected</a> &amp; fortunate discovery.', examples: ["<i>Pure</i> serendipity."] }] },
        { partOfSpeech: "Verb", definitions: [{ definition: "" }] },
      ],
      fr: [{ partOfSpeech: "Nom", definitions: [{ definition: "sérendipité" }] }],
    });
  };
  try {
    const run = data.PUBLIC_DATA.find((f) => f.endpoint.path === "/dictionary").run;
    const out = await run({}, (n) => ({ word: "serendipity" })[n]);
    assert.match(asked, /en\.wiktionary\.org\/api\/rest_v1\/page\/definition\/serendipity$/);
    assert.deepEqual(out.meanings, [{ partOfSpeech: "Noun", definitions: [{ definition: "An unexpected & fortunate discovery.", example: "Pure serendipity." }] }]);
    assert.match(out.attribution, /CC BY-SA 4\.0/);
  } finally {
    global.fetch = realFetch;
  }
});

test("x402 check decodes v2 headers and v1 bodies and scores listing quality", async () => {
  const { analyze } = await loadTypeScript(require.resolve("../src/routes/x402-check.ts"));
  const { encodePaymentRequiredHeader } = require("@x402/core/http");
  const { declareDiscoveryExtension } = require("@x402/extensions/bazaar");
  const { schemaFromExample } = await loadTypeScript(require.resolve("../src/lib/output-schema.ts"));
  const example = { fee: 3 };
  const good = encodePaymentRequiredHeader({
    x402Version: 2,
    resource: { url: "https://seller.example/fees", description: "Bitcoin fee rates in sat/vB. Use before sending a transaction.", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:8453", amount: "2000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x0000000000000000000000000000000000000001", maxTimeoutSeconds: 300, extra: {} }],
    extensions: declareDiscoveryExtension({ input: {}, inputSchema: { properties: {} }, output: { example, schema: schemaFromExample(example) } }),
  });
  const v2 = analyze("https://seller.example/fees", 402, good, "");
  assert.equal(v2.x402Version, 2);
  assert.equal(v2.accepts[0].priceUsd, 0.002);
  assert.equal(v2.score, 1, JSON.stringify(v2.checks.filter((c) => !c.pass)));

  const weak = encodePaymentRequiredHeader({
    x402Version: 2, resource: { url: "http://seller.example/x" },
    accepts: [{ scheme: "exact", network: "eip155:8453", amount: "500", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x0000000000000000000000000000000000000001", maxTimeoutSeconds: 60, extra: {} }],
  });
  const low = analyze("http://seller.example/x", 402, weak, "");
  const failed = low.checks.filter((c) => !c.pass).map((c) => c.check);
  for (const expected of ["resource URL is absolute https", "USDC amount meets the Coinbase facilitator minimum (0.001)", "description present", "Bazaar discovery metadata present"]) assert.ok(failed.includes(expected), expected);

  const v1 = analyze("https://old.example/a", 402, null, JSON.stringify({ x402Version: 1, accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "10000", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", payTo: "0x1", resource: "https://old.example/a", description: "Old style listing. Use for testing." }] }));
  assert.deepEqual([v1.x402Version, v1.accepts[0].network, v1.accepts[0].priceUsd, v1.resource.url], [1, "eip155:8453", 0.01, "https://old.example/a"]);

  assert.equal(analyze("https://free.example", 200, null, "{}").paywalled, false);
  assert.equal(analyze("https://odd.example", 402, null, "pay me").score, 0);
  assert.throws(() => analyze("https://bad.example", 402, "%%%", ""), (e) => e.status === 422);
});

test("geocode keeps Wikidata hits with coordinates and resolves country and region names", async () => {
  const realFetch = global.fetch;
  const item = (id) => ({ mainsnak: { datavalue: { value: { id } } } });
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.searchParams.get("action") === "wbsearchentities") return Response.json({ search: [{ id: "Q1" }, { id: "Q2" }] });
    if (u.searchParams.get("props") === "labels") return Response.json({ entities: { Q34: { labels: { en: { value: "Sweden" } } }, Q500: { labels: { en: { value: "Uppsala Municipality" } } } } });
    return Response.json({ entities: {
      Q1: { id: "Q1", labels: { en: { value: "Uppsala (disambiguation)" } }, claims: { P31: [item("Q4167410")] } },
      Q2: { id: "Q2", labels: { en: { value: "Uppsala" } }, descriptions: { en: { value: "city in Sweden" } }, claims: {
        P625: [{ mainsnak: { datavalue: { value: { latitude: 59.858056, longitude: 17.644722 } } } }],
        P17: [item("Q34")], P131: [item("Q500")],
        P1082: [{ rank: "normal", mainsnak: { datavalue: { value: { amount: "+100000" } } } }, { rank: "preferred", mainsnak: { datavalue: { value: { amount: "+177074" } } } }],
      } },
    } });
  };
  try {
    const run = data.PUBLIC_DATA.find((f) => f.endpoint.path === "/geocode").run;
    const out = await run({}, (n) => ({ name: "Uppsala" })[n]);
    assert.equal(out.count, 1);
    assert.deepEqual(out.results[0], { name: "Uppsala", description: "city in Sweden", country: "Sweden", region: "Uppsala Municipality", lat: 59.8581, lon: 17.6447, population: 177074, elevation: null, wikidataId: "Q2" });
  } finally {
    global.fetch = realFetch;
  }
});

test("pricer values tokens through USDC or WETH pools and reads ETH/USD once", async () => {
  const { pricer } = await loadTypeScript(require.resolve("../src/routes/prices.ts"));
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", WETH = "0x4200000000000000000000000000000000000006";
  const T = "0x1111111111111111111111111111111111111111", NOPOOL = "0x2222222222222222222222222222222222222222";
  const dec = { [USDC]: 6, [WETH]: 18, [T]: 18 };
  // sqrtPriceX96 for "1 base = price quote" in the pool's own token order.
  const sqrtFor = (base, quote, price) => {
    const raw = price * 10 ** (dec[quote] - dec[base]);
    const raw1per0 = base.toLowerCase() < quote.toLowerCase() ? raw : 1 / raw;
    return BigInt(Math.round(Math.sqrt(raw1per0) * 2 ** 96));
  };
  const pools = {
    [`${WETH}|${USDC}|500`]: { addr: "0x000000000000000000000000000000000000a001", sqrt: sqrtFor(WETH, USDC, 2000), reserve: 5_000_000n * 10n ** 6n },
    [`${T}|${WETH}|3000`]: { addr: "0x000000000000000000000000000000000000a002", sqrt: sqrtFor(T, WETH, 0.5), reserve: 100n * 10n ** 18n },
  };
  const byAddr = Object.fromEntries(Object.values(pools).map((p) => [p.addr, p]));
  let refReads = 0;
  const cl = {
    async readContract({ address, functionName, args }) {
      if (functionName === "getPool") {
        const hit = pools[`${args[0]}|${args[1]}|${args[2]}`];
        if (args[0] === WETH && args[1] === USDC && args[2] === 500) refReads++;
        return hit ? hit.addr : "0x0000000000000000000000000000000000000000";
      }
      if (functionName === "slot0") return [byAddr[address].sqrt, 0, 0, 0, 0, 0, true];
      if (functionName === "balanceOf") return byAddr[args[0]].reserve;
      throw new Error(functionName);
    },
  };
  const p = pricer(cl, "base");
  assert.ok(Math.abs((await p.ethUsd()) - 2000) < 1e-6);
  const t = await p.price(T, 18);
  assert.equal(t.quotedIn, "WETH");
  assert.ok(Math.abs(t.priceUsd - 1000) < 1e-6);
  assert.equal((await p.price(USDC, 6)).priceUsd, 1);
  assert.equal(await p.price(NOPOOL, 18), null);
  assert.equal(refReads, 1);
});

test("feed parser reads RSS and Atom items and ignores nested channel elements", async () => {
  const { parseFeed } = await loadTypeScript(require.resolve("../src/routes/feeds.ts"));
  const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>News &amp; Notes</title><link>https://a.example/</link><description>All the news</description>
    <image><title>Logo title</title><link>https://a.example/logo</link></image>
    <item><title><![CDATA[First <b>post</b>]]></title><link>/p/1</link><pubDate>Sat, 17 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Hello &amp; welcome&lt;/p&gt;</description><dc:creator>Ada</dc:creator><guid>p1</guid></item>
    <item><title>Second</title><link>https://a.example/p/2</link></item></channel></rss>`;
  const r = parseFeed(rss, "https://a.example/feed.xml", 1);
  assert.equal(r.format, "rss");
  assert.deepEqual(r.feed, { title: "News & Notes", link: "https://a.example/", description: "All the news" });
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.items[0], { title: "First post", link: "https://a.example/p/1", date: "2026-10-17T10:00:00.000Z", summary: "Hello & welcome", author: "Ada", id: "p1" });
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom site</title><link rel="self" href="/atom.xml"/><link href="https://b.example/"/>
    <entry><title>Entry</title><link rel="alternate" href="/e/1"/><updated>2026-10-18T08:00:00Z</updated><summary>Short</summary><author><name>Bo</name></author><id>urn:e1</id></entry></feed>`;
  const a = parseFeed(atom, "https://b.example/atom.xml", 20);
  assert.equal(a.format, "atom");
  assert.equal(a.feed.link, "https://b.example/");
  assert.deepEqual(a.items[0], { title: "Entry", link: "https://b.example/e/1", date: "2026-10-18T08:00:00.000Z", summary: "Short", author: "Bo", id: "urn:e1" });
  assert.equal(parseFeed("<html><body>not a feed</body></html>", "https://c.example/", 5).format, null);
});

test("meta parser reads head tags, resolves URLs and stops at the body", async () => {
  const { parseMeta } = await loadTypeScript(require.resolve("../src/routes/feeds.ts"));
  const html = `<html lang="sv"><head><title>Plain &amp; simple</title><meta name="description" content="Desc">
    <meta property="og:title" content="OG title"><meta property="og:image" content="/img.png"><meta name="twitter:card" content="summary">
    <link rel="canonical" href="/canon"><link rel="shortcut icon" href="/fav.ico"></head><body><meta name="description" content="late"></body></html>`;
  const m = parseMeta(html, "https://site.example/page");
  assert.deepEqual([m.title, m.description, m.image, m.canonical, m.favicon, m.lang], ["OG title", "Desc", "https://site.example/img.png", "https://site.example/canon", "https://site.example/fav.ico", "sv"]);
  assert.deepEqual(m.twitter, { "twitter:card": "summary" });
  assert.equal(parseMeta("<html><head></head></html>", "https://x.example/a").favicon, "https://x.example/favicon.ico");
});

test("OFAC compact index round-trips through JSON and matches what the CSV path finds", async () => {
  const { compactFromCsv, fromCompact, buildIndex, screen } = await loadTypeScript(require.resolve("../src/routes/sanctions.ts"));
  const sdn = '100,"EXAMPLE GROUP",-0- ,"CYBER2",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"Digital Currency Address - ETH 0xAbC0000000000000000000000000000000000001;"\r\n200,"DOE, John",individual,"SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"-0- "';
  const alt = '200,1,"aka","SMITH, Johnny",-0- \r\n999,2,"aka","ORPHAN ALIAS",-0- ';
  const compact = compactFromCsv(sdn, alt, "2026-10-18T00:00:00.000Z");
  assert.deepEqual([compact.parties.length, compact.aliases.length, compact.addresses.length], [2, 1, 1]);
  const viaJson = fromCompact(JSON.parse(JSON.stringify(compact)));
  const direct = buildIndex(sdn, alt);
  for (const [address, name] of [["0xabc0000000000000000000000000000000000001", undefined], [undefined, "johnny smith"], [undefined, "example"], [undefined, "nobody here"]]) {
    assert.deepEqual(screen(viaJson, address, name), screen(direct, address, name));
  }
  assert.equal(screen(viaJson, undefined, "johnny smith")[0].sdnId, "200");
  assert.equal(viaJson.listDate, "2026-10-18T00:00:00.000Z");
});

test("counterparty verdict: SDN match blocks, high heuristics review, otherwise pass", async () => {
  const { verdict } = await loadTypeScript(require.resolve("../src/routes/counterparty.ts"));
  const low = { riskLevel: "low", riskFlags: [] };
  assert.deepEqual(verdict([], low, null), { verdict: "pass", reasons: [] });
  const hit = [{ name: "LAZARUS GROUP" }, { name: "LAZARUS GROUP" }];
  assert.deepEqual(verdict(hit, low, null), { verdict: "block", reasons: ["address is on the OFAC SDN list (LAZARUS GROUP)"] });
  assert.deepEqual(verdict([], { riskLevel: "high", riskFlags: ["a", "b"] }, null), { verdict: "review", reasons: ["wallet heuristics on Base: a, b"] });
  assert.equal(verdict([], low, { riskLevel: "critical", riskFlags: ["proxy-impl-unset"] }).verdict, "review");
  assert.equal(verdict([], { riskLevel: "medium", riskFlags: ["a"] }, { riskLevel: "medium", riskFlags: [] }).verdict, "pass");
});

test("counterparty payee domain: a high domain flag means review, never block; medium flags alone pass; URLs normalize", async () => {
  const { verdict, payeeDomain } = await loadTypeScript(require.resolve("../src/routes/counterparty.ts"));
  const low = { riskLevel: "low", riskFlags: [] };
  const young = [{ level: "high", code: "very_new", message: "Registered only 3 day(s) ago." }];
  assert.deepEqual(verdict([], low, null, young), { verdict: "review", reasons: ["payee domain: Registered only 3 day(s) ago."] });
  assert.equal(verdict([], low, null, [{ level: "medium", code: "no_dmarc", message: "x" }]).verdict, "pass");
  assert.equal(verdict([{ name: "LAZARUS GROUP" }], low, null, young).verdict, "block", "an SDN match still blocks");
  assert.equal(payeeDomain("https://www.Shop.Example.com/pay?x=1"), "shop.example.com");
  assert.equal(payeeDomain("example.org"), "example.org");
  assert.equal(payeeDomain("  "), undefined);
  assert.equal(payeeDomain(undefined), undefined);
});

test("extract/rendered: rendered HTML goes through the /extract builder; no browser is an uncharged 503", async () => {
  const { buildExtraction, extractOptions } = await loadTypeScript(require.resolve("../src/routes/extract.ts"));
  const opts = extractOptions("https://app.example/", undefined, "markdown", undefined);
  const out = await buildExtraction({ ...opts, finalUrl: "https://app.example/", status: 200, contentType: "text/html; rendered",
    source: "<html><head><title>App</title></head><body><main><h1>Built by JS</h1><p>Rendered paragraph text that a static fetch would miss.</p></main></body></html>",
    html: true, markdownSource: false, markdownPath: false, inputTruncated: false });
  assert.match(out.markdown, /Built by JS/);
  assert.equal(out.sourceFormat, "html");
  const { EXTRACT_RENDERED } = await loadTypeScript(require.resolve("../src/routes/extract-rendered.ts"));
  await assert.rejects(EXTRACT_RENDERED[0].run({}, (n) => (n === "url" ? "https://app.example/" : undefined)), (e) => e.status === 503);
  await assert.rejects(EXTRACT_RENDERED[0].run({}, (n) => (n === "url" ? "http://127.0.0.1/" : undefined)), (e) => e.status === 400);
});

test("counterparty: chain is validated before any network call", async () => {
  const { COUNTERPARTY } = await loadTypeScript(require.resolve("../src/routes/counterparty.ts"));
  const run = (args) => COUNTERPARTY[0].run({}, (n) => args[n]);
  await assert.rejects(run({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "solana" }), (e) => e.status === 400 && /base, eth, arb, op/.test(e.message));
  await assert.rejects(run({ address: "not-an-address" }), (e) => e.status === 400);
  assert.deepEqual(COUNTERPARTY[0].endpoint.params.chain.enum, ["base", "eth", "arb", "op"]);
});

test("x402 check treats every network we accept as native USDC (Monad, World Chain)", async () => {
  const { analyze } = await loadTypeScript(require.resolve("../src/routes/x402-check.ts"));
  const { encodePaymentRequiredHeader } = require("@x402/core/http");
  const header = encodePaymentRequiredHeader({
    x402Version: 2,
    resource: { url: "https://seller.example/x", description: "d. Use for tests.", mimeType: "application/json" },
    accepts: [
      { scheme: "exact", network: "eip155:143", amount: "3000", asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", payTo: "0x0000000000000000000000000000000000000001", maxTimeoutSeconds: 300, extra: {} },
      { scheme: "exact", network: "eip155:480", amount: "3000", asset: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", payTo: "0x0000000000000000000000000000000000000001", maxTimeoutSeconds: 300, extra: {} },
    ],
  });
  const out = analyze("https://seller.example/x", 402, header, "");
  assert.deepEqual(out.accepts.map((a) => [a.assetIsNativeUsdc, a.priceUsd]), [[true, 0.003], [true, 0.003]]);
});

test("payee preflight: inputs and chain are validated before any network call; all five chains are accepted", async () => {
  const { COUNTERPARTY } = await loadTypeScript(require.resolve("../src/routes/counterparty.ts"));
  const payee = COUNTERPARTY.find((e) => e.endpoint.path === "/check/payee");
  assert.equal(payee.endpoint.price, "$0.005");
  assert.deepEqual(payee.endpoint.params.chain.enum, ["base", "eth", "arb", "op", "polygon"]);
  const run = (args) => payee.run({}, (n) => args[n]);
  await assert.rejects(run({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "solana" }), (e) => e.status === 400 && /polygon/.test(e.message));
  await assert.rejects(run({ address: "not-an-address" }), (e) => e.status === 400);
  await assert.rejects(run({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", domain: "http://[" }), (e) => e.status === 400);
});

test("x402 seller audit verdict: a sanctioned payTo blocks; missing terms, non-USDC, high price or a high domain flag review", async () => {
  const { sellerVerdict, X402_CHECK } = await loadTypeScript(require.resolve("../src/routes/x402-check.ts"));
  const usdc = { paywalled: true, accepts: [{ priceUsd: 0.01, assetIsNativeUsdc: true }] };
  const clean = [{ payTo: "0xabc", sanctioned: false, sanctionMatches: [] }];
  assert.deepEqual(sellerVerdict(usdc, clean, []), { verdict: "pass", reasons: [] });
  const hit = [{ payTo: "0xbad", sanctioned: true, sanctionMatches: [{ name: "LAZARUS GROUP" }] }];
  assert.equal(sellerVerdict(usdc, hit, []).verdict, "block");
  assert.match(sellerVerdict(usdc, hit, []).reasons[0], /0xbad is on the OFAC SDN list \(LAZARUS GROUP\)/);
  assert.equal(sellerVerdict({ paywalled: false, accepts: [] }, [], []).verdict, "review");
  assert.equal(sellerVerdict({ paywalled: true, accepts: [{ priceUsd: null, assetIsNativeUsdc: false }] }, clean, []).verdict, "review");
  assert.equal(sellerVerdict({ paywalled: true, accepts: [{ priceUsd: 2, assetIsNativeUsdc: true }] }, clean, []).verdict, "review");
  assert.equal(sellerVerdict(usdc, clean, [{ level: "medium", message: "m" }]).verdict, "pass");
  assert.equal(sellerVerdict(usdc, clean, [{ level: "high", message: "Registered only 3 day(s) ago." }]).verdict, "review");
  const audit = X402_CHECK.find((e) => e.endpoint.path === "/check/x402-seller");
  assert.equal(audit.endpoint.price, "$0.01");
  await assert.rejects(audit.run({}, (n) => (n === "url" ? "http://127.0.0.1/" : undefined)), (e) => e.status === 400);
});
