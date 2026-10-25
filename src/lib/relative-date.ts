/**
 * Dates as agents write them: "today", "now", "tomorrow", "yesterday" (UTC), a bare YYYY-MM-DD (UTC midnight), or anything
 * Date parses. Returns null when nothing parses. 24 Oct 2026: /date/diff to=today and /date/add date=today were refused.
 */
export function parseDate(raw: string | undefined, dayTime = "T00:00:00Z"): Date | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const word = v.toLowerCase();
  if (word === "now") return new Date();
  const dayOffset = { today: 0, tomorrow: 1, yesterday: -1 }[word];
  if (dayOffset !== undefined) {
    const d = new Date(new Date().toISOString().slice(0, 10) + dayTime);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    return d;
  }
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + dayTime) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
