// One line on tool reliability from the public /status (7-day window), for release logs and the daily check:
//   node scripts/reliability-line.mjs [origin]
// Prints "reliability 7d 96.0% served=432 errors=18; under 90% and still failing: /pdf/text 67% (16/24; …) …".
// Exit codes (21 Nov 2026, see scripts/reliability-report.mjs for why):
//   0  no tool with at least 5 calls is under 90%, or every such tool has answered all calls of the newest days
//   1  at least one such tool is still failing: a real finding, look at it (the Bazaar's featured placement needs 99%)
//   2  the report could not be read (network, HTTP status, not JSON, unexpected shape): nothing is known
import { reliabilityReport } from "./reliability-report.mjs";

const origin = process.argv[2] ?? "https://agent-data-tools.revmesh2074.workers.dev";
let status;
try {
  const res = await fetch(`${origin}/status`, { headers: { accept: "application/json", "user-agent": "agent-data-tools-release/1.0" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) { console.log(`reliability: /status HTTP ${res.status}`); process.exit(2); }
  status = await res.json();
} catch (err) {
  console.log(`reliability: /status could not be read (${String(err?.cause?.code ?? err?.name ?? err).slice(0, 80)})`);
  process.exit(2);
}
const report = reliabilityReport(status);
console.log(report.line);
process.exitCode = report.exitCode;
