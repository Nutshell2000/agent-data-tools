// The payments report (scripts/reconcile-bazaar.mjs) on saved report bodies: per-route arithmetic, the owner's own
// wallets kept apart, and the "5 calls on 2 days" rule. Fixtures: tests/fixtures/reconcile-bazaar (invented figures).
// The owned wallet used below is read from the Worker's own list, so no real address is typed in this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, fetchReports, ownWallets, renderText, walletReport } from "./reconcile-bazaar.mjs";

const SCRIPT = fileURLToPath(new URL("./reconcile-bazaar.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../tests/fixtures/reconcile-bazaar/", import.meta.url));
const load = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
const bodies = () => ({ revenue: load("revenue.json"), metrics: load("metrics.json"), callers: load("metrics-callers.json"), status: load("status.json") });

// Invented payers. REPEAT is written in two letter cases on purpose: it is one wallet.
const REPEAT = `0x${"a1".repeat(20)}`, ONE_DAY = `0x${"b2".repeat(20)}`, FEW_CALLS = `0x${"c3".repeat(20)}`;
const PAYS_ITSELF = `0x${"d4".repeat(20)}`, FLAGGED = `0x${"e5".repeat(20)}`, SELLER = `0x${"f6".repeat(20)}`;
const OWNED = [...ownWallets().keys()].find((a) => a.startsWith("0x"));
const pay = (payer, day, pathname = "/weather", extra = {}) => ({ payer, recordedAt: `${day}T10:00:00.000Z`, amountAtomic: "10000", path: pathname, recipient: SELLER, ...extra });
const rows = () => [
  // 5 calls on 2 days: meets the rule.
  pay(REPEAT, "2026-11-01"), pay(REPEAT.toUpperCase().replace("0X", "0x"), "2026-11-01"), pay(REPEAT, "2026-11-01"), pay(REPEAT, "2026-11-02"), pay(REPEAT, "2026-11-02", "/price/token"),
  // 6 calls, all on one day: does not.
  ...Array.from({ length: 6 }, () => pay(ONE_DAY, "2026-11-02")),
  // 4 calls on 3 days: does not.
  pay(FEW_CALLS, "2026-11-01"), pay(FEW_CALLS, "2026-11-02"), pay(FEW_CALLS, "2026-11-03"), pay(FEW_CALLS, "2026-11-03"),
  // The owner's wallets: enough calls and days to meet the numbers, and still never "outside".
  ...Array.from({ length: 7 }, (_, i) => pay(OWNED, i < 4 ? "2026-11-01" : "2026-11-03", "/time")),
  ...Array.from({ length: 5 }, (_, i) => pay(PAYS_ITSELF, i < 3 ? "2026-11-01" : "2026-11-02", "/time", { recipient: PAYS_ITSELF })),
  ...Array.from({ length: 5 }, (_, i) => pay(FLAGGED, i < 3 ? "2026-11-01" : "2026-11-02", "/time", { selfPayment: true })),
  { recordedAt: "2026-11-01T10:00:00.000Z", amountAtomic: "10000" }, // no payer: skipped, and said so
];

test("the owned wallets come from the Worker's own files", () => {
  const own = ownWallets();
  const ledger = readFileSync(new URL("../src/lib/settlement-ledger.ts", import.meta.url), "utf8").toLowerCase();
  const declared = [...own].filter(([, where]) => where === "OWNED_WALLETS").map(([address]) => address);
  assert.ok(declared.length >= 3, "every OWNED_WALLETS entry is read");
  for (const address of declared) assert.ok(ledger.includes(address), address);
  assert.equal([...ledger.match(/const owned_wallets = new set\(\[([\s\S]*?)\]\)/)[1].matchAll(/"0x[0-9a-f]{40}"/g)].length, declared.length);
  const payouts = [...own.values()].filter((where) => where.startsWith("payout wallet"));
  assert.ok(payouts.some((where) => where.includes("PREVIOUS_PAY_TO")) && payouts.some((where) => where.includes("(PAY_TO)")), "current and earlier payout wallets");
});

test("per-route arithmetic: every column is a count from the reports or a difference of two", () => {
  const report = buildReport(bodies());
  assert.deepEqual(report.window, { from: "2026-11-01", to: "2026-11-03", days: 3, requestedDays: null });
  const by = Object.fromEntries(report.routes.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(by).sort(), ["/price/token", "/time", "/weather"], "stages that are not payments (quote, visit, free_exhausted_by) add no route");

  const weather = by["/weather"];
  assert.deepEqual([weather.attempts, weather.verified, weather.settled, weather.completed, weather.executionFailed], [10, 8, 7, 7, 1]);
  assert.deepEqual(weather.refusalStages, { verification_failed: 1, refused_format: 1 });
  assert.deepEqual(weather.refused402, { v2: 1, v1: 1, mpp: 0 });
  assert.equal(weather.lost, 3, "attempts - settled");
  assert.deepEqual([weather.noVerifyOutcome, weather.verifiedNoSettleOutcome, weather.settledNotCompleted], [0, 0, 0]);
  assert.deepEqual([weather.outsideSettled, weather.outsideUsd, weather.ownOrUnledgered], [5, "0.05", 2]);
  assert.deepEqual(weather.status.paymentRefusals, [{ reason: "402 insufficient_funds: contract call failed", count: 1 }]);
  assert.deepEqual(weather.status.paidInputRefusals.map((f) => f.reason), ["400 send city (for example city=London) or lat and lon [sent location,units]"], "only the failures of paying callers, which end in [sent …]");

  const token = by["/price/token"];
  assert.deepEqual([token.attempts, token.attemptsMcp, token.verified, token.settled, token.completed], [5, 2, 5, 4, 3], "http and mcp are added");
  assert.equal(token.lost, 1);
  assert.equal(token.noVerifyOutcome, -1, "a failed settlement answered 402 is marked refused_format too");
  assert.equal(token.verifiedNoSettleOutcome, 0);
  assert.equal(token.settledNotCompleted, 1);
  assert.equal(token.metricsPaid, 4);
  assert.deepEqual([token.outsideSettled, token.outsideUsd, token.ownOrUnledgered], [3, "0.03", 1]);

  assert.deepEqual([by["/time"].lost, by["/time"].outsideSettled, by["/time"].ownOrUnledgered], [0, 0, 2], "a route only the owner's wallets paid has no outside settlement");

  const t = report.totals;
  assert.deepEqual([t.attempts, t.attemptsMcp, t.verified, t.settled, t.completed, t.executionFailed, t.lost], [17, 2, 15, 13, 12, 1, 4]);
  assert.deepEqual(t.refused402, { v2: 3, v1: 1, mpp: 0 });
  assert.deepEqual(t.refusalStages, { refused_format: 2, verification_failed: 1, settlement_failed: 1 });
  for (const column of ["attempts", "verified", "settled", "completed", "lost"]) assert.equal(t[column], report.routes.reduce((n, r) => n + r[column], 0), column);
  // Settled in the funnel = outside wallets + the owner's own + nothing left over.
  assert.deepEqual(report.ledger, { sinceUtc: "2026-11-01", outsideSettlements: 8, outsideUsd: "0.08", selfPayments: 5, funnelSettled: 13, unaccounted: 0,
    payerActivity: { distinctExternalWallets: 3, returningOnAnotherUtcDay: 2, repeatPayerToolPairs: 1 } });
  assert.equal(report.routes.reduce((n, r) => n + r.ownOrUnledgered, 0), report.ledger.selfPayments);
  assert.deepEqual(report.metricsPaid, { calls: 13, usd: "0.114" });
  assert.deepEqual(report.software, [{ family: "node", paid: 8, v2: 3, v1: 0, mpp: 0 }, { family: "python-requests", paid: 1, v2: 0, v1: 1, mpp: 0 }]);
  assert.equal(report.wallets, null, "no per-payment rows, no wallet figures");
});

test("a shorter window keeps the per-day columns and prints the 30-day ledger columns as n/a", () => {
  const report = buildReport(bodies(), { days: 1 });
  assert.deepEqual(report.window, { from: "2026-11-03", to: "2026-11-03", days: 1, requestedDays: 1 });
  const by = Object.fromEntries(report.routes.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(by).sort(), ["/price/token", "/time"]);
  assert.deepEqual([by["/price/token"].attempts, by["/price/token"].settled, by["/price/token"].outsideSettled, by["/price/token"].ownOrUnledgered], [2, 2, null, null]);
  assert.equal(report.ledger, null);
  const text = renderText(report, { allRoutes: true });
  assert.match(text, /\* n\/a \(30-day ledger total\)/);
  assert.match(text, /outside and own settlements: n\/a/);
});

test("a missing report body gives n/a, never a number", () => {
  const { metrics, status, ...rest } = bodies();
  const report = buildReport(rest);
  assert.equal(report.routes[0].refused402, null);
  assert.equal(report.routes[0].status, null);
  assert.equal(report.totals.refused402, null);
  const text = renderText(report);
  assert.match(text, /Not available: \/metrics, \/status\./);
  assert.match(text, /402 by protocol: n\/a \(needs \/metrics\)/);
  assert.match(text, /n\/a \(needs \/status\)/);
  assert.match(text, /Own wallets[^\n]*\n  n\/a \(needs --settlements/);
  assert.match(renderText(buildReport({})), /Per-route funnel: n\/a \(needs \/revenue\)/);
});

test("own wallets are tagged and kept out of the outside figures; 5 calls on 2 UTC days is the rule", () => {
  const wallets = buildReport({ ...bodies(), settlements: rows() }).wallets;
  assert.equal(wallets.skippedRows, 1);
  assert.deepEqual(Object.fromEntries(wallets.own.map((w) => [w.wallet, w.own])), { [OWNED]: "OWNED_WALLETS", [PAYS_ITSELF]: "pays itself", [FLAGGED]: "row says selfPayment" });
  assert.deepEqual(wallets.ownTotals, { wallets: 3, calls: 17 });
  assert.deepEqual(wallets.outside.map((w) => w.wallet), [ONE_DAY, REPEAT, FEW_CALLS], "most calls first");
  assert.deepEqual(wallets.outsideTotals, { wallets: 3, calls: 15 });
  assert.deepEqual(wallets.repeatOutside, [{ wallet: REPEAT, own: null, calls: 5, days: 2, usd: "0.05", routes: { "/weather": 4, "/price/token": 1 } }]);
  // The boundaries: one call fewer, or the same calls on one day, and the wallet is not listed.
  const repeatRows = rows().filter((r) => r.payer?.toLowerCase() === REPEAT);
  assert.equal(walletReport(repeatRows.slice(0, 4), ownWallets()).repeatOutside.length, 0, "4 calls on 2 days");
  assert.equal(walletReport(repeatRows.map((r) => ({ ...r, recordedAt: "2026-11-01T23:59:59.000Z" })), ownWallets()).repeatOutside.length, 0, "5 calls on 1 day");
  assert.equal(walletReport([...repeatRows.slice(0, 4), { ...repeatRows[0], recordedAt: "2026-11-02T00:00:00.000Z" }], ownWallets()).repeatOutside.length, 1, "midnight UTC starts a new day");
  // An owned wallet with the same activity is never an outside wallet.
  assert.equal(walletReport(repeatRows.map((r) => ({ ...r, payer: OWNED.toUpperCase().replace("0X", "0x") })), ownWallets()).repeatOutside.length, 0);
  // --days narrows the rows to the window of the reports.
  assert.equal(buildReport({ ...bodies(), settlements: rows() }, { days: 1 }).wallets.repeatOutside.length, 0);
});

test("the command runs offline from a directory of saved bodies and writes the same report as JSON", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reconcile-bazaar-"));
  cpSync(FIXTURES, dir, { recursive: true });
  const run = (...args) => execFileSync(process.execPath, [SCRIPT, "--from-files", dir, ...args], { encoding: "utf8", env: {} });
  const without = run();
  assert.match(without, /^\/weather +10 +1 +1 +0 +8 +7 +7 +1 +3 +5 +0\.05 +2$/m);
  assert.match(without, /^TOTAL \(every route\) +17 +3 +1 +0 +15 +13 +12 +1 +4 +8 +0\.08 +5$/m);
  assert.match(without, /settled 13 = outside wallets 8 \(\$0\.08\) \+ own wallets 5 \(self-payments, not income\) \+ unaccounted 0/);
  assert.match(without, /\(1 more routes lost nothing/);
  assert.match(without, /5 or more paid calls on 2 or more distinct UTC days\n  n\/a \(needs --settlements/);

  writeFileSync(path.join(dir, "settlements.json"), JSON.stringify(rows()));
  const out = path.join(dir, "out.json");
  const text = run("--json", out, "--all-routes");
  assert.match(text, /^\/time +2 /m);
  const [ownPart, outsidePart] = text.split("Outside wallets with 5 or more paid calls").map((part, i) => (i ? part : part.split("Own wallets")[1]));
  for (const wallet of [OWNED, PAYS_ITSELF, FLAGGED]) { assert.ok(ownPart.includes(wallet), "listed as own"); assert.ok(!outsidePart.includes(wallet), "never listed as outside"); }
  assert.match(outsidePart, /outside wallets in these rows: 3 with 15 paid calls; 1 meet the rule/);
  assert.ok(outsidePart.includes(`${REPEAT}     2      5  0.05  /weather 4, /price/token 1`));
  assert.ok(!outsidePart.includes(ONE_DAY) && !outsidePart.includes(FEW_CALLS));
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), JSON.parse(JSON.stringify(buildReport({ ...bodies(), settlements: rows() }))));
  assert.throws(() => run("--pay"), /unknown or incomplete option --pay/);
});

test("live mode is four plain GETs: the token goes to /revenue only, and no payment header is ever sent", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(String(url).endsWith("/status") ? "down" : "{}", { status: String(url).endsWith("/status") ? 503 : 200 }); };
  try {
    const { bodies: got, problems } = await fetchReports("https://example.test", "secret-token");
    assert.deepEqual(calls.map((c) => c.url), ["https://example.test/revenue", "https://example.test/metrics", "https://example.test/metrics/callers", "https://example.test/status"]);
    for (const { url, init } of calls) {
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      assert.deepEqual(Object.keys(init.headers).sort(), url.endsWith("/revenue") ? ["accept", "authorization", "user-agent"] : ["accept", "user-agent"]);
    }
    assert.equal(calls[0].init.headers.authorization, "Bearer secret-token");
    assert.equal(got.status, null, "a report that did not answer 200 is missing, not zero");
    assert.deepEqual(problems, ["/status: HTTP 503"]);
    await assert.rejects(fetchReports("http://example.test", "secret-token"), /only sent over https/);
  } finally { globalThis.fetch = realFetch; }
  const code = readFileSync(SCRIPT, "utf8").split("\n").filter((line) => !line.startsWith("//")).join("\n");
  assert.doesNotMatch(code, /process\.env|payment-signature|x-payment|method: "POST"/i, "no environment, no payment header, no POST");
});
