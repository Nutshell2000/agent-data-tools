// Read-only interoperability check. Supply an installed @agentcash/discovery entry.
// node scripts/check-agent-discovery.mjs <path-to-discovery/dist/index.js> [private-output.json]
// Never initializes a wallet, sends a signature or invokes a paid tool.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
const [modulePath, output] = process.argv.slice(2);
if (!modulePath) throw new Error("Supply an installed @agentcash/discovery entry point; no package is automatically installed.");
const { discoverOriginSchema, checkEndpointSchema, GuidanceMode } = await import(pathToFileURL(resolve(modulePath)).href);
const origin = process.env.CHECK_ORIGIN ?? "https://agent-data-tools.revmesh2074.workers.dev";
const discovery = await discoverOriginSchema({ target: origin, guidance: GuidanceMode.Always, signal: AbortSignal.timeout(25000) });
const reader = await checkEndpointSchema({ url: `${origin}/extract?url=https%3A%2F%2Fexample.com`, probe: false, signal: AbortSignal.timeout(25000) });
// What x402scan's register flow does: probe the live 402 (not the OpenAPI copy).
const probe = await checkEndpointSchema({ url: `${origin}/extract?url=https%3A%2F%2Fexample.com`, probe: true, signal: AbortSignal.timeout(25000) });
const get = (path, headers = {}) => fetch(origin + path, { headers, signal: AbortSignal.timeout(20000) });
const unpaid = await get("/extract?url=https%3A%2F%2Fexample.com", { accept: "application/json" });
const unpaidBody = await unpaid.json().catch(() => null);
const og = await get("/og.png");
const ogBytes = new Uint8Array(await og.arrayBuffer());
// x402scan's scraper sends a Mozilla UA and no Accept header.
const page = await get("/", { "user-agent": "Mozilla/5.0 (compatible; check-agent-discovery)" });
const pageHtml = await page.text();
const status = await get("/status", { accept: "application/json" });
await status.arrayBuffer();
const endpoint = discovery.endpoints?.find(e => e.path === "/extract" && e.method === "GET");
const advisory = reader.advisories?.find(e => e.method === "GET");
const checks = {
  catalog: discovery.found && discovery.endpoints.length === 167,
  paidReader: endpoint?.authMode === "paid" && endpoint.protocols?.includes("x402"),
  price: endpoint?.price === "0.002 USD",
  guidance: discovery.guidance?.includes("reader-client.mjs") === true,
  probe: probe.found === true && probe.advisories?.some(a => a.method === "GET" && a.inputSchema) === true,
  readable402: unpaid.status === 402 && unpaidBody?.x402Version === 2 && unpaidBody.accepts?.[0]?.amount === "2000",
  ogImage: og.ok && og.headers.get("content-type") === "image/png" && String.fromCharCode(...ogBytes.subarray(1, 4)) === "PNG",
  scraperHtml: (page.headers.get("content-type") ?? "").includes("text/html") && pageHtml.includes('property="og:image"'),
  status: status.ok,
  schema: reader.found && advisory?.outputSchema?.properties?.contentHash?.type === "string" && advisory?.outputSchema?.properties?.tables?.type === "array",
};
const report = { checkedAt: new Date().toISOString(), origin, checks, discovery, reader, probe, noWallet: true, noPayments: true };
if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checkedAt: report.checkedAt, checks, noWallet: true, noPayments: true }));
if (Object.values(checks).some(ok => !ok)) process.exitCode = 1;
