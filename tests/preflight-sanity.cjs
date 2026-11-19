// Sanity test for /csv/preflight implementation (mirrors src/routes/utils.ts).
const assert = require("assert");

function preflightCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const d = [",", ";", "\t", "|"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [], lineNumbers = [], emptyRows = [];
  let row = [], field = "", quoted = false, line = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === d) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) { rows.push(row); lineNumbers.push(line); }
      else if (i < text.length - 1) emptyRows.push(line);
      row = []; line++;
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) { rows.push(row); lineNumbers.push(line); }
  else if (text.trim() === "") { rows.push(row); lineNumbers.push(line); }
  return { rows, lineNumbers, delimiter: d, unterminatedQuote: quoted, emptyRows };
}

function csvColumnType(samples) {
  const kinds = samples.map((v) => v.trim() === "" ? "empty" : /^-?\d+$/.test(v.trim()) ? "integer" : !isNaN(Number(v.trim())) ? "number" : /^(true|false)$/i.test(v.trim()) ? "boolean" : "string");
  const nonEmpty = kinds.filter((k) => k !== "empty");
  if (nonEmpty.length === 0) return "empty";
  const distinct = [...new Set(nonEmpty)];
  return distinct.length === 1 ? nonEmpty[0] : "mixed";
}

function preflight(raw0) {
  const raw = raw0.replace(/^\uFEFF/, "");
  const { rows, lineNumbers, delimiter, unterminatedQuote, emptyRows } = preflightCsv(raw);
  const problems = [];
  const header = rows[0]?.map((h) => h.trim().replace(/\s+/g, " ")) ?? [];
  const body = rows.slice(1);
  if (header.length === 0) problems.push({ line: 1, message: "no header row found (text is empty or all blank)" });
  else if (header.every((h) => h === "")) problems.push({ line: lineNumbers[0] ?? 1, message: "header row is empty: no column names found" });
  if (header.filter((h) => h === "").length > 0) problems.push({ line: 1, message: "header has empty column names" });
  const seen = new Set();
  for (const h of header) if (h !== "") { if (seen.has(h)) problems.push({ line: 1, message: `duplicate header "${h}"` }); seen.add(h); }
  const ragged = [];
  const colTypes = {};
  const colSamples = Array.from({ length: header.length }, () => []);
  body.forEach((row, i) => {
    const line = lineNumbers[i + 1] ?? i + 2;
    if (header.length > 0 && row.length !== header.length) ragged.push({ line, fields: row.length, headerFields: header.length });
    header.forEach((h, ci) => { if (ci < row.length && h) colSamples[ci].push(row[ci]); });
  });
  header.forEach((h, ci) => { if (h) colTypes[h] = csvColumnType(colSamples[ci]); });
  const MAXP = 12;
  for (const r of ragged.slice(0, MAXP)) problems.push({ line: r.line, message: `row has ${r.fields} fields, header has ${r.headerFields}` });
  if (ragged.length > MAXP) problems.push({ line: ragged[MAXP].line, message: `+${ragged.length - MAXP} more ragged rows` });
  for (const [h, t] of Object.entries(colTypes)) if (t === "mixed") problems.push({ line: 1, message: `column "${h}" has mixed types` });
  if (rows.length === 0 && header.length === 0) problems.push({ line: 1, message: "no data at all" });
  else if (body.length === 0) problems.push({ line: 1, message: "no data rows after the header" });
  for (const b of emptyRows.slice(0, 3)) problems.push({ line: b, message: "blank line (ignored by parsers)" });
  if (unterminatedQuote) problems.push({ line: lineNumbers[lineNumbers.length - 1] ?? 1, message: "a quoted field is not closed before the end of the text" });
  const enc = [];
  if (raw.includes("�")) enc.push("text contains replacement characters — likely mojibake or binary data");
  if (raw.includes(" ")) enc.push("text contains NUL bytes — likely binary, not CSV text");
  for (const m of enc.slice(0, 5)) problems.push({ line: 1, message: m });
  return { ok: problems.length === 0, delimiter, rowCount: body.length, raggedRowCount: ragged.length, blankLines: emptyRows.length, header, columnTypes: colTypes, problems };
}

const cases = [
  ["basic ok", "name,age,active\nAda,36,true\nBob,41,false\n", { ok: true, rowCount: 2, delimiter: ",", header: ["name", "age", "active"], columnTypes: { name: "string", age: "integer", active: "boolean" } }],
  ["ragged", "a,b,c\n1,2\n3,4,5\n6\n", { ok: false, rowCount: 3, raggedRowCount: 2 }],
  ["dup headers", "x,x,y\n1,2,3\n", { ok: false, header: ["x", "x", "y"] }],
  ["empty header name", "a,,c\n1,2,3\n", { ok: false }],
  ["empty text", "", { ok: false }],
  ["whitespace BOM text", "\uFEFFa,b\n1,2\n", { ok: true, header: ["a", "b"] }],
  ["mixed col", "n\n1\nabc\n", { ok: false, columnTypes: { n: "mixed" } }],
  ["all integers col", "n\n1\n2\n", { ok: true, columnTypes: { n: "integer" } }],
  ["quotes", "name,note\nAda,\"a,b\"\nBob,plain\n", { ok: true, rowCount: 2 }],
  ["semicolon delim", "a;b\n1;2\n", { ok: true, delimiter: ";" }],
];
for (const [label, text, expect] of cases) {
  const r = preflight(text);
  for (const [k, v] of Object.entries(expect)) {
    if (k === "ok") assert.strictEqual(r.ok, v, `${label}: ok`);
    else assert.deepStrictEqual(r[k], v, `${label}: ${k}`);
  }
  console.log(`ok - ${label}`);
}
console.log("all preflight sanity checks passed");
