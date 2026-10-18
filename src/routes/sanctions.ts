// OFAC sanctions screening against the US Treasury's Specially Designated Nationals list.
// The list is a US government work in the public domain. Agents that move money check
// counterparties and wallet addresses against it, and few x402 sellers offer it.
// The list is loaded once per isolate for SIX_HOURS, preferably as the mirror's pre-parsed index.
import { entry, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { parseCsv } from "./utils";

// Both OFAC hosts fail the TLS handshake with Workers (HTTP 525), so the first source is the
// unmodified copy that .github/workflows/ofac-mirror.yml publishes every 6 hours; OFAC's own
// URLs stay as fallbacks. listDate is the copy's Last-Modified time.
const MIRROR = "https://github.com/Nutshell2000/agent-data-tools/releases/download/ofac-latest";
const SDN_URLS = [`${MIRROR}/SDN.CSV`, "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV", "https://www.treasury.gov/ofac/downloads/sdn.csv"];
const ALT_URLS = [`${MIRROR}/ALT.CSV`, "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV", "https://www.treasury.gov/ofac/downloads/alt.csv"];
const SIX_HOURS = 6 * 3600;

interface Party { id: string; name: string; type: string; programs: string[] }
interface SdnIndex {
  parties: Map<string, Party>;
  addresses: Map<string, { id: string; currency: string; address: string }[]>;
  names: { id: string; name: string; tokens: Set<string> }[];
  /** Name word → indexes into names, so a name query only scores names sharing its words. */
  byToken: Map<string, number[]>;
  listDate: string | null;
  loadedAt: number;
}
/** The parsed list in plain JSON, published by .github/workflows/ofac-mirror.yml as ofac-index.json. */
export interface CompactIndex {
  v: 1;
  listDate: string | null;
  parties: [id: string, name: string, type: string, programs: string[]][];
  aliases: [id: string, name: string][];
  addresses: [address: string, id: string, currency: string][];
}

/** OFAC writes "-0-" for an empty field. */
const cell = (v: string | undefined) => (v === undefined || v.trim() === "-0-" ? "" : v.trim());
export const normalize = (s: string) => s.toUpperCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => new Set(normalize(s).split(" ").filter((t) => t.length > 1));

/** Parses sdn.csv and alt.csv text into the compact form (slow: run where CPU is cheap). */
export function compactFromCsv(sdnCsv: string, altCsv: string, listDate: string | null = null): CompactIndex {
  const parties: CompactIndex["parties"] = [];
  const known = new Set<string>();
  const addresses: CompactIndex["addresses"] = [];
  for (const row of parseCsv(sdnCsv, ",")) {
    const id = cell(row[0]);
    if (!/^\d+$/.test(id)) continue;
    known.add(id);
    parties.push([id, cell(row[1]), cell(row[2]) || "entity", cell(row[3]).split(/\]\s*\[|[[\]]/).map((p) => p.trim()).filter(Boolean)]);
    for (const m of cell(row[11]).matchAll(/Digital Currency Address - ([A-Z0-9]+)\s+([A-Za-z0-9]+)/g)) addresses.push([m[2], id, m[1]]);
  }
  const aliases: CompactIndex["aliases"] = [];
  for (const row of parseCsv(altCsv, ",")) {
    const id = cell(row[0]);
    const alias = cell(row[3]);
    if (known.has(id) && alias) aliases.push([id, alias]);
  }
  return { v: 1, listDate, parties, aliases, addresses };
}

/** Builds the in-memory lookup tables from the compact form. */
export function fromCompact(c: CompactIndex): SdnIndex {
  const parties = new Map<string, Party>();
  const names: SdnIndex["names"] = [];
  for (const [id, name, type, programs] of c.parties) {
    parties.set(id, { id, name, type, programs });
    names.push({ id, name, tokens: tokens(name) });
  }
  for (const [id, name] of c.aliases) if (parties.has(id)) names.push({ id, name, tokens: tokens(name) });
  const addresses: SdnIndex["addresses"] = new Map();
  for (const [address, id, currency] of c.addresses) {
    const key = address.toLowerCase();
    addresses.set(key, [...(addresses.get(key) ?? []), { id, currency, address }]);
  }
  const byToken = new Map<string, number[]>();
  names.forEach((n, i) => { for (const t of n.tokens) (byToken.get(t) ?? byToken.set(t, []).get(t)!).push(i); });
  return { parties, addresses, names, byToken, listDate: c.listDate, loadedAt: Date.now() };
}

/** Builds the lookup tables straight from sdn.csv and alt.csv text. */
export function buildIndex(sdnCsv: string, altCsv: string, listDate: string | null = null): SdnIndex {
  return fromCompact(compactFromCsv(sdnCsv, altCsv, listDate));
}

let cached: SdnIndex | undefined;
async function sdnIndex(): Promise<SdnIndex> {
  if (cached && Date.now() - cached.loadedAt < SIX_HOURS * 1000) return cached;
  /** The mirror's pre-parsed index: parsing the CSVs here costs most of a second of CPU. */
  const prebuilt = async (): Promise<SdnIndex | null> => {
    try {
      const res = await fetch(`${MIRROR}/ofac-index.json`, { headers: { "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)" }, signal: AbortSignal.timeout(20_000), cf: { cacheTtl: SIX_HOURS } } as RequestInit);
      if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
      const compact = (await res.json()) as CompactIndex;
      return compact?.v === 1 && Array.isArray(compact.parties) ? fromCompact(compact) : null;
    } catch {
      return null;
    }
  };
  /** First source that answers 200; the last failure is reported. */
  const get = async (urls: string[]) => {
    let failure = "the OFAC list could not be downloaded; try again";
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)" }, signal: AbortSignal.timeout(20_000), cf: { cacheTtl: SIX_HOURS } } as RequestInit);
        if (res.ok) return { text: await res.text(), modified: res.headers.get("last-modified") };
        await res.body?.cancel().catch(() => {});
        failure = `the OFAC list download answered HTTP ${res.status}; try again`;
      } catch {
        failure = "the OFAC list could not be downloaded; try again";
      }
    }
    throw new HttpError(502, failure);
  };
  const index = await prebuilt() ?? await (async () => {
    const [sdn, alt] = await Promise.all([get(SDN_URLS), get(ALT_URLS)]);
    return buildIndex(sdn.text, alt.text, sdn.modified ? new Date(sdn.modified).toISOString() : null);
  })();
  // Checked before caching, so a truncated or HTML answer is retried on the next call.
  if (index.parties.size < 1000) throw new HttpError(502, "the OFAC list download looks incomplete; try again");
  cached = index;
  return cached;
}

/** Address hits and name hits (every query word present in a listed name or alias), strongest first. */
export function screen(index: SdnIndex, address: string | undefined, name: string | undefined) {
  const matches: Record<string, unknown>[] = [];
  if (address) {
    for (const hit of index.addresses.get(address.toLowerCase()) ?? []) {
      const p = index.parties.get(hit.id)!;
      matches.push({ sdnId: p.id, name: p.name, type: p.type, programs: p.programs, matchedOn: "address", currency: hit.currency, address: hit.address });
    }
  }
  if (name) {
    const want = tokens(name);
    if (want.size === 0) throw new HttpError(400, "name needs at least one word of two or more letters");
    const best = new Map<string, { score: number; matchedName: string }>();
    // Only names containing the query's rarest word can contain all of its words.
    const postings = [...want].map((t) => index.byToken.get(t) ?? []).sort((x, y) => x.length - y.length);
    for (const i of postings[0] ?? []) {
      const n = index.names[i];
      if (![...want].every((t) => n.tokens.has(t))) continue;
      const score = Math.round((want.size / n.tokens.size) * 100) / 100;
      if ((best.get(n.id)?.score ?? -1) < score) best.set(n.id, { score, matchedName: n.name });
    }
    for (const [id, b] of [...best].sort((a, b) => b[1].score - a[1].score).slice(0, 10)) {
      const p = index.parties.get(id)!;
      matches.push({ sdnId: p.id, name: p.name, type: p.type, programs: p.programs, matchedOn: "name", matchedName: b.matchedName, score: b.score });
    }
  }
  return matches;
}

export const SANCTIONS: Entry[] = [
  entry("/sanctions/check", "OFAC sanctions screening for a wallet or name",
    "Screen a crypto wallet address or a person or company name against the US Treasury OFAC SDN list, including aliases and the listed digital currency addresses (BTC, ETH, USDT, TRX and more). Returns each match with SDN ID, programs and match strength, plus the list date. A screening aid, not legal advice. Use before paying, onboarding or trading with a counterparty.",
    ["sanctions", "ofac", "compliance", "kyc", "aml", "wallet"], {
      address: { type: "string", description: "Crypto address to check (give address, name or both)", example: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96" },
      name: { type: "string", description: "Person or company name; matches when every word appears in a listed name or alias", example: "Lazarus Group" },
    },
    {
      query: { address: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96", name: "Lazarus Group" }, listed: true,
      matches: [
        { sdnId: "…", name: "LAZARUS GROUP", type: "entity", programs: ["DPRK3"], matchedOn: "address", currency: "ETH", address: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96" },
        { sdnId: "…", name: "LAZARUS GROUP", type: "entity", programs: ["DPRK3"], matchedOn: "name", matchedName: "LAZARUS GROUP", score: 1 },
      ],
      list: "OFAC Specially Designated Nationals (SDN)", listDate: "2026-10-17T20:15:00.000Z", entries: 18000,
      note: "Screening aid only: confirm any match against the official OFAC record before acting.",
    },
    async (_env, q) => {
      const address = opt(q, "address", 128)?.trim();
      const name = opt(q, "name", 200)?.trim();
      if (!address && !name) throw new HttpError(400, "address or name is required");
      const index = await sdnIndex();
      const matches = screen(index, address, name);
      return {
        query: { address: address ?? null, name: name ?? null }, listed: matches.length > 0, matches,
        list: "OFAC Specially Designated Nationals (SDN)", listDate: index.listDate, entries: index.parties.size,
        note: "Screening aid only: confirm any match against the official OFAC record before acting.",
      };
    }, "$0.005"),
];
