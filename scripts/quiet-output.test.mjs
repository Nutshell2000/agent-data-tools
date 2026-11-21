// 21 Nov 2026: a full `npm test` printed megabytes that nobody could read: a 13 MB data: URL in each stack frame of
// one failing build step, and 11,889 copies of an expected Ajv line. These tests hold the two fixes: errors of the
// reader-assets build are printed short, and only the expected lines are hidden from test output.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { shortStack } from "./short-stack.mjs";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const { isExpectedNoise } = createRequire(import.meta.url)("./test-quiet.cjs");

test("an error thrown inside a data: URL bundle is printed without the bundle", () => {
  const dir = mkdtempSync(join(tmpdir(), "short-stack-test-"));
  try {
    // A stand-in for the build: a large bundle imported through a data: URL, which throws when called.
    const script = join(dir, "build.mjs");
    writeFileSync(script, `
import { installShortStacks } from ${JSON.stringify(pathToFileURL(here("short-stack.mjs")).href)};
if (process.env.SHORT === "1") installShortStacks("stand-in build");
const padding = "// " + "x".repeat(300000) + "\\n";
const bundle = padding + "export function extract() { return inner(); }\\nfunction inner() { throw new Error('Immutable artifact changed'); }\\n";
const { extract } = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
if (process.env.REJECT === "1") Promise.reject(new Error("a rejected promise nobody awaited"));
else extract();
`);
    const run = (env) => spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
    const loud = run({});
    assert.equal(loud.status, 1);
    assert.ok(loud.stderr.length > 400_000, `without the handler the address is printed in full (${loud.stderr.length} bytes)`);
    const short = run({ SHORT: "1" });
    assert.equal(short.status, 1, "the build still fails");
    assert.equal(short.stdout, "");
    assert.ok(short.stderr.length < 2000, `short: ${short.stderr.length} bytes`);
    assert.match(short.stderr, /^stand-in build failed: Error: Immutable artifact changed\n/);
    assert.match(short.stderr, /\(2 frames inside the bundled code left out\)/);
    assert.match(short.stderr, /at .*build\.mjs:\d+:\d+/, "the frame of the script itself is kept");
    assert.ok(!/base64,/.test(short.stderr));
    const rejected = run({ SHORT: "1", REJECT: "1" });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /^stand-in build failed: Error: a rejected promise nobody awaited/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("shortStack keeps the message, clips an address inside it, and shows the cause", () => {
  const url = "data:text/javascript;base64," + "QUJD".repeat(5000);
  const error = new Error(`Cannot load ${url}`, { cause: new TypeError("inner reason") });
  error.stack = `Error: Cannot load ${url}\n    at extract (${url}:10:5)\n    at main (file:///repo/scripts/build.mjs:3:1)\n    at run (${url}:20:1)`;
  const text = shortStack(error);
  assert.ok(text.length < 1200, String(text.length));
  assert.match(text, /^Error: Cannot load data:<bundle, 20 KB>\n    at main \(file:\/\/\/repo\/scripts\/build\.mjs:3:1\)\n    \(2 frames inside the bundled code left out\)\n  caused by: TypeError: inner reason/);
  assert.equal(shortStack("plain text"), "plain text");
  assert.match(shortStack({ code: 7 }), /"code":7/);
});

test("the reader-assets build installs the short error printer before it does anything", () => {
  const build = read("build-reader-assets.mjs");
  const install = build.indexOf('installShortStacks("build-reader-assets")');
  assert.ok(install > 0, "installed");
  assert.ok(install < build.indexOf("await "), "before the first awaited step");
});

test("only the expected Ajv lines are hidden from test output", () => {
  const hidden = [
    ["Error compiling schema, function code: const schema1 = scope.schema[1];return function validate1(data){}"],
    ["Error compiling schema, function code:", "const schema1 = scope.schema[1];"],
    ["\u001b[31mError compiling schema, function code: const x = 1;\u001b[39m"],
    ['x402: Route "GET /weather" has an invalid bazaar extension: Schema validation failed: Code generation from strings disallowed for this context'],
    ['\u001b[31mx402: Route "POST /pdf/text" has an invalid bazaar extension: Schema validation failed: JSON Schema compilation is unavailable on Cloudflare Workers\u001b[39m'],
    ['Error compiling schema, function code: const a = 1;\nx402: Route "GET /fx" has an invalid bazaar extension: Schema validation failed: Code generation from strings disallowed for this context'],
  ];
  for (const args of hidden) assert.equal(isExpectedNoise(args), true, args[0].slice(0, 60));
  const shown = [
    ["Error: something else"],
    ["credits: spend failed", new Error("Exceeded allowed rows written")],
    ['x402: Route "GET /weather" has an invalid bazaar extension: Schema validation failed: data/price must be string'],
    ['x402: Route "GET /weather" has an invalid bazaar extension: missing input'],
    ["✖ a test failed\nError compiling schema, function code: x"],
    ["the log said: Error compiling schema, function code: x"],
    [new Error("Error compiling schema, function code: thrown, not logged")],
    [],
    [""],
  ];
  for (const args of shown) assert.equal(isExpectedNoise(args), false, String(args[0]).slice(0, 60));
});

test("the preload hides the lines in a process, counts them, and leaves everything else alone", () => {
  const code = `
console.error("Error compiling schema, function code: const schema1 = 1;");
console.error('x402: Route "GET /weather" has an invalid bazaar extension: Schema validation failed: Code generation from strings disallowed for this context');
console.error("a real error line");
console.log("a real log line");
process.exitCode = 3;`;
  const run = (env) => spawnSync(process.execPath, ["--require", here("test-quiet.cjs"), "-e", code], { encoding: "utf8", env: { ...process.env, ADT_TEST_VERBOSE: "", ...env } });
  const quiet = run({});
  assert.equal(quiet.status, 3, "the exit code is the process's own");
  assert.equal(quiet.stdout, "a real log line\n");
  assert.match(quiet.stderr, /^a real error line\n\[test-quiet\] hid 2 expected /);
  assert.ok(!quiet.stderr.includes("function code"));
  const verbose = run({ ADT_TEST_VERBOSE: "1" });
  assert.match(verbose.stderr, /Error compiling schema, function code: const schema1 = 1;\nx402: Route "GET \/weather"/);
  assert.ok(!verbose.stderr.includes("[test-quiet]"));
});

test("npm test loads the preload, and still runs every test file one at a time", () => {
  const scripts = JSON.parse(read("../package.json")).scripts;
  assert.equal(scripts.test, "npm run check:output-validators && node scripts/build-reader-assets.mjs && node --require ./scripts/test-quiet.cjs --test --test-concurrency=1 tests/*.test.cjs scripts/*.test.mjs");
});
