// The progress file of scripts/smoke-examples.mjs (`--state <file>`), and the rules of the run that restarts it
// (scripts/smoke-examples-supervised.mjs). Tested in scripts/smoke-supervised.test.mjs.
//
// 21 Nov 2026: on the release machine the local Worker runtime ends at random in the middle of the example run
// (Windows exit code 0xC0000409, shown by PowerShell as -1073740791), taking the script with it: the output stops
// after some tool with no summary line. Twice that day the operator ran the examples again by hand and resumed the
// release with -SkipSmoke. The progress file lets a restarted run continue with the tools not yet checked:
//   {"t":"start","path":"/weather"}                       written before a tool is called
//   {"t":"result","retried":false,"r":{...}}              written when its answer is in
// A "start" with no "result" after it is the tool that was in flight when the runtime ended.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** The final line of a complete run, e.g. "698/698 examples succeed; 0 fail; 0 slower than 10 s; …". */
export const SUMMARY_LINE = /^\d+\/\d+ examples succeed; \d+ fail;/m;

/** @returns {{ results: Map<string, { retried: boolean, r: object }>, inFlight: string | null }} */
export function readSmokeState(file) {
  const results = new Map();
  let inFlight = null;
  if (!file || !existsSync(file)) return { results, inFlight };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    // The process can end in the middle of a write: a half line is dropped, never guessed at.
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.t === "start" && typeof entry.path === "string") inFlight = entry.path;
    else if (entry?.t === "result" && typeof entry.r?.path === "string") {
      results.set(entry.r.path, { retried: entry.retried === true, r: entry.r });
      if (inFlight === entry.r.path) inFlight = null;
    }
  }
  return { results, inFlight };
}

// appendFileSync: the line must be on its way to the disk before the tool is called, because the process may not live
// to flush anything later.
export function markStart(file, path) { if (file) appendFileSync(file, JSON.stringify({ t: "start", path }) + "\n"); }
export function markResult(file, r, retried) { if (file) appendFileSync(file, JSON.stringify({ t: "result", retried: retried === true, r }) + "\n"); }

/**
 * Runs the examples until one run reaches its summary line, restarting a run that ended without one.
 * - `runAttempt(n)` runs one attempt and resolves to { code, sawSummary }.
 * - `readState()` reads the progress file after an attempt.
 * A run that printed its summary is final, pass or fail: a failing example is never run again from here. A run without
 * a summary is restarted at most `maxRestarts` times, and not at all once the same tool has been in flight at two
 * endings (that tool, not the machine, is then the likely cause). Resolves to { ok, code, restarts, reason }.
 */
export async function superviseSmoke({ runAttempt, readState, maxRestarts = 3, log = console.log }) {
  const endings = new Map();
  for (let attempt = 0; ; attempt++) {
    const { code, sawSummary } = await runAttempt(attempt);
    if (sawSummary) return { ok: code === 0, code: code === 0 ? 0 : (code || 1), restarts: attempt, reason: code === 0 ? "complete" : "examples failed" };
    const where = readState().inFlight ?? "(no tool in flight: start-up, or between two tools)";
    const times = (endings.get(where) ?? 0) + 1;
    endings.set(where, times);
    log(`\n[smoke] the run ended without its summary line (exit code ${describeExit(code)}) while checking ${where}`);
    if (times >= 2) {
      const reason = `the run ended twice at the same place: ${where}`;
      log(`[smoke] stopped: ${reason}. This is not a random runtime crash; look at that tool (or at the start-up error above).`);
      return { ok: false, code: 1, restarts: attempt, reason };
    }
    if (attempt >= maxRestarts) {
      const reason = `the run ended without a summary ${attempt + 1} times (${maxRestarts} restarts used)`;
      log(`[smoke] stopped: ${reason}.`);
      return { ok: false, code: 1, restarts: attempt, reason };
    }
    log(`[smoke] restart ${attempt + 1} of ${maxRestarts}: continuing with the tools not yet checked`);
  }
}

/** 3221226505 and -1073740791 are the same Windows status, 0xC0000409; print the form people search for. */
export function describeExit(code) {
  if (typeof code !== "number") return String(code);
  const unsigned = code < 0 ? code + 0x100000000 : code;
  return unsigned > 255 ? `0x${unsigned.toString(16).toUpperCase()} (${unsigned - 0x100000000})` : String(code);
}
