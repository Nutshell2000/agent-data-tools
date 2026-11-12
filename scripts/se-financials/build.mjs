#!/usr/bin/env node
// Merges the extract jobs' report lines (and the previous build's state) into one record per company and packs
// them the way /se/company is packed: gzip shards back to back in one file, each shard's byte range in manifest.json,
// sharded by organisationsnummer exactly like the company register (shardOf, 509 shards).
//
// Usage: node scripts/se-financials/build.mjs <outDir> <previousState.jsonl.gz|-> <previousManifest.json|-> <chunkDir> <reports.jsonl ...>
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip, gzipSync } from "node:zlib";
import { join } from "node:path";
import { FIELDS, addReport, finishRecord, loadStateLine, stateLine } from "./ixbrl.mjs";

export const SHARDS = 509; // equal to scripts/build-se-company-index.mjs and src/routes/se-company.ts
export const shardOf = (orgnr) => Number(orgnr.slice(0, 9)) % SHARDS;
export const ROW = ["start", "end", ...FIELDS.map(([k]) => k), "fromReport"];

async function* lines(path) {
  const input = path.endsWith(".gz") ? createReadStream(path).pipe(createGunzip()) : createReadStream(path);
  for await (const line of createInterface({ input, crlfDelay: Infinity })) if (line.trim()) yield JSON.parse(line);
}

/** Packs a store into outDir; returns the manifest. */
export function pack(store, outDir, { dataAsOf, tag, processed = [], keep = 6 } = {}) {
  mkdirSync(outDir, { recursive: true });
  const shards = Array.from({ length: SHARDS }, () => ({}));
  let companies = 0, years = 0;
  for (const [o, rec] of store) {
    const r = finishRecord(rec, keep);
    if (!r.y.length) continue;
    shards[shardOf(o)][o] = r;
    companies++;
    years += r.y.length;
  }
  const file = `se-financials-${tag}.bin`;
  const index = [];
  const bufs = [];
  let offset = 0;
  for (const part of shards) {
    const gz = gzipSync(JSON.stringify(part), { level: 9 });
    index.push([offset, gz.length]);
    bufs.push(gz);
    offset += gz.length;
  }
  writeFileSync(join(outDir, file), Buffer.concat(bufs));
  const state = [];
  for (const [o, rec] of store) state.push(JSON.stringify(stateLine(o, rec)));
  writeFileSync(join(outDir, "se-financials-state.jsonl.gz"), gzipSync(state.join("\n") + "\n"));
  const manifest = {
    dataAsOf, shards: SHARDS, companies, fiscalYears: years, row: ROW, builtAt: new Date().toISOString(),
    source: "Bolagsverket, digitally filed annual reports (värdefulla datamängder), weekly bulk files",
    processed, files: { financials: { file, bytes: offset, index } },
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest));
  return manifest;
}

if (process.argv[1]?.endsWith("build.mjs")) {
  const [outDir, prevState, prevManifest, chunkDir, ...reportFiles] = process.argv.slice(2);
  const store = new Map();
  if (prevState && prevState !== "-" && existsSync(prevState)) for await (const l of lines(prevState)) loadStateLine(store, l);
  const before = store.size;
  let reports = 0;
  for (const f of reportFiles) for await (const r of lines(f)) { addReport(store, r); reports++; }
  const processed = new Set(prevManifest && prevManifest !== "-" && existsSync(prevManifest) ? JSON.parse(readFileSync(prevManifest, "utf8")).processed ?? [] : []);
  for (const c of readdirSync(chunkDir).filter((x) => /^chunk-\d+\.txt$/.test(x)))
    for (const line of readFileSync(join(chunkDir, c), "utf8").split("\n").filter(Boolean)) processed.add(line.replace(" ", ":"));
  const dataAsOf = process.env.SE_DATA_AS_OF || new Date().toISOString().slice(0, 10);
  const m = pack(store, outDir, { dataAsOf, tag: process.env.SE_FILE_TAG || dataAsOf, processed: [...processed].sort() });
  const { files, processed: p, ...summary } = m;
  console.log(JSON.stringify({ ...summary, companiesBefore: before, reportsAdded: reports, processedFiles: p.length, bytes: files.financials.bytes }));
}
