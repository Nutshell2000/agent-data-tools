// A free user must cost nothing metered (21 Nov 2026). This test makes that permanent:
//   1. it reads the tool handlers' source (tests/metered-source.cjs) and lists every tool that can reach a metered
//      binding: Workers AI, the hosted browser, the paid search key, the resale wallet, Vectorize;
//   2. every such tool must be in FREE_EXCLUDED_METERED (src/lib/capacity.ts), with its entry paths;
//   3. every free path must refuse every tool in that set: HTTP trial=1, the free MCP calls (anonymous and signed in),
//      a free key's monthly calls, the ChatGPT plugin's daily calls, review keys, the live example pages;
//   4. the free pages that are not tools (LexGlyph, the PDF try, payee claims, free keys) must not reach a metered
//      binding either, and the free voice keys must be off in the production configuration;
//   5. the numbers of the free calls are the ones the owner set, each in one exported constant.
// Adding a tool that calls env.AI without listing it in FREE_EXCLUDED_METERED fails test 2 (the last test proves it
// on a made-up tool).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before } = require("node:test");
const { analyze, load } = require("./metered-source.cjs");

let tools, ENDPOINTS, PAUSED, ENTRY_OF, capacity, free;
before(async () => {
  tools = await analyze("src/tools.ts");
  const endpoints = await load("src/endpoints.ts");
  ENDPOINTS = endpoints.ENDPOINTS; PAUSED = endpoints.PAUSED_FAMILY_TOOLS;
  ({ ENTRY_OF } = await load("src/routes/entry-paths.ts"));
  capacity = await load("src/lib/capacity.ts");
  free = await load("src/lib/free-calls.ts");
});

const canonical = (p) => (Object.hasOwn(ENTRY_OF, p) ? ENTRY_OF[p] : p);
/** Every path of the catalog, paused ones too, with why it is metered (its own handler's reason, or its canonical tool's). */
function meteredPaths() {
  const all = new Set([...ENDPOINTS.map((e) => e.path), ...Object.keys(PAUSED), ...Object.keys(ENTRY_OF), ...tools.exactPaths]);
  const out = new Map();
  for (const p of all) {
    const why = tools.meteredReason(p) ?? (canonical(p) !== p && tools.meteredReason(canonical(p)) ? `entry path of ${canonical(p)}` : undefined);
    if (why) out.set(p, why);
  }
  return out;
}

test("the source reader finds the catalog and the tools known to be metered", () => {
  assert.deepEqual(tools.unplaced, [], "a metered handler whose path could not be read from the source: give it a literal path or teach tests/metered-source.cjs");
  assert.ok(tools.entries > 400, `only ${tools.entries} catalog entries were found in the source`);
  const metered = meteredPaths();
  // One known tool per metered binding, so a reader that went blind fails here and not silently.
  for (const p of ["/ai/chat", "/ai/embed", "/ai/rerank", "/ai/moderation", "/transcribe", "/image", "/describe", "/ai/speech", "/screenshot", "/extract/rendered", "/search", "/law/search", "/summarize"]) {
    assert.ok(metered.has(p), `${p} should be read as metered`);
  }
  // And tools that only compute or read free public sources are not swept in.
  for (const p of ["/hash", "/time", "/fx", "/weather", "/eth/balance", "/pdf/text", "/sanctions/check", "/dns/lookup"]) {
    assert.equal(metered.has(p), false, `${p} is read as metered (${metered.get(p)})`);
  }
});

test("every tool whose handler can reach a metered binding is in FREE_EXCLUDED_METERED", () => {
  const missing = [...meteredPaths()].filter(([p]) => !capacity.FREE_EXCLUDED_METERED.has(p));
  assert.deepEqual(missing, [], `these tools can spend metered money and are not excluded from the free paths; add them to METERED_NOT_CAPACITY_LIMITED (or CAPACITY_LIMITED) in src/lib/capacity.ts:\n${missing.map(([p, why]) => `  ${p}: ${why}`).join("\n")}`);
  // Everything capacity-limited stays excluded too, and an entry path follows its canonical tool.
  for (const p of capacity.CAPACITY_LIMITED) assert.ok(capacity.FREE_EXCLUDED_METERED.has(p), p);
  for (const [door, tool] of Object.entries(ENTRY_OF)) {
    if (capacity.FREE_EXCLUDED_METERED.has(tool)) assert.ok(capacity.FREE_EXCLUDED_METERED.has(door), `${door} is an entry path of ${tool}, which no free path runs; list it too`);
  }
});

test("no free path is open to a tool in FREE_EXCLUDED_METERED", async () => {
  const excluded = [...capacity.FREE_EXCLUDED_METERED];
  assert.ok(excluded.length > 60);
  // HTTP trial=1 and the helper every other free path asks.
  for (const p of excluded) {
    assert.equal(capacity.httpFree(p), false, `HTTP trial=1 would run ${p}`);
    assert.equal(capacity.freeEligible(p), false, `a free call would run ${p}`);
  }
  // The ChatGPT plugin's daily calls: its fixed list holds none of them.
  const { CHATGPT_TOOLS } = await load("src/lib/chatgpt-tools.ts");
  assert.deepEqual([...CHATGPT_TOOLS].filter((p) => capacity.FREE_EXCLUDED_METERED.has(p)), [], "the ChatGPT plugin's free daily calls would run a metered tool");
  // The live example pages run their tool for every visitor.
  const live = await load("src/lib/live-pages.ts");
  assert.deepEqual(ENDPOINTS.filter((e) => live.isLivePage(e) && capacity.FREE_EXCLUDED_METERED.has(e.path)).map((e) => e.path), [], "a live example page would run a metered tool");
  // Where the decision is taken, the code asks the one helper, not a list of its own.
  const src = (f) => fs.readFileSync(f, "utf8");
  const mcp = src("src/mcp.ts");
  assert.match(mcp, /const free = !freeEligible\(e\.path\) \? null : directory \? await useDailyCall\(/, "src/mcp.ts: the free MCP calls and the ChatGPT daily calls must ask freeEligible first");
  assert.match(mcp, /creditCharger\(env, creditKey, [^\n]*, freeEligible\(e\.path\), !freeEligible\(e\.path\)\)/, "src/mcp.ts: a free key and a review key over MCP must ask freeEligible");
  assert.match(mcp, /CHATGPT_TOOLS\.has\(e\.path\) && freeEligible\(e\.path\)/, "src/mcp.ts: the ChatGPT server's list must be filtered by freeEligible");
  const index = src("src/index.ts");
  assert.match(index, /chargeCredits\([^\n]*, freeEligible\(endpoint\.path\), !freeEligible\(endpoint\.path\)\);/, "src/index.ts: a free key and a review key over HTTP must ask freeEligible");
  assert.match(index, /\(httpFree\(c\.req\.path\) \|\| pdfTry\) && c\.req\.method === "GET" && c\.req\.query\("trial"\) === "1"/, "src/index.ts: HTTP trial=1 must ask httpFree");
  for (const f of ["src/mcp.ts", "src/index.ts", "src/lib/credit-routes.ts", "src/mcp-contract.ts", "src/routes/recommend.ts", "src/guides/task-guides.ts", "src/lib/live-pages.ts"]) {
    const uses = src(f).split(/\r?\n/).filter((l) => /CAPACITY_LIMITED\.has\(/.test(l) && !/marketplaceOf\(/.test(l));
    assert.deepEqual(uses, [], `${f} decides something from CAPACITY_LIMITED alone; a free decision asks freeEligible or httpFree`);
  }
});

test("a free key's monthly call and a review key are refused on an excluded tool, with a payment answer and no 5xx", async () => {
  const routes = await load("src/lib/credit-routes.ts");
  const credits = await load("src/lib/credits.ts");
  const { Hono } = require("hono");
  const key = `adt_${"r".repeat(43)}`;
  const keyHash = await credits.hashCreditKey(key);
  let ran = 0;
  const store = {
    takeDailyCall: async () => 9, refundDailyCall: async () => {},
    spendCredits: async (_hash, _micros, freeMonth) => (freeMonth ? { ok: true, free: { left: 5 }, balanceMicros: 0 } : { ok: false, reason: "insufficient", balanceMicros: 0, freeKey: true }),
    refundCredits: async () => 0,
  };
  const env = (review) => ({ REVIEW_KEY_HASHES: review ? keyHash : "", METRICS: { idFromName: () => "id", get: () => store } });
  const app = new Hono();
  app.get("/tool", (c, next) => routes.chargeCredits(c, "$0.01", key, next, c.req.query("eligible") === "1", c.req.query("eligible") !== "1"), (c) => { ran++; return c.json({ ok: true }); });
  // A review key: runs an eligible tool, and gets 402 on an excluded one without running it.
  assert.equal((await app.request("/tool?eligible=1", {}, env(true))).status, 200);
  const refused = await app.request("/tool?eligible=0", {}, env(true));
  assert.equal(refused.status, 402);
  assert.match((await refused.json()).error, /review key runs tools that only compute or look up public data/);
  // A free key: its monthly call runs an eligible tool; an excluded one answers 402 "insufficient credits".
  assert.equal((await app.request("/tool?eligible=1", {}, env(false))).status, 200);
  const paid = await app.request("/tool?eligible=0", {}, env(false));
  assert.equal(paid.status, 402);
  assert.equal((await paid.json()).code, "insufficient_credits");
  assert.equal(ran, 2, "an excluded tool ran for a key that pays nothing");
  // The same over MCP.
  const charger = (eligible, review) => routes.creditCharger(env(review), key, "$0.01", "https://api.test", false, eligible, !eligible)(async () => { ran++; return { content: [] }; });
  assert.equal((await charger(false, true)).isError, true);
  assert.equal((await charger(false, false)).isError, true);
  assert.equal(ran, 2);
});

test("the free pages that are not tools reach nothing metered, and the free voice keys are off", async () => {
  const lex = await analyze("src/lib/lexglyph-page.ts");
  assert.equal(lex.reaches("lexglyphHtml"), null, "the free LexGlyph search must stay keyword-only (D1): no model, no Vectorize");
  const extra = await analyze("src/lib/lexglyph-extra.ts");
  for (const name of ["lexglyphVersionHtml", "lexglyphExport"]) assert.equal(extra.reaches(name), null, name);
  const pdf = await analyze("src/lib/pdf-try.ts");
  for (const name of pdf.names.filter((n) => /pdfTry|PdfTry/.test(n))) assert.equal(pdf.reaches(name), null, name);
  const keys = await analyze("src/lib/free-keys.ts");
  assert.equal(keys.reaches("freeKeys"), null, "the free-key routes");
  // The free finder (MCP find_tool, GET /find) matches words: no caller hands it a reranking model.
  const finder = await analyze("src/routes/recommend.ts");
  assert.equal(finder.reaches("recommend"), null, "the free finder");
  // The reader itself: the paid law search IS metered, so a clean answer above is not blindness.
  const law = await analyze("src/routes/law-search.ts");
  assert.match(law.reaches("lawDeps") ?? "", /env\.(AI|LAW_VECTORS)/);
  assert.equal(law.reaches("lawKeywordDeps"), null);

  // Production configuration: no free voice key, no free transcription trial, no free keys by e-mail.
  const vars = (file) => Object.fromEntries([...fs.readFileSync(file, "utf8").matchAll(/^\s*"([A-Z_]+)":\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
  for (const file of ["wrangler.jsonc", "wrangler.staging.jsonc"]) {
    const v = vars(file);
    assert.equal(v.VOICE_TEST_KEYS, "off", `${file}: VOICE_TEST_KEYS`);
    assert.equal(v.CREDITS_TRIAL, "off", `${file}: CREDITS_TRIAL`);
    assert.equal(v.FREE_KEYS, "off", `${file}: FREE_KEYS (each sign-up sends a billed e-mail)`);
  }
  assert.equal(vars("wrangler.jsonc").SEARCH_DAILY_CAP, "200");

  // While off: GET says so and names the paid way, POST refuses, and nothing is written.
  const voice = await load("src/lib/voice-keys.ts");
  let writes = 0;
  const env = { VOICE_TEST_KEYS: "off", CREDITS_TRIAL: "off", TRIALS: { get: async () => null, put: async () => { writes++; } }, METRICS: { idFromName: () => "id", get: () => new Proxy({}, { get: () => async () => { writes++; return null; } }) } };
  for (const [method, p] of [["GET", "/keys/voice-test"], ["POST", "/keys/voice-test"], ["GET", "/credits/trial"], ["POST", "/credits/trial"]]) {
    const res = await voice.voiceKeys.request(`https://api.test${p}`, { method, headers: { accept: "application/json" } }, env);
    const body = await res.json();
    assert.equal(res.status, 404, `${method} ${p}`);
    assert.equal(body.code, "not_offered");
    assert.match(body.error, /not offered/);
    assert.match(body.error, /\/credits/);
    assert.equal(body.apiKey, undefined);
    assert.doesNotMatch(JSON.stringify(body), /"freeVoiceTestKey":true|"freeTrial":true/);
  }
  assert.equal(writes, 0, "a switched-off route wrote something");

  // The studio voices block takes a paid key only.
  const studio = await load("src/lib/studio-voices.ts");
  const html = studio.studioVoices({ textId: "t", voices: { en: ["luna"], es: [] }, planUrl: "https://buy.test", planPrice: "$3", planCharacters: 100000, maxCharacters: 2000, testCharacters: 100, freeTry: true }) + studio.studioVoicesScript();
  assert.doesNotMatch(html, /Try it free|studio_try|sv-try|voice-test|free test key/i);
  assert.match(html, /data-ev="studio_play"/);
  assert.match(html, /paid key/);
});

test("the free numbers are the owner's, each in one exported constant", async () => {
  assert.equal(free.FREE_CALLS_PER_CALLER, 10);
  assert.equal(free.FREE_HTTP_CALLS_PER_CALLER, 3);
  assert.equal(free.FREE_CALLS_PER_DAY, 500);
  assert.match(free.FREE_TOOLS_KIND, /only compute or look up public data/);
  assert.match(free.FREE_NOT_FOR, /AI, speech, transcription, images, rendering, search/);
  // The day's total is a hard stop for every caller together.
  const m = new Map();
  const store = { transaction: (fn) => fn({ get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); } }) };
  let given = 0;
  for (let i = 0; i < free.FREE_CALLS_PER_DAY + 50; i++) if (await free.takeFreeCall(store, `caller-${i}`, "2026-11-21", free.FREE_CALLS_PER_CALLER) !== null) given++;
  assert.equal(given, free.FREE_CALLS_PER_DAY);
  // What an assistant is told: the number, the kind of tool, and that the rest is paid.
  const routes = await load("src/lib/credit-routes.ts");
  for (const text of [routes.mcpInstructions("https://api.test", false, 400), routes.mcpInstructions("https://api.test", false, 400, false, true)]) {
    assert.ok(text.includes(`${free.FREE_CALLS_PER_CALLER} free successful calls`), text);
    assert.ok(text.includes(free.FREE_TOOLS_KIND) && text.includes(free.FREE_NOT_FOR) && text.includes(free.FREE_REST_PAID), text);
    assert.doesNotMatch(text, /\b25\b/);
  }
  const hint = routes.paymentHint("https://api.test", "$0.01", false, false, "$0.01", false);
  assert.match(hint, /This tool is not in the free calls/);
  assert.doesNotMatch(hint, /to get your own/);
  const contract = await load("src/mcp-contract.ts");
  const byPath = new Map(ENDPOINTS.map((e) => [e.path, e]));
  assert.match(contract.toolDescription(byPath.get("/hash")), new RegExp(`first ${free.FREE_CALLS_PER_CALLER} free`));
  assert.doesNotMatch(contract.toolDescription(byPath.get("/ai/chat")), /first \d+ free/);
});

test("a new tool that calls env.AI is caught: the reader lists it and the exclusion check would fail", async () => {
  // A made-up module with two entries, one calling the model through a helper: the reader must flag exactly that one.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "free-metered-"));
  const file = path.join(dir, "made-up.ts");
  const root = process.cwd().replace(/\\/g, "/");
  fs.writeFileSync(file, `
import { entry } from "${root}/src/family";
import { runAi } from "${root}/src/lib/ai";
import type { Env } from "${root}/src/lib/env";
const guess = async (env: Env, text: string) => runAi<{ response?: string }>(env, "@cf/made/up", { prompt: text });
const NEW = [
  entry("/made-up/ai", "s", "d", [], {}, {}, async (env, q) => ({ out: (await guess(env, q("text") ?? "")).response })),
  entry("/made-up/plain", "s", "d", [], {}, {}, async (_env, q) => ({ out: (q("text") ?? "").length })),
];
export const handlers: Record<string, unknown> = {};
for (const e of NEW) handlers[e.endpoint.path] = e.run;
`);
  try {
    const made = await analyze(file);
    assert.match(made.meteredReason("/made-up/ai") ?? "", /env\.AI/);
    assert.equal(made.meteredReason("/made-up/plain"), undefined);
    assert.equal(capacity.FREE_EXCLUDED_METERED.has("/made-up/ai"), false, "so the exclusion check above fails until the tool is listed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
