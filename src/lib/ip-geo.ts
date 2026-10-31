// IP geolocation data layout (1.84.1, 31 Oct 2026). Source: DB-IP "IP to City Lite" (db-ip.com, CC BY 4.0: attribution
// and a link back are required and every answer carries them). `scripts/build-ip-geo.mjs` cuts the monthly CSV into Workers
// KV shards of about 256 KiB, in address order, and writes `ipgeo:meta` last: the month and each shard's first address per IP
// version. A lookup reads the meta, finds the shard, reads it and binary-searches it: two KV reads (edge-cached a day), no
// outside request. Fixed prefixes do not work: 2603::/16 alone is 27.9 MiB (KV's limit is 25 MiB), and ranges that span
// prefixes produced 57,000 keys. R2 is not enabled on the account.
//
// Shard bytes: u32 count | count records | UTF-8 JSON of the location table. IPv4 record: u32 start, u32 end, u16 loc.
// IPv6 record: u64 start-hi, u64 start-lo, u64 end-hi, u64 end-lo, u16 loc. All big-endian. Location: [continent, country,
// region, city, lat, lon].

export type Loc = [string, string, string, string, number, number];
export type Range = { start: bigint; end: bigint; loc: number };

export function parseIp(ip: string): { v: 4 | 6; n: bigint } | null {
  const s = ip.trim();
  if (/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s)) {
    return { v: 4, n: s.split(".").reduce((a, p) => (a << 8n) + BigInt(p), 0n) };
  }
  if (!s.includes(":") || !/^[0-9a-fA-F:.]+$/.test(s) || (s.match(/::/g) ?? []).length > 1) return null;
  // IPv4-mapped tail (::ffff:1.2.3.4) becomes two groups.
  let body = s;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) { const v4 = parseIp(tail[1]); if (!v4) return null; const hex = v4.n.toString(16).padStart(8, "0"); body = s.slice(0, -tail[1].length) + hex.slice(0, 4) + ":" + hex.slice(4); }
  const halves = body.split("::");
  const head = halves[0] ? halves[0].split(":") : [], rest = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length > 1 && head.length + rest.length > 7) return null;
  const groups = [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest];
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return { v: 6, n: groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g, 16)), 0n) };
}

/** Private, loopback, link-local, multicast, documentation and other ranges that have no location. */
export function isReservedIp(v: 4 | 6, n: bigint): boolean {
  if (v === 4) {
    const a = Number(n >> 24n), b = Number((n >> 16n) & 255n);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 192 && b === 0 && Number((n >> 8n) & 255n) === 2) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const top = Number(n >> 112n);
  return n === 0n || n === 1n || (top & 0xfe00) === 0xfc00 || (top & 0xffc0) === 0xfe80 || (top & 0xff00) === 0xff00 || top === 0x2001 && Number((n >> 96n) & 0xffffn) === 0x0db8 || n >> 32n === 0xffffn /* ::ffff:v4: callers should send the IPv4 */;
}

/** The KV key of shard `i`: the month keeps a monthly upload from mixing with the index still in use until the index is replaced. */
export const shardKey = (month: string, v: 4 | 6, i: number) => `ipg:${month}:${v}:${i}`;
/** Index of the last shard whose first address is at or below `n`, or -1. `starts` are hex strings in ascending order. */
export function shardIndex(starts: readonly string[], n: bigint): number {
  let lo = 0, hi = starts.length - 1, hit = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (BigInt("0x" + starts[mid]) <= n) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
  return hit;
}

const REC = { 4: 10, 6: 34 } as const;
const enc = new TextEncoder(), dec = new TextDecoder();

export function encodeShard(v: 4 | 6, ranges: Range[], locs: Loc[]): Uint8Array {
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const json = enc.encode(JSON.stringify(locs));
  const out = new Uint8Array(4 + sorted.length * REC[v] + json.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, sorted.length);
  let o = 4;
  for (const r of sorted) {
    if (v === 4) { dv.setUint32(o, Number(r.start)); dv.setUint32(o + 4, Number(r.end)); dv.setUint16(o + 8, r.loc); }
    else { dv.setBigUint64(o, r.start >> 64n); dv.setBigUint64(o + 8, r.start & 0xffffffffffffffffn); dv.setBigUint64(o + 16, r.end >> 64n); dv.setBigUint64(o + 24, r.end & 0xffffffffffffffffn); dv.setUint16(o + 32, r.loc); }
    o += REC[v];
  }
  out.set(json, o);
  return out;
}

/** Binary search of one shard; null when no range holds the address. */
export function findInShard(v: 4 | 6, shard: ArrayBuffer | Uint8Array, n: bigint): { loc: Loc; start: bigint; end: bigint } | null {
  const bytes = shard instanceof Uint8Array ? shard : new Uint8Array(shard);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(0);
  const size = REC[v];
  const startAt = (i: number) => v === 4 ? BigInt(dv.getUint32(4 + i * size)) : (dv.getBigUint64(4 + i * size) << 64n) + dv.getBigUint64(4 + i * size + 8);
  const endAt = (i: number) => v === 4 ? BigInt(dv.getUint32(4 + i * size + 4)) : (dv.getBigUint64(4 + i * size + 16) << 64n) + dv.getBigUint64(4 + i * size + 24);
  let lo = 0, hi = count - 1, hit = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (startAt(mid) <= n) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
  if (hit < 0 || endAt(hit) < n) return null;
  const loc = dv.getUint16(4 + hit * size + (v === 4 ? 8 : 32));
  const locs = JSON.parse(dec.decode(bytes.subarray(4 + count * size))) as Loc[];
  return locs[loc] ? { loc: locs[loc], start: startAt(hit), end: endAt(hit) } : null;
}

export const bigToIp = (v: 4 | 6, n: bigint) => v === 4
  ? [24n, 16n, 8n, 0n].map((s) => Number((n >> s) & 255n)).join(".")
  : Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(112 - 16 * i)) & 0xffffn).toString(16)).join(":").replace(/(^|:)0(:0)+(:|$)/, "::");
