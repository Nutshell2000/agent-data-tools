/**
 * CVE lookup (10 Nov 2026). Demand measured that day: 35 Coinbase Bazaar listings sell a CVE lookup (463 calls in 30 days,
 * 4-5 distinct payers on each of the six busiest, $0.002-0.02 a call), and Mercator's router sent five such sellers about
 * 170 calls in its 30-day health window; we sold none.
 * Sources, all keyless:
 * - The CVE Program's record API (cveawg.mitre.org, CVE JSON 5; the CVE terms of use allow copying and redistribution):
 *   description, the assigner's CVSS, affected products, weaknesses and references. The record also carries CISA's
 *   enrichment container ("CISA ADP Vulnrichment"): a CVSS score where the assigner gave none, the SSVC decision points
 *   and the Known Exploited Vulnerabilities entry with its date.
 * - FIRST's EPSS API (api.first.org): the modelled probability of exploitation in the next 30 days. Best effort: a slow
 *   or failing EPSS read leaves `epss` null and the call still answers.
 * Not used: NVD's API allows 5 requests per 30 s per address without a key, which Workers' shared egress cannot live on.
 */
import { entry, need, type Entry } from "../family";
import { HttpError } from "../lib/env";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const RECORD_API = "https://cveawg.mitre.org/api/cve/";
const EPSS_API = "https://api.first.org/data/v1/epss?cve=";
const UA = { "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)", accept: "application/json" };
export const CVE_SOURCE = "CVE Program record (cve.org), CISA Vulnrichment and KEV, FIRST EPSS";

/** "CVE-2021-44228", "cve 2021 44228", "2021-44228" or a cve.org / nvd.nist.gov link -> "CVE-2021-44228"; null when no ID is in it. */
export function cveId(raw: string): string | null {
  const m = /(?:^|[^0-9a-z])(?:cve[-_ ]?)?((?:19|20)\d{2})[-_ ](\d{4,7})(?![0-9])/i.exec(` ${raw.trim()}`);
  return m ? `CVE-${m[1]}-${m[2]}` : null;
}

interface Cvss { baseScore?: number; baseSeverity?: string; vectorString?: string; version?: string }
interface Metric { cvssV4_0?: Cvss; cvssV3_1?: Cvss; cvssV3_0?: Cvss; cvssV2_0?: Cvss; other?: { type?: string; content?: Record<string, unknown> } }
interface Version { version?: string; status?: string; lessThan?: string; lessThanOrEqual?: string; changes?: { at?: string; status?: string }[] }
interface Affected { vendor?: string; product?: string; packageName?: string; defaultStatus?: string; versions?: Version[] }
interface Reference { url?: string; name?: string; tags?: string[] }
interface Container {
  title?: string; providerMetadata?: { shortName?: string }; descriptions?: { lang?: string; value?: string }[]; affected?: Affected[];
  references?: Reference[]; metrics?: Metric[]; problemTypes?: { descriptions?: { cweId?: string; description?: string }[] }[];
  rejectedReasons?: { lang?: string; value?: string }[];
}
export interface CveRecord {
  cveMetadata?: { cveId?: string; state?: string; assignerShortName?: string; datePublished?: string; dateUpdated?: string; dateReserved?: string; dateRejected?: string };
  containers?: { cna?: Container; adp?: Container[] };
}
export interface Epss { probability: number; percentile: number; date: string | null }

const CVSS_KEYS = ["cvssV4_0", "cvssV3_1", "cvssV3_0", "cvssV2_0"] as const;
const english = (list?: { lang?: string; value?: string }[]) => (list ?? []).find((d) => /^en/i.test(d.lang ?? "en") && d.value)?.value ?? (list ?? [])[0]?.value ?? null;
const day = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
/** CVSS 2 has no severity word of its own; NVD's bands for it are low under 4, medium under 7, high from 7. */
const v2Severity = (score: number) => (score >= 7 ? "HIGH" : score >= 4 ? "MEDIUM" : "LOW");

/** The newest CVSS version one container holds, as { score, severity, vector, version }. */
function cvssOf(container: Container | undefined) {
  for (const key of CVSS_KEYS) {
    for (const m of container?.metrics ?? []) {
      const c = m[key];
      if (c && typeof c.baseScore === "number") {
        const version = c.version ?? key.replace("cvssV", "").replace("_", ".");
        return { score: c.baseScore, severity: (c.baseSeverity ?? (key === "cvssV2_0" ? v2Severity(c.baseScore) : null))?.toUpperCase() ?? null, vector: c.vectorString ?? null, version };
      }
    }
  }
  return null;
}

const cisa = (r: CveRecord) => (r.containers?.adp ?? []).find((a) => /cisa/i.test(a.providerMetadata?.shortName ?? a.title ?? ""));

/** A record's placeholder for "not stated": n/a, unspecified, unknown, 0 or *. */
const blank = (v?: string) => !v || /^(n\/a|unspecified|unknown|none|0|\*|-)$/i.test(v.trim());

/**
 * One product of the record with its AFFECTED version ranges, or null when the entry names nothing that is affected.
 * Records list unaffected products too (Red Hat names every product line it checked), and old records carry "n/a" for
 * vendor, product and version; neither belongs in a list an agent reads as "this is vulnerable".
 */
function affectedView(a: Affected) {
  const versions = (a.versions ?? []).filter((v) => (v.status ?? a.defaultStatus ?? "affected") === "affected").map((v) => {
    const fixed = (v.changes ?? []).filter((c) => c.status === "unaffected" && c.at).map((c) => c.at as string);
    const upTo = v.lessThan && !blank(v.lessThan) ? ` before ${v.lessThan}` : v.lessThanOrEqual && !blank(v.lessThanOrEqual) ? ` up to and including ${v.lessThanOrEqual}` : "";
    // "version X, lessThan X" is how many assigners write "everything before X".
    const from = blank(v.version) || v.version === v.lessThan ? "" : (v.version as string);
    const range = upTo ? `${from ? `from ${from}` : "all versions"}${upTo}` : from;
    return range ? { range, ...(fixed.length ? { fixedIn: fixed.slice(0, 6) } : {}) } : null;
  }).filter((v): v is { range: string; fixedIn?: string[] } => v !== null).slice(0, 6);
  const vendor = blank(a.vendor) ? null : (a.vendor as string), product = blank(a.product) ? (blank(a.packageName) ? null : (a.packageName as string)) : (a.product as string);
  if (!versions.length && (a.defaultStatus !== "affected" || (!vendor && !product))) return null;
  return { vendor, product, versions: versions.length ? versions : [{ range: "all versions" }] };
}

/** References with the links a patcher wants first: patches and vendor advisories, then the rest in the record's order. */
function referencesView(lists: (Reference[] | undefined)[], max = 12) {
  const seen = new Set<string>(), all: { url: string; tags: string[] }[] = [];
  for (const list of lists) for (const ref of list ?? []) {
    if (!ref.url || seen.has(ref.url)) continue;
    seen.add(ref.url);
    all.push({ url: ref.url, tags: (ref.tags ?? []).map((t) => t.replace(/^x_(refsource_)?/i, "").toLowerCase()).slice(0, 4) });
  }
  const weight = (r: { tags: string[] }) => (r.tags.includes("patch") ? 0 : r.tags.includes("vendor-advisory") ? 1 : r.tags.includes("government-resource") ? 2 : 3);
  return { total: all.length, list: all.map((r, i) => ({ r, i })).sort((x, y) => weight(x.r) - weight(y.r) || x.i - y.i).slice(0, max).map((x) => x.r) };
}

/** One CVE record as the answer a triaging agent needs. `epss` is null when FIRST did not answer. */
export function cveView(r: CveRecord, epss: Epss | null, checkedAt = new Date().toISOString()) {
  const meta = r.cveMetadata ?? {}, cna = r.containers?.cna ?? {}, adp = cisa(r);
  const id = meta.cveId ?? "";
  const links = { cveOrg: `https://www.cve.org/CVERecord?id=${id}`, nvd: `https://nvd.nist.gov/vuln/detail/${id}` };
  if (meta.state === "REJECTED") {
    return { id, state: "REJECTED", rejected: day(meta.dateRejected), reason: clip(english(cna.rejectedReasons) ?? "The CVE Program withdrew this ID.", 600), ...links, source: CVE_SOURCE, checkedAt };
  }
  const own = cvssOf(cna), theirs = cvssOf(adp);
  const cvss = own ? { ...own, scoredBy: meta.assignerShortName ?? "the assigner" } : theirs ? { ...theirs, scoredBy: "CISA" } : null;
  const other = (type: string) => (adp?.metrics ?? []).find((m) => m.other?.type === type)?.other?.content;
  const kev = other("kev") as { dateAdded?: string; reference?: string } | undefined;
  const ssvcOptions = ((other("ssvc") as { options?: Record<string, string>[] } | undefined)?.options ?? []).reduce<Record<string, string>>((acc, o) => ({ ...acc, ...o }), {});
  const cwes = new Map<string, string>();
  for (const c of [cna, adp]) for (const p of c?.problemTypes ?? []) for (const d of p.descriptions ?? []) {
    if (d.cweId && !cwes.has(d.cweId)) cwes.set(d.cweId, (d.description ?? "").replace(new RegExp(`^${d.cweId}:?\\s*`), "") || d.cweId);
  }
  const refs = referencesView([cna.references, adp?.references]);
  const affected = (cna.affected ?? []).map(affectedView).filter((a): a is NonNullable<ReturnType<typeof affectedView>> => a !== null);
  return {
    id, state: meta.state ?? "PUBLISHED", title: cna.title ? clip(cna.title, 200) : null, description: clip(english(cna.descriptions) ?? "", 1500) || null,
    published: day(meta.datePublished), updated: day(meta.dateUpdated), assigner: meta.assignerShortName ?? null,
    cvss,
    knownExploited: kev ? { listed: true, dateAdded: day(kev.dateAdded) ?? kev.dateAdded ?? null, catalog: "CISA KEV" } : { listed: false, dateAdded: null, catalog: "CISA KEV" },
    ssvc: Object.keys(ssvcOptions).length ? { exploitation: ssvcOptions.Exploitation ?? null, automatable: ssvcOptions.Automatable ?? null, technicalImpact: ssvcOptions["Technical Impact"] ?? null } : null,
    epss,
    weaknesses: [...cwes].slice(0, 6).map(([cwe, name]) => ({ cwe, name: clip(name, 120) })),
    affected: affected.slice(0, 8), affectedTotal: affected.length,
    references: refs.list, referencesTotal: refs.total,
    ...links, source: CVE_SOURCE, checkedAt,
  };
}

/** FIRST's EPSS score for one CVE, or null (not scored yet, slow, or failing): never a reason to fail the lookup. */
export async function epssFor(id: string, fetcher: Fetcher = fetch): Promise<Epss | null> {
  try {
    const res = await fetcher(`${EPSS_API}${id}`, { headers: UA, signal: AbortSignal.timeout(3_000), cf: { cacheTtl: 21_600, cacheEverything: true } } as RequestInit);
    if (!res.ok) return null;
    const row = ((await res.json()) as { data?: { epss?: string; percentile?: string; date?: string }[] }).data?.[0];
    const probability = Number(row?.epss), percentile = Number(row?.percentile);
    if (!row || !Number.isFinite(probability) || !Number.isFinite(percentile)) return null;
    return { probability, percentile, date: row.date ?? null };
  } catch {
    return null;
  }
}

/** The CVE record, read once more after a busy answer. 404 means no public record under that ID. */
export async function cveRecord(id: string, fetcher: Fetcher = fetch, sleep: (ms: number) => Promise<unknown> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<CveRecord> {
  const read = () => fetcher(`${RECORD_API}${id}`, { headers: UA, signal: AbortSignal.timeout(8_000), cf: { cacheTtl: 3_600, cacheEverything: true } } as RequestInit);
  let res: Response;
  try {
    res = await read();
    if (res.status === 429 || res.status >= 500) { await res.body?.cancel().catch(() => {}); await sleep(600); res = await read(); }
  } catch {
    throw new HttpError(502, "the CVE Program's record service did not answer in time; not charged, try again");
  }
  if (res.status === 404) throw new HttpError(404, `no public CVE record ${id} (unknown, or reserved and not yet published); nothing was charged`);
  if (res.status === 429) throw new HttpError(503, "the CVE Program's record service is busy; not charged, try again in a minute", "CVE_BUSY");
  if (!res.ok) throw new HttpError(502, `the CVE Program's record service answered HTTP ${res.status}; not charged, try again`);
  try {
    return (await res.json()) as CveRecord;
  } catch {
    throw new HttpError(502, "the CVE Program's record service sent an unreadable answer; not charged, try again");
  }
}

export const CVE: Entry[] = [
  entry("/cve", "CVE lookup: severity, known exploitation, EPSS and fixes for a vulnerability",
    "Look up a CVE by its ID: what the vulnerability is, its CVSS score and severity, whether CISA lists it as exploited in the wild (KEV) and since when, the EPSS probability of exploitation in the next 30 days, CISA's SSVC points, the weakness (CWE), affected products with fixed versions, and patch and advisory links. Use to triage a security alert, rank what to patch first, or check an advisory before upgrading a dependency.",
    ["cve-lookup", "cve", "vulnerability", "kev", "epss", "cvss", "security-advisory", "nvd"], {
      cve: { type: "string", description: "CVE ID such as CVE-2021-44228 (any case; a cve.org or nvd.nist.gov link works too)", required: true, example: "CVE-2021-44228" },
    },
    {
      id: "CVE-2021-44228", state: "PUBLISHED", title: "Apache Log4j2 JNDI features do not protect against attacker controlled LDAP and other JNDI related endpoints",
      description: "Apache Log4j2 2.0-beta9 through 2.15.0 (excluding security releases 2.12.2, 2.12.3, and 2.3.1) JNDI features used in configuration, log messages, and parameters do not protect against attacker controlled LDAP and other JNDI related endpoints. …",
      published: "2021-12-10", updated: "2025-10-21", assigner: "apache",
      cvss: { score: 10, severity: "CRITICAL", vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", version: "3.1", scoredBy: "CISA" },
      knownExploited: { listed: true, dateAdded: "2021-12-10", catalog: "CISA KEV" },
      ssvc: { exploitation: "active", automatable: "yes", technicalImpact: "total" },
      epss: { probability: 0.99999, percentile: 1, date: "2026-11-10" },
      weaknesses: [{ cwe: "CWE-502", name: "Deserialization of Untrusted Data" }],
      affected: [{ vendor: "Apache Software Foundation", product: "Apache Log4j2", versions: [{ range: "from 2.0-beta9 before log4j-core*", fixedIn: ["2.3.1", "2.12.2", "2.15.0"] }] }], affectedTotal: 1,
      references: [{ url: "https://logging.apache.org/log4j/2.x/security.html", tags: [] }], referencesTotal: 54,
      cveOrg: "https://www.cve.org/CVERecord?id=CVE-2021-44228", nvd: "https://nvd.nist.gov/vuln/detail/CVE-2021-44228",
      source: CVE_SOURCE, checkedAt: "2026-11-10T20:40:00.000Z",
    },
    async (_env, q) => {
      const raw = need(q, "cve", 200);
      const id = cveId(raw);
      if (!id) throw new HttpError(400, "cve must be a CVE ID such as CVE-2021-44228");
      const [record, epss] = await Promise.all([cveRecord(id), epssFor(id)]);
      return cveView(record, epss);
    }),
];
