// Which test files does a change touch? Prints them, or runs them with --run:
//   npm run test:changed -- origin/main            files changed since the branch left origin/main (needs git)
//   npm run test:changed -- origin/main --run      … and run those test files, one at a time
//   node scripts/test-changed.mjs --files src/lib/oauth.ts scripts/release.ps1     name the changed files yourself
//
// 21 Nov 2026: the full suite takes a long time, and three sessions ran it at once that day. This is for the loop
// while working on a change. IT IS NOT A GATE: `npm test` (the whole suite) stays the check before a release, and CI
// runs it on every pull request. The list can miss a test, because it is built from what can be read off the files:
//   - a test file that changed is on the list;
//   - a test file names the source files it bundles ("src/…", "scripts/…"), and esbuild gives everything those files
//     import, so a change deep in src/lib reaches every test that bundles something importing it;
//   - a test file that names the changed file, or its folder ("clients/releases/1.5.0/"), in its text is on the list.
// A test that builds a file name at run time is not found. A changed file that every test depends on (package.json,
// the lock file, a wrangler config, tsconfig, the test preload) cannot be narrowed: the script then says FULL and,
// with --run, runs nothing and exits 3. Exit codes: 0 listed (or the listed tests passed), 1 a listed test failed,
// 2 bad arguments or git failed, 3 the full suite is needed.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, posix } from "node:path";

const REFERENCE = /['"`](?:\.\.?\/)*((?:src|clients|scripts|examples|integrations|docs|tests|\.github)\/[\w@.\/-]+)['"`]/g;
const CODE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const NEEDS_FULL = [/^package(-lock)?\.json$/, /^tsconfig[^/]*\.json$/, /^wrangler[^/]*\.jsonc?$/, /^scripts\/test-quiet\.cjs$/, /^tests\/[^/]*(helper|setup|preflight)[^/]*$/, /^\.npmrc$/];
const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");

/** Every test file under tests/ and scripts/, as repository paths. */
export function listTestFiles(root) {
  const inDir = (dir, pattern) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => pattern.test(f)).map((f) => `${dir}/${f}`) : []);
  return [...inDir("tests", /\.test\.cjs$/), ...inDir("scripts", /\.test\.mjs$/)].sort();
}

/** What a test's text names: code files (to follow their imports) and every path or folder it mentions. */
export function referencesOf(root, testFile) {
  const text = readFileSync(join(root, testFile), "utf8");
  const named = new Set([...text.matchAll(REFERENCE)].map((m) => m[1]));
  // A test under scripts/ names its neighbours as "./x.mjs" or reads them by bare name ("release.ps1").
  if (testFile.startsWith("scripts/")) for (const m of text.matchAll(/['"`](?:\.\/)?([\w.-]+\.(?:mjs|cjs|ps1|json))['"`]/g)) if (existsSync(join(root, "scripts", m[1]))) named.add(`scripts/${m[1]}`);
  const code = new Set(); const mentions = new Set();
  for (const ref of named) {
    mentions.add(ref);
    const file = [ref, `${ref}.ts`, `${ref}.tsx`, `${ref}.mjs`, `${ref}.js`, `${ref}/index.ts`].find((c) => CODE.test(c) && existsSync(join(root, c)) && statSync(join(root, c)).isFile());
    if (file) code.add(file);
  }
  return { code, mentions };
}

/** file -> the repository files it imports, from one esbuild pass over all the named code files (packages left out). */
export async function importGraph(root, entries) {
  if (!entries.length) return new Map();
  const result = await build({
    entryPoints: entries, absWorkingDir: root, bundle: true, write: false, metafile: true, outdir: "test-changed-out", format: "esm", splitting: true,
    platform: "node", packages: "external", external: ["cloudflare:*", "node:*"], logLevel: "silent", treeShaking: false,
    loader: { ".html": "text", ".txt": "text", ".md": "text", ".svg": "text", ".css": "text", ".wasm": "binary", ".bin": "binary", ".ttf": "binary", ".png": "binary", ".sol": "text", ".xml": "text", ".csv": "text" },
  });
  const graph = new Map();
  for (const [file, info] of Object.entries(result.metafile.inputs)) graph.set(norm(file), info.imports.filter((i) => !i.external).map((i) => norm(i.path)));
  return graph;
}

const closure = (graph, starts) => {
  const seen = new Set(starts); const queue = [...starts];
  while (queue.length) for (const next of graph.get(queue.pop()) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return seen;
};

/**
 * @param {string[]} changed repository paths
 * @returns {Promise<{ tests: string[], full: string[], unmatched: string[], why: Map<string, string[]> }>}
 * `full` lists changed files that need the whole suite; `unmatched` lists changed files no test was found for.
 */
export async function testsForChange(root, changed) {
  const files = [...new Set(changed.map(norm).filter(Boolean))];
  const tests = listTestFiles(root);
  const refs = new Map(tests.map((t) => [t, referencesOf(root, t)]));
  const graph = await importGraph(root, [...new Set([...refs.values()].flatMap((r) => [...r.code]))]);
  const reach = new Map(tests.map((t) => [t, closure(graph, refs.get(t).code)]));
  const why = new Map(); const full = []; const unmatched = [];
  const add = (test, reason) => why.set(test, [...(why.get(test) ?? []), reason]);
  for (const file of files) {
    if (NEEDS_FULL.some((re) => re.test(file))) { full.push(file); continue; }
    let hits = 0;
    if (tests.includes(file)) { add(file, "changed itself"); hits++; }
    for (const test of tests) {
      if (test === file) continue;
      if (reach.get(test).has(file)) { add(test, `bundles ${file}`); hits++; continue; }
      const mentions = refs.get(test).mentions;
      const folders = file.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/") + "/").filter((f) => f.split("/").length > 2);
      if (mentions.has(file) || folders.some((f) => mentions.has(f) || mentions.has(f.slice(0, -1)))) { add(test, `names ${file}`); hits++; }
    }
    // Documentation and notes have no tests by nature; anything else without a test is worth saying.
    if (!hits && !/\.(md|txt)$/i.test(posix.basename(file))) unmatched.push(file);
  }
  return { tests: [...why.keys()].sort(), full, unmatched, why };
}

function changedSince(root, base) {
  const git = (...args) => { const r = spawnSync("git", args, { cwd: root, encoding: "utf8" }); if (r.status !== 0) throw Error(`git ${args.join(" ")}: ${(r.stderr || "").trim().split("\n")[0]}`); return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean); };
  // Committed and uncommitted changes since the branch left <base>, plus new files git does not track yet.
  return [...git("-c", "core.quotepath=off", "diff", "--name-only", "--merge-base", base), ...git("-c", "core.quotepath=off", "ls-files", "--others", "--exclude-standard")];
}

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const args = process.argv.slice(2);
  const run = args.includes("--run");
  const filesAt = args.indexOf("--files");
  const rest = args.filter((a) => a !== "--run");
  let changed;
  try {
    if (filesAt >= 0) changed = args.slice(filesAt + 1).filter((a) => !a.startsWith("--"));
    else if (rest.length === 1 && !rest[0].startsWith("--")) changed = changedSince(root, rest[0]);
    else { console.error("usage: node scripts/test-changed.mjs <base> [--run]   or   node scripts/test-changed.mjs [--run] --files <path> …"); process.exit(2); }
  } catch (err) { console.error(`test-changed: ${err.message}`); process.exit(2); }
  if (!changed.length) { console.log("test-changed: no changed files"); return; }
  let found;
  try { found = await testsForChange(root, changed); }
  catch (err) { console.log(`FULL: the import graph could not be built (${String(err.message).split("\n")[0].slice(0, 160)}); run npm test`); process.exit(3); }
  for (const test of found.tests) console.log(`${test}    # ${[...new Set(found.why.get(test))].slice(0, 3).join("; ")}`);
  if (found.unmatched.length) console.log(`# no test file was found for: ${found.unmatched.join(", ")}`);
  if (found.full.length) { console.log(`FULL: ${found.full.join(", ")} can change any test; run npm test`); process.exit(3); }
  console.log(`# ${found.tests.length} of ${listTestFiles(root).length} test files for ${changed.length} changed file(s). Not a gate: npm test stays the check before a release.`);
  if (!run || !found.tests.length) return;
  const child = spawnSync(process.execPath, ["--require", "./scripts/test-quiet.cjs", "--test", "--test-concurrency=1", ...found.tests], { cwd: root, stdio: "inherit" });
  process.exit(child.status === 0 ? 0 : 1);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
