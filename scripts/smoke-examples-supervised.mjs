// Runs scripts/smoke-examples.mjs and restarts it when the local Worker runtime ends in the middle of the run:
//   node scripts/smoke-examples-supervised.mjs [the same arguments as smoke-examples.mjs, e.g. --retry]
// 21 Nov 2026: the release ran `node scripts/smoke-examples.mjs --retry` directly, and a runtime crash on the release
// machine (exit code 0xC0000409, no summary line) stopped two releases that day. This wrapper does what the operator did
// by hand: it runs the examples again, continuing with the tools not yet checked (a progress file, `--state`), at
// most three times, and gives up at once when the same tool was in flight at two endings.
// It never turns a failing example into a pass: only a run that printed its own summary line is final, its exit code
// is passed on unchanged, and an example that failed (and failed its one `--retry`) stays failed across restarts.
// The rules are in scripts/smoke-state.mjs (superviseSmoke).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUMMARY_LINE, readSmokeState, superviseSmoke } from "./smoke-state.mjs";

const passOn = process.argv.slice(2);
if (passOn.includes("--state")) { console.error("smoke-examples-supervised.mjs keeps its own progress file; do not pass --state"); process.exit(2); }
// SMOKE_EXAMPLES_SCRIPT is for the test of this wrapper, which runs it against a stand-in script.
const script = process.env.SMOKE_EXAMPLES_SCRIPT || fileURLToPath(new URL("smoke-examples.mjs", import.meta.url));
// A fresh progress file for every supervised run, in a temporary folder: progress from another tree or another day
// must never count as "already checked".
const dir = mkdtempSync(join(tmpdir(), "smoke-examples-"));
const stateFile = join(dir, "progress.jsonl");

function runAttempt() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...passOn, "--state", stateFile], { stdio: ["ignore", "pipe", "inherit"] });
    let text = "";
    child.stdout.on("data", (chunk) => { process.stdout.write(chunk); text = (text + chunk).slice(-4000); });
    child.on("error", (err) => { console.error(`[smoke] could not start the example run: ${err.message}`); resolve({ code: 1, sawSummary: false }); });
    // A process ended by a signal has no exit code; that is an ending without a verdict too.
    child.on("close", (code, signal) => resolve({ code: code ?? `signal ${signal}`, sawSummary: SUMMARY_LINE.test(text) }));
  });
}

const outcome = await superviseSmoke({ runAttempt, readState: () => readSmokeState(stateFile) });
try { rmSync(dir, { recursive: true, force: true }); } catch { /* a leftover temporary file is harmless */ }
if (outcome.restarts && outcome.reason === "complete") console.log(`[smoke] complete after ${outcome.restarts} restart(s) of the local runtime`);
// A run ended by a signal after its summary has no numeric code; it still must not count as a pass.
process.exit(outcome.ok ? 0 : (typeof outcome.code === 'number' && outcome.code !== 0 ? outcome.code : 1));
