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
  assert.equal(families.length, 137);
  for (const { endpoint: e } of families) {
    assert.equal(e.price, e.path === "/search" ? "$0.01" : e.path === "/pdf/text" || e.path === "/sanctions/check" ? "$0.005" : e.path === "/company" ? "$0.003" : e.path === "/x402/check" ? "$0.002" : e.path.startsWith("/ai/") || e.path === "/price/token" ? "$0.002" : "$0.001", e.path);
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
  assert.equal(ENDPOINTS.length,160);
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
