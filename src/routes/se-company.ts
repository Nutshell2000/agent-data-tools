// Swedish company register lookup: Bolagsverket's and SCB's free weekly bulk files ("värdefulla datamängder", the
// EU high-value datasets: no agreement, commercial reuse allowed). .github/workflows/se-company-mirror.yml downloads
// them on GitHub's servers every week, scripts/build-se-company-index.mjs turns them into SHARDS gzip shards by
// organisationsnummer plus a name index, and publishes both as release assets, which this tool reads (the OFAC pattern).
//
// Register facts only, about legal persons only: sole traders (identified by a personnummer) and c/o lines are not in
// the data. No score, rating, grade or opinion on creditworthiness is computed or implied: under the Swedish Credit
// Information Act (kreditupplysningslagen 2 §) that would be a credit report, which needs a permit we do not hold.
// Keep every word of the copy to "register facts"; never add a risk verdict here.
import { entry, flag, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { vatParts, viesCheck } from "./registries";

/** Keep equal to SHARDS in scripts/build-se-company-index.mjs (tests/se-company.test.cjs checks both). */
export const SHARDS = 509;
const MIRROR = "https://github.com/Nutshell2000/agent-data-tools/releases/download";
const RELEASE = `${MIRROR}/se-register`;
const SOURCE = "Bolagsverket and SCB open data (värdefulla datamängder), weekly bulk files";
const NOT_A_CREDIT_REPORT = "Register facts only. This is not a credit report, credit score or rating.";

export const shardOf = (orgnr: string) => Number(orgnr.slice(0, 9)) % SHARDS;

const LEGAL_WORDS = new Set(["ab", "aktiebolag", "aktiebolaget", "publ", "hb", "kb", "handelsbolag", "kommanditbolag", "ek", "for", "forening", "ekonomisk", "ideell", "brf", "bostadsrattsforening", "stiftelsen", "stiftelse", "med", "firma", "i", "och", "the", "&"]);
export const nameWords = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !LEGAL_WORDS.has(w));
export const nameShardOf = (word: string) => {
  let h = 0;
  for (const c of word.slice(0, 3)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % SHARDS;
};

/** Luhn check of a 10-digit organisationsnummer (the last digit checks the nine before it). */
export function orgnrValid(n: string): boolean {
  if (!/^\d{10}$/.test(n)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(n[i]) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * The 10-digit organisationsnummer in what a caller sends: 556703-7485, 5567037485, 16 5567037485, or the Swedish VAT
 * number SE556703748501. A 12-digit number starting 19 or 20 is a personnummer (a sole trader): refused, never looked up.
 */
export function orgnrOf(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/[\s\-.]/g, "");
  if (/^SE\d{12}$/.test(s)) s = s.slice(2, 12);
  if (/^(19|20)\d{10}$/.test(s)) throw new HttpError(400, "that is a personal identity number; this tool covers companies and other legal persons only");
  if (/^16\d{10}$/.test(s)) s = s.slice(2);
  if (!/^\d{10}$/.test(s)) throw new HttpError(400, "orgnr must be a Swedish organisationsnummer: 10 digits such as 556703-7485, or a VAT number such as SE556703748501");
  if (Number(s[2]) < 2) throw new HttpError(400, "that number is a personal identity number, not an organisationsnummer (its third digit is 0 or 1); this tool covers companies only");
  if (!orgnrValid(s)) throw new HttpError(400, "orgnr fails its check digit; check the number");
  return s;
}

const FORMS: Record<string, string> = {
  AB: "Aktiebolag (limited company)", BAB: "Bankaktiebolag (bank)", BF: "Bostadsförening (housing association)", BFL: "Utländsk banks filial (foreign bank branch)",
  BRF: "Bostadsrättsförening (housing cooperative)", E: "Enskild näringsverksamhet (sole trader)", EB: "Enkla bolag (simple partnership)", EEIG: "Europeisk ekonomisk intressegruppering (EEIG)",
  EGTS: "Europeisk gruppering för territoriellt samarbete (EGTC)", EK: "Ekonomisk förening (economic association)", FAB: "Försäkringsaktiebolag (insurance company)", FF: "Försäkringsförmedlare (insurance intermediary)",
  FL: "Filial (branch of a foreign company)", FOF: "Försäkringsförening (insurance association)", HB: "Handelsbolag (trading partnership)", I: "Ideell förening (non-profit association, trading)",
  KB: "Kommanditbolag (limited partnership)", KHF: "Kooperativ hyresrättsförening (cooperative tenancy association)", MB: "Medlemsbank (member bank)", OFB: "Ömsesidigt försäkringsbolag (mutual insurer)",
  OTPB: "Ömsesidigt tjänstepensionsbolag (mutual occupational pension company)", S: "Stiftelse (foundation, trading)", SB: "Sparbank (savings bank)", SCE: "Europakooperativ (SCE)",
  SE: "Europabolag (Societas Europaea)", SF: "Sambruksförening (joint farming association)", TPAB: "Tjänstepensionsaktiebolag (occupational pension company)", TPF: "Tjänstepensionsförening (occupational pension association)",
  TSF: "Trossamfund (religious community, trading)",
};
/** SCB's legal-form codes, for companies that are only in SCB's register. */
const SCB_FORMS: Record<string, string> = {
  "21": "Enkla bolag (simple partnership)", "22": "Partrederi (shipping partnership)", "23": "Värdepappersfond (investment fund)", "31": "Handelsbolag or kommanditbolag (partnership)",
  "32": "Gruvbolag (mining company)", "41": "Bankaktiebolag (bank)", "42": "Försäkringsaktiebolag (insurance company)", "43": "Europabolag (Societas Europaea)", "49": "Aktiebolag (limited company)",
  "51": "Ekonomisk förening (economic association)", "53": "Bostadsrättsförening (housing cooperative)", "54": "Kooperativ hyresrättsförening", "55": "Europakooperativ or grouping",
  "61": "Ideell förening (non-profit association)", "62": "Samfällighet (joint property association)", "63": "Registrerat trossamfund (religious community)", "71": "Familjestiftelse (family foundation)",
  "72": "Stiftelse or fond (foundation)", "81": "Statlig enhet (state body)", "82": "Kommun (municipality)", "83": "Kommunalförbund (municipal association)", "84": "Region",
  "85": "Allmän försäkringskassa", "87": "Offentlig korporation (public corporation)", "88": "Hypoteksförening", "89": "Regional statlig myndighet (regional state authority)",
  "92": "Ömsesidigt försäkringsbolag (mutual insurer)", "93": "Sparbank (savings bank)", "94": "Understödsförening", "95": "Arbetslöshetskassa (unemployment fund)",
  "96": "Utländsk juridisk person (foreign legal person)", "98": "Other Swedish legal person under special law", "99": "Legal form not determined",
};
const DEREG_REASONS: Record<string, string> = {
  AKEJH: "share capital not raised", ARSEED: "annual report missing", AVREG: "deregistered", BABAKEJH: "converted to a bank or share capital not raised", DELAV: "division",
  DOM: "decision of an authority or court", FUAV: "merger", GROMAV: "cross-border conversion", KKAV: "bankruptcy", LIAV: "liquidation", NYINN: "new holder", OMAV: "conversion",
  OMBAB: "converted to a bank", OVERK: "inactivity", UTLKKLI: "the foreign company's liquidation or bankruptcy", VDSAK: "no managing director", VERKUPP: "business has ceased",
};
const PROCEEDINGS: Record<string, string> = {
  AC: "composition negotiation (ackord)", DEOL: "transferring company in a division", DEOT: "receiving company in a division", FR: "company reconstruction (företagsrekonstruktion)",
  FUOL: "transferring company in a merger", FUOT: "receiving company in a merger", GROM: "cross-border conversion", KK: "bankruptcy (konkurs)", LI: "liquidation (likvidation)", OM: "conversion", RES: "resolution",
};
const NAME_TYPES: Record<string, string> = { FORETAGSNAMN: "registered name", NAMN: "name", FORNAMN_FRSPRAK: "name in a foreign language", SARS_FORNAMN: "secondary business name", SCB: "name in SCB's register" };
const own = <T>(table: Record<string, T>, key: string | undefined | null): T | undefined => (key && Object.hasOwn(table, key) ? table[key] : undefined);

/** One record as the build script writes it (short keys keep the shards small). */
export interface SeRecord {
  n?: [string, string | null, string | null][]; f?: string; r?: string; d?: string; dr?: string; p?: [string, string | null][];
  b?: string; a?: [string | null, string | null, string | null]; s?: number; j?: number; jf?: string; sni?: string[];
}

const isoDate = (d: string | null | undefined) => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d ?? null);
const formatted = (o: string) => `${o.slice(0, 6)}-${o.slice(6)}`;

/** The answer for one record: plain register facts in English, with the Swedish terms kept where they are the names. */
export function companyView(orgnr: string, r: SeRecord, dataAsOf: string | null) {
  const names = (r.n ?? []).map(([name, type, since]) => ({ name, type: own(NAME_TYPES, type) ?? type ?? "name", since: isoDate(since) }));
  const primary = names.find((n) => n.type === "registered name") ?? names[0];
  const proceedings = (r.p ?? []).map(([c, since]) => ({ code: c, type: own(PROCEEDINGS, c) ?? c, since: isoDate(since) }));
  const deregistered = r.d || r.j === 9 ? { date: isoDate(r.d) ?? null, reason: r.dr ? own(DEREG_REASONS, r.dr) ?? r.dr : null } : null;
  const insolvency = proceedings.find((p) => ["KK", "LI", "FR", "AC", "RES"].includes(p.code));
  const status = deregistered ? "deregistered" : insolvency ? `registered, ${insolvency.type.split(" (")[0]} in progress` : "registered";
  const form = r.f ? { code: r.f, name: own(FORMS, r.f) ?? r.f } : r.jf ? { code: `SCB ${r.jf}`, name: own(SCB_FORMS, r.jf) ?? r.jf } : null;
  return {
    orgnr: formatted(orgnr),
    vatNumber: `SE${orgnr}01`,
    name: primary?.name ?? null,
    otherNames: names.filter((n) => n !== primary),
    legalForm: form,
    status,
    registered: isoDate(r.r),
    deregistered,
    proceedings,
    // SCB's company status: active means registered for VAT, F-tax (business tax) or as an employer.
    taxActive: r.s === 1 ? true : r.s === 0 || r.s === 9 ? false : null,
    industries: (r.sni ?? []).map((c) => ({ sni: `${c.slice(0, 2)}.${c.slice(2)}` })),
    businessDescription: r.b ?? null,
    address: r.a ? { street: r.a[0], postcode: r.a[1], city: r.a[2], country: "SE" } : null,
    dataAsOf,
    source: SOURCE,
    note: NOT_A_CREDIT_REPORT,
  };
}

async function gunzipJson<T>(res: Response): Promise<T> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  // A cache or proxy may already have decompressed it: gzip starts 1f 8b.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(bytes)) as T;
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text) as T;
}

type Fetcher = typeof fetch;
interface PackFile { file: string; bytes: number; index: [number, number][] }
interface Manifest { dataAsOf?: string; shards?: number; files?: { companies?: PackFile; names?: PackFile } }
const UA = { "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)" };
const busy = (why: string) => new HttpError(503, `the Swedish company register copy ${why}; try again later, nothing was charged`);

async function get(url: string, fetcher: Fetcher, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetcher(url, { ...init, headers: { ...UA, ...(init.headers as Record<string, string> | undefined) }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
  } catch {
    throw busy("did not answer in time");
  }
}

let manifestMemo: { at: number; value: Manifest } | null = null;
/** The newest build's manifest: file names and each shard's byte range. Kept an hour per isolate. */
async function loadManifest(fetcher: Fetcher): Promise<Manifest> {
  if (manifestMemo && Date.now() - manifestMemo.at < 3_600_000) return manifestMemo.value;
  const res = await get(`${RELEASE}/manifest.json`, fetcher, { cf: { cacheTtl: 3_600 } } as RequestInit);
  if (res.status === 404) throw busy("is being published");
  if (!res.ok) throw busy(`answered HTTP ${res.status}`);
  let value: Manifest;
  try { value = (await res.json()) as Manifest; } catch { throw busy("was unreadable"); }
  if (!value.files?.companies || !value.files?.names || value.shards !== SHARDS) throw busy("is being rebuilt");
  manifestMemo = { at: Date.now(), value };
  return value;
}

/**
 * One shard, read with an HTTP Range request from the build's single file and kept a week in the edge cache under the
 * build's own file name (a new build has new names, so nothing stale is ever served from the cache).
 */
async function readShard<T>(kind: "companies" | "names", i: number, fetcher: Fetcher): Promise<{ data: T; asOf: string | null }> {
  const m = await loadManifest(fetcher);
  const f = m.files![kind]!;
  const range = Object.hasOwn(f.index, i) ? f.index[i] : undefined;
  if (!range) throw busy("is incomplete");
  const [offset, length] = range;
  const store = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`https://se-company.cache.invalid/${f.file}/${i}`);
  let res = store ? await store.match(key).catch(() => undefined) : undefined;
  if (!res) {
    const got = await get(`${RELEASE}/${f.file}`, fetcher, { headers: { range: `bytes=${offset}-${offset + length - 1}` } });
    // A 200 would be the whole file (about 150 MB): never read it.
    if (got.status !== 206) { await got.body?.cancel().catch(() => {}); throw busy(got.status === 404 ? "is being published" : `answered HTTP ${got.status}`); }
    const bytes = new Uint8Array(await got.arrayBuffer());
    if (bytes.length !== length) throw busy("sent a short answer");
    res = new Response(bytes, { headers: { "cache-control": "public, max-age=604800" } });
    if (store) await store.put(key, res.clone()).catch(() => {});
  }
  try {
    return { data: await gunzipJson<T>(res), asOf: m.dataAsOf ?? null };
  } catch {
    throw busy("was unreadable");
  }
}
export async function lookupOrgnr(orgnr: string, fetcher: Fetcher = fetch) {
  const { data: shard, asOf } = await readShard<Record<string, SeRecord>>("companies", shardOf(orgnr), fetcher);
  const rec = Object.hasOwn(shard, orgnr) ? shard[orgnr] : undefined;
  if (!rec) throw new HttpError(404, `no company with organisationsnummer ${formatted(orgnr)} in Bolagsverket's or SCB's register; nothing was charged`);
  return companyView(orgnr, rec, asOf);
}

/** Name search: registered companies whose name holds every word asked for, the ones starting with the words first. */
export async function searchName(name: string, limit: number, fetcher: Fetcher = fetch) {
  const words = nameWords(name).filter((w) => w.length >= 2);
  if (!words.length) throw new HttpError(400, "name needs at least one word of two letters or more besides the legal form (AB, HB…)");
  // The longest word narrows most; its shard holds every name containing a word that starts with its first three letters.
  const key = [...words].sort((a, b) => b.length - a.length)[0];
  const { data: index, asOf } = await readShard<[string, string, string | null][]>("names", nameShardOf(key), fetcher);
  const seen = new Set<string>();
  const hits: { name: string; orgnr: string; legalForm: string | null; rank: number }[] = [];
  for (const [display, orgnr, form] of index) {
    if (seen.has(orgnr)) continue;
    const have = nameWords(display);
    if (!words.every((w) => have.some((h) => h.startsWith(w)))) continue;
    seen.add(orgnr);
    const exact = have.join(" ") === words.join(" ") ? 0 : have[0]?.startsWith(words[0]) ? 1 : 2;
    // Companies in Bolagsverket's register (letter form codes) before SCB-only entries such as foreign legal persons (96).
    const scbOnly = form && /^\d+$/.test(form) ? 500 : 0;
    hits.push({ name: display, orgnr, legalForm: form, rank: exact * 1000 + scbOnly + have.length });
  }
  if (!hits.length) throw new HttpError(404, `no registered Swedish company name holds "${name.slice(0, 60)}"; nothing was charged`);
  hits.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "sv"));
  return {
    query: name,
    count: Math.min(hits.length, limit),
    totalMatches: hits.length,
    matches: hits.slice(0, limit).map((h) => ({
      name: h.name, orgnr: formatted(h.orgnr),
      legalForm: h.legalForm ? own(FORMS, h.legalForm) ?? own(SCB_FORMS, h.legalForm) ?? h.legalForm : null,
    })),
    next: "Call again with orgnr for the full register facts of one company.",
    dataAsOf: asOf,
    source: SOURCE,
    note: NOT_A_CREDIT_REPORT,
  };
}

const EXAMPLE = {
  orgnr: "556703-7485", vatNumber: "SE556703748501", name: "Spotify AB", otherNames: [], legalForm: { code: "AB", name: "Aktiebolag (limited company)" },
  // The tool's own answer for orgnr=556703-7485 on 11 Nov 2026 (data of 9 Nov).
  status: "registered", registered: "2006-05-10", deregistered: null, proceedings: [], taxActive: true, industries: [{ sni: "60.100" }],
  businessDescription: "Bolaget har till föremål för sin verksamhet att bedriva Internetrelaterade tjänster inom digitala medier som musik, spel och TV, samt att, direkt eller indirekt, äga och förvalta fast och lös egendom, äga aktier och andelar i dotterbolag och andra bolag samt tillhandahålla administrativa tjänster för dessa bolag och därmed förenlig verksamhet.",
  address: { street: "Regeringsgatan 19", postcode: "11153", city: "STOCKHOLM", country: "SE" },
  vat: null, dataAsOf: "2026-11-09", source: SOURCE, note: NOT_A_CREDIT_REPORT,
};

export const SE_COMPANY: Entry[] = [
  entry("/se/company", "Swedish company lookup, Bolagsverket register",
    "Swedish company by organisationsnummer (556703-7485 or SE556703748501) or name, from Bolagsverket and SCB: names, legal form, registration date, status, deregistration, bankruptcy, liquidation or reconstruction, VAT/F-tax/employer activity, SNI codes, business description, address. Weekly open data. Use to verify a Swedish customer or supplier before invoicing. Register facts only, not a credit report.",
    ["swedish-company", "bolagsverket", "organisationsnummer", "company-registry", "kyb", "sweden"], {
      orgnr: { type: "string", description: "Swedish organisationsnummer (10 digits, with or without the hyphen) or Swedish VAT number (give orgnr or name)", example: "556703-7485" },
      name: { type: "string", description: "Company name to search for, instead of orgnr: up to 10 registered companies whose name holds every word", example: "Spotify" },
      checkVat: { type: "string", description: "true to also check the VAT number live in the EU VIES service (adds about a second)", example: "false" },
      limit: { type: "integer", description: "Matches for a name search (1-10, default 5)", example: 5 },
    },
    EXAMPLE,
    async (_env, q) => {
      const raw = opt(q, "orgnr", 40) ?? opt(q, "vat", 40) ?? opt(q, "id", 40);
      const name = opt(q, "name", 120) ?? opt(q, "q", 120);
      if (!raw && !name) throw new HttpError(400, "give orgnr (such as 556703-7485) or name");
      if (!raw) {
        const limitRaw = opt(q, "limit", 4);
        const limit = Math.min(10, Math.max(1, Number.isInteger(Number(limitRaw)) && limitRaw ? Number(limitRaw) : 5));
        return searchName(name!, limit);
      }
      const orgnr = orgnrOf(raw);
      const view = await lookupOrgnr(orgnr);
      let vat: unknown = null;
      if (flag(q, "checkVat")) {
        const parts = vatParts(view.vatNumber);
        vat = parts ? await viesCheck(parts).then((v) => ({ valid: v.valid, name: v.name ?? null, checkedAt: v.checkedAt, source: v.source }), () => ({ valid: null, note: "VIES did not answer; the register facts above are unaffected" })) : null;
      }
      const { dataAsOf: asOf, source, note, ...facts } = view;
      return { ...facts, vat, dataAsOf: asOf, source, note };
    }),
];
