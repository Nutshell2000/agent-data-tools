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
    assert.equal(live[e.path].price, live[canonical].price, `${e.path} price must equal ${canonical}'s`);
    assert.ok(e.summary.split(":")[0].length <= 32, e.summary);
    assert.match(e.description, /(^|\. )Use (when|to|for|before|as) /, e.path);
    assert.ok(e.description.length <= 450, `${e.path} ${e.description.length}`);
    assert.ok(e.tags.length >= 5, e.path);
    // A capacity-limited tool's door is capacity-limited too (never free, never on marketplaces).
    assert.equal(capacity.CAPACITY_LIMITED.has(e.path), capacity.CAPACITY_LIMITED.has(canonical), e.path);
    assert.equal(discovery.categoryOf(e.path), discovery.categoryOf(canonical), `${e.path} category`);
  }
  // One door per intent: no two doors share a canonical tool, and none shadows a core or family path.
  const canonicals = Object.values(doors.ENTRY_OF);
  assert.equal(new Set(canonicals).size, canonicals.length);
});

test("the USDC yield door forces stablecoin pools and defaults the token to USDC", () => {
  const sent = (n) => ({ chain: "Base" })[n];
  const q = doors.usdcYieldInput(sent);
  assert.equal(q("stablecoin"), "true");
  assert.equal(q("symbol"), "USDC");
  assert.equal(q("chain"), "Base");
  assert.equal(doors.usdcYieldInput((n) => ({ symbol: "DAI" })[n])("symbol"), "DAI");
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
