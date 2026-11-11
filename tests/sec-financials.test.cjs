const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function loadTypeScript(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

// Apple's SEC company facts of 11 Nov 2026 (data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json), cut to the lines the
// tool reads and to periods ending after 1 Sep 2024. Figures checked against Apple's own reports: FY2025 revenue
// $416.161 bn, FY2024 $391.035 bn (fiscal years end in late September).
const AAPL = require("./fixtures/sec-companyfacts-aapl.json");
let financials, fiscalYearOf, SEC_FINANCIALS;
before(async () => {
  ({ financials, fiscalYearOf, SEC_FINANCIALS } = await loadTypeScript(require.resolve("../src/routes/sec-financials.ts")));
});

test("annual statements: newest fiscal year first, the restated 10-K value, the published example's figures", () => {
  const r = financials(AAPL, { period: "annual", limit: 2 });
  assert.equal(r.company, "Apple Inc.");
  assert.equal(r.cik, "0000320193");
  assert.equal(r.currency, "USD");
  assert.equal(r.count, 2);
  const [fy26, fy25] = r.periods;
  assert.deepEqual([fy26.fiscalYear, fy26.fiscalPeriod, fy26.start, fy26.end, fy26.form], [2026, "FY", "2025-09-28", "2026-09-26", "10-K"]);
  assert.equal(fy25.fiscalYear, 2025);
  assert.equal(fy25.incomeStatement.revenue, 416161000000);
  // The tool's published example is this answer: keep them identical.
  const example = SEC_FINANCIALS[0].endpoint.outputExample.periods[0];
  assert.deepEqual(fy26.incomeStatement, example.incomeStatement);
  assert.deepEqual(fy26.balanceSheet, example.balanceSheet);
  assert.deepEqual(fy26.cashFlow, example.cashFlow);
  assert.deepEqual(fy26.ratios, example.ratios);
  // Accounting identities the statements must keep.
  assert.equal(fy26.balanceSheet.totalLiabilities + fy26.balanceSheet.shareholdersEquity, fy26.balanceSheet.totalAssets);
  assert.equal(fy26.incomeStatement.revenue - fy26.incomeStatement.costOfRevenue, fy26.incomeStatement.grossProfit);
  assert.equal(fy26.cashFlow.freeCashFlow, fy26.cashFlow.operatingCashFlow - fy26.cashFlow.capitalExpenditure);
  assert.equal(fy26.ratios.revenueGrowthPct, Math.round(((478834 - 416161) / 416161) * 1000) / 10);
  assert.equal(r.concepts.revenue, "RevenueFromContractWithCustomerExcludingAssessedTax");
  assert.equal(r.sharesOutstanding.asOf, "2026-10-23");
});

test("quarters: a reported three-month value where there is one, the fourth quarter as the year minus nine months", () => {
  const r = financials(AAPL, { period: "quarterly", limit: 5 });
  assert.deepEqual(r.periods.map((p) => `${p.fiscalYear} ${p.fiscalPeriod}`), ["2026 Q4", "2026 Q3", "2026 Q2", "2026 Q1", "2025 Q4"]);
  const [q4, q3, , q1] = r.periods;
  assert.equal(q3.incomeStatement.revenue, 109417000000); // reported in the Q3 10-Q
  assert.equal(q4.incomeStatement.revenue, 478834000000 - 364357000000); // FY minus the nine-month year to date
  assert.equal(q4.incomeStatement.epsDiluted, null); // per-share figures are never differenced
  assert.equal(q3.incomeStatement.epsDiluted, 2.02);
  // Cash flow is year to date in a 10-Q: Q3 = nine months minus six months.
  assert.equal(q3.cashFlow.operatingCashFlow, 116996000000 - 82627000000);
  assert.equal(q1.start, "2025-09-28");
  assert.equal(q4.balanceSheet.totalAssets, 404548000000);
  assert.equal(q3.ratios.returnOnEquityPct, null);
  assert.ok(q3.ratios.revenueGrowthPct > 0, "growth against the same quarter a year earlier");
});

test("fiscal year names, IFRS filers and files without statements", () => {
  assert.equal(fiscalYearOf("2026-09-26"), 2026);
  assert.equal(fiscalYearOf("2026-01-25"), 2026); // NVIDIA's fiscal 2026
  assert.equal(fiscalYearOf("2026-01-03"), 2025); // a 52/53-week year that spills into January
  assert.throws(() => financials({ cik: 1, entityName: "X plc", facts: { "ifrs-full": {} } }, { period: "annual", limit: 4 }), /IFRS/);
  assert.throws(() => financials({ cik: 1, entityName: "Fund", facts: { dei: {} } }, { period: "annual", limit: 4 }), (e) => e.status === 404);
});

test("the tool refuses a call without a company and a period it does not know, before any fetch", async () => {
  const run = SEC_FINANCIALS[0].run;
  const q = (o) => (n) => o[n];
  await assert.rejects(() => run({}, q({})), (e) => e.status === 400);
  await assert.rejects(() => run({}, q({ ticker: "AAPL", period: "weekly" })), (e) => e.status === 400 && /annual or quarterly/.test(e.message));
});
