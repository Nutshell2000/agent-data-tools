// Key figures from Swedish digital annual reports (iXBRL, Bolagsverket's free weekly bulk files of "värdefulla
// datamängder"): the figures the company itself filed, per fiscal year, and nothing else. Used by
// .github/workflows/se-financials-mirror.yml through extract.mjs and build.mjs, which publish the packed result.
//
// Privacy rule: annual reports also carry the names of the people who signed them (board, auditor). Only the
// facts named in FIELDS are ever read, so no personal data leaves this module (tests/se-financials.test.cjs checks
// that signatory names in a fixture never reach the output).
// Credit-law rule: no ratio, score, grade or opinion is computed here. "Soliditet" is passed on only as the company
// itself reported it.
import { inflateRawSync } from "node:zlib";

/** Output columns, in this order, per fiscal year. Each is one fact name in the Swedish GAAP taxonomy (K2/K3) or IFRS (ESEF). */
export const FIELDS = [
  ["revenue", ["se-gen-base:Nettoomsattning", "ifrs-full:Revenue"]],
  ["operatingProfit", ["se-gen-base:Rorelseresultat", "ifrs-full:ProfitLossFromOperatingActivities"]],
  ["profitAfterFinancialItems", ["se-gen-base:ResultatEfterFinansiellaPoster"]],
  ["profitBeforeTax", ["se-gen-base:ResultatForeSkatt", "ifrs-full:ProfitLossBeforeTax"]],
  ["netProfit", ["se-gen-base:AretsResultat", "ifrs-full:ProfitLoss"]],
  ["staffCosts", ["se-gen-base:Personalkostnader", "ifrs-full:EmployeeBenefitsExpense"]],
  ["employees", ["se-gen-base:MedelantaletAnstallda"]],
  ["totalAssets", ["se-gen-base:Tillgangar", "ifrs-full:Assets"]],
  ["equity", ["se-gen-base:EgetKapital", "ifrs-full:Equity"]],
  ["shareCapital", ["se-gen-base:Aktiekapital", "ifrs-full:IssuedCapital"]],
  ["cash", ["se-gen-base:KassaBank", "ifrs-full:CashAndCashEquivalents"]],
  ["currentLiabilities", ["se-gen-base:KortfristigaSkulder", "ifrs-full:CurrentLiabilities"]],
  ["longTermLiabilities", ["se-gen-base:LangfristigaSkulder", "ifrs-full:NoncurrentLiabilities"]],
  ["equityRatioReported", ["se-gen-base:Soliditet"]],
];
/** Balance-sheet facts are dated at an instant; the rest cover the fiscal year. */
const INSTANT = new Set(["totalAssets", "equity", "shareCapital", "cash", "currentLiabilities", "longTermLiabilities", "equityRatioReported"]);
const COLUMN_OF = new Map(FIELDS.flatMap(([key, names], i) => names.map((n) => [n, i])));

// ---------- zip (store and deflate, zip64 sizes) ----------

/** Entries of a zip held in memory: [{ name, data() }]. */
export function zipEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip (no end record)");
  let count = buf.readUInt16LE(eocd + 10), cdOffset = buf.readUInt32LE(eocd + 16);
  const loc = eocd - 20;
  if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
    const z = Number(buf.readBigUInt64LE(loc + 8));
    count = Number(buf.readBigUInt64LE(z + 32));
    cdOffset = Number(buf.readBigUInt64LE(z + 48));
  }
  const out = [];
  let p = cdOffset;
  for (let i = 0; i < count && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), off = buf.readUInt32LE(p + 42);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nl).toString("utf8");
    // zip64 extra field: the 0xFFFFFFFF fields, in order usize, csize, offset.
    for (let x = p + 46 + nl; x < p + 46 + nl + xl; ) {
      const id = buf.readUInt16LE(x), len = buf.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (off === 0xffffffff) { off = Number(buf.readBigUInt64LE(q)); }
      }
      x += 4 + len;
    }
    const at = off;
    out.push({
      name, size: usize,
      data() {
        const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
        const raw = buf.subarray(start, start + csize);
        if (method === 0) return raw;
        if (method === 8) return inflateRawSync(raw);
        throw new Error(`zip method ${method} not supported`);
      },
    });
    p += 46 + nl + xl + cl;
  }
  return out;
}

// ---------- iXBRL ----------

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i")) ?? tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, "i"));
  return m ? m[1] : null;
};
const text = (html) => html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/g, "&").trim();

/** The number an ix:nonFraction shows, by its format, scale and sign; null if unreadable. */
export function factValue(tag, inner) {
  if (/\bxsi:nil\s*=\s*"true"/i.test(tag)) return null;
  const format = (attr(tag, "format") ?? "").toLowerCase();
  let s = text(inner).replace(/[\s  ]/g, "");
  if (/zerodash|fixed-zero|fixedzero/.test(format) || /^[-–—]$/.test(s)) s = "0";
  // Decimal comma formats (numspacecomma, numdotcomma, num-comma-decimal) versus decimal point formats.
  if (/comma/.test(format) && !/numcommadot|num-dot-decimal/.test(format)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  s = s.replace(/[^0-9.]/g, "");
  if (!s || !/^\d*\.?\d+$|^\d+\.?$/.test(s)) return null;
  let v = Number(s);
  const scale = Number(attr(tag, "scale") ?? 0);
  if (Number.isFinite(scale) && scale) v *= 10 ** scale;
  if (attr(tag, "sign") === "-") v = -v;
  // Round away float noise from scaling (an öre amount or a percentage with two decimals stays exact enough).
  return Math.round(v * 10000) / 10000;
}

/**
 * One value from a fact's repeated occurrences. Usually they agree. When they do not, the most frequent value wins;
 * on a tie between values a factor 1,000 or 1,000,000 apart the larger wins, because the disagreement then comes from
 * a filer leaving `scale` off one occurrence of a figure shown in thousands (seen 11 Nov 2026: 14 186 at scale 0
 * beside 14 185 at scale 3). Otherwise the first occurrence wins.
 */
export function agreed(values) {
  if (values.length === 1) return values[0];
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const leaders = values.filter((v, i) => counts.get(v) === top && values.indexOf(v) === i);
  if (leaders.length === 1) return leaders[0];
  const [a, b] = [...leaders].sort((x, y) => Math.abs(y) - Math.abs(x));
  const ratio = b ? Math.abs(a / b) : 0;
  if ((ratio > 990 && ratio < 1010) || (ratio > 990_000 && ratio < 1_010_000)) return a;
  return leaders[0];
}

/** Contexts without dimensions: id -> { start, end } or { instant }. Dimensional contexts (segment, scenario) are left out. */
export function plainContexts(doc) {
  const out = new Map();
  for (const m of doc.matchAll(/<xbrli:context\b[^>]*>[\s\S]*?<\/xbrli:context>/gi)) {
    const c = m[0];
    if (/<xbrli:(segment|scenario)\b/i.test(c)) continue;
    const id = attr(c.slice(0, c.indexOf(">") + 1), "id");
    if (!id) continue;
    const instant = c.match(/<xbrli:instant>\s*([\d-]{10})/i)?.[1];
    const start = c.match(/<xbrli:startDate>\s*([\d-]{10})/i)?.[1];
    const end = c.match(/<xbrli:endDate>\s*([\d-]{10})/i)?.[1];
    if (instant) out.set(id, { instant });
    else if (start && end) out.set(id, { start, end });
  }
  return out;
}

/** The framework a report is filed under, from its taxonomy reference. */
export function framework(doc) {
  const refs = [...doc.matchAll(/<link:schemaRef\b[^>]*>/gi)].map((m) => attr(m[0], "xlink:href") ?? "").join(" ").toLowerCase();
  if (/esef|ifrs/.test(refs) || /\bifrs-full:/.test(doc)) return "ESEF";
  if (/\/k3k\/|k3k|koncern/.test(refs)) return "K3K";
  if (/\/k3\/|\bk3\b/.test(refs)) return "K3";
  if (/\/k2\/|\bk2\b/.test(refs)) return "K2";
  return null;
}

/**
 * One report document as fiscal years: [{ start, end, values: (number|null)[] }], newest first, plus its currency.
 * A year needs a duration context; its balance-sheet facts are the ones dated at its end.
 */
export function reportYears(doc) {
  const contexts = plainContexts(doc);
  const byContext = new Map();
  let currency = null;
  for (const m of doc.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi)) {
    const tag = m[0].slice(0, m[0].indexOf(">") + 1);
    const name = attr(tag, "name");
    const col = name == null ? undefined : COLUMN_OF.get(name);
    if (col === undefined) continue;
    const ctx = attr(tag, "contextRef");
    if (!ctx || !contexts.has(ctx)) continue;
    const v = factValue(tag, m[2]);
    if (v === null) continue;
    const unit = attr(tag, "unitRef");
    if (!currency && unit && /^[A-Z]{3}$/.test(unit) && FIELDS[col][0] === "revenue") currency = unit;
    if (!byContext.has(ctx)) byContext.set(ctx, new Map());
    const facts = byContext.get(ctx);
    // Reports repeat a figure (income statement, multi-year overview, equity note); collect every occurrence.
    // Two names for one column (K2 and IFRS) never both occur in a Swedish report.
    if (!facts.has(col)) facts.set(col, []);
    facts.get(col).push(v);
  }
  for (const facts of byContext.values()) for (const [col, vs] of facts) facts.set(col, agreed(vs));
  const instantFacts = new Map(); // instant date -> Map(col -> v)
  const years = new Map(); // "start|end" -> values
  for (const [id, facts] of byContext) {
    const c = contexts.get(id);
    if (c.instant) {
      if (!instantFacts.has(c.instant)) instantFacts.set(c.instant, new Map());
      for (const [col, v] of facts) if (!instantFacts.get(c.instant).has(col)) instantFacts.get(c.instant).set(col, v);
    } else {
      const key = `${c.start}|${c.end}`;
      if (!years.has(key)) years.set(key, Array(FIELDS.length).fill(null));
      const vals = years.get(key);
      for (const [col, v] of facts) if (!INSTANT.has(FIELDS[col][0]) && vals[col] === null) vals[col] = v;
    }
  }
  const out = [];
  for (const [key, values] of years) {
    const [start, end] = key.split("|");
    const bal = instantFacts.get(end);
    if (bal) for (const [col, v] of bal) if (INSTANT.has(FIELDS[col][0]) && values[col] === null) values[col] = v;
    if (values.every((v) => v === null)) continue;
    out.push({ start, end, values });
  }
  // A duration that is not a fiscal year (a quarter in an ESEF report, a note's sub-period) would sit beside the
  // year with the same end: keep the longest period per end date.
  const best = new Map();
  for (const y of out) {
    const prev = best.get(y.end);
    if (!prev || y.start < prev.start) best.set(y.end, y);
  }
  return { currency, years: [...best.values()].sort((a, b) => (a.end < b.end ? 1 : -1)) };
}

/** Company zip file name in the weekly bulk: "<orgnr>_<fiscal year end>.zip". */
export function reportKey(name) {
  const m = name.match(/(\d{10})_(\d{4}-\d{2}-\d{2})\.zip$/);
  return m ? { orgnr: m[1], fiscalYearEnd: m[2] } : null;
}

/**
 * One company zip (bytes) as a record line: { o, fe, fw, cur, y: [[start, end, ...values]] }, or null when no
 * document in it holds the figures. A company zip may hold the annual report and the audit report as two
 * documents; the one with the most figures is used.
 */
export function companyReport(name, bytes) {
  const key = reportKey(name);
  if (!key || Number(key.orgnr[2]) < 2) return null; // a personnummer would never be an AB, but never read one
  let best = null;
  for (const e of zipEntries(bytes)) {
    if (!/\.x?html?$/i.test(e.name)) continue;
    const doc = e.data().toString("utf8");
    const r = reportYears(doc);
    const filled = r.years.reduce((n, y) => n + y.values.filter((v) => v !== null).length, 0);
    if (filled && (!best || filled > best.filled)) best = { ...r, filled, fw: framework(doc) };
  }
  if (!best) return null;
  return { o: key.orgnr, fe: key.fiscalYearEnd, fw: best.fw, cur: best.currency ?? "SEK", y: best.years.map((y) => [y.start, y.end, ...y.values]) };
}

/** Is report a (fiscal year end, bulk week) newer than b? */
const newer = (aFe, aWeek, bFe, bWeek) => aFe > bFe || (aFe === bFe && (aWeek ?? "") > (bWeek ?? ""));

/**
 * Adds one report line ({ o, fe, fw, cur, week, y }) to the store (Map orgnr -> record). Every fiscal year is kept
 * once, from the most recent report that holds it (a later report's comparative figures may be restated). Streaming,
 * so the weekly build never holds every report at once.
 */
export function addReport(store, r) {
  let rec = store.get(r.o);
  if (!rec) store.set(r.o, (rec = { fw: r.fw, cur: r.cur, latest: r.fe, week: r.week ?? "", years: new Map() }));
  if (newer(r.fe, r.week, rec.latest, rec.week)) Object.assign(rec, { fw: r.fw, cur: r.cur, latest: r.fe, week: r.week ?? "" });
  for (const row of r.y) {
    const had = rec.years.get(row[1]);
    if (!had || newer(r.fe, r.week, had.from, had.week)) rec.years.set(row[1], { row, from: r.fe, week: r.week ?? "" });
  }
}

/** A store record as written: newest fiscal year first, at most `keep` years; each row ends with the report it came from. */
export function finishRecord(rec, keep = 6) {
  const years = [...rec.years.values()].sort((a, b) => (a.row[1] < b.row[1] ? 1 : -1)).slice(0, keep);
  return { fw: rec.fw, cur: rec.cur, latest: rec.latest, y: years.map((x) => [...x.row, x.from]) };
}

/** State line for the next weekly run (keeps the bulk week so a re-filed report can still win). */
export function stateLine(o, rec) {
  return { o, fw: rec.fw, cur: rec.cur, latest: rec.latest, week: rec.week, s: [...rec.years.values()].map((x) => [x.row, x.from, x.week]) };
}
export function loadStateLine(store, l) {
  store.set(l.o, { fw: l.fw, cur: l.cur, latest: l.latest, week: l.week, years: new Map(l.s.map(([row, from, week]) => [row[1], { row, from, week }])) });
}
