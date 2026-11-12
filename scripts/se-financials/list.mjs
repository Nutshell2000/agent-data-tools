#!/usr/bin/env node
// Lists Bolagsverket's weekly annual-report bulk files (free, no agreement) and writes the ones to process into
// chunk files for the extract jobs. Already processed files (key and size, from the previous build's manifest) are
// skipped, so the weekly run reads only new weeks.
//
// Usage: node scripts/se-financials/list.mjs <fromYear> <chunks> <outDir> [previousManifest.json]
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const BULK = "https://vardefulla-datamangder.bolagsverket.se/arsredovisningar-bulkfiler";

/** Every file in the bucket listing: [{ key, size }], following the S3-style markers. */
export async function listAll(fetcher = fetch) {
  const out = [];
  let marker = "";
  for (let page = 0; page < 100; page++) {
    const url = `${BULK}?prefix=arsredovisningar/&delimiter=%5C${marker ? `&marker=${encodeURIComponent(marker)}` : ""}`;
    const res = await fetcher(url, { headers: { "user-agent": "agent-data-tools se-financials (+https://github.com/Nutshell2000/agent-data-tools)" } });
    if (!res.ok) throw new Error(`listing answered HTTP ${res.status}`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = m[1].match(/<Key>([^<]+)<\/Key>/)?.[1];
      const size = Number(m[1].match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
      if (key && /\.zip$/.test(key)) out.push({ key, size });
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    marker = xml.match(/<NextMarker>([^<]+)<\/NextMarker>/)?.[1] ?? "";
    if (!marker) break;
  }
  return out;
}

/** The files to process, split into chunks of about equal size (largest first, each to the lightest chunk). */
export function plan(files, fromYear, chunks, processed = new Set()) {
  const todo = files.filter((f) => Number(f.key.split("/")[1]) >= fromYear && !processed.has(`${f.key}:${f.size}`));
  const bins = Array.from({ length: Math.max(1, Math.min(chunks, todo.length)) }, () => ({ bytes: 0, files: [] }));
  for (const f of [...todo].sort((a, b) => b.size - a.size)) {
    const bin = bins.reduce((a, b) => (b.bytes < a.bytes ? b : a));
    bin.files.push(f);
    bin.bytes += f.size;
  }
  return bins.filter((b) => b.files.length);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("list.mjs")) {
  const [fromYear = "2024", chunks = "16", outDir = "chunks", prev] = process.argv.slice(2);
  const processed = new Set();
  if (prev && existsSync(prev)) for (const k of JSON.parse(readFileSync(prev, "utf8")).processed ?? []) processed.add(k);
  const files = await listAll();
  const bins = plan(files, Number(fromYear), Number(chunks), processed);
  mkdirSync(outDir, { recursive: true });
  bins.forEach((b, i) => writeFileSync(join(outDir, `chunk-${i}.txt`), b.files.map((f) => `${f.key} ${f.size}`).join("\n") + "\n"));
  writeFileSync(join(outDir, "all-files.txt"), files.map((f) => `${f.key} ${f.size}`).join("\n") + "\n");
  const total = bins.reduce((n, b) => n + b.bytes, 0);
  console.log(JSON.stringify({ listed: files.length, previouslyProcessed: processed.size, toProcess: bins.reduce((n, b) => n + b.files.length, 0), gigabytes: +(total / 1e9).toFixed(1), chunks: bins.length }));
  // For the workflow matrix: [0, 1, ...]
  writeFileSync(join(outDir, "matrix.json"), JSON.stringify(bins.map((_, i) => i)));
}
