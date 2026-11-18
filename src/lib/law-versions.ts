/**
 * An article as it read on a given date (18 Nov 2026, Phase B of the law-firm plan): lawyers ask what a provision said
 * when the facts happened. The list of consolidated versions per act is stored (D1 act_versions, from
 * scripts/law-index/build-versions.mjs); the text of the version in force on that date is fetched from CELLAR, the EU
 * Publications Office's repository, read with the index builder's own parser (scripts/law-index/parse.mjs), cached for
 * a week, and compared line by line with today's text.
 *
 * A consolidated version is dated from when it applies. Before the first consolidation, the act's Official Journal text
 * is the one in force (from its entry into force, which this list does not hold: the page says so).
 */
import { parseAct } from "../../scripts/law-index/parse.mjs";

export interface VersionRow { short: string; version_celex: string; date: string }

/** The newest version that applies on `date` (YYYY-MM-DD), or null when the date is before the first consolidation. */
export function versionOn(rows: VersionRow[], date: string): VersionRow | null {
  return [...rows].filter((r) => r.date <= date).sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
}

/** One article's text from an act's XHTML, or null. */
export function articleFrom(html: string, num: string): { heading: string | null; text: string } | null {
  const it = parseAct(html).items.find((i) => i.kind === "article" && i.num === num);
  return it ? { heading: it.heading, text: it.text } : null;
}

const UA = "LexGlyph (https://lex.glyphcall.com)";
/** A version's XHTML from CELLAR, through the edge cache (a version never changes). */
export async function fetchVersion(celex: string, lang = "eng"): Promise<string | null> {
  const url = `https://publications.europa.eu/resource/celex/${encodeURIComponent(celex)}`;
  const key = new Request(`https://lexglyph.cache/version/${celex}/${lang}`);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit.text();
  const r = await fetch(url, { headers: { accept: "application/xhtml+xml", "accept-language": lang, "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r?.ok) return null;
  const html = await r.text();
  await cache?.put(key, new Response(html, { headers: { "cache-control": "public, max-age=604800" } })).catch(() => undefined);
  return html;
}

export type DiffLine = { kind: "same" | "removed" | "added"; text: string };
/** Line-by-line difference (longest common subsequence): what was removed from the old text and added in the new. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n"), b = newText.split("\n");
  if (a.length * b.length > 250_000) return [...a.map((text) => ({ kind: "removed" as const, text })), ...b.map((text) => ({ kind: "added" as const, text }))];
  const L: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ kind: "removed", text: a[i++] });
    else out.push({ kind: "added", text: b[j++] });
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++] });
  while (j < b.length) out.push({ kind: "added", text: b[j++] });
  return out;
}

export interface PointInTime {
  short: string; article: string; date: string;
  then: { celex: string; from: string; heading: string | null; text: string } | null;
  now: { celex: string; from: string; heading: string | null; text: string } | null;
  diff: DiffLine[];
  note?: string;
}

/** Article `num` of act `short` as it read on `date`, and today, and the difference. */
export async function articleOnDate(db: D1Database, short: string, num: string, date: string, lang = "eng", fetcher = fetchVersion): Promise<PointInTime> {
  const rows = (await db.prepare("SELECT short, version_celex, date FROM act_versions WHERE short = ? ORDER BY date").bind(short).all<VersionRow>()).results ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const thenV = versionOn(rows, date), nowV = versionOn(rows, today);
  const read = async (v: VersionRow | null) => {
    if (!v) return null;
    const html = await fetcher(v.version_celex, lang);
    const a = html ? articleFrom(html, num) : null;
    return a ? { celex: v.version_celex, from: v.date, ...a } : null;
  };
  const [then, now] = await Promise.all([read(thenV), read(nowV)]);
  const note = !rows.length ? "This act has never been consolidated: the Official Journal text has applied unchanged."
    : !thenV ? `The first consolidated version applies from ${rows[0].date}; before that, the Official Journal text applied (not compared here).`
    : !then ? "The article does not exist in the version in force on that date, or the version could not be read." : undefined;
  return { short, article: num, date, then, now, diff: then && now ? diffLines(then.text, now.text) : [], ...(note ? { note } : {}) };
}
