#!/usr/bin/env node
// Builds the Swedish company shards that /se/company reads, from the two free weekly bulk files of
// Bolagsverket's "värdefulla datamängder" (EU high-value datasets: no agreement, commercial reuse allowed):
//   bolagsverket_bulkfil.txt  (UTF-8, ";"-separated, quoted): names, legal form, registration, deregistration,
//                             ongoing bankruptcy/liquidation/reconstruction, business description, postal address
//   scb_bulkfil_*.txt         (Latin-1, tab-separated): SCB's activity flag (VAT, F-tax or employer), SNI codes
// .github/workflows/se-company-mirror.yml runs it every week and publishes the output as release assets.
//
// Only legal persons (organisationsnummer) are written. Sole traders are identified by a personnummer and are
// left out entirely, as are c/o lines (often a private person's name): the tool shows register facts about
// companies, never about people, and it is not a credit report (no score, rating or opinion).
//
// Usage: node scripts/build-se-company-index.mjs <bolagsverket.txt> <outDir> [scb.txt ...]
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

/** Shard count: prime, below GitHub's 1,000 assets per release with the manifest. Keep equal to SHARDS in src/routes/se-company.ts. */
export const SHARDS = 509;

/** Which shard holds an organisationsnummer (10 digits). */
export const shardOf = (orgnr) => Number(orgnr.slice(0, 9)) % SHARDS;

/** Name normalisation shared with the Worker: lower case, diacritics off, legal-form words dropped. */
const LEGAL_WORDS = new Set(["ab", "aktiebolag", "aktiebolaget", "publ", "hb", "kb", "handelsbolag", "kommanditbolag", "ek", "for", "forening", "ekonomisk", "ideell", "brf", "bostadsrattsforening", "stiftelsen", "stiftelse", "med", "firma", "i", "och", "the", "&"]);
export const nameWords = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !LEGAL_WORDS.has(w));

/** The name-index shard of a word: by its first three letters, so a search for "spot" or "spotify" lands in one shard. */
export const nameShardOf = (word) => {
  const key = word.slice(0, 3);
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % SHARDS;
};

/** Splits one ";"-separated line of quoted fields ("" is a literal quote). Returns null while a quote is still open. */
export function splitQuoted(line) {
  const out = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let v = "";
      i++;
      for (;;) {
        if (i >= line.length) return null;
        // Bolagsverket escapes a quote inside a field as \" (seen in names and descriptions, Nov 2026).
        if (line[i] === "\\" && line[i + 1] === '"') { v += '"'; i += 2; continue; }
        if (line[i] === '"') {
          if (line[i + 1] === '"') { v += '"'; i += 2; continue; }
          i++;
          break;
        }
        v += line[i++];
      }
      out.push(v);
      if (line[i] === ";") i++;
      else if (i < line.length) return null;
      else break;
    } else {
      const j = line.indexOf(";", i);
      if (j === -1) { out.push(line.slice(i)); break; }
      out.push(line.slice(i, j));
      i = j + 1;
      if (i === line.length) { out.push(""); break; }
    }
  }
  return out;
}

const code = (v) => (v ? v.split("-")[0] : null);

/** One Bolagsverket row as the compact record the Worker reads, or null for a person or a malformed row. */
export function bolagsverketRecord(f) {
  const [identity, , , names, form, deregDate, deregReason, proceedings, regDate, description, address] = f;
  const [orgnr, idType] = (identity ?? "").split("$");
  if (idType !== "ORGNR-IDORG" || !/^\d{10}$/.test(orgnr ?? "")) return null;
  const rec = { o: orgnr };
  const n = (names ?? "").split("|").map((x) => x.split("$")).filter((x) => x[0]).map(([name, type, date]) => [name.trim(), code(type), date || null]);
  if (n.length) rec.n = n;
  if (form) rec.f = code(form);
  if (regDate) rec.r = regDate;
  if (deregDate) rec.d = deregDate;
  if (deregReason) rec.dr = code(deregReason);
  const p = (proceedings ?? "").split("|").map((x) => x.split("$")).filter((x) => x[0]).map(([c, since]) => [code(c), since || null]);
  if (p.length) rec.p = p;
  // A deregistered company keeps its facts but not its description: that keeps the shards about a third smaller.
  if (description && !deregDate) rec.b = description.trim().slice(0, 500);
  if (address) {
    // street $ c/o $ city $ postcode $ country. The c/o line is dropped: it is often a private person's name.
    const [street, , city, postcode] = address.split("$");
    if (street || city || postcode) rec.a = [street || null, postcode || null, city || null];
  }
  return rec;
}

/** One SCB row (header-mapped) as the fields merged into the record, or null for a natural person. */
export function scbFields(row) {
  const id = row.PeOrgNr ?? "";
  if (!/^16\d{10}$/.test(id)) return null;
  const sni = ["Ng1", "Ng2", "Ng3", "Ng4", "Ng5"].map((k) => row[k]).filter((v) => v && /^\d{5}$/.test(v) && v !== "00000");
  const out = { o: id.slice(2) };
  if (row.FtgStat !== undefined && row.FtgStat !== "") out.s = Number(row.FtgStat);
  if (row.JEStat) out.j = Number(row.JEStat);
  if (row.JurForm) out.jf = row.JurForm;
  if (sni.length) out.sni = sni;
  if (row.Namn) out.sn = row.Namn.trim();
  if (row.Gatuadress || row.PostNr || row.PostOrt) out.sa = [row.Gatuadress?.trim() || null, row.PostNr?.trim() || null, row.PostOrt?.trim() || null];
  return out;
}

async function* lines(path, encoding) {
  const rl = createInterface({ input: createReadStream(path, { encoding }), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

async function main() {
  const [bvPath, outDir, ...scbPaths] = process.argv.slice(2);
  if (!bvPath || !outDir) throw new Error("usage: build-se-company-index.mjs <bolagsverket.txt> <outDir> [scb.txt ...]");
  /** @type {Map<string, any>} */
  const records = new Map();
  let bvRows = 0, persons = 0, broken = 0;
  let header = true, pending = "";
  for await (const raw of lines(bvPath, "utf8")) {
    if (header) { header = false; continue; }
    const line = pending ? `${pending}\n${raw}` : raw;
    const f = splitQuoted(line);
    if (!f) { pending = line; if (pending.length > 20_000) { broken++; pending = ""; } continue; }
    pending = "";
    bvRows++;
    const rec = bolagsverketRecord(f);
    if (!rec) { persons++; continue; }
    const prev = records.get(rec.o);
    // Several rows for one number happen when names are protected per running number; keep every name.
    if (prev) prev.n = [...(prev.n ?? []), ...(rec.n ?? [])];
    else records.set(rec.o, rec);
  }
  let scbRows = 0, scbOnly = 0;
  for (const p of scbPaths) {
    let cols = null;
    for await (const raw of lines(p, "latin1")) {
      const parts = raw.split("\t");
      if (!cols) { cols = parts.map((c) => c.trim()); continue; }
      const row = Object.fromEntries(cols.map((c, i) => [c, parts[i]]));
      const s = scbFields(row);
      if (!s) continue;
      scbRows++;
      const rec = records.get(s.o);
      if (rec) Object.assign(rec, { s: s.s, j: s.j, jf: s.jf, sni: s.sni });
      else {
        // In SCB's register but not Bolagsverket's (municipalities, non-trading associations, foundations…).
        scbOnly++;
        records.set(s.o, { o: s.o, n: s.sn ? [[s.sn, "SCB", null]] : undefined, a: s.sa, s: s.s, j: s.j, jf: s.jf, sni: s.sni });
      }
    }
  }
  if (records.size < Number(process.env.SE_MIN_RECORDS ?? 100_000)) throw new Error(`only ${records.size} records: refusing to publish a truncated register`);

  mkdirSync(outDir, { recursive: true });
  const shards = Array.from({ length: SHARDS }, () => ({}));
  const names = Array.from({ length: SHARDS }, () => []);
  for (const rec of records.values()) {
    for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
    const { o, ...rest } = rec;
    shards[shardOf(o)][o] = rest;
    // Name index: registered, not deregistered. Each of the first four words of each name points to the company.
    if (rec.d || rec.j === 9 || !rec.n) continue;
    for (const [name] of rec.n.slice(0, 3)) {
      const seen = new Set();
      for (const w of nameWords(name).slice(0, 4)) {
        if (w.length < 2) continue;
        const s = nameShardOf(w);
        if (seen.has(s)) continue;
        seen.add(s);
        names[s].push([name, o, rec.f ?? rec.jf ?? null]);
      }
    }
  }
  // Two files, each the gzip shards back to back, with every shard's [offset, length] in the manifest: the Worker
  // reads one shard with an HTTP Range request. One file per kind instead of 1,018 assets keeps the weekly upload
  // under GitHub's limit of about 500 uploads an hour. The tag makes every build's file names new, so a manifest
  // never points into a file that a later build is overwriting (the workflow keeps the previous build's files).
  const dataAsOf = process.env.SE_DATA_AS_OF || new Date().toISOString().slice(0, 10);
  const tag = process.env.SE_FILE_TAG || dataAsOf;
  const pack = (kind, parts) => {
    const file = `se-${kind}-${tag}.bin`;
    const index = [];
    const bufs = [];
    let offset = 0;
    for (const part of parts) {
      const gz = gzipSync(JSON.stringify(part), { level: 9 });
      index.push([offset, gz.length]);
      bufs.push(gz);
      offset += gz.length;
    }
    writeFileSync(join(outDir, file), Buffer.concat(bufs));
    return { file, bytes: offset, index };
  };
  const companies = pack("companies", shards);
  const nameIndex = pack("names", names);
  const manifest = {
    dataAsOf, shards: SHARDS, companies: records.size, bolagsverketRows: bvRows, skippedPersons: persons, unreadableRows: broken, scbRows, scbOnly, builtAt: new Date().toISOString(),
    files: { companies, names: nameIndex },
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest));
  const { files: _files, ...summary } = manifest;
  console.log(JSON.stringify({ ...summary, companyBytes: companies.bytes, nameBytes: nameIndex.bytes }));
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/").replace(/^(?=[A-Za-z]:)/, "/")}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
