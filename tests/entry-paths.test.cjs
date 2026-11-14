// Entry paths (7 Nov 2026): task-named doors to tools we already sell, plus the two US Treasury tools shipped with them.
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

let doors, treasury, endpoints, capacity, discovery;
before(async () => {
  doors = await loadTypeScript(require.resolve("../src/routes/entry-paths.ts"));
  treasury = await loadTypeScript(require.resolve("../src/routes/treasury.ts"));
  endpoints = await loadTypeScript(require.resolve("../src/endpoints.ts"));
  capacity = await loadTypeScript(require.resolve("../src/lib/capacity.ts"));
  discovery = await loadTypeScript(require.resolve("../src/discovery.ts"));
});

test("every entry path names a task, runs a canonical tool at that tool's live price, and sits in its category", () => {
  const live = Object.fromEntries(endpoints.ENDPOINTS.map((e) => [e.path, e]));
  assert.ok(doors.ENTRY_PATHS.length >= 15);
  for (const { endpoint: e } of doors.ENTRY_PATHS) {
    const canonical = doors.ENTRY_OF[e.path];
    assert.ok(canonical && live[canonical], `${e.path} -> ${canonical} must be a live tool`);
    assert.notEqual(canonical, e.path);
    assert.ok(live[e.path], `${e.path} must be listed`);
    // The two time doors cost $0.002 while /time stays $0.01 (owner, 11 Nov 2026: only the doors were put to her).
    if (e.path === "/timezone/convert" || e.path === "/time/now") assert.equal(live[e.path].price, "$0.002", e.path);
    else assert.equal(live[e.path].price, live[canonical].price, `${e.path} price must equal ${canonical}'s`);
    assert.ok(e.summary.split(":")[0].length <= 32, e.summary);
    assert.match(e.description, /(^|\. )Use (when|to|for|before|as) /, e.path);
    assert.ok(e.description.length <= 450, `${e.path} ${e.description.length}`);
    assert.ok(e.tags.length >= 5, e.path);
    // A capacity-limited tool's door is capacity-limited too (never free, never on marketplaces).
    assert.equal(capacity.CAPACITY_LIMITED.has(e.path), capacity.CAPACITY_LIMITED.has(canonical), e.path);
    assert.equal(discovery.categoryOf(e.path), discovery.categoryOf(canonical), `${e.path} category`);
  }
  // At most two doors per tool (round 4, 9 Nov 2026: a short-name door beside the long one), each with its own phrase.
  const byCanonical = {};
  for (const { endpoint: e } of doors.ENTRY_PATHS) (byCanonical[doors.ENTRY_OF[e.path]] ??= []).push(e.summary.split(":")[0].toLowerCase());
  for (const [canonical, names] of Object.entries(byCanonical)) {
    // /extract has three since 10 Nov 2026: scrape, fetch and Markdown are three searches, and routers match the path words.
    assert.ok(names.length <= (canonical === "/extract" ? 3 : 2), `${canonical} has ${names.length} doors`);
    assert.equal(new Set(names).size, names.length, `${canonical} doors share a name`);
  }
  assert.equal(new Set(doors.ENTRY_PATHS.map((d) => d.endpoint.path)).size, doors.ENTRY_PATHS.length);
});

test("the USDC yield door forces stablecoin pools and defaults the token to USDC", () => {
  const sent = (n) => ({ chain: "Base" })[n];
  const q = doors.usdcYieldInput(sent);
  assert.equal(q("stablecoin"), "true");
  assert.equal(q("symbol"), "USDC");
  assert.equal(q("chain"), "Base");
  assert.equal(doors.usdcYieldInput((n) => ({ symbol: "DAI" })[n])("symbol"), "DAI");
});

test("the crypto news door answers a call without a topic: general crypto headlines of the past day", () => {
  const empty = doors.cryptoNewsInput(() => undefined);
  assert.equal(empty("q"), "cryptocurrency");
  assert.equal(empty("freshness"), "day");
  assert.equal(empty("count"), undefined);
  const asked = doors.cryptoNewsInput((n) => ({ q: " solana ETF ", freshness: "week", count: "5" })[n]);
  assert.equal(asked("q"), "solana ETF");
  assert.equal(asked("freshness"), "week");
  assert.equal(asked("count"), "5");
  const door = doors.ENTRY_PATHS.find((d) => d.endpoint.path === "/crypto/news").endpoint;
  assert.ok(!door.params.q.required, "a router that plans the call empty must succeed");
});

test("round 5 doors are named with the phrase buyers search", () => {
  const name = (p) => doors.ENTRY_PATHS.find((d) => d.endpoint.path === p).endpoint.summary.split(":")[0];
  assert.equal(name("/weather/current"), "Current weather");
  assert.equal(name("/web/fetch"), "Web fetch");
  assert.equal(name("/email/auth"), "Email auth check");
  assert.equal(name("/crypto/news"), "Crypto news");
  assert.match(name("/tech/detect"), /^Website technology detection$/);
});
test("the prediction-market door requires a search", async () => {
  const door = doors.ENTRY_PATHS.find((d) => d.endpoint.path === "/polymarket/search");
  await assert.rejects(door.run({}, () => undefined), (e) => e.status === 400 && /q is required/.test(e.message));
});

const debtRows = [
  { record_date: "2026-11-05", tot_pub_debt_out_amt: "40556120784983.65", debt_held_public_amt: "32766722473715.61", intragov_hold_amt: "7789398311268.04", record_fiscal_year: "2027" },
  { record_date: "2026-11-04", tot_pub_debt_out_amt: "40550230047609.15", debt_held_public_amt: "32765175912225.50", intragov_hold_amt: "7785054135383.65", record_fiscal_year: "2027" },
  { record_date: "2026-10-06", tot_pub_debt_out_amt: "40374916201972.45", debt_held_public_amt: "32600000000000.00", intragov_hold_amt: "7774916201972.45", record_fiscal_year: "2027" },
  { record_date: "2025-11-04", tot_pub_debt_out_amt: "38254670682671.75", debt_held_public_amt: "30700000000000.00", intragov_hold_amt: "7554670682671.75", record_fiscal_year: "2026" },
];

test("national debt: latest record, changes over 1, 30 and 365 days, bounded history", () => {
  const out = treasury.debtSummary([...debtRows].reverse(), 2);
  assert.equal(out.date, "2026-11-05");
  assert.equal(out.fiscalYear, 2027);
  assert.equal(out.totalPublicDebtUsd, 40556120784983.65);
  assert.equal(out.change.d1.since, "2026-11-04");
  assert.equal(out.change.d1.amountUsd, 5890737374.5);
  assert.equal(out.change.d30.since, "2026-10-06");
  assert.equal(out.change.d30.percent, 0.45);
  assert.equal(out.change.d365.since, "2025-11-04");
  assert.equal(out.change.d365.percent, 6.02);
  assert.equal(out.history.length, 2);
  assert.equal(out.history[1].date, "2026-11-04");
  assert.equal(treasury.debtSummary(debtRows.slice(0, 1), 5).change.d30, null);
  assert.throws(() => treasury.debtSummary([], 5), (e) => e.status === 502);
});

const rateRows = [
  { record_date: "2026-10-31", security_type_desc: "Marketable", security_desc: "Treasury Bills", avg_interest_rate_amt: "4.014" },
  { record_date: "2026-10-31", security_type_desc: "Marketable", security_desc: "Treasury Notes", avg_interest_rate_amt: "3.399" },
  { record_date: "2026-10-31", security_type_desc: "Marketable", security_desc: "Total Marketable", avg_interest_rate_amt: "3.570" },
  { record_date: "2026-10-31", security_type_desc: "Non-marketable", security_desc: "Total Non-marketable", avg_interest_rate_amt: "3.630" },
  { record_date: "2026-10-31", security_type_desc: "Interest-bearing Debt", security_desc: "Total Interest-bearing Debt", avg_interest_rate_amt: "3.580" },
  { record_date: "2026-09-30", security_type_desc: "Marketable", security_desc: "Treasury Bills", avg_interest_rate_amt: "3.870" },
  { record_date: "2026-09-30", security_type_desc: "Marketable", security_desc: "Total Marketable", avg_interest_rate_amt: "3.518" },
  { record_date: "2026-09-30", security_type_desc: "Interest-bearing Debt", security_desc: "Total Interest-bearing Debt", avg_interest_rate_amt: "3.530" },
];

test("the Treasury tools answer from the KV snapshot and refuse, uncharged, without one", async () => {
  const debt = treasury.TREASURY.find((e) => e.endpoint.path === "/econ/national-debt");
  await assert.rejects(debt.run({}, () => undefined), (e) => e.status === 503 && e.code === "TREASURY_UNAVAILABLE");
  const kv = { get: async (key) => (key === treasury.DEBT_KEY ? { fetchedAt: "2026-11-07T08:30:00.000Z", rows: debtRows } : null) };
  const out = await debt.run({ TRIALS: kv }, (n) => ({ days: "2" })[n]);
  assert.equal(out.snapshotAt, "2026-11-07T08:30:00.000Z");
  assert.equal(out.history.length, 2);
  assert.equal(out.dataset, "Debt to the Penny");
  const rates = treasury.TREASURY.find((e) => e.endpoint.path === "/econ/treasury-rates");
  await assert.rejects(rates.run({ TRIALS: kv }, () => undefined), (e) => e.status === 503);
});

test("treasury rates: latest month, totals, history and the security filter", () => {
  const out = treasury.ratesSummary(rateRows, 12);
  assert.equal(out.month, "2026-10");
  assert.equal(out.rates.length, 5);
  assert.deepEqual(out.totals, { marketable: 3.57, nonMarketable: 3.63, interestBearingDebt: 3.58 });
  assert.equal(out.history.length, 2);
  assert.deepEqual(out.history[1], { month: "2026-09", marketable: 3.518, nonMarketable: null, interestBearingDebt: 3.53 });
  assert.deepEqual(treasury.ratesSummary(rateRows, 1, "bills").rates, [{ type: "Marketable", security: "Treasury Bills", ratePercent: 4.014 }]);
  assert.equal(treasury.ratesSummary(rateRows, 1).history.length, 1);
  assert.throws(() => treasury.ratesSummary(rateRows, 1, "gold"), (e) => e.status === 404);
  assert.throws(() => treasury.ratesSummary([], 1), (e) => e.status === 502);
});

test("round 7 doors (10 Nov 2026) carry the job in the name and the path, and answer a call with no input", async () => {
  const door = (p) => doors.ENTRY_PATHS.find((d) => d.endpoint.path === p);
  assert.equal(door("/timezone/convert").endpoint.summary.split(":")[0], "Timezone convert");
  assert.equal(door("/time/now").endpoint.summary.split(":")[0], "Current time");
  assert.equal(door("/perp/funding").endpoint.summary.split(":")[0], "Perp funding rate");
  assert.equal(doors.ENTRY_OF["/timezone/convert"], "/time");
  assert.equal(doors.ENTRY_OF["/time/now"], "/time");
  assert.equal(doors.ENTRY_OF["/perp/funding"], "/hyperliquid/market");
  for (const p of ["/timezone/convert", "/time/now", "/perp/funding"]) assert.ok(Object.values(door(p).endpoint.params).every((x) => !x.required), `${p}: a router that plans the call empty must succeed`);
  // Both time doors run the real tool: an empty call is UTC now, a conversion keeps the moment.
  const now = await door("/time/now").run({}, () => undefined);
  assert.equal(now.zone, "UTC");
  assert.ok(Math.abs(now.unixSeconds - Date.now() / 1000) < 5);
  const moved = await door("/timezone/convert").run({}, (n) => ({ zone: "Europe/Stockholm", at: "2026-03-01T09:00:00+01:00", to: "America/New_York,Asia/Tokyo" })[n]);
  assert.equal(moved.localTime, "2026-03-01T09:00:00");
  assert.deepEqual(moved.converted.map((c) => c.localTime), ["2026-03-01T03:00:00", "2026-03-01T17:00:00"]);
  assert.ok(endpoints.ACQUISITION_PATHS.has("/perp/funding"), "the funding door shares /hyperliquid/market's acquisition price");
  // The published example (the first input with an example) of the convert door is a conversion, not just "now".
  assert.deepEqual(endpoints.exampleParams(door("/timezone/convert").endpoint).map(([name]) => name), ["to"]);
});

test("round 8 doors (10 Nov 2026): the Markdown door returns Markdown unless told otherwise, and each door runs its tool", async () => {
  const door = (p) => doors.ENTRY_PATHS.find((d) => d.endpoint.path === p);
  const name = (p) => door(p).endpoint.summary.split(":")[0];
  assert.equal(name("/page/markdown"), "Web page to Markdown");
  assert.equal(name("/cve/lookup"), "CVE vulnerability lookup");
  assert.equal(name("/wiki/summary"), "Wikipedia summary");
  assert.equal(name("/market/trending"), "Trending crypto");
  assert.equal(name("/market/ohlcv"), "Crypto OHLCV");
  assert.deepEqual(["/page/markdown", "/cve/lookup", "/wiki/summary", "/market/trending", "/market/ohlcv"].map((p) => doors.ENTRY_OF[p]), ["/extract", "/cve", "/wikipedia", "/crypto/trending", "/hyperliquid/candles"]);
  // Markdown by default; a caller's own choice stands; other inputs pass through untouched.
  const md = doors.markdownInput((n) => ({ url: "https://example.com", maxChars: "900" })[n]);
  assert.equal(md("format"), "markdown");
  assert.equal(md("url"), "https://example.com");
  assert.equal(md("maxChars"), "900");
  assert.equal(doors.markdownInput((n) => ({ format: "text" })[n])("format"), "text");
  assert.equal(doors.markdownInput((n) => ({ format: " " })[n])("format"), "markdown");
  const page = door("/page/markdown").endpoint;
  assert.equal(page.params.format.example, "markdown");
  assert.equal(page.outputExample.format, "markdown");
  assert.ok(typeof page.outputExample.markdown === "string" && !("text" in page.outputExample), "the example answer is the Markdown answer");
  assert.equal(page.outputExample.url, page.params.url.example);
  // The published example call of each door is the one its tool answers: required inputs only, or none.
  assert.deepEqual(endpoints.exampleParams(door("/cve/lookup").endpoint).map(([n]) => n), ["cve"]);
  assert.deepEqual(endpoints.exampleParams(door("/wiki/summary").endpoint).map(([n]) => n), ["title"]);
  assert.deepEqual(endpoints.exampleParams(door("/market/trending").endpoint), []);
  for (const p of ["/market/trending", "/market/ohlcv", "/wiki/summary"]) assert.ok(endpoints.ACQUISITION_PATHS.has(p), `${p} shares its tool's acquisition price`);
});
test("round 9 doors (14 Nov 2026): GPT and Claude pricing preset their provider and keep a caller's own", async () => {
  const byPath = Object.fromEntries(doors.ENTRY_PATHS.map((d) => [d.endpoint.path, d]));
  for (const [path, provider, word] of [["/gpt/pricing", "openai", "gpt"], ["/claude/pricing", "anthropic", "claude"]]) {
    const d = byPath[path];
    assert.ok(d, path);
    assert.equal(doors.ENTRY_OF[path], "/llm/prices");
    assert.ok(d.endpoint.summary.toLowerCase().startsWith(`${word} pricing`), d.endpoint.summary);
    assert.equal(d.endpoint.params.provider.example, provider);
    assert.equal(d.endpoint.outputExample.models[0].provider, provider);
  }
  const preset = doors.providerInput("openai");
  assert.equal(preset(() => undefined)("provider"), "openai");
  assert.equal(preset((n) => ({ provider: " google " })[n])("provider"), "google");
  assert.equal(preset((n) => ({ q: "mini" })[n])("q"), "mini");
  // The door runs the real tool: with the model list faked, only the preset provider's models come back.
  const realFetch = globalThis.fetch, realCaches = globalThis.caches;
  delete globalThis.caches;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [
    { id: "openai/gpt-x", name: "OpenAI: GPT X", context_length: 1000, pricing: { prompt: "0.000001", completion: "0.000002" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
    { id: "anthropic/claude-x", name: "Anthropic: Claude X", context_length: 1000, pricing: { prompt: "0.000003", completion: "0.000004" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const out = await byPath["/claude/pricing"].run({}, () => undefined);
    assert.deepEqual(out.models.map((m) => m.id), ["anthropic/claude-x"]);
  } finally { globalThis.fetch = realFetch; if (realCaches) globalThis.caches = realCaches; }
});
