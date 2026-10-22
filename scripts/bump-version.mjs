// Moves every version and tool-count pin together, so a release never ships with one of them stale.
//   node scripts/bump-version.mjs <x.y.z>        rewrite the pins (count = ENDPOINTS.length, read like the validators build)
//   node scripts/bump-version.mjs <x.y.z> --check  exit 1 if any pin differs from <x.y.z> / the live count
// Pins: server.json version + "N agent tools" (description <= 100 chars), MCP_SERVER_VERSION (src/discovery.ts),
// tests/tool-buying.test.cjs (count + version), the count asserts in tests/families.test.cjs and
// tests/gateway-startup.test.cjs, and the "N pay-per-call tools" prefix of SERVICE_SUMMARY (src/endpoints.ts).
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+$/;

/** file -> [regex with one capture group for the value, replacement kind, expected matches] */
export const PINS = {
  "server.json": [
    [/("version":\s*")(\d+\.\d+\.\d+)(")/, "version", 1],
    [/("description":\s*")(\d+)( agent tools:)/, "count", 1],
  ],
  "src/discovery.ts": [[/(MCP_SERVER_VERSION = ")(\d+\.\d+\.\d+)(")/, "version", 1]],
  "tests/tool-buying.test.cjs": [
    [/(ENDPOINTS\.length,)(\d+)(\))/, "count", 1],
    [/(serverInfo\.version,')(\d+\.\d+\.\d+)(')/, "version", 1],
  ],
  "tests/families.test.cjs": [[/(assert\.equal\(ENDPOINTS\.length,)(\d+)(\))/, "count", 1]],
  "tests/gateway-startup.test.cjs": [
    [/(\.tools\.length, )(\d+)(\))/, "count", 1],
    [/(assert\.equal\(all\.length, )(\d+)(,)/, "count", 1],
    [/(new Set\(all\)\.size, )(\d+)(\))/, "count", 1],
  ],
  "tests/payment-delivery-runtime.test.cjs": [[/(assert\.equal\(listed\.length,)(\d+)(\))/, "count", 1]],
  "src/endpoints.ts": [[/(")(\d+)( pay-per-call tools)/, "count", 1]],
};

/** Pure: returns the rewritten texts and what changed; throws when a pin is missing or ambiguous. */
export function applyBump(files, { version, count }) {
  if (!SEMVER.test(version)) throw new Error(`version must be x.y.z, got ${version}`);
  if (!Number.isInteger(count) || count < 1) throw new Error(`count must be a positive integer, got ${count}`);
  const out = {}, changes = [];
  for (const [file, pins] of Object.entries(PINS)) {
    let text = files[file];
    if (typeof text !== "string") throw new Error(`missing file ${file}`);
    for (const [re, kind, expected] of pins) {
      const matches = text.match(new RegExp(re.source, "g")) ?? [];
      if (matches.length !== expected) throw new Error(`${file}: expected ${expected} match(es) for ${re}, found ${matches.length}`);
      const value = kind === "version" ? version : String(count);
      text = text.replace(re, (_m, a, old, b) => { if (old !== value) changes.push(`${file}: ${kind} ${old} -> ${value}`); return `${a}${value}${b}`; });
    }
    out[file] = text;
  }
  const description = /"description":\s*"([^"]*)"/.exec(out["server.json"])?.[1] ?? "";
  if (description.length > 100) throw new Error(`server.json description is ${description.length} chars; the MCP registry allows 100`);
  return { files: out, changes };
}

/** What the pins say now: the version from server.json and the count from the first count pin. */
export function currentPins(files) {
  const version = PINS["server.json"][0][0].exec(files["server.json"])?.[2];
  const count = Number(PINS["tests/families.test.cjs"][0][0].exec(files["tests/families.test.cjs"])?.[2]);
  return { version, count };
}

async function liveCount() {
  const built = await build({ entryPoints: ["src/endpoints.ts"], bundle: true, platform: "node", format: "esm", write: false });
  const { ENDPOINTS } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
  return ENDPOINTS.length;
}

async function main() {
  const args = process.argv.slice(2);
  const version = args[0];
  const countAt = args.indexOf("--count");
  const flag = args.slice(1).find((a) => a !== "--count" && a !== args[countAt + 1]);
  if (!version || (flag && flag !== "--check") || (countAt > 0 && !/^\d+$/.test(args[countAt + 1] ?? ""))) throw new Error("Usage: node scripts/bump-version.mjs <x.y.z> [--check] [--count N]");
  const files = Object.fromEntries(await Promise.all(Object.keys(PINS).map(async (f) => [f, await readFile(f, "utf8")])));
  // --count sets the count pins to a given number instead of the catalog's (release.ps1 uses it to match main's pins
  // before merging); without it the count is read from ENDPOINTS.
  const count = countAt > 0 ? Number(args[countAt + 1]) : await liveCount();
  const { files: next, changes } = applyBump(files, { version, count });
  if (flag === "--check") {
    if (changes.length) throw new Error(`pins out of date:\n  ${changes.join("\n  ")}`);
    console.log(`pins match ${version} and ${count} tools`);
    return;
  }
  for (const [file, text] of Object.entries(next)) if (text !== files[file]) await writeFile(file, text);
  console.log(changes.length ? changes.join("\n") : `pins already at ${version} / ${count} tools`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
