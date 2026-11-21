// Loaded into every test process by `npm test` (node --require ./scripts/test-quiet.cjs --test …).
//
// 21 Nov 2026: a full run printed "Error compiling schema, function code: …" 11,889 times, each followed by
// `x402: Route "GET /…" has an invalid bazaar extension: Schema validation failed: Code generation from strings
// disallowed for this context`, which made the log of a release unreadable (megabytes) and hid real failures.
// Both lines are expected and harmless: Workers forbid `new Function`, so Ajv can never compile a schema inside the
// local Worker runtime the tests start, and @x402/extensions only warns about it. Production never prints them,
// because its bundle replaces Ajv with a stand-in that fails at once (the "alias" in wrangler.jsonc,
// src/lib/ajv-unavailable.ts); the test files bundle the Worker without that alias, so the real Ajv logs its code.
//
// Only these two exact messages (and the stand-in's wording of the second) are dropped, and only when they arrive through console.error / console.log (which is
// how the local runtime's output reaches a test process). Everything else, and every test result, is untouched.
// A count is printed when the process ends, so a run still says that it happened. ADT_TEST_VERBOSE=1 shows all.
"use strict";

const ANSI = /\u001b\[[0-9;]*m/g;
const EXPECTED = [
  /^Error compiling schema, function code:/,
  /^x402: Route "[^"]*" has an invalid bazaar extension: Schema validation failed: Code generation from strings disallowed for this context\s*$/,
  // The same warning from a test that bundles the Worker with the stand-in, as production does.
  /^x402: Route "[^"]*" has an invalid bazaar extension: Schema validation failed: JSON Schema compilation is unavailable on Cloudflare Workers\s*$/,
];
/** True for the two expected lines above (one console call may carry both, one per line). */
function isExpectedNoise(args) {
  if (args.length === 0 || typeof args[0] !== "string") return false;
  const text = args.map((a) => (typeof a === "string" ? a : "")).join(" ").replace(ANSI, "").trim();
  if (!text) return false;
  return text.split("\n").every((line) => EXPECTED.some((re) => re.test(line.trim())));
}

let hidden = 0;
function install() {
  if (process.env.ADT_TEST_VERBOSE === "1" || globalThis.__adtTestQuiet) return;
  globalThis.__adtTestQuiet = true;
  for (const name of ["error", "log", "warn"]) {
    const real = console[name].bind(console);
    console[name] = (...args) => { if (isExpectedNoise(args)) { hidden++; return; } real(...args); };
  }
  process.on("exit", () => {
    if (hidden) process.stderr.write(`[test-quiet] hid ${hidden} expected "Error compiling schema" / "invalid bazaar extension" lines (Workers forbid new Function; see scripts/test-quiet.cjs, ADT_TEST_VERBOSE=1 shows them)\n`);
  });
}
install();
module.exports = { isExpectedNoise };
