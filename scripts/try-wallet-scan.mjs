// Runs /wallet/related and /wallet/transactions locally against the live public nodes (no Worker, no payment).
//   node scripts/try-wallet-scan.mjs <address> [chain] [blocks]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
const require = createRequire(import.meta.url);
const entry = fileURLToPath(new URL("../src/routes/chain-reads.ts", import.meta.url));
const built = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent" });
const mod = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, require);
const [address, chain = "base", blocks = "2000"] = process.argv.slice(2);
const q = (n) => ({ address, chain, blocks })[n];
for (const path of ["/wallet/related", "/wallet/transactions"]) {
  const e = mod.exports.CHAIN_READS.find((x) => x.endpoint.path === path);
  const t0 = Date.now();
  try {
    const out = await e.run({}, q);
    const list = out.counterparties ?? out.transfers;
    console.log(`${path} ${chain}: ${Date.now() - t0} ms, blocks ${out.fromBlock}-${out.toBlock}, ${out.transfersScanned ?? out.count} transfers, truncated ${out.truncated}`);
    for (const x of list.slice(0, 4)) console.log("   ", JSON.stringify(x).slice(0, 200));
  } catch (err) { console.log(`${path} ${chain}: ERROR ${err.status ?? ""} ${err.message}`); }
}
