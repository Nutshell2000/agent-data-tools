// Builds the Workers KV shards for /ip/geolocate from DB-IP's "IP to City Lite" CSV (CC BY 4.0; monthly). Downloads nothing.
// Run monthly, then upload every file in order, production and staging (ipgeo-meta.json holds the index: upload it last):
//   node scripts/build-ip-geo.mjs <dbip-city-lite-YYYY-MM.csv.gz> <out dir>
//   npx wrangler kv bulk put --binding TRIALS --remote <out dir>/ipgeo-NN.json   (add -c wrangler.staging.jsonc for staging)
// Afterwards delete the previous month's `ipg:<month>:` keys. CSV rows: ip_start, ip_end, continent, country, stateprov, city,
// latitude, longitude (no header), IPv4 then IPv6 in address order. See src/lib/ip-geo.ts for the bytes.
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { build } from "esbuild";
import { createRequire } from "node:module";

const [, , input, outDir = "ipgeo-out"] = process.argv;
if (!input) { console.error("usage: node scripts/build-ip-geo.mjs <csv.gz> [out dir]"); process.exit(2); }
const require = createRequire(import.meta.url);
const built = await build({ entryPoints: ["src/lib/ip-geo.ts"], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" });
const m = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(m, m.exports, require);
const { parseIp, shardKey, encodeShard } = m.exports;

const month = /(\d{4}-\d{2})/.exec(input)?.[1];
if (!month) { console.error("the file name must hold the month (YYYY-MM)"); process.exit(2); }
const SHARD_BYTES = 256 * 1024, FILE_KEYS = 200; // 200 keys x 256 KiB x 4/3 (base64) stays under wrangler's 100 MB a request
const REC = { 4: 10, 6: 34 };
mkdirSync(outDir, { recursive: true });

const starts = { 4: [], 6: [] };
let batch = [], files = 0, keys = 0, bytes = 0, biggest = 0;
function flushFile() { if (!batch.length) return; writeFileSync(`${outDir}/ipgeo-${String(files++).padStart(3, "0")}.json`, JSON.stringify(batch)); batch = []; }

// One shard being filled, per IP version.
let cur = null;
function closeShard() {
  if (!cur || !cur.ranges.length) return;
  const i = starts[cur.v].length;
  starts[cur.v].push(cur.ranges[0].start.toString(16));
  const bin = encodeShard(cur.v, cur.ranges, cur.locs);
  bytes += bin.length; keys++; if (bin.length > biggest) biggest = bin.length;
  batch.push({ key: shardKey(month, cur.v, i), value: Buffer.from(bin).toString("base64"), base64: true });
  if (batch.length >= FILE_KEYS) flushFile();
  cur = null;
}
function add(v, start, end, loc) {
  if (cur && cur.v !== v) closeShard();
  if (cur && (cur.size >= SHARD_BYTES || cur.locs.length >= 65535)) closeShard();
  if (!cur) cur = { v, ranges: [], locs: [], locIndex: new Map(), size: 4 };
  const lk = JSON.stringify(loc);
  let li = cur.locIndex.get(lk);
  if (li === undefined) { li = cur.locs.length; cur.locs.push(loc); cur.locIndex.set(lk, li); cur.size += Buffer.byteLength(lk) + 1; }
  cur.ranges.push({ start, end, loc: li });
  cur.size += REC[v];
}

// Minimal CSV field split: DB-IP quotes fields that contain commas.
function fields(line) {
  const out = []; let f = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { f += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(f); f = ""; }
    else f += ch;
  }
  out.push(f);
  return out;
}

let rows = 0, skipped = 0, last = { 4: -1n, 6: -1n };
const rl = createInterface({ input: createReadStream(input).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const f = fields(line);
  if (f.length < 8 || f[3] === "ZZ" || !f[3]) { skipped++; continue; } // ZZ: unknown country, no location
  const a = parseIp(f[0]), b = parseIp(f[1]);
  if (!a || !b || a.v !== b.v || b.n < a.n) { skipped++; continue; }
  if (a.n <= last[a.v]) throw new Error(`rows out of order at ${f[0]}: the shards rely on address order`);
  last[a.v] = b.n;
  const lat = Number(f[6]), lon = Number(f[7]);
  add(a.v, a.n, b.n, [f[2], f[3], f[4], f[5], Number.isFinite(lat) ? lat : 0, Number.isFinite(lon) ? lon : 0]);
  rows++;
  if (rows % 1000000 === 0) console.error(`${rows} rows…`);
}
closeShard();
flushFile();
const meta = { month, rows, source: "DB-IP IP to City Lite", licence: "CC BY 4.0", builtAt: new Date().toISOString(), v4: starts[4], v6: starts[6] };
writeFileSync(`${outDir}/ipgeo-meta.json`, JSON.stringify([{ key: "ipgeo:meta", value: JSON.stringify(meta) }]));
console.error(`${rows} rows, ${skipped} skipped; ${keys} shards (${starts[4].length} IPv4, ${starts[6].length} IPv6), ${(bytes / 1048576).toFixed(1)} MiB, biggest ${(biggest / 1024).toFixed(0)} KiB; ${files} files + ipgeo-meta.json (${(JSON.stringify(meta).length / 1024).toFixed(0)} KiB)`);
