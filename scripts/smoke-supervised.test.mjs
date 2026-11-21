// 21 Nov 2026: the example run of a release is restarted when the local runtime ends mid-run. These tests hold the
// rules: continue with the tools not yet checked, at most three restarts, stop when the same tool is in flight at two
// endings, and never report a pass that no complete run gave.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SUMMARY_LINE, describeExit, markResult, markStart, readSmokeState, superviseSmoke } from "./smoke-state.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const quiet = () => {};

test("the progress file: answers are kept, the tool in flight is known, a half-written line is dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "smoke-state-test-"));
  const file = join(dir, "progress.jsonl");
  try {
    assert.deepEqual(readSmokeState(file), { results: new Map(), inFlight: null });
    assert.deepEqual(readSmokeState(undefined), { results: new Map(), inFlight: null });
    markStart(file, "/a"); markResult(file, { path: "/a", status: 200 }, false);
    markStart(file, "/b"); markResult(file, { path: "/b", status: 502 }, false);
    markStart(file, "/c");
    let state = readSmokeState(file);
    assert.deepEqual([...state.results.keys()], ["/a", "/b"]);
    assert.equal(state.inFlight, "/c");
    // The retry of /b was in flight when the process ended: /b keeps its failure and is the tool in flight.
    writeFileSync(file, readFileSync(file, "utf8") + JSON.stringify({ t: "result", retried: false, r: { path: "/c", status: 200 } }) + "\n" + JSON.stringify({ t: "start", path: "/b" }) + "\n" + '{"t":"result","retried":true,"r":{"path":"/b","sta');
    state = readSmokeState(file);
    assert.equal(state.inFlight, "/b");
    assert.equal(state.results.get("/b").r.status, 502);
    assert.equal(state.results.get("/b").retried, false);
    assert.equal(state.results.size, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the summary line of a complete run is recognised, and nothing else", () => {
  assert.match("ok   200  4ms /dice\n\n698/698 examples succeed; 0 fail; 0 slower than 10 s; 73 AI/rendering tools skipped (staging).\n", SUMMARY_LINE);
  assert.match("696/698 examples succeed; 2 fail; 0 slower than 10 s;", SUMMARY_LINE);
  assert.doesNotMatch("ok   200  4ms /dice\nok   200  4ms /coin\n", SUMMARY_LINE);
  assert.doesNotMatch("[smoke] restart 1 of 3: continuing with the tools not yet checked", SUMMARY_LINE);
  assert.equal(describeExit(3221226505), "0xC0000409 (-1073740791)");
  assert.equal(describeExit(-1073740791), "0xC0000409 (-1073740791)");
  assert.equal(describeExit(1), "1");
});

// A scripted series of attempts: each entry is how one attempt ends.
const scripted = (attempts) => {
  let n = 0; let inFlight = null;
  return {
    runs: () => n,
    runAttempt: async () => { const a = attempts[n++]; assert.ok(a, "no attempt beyond the scripted ones"); inFlight = a.inFlight ?? null; return { code: a.code, sawSummary: a.sawSummary === true }; },
    readState: () => ({ results: new Map(), inFlight }),
  };
};
const CRASH = 3221226505;
const supervise = ({ runAttempt, readState }, log = quiet) => superviseSmoke({ runAttempt, readState, log });

test("a run that ends without a summary is restarted; the complete run's verdict is final", async () => {
  const pass = scripted([{ code: CRASH, inFlight: "/weather" }, { code: CRASH, inFlight: "/fx" }, { code: 0, sawSummary: true }]);
  assert.deepEqual(await supervise(pass), { ok: true, code: 0, restarts: 2, reason: "complete" });
  // A complete run with failing examples is a failure and is not run again.
  const fail = scripted([{ code: CRASH, inFlight: "/weather" }, { code: 1, sawSummary: true }, { code: 0, sawSummary: true }]);
  const outcome = await supervise(fail);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 1);
  assert.equal(fail.runs(), 2, "no further run after a complete, failing one");
  // Exit code 0 without a summary line is not a pass.
  const silent = scripted([{ code: 0, inFlight: "/a" }, { code: 0, inFlight: "/a" }]);
  assert.equal((await supervise(silent)).ok, false);
});

test("the same tool in flight at two endings stops the run; so do more than three restarts", async () => {
  const same = scripted([{ code: CRASH, inFlight: "/pdf/text" }, { code: CRASH, inFlight: "/fx" }, { code: CRASH, inFlight: "/pdf/text" }, { code: 0, sawSummary: true }]);
  const lines = [];
  const outcome = await supervise(same, (l) => lines.push(l));
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /ended twice at the same place: \/pdf\/text/);
  assert.equal(same.runs(), 3);
  assert.match(lines.join("\n"), /exit code 0xC0000409 \(-1073740791\)\) while checking \/pdf\/text/);
  const many = scripted([{ code: CRASH, inFlight: "/a" }, { code: CRASH, inFlight: "/b" }, { code: CRASH, inFlight: "/c" }, { code: CRASH, inFlight: "/d" }, { code: 0, sawSummary: true }]);
  const tired = await supervise(many);
  assert.equal(tired.ok, false);
  assert.equal(many.runs(), 4, "one first run and three restarts");
  // A run that cannot even start (a build error) is not retried for ever: two endings with no tool in flight stop it.
  const startup = scripted([{ code: 1 }, { code: 1 }, { code: 0, sawSummary: true }]);
  assert.equal((await supervise(startup)).ok, false);
  assert.equal(startup.runs(), 2);
});

// The wrapper itself, run against a stand-in for smoke-examples.mjs that follows a plan: which tools end the process,
// how often, and which examples fail. The stand-in resumes from the progress file by the same rules as the real script.
const standIn = `
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { markResult, markStart, readSmokeState } from ${JSON.stringify(pathToFileURL(fileURLToPath(new URL("smoke-state.mjs", import.meta.url))).href)};
const args = process.argv.slice(2);
const stateFile = args[args.indexOf("--state") + 1];
const plan = JSON.parse(process.env.STAND_IN_PLAN);
const countFile = stateFile + ".endings";
const endings = existsSync(countFile) ? JSON.parse(readFileSync(countFile, "utf8")) : {};
if (plan.neverStarts) { console.error("build failed"); process.exit(1); }
const earlier = readSmokeState(stateFile);
const called = [];
const run = (path, retried) => {
  markStart(stateFile, path);
  if ((plan.endOn?.[path] ?? 0) > (endings[path] ?? 0)) { endings[path] = (endings[path] ?? 0) + 1; writeFileSync(countFile, JSON.stringify(endings)); process.exit(plan.endCode ?? 70); }
  const r = { path, status: plan.failing?.includes(path) ? 502 : 200 };
  called.push(path);
  console.log((r.status === 200 ? "ok   " : "FAIL ") + r.status + " " + path);
  markResult(stateFile, r, retried);
  return r;
};
const results = plan.tools.map((path) => earlier.results.has(path) ? earlier.results.get(path).r : run(path, false));
if (args.includes("--retry")) for (let i = 0; i < results.length; i++) if (results[i].status !== 200 && earlier.results.get(results[i].path)?.retried !== true) results[i] = run(results[i].path, true);
const failed = results.filter((r) => r.status !== 200).length;
console.log("CALLED " + called.join(","));
console.log("\\n" + (results.length - failed) + "/" + results.length + " examples succeed; " + failed + " fail; 0 slower than 10 s; 0 AI/rendering tools skipped (staging).");
process.exit(failed ? 1 : 0);
`;
function supervised(plan, extra = ["--retry"]) {
  const dir = mkdtempSync(join(tmpdir(), "smoke-supervised-test-"));
  const script = join(dir, "stand-in.mjs");
  writeFileSync(script, standIn);
  try {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("smoke-examples-supervised.mjs", import.meta.url)), ...extra], { encoding: "utf8", timeout: 120_000, env: { ...process.env, SMOKE_EXAMPLES_SCRIPT: script, STAND_IN_PLAN: JSON.stringify(plan) } });
    return { status: run.status, out: run.stdout + run.stderr, called: [...run.stdout.matchAll(/^CALLED (.*)$/gm)].map((m) => m[1]) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const tools = ["/a", "/b", "/c", "/d", "/e"];

test("the wrapper: two runtime endings at different tools, then a pass; no tool is checked twice without need", () => {
  const run = supervised({ tools, endOn: { "/b": 1, "/d": 1 } });
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, / 0 fail;/);
  assert.match(run.out, /\[smoke\] restart 1 of 3/);
  assert.match(run.out, /\[smoke\] complete after 2 restart\(s\)/);
  assert.deepEqual(run.called, ["/d,/e"], "the last run called only what was left; /a, /b and /c came from the progress file");
  assert.equal((run.out.match(/^ok   200 \/a$/gm) ?? []).length, 1, "/a was called once in all");
  assert.equal((run.out.match(/examples succeed/g) ?? []).length, 1, "one summary, from the complete run");
});

test("the wrapper: a failing example stays a failure across a restart, and gets its one retry only", () => {
  // /b fails, the runtime ends at /d; the restarted run must still report /b as failed and exit 1.
  const run = supervised({ tools, failing: ["/b"], endOn: { "/d": 1 } });
  assert.equal(run.status, 1, run.out);
  assert.match(run.out, /4\/5 examples succeed; 1 fail;/);
  assert.ok(!/ 0 fail;/.test(run.out), "the text the release looks for is absent");
  assert.equal((run.out.match(/^FAIL 502 \/b$/gm) ?? []).length, 2, "/b ran twice: the first call and its one retry");
  // Without a restart: a plain failure is a failure, not a reason to run again.
  const plain = supervised({ tools, failing: ["/c"] });
  assert.equal(plain.status, 1);
  assert.ok(!plain.out.includes("[smoke]"), "a complete run is never restarted");
});

test("the wrapper: the same tool ending the runtime twice fails the run, as does a script that never starts", () => {
  const twice = supervised({ tools, endOn: { "/c": 5 } });
  assert.equal(twice.status, 1, twice.out);
  assert.match(twice.out, /stopped: the run ended twice at the same place: \/c/);
  assert.ok(!/examples succeed/.test(twice.out));
  const never = supervised({ tools, neverStarts: true });
  assert.equal(never.status, 1);
  assert.match(never.out, /ended twice at the same place: \(no tool in flight/);
  assert.equal(supervised({ tools }, ["--state", "x.jsonl"]).status, 2, "the wrapper owns the progress file");
});

test("the release runs the examples through the wrapper, and the script writes its progress", () => {
  const release = read("release.ps1");
  assert.match(release, /Step 'smoke:examples' \{ node scripts\/smoke-examples-supervised\.mjs --retry \} ' 0 fail;'/);
  assert.ok(!/node scripts\/smoke-examples\.mjs --retry/.test(release.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")), "not the bare script");
  const smoke = read("smoke-examples.mjs");
  assert.match(smoke, /markStart\(stateFile, e\.path\);\n  try \{\n    const res = await mf\.dispatchFetch/, "the start is written before the tool is called");
  assert.match(smoke, /markResult\(stateFile, result, retried\)/);
  assert.match(smoke, /results\.push\(earlier\.results\.has\(e\.path\) \? earlier\.results\.get\(e\.path\)\.r : await runExample\(e\)\)/);
  assert.match(smoke, /process\.exit\(failed\.length \? 1 : 0\)/, "a failed example still fails the run");
  // A run that checked nothing must not print the "0 fail" summary the release reads as a pass.
  const guard = smoke.indexOf("if (!tools.length) {");
  assert.ok(guard > 0 && guard < smoke.indexOf("for (const e of tools) results.push("), "an empty tool list stops the run before anything is counted");
  assert.match(smoke.slice(guard, guard + 200), /process\.exit\(2\)/);
});
