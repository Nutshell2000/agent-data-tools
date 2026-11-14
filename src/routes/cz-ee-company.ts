/**
 * Czech and Estonian company registers (14 Nov 2026), siblings of /se, /no, /fi and /fr company: register facts only.
 * Why: the plan to compete with Exa (business/research-2026-11-14-biggest-earners/beat-exa-master-plan.md, Phase 1:
 * more EU registers in /company/search). Both sources are official and keyless.
 * - Czechia: ARES, the Ministry of Finance's public register of economic subjects (ares.gov.cz REST API v3; public
 *   register data, free reuse). Natural persons (the "fyzická osoba" legal forms: sole traders, named after the person)
 *   are refused and left out of searches. Owners, board members and other people are never read.
 * - Estonia: the e-Business Register (Registrite ja Infosüsteemide Keskus, ariregister.rik.ee). Its data has been free
 *   since 2023; the search used here is the register's own public name search, which returns the register code, status,
 *   legal form, address and the register's public page. Sole traders (FIE) are left out.
 * No score, rating or opinion on creditworthiness is computed or implied: the same line as /se/company.
 */
import { entry, getJson, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const NOT_A_CREDIT_REPORT = "Register facts only. This is not a credit report, credit score or rating.";
const UA = "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)";
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
const LEGAL_WORDS = new Set(["as", "ou", "sro", "s", "r", "o", "a", "spol", "vos", "ks", "mtu", "sa", "aktsiaselts", "osauhing", "ltd", "se"]);
const core = (s: string) => words(s).filter((w) => !LEGAL_WORDS.has(w)).join(" ");
const limitOf = (q: Parameters<Entry["run"]>[1]) => num(q, "limit", { min: 1, max: 10, fallback: 5, integer: true });

/** Exact name first, then names holding every query word whole, then names starting with the first word, then shorter. */
export function rankByName<T extends { name: string }>(rows: T[], query: string): T[] {
  const q = words(query).filter((w) => !LEGAL_WORDS.has(w));
  if (!q.length) return rows;
  const want = q.join(" ");
  return rows
    .map((r, i) => {
      const have = words(r.name);
      if (!q.every((w) => have.some((h) => h.startsWith(w)))) return null;
      const exact = core(r.name) === want ? 0 : 1;
      const whole = q.every((w) => have.includes(w)) ? 0 : 1;
      const starts = have[0]?.startsWith(q[0]) ? 0 : 1;
      return { r, score: exact * 10_000 + whole * 1_000 + starts * 100 + Math.min(have.length, 9) * 10, i };
    })
    .filter((x): x is { r: T; score: number; i: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((x) => x.r);
}

// ---------- Czechia (ARES) ----------
const ARES = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty";
const CZ_SOURCE = "ARES, Ministry of Finance of the Czech Republic (public registers)";
/** ARES legal-form codes (číselník Právní forma) for the common forms; any other code is shown as its number. */
const CZ_FORMS: Record<string, string> = {
  "111": "Veřejná obchodní společnost (general partnership)",
  "112": "Společnost s ručením omezeným (limited liability company, s.r.o.)",
  "113": "Komanditní společnost (limited partnership)",
  "117": "Nadace (foundation)",
  "118": "Nadační fond (endowment fund)",
  "121": "Akciová společnost (joint-stock company, a.s.)",
  "141": "Obecně prospěšná společnost (public benefit company)",
  "161": "Ústav (institute, z.ú.)",
  "205": "Družstvo (cooperative)",
  "301": "Státní podnik (state enterprise)",
  "325": "Organizační složka státu (state organisational unit)",
  "331": "Příspěvková organizace (contributory organisation)",
  "421": "Zahraniční osoba (foreign legal person)",
  "706": "Spolek (association)",
  "801": "Obec (municipality)",
  "932": "Evropská společnost (European company, SE)",
};
/** Natural persons: 101-109 (sole traders and other self-employed people) and 424-425 (foreign natural persons). */
export const czIsPerson = (form: string | null | undefined) => /^10\d$/.test(form ?? "") || form === "424" || form === "425";
const czForm = (code: string | null | undefined) => (code ? (Object.hasOwn(CZ_FORMS, code) ? CZ_FORMS[code] : `legal form code ${code}`) : null);

/** IČO check digit: weights 8..2 on the first seven digits, mod 11. */
export function czIcoValid(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  const sum = [...ico.slice(0, 7)].reduce((s, d, i) => s + Number(d) * (8 - i), 0);
  const r = sum % 11;
  const check = r === 0 ? 1 : r === 1 ? 0 : 11 - r;
  return check === Number(ico[7]);
}
/** 00177041, "001 77 041", 177041 (leading zeros dropped) or the VAT form CZ00177041 -> 00177041. */
export function czIcoOf(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/[\s.\-]/g, "");
  if (/^CZ\d{8}$/.test(s)) s = s.slice(2);
  if (/^\d{1,7}$/.test(s)) s = s.padStart(8, "0");
  if (!/^\d{8}$/.test(s)) throw new HttpError(400, "ico must be a Czech identification number (IČO): 8 digits such as 00177041, or a VAT number such as CZ00177041");
  if (!czIcoValid(s)) throw new HttpError(400, "ico fails its check digit; check the number");
  return s;
}

interface AresAddress { textovaAdresa?: string; nazevObce?: string; psc?: number | string; kodStatu?: string; nazevUlice?: string; cisloDomovni?: number; cisloOrientacni?: number }
interface AresSubject {
  ico: string; obchodniJmeno?: string; sidlo?: AresAddress; pravniForma?: string; datumVzniku?: string; datumZaniku?: string;
  datumAktualizace?: string; dic?: string; czNace?: string[]; czNace2008?: string[];
  seznamRegistraci?: Record<string, string>;
}
const reg = (s: AresSubject, key: string) => s.seznamRegistraci?.[key] ?? null;

export function czCompanyView(s: AresSubject) {
  const insolvency = reg(s, "stavZdrojeIr") === "AKTIVNI";
  const vatActive = reg(s, "stavZdrojeDph") === "AKTIVNI";
  const ended = Boolean(s.datumZaniku);
  return {
    ico: s.ico,
    vatNumber: vatActive && s.dic ? s.dic : null,
    name: s.obchodniJmeno ?? null,
    legalForm: s.pravniForma ? { code: s.pravniForma, name: czForm(s.pravniForma) } : null,
    status: ended ? "dissolved" : insolvency ? "registered, insolvency proceedings recorded" : "registered",
    founded: s.datumVzniku ?? null,
    dissolved: s.datumZaniku ?? null,
    inCommercialRegister: reg(s, "stavZdrojeVr") === "AKTIVNI",
    vatRegistered: vatActive,
    insolvencyRecord: insolvency,
    industryCodes: (s.czNace2008 ?? s.czNace ?? []).filter((c) => /^\d{2,5}$/.test(c) && c !== "00").slice(0, 10),
    address: s.sidlo ? { text: s.sidlo.textovaAdresa ?? null, city: s.sidlo.nazevObce ?? null, postcode: s.sidlo.psc != null ? String(s.sidlo.psc) : null, country: s.sidlo.kodStatu ?? "CZ" } : null,
    url: `https://ares.gov.cz/ekonomicke-subjekty?ico=${s.ico}`,
    updated: s.datumAktualizace ?? null,
    source: CZ_SOURCE,
    note: NOT_A_CREDIT_REPORT,
  };
}

async function ares<T>(path: string, body?: unknown): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${ARES}${path}`, {
      method: body ? "POST" : "GET",
      headers: { accept: "application/json", "user-agent": UA, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new HttpError(502, "the Czech register (ARES) did not answer in time; try again, nothing was charged");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `the Czech register (ARES) answered HTTP ${res.status}; try again, nothing was charged`);
  try { return (await res.json()) as T; } catch { throw new HttpError(502, "the Czech register (ARES) sent an unreadable answer"); }
}

export async function czLookup(ico: string) {
  const s = await ares<AresSubject>(`/${ico}`);
  if (!s?.ico) throw new HttpError(404, `no subject with IČO ${ico} in ARES; nothing was charged`);
  if (czIsPerson(s.pravniForma)) throw new HttpError(404, "that IČO belongs to a natural person (a sole trader or other self-employed person); this tool covers companies and other legal persons only; nothing was charged");
  return czCompanyView(s);
}

export interface CzMatch { name: string; ico: string; legalForm: string | null; city: string | null; dissolved?: boolean }
export async function czSearch(name: string, limit: number, city?: string) {
  const r = await ares<{ pocetCelkem?: number; ekonomickeSubjekty?: AresSubject[] }>("/vyhledat", { obchodniJmeno: name, pocet: 100, start: 0 });
  const rows: CzMatch[] = (r?.ekonomickeSubjekty ?? [])
    .filter((s) => s.ico && s.obchodniJmeno && !czIsPerson(s.pravniForma) && !s.datumZaniku)
    .filter((s) => !city || fold(s.sidlo?.nazevObce ?? "").startsWith(fold(city)))
    .map((s) => ({ name: s.obchodniJmeno!, ico: s.ico, legalForm: czForm(s.pravniForma), city: s.sidlo?.nazevObce ?? null }));
  const ranked = rankByName(rows, name);
  if (!ranked.length) throw new HttpError(404, `no current Czech company name holds "${name.slice(0, 60)}"${city ? ` in ${city.slice(0, 40)}` : ""}; nothing was charged`);
  return {
    query: name, ...(city ? { city } : {}), count: Math.min(limit, ranked.length), totalMatches: r?.pocetCelkem ?? ranked.length,
    matches: ranked.slice(0, limit),
    next: "Call again with ico for the full register facts of one company.",
    source: CZ_SOURCE, note: NOT_A_CREDIT_REPORT,
  };
}

// ---------- Estonia (e-Business Register) ----------
const RIK = "https://ariregister.rik.ee/est/api/autocomplete";
const EE_SOURCE = "Estonian e-Business Register (Centre of Registers and Information Systems, RIK)";
/** The register's legal-form numbers as its search returns them (checked 14 Nov 2026 against names of each form). */
const EE_FORMS: Record<string, string> = {
  "1": "Aktsiaselts (public limited company, AS)",
  "2": "Täisühing (general partnership)",
  "4": "Usaldusühing (limited partnership)",
  "5": "Osaühing (private limited company, OÜ)",
  "6": "Tulundusühistu (commercial association)",
  "7": "Mittetulundusühing (non-profit association, MTÜ)",
  "8": "Sihtasutus (foundation, SA)",
  "10": "Välismaa äriühingu filiaal (branch of a foreign company)",
};
/** 3 is FIE, a sole trader: a person's own business, named after the person. */
const EE_PERSON = "3";
const EE_STATUS: Record<string, string> = { R: "registered", L: "in liquidation", N: "in bankruptcy", K: "deleted" };
const eeForm = (code: string | number | null | undefined) => {
  const c = code == null ? "" : String(code);
  return c ? (Object.hasOwn(EE_FORMS, c) ? EE_FORMS[c] : `legal form code ${c}`) : null;
};
const eeStatus = (s: string | null | undefined) => (s && Object.hasOwn(EE_STATUS, s) ? EE_STATUS[s] : s ? `status ${s}` : null);

/** 10137319, "101 373 19" or the VAT-style EE-prefixed code -> 10137319 (Estonian register codes are 8 digits). */
export function eeCodeOf(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[\s.\-]/g, "").replace(/^EE(?=\d{8}$)/, "");
  if (!/^\d{8}$/.test(s)) throw new HttpError(400, "regCode must be an Estonian register code (registrikood): 8 digits such as 10137319");
  return s;
}

interface RikRow { reg_code?: number | string; name?: string; historical_names?: (string | { name?: string })[]; status?: string; legal_address?: string; zip_code?: string; legal_form?: string | number; url?: string }

async function rik(q: string): Promise<RikRow[]> {
  const r = await getJson<{ status?: string; data?: RikRow[] }>(`${RIK}?${new URLSearchParams({ q })}`, { timeoutMs: 8_000 });
  return Array.isArray(r.data) ? r.data : [];
}
/** "Harju maakond, Tallinn, Kesklinna linnaosa, Sadama tn 25": the second part is the town when the first is a county. */
export const eeCity = (address: string | null | undefined) => {
  const parts = (address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  return /maakond$/i.test(parts[0]) ? parts[1] ?? null : parts[0];
};
const histNames = (h: RikRow["historical_names"]) => (h ?? []).map((x) => (typeof x === "string" ? x : x?.name ?? "")).filter(Boolean).slice(0, 10);

export function eeCompanyView(r: RikRow) {
  const code = String(r.reg_code ?? "");
  return {
    regCode: code,
    name: r.name ?? null,
    formerNames: histNames(r.historical_names),
    legalForm: r.legal_form != null ? { code: String(r.legal_form), name: eeForm(r.legal_form) } : null,
    status: eeStatus(r.status),
    address: r.legal_address ? { text: r.legal_address, city: eeCity(r.legal_address), postcode: r.zip_code ?? null, country: "EE" } : null,
    url: r.url ?? `https://ariregister.rik.ee/est/company/${code}`,
    source: EE_SOURCE,
    note: NOT_A_CREDIT_REPORT,
  };
}

export async function eeLookup(code: string) {
  const row = (await rik(code)).find((r) => String(r.reg_code) === code);
  if (!row) throw new HttpError(404, `no entity with register code ${code} in the Estonian e-Business Register; nothing was charged`);
  if (String(row.legal_form) === EE_PERSON) throw new HttpError(404, "that register code belongs to a sole trader (FIE), a person's own business; this tool covers companies and other legal persons only; nothing was charged");
  return eeCompanyView(row);
}

export interface EeMatch { name: string; regCode: string; legalForm: string | null; city: string | null; status: string | null }
export async function eeSearch(name: string, limit: number, city?: string) {
  const rows: EeMatch[] = (await rik(name))
    .filter((r) => r.reg_code != null && r.name && String(r.legal_form) !== EE_PERSON && r.status !== "K")
    .filter((r) => !city || fold(eeCity(r.legal_address) ?? "").startsWith(fold(city)))
    .map((r) => ({ name: r.name!, regCode: String(r.reg_code), legalForm: eeForm(r.legal_form), city: eeCity(r.legal_address), status: eeStatus(r.status) }));
  const ranked = rankByName(rows, name);
  if (!ranked.length) throw new HttpError(404, `no current Estonian company name holds "${name.slice(0, 60)}"${city ? ` in ${city.slice(0, 40)}` : ""}; nothing was charged`);
  return {
    query: name, ...(city ? { city } : {}), count: Math.min(limit, ranked.length),
    matches: ranked.slice(0, limit),
    next: "Call again with regCode for the register facts of one company.",
    source: EE_SOURCE, note: NOT_A_CREDIT_REPORT,
  };
}

// ---------- entries ----------
// Real answers, read live on 14 Nov 2026.
const CZ_EXAMPLE = {
  ico: "00177041", vatNumber: "CZ00177041", name: "Škoda Auto a.s.",
  legalForm: { code: "121", name: "Akciová společnost (joint-stock company, a.s.)" }, status: "registered",
  founded: "1990-11-20", dissolved: null, inCommercialRegister: true, vatRegistered: true, insolvencyRecord: false,
  industryCodes: ["29100", "45200", "471", "47740", "69200", "702", "7219", "74300", "77110", "8532"],
  address: { text: "tř. Václava Klementa 869, Mladá Boleslav II, 29301 Mladá Boleslav", city: "Mladá Boleslav", postcode: "29301", country: "CZ" },
  url: "https://ares.gov.cz/ekonomicke-subjekty?ico=00177041", updated: "2026-10-20",
  source: CZ_SOURCE, note: NOT_A_CREDIT_REPORT,
};
const EE_EXAMPLE = {
  regCode: "10137319", name: "aktsiaselts TALLINNA SADAM", formerNames: [],
  legalForm: { code: "1", name: "Aktsiaselts (public limited company, AS)" }, status: "registered",
  address: { text: "Harju maakond, Tallinn, Kesklinna linnaosa, Sadama tn 25", city: "Tallinn", postcode: "15051", country: "EE" },
  url: "https://ariregister.rik.ee/est/company/10137319/aktsiaselts-TALLINNA-SADAM",
  source: EE_SOURCE, note: NOT_A_CREDIT_REPORT,
};

export const CZ_EE_COMPANY: Entry[] = [
  entry("/cz/company", "Czech company lookup, ARES register",
    "Czech company by IČO (00177041 or VAT CZ00177041) or name, live from ARES, the Czech Ministry of Finance's register of economic subjects: name, legal form, status, founding and dissolution dates, commercial-register, VAT and insolvency-register records, industry codes, registered address. Use to verify a Czech customer or supplier. Register facts only, not a credit report.",
    ["czech-company", "ares", "ico", "company-registry", "kyb", "czechia"], {
      ico: { type: "string", description: "Czech identification number IČO (8 digits) or VAT number CZ… (give ico or name)", example: "00177041" },
      name: { type: "string", description: "Company name to search for, instead of ico: up to 10 current companies whose name holds every word", example: "Skoda Auto" },
      city: { type: "string", description: "With name: only companies whose registered office is in this town", example: "Praha" },
      limit: { type: "integer", description: "Matches for a name search (1-10, default 5)", example: 5 },
    },
    CZ_EXAMPLE,
    async (_env, q) => {
      const raw = opt(q, "ico", 40) ?? opt(q, "vat", 40) ?? opt(q, "id", 40);
      if (raw) return czLookup(czIcoOf(raw));
      const name = opt(q, "name", 120) ?? opt(q, "q", 120);
      if (!name) throw new HttpError(400, "give ico (such as 00177041) or name");
      if (!words(name).length) throw new HttpError(400, "name needs at least one word of two letters or more");
      return czSearch(name, limitOf(q), opt(q, "city", 60));
    }),

  entry("/ee/company", "Estonian company lookup, e-Business Register",
    "Estonian company by register code (registrikood, 10137319) or name, from the Estonian e-Business Register: name, former names, legal form, status (registered, in liquidation, in bankruptcy), registered address and a link to the register's page. Use to verify an Estonian customer or supplier. Register facts only, not a credit report.",
    ["estonian-company", "ariregister", "registrikood", "company-registry", "kyb", "estonia"], {
      regCode: { type: "string", description: "Estonian register code (registrikood, 8 digits) (give regCode or name)", example: "10137319" },
      name: { type: "string", description: "Company name to search for, instead of regCode: up to 10 current companies whose name holds every word", example: "Tallinna Sadam" },
      city: { type: "string", description: "With name: only companies whose registered address is in this town", example: "Tallinn" },
      limit: { type: "integer", description: "Matches for a name search (1-10, default 5)", example: 5 },
    },
    EE_EXAMPLE,
    async (_env, q) => {
      const raw = opt(q, "regCode", 40) ?? opt(q, "regcode", 40) ?? opt(q, "id", 40);
      if (raw) return eeLookup(eeCodeOf(raw));
      const name = opt(q, "name", 120) ?? opt(q, "q", 120);
      if (!name) throw new HttpError(400, "give regCode (such as 10137319) or name");
      if (!words(name).length) throw new HttpError(400, "name needs at least one word of two letters or more");
      return eeSearch(name, limitOf(q), opt(q, "city", 60));
    }),
];

/** The two registers as /company/search name searchers (same shape as SEARCHERS in company-verify.ts). */
export const CZ_EE_SEARCHERS = {
  CZ: { search: (n: string, l: number) => czSearch(n, l), idType: "IČO", id: (m: { ico?: string }) => m.ico, source: CZ_SOURCE },
  EE: { search: (n: string, l: number) => eeSearch(n, l), idType: "registrikood", id: (m: { regCode?: string }) => m.regCode, source: EE_SOURCE },
} as const;
