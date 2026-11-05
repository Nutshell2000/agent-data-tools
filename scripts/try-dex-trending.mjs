// Runs /dex/trending locally against live Base nodes (no Worker, no payment, no edge cache).
//   node scripts/try-dex-trending.mjs [blocks] [majors]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
const require = createRequire(import.meta.url);
const entry = fileURLToPath(new URL("../src/routes/chain-more.ts", import.meta.url));
const built = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent" });
const mod = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, require);
const [blocks = "150", majors = "exclude"] = process.argv.slice(2);
const e = mod.exports.CHAIN_MORE.find((x) => x.endpoint.path === "/dex/trending");
const t0 = Date.now();
const out = await e.run({}, (n) => ({ blocks, majors })[n]);
console.log(`${Date.now() - t0} ms, ${out.minutes} min, ${out.swapsCounted} swaps, ${out.poolsSeen} pools`);
for (const t of out.tokens) console.log(`  #${t.rank} ${String(t.symbol).padEnd(12)} ${String(t.swaps).padStart(5)} swaps ${t.pools} pools share ${t.shareOfSwaps} ${t.address}`);
