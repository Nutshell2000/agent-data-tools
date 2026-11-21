// 21 Nov 2026: the reliability step of the release warned on every release of the day. These tests hold the reading of
// /status that tells an old, recovered weakness from one that is still there, on the figures of that day.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { reliabilityReport } from "./reliability-report.mjs";

const tool = (path, served, serverErrors, recent, reason) => ({
  path, served, serverErrors, buyerErrors: 0, successRate: Math.round((served / (served + serverErrors)) * 1000) / 1000,
  ...(recent ? { recent: { days: 3, served: recent[0], serverErrors: recent[1], successRate: recent[0] + recent[1] ? recent[0] / (recent[0] + recent[1]) : 1 } } : {}),
  topFailures: reason ? [{ reason: "422 a caller mistake", count: 9 }, { reason, count: serverErrors }] : [],
});
// The five tools the release logs of 21 Nov 2026 named, with the figures /status gave for them that day.
const thatDay = {
  windowDays: 7, served: 5263, serverErrors: 18, successRate: 0.997, recent: { days: 3, served: 2056, serverErrors: 4, successRate: 0.998 },
  tools: [
    tool("/extract", 76, 0, [28, 0]),
    tool("/btc-fees", 4, 2, [0, 2], "502 the Bitcoin data source did not respond"),
    tool("/arb/token-transfers", 5, 4, [3, 0], "502 the network's public nodes could not scan that range; try fewer blocks"),
    tool("/wallet/related", 5, 2, [3, 0], "502 the network's public nodes could not scan that range; try fewer blocks"),
    tool("/no/company", 7, 1, [3, 0], "502 the Norwegian register did not answer in time; try again, nothing was charged"),
    tool("/fr/company", 8, 2, [6, 0], "503 the French company register is busy; try again in a few seconds, nothing was charged"),
    tool("/rarely-called", 1, 3, [0, 3], "502 too few calls to judge"),
  ],
};

test("a tool that is still failing is named with its reason and exits 1; recovered tools are listed apart", () => {
  const report = reliabilityReport(thatDay);
  assert.equal(report.exitCode, 1);
  assert.deepEqual(report.failing, ["/btc-fees"]);
  assert.deepEqual(report.recovered, ["/arb/token-transfers", "/wallet/related", "/fr/company", "/no/company"]);
  assert.match(report.line, /^reliability 7d 99\.7% served=5263 errors=18; under 90% and still failing: \/btc-fees 67% \(4\/6; last 3 days 0\/2; 502 the Bitcoin data source did not respond x2\)/);
  assert.match(report.line, /; under 90% over the window but no error in the last 3 days: \/arb\/token-transfers 56% \(5\/9; 502 the network's public nodes/);
  assert.ok(!report.line.includes("/rarely-called"), "under 5 calls is not judged, as before");
  assert.ok(!report.line.includes("a caller mistake"), "only a server error is given as the reason");
});

test("only recovered tools: every one is still printed, and the step no longer warns", () => {
  const report = reliabilityReport({ ...thatDay, tools: thatDay.tools.filter((t) => t.path !== "/btc-fees") });
  assert.equal(report.exitCode, 0);
  assert.match(report.line, /no error in the last 3 days: \/arb\/token-transfers .*\/wallet\/related .*\/fr\/company .*\/no\/company/);
  assert.ok(!report.line.includes("still failing"));
});

test("nothing is called recovered without proof", () => {
  // No call at all in the newest days, or a report without the `recent` figures: still a finding.
  const quiet = reliabilityReport({ ...thatDay, tools: [tool("/quiet", 5, 4, [0, 0], "502 down")] });
  assert.equal(quiet.exitCode, 1);
  assert.deepEqual(quiet.failing, ["/quiet"]);
  const old = reliabilityReport({ ...thatDay, tools: [tool("/old-shape", 5, 4, undefined, "502 down")] });
  assert.equal(old.exitCode, 1);
  assert.match(old.line, /still failing: \/old-shape 56% \(5\/9; 502 down x4\)/);
  // One fresh error among fresh successes is still failing.
  assert.equal(reliabilityReport({ ...thatDay, tools: [tool("/flaky", 20, 5, [9, 1], "502 down")] }).exitCode, 1);
});

test("a clean report exits 0, an unreadable one exits 2", () => {
  const clean = reliabilityReport({ ...thatDay, tools: [tool("/extract", 76, 0, [28, 0]), tool("/ok", 95, 5, [10, 1])] });
  assert.equal(clean.exitCode, 0);
  assert.match(clean.line, /; no tool under 90%$/);
  for (const bad of [null, {}, { tools: [] }, { successRate: 1 }, "<html>"]) assert.equal(reliabilityReport(bad).exitCode, 2);
});

test("the command: exit 1 for a finding, 2 when /status cannot be read", async () => {
  // spawnSync would block this process, and the server below with it, so the child runs asynchronously.
  const { spawn } = await import("node:child_process");
  const run = (origin) => new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("reliability-line.mjs", import.meta.url)), origin], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
    child.on("close", (status) => resolve({ status, out }));
  });
  let answer = () => [200, JSON.stringify(thatDay)];
  const server = createServer((req, res) => { const [code, body] = answer(req); res.writeHead(code, { "content-type": "application/json" }); res.end(body); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const finding = await run(origin);
    assert.equal(finding.status, 1);
    assert.match(finding.out, /still failing: \/btc-fees/);
    answer = () => [503, "busy"];
    const down = await run(origin);
    assert.equal(down.status, 2);
    assert.match(down.out, /reliability: \/status HTTP 503/);
    answer = () => [200, "<html>not json</html>"];
    const html = await run(origin);
    assert.equal(html.status, 2);
    assert.match(html.out, /could not be read/);
    assert.ok(!/\n\s+at /.test(html.out), "no stack trace for an unreadable report");
  } finally { server.close(); }
});
