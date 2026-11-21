// The reading of the public /status report behind scripts/reliability-line.mjs, kept apart so it can be tested
// without a network call (scripts/reliability-line.test.mjs).
//
// 21 Nov 2026: the release step that runs this printed "[warn] reliability failed (exit 1)" on every release of the
// day. The step was right, not broken: five tools with at least 5 counted calls were under 90% over the 7-day window.
// But four of the five had answered every call of the newest 3 days (their errors were 4 to 6 days old, all 502/503
// from an outside source), and one, /btc-fees, was still failing. One exit code for both cases made the warning the
// same on every release, so nobody read it. Now the line names both groups and why each tool failed, and the exit
// code is 1 only while a tool is still failing (or has had no successful call since), so the warning means "look now".
// Exit 2 is "the report could not be read", which used to look the same as a finding.

export const MIN_CALLS = 5;
export const MIN_RATE = 0.9;

const percent = (rate) => `${Math.round(rate * 100)}%`;
const reasonOf = (tool) => {
  const top = (tool.topFailures ?? []).find((f) => /^5\d\d\b/.test(String(f.reason ?? "")));
  return top ? `; ${String(top.reason).slice(0, 70)} x${top.count}` : "";
};

/** @returns {{ line: string, exitCode: 0 | 1 | 2, failing: string[], recovered: string[] }} */
export function reliabilityReport(status) {
  if (!status || typeof status !== "object" || !Array.isArray(status.tools) || typeof status.successRate !== "number") {
    return { line: "reliability: /status did not hold the expected report (no tools list or success rate)", exitCode: 2, failing: [], recovered: [] };
  }
  const weak = status.tools
    .filter((t) => t.served + t.serverErrors >= MIN_CALLS && t.successRate < MIN_RATE)
    .sort((a, b) => a.successRate - b.successRate);
  // "Clean since" needs proof: at least one call served and no server error in the newest days. A tool nobody has
  // called since its errors, or a report without the `recent` figures, stays in the failing group.
  const cleanNow = (t) => t.recent && t.recent.served > 0 && t.recent.serverErrors === 0;
  const failing = weak.filter((t) => !cleanNow(t));
  const recovered = weak.filter(cleanNow);
  const days = status.recent?.days ?? 3;
  const show = (t, withRecent) => {
    const recent = withRecent && t.recent ? `; last ${t.recent.days ?? days} days ${t.recent.served}/${t.recent.served + t.recent.serverErrors}` : "";
    return `${t.path} ${percent(t.successRate)} (${t.served}/${t.served + t.serverErrors}${recent}${reasonOf(t)})`;
  };
  let line = `reliability ${status.windowDays ?? 7}d ${(status.successRate * 100).toFixed(1)}% served=${status.served} errors=${status.serverErrors}`;
  if (!weak.length) line += "; no tool under 90%";
  if (failing.length) line += `; under 90% and still failing: ${failing.map((t) => show(t, true)).join(", ")}`;
  if (recovered.length) line += `; under 90% over the window but no error in the last ${days} days: ${recovered.map((t) => show(t, false)).join(", ")}`;
  return { line, exitCode: failing.length ? 1 : 0, failing: failing.map((t) => t.path), recovered: recovered.map((t) => t.path) };
}
