// Runs /token/buyers locally against live nodes (no Worker, no payment).
//   node scripts/try-token-buyers.mjs <token> [chain] [blocks]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
const require = createRequire(import.meta.url);
const entry = fileURLToPath(new URL("../src/routes/chain-more.ts", import.meta.url));
const built = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent" });
const mod = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, require);
const [token, chain = "base", blocks = "1800"] = process.argv.slice(2);
const e = mod.exports.CHAIN_MORE.find((x) => x.endpoint.path === "/token/buyers");
const t0 = Date.now();
try {
  const out = await e.run({}, (n) => ({ token, chain, blocks, limit: "5" })[n]);
  console.log(`${token} ${chain}: ${Date.now() - t0} ms, ${out.token.symbol}, blocks ${out.fromBlock}-${out.toBlock}, ${out.transfersRead} transfers, ${out.dexContractsSeen} dex contracts, truncated ${out.truncated}`);
  for (const b of out.buyers.slice(0, 3)) console.log(`   buyer  ${b.address} bought ${b.bought} sold ${b.sold} netAll ${b.netAll} (${b.transfers})`);
  for (const s of out.sellers.slice(0, 3)) console.log(`   seller ${s.address} bought ${s.bought} sold ${s.sold} netAll ${s.netAll} (${s.transfers})`);
} catch (err) { console.log(`${token} ${chain}: ERROR ${err.status ?? ""} ${err.message}`); }
