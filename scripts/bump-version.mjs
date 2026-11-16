// Moves every version and tool-count pin together, so a release never ships with one of them stale.
//   node scripts/bump-version.mjs <x.y.z>        rewrite the pins (count = ENDPOINTS.length, read like the validators build)
//   node scripts/bump-version.mjs <x.y.z> --check  exit 1 if any pin differs from <x.y.z> / the live count
// Pins: server.json version + "N agent tools" (description <= 100 chars), MCP_SERVER_VERSION (src/discovery.ts),
// tests/tool-buying.test.cjs (count + version), the count asserts in tests/families.test.cjs and
// tests/gateway-startup.test.cjs, and the tool counts README.md states.
// Three counts (16 Nov 2026): "count" is ENDPOINTS.length, every paid path; "toolCount" is TOOL_COUNT (src/endpoints.ts),
// the tools a caller can call with entry paths left out, which is the number every public text states; "mcpCount" is the
// /mcp/all list. SERVICE_SUMMARY reads TOOL_COUNT itself and is no longer a pin.
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+$/;

/** file -> [regex with one capture group for the value, replacement kind, expected matches] */
export const PINS = {
  "server.json": [
    // The top-level version only (not one indented four spaces or more): packages[].version is the npm client's own version.
    [/(?<!\n {4,})("version":\s*")(\d+\.\d+\.\d+)(")/, "version", 1],
    [/("description":\s*")(\d+)( agent tools:)/, "toolCount", 1],
  ],
  "src/discovery.ts": [[/(MCP_SERVER_VERSION = ")(\d+\.\d+\.\d+)(")/, "version", 1]],
  "tests/tool-buying.test.cjs": [
    [/(ENDPOINTS\.length,)(\d+)(\))/, "count", 1],
    [/(serverInfo\.version,')(\d+\.\d+\.\d+)(')/, "version", 1],
  ],
  "tests/families.test.cjs": [[/(assert\.equal\(ENDPOINTS\.length,)(\d+)(\))/, "count", 1]],
  // The section servers together list every tool once (entry paths are not listed): "toolCount".
  "tests/gateway-startup.test.cjs": [
    [/(assert\.equal\(all\.length, )(\d+)(,)/, "toolCount", 1],
    [/(new Set\(all\)\.size, )(\d+)(\))/, "toolCount", 1],
  ],
  // The full list, /mcp/all, leaves out the extra networks' chain reads (1.82.0) and the entry paths: "mcpCount".
  "tests/payment-delivery-runtime.test.cjs": [[/(assert\.equal\(listed\.length,)(\d+)(\))/, "mcpCount", 1]],
  "README.md": [
    [/(^|\n)(\d+)( pay-per-call tools for AI agents over MCP)/, "toolCount", 1],
    [/(Browse all )(\d+)( tools and prices)/, "toolCount", 1],
    [/(Worker that sells )(\d+)( tools to AI agents)/, "toolCount", 1],
    [/(All )(\d+)( catalog tools are reachable)/, "toolCount", 1],
  ],
};

/** Pure: returns the rewritten texts and what changed; throws when a pin is missing or ambiguous. */
export function applyBump(files, { version, count, mcpCount = count, toolCount = count }) {
  if (!SEMVER.test(version)) throw new Error(`version must be x.y.z, got ${version}`);
  if (!Number.isInteger(count) || count < 1) throw new Error(`count must be a positive integer, got ${count}`);
  const out = {}, changes = [];
  for (const [file, pins] of Object.entries(PINS)) {
    let text = files[file];
    if (typeof text !== "string") throw new Error(`missing file ${file}`);
    for (const [re, kind, expected] of pins) {
      const matches = text.match(new RegExp(re.source, "g")) ?? [];
      if (matches.length !== expected) throw new Error(`${file}: expected ${expected} match(es) for ${re}, found ${matches.length}`);
      const value = kind === "version" ? version : kind === "mcpCount" ? String(mcpCount) : kind === "toolCount" ? String(toolCount) : String(count);
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

async function liveCounts() {
  const built = await build({ stdin: { contents: 'export { ENDPOINTS, TOOL_COUNT } from "./src/endpoints"; export { EXTRA_CHAIN_PATHS } from "./src/routes/chain-reads"; export { ENTRY_OF } from "./src/routes/entry-paths";', resolveDir: process.cwd(), sourcefile: "bump-entry.ts", loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false });
  const { ENDPOINTS, EXTRA_CHAIN_PATHS, ENTRY_OF, TOOL_COUNT } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
  const count = ENDPOINTS.length;
  return { count, toolCount: TOOL_COUNT, mcpCount: ENDPOINTS.filter((e) => !EXTRA_CHAIN_PATHS?.has(e.path) && !Object.hasOwn(ENTRY_OF, e.path)).length };
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
  const live = await liveCounts();
  const count = countAt > 0 ? Number(args[countAt + 1]) : live.count;
  // With --count the other two counts keep the catalog's difference (entry paths; the extra networks' reads).
  const mcpCount = count - (live.count - live.mcpCount);
  const toolCount = count - (live.count - live.toolCount);
  const { files: next, changes } = applyBump(files, { version, count, mcpCount, toolCount });
  if (flag === "--check") {
    if (changes.length) throw new Error(`pins out of date:\n  ${changes.join("\n  ")}`);
    console.log(`pins match ${version}: ${toolCount} tools, ${count} paid paths`);
    return;
  }
  for (const [file, text] of Object.entries(next)) if (text !== files[file]) await writeFile(file, text);
  console.log(changes.length ? changes.join("\n") : `pins already at ${version} / ${count} tools`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
