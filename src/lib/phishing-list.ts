// Phishing blocklists in KV (1.222.0, 18 Nov 2026). Why: on 16-17 Nov one agent routed by Mercator checked about 460 URLs
// and paid six URL-safety providers for every one of them (us, /pack/url-safety, $4.55 of the week's $5.82). The five
// others all answer from a blocklist (MetaMask eth-phishing-detect, Phishing.Database, their own); ours said "heuristic
// signals, not a blocklist". This module gives the pack and /phishing/check two public lists:
//   - Phishing.Database (github.com/Phishing-Database/Phishing.Database, MIT): phishing-domains-ACTIVE.txt, ~390,000 hosts
//     that answered when last tested.
//   - MetaMask eth-phishing-detect (github.com/MetaMask/eth-phishing-detect, "Don't Be a Dick" public licence, which allows
//     any use that credits it): ~120,000 crypto phishing domains, its whitelist (which wins over both lists) and its fuzzylist
//     (brand domains a look-alike imitates).
// Every answer names both sources and the list date. `scripts/build-phishing-list.mjs` cuts them into SHARDS KV values keyed
// by an FNV-1a hash of the domain; a lookup hashes the host and each parent domain and reads only those shards (edge-cached).
// Refresh weekly from the PC: build, then `business/agentic/release/train/upload-phishing.ps1` (staging, production, meta last).

export const SHARDS = 1024;
export const SOURCE_BITS = { phishingDatabase: 1, metamask: 2 } as const;
export const PHISHING_SOURCES = [
  { id: "phishingDatabase", name: "Phishing.Database (active phishing domains)", url: "https://github.com/Phishing-Database/Phishing.Database", licence: "MIT" },
  { id: "metamask", name: "MetaMask eth-phishing-detect", url: "https://github.com/MetaMask/eth-phishing-detect", licence: "DBAD public licence" },
] as const;

export type PhishingMeta = { ver: string; builtAt: string; counts: Record<string, number>; whitelist: string[]; fuzzylist: string[] };

/** FNV-1a, 32 bit: the same in the build script (Node) and the Worker, and fast. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export const shardOf = (domain: string) => fnv1a(domain) % SHARDS;
export const shardKey = (ver: string, i: number) => `phish:${ver}:${i}`;
export const META_KEY = "phish:meta";

/** Lower-case, no trailing dot, no "www."; null when it is not a plausible host name. */
export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/\.$/, "").replace(/^\*\./, "").replace(/^www\./, "");
  if (!d || d.length > 253 || !d.includes(".") || !/^[a-z0-9.-]+$/.test(d) || d.startsWith(".") || d.includes("..")) return null;
  return d;
}

/** The host and each parent with at least two labels: a.b.example.com -> a.b.example.com, b.example.com, example.com. */
export function candidates(host: string): string[] {
  const labels = host.split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out.slice(0, 8);
}

/** A shard is "\n" + lines "domain\tbits" + "\n"; returns the source bits of `domain`, 0 when absent. */
export function bitsInShard(shard: string, domain: string): number {
  const at = shard.indexOf(`\n${domain}\t`);
  if (at < 0) return 0;
  const end = shard.indexOf("\n", at + 1);
  return Number(shard.slice(at + domain.length + 2, end < 0 ? undefined : end)) || 0;
}

/** Levenshtein distance, stopping early above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

type Kv = Pick<KVNamespace, "get">;
export type PhishingVerdict = {
  domain: string; listed: boolean; matchedOn: string | null; sources: string[]; whitelisted: boolean;
  lookalikeOf: string | null; listDate: string; listedDomains: Record<string, number>;
};

/** Looks the host (and its parent domains) up in both lists. Throws a 503 message when the data is not loaded. */
export async function phishingLookup(kv: Kv | null, host: string): Promise<PhishingVerdict> {
  const domain = normalizeDomain(host);
  if (!domain) throw new Error("bad_domain");
  if (!kv) throw new Error("unavailable");
  const metaText = await kv.get(META_KEY, { type: "text", cacheTtl: 3_600 });
  if (!metaText) throw new Error("unavailable");
  const meta = JSON.parse(metaText) as PhishingMeta;
  const names = candidates(domain);
  const whitelisted = names.some((n) => meta.whitelist.includes(n));
  let matchedOn: string | null = null, bits = 0;
  if (!whitelisted) {
    const shards = await Promise.all(names.map((n) => kv.get(shardKey(meta.ver, shardOf(n)), { type: "text", cacheTtl: 3_600 })));
    for (let i = 0; i < names.length; i++) {
      const b = shards[i] ? bitsInShard(shards[i] as string, names[i]) : 0;
      if (b) { matchedOn = names[i]; bits = b; break; }
    }
  }
  // A look-alike of a brand MetaMask watches (etherscan.io, opensea.io…): one or two letters away, not the brand itself.
  const base = names[names.length - 1];
  const lookalikeOf = whitelisted ? null : meta.fuzzylist.find((f) => f !== base && !names.includes(f) && editDistance(base, f, 1) <= 1) ?? null;
  return {
    domain, listed: bits > 0, matchedOn,
    sources: PHISHING_SOURCES.filter((s) => bits & SOURCE_BITS[s.id]).map((s) => s.name),
    whitelisted, lookalikeOf, listDate: meta.builtAt.slice(0, 10), listedDomains: meta.counts,
  };
}
