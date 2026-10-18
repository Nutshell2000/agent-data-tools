// Verifies every OWNERSHIP_PROOFS entry against PAY_TO on Base. Plain EOA signatures recover offline;
// smart-wallet signatures (Coinbase Smart Wallet / EIP-7702 accounts wrap the owner's signature) are
// checked with the wallet's own ERC-1271 isValidSignature through viem. Read-only, no keys involved.
//   node scripts/check-ownership-proofs.mjs
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const ORIGIN = "https://agent-data-tools.revmesh2074.workers.dev";
const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const payTo = config.match(/"PAY_TO":\s*"(0x[0-9a-fA-F]{40})"/)?.[1];
if (!payTo) throw new Error("PAY_TO not found in wrangler.jsonc");

const bundled = await build({ stdin: { contents: 'export { OWNERSHIP_PROOFS } from "./src/discovery";', resolveDir: process.cwd(), sourcefile: "proofs-entry.ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
  plugins: [{ name: "stub-workers", setup(b) { b.onResolve({ filter: /^(cloudflare:workers|@cloudflare\/puppeteer)$/ }, (a) => ({ path: a.path, namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class DurableObject {}; export default {};", loader: "js" })); } }] });
const { OWNERSHIP_PROOFS } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

const rpcs = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];
let failed = 0;
for (const proof of OWNERSHIP_PROOFS) {
  let ok = false;
  for (const url of rpcs) {
    try { ok = await createPublicClient({ chain: base, transport: http(url) }).verifyMessage({ address: payTo, message: ORIGIN, signature: proof }); break; }
    catch { /* try the next RPC */ }
  }
  console.log(`${ok ? "valid  " : "INVALID"} ${proof.slice(0, 18)}…${proof.slice(-8)} for ${payTo}`);
  if (!ok) failed++;
}
console.log(`${OWNERSHIP_PROOFS.length - failed}/${OWNERSHIP_PROOFS.length} ownership proofs verify for PAY_TO`);
if (failed) process.exit(1);
