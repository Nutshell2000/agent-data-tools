// Live smoke test for the table-generated families: runs every entry on its listed example input
// against the real networks and data sources (no payment involved) and reports failures and timings.
//   node scripts/smoke-families.mjs [path-filter]
import { build } from "esbuild";
import { createRequire } from "node:module";
import { writeFile, rm } from "node:fs/promises";

const out = new URL("../.smoke-families.cjs", import.meta.url);
const bundled = await build({ entryPoints: ["src/families.ts"], bundle: true, platform: "node", format: "cjs", write: false });
await writeFile(out, bundled.outputFiles[0].text);
const { FAMILIES } = createRequire(import.meta.url)(out.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await rm(out);

const filter = process.argv[2];
const list = FAMILIES.filter((f) => !filter || f.endpoint.path.includes(filter));
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
process.exit(failed ? 1 : 0);
