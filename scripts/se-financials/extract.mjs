#!/usr/bin/env node
// Reads one weekly bulk zip of annual reports and appends one JSON line per company report with key figures.
// The workflow downloads each week's zip (resuming, the server cuts long transfers), runs this, and deletes the zip.
//
// Usage: node scripts/se-financials/extract.mjs <week.zip> <bulk key, e.g. arsredovisningar/2026/45_1.zip> <out.jsonl>
import { readFileSync, appendFileSync } from "node:fs";
import { zipEntries, companyReport } from "./ixbrl.mjs";

const [zipPath, key, outPath] = process.argv.slice(2);
const week = key.replace(/^arsredovisningar\//, "").replace(/\.zip$/, ""); // "2026/45_1"
const stats = { week, reports: 0, read: 0, empty: 0, failed: 0, frameworks: {} };
const lines = [];
for (const e of zipEntries(readFileSync(zipPath))) {
  if (!/\.zip$/i.test(e.name)) continue;
  stats.reports++;
  try {
    const r = companyReport(e.name.split("/").pop(), e.data());
    if (!r) { stats.empty++; continue; }
    stats.read++;
    stats.frameworks[r.fw ?? "unknown"] = (stats.frameworks[r.fw ?? "unknown"] ?? 0) + 1;
    lines.push(JSON.stringify({ ...r, week }));
  } catch (err) {
    stats.failed++;
    if (stats.failed <= 3) console.error(`${week} ${e.name}: ${err.message}`);
  }
}
if (lines.length) appendFileSync(outPath, lines.join("\n") + "\n");
console.log(JSON.stringify(stats));
