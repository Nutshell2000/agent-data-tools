// One line on tool reliability from the public /status (7-day window), for release logs and the daily check:
//   node scripts/reliability-line.mjs [origin]
// Prints "reliability 7d 96.0% served=432 errors=18; under 90%: /pdf/text 67% (16/24) …" and exits 1 when any tool
// with at least 5 calls is under 90%, so a release run can flag it (the Bazaar's featured placement needs 99%).
const origin = process.argv[2] ?? "https://agent-data-tools.revmesh2074.workers.dev";
const res = await fetch(`${origin}/status`, { headers: { accept: "application/json", "user-agent": "agent-data-tools-release/1.0" }, signal: AbortSignal.timeout(60_000) });
if (!res.ok) { console.log(`reliability: /status HTTP ${res.status}`); process.exit(2); }
const s = await res.json();
const weak = (s.tools ?? []).filter((t) => t.served + t.serverErrors >= 5 && t.successRate < 0.9).sort((a, b) => a.successRate - b.successRate)
  .map((t) => `${t.path} ${Math.round(t.successRate * 100)}% (${t.served}/${t.served + t.serverErrors})`);
console.log(`reliability ${s.windowDays ?? 7}d ${(s.successRate * 100).toFixed(1)}% served=${s.served} errors=${s.serverErrors}${weak.length ? `; under 90%: ${weak.join(", ")}` : "; no tool under 90%"}`);
process.exitCode = weak.length ? 1 : 0;
