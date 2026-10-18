// Read-only Coinbase readiness validation. Never signs, settles or seeds listings.
// node scripts/check-live-readiness.mjs [--output path-to-private-evidence.json]
import { writeFile } from "node:fs/promises";
const origin = "https://agent-data-tools.revmesh2074.workers.dev";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output")) {
  throw new Error("Only --output <path> is supported. Self-payment seeding is disabled; this script never pays.");
}
const cardResponse = await fetch(origin, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
if (!cardResponse.ok) throw new Error(`Service card HTTP ${cardResponse.status}`);
const card = await cardResponse.json();
const queue = [...card.endpoints], results = [];
async function worker() {
  while (queue.length) {
    const endpoint = queue.shift();
    const path = new URL(endpoint.url).pathname;
    try {
      const response = await fetch("https://api.cdp.coinbase.com/platform/v2/x402/validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: endpoint.example, method: "GET" }), signal: AbortSignal.timeout(45_000),
      });
      const detail = await response.json();
      const failed = (detail.preflight ?? []).filter(check => check.severity === "required" && !check.passed);
      const quote = detail.paymentRequirements?.accepts?.[0];
      const expectedAtomic = Math.round(Number(endpoint.price.slice(1)) * 1e6).toString();
      const priceConsistent = quote?.amount === expectedAtomic && BigInt(expectedAtomic) >= 1000n;
      const accepted = detail.simulation?.outcome === "accepted";
      const ok = response.ok && detail.valid === true && accepted && failed.length === 0 && priceConsistent;
      results.push({ path, example: endpoint.example, ok, status: response.status, valid: detail.valid,
        simulation: detail.simulation, failedRequired: failed, priceConsistent, index: detail.index, detail });
      console.log(`${ok ? "PASS" : "FAIL"} ${path} ${quote?.amount ?? "no-quote"} atomic; simulation=${detail.simulation?.outcome ?? "missing"}; failed-required=${failed.length}`);
    } catch (error) {
      results.push({ path, ok: false, error: String(error) }); console.log(`FAIL ${path}: ${error}`);
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
results.sort((a, b) => a.path.localeCompare(b.path));
const report = { checkedAt: new Date().toISOString(), method: "free read-only CDP validator; no signer or payment", origin, passed: results.filter(r => r.ok).length, total: results.length, results };
if (args.length) await writeFile(args[1], JSON.stringify(report, null, 2) + "\n");
console.log(`${report.passed}/${report.total} ready. Validation does not execute a paid tool, establish customer demand or create a Bazaar index entry.`);
if (report.passed !== report.total) process.exitCode = 1;
