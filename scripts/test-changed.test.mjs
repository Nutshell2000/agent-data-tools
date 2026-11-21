// 21 Nov 2026: `npm run test:changed` narrows a change to the test files it touches, for the loop while working.
// These tests hold its rules on a small made-up tree, and on this repository for the cases the release tooling needs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listTestFiles, testsForChange } from "./test-changed.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));

test("a made-up tree: imports are followed, a named file or folder counts, a shared file needs the full suite", async () => {
  const root = mkdtempSync(join(tmpdir(), "test-changed-test-"));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  try {
    put("src/index.ts", 'import { a } from "./lib/a"; import page from "./page.html"; export default { a, page };');
    put("src/lib/a.ts", 'import { b } from "./b"; import { z } from "zod"; export const a = b + String(z);');
    put("src/lib/b.ts", "export const b = 1;");
    put("src/lib/alone.ts", "export const alone = 1;");
    put("src/lib/orphan.ts", "export const orphan = 1;");
    put("src/page.html", "<p>page</p>");
    put("clients/releases/1.0.0/client.mjs", "export {};");
    put("tests/worker.test.cjs", "build({ entryPoints: ['src/index.ts'] });");
    put("tests/alone.test.cjs", "load('src/lib/alone.ts'); readFileSync(new URL('../clients/releases/1.0.0/', base));");
    put("tests/stdin.test.cjs", "build({ stdin: { contents: 'export { b } from \"./src/lib/b\";' } });");
    put("tests/none.test.cjs", "assert.equal(1, 1);");
    put("scripts/tool.mjs", "export const tool = 1;");
    put("scripts/release.ps1", "# script");
    put("scripts/tool.test.mjs", 'import { tool } from "./tool.mjs"; const text = read("release.ps1");');
    assert.deepEqual(listTestFiles(root), ["scripts/tool.test.mjs", "tests/alone.test.cjs", "tests/none.test.cjs", "tests/stdin.test.cjs", "tests/worker.test.cjs"]);
    const of = async (...files) => { const r = await testsForChange(root, files); return { tests: r.tests, full: r.full, unmatched: r.unmatched }; };
    // A file two imports away from the bundled entry reaches that test, and the test that names it without ".ts".
    assert.deepEqual(await of("src/lib/b.ts"), { tests: ["tests/stdin.test.cjs", "tests/worker.test.cjs"], full: [], unmatched: [] });
    assert.deepEqual((await of("src/lib/a.ts")).tests, ["tests/worker.test.cjs"]);
    assert.deepEqual((await of("src/page.html")).tests, ["tests/worker.test.cjs"], "a non-code import is followed too");
    assert.deepEqual((await of("src\\lib\\alone.ts")).tests, ["tests/alone.test.cjs"], "a Windows path is understood");
    // A changed test file is on the list; a file in a folder the test names is too.
    assert.deepEqual((await of("tests/none.test.cjs")).tests, ["tests/none.test.cjs"]);
    assert.deepEqual((await of("clients/releases/1.0.0/client.mjs")).tests, ["tests/alone.test.cjs"]);
    // A script test finds its neighbours by import and by bare name.
    assert.deepEqual((await of("scripts/tool.mjs")).tests, ["scripts/tool.test.mjs"]);
    assert.deepEqual((await of("scripts/release.ps1")).tests, ["scripts/tool.test.mjs"]);
    // No test: said, not hidden. Notes are not reported.
    assert.deepEqual(await of("src/lib/orphan.ts", "docs/notes.md"), { tests: [], full: [], unmatched: ["src/lib/orphan.ts"] });
    // A file every test depends on cannot be narrowed.
    for (const shared of ["package.json", "package-lock.json", "wrangler.jsonc", "wrangler.staging.jsonc", "tsconfig.json", "scripts/test-quiet.cjs"]) assert.deepEqual((await of(shared, "src/lib/b.ts")).full, [shared]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("this repository: the release tooling's own files map to their tests", async () => {
  const found = await testsForChange(repo, ["scripts/release.ps1", ".github/workflows/mcp-contract.yml", "scripts/smoke-state.mjs", "scripts/reliability-report.mjs", "scripts/short-stack.mjs", "tests/chatgpt-mcp.test.cjs"]);
  for (const wanted of ["scripts/release-safety.test.mjs", "scripts/smoke-supervised.test.mjs", "scripts/reliability-line.test.mjs", "scripts/quiet-output.test.mjs", "tests/chatgpt-mcp.test.cjs"]) assert.ok(found.tests.includes(wanted), `${wanted} is listed (${found.tests.join(", ")})`);
  assert.deepEqual(found.full, []);
  assert.ok(found.tests.length < 20, `a tooling change does not pull in the Worker's tests (${found.tests.length})`);
  // A source file of the Worker reaches the tests that bundle the whole Worker.
  const worker = await testsForChange(repo, ["src/lib/oauth.ts"]);
  assert.ok(worker.tests.includes("tests/chatgpt-mcp.test.cjs"));
  assert.ok(worker.tests.length < listTestFiles(repo).length, "but not every test");
});

test("the command prints the list, refuses to narrow a shared file, and is wired into package.json", () => {
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("test-changed.mjs", import.meta.url)), ...args], { encoding: "utf8", timeout: 120_000 });
  const listed = run("--files", "scripts/reliability-report.mjs");
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^scripts\/reliability-line\.test\.mjs {4}# bundles scripts\/reliability-report\.mjs$/m);
  assert.match(listed.stdout, /Not a gate: npm test stays the check before a release\./);
  const full = run("--run", "--files", "package.json");
  assert.equal(full.status, 3);
  assert.match(full.stdout, /^FULL: package\.json can change any test; run npm test$/m);
  assert.equal(run().status, 2);
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
  assert.equal(scripts["test:changed"], "node scripts/test-changed.mjs");
  assert.match(scripts.test, /tests\/\*\.test\.cjs scripts\/\*\.test\.mjs/, "the full suite is still every test file");
  assert.ok(!/test-changed/.test(readFileSync(new URL("release.ps1", import.meta.url), "utf8")), "the release never uses the narrowed list");
  assert.ok(!/test:changed|test-changed/.test(readFileSync(new URL("../.github/workflows/mcp-contract.yml", import.meta.url), "utf8")), "nor does CI");
});
