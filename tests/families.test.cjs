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
  assert.equal(families.length, 117);
  for (const { endpoint: e } of families) {
    assert.equal(e.price, "$0.001", e.path);
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
  assert.equal(ENDPOINTS.length,139);
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
