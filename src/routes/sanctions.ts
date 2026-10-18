// OFAC sanctions screening against the US Treasury's Specially Designated Nationals list.
// The list is a US government work in the public domain. Agents that move money check
// counterparties and wallet addresses against it, and few x402 sellers offer it.
// The two CSV files are cached at the edge and parsed once per isolate for SIX_HOURS.
import { entry, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { parseCsv } from "./utils";

// OFAC's Sanctions List Service first; the legacy treasury.gov paths answered HTTP 525 from Workers.
const SDN_URLS = ["https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV", "https://www.treasury.gov/ofac/downloads/sdn.csv"];
const ALT_URLS = ["https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV", "https://www.treasury.gov/ofac/downloads/alt.csv"];
const SIX_HOURS = 6 * 3600;

interface Party { id: string; name: string; type: string; programs: string[] }
interface SdnIndex { parties: Map<string, Party>; addresses: Map<string, { id: string; currency: string; address: string }[]>; names: { id: string; name: string; tokens: Set<string> }[]; listDate: string | null; loadedAt: number }

/** OFAC writes "-0-" for an empty field. */
const cell = (v: string | undefined) => (v === undefined || v.trim() === "-0-" ? "" : v.trim());
export const normalize = (s: string) => s.toUpperCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => new Set(normalize(s).split(" ").filter((t) => t.length > 1));

/** Builds the lookup tables from sdn.csv and alt.csv text. */
export function buildIndex(sdnCsv: string, altCsv: string, listDate: string | null = null): SdnIndex {
  const parties = new Map<string, Party>();
  const addresses: SdnIndex["addresses"] = new Map();
  const names: SdnIndex["names"] = [];
  for (const row of parseCsv(sdnCsv, ",")) {
    const id = cell(row[0]);
    if (!/^\d+$/.test(id)) continue;
    const name = cell(row[1]);
    const party = { id, name, type: cell(row[2]) || "entity", programs: cell(row[3]).split(/\]\s*\[|[[\]]/).map((p) => p.trim()).filter(Boolean) };
    parties.set(id, party);
    names.push({ id, name, tokens: tokens(name) });
    for (const m of cell(row[11]).matchAll(/Digital Currency Address - ([A-Z0-9]+)\s+([A-Za-z0-9]+)/g)) {
      const key = m[2].toLowerCase();
      addresses.set(key, [...(addresses.get(key) ?? []), { id, currency: m[1], address: m[2] }]);
    }
  }
  for (const row of parseCsv(altCsv, ",")) {
    const id = cell(row[0]);
    const alias = cell(row[3]);
    if (parties.has(id) && alias) names.push({ id, name: alias, tokens: tokens(alias) });
  }
  return { parties, addresses, names, listDate, loadedAt: Date.now() };
}

let cached: SdnIndex | undefined;
async function sdnIndex(): Promise<SdnIndex> {
  if (cached && Date.now() - cached.loadedAt < SIX_HOURS * 1000) return cached;
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
  const [sdn, alt] = await Promise.all([get(SDN_URLS), get(ALT_URLS)]);
  const listDate = sdn.modified ? new Date(sdn.modified).toISOString() : null;
  const index = buildIndex(sdn.text, alt.text, listDate);
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
    for (const n of index.names) {
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
