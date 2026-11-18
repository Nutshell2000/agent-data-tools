// Builds the Workers KV shards for the phishing blocklists (src/lib/phishing-list.ts). Downloads nothing: pass the two files.
//   node scripts/build-phishing-list.mjs <phishing-domains-ACTIVE.txt> <metamask config.json> <out dir>
// Sources: https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt (MIT)
//          https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json (DBAD public licence)
// Output: phish-NNN.json (wrangler bulk-put files, 200 keys each) and phish-meta.json (upload LAST: it switches the version).
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { createRequire } from "node:module";

const [, , pdbFile, mmFile, outDir = "phish-out"] = process.argv;
if (!pdbFile || !mmFile) { console.error("usage: node scripts/build-phishing-list.mjs <phishing-domains-ACTIVE.txt> <config.json> [out dir]"); process.exit(2); }
const require = createRequire(import.meta.url);
const built = await build({ entryPoints: ["src/lib/phishing-list.ts"], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" });
const m = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(m, m.exports, require);
const { SHARDS, SOURCE_BITS, shardOf, shardKey, normalizeDomain, META_KEY } = m.exports;

const mm = JSON.parse(readFileSync(mmFile, "utf8"));
const whitelist = [...new Set((mm.whitelist ?? []).map(normalizeDomain).filter(Boolean))];
const fuzzylist = [...new Set((mm.fuzzylist ?? []).map(normalizeDomain).filter(Boolean))];
const white = new Set(whitelist);
const bits = new Map();
const counts = { phishingDatabase: 0, metamask: 0 };
function add(raw, bit, key) {
  const d = normalizeDomain(raw);
  if (!d || white.has(d)) return;
  const before = bits.get(d) ?? 0;
  if (!(before & bit)) counts[key]++;
  bits.set(d, before | bit);
}
for (const line of readFileSync(pdbFile, "utf8").split(/\r?\n/)) if (line && !line.startsWith("#")) add(line, SOURCE_BITS.phishingDatabase, "phishingDatabase");
for (const d of mm.blacklist ?? []) add(d, SOURCE_BITS.metamask, "metamask");
// A sanity floor: a truncated download must never replace a good list.
if (counts.phishingDatabase < 100_000 || counts.metamask < 50_000) { console.error(`too few domains (${JSON.stringify(counts)}); refusing`); process.exit(1); }

const ver = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const shards = Array.from({ length: SHARDS }, () => []);
for (const [d, b] of bits) shards[shardOf(d)].push(`${d}\t${b}`);
mkdirSync(outDir, { recursive: true });
let batch = [], files = 0, biggest = 0, bytes = 0;
const flush = () => { if (!batch.length) return; writeFileSync(`${outDir}/phish-${String(files++).padStart(3, "0")}.json`, JSON.stringify(batch)); batch = []; };
shards.forEach((lines, i) => {
  const value = `\n${lines.sort().join("\n")}\n`;
  bytes += value.length; biggest = Math.max(biggest, value.length);
  batch.push({ key: shardKey(ver, i), value });
  if (batch.length >= 200) flush();
});
flush();
const meta = { ver, builtAt: new Date().toISOString(), counts: { ...counts, total: bits.size }, whitelist, fuzzylist };
writeFileSync(`${outDir}/phish-meta.json`, JSON.stringify([{ key: META_KEY, value: JSON.stringify(meta) }]));
console.error(`${bits.size} domains (${JSON.stringify(counts)}); ${SHARDS} shards, ${(bytes / 1048576).toFixed(1)} MiB, biggest ${(biggest / 1024).toFixed(0)} KiB; ${files} files + phish-meta.json; version ${ver}`);
