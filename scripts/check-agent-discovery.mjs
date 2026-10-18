// Read-only interoperability check. Supply an installed @agentcash/discovery entry.
// node scripts/check-agent-discovery.mjs <path-to-discovery/dist/index.js> [private-output.json]
// Never initializes a wallet, sends a signature or invokes a paid tool.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
const [modulePath, output] = process.argv.slice(2);
if (!modulePath) throw new Error("Supply an installed @agentcash/discovery entry point; no package is automatically installed.");
const { discoverOriginSchema, checkEndpointSchema, GuidanceMode } = await import(pathToFileURL(resolve(modulePath)).href);
const origin = "https://agent-data-tools.revmesh2074.workers.dev";
const discovery = await discoverOriginSchema({ target: origin, guidance: GuidanceMode.Always, signal: AbortSignal.timeout(25000) });
const reader = await checkEndpointSchema({ url: `${origin}/extract?url=https%3A%2F%2Fexample.com`, probe: false, signal: AbortSignal.timeout(25000) });
const endpoint = discovery.endpoints?.find(e => e.path === "/extract" && e.method === "GET");
const advisory = reader.advisories?.find(e => e.method === "GET");
const checks = {
  catalog: discovery.found && discovery.endpoints.length === 165,
  paidReader: endpoint?.authMode === "paid" && endpoint.protocols?.includes("x402"),
  price: endpoint?.price === "0.002 USD",
  guidance: discovery.guidance?.includes("reader-client.mjs") === true,
  schema: reader.found && advisory?.outputSchema?.properties?.contentHash?.type === "string" && advisory?.outputSchema?.properties?.tables?.type === "array",
};
const report = { checkedAt: new Date().toISOString(), origin, checks, discovery, reader, noWallet: true, noPayments: true };
if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checkedAt: report.checkedAt, checks, noWallet: true, noPayments: true }));
if (Object.values(checks).some(ok => !ok)) process.exitCode = 1;
