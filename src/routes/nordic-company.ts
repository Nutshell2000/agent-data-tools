/**
 * Norwegian and Finnish company registers (11 Nov 2026), siblings of /se/company: register facts only.
 * - Norway: Brønnøysundregistrene's Enhetsregisteret API (data.brreg.no, NLOD 2.0 open licence, keyless, commercial reuse
 *   allowed with attribution). Sole proprietorships (ENK, a person's own business, usually named after the person) are
 *   refused and left out of searches; phone numbers are never returned (in small companies they are often personal).
 *   The roles endpoint (board members, managers: people) is never called.
 * - Finland: PRH's YTJ open data API v3 (avoindata.prh.fi, CC BY 4.0, keyless). It does not include private traders.
 * Both answered Cloudflare's egress on 11 Nov 2026 (paid staging /url/uptime probes). No score, rating or opinion on
 * creditworthiness is computed or implied: the same line as /se/company.
 */
import { entry, getJson, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const NOT_A_CREDIT_REPORT = "Register facts only. This is not a credit report, credit score or rating.";

// ---------- shared ----------
const fold = (s: string) => s.toLowerCase().replace(/[øæß]/g, (c) => ({ ø: "o", æ: "ae", ß: "ss" })[c] ?? c).normalize("NFKD").replace(/[̀-ͯ]/g, "");
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
/** Exact name first, then names that start with the first word, then shorter names; every query word must prefix a name word. */
/**
 * Order: the exact name, then names holding every word whole ("KIWI NORGE AS" before "KIWISKOLEN AS" for "kiwi"), then
 * trading companies before associations, pension funds and foreign units, then names starting with the first word, then
 * shorter names. `trading` says whether a row is a trading company.
 */
function rankNames<T extends { name: string }>(rows: T[], query: string, trading: (r: T) => boolean): T[] {
  const q = words(query);
  if (!q.length) return rows;
  const core = (ws: string[]) => ws.filter((w) => !LEGAL_SUFFIX.has(w)).join(" ");
  const scored: [T, number][] = [];
  for (const r of rows) {
    const have = words(r.name);
    if (!q.every((w) => have.some((h) => h.startsWith(w)))) continue;
    const exact = core(have) === core(q) ? 0 : 1;
    const whole = q.every((w) => have.includes(w)) ? 0 : 1;
    const kind = trading(r) ? 0 : 1;
    const starts = have[0]?.startsWith(q[0]) ? 0 : 1;
    scored.push([r, exact * 10_000 + whole * 1_000 + kind * 100 + starts * 10 + Math.min(have.length, 9)]);
  }
  return scored.sort((a, b) => a[1] - b[1]).map(([r]) => r);
}
/** Trading company forms: Norway (Brreg codes) and Finland (PRH YRMU numbers). */
const NO_TRADING = new Set(["AS", "ASA", "ANS", "DA", "KS", "SA", "BA", "SE", "IKS", "SF", "NUF", "BBL", "KF"]);
const FI_TRADING = new Set(["5", "13", "14", "15", "16", "17", "20", "22", "23", "24", "80", "83", "84"]);
const LEGAL_SUFFIX = new Set(["as", "asa", "ans", "da", "sa", "oy", "oyj", "ab", "abp", "ky", "ay", "ry", "osk", "ltd", "the"]);
const cityMatch = (want: string | undefined, have: (string | null | undefined)[]) => !want || have.some((c) => c && fold(c).startsWith(fold(want)));
const limitOf = (q: Parameters<Entry["run"]>[1]) => num(q, "limit", { min: 1, max: 10, fallback: 5, integer: true });

// ---------- Norway ----------
const BRREG = "https://data.brreg.no/enhetsregisteret/api";
const NO_SOURCE = "Brønnøysundregistrene, Enhetsregisteret (NLOD 2.0 open licence)";
const PERSON_FORMS = new Set(["ENK"]);

/** Mod-11 check of a 9-digit Norwegian organisasjonsnummer (weights 3 2 7 6 5 4 3 2). */
export function noOrgnrValid(n: string): boolean {
  if (!/^\d{9}$/.test(n)) return false;
  const w = [3, 2, 7, 6, 5, 4, 3, 2];
  const r = 11 - (w.reduce((s, x, i) => s + x * Number(n[i]), 0) % 11);
  const check = r === 11 ? 0 : r;
  return check !== 10 && check === Number(n[8]);
}
/** 923609016, "923 609 016", NO923609016MVA or 923609016MVA -> 923609016. */
export function noOrgnrOf(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/[\s.\-]/g, "");
  s = s.replace(/^NO/, "").replace(/MVA$/, "");
  if (!/^\d{9}$/.test(s)) throw new HttpError(400, "orgnr must be a Norwegian organisasjonsnummer: 9 digits such as 923609016, or a VAT number such as NO923609016MVA");
  if (!noOrgnrValid(s)) throw new HttpError(400, "orgnr fails its check digit; check the number");
  return s;
}

interface BrregAddress { adresse?: string[]; postnummer?: string; poststed?: string; land?: string; landkode?: string }
interface BrregUnit {
  organisasjonsnummer: string; navn?: string; organisasjonsform?: { kode?: string; beskrivelse?: string };
  registreringsdatoEnhetsregisteret?: string; stiftelsesdato?: string; registrertIMvaregisteret?: boolean; registrertIForetaksregisteret?: boolean;
  naeringskode1?: { kode?: string; beskrivelse?: string }; naeringskode2?: { kode?: string; beskrivelse?: string }; naeringskode3?: { kode?: string; beskrivelse?: string };
  antallAnsatte?: number; harRegistrertAntallAnsatte?: boolean; forretningsadresse?: BrregAddress; postadresse?: BrregAddress; hjemmeside?: string;
  konkurs?: boolean; underAvvikling?: boolean; underTvangsavviklingEllerTvangsopplosning?: boolean; underRekonstruksjonsforhandling?: boolean;
  overordnetEnhet?: string; sisteInnsendteAarsregnskap?: string; aktivitet?: string[]; vedtektsfestetFormaal?: string[]; slettedato?: string;
  historiskeNavn?: { navn?: string; fraDato?: string; tilDato?: string }[];
}
const noAddress = (a?: BrregAddress) => (a ? { street: (a.adresse ?? []).filter(Boolean).join(", ") || null, postcode: a.postnummer ?? null, city: a.poststed ?? null, country: a.landkode ?? null } : null);
const fmtNo = (n: string) => `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;

export function noCompanyView(u: BrregUnit) {
  const proceedings = [
    u.konkurs && "bankruptcy (konkurs)",
    u.underRekonstruksjonsforhandling && "reconstruction negotiation (rekonstruksjonsforhandling)",
    u.underAvvikling && "liquidation (under avvikling)",
    u.underTvangsavviklingEllerTvangsopplosning && "compulsory liquidation or dissolution (tvangsavvikling eller tvangsoppløsning)",
  ].filter((x): x is string => Boolean(x));
  const status = u.slettedato ? "deleted" : proceedings.length ? `registered, ${proceedings[0].split(" (")[0]} in progress` : "registered";
  return {
    orgnr: u.organisasjonsnummer,
    formatted: fmtNo(u.organisasjonsnummer),
    vatNumber: u.registrertIMvaregisteret ? `NO${u.organisasjonsnummer}MVA` : null,
    name: u.navn ?? null,
    formerNames: (u.historiskeNavn ?? []).map((h) => ({ name: h.navn ?? null, until: h.tilDato?.slice(0, 10) ?? null })).filter((h) => h.name).slice(-10),
    legalForm: u.organisasjonsform?.kode ? { code: u.organisasjonsform.kode, name: u.organisasjonsform.beskrivelse ?? null } : null,
    status,
    proceedings,
    deleted: u.slettedato ?? null,
    registered: u.registreringsdatoEnhetsregisteret ?? null,
    founded: u.stiftelsesdato ?? null,
    inBusinessRegister: u.registrertIForetaksregisteret ?? null,
    vatRegistered: u.registrertIMvaregisteret ?? null,
    employees: u.harRegistrertAntallAnsatte ? u.antallAnsatte ?? null : null,
    industries: [u.naeringskode1, u.naeringskode2, u.naeringskode3].filter((c) => c?.kode).map((c) => ({ code: c!.kode!, description: c!.beskrivelse ?? null })),
    purpose: (u.vedtektsfestetFormaal ?? u.aktivitet ?? []).join(" ").replace(/\s+/g, " ").trim().slice(0, 600) || null,
    address: noAddress(u.forretningsadresse) ?? noAddress(u.postadresse),
    website: u.hjemmeside ?? null,
    parentOrgnr: u.overordnetEnhet ?? null,
    lastAnnualAccountsYear: u.sisteInnsendteAarsregnskap ?? null,
    source: NO_SOURCE,
    note: NOT_A_CREDIT_REPORT,
  };
}

async function brreg<T>(url: string): Promise<{ status: number; body: T | null }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)" }, signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new HttpError(502, "the Norwegian register did not answer in time; try again, nothing was charged");
  }
  if (res.status === 404) return { status: 404, body: null };
  // A deleted unit answers 410 Gone with its record (slettedato).
  if (!res.ok && res.status !== 410) throw new HttpError(502, `the Norwegian register answered HTTP ${res.status}; try again, nothing was charged`);
  try { return { status: res.status, body: (await res.json()) as T }; } catch { throw new HttpError(502, "the Norwegian register sent an unreadable answer"); }
}

export async function noLookup(orgnr: string) {
  const r = await brreg<BrregUnit>(`${BRREG}/enheter/${orgnr}`);
  if (!r.body) throw new HttpError(404, `no company with organisasjonsnummer ${fmtNo(orgnr)} in Enhetsregisteret; nothing was charged`);
  if (r.body.organisasjonsform?.kode && PERSON_FORMS.has(r.body.organisasjonsform.kode)) throw new HttpError(404, "that number is a sole proprietorship (enkeltpersonforetak), a person's own business; this tool covers companies and other legal persons only; nothing was charged");
  return noCompanyView(r.body.slettedato || r.status === 410 ? { ...r.body, slettedato: r.body.slettedato ?? "deleted" } : r.body);
}

export async function noSearch(name: string, limit: number, city?: string) {
  const r = await brreg<{ _embedded?: { enheter?: BrregUnit[] }; page?: { totalElements?: number } }>(`${BRREG}/enheter?${new URLSearchParams({ navn: name, size: "100" })}`);
  const rows = (r.body?._embedded?.enheter ?? [])
    .filter((u) => !PERSON_FORMS.has(u.organisasjonsform?.kode ?? ""))
    .filter((u) => cityMatch(city, [u.forretningsadresse?.poststed, u.postadresse?.poststed]))
    .map((u) => ({ name: u.navn ?? "", orgnr: u.organisasjonsnummer, legalForm: u.organisasjonsform?.beskrivelse ?? null, formCode: u.organisasjonsform?.kode ?? null, city: u.forretningsadresse?.poststed ?? u.postadresse?.poststed ?? null, bankrupt: u.konkurs ?? false }));
  const ranked = rankNames(rows, name, (r) => NO_TRADING.has(r.formCode ?? "")).map(({ formCode: _f, ...r }) => r);
  if (!ranked.length) throw new HttpError(404, `no Norwegian company name holds "${name.slice(0, 60)}"${city ? ` in ${city.slice(0, 40)}` : ""}; nothing was charged`);
  return {
    query: name, ...(city ? { city } : {}), count: Math.min(limit, ranked.length), totalMatches: r.body?.page?.totalElements ?? ranked.length,
    matches: ranked.slice(0, limit),
    next: "Call again with orgnr for the full register facts of one company.",
    source: NO_SOURCE, note: NOT_A_CREDIT_REPORT,
  };
}

// ---------- Finland ----------
const PRH = "https://avoindata.prh.fi/opendata-ytj-api/v3/companies";
const FI_SOURCE = "Finnish Patent and Registration Office (PRH), YTJ open data (CC BY 4.0)";
/** Private traders (yksityinen elinkeinonharjoittaja) are people; PRH leaves them out, and so does this tool if one appears. */
const FI_PERSON_FORMS = new Set(["26"]);

/** Y-tunnus check digit: weights 7 9 10 5 8 4 2, mod 11; remainder 1 is never issued. */
export function fiIdValid(id: string): boolean {
  const m = /^(\d{7})-(\d)$/.exec(id);
  if (!m) return false;
  const w = [7, 9, 10, 5, 8, 4, 2];
  const r = w.reduce((s, x, i) => s + x * Number(m[1][i]), 0) % 11;
  if (r === 1) return false;
  return (r === 0 ? 0 : 11 - r) === Number(m[2]);
}
/** 0112038-9, 01120389, FI01120389 (the VAT form) or an old six-digit body with its check digit (112038-9) -> 0112038-9. */
export function fiIdOf(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/[\s.]/g, "");
  if (/^FI\d{8}$/.test(s)) s = s.slice(2);
  if (/^\d{8}$/.test(s)) s = `${s.slice(0, 7)}-${s.slice(7)}`;
  if (/^\d{6}-\d$/.test(s)) s = `0${s}`;
  if (!/^\d{7}-\d$/.test(s)) throw new HttpError(400, "businessId must be a Finnish business ID (Y-tunnus) such as 0112038-9, or a VAT number such as FI01120389");
  if (!fiIdValid(s)) throw new HttpError(400, "businessId fails its check digit; check the number");
  return s;
}

type Described = { type?: string | number; descriptions?: { languageCode?: string; description?: string }[]; registrationDate?: string; endDate?: string; register?: string };
interface PrhAddress { type?: number; street?: string; buildingNumber?: string; postCode?: string; postOfficeBox?: string; postOffices?: { city?: string; languageCode?: string }[] }
interface PrhCompany {
  businessId: { value: string; registrationDate?: string }; names?: { name: string; type: string; registrationDate?: string; endDate?: string }[];
  mainBusinessLine?: { type?: string; descriptions?: { languageCode?: string; description?: string }[] }; website?: { url?: string };
  companyForms?: Described[]; companySituations?: Described[]; registeredEntries?: Described[]; addresses?: PrhAddress[];
  tradeRegisterStatus?: string; status?: string; registrationDate?: string; endDate?: string; lastModified?: string;
}
const english = (d?: { descriptions?: { languageCode?: string; description?: string }[] }) => d?.descriptions?.find((x) => x.languageCode === "3")?.description ?? d?.descriptions?.[0]?.description ?? null;
const current = <T extends { endDate?: string }>(xs: T[] | undefined) => (xs ?? []).filter((x) => !x.endDate);
const fiCity = (a?: PrhAddress) => a?.postOffices?.find((p) => p.languageCode === "1")?.city ?? a?.postOffices?.[0]?.city ?? null;
const fiAddress = (a?: PrhAddress) => (a ? { street: [a.street, a.buildingNumber].filter(Boolean).join(" ") || (a.postOfficeBox ? `PL ${a.postOfficeBox}` : null), postcode: a.postCode || null, city: fiCity(a), country: "FI" } : null);
// The registers PRH reports a company in (REK code list), by number.
const FI_REGISTERS: Record<string, string> = { "1": "trade register", "2": "foundation register", "3": "register of associations", "4": "tax administration", "5": "prepayment register", "6": "VAT register", "7": "employer register", "8": "insurance premium tax register" };

export function fiCompanyView(c: PrhCompany) {
  const names = current(c.names);
  const main = names.find((n) => n.type === "1") ?? names[0];
  const entries = current(c.registeredEntries);
  const inRegister = (reg: string) => entries.some((e) => e.register === reg);
  const proceedings = current(c.companySituations).map((s) => ({ code: String(s.type ?? ""), type: english(s), since: s.registrationDate ?? null }));
  const form = current(c.companyForms)[0] ?? c.companyForms?.[0];
  const ended = Boolean(c.endDate);
  return {
    businessId: c.businessId.value,
    vatNumber: inRegister("6") ? `FI${c.businessId.value.replace("-", "")}` : null,
    name: main?.name ?? null,
    otherNames: names.filter((n) => n !== main).sort((a, b) => Number(a.type) - Number(b.type)).map((n) => ({ name: n.name, type: n.type === "2" ? "parallel name" : n.type === "3" ? "auxiliary name" : "name" })).slice(0, 15),
    formerNames: (c.names ?? []).filter((n) => n.endDate && n.type === "1").map((n) => ({ name: n.name, until: n.endDate ?? null })).slice(0, 10),
    legalForm: form ? { code: String(form.type ?? ""), name: english(form) } : null,
    status: ended ? "ended" : proceedings.length ? `registered, ${(proceedings[0].type ?? "proceedings").toLowerCase()} in progress` : c.tradeRegisterStatus === "1" || inRegister("1") ? "registered" : "registered (not in the trade register)",
    ended: c.endDate ?? null,
    proceedings,
    registered: c.businessId.registrationDate ?? c.registrationDate ?? null,
    registers: [...new Set(entries.map((e) => (e.register && Object.hasOwn(FI_REGISTERS, e.register) ? FI_REGISTERS[e.register] : null)).filter((x): x is string => Boolean(x)))],
    vatRegistered: inRegister("6"),
    employerRegistered: inRegister("7"),
    industry: c.mainBusinessLine?.type ? { code: c.mainBusinessLine.type, description: english(c.mainBusinessLine) } : null,
    address: fiAddress(c.addresses?.find((a) => a.type === 1)) ?? fiAddress(c.addresses?.find((a) => a.type === 2)),
    website: c.website?.url ?? null,
    source: FI_SOURCE,
    note: NOT_A_CREDIT_REPORT,
  };
}

const isPerson = (c: PrhCompany) => (c.companyForms ?? []).some((f) => FI_PERSON_FORMS.has(String(f.type ?? "")));

export async function fiLookup(id: string) {
  const r = await getJson<{ companies?: PrhCompany[] }>(`${PRH}?${new URLSearchParams({ businessId: id })}`, { timeoutMs: 8_000 });
  const c = r.companies?.[0];
  if (!c || isPerson(c)) throw new HttpError(404, `no company with business ID ${id} in PRH's open data; nothing was charged`);
  return fiCompanyView(c);
}

export async function fiSearch(name: string, limit: number, city?: string) {
  // PRH answers a name search in business-ID order, one page of about 70, so a brand's own company can sit pages away
  // ("kone": 11,959 matches, KONE Oyj not on page 1). The same words plus "Oy" and "Oyj" are asked at the same time.
  const ask = (n: string) => {
    const params = new URLSearchParams({ name: n });
    if (city) params.set("location", city);
    return getJson<{ totalResults?: number; companies?: PrhCompany[] }>(`${PRH}?${params}`, { timeoutMs: 10_000 });
  };
  const hasForm = words(name).some((w) => LEGAL_SUFFIX.has(w));
  const [r, ...extra] = await Promise.all([ask(name), ...(hasForm ? [] : [`${name} Oyj`, `${name} Oy`].map((n) => ask(n).catch(() => ({ companies: [] as PrhCompany[] }))))]);
  const seen = new Set<string>();
  const rows = [...extra.flatMap((x) => x.companies ?? []), ...(r.companies ?? [])]
    .filter((c) => !seen.has(c.businessId.value) && Boolean(seen.add(c.businessId.value)))
    .filter((c) => !isPerson(c) && !c.endDate)
    .map((c) => {
      const main = current(c.names).find((n) => n.type === "1") ?? current(c.names)[0];
      const addr = c.addresses?.find((a) => a.type === 1) ?? c.addresses?.[0];
      return { name: main?.name ?? "", businessId: c.businessId.value, legalForm: english(current(c.companyForms)[0]), formCode: String(current(c.companyForms)[0]?.type ?? ""), city: fiCity(addr) };
    })
    .filter((x) => x.name && cityMatch(city, [x.city]));
  const ranked = rankNames(rows, name, (r) => FI_TRADING.has(r.formCode)).map(({ formCode: _f, ...r }) => r);
  if (!ranked.length) throw new HttpError(404, `no current Finnish company name holds "${name.slice(0, 60)}"${city ? ` in ${city.slice(0, 40)}` : ""}; nothing was charged`);
  return {
    query: name, ...(city ? { city } : {}), count: Math.min(limit, ranked.length), totalMatches: r.totalResults ?? ranked.length,
    matches: ranked.slice(0, limit),
    next: "Call again with businessId for the full register facts of one company.",
    source: FI_SOURCE, note: NOT_A_CREDIT_REPORT,
  };
}

// ---------- entries ----------
const NO_EXAMPLE = {
  orgnr: "923609016", formatted: "923 609 016", vatNumber: "NO923609016MVA", name: "EQUINOR ASA",
  formerNames: [{ name: "Den norske stats oljeselskap a.s", until: "2001-05-11" }, { name: "STATOIL ASA", until: "2007-10-01" }, { name: "STATOILHYDRO ASA", until: "2009-11-02" }, { name: "STATOIL ASA", until: "2018-05-16" }],
  legalForm: { code: "ASA", name: "Allmennaksjeselskap" }, status: "registered", proceedings: [], deleted: null,
  registered: "1995-03-12", founded: "1972-09-18", inBusinessRegister: true, vatRegistered: true, employees: 21231,
  industries: [{ code: "06.100", description: "Utvinning av råolje" }, { code: "06.200", description: "Utvinning av naturgass" }, { code: "19.200", description: "Produksjon av raffinerte petroleumsprodukter og fossile brenselsprodukter" }],
  purpose: "Å utvikle, produsere og markedsføre ulike former for energi, avledede produkter og tjenester, samt annen virksomhet. Virksomheten kan også drives gjennom deltakelse i eller i samarbeid med andre selskaper.",
  address: { street: "Forusbeen 50", postcode: "4035", city: "STAVANGER", country: "NO" }, website: "www.equinor.com", parentOrgnr: null, lastAnnualAccountsYear: "2025",
  source: NO_SOURCE, note: NOT_A_CREDIT_REPORT,
};
const FI_EXAMPLE = {
  businessId: "0112038-9", vatNumber: "FI01120389", name: "Nokia Oyj",
  otherNames: [{ name: "Nokia Abp", type: "parallel name" }, { name: "Nokia Corporation", type: "parallel name" }, { name: "Nokia Networks", type: "auxiliary name" }],
  formerNames: [{ name: "Oy Nokia Ab", until: "1997-08-31" }],
  legalForm: { code: "17", name: "Public limited company" }, status: "registered", ended: null, proceedings: [], registered: "1978-03-15",
  registers: ["trade register", "prepayment register", "VAT register", "employer register", "tax administration"], vatRegistered: true, employerRegistered: true,
  industry: { code: "70100", description: "Activities of head offices" }, address: { street: "Karakaari 7", postcode: "02610", city: "ESPOO", country: "FI" }, website: "www.nokia.com",
  source: FI_SOURCE, note: NOT_A_CREDIT_REPORT,
};

export const NORDIC_COMPANY: Entry[] = [
  entry("/no/company", "Norwegian company lookup, Brønnøysund register",
    "Norwegian company by organisasjonsnummer (923609016 or NO923609016MVA) or name, live from Brønnøysundregistrene: name, former names, legal form, status, bankruptcy, liquidation or reconstruction, registration and founding dates, VAT and business-register status, employees, industry codes, purpose, address, website. Use to verify a Norwegian customer or supplier. Register facts only, not a credit report.",
    ["norwegian-company", "brreg", "organisasjonsnummer", "company-registry", "kyb", "norway"], {
      orgnr: { type: "string", description: "Norwegian organisasjonsnummer (9 digits) or VAT number NO…MVA (give orgnr or name)", example: "923609016" },
      name: { type: "string", description: "Company name to search for, instead of orgnr: up to 10 companies whose name holds every word", example: "Equinor" },
      city: { type: "string", description: "With name: only companies whose address is in this city (poststed)", example: "Oslo" },
      limit: { type: "integer", description: "Matches for a name search (1-10, default 5)", example: 5 },
    },
    NO_EXAMPLE,
    async (_env, q) => {
      const raw = opt(q, "orgnr", 40) ?? opt(q, "vat", 40) ?? opt(q, "id", 40);
      if (raw) return noLookup(noOrgnrOf(raw));
      const name = opt(q, "name", 120) ?? opt(q, "q", 120);
      if (!name) throw new HttpError(400, "give orgnr (such as 923609016) or name");
      if (!words(name).length) throw new HttpError(400, "name needs at least one word of two letters or more");
      return noSearch(name, limitOf(q), opt(q, "city", 60));
    }),

  entry("/fi/company", "Finnish company lookup, PRH trade register",
    "Finnish company by business ID (Y-tunnus 0112038-9 or VAT FI01120389) or name, live from the Finnish Patent and Registration Office (PRH): names incl. parallel and former, legal form, status, bankruptcy, liquidation or re-organisation, registration date, trade, VAT and employer registers, main business line, address, website. Use to verify a Finnish customer or supplier. Register facts only, not a credit report.",
    ["finnish-company", "prh", "y-tunnus", "company-registry", "kyb", "finland"], {
      businessId: { type: "string", description: "Finnish business ID (Y-tunnus, 1234567-8) or VAT number FI12345678 (give businessId or name)", example: "0112038-9" },
      name: { type: "string", description: "Company name to search for, instead of businessId: up to 10 current companies whose name holds every word", example: "Nokia" },
      city: { type: "string", description: "With name: only companies registered in this town (Finnish or Swedish name)", example: "Helsinki" },
      limit: { type: "integer", description: "Matches for a name search (1-10, default 5)", example: 5 },
    },
    FI_EXAMPLE,
    async (_env, q) => {
      const raw = opt(q, "businessId", 40) ?? opt(q, "vat", 40) ?? opt(q, "id", 40);
      if (raw) return fiLookup(fiIdOf(raw));
      const name = opt(q, "name", 120) ?? opt(q, "q", 120);
      if (!name) throw new HttpError(400, "give businessId (such as 0112038-9) or name");
      if (!words(name).length) throw new HttpError(400, "name needs at least one word of two letters or more");
      return fiSearch(name, limitOf(q), opt(q, "city", 60));
    }),
];
