// Live smoke test for the table-generated families: runs every entry on its listed example input
// against the real networks and data sources (no payment involved) and reports failures and timings.
//   node scripts/smoke-families.mjs [path-filter]
import { build } from "esbuild";
import { createRequire } from "node:module";
import { writeFile, rm } from "node:fs/promises";

const out = new URL("../.smoke-families.cjs", import.meta.url);
const bundled = await build({ stdin: { contents: 'export { FAMILIES } from "./src/families"; export { PAUSED_FAMILY_TOOLS } from "./src/endpoints";', resolveDir: process.cwd(), sourcefile: "smoke-families-entry.ts" }, bundle: true, platform: "node", format: "cjs", write: false });
await writeFile(out, bundled.outputFiles[0].text);
const { FAMILIES, PAUSED_FAMILY_TOOLS } = createRequire(import.meta.url)(out.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await rm(out);

const filter = process.argv[2];
// AI tools and /extract/rendered need Workers bindings (AI, BROWSER); check them against a deployed Worker instead.
const list = FAMILIES.filter((f) => !Object.hasOwn(PAUSED_FAMILY_TOOLS, f.endpoint.path) && !f.endpoint.path.startsWith("/ai/") && f.endpoint.path !== "/extract/rendered" && (!filter || f.endpoint.path.includes(filter)));
const env = { BASE_RPC_URL: "https://mainnet.base.org" };
let failed = 0;
const slow = [];

async function runOne(f) {
  const q = (name) => (f.endpoint.params[name] ? String(f.endpoint.params[name].example) : undefined);
  const t0 = Date.now();
  try {
    const result = await f.run(env, q);
    const ms = Date.now() - t0;
    if (ms > 4000) slow.push(`${f.endpoint.path} ${ms} ms`);
    return `ok   ${f.endpoint.path.padEnd(24)} ${String(ms).padStart(5)} ms  ${JSON.stringify(result).slice(0, 90)}`;
  } catch (e) {
    failed++;
    return `FAIL ${f.endpoint.path.padEnd(24)} ${e.status ?? ""} ${e.message ?? e}`;
  }
}

// A few at a time, so public sources are not hammered.
for (let i = 0; i < list.length; i += 4) for (const line of await Promise.all(list.slice(i, i + 4).map(runOne))) console.log(line);
console.log(`\n${list.length - failed}/${list.length} passed${slow.length ? `; slow: ${slow.join(", ")}` : ""}`);
// Let open sockets close on their own: process.exit() while undici is closing them can abort Node on Windows
// (libuv "!(handle->flags & UV_HANDLE_CLOSING)" assertion, seen with Node 24).
process.exitCode = failed ? 1 : 0;
