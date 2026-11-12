/**
 * French company register (12 Nov 2026), sibling of /se/company, /no/company and /fi/company: register facts only.
 * Source: the State's "API Recherche d'entreprises" (recherche-entreprises.api.gouv.fr: Sirene from INSEE plus the RNE,
 * Licence Ouverte 2.0, keyless, about 7 requests a second per address). It answered Cloudflare's egress on 11 Nov 2026.
 * - Sole traders (entrepreneurs individuels, legal category 1xxx) are named after the person: asked for server-side never
 *   (est_entrepreneur_individuel=false), refused on lookup, and dropped again if one slips through.
 * - Units with partial diffusion (statut_diffusion other than "O", the owner's legal opt-out) are never shown.
 * - Directors (dirigeants, people), financial figures and coordinates in the answer are never read into ours: no score,
 *   rating or opinion on creditworthiness is computed or implied, the same line as the Nordic tools.
 */
import { entry, getJson, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

const API = "https://recherche-entreprises.api.gouv.fr/search";
const SOURCE = "API Recherche d'entreprises (INSEE Sirene and INPI RNE), Licence Ouverte 2.0";
const NOT_A_CREDIT_REPORT = "Register facts only. This is not a credit report, credit score or rating.";

/** Luhn check of a 9-digit SIREN. */
export function sirenValid(s: string): boolean {
  if (!/^\d{9}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(s[8 - i]) * (i % 2 === 1 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}
/** The French VAT number of a SIREN: FR + key + SIREN, key = (12 + 3 x (SIREN mod 97)) mod 97. */
export const frVat = (siren: string) => `FR${String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, "0")}${siren}`;
/** 552032534, "552 032 534", a 14-digit SIRET, or the VAT number FR27552032534 -> the SIREN. */
export function sirenOf(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/[\s.\-]/g, "");
  if (/^FR[0-9A-Z]{2}\d{9}$/.test(s)) {
    const siren = s.slice(4);
    if (frVat(siren) !== s) throw new HttpError(400, "that French VAT number's key does not match its SIREN; check the number");
    s = siren;
  }
  if (/^\d{14}$/.test(s)) s = s.slice(0, 9);
  if (!/^\d{9}$/.test(s)) throw new HttpError(400, "siren must be a French SIREN (9 digits such as 552032534), a SIRET (14 digits) or a VAT number such as FR27552032534");
  if (!sirenValid(s)) throw new HttpError(400, "siren fails its check digit; check the number");
  return s;
}

// The commonest legal categories (INSEE "catégories juridiques", level III); others are shown by code.
const FORMS: Record<string, string> = {
  "5710": "SAS, société par actions simplifiée", "5720": "SASU, société par actions simplifiée unipersonnelle", "5499": "SARL, société à responsabilité limitée",
  "5498": "EURL, SARL unipersonnelle", "5599": "SA à conseil d'administration", "5699": "SA à directoire", "5202": "SNC, société en nom collectif",
  "5306": "Société en commandite simple", "5308": "Société en commandite par actions", "5800": "Société européenne", "6540": "SCI, société civile immobilière",
  "6599": "Société civile", "5385": "SELCA, société d'exercice libéral en commandite par actions", "5485": "SELARL", "5785": "SELAS",
  "9220": "Association déclarée", "9210": "Association non déclarée", "9300": "Fondation", "7210": "Commune",
};
// INSEE workforce bands (tranche d'effectif salarié).
const BANDS: Record<string, string> = {
  NN: "no employees reported", "00": "0 employees", "01": "1-2", "02": "3-5", "03": "6-9", "11": "10-19", "12": "20-49", "21": "50-99", "22": "100-199",
  "31": "200-249", "32": "250-499", "41": "500-999", "42": "1,000-1,999", "51": "2,000-4,999", "52": "5,000-9,999", "53": "10,000 or more",
};
const CATEGORY: Record<string, string> = { PME: "SME (PME)", ETI: "mid-sized company (ETI)", GE: "large company (GE)" };
const own = (t: Record<string, string>, k: string | null | undefined) => (k && Object.hasOwn(t, k) && t[k] ? t[k] : null);

interface Siege { caractere_employeur?: string | null; siret?: string; adresse?: string; code_postal?: string; libelle_commune?: string; libelle_pays_etranger?: string | null; etat_administratif?: string }
interface Unit {
  siren: string; nom_complet?: string; nom_raison_sociale?: string | null; sigle?: string | null; nature_juridique?: string; etat_administratif?: string;
  date_creation?: string | null; date_fermeture?: string | null; activite_principale?: string | null; section_activite_principale?: string | null;
  categorie_entreprise?: string | null; tranche_effectif_salarie?: string | null; annee_tranche_effectif_salarie?: string | null; caractere_employeur?: string | null;
  nombre_etablissements?: number; nombre_etablissements_ouverts?: number; siege?: Siege; statut_diffusion?: string; tva?: string | string[] | null;
  complements?: { est_entrepreneur_individuel?: boolean; est_association?: boolean; est_ess?: boolean; est_societe_mission?: boolean };
}
const isPerson = (u: Unit) => u.complements?.est_entrepreneur_individuel === true || /^1/.test(u.nature_juridique ?? "");
const shown = (u: Unit) => !isPerson(u) && (u.statut_diffusion ?? "O") === "O";

export function frCompanyView(u: Unit) {
  const ceased = u.etat_administratif === "C";
  const flags = [u.complements?.est_association && "association", u.complements?.est_ess && "social and solidarity economy (ESS)", u.complements?.est_societe_mission && "société à mission"].filter((x): x is string => Boolean(x));
  return {
    siren: u.siren,
    siret: u.siege?.siret ?? null,
    vatNumber: (Array.isArray(u.tva) ? u.tva[0] : u.tva) || frVat(u.siren),
    name: u.nom_raison_sociale || u.nom_complet || null,
    acronym: u.sigle || null,
    legalForm: u.nature_juridique ? { code: u.nature_juridique, name: own(FORMS, u.nature_juridique) } : null,
    status: ceased ? "ceased" : "active",
    ceased: ceased ? u.date_fermeture ?? null : null,
    founded: u.date_creation ?? null,
    industry: u.activite_principale ? { naf: u.activite_principale, section: u.section_activite_principale ?? null } : null,
    employees: u.tranche_effectif_salarie ? { band: own(BANDS, u.tranche_effectif_salarie) ?? u.tranche_effectif_salarie, year: u.annee_tranche_effectif_salarie ?? null } : null,
    employer: (u.caractere_employeur ?? u.siege?.caractere_employeur) === "O" ? true : (u.caractere_employeur ?? u.siege?.caractere_employeur) === "N" ? false : null,
    category: own(CATEGORY, u.categorie_entreprise),
    establishments: { open: u.nombre_etablissements_ouverts ?? null, total: u.nombre_etablissements ?? null },
    flags,
    headOffice: u.siege ? { address: u.siege.adresse ?? null, postcode: u.siege.code_postal ?? null, city: u.siege.libelle_commune ?? u.siege.libelle_pays_etranger ?? null, country: u.siege.libelle_pays_etranger ? null : "FR" } : null,
    source: SOURCE,
    note: NOT_A_CREDIT_REPORT,
  };
}

type Answer = { results?: Unit[]; total_results?: number };
const ask = (params: Record<string, string>) =>
  getJson<Answer>(`${API}?${new URLSearchParams({ ...params, est_entrepreneur_individuel: "false" })}`, { timeoutMs: 8_000 }).catch((e: unknown) => {
    // A busy API (429 after getJson's one retry) is an uncharged 503 rather than a 502.
    if (e instanceof HttpError && / 429/.test(e.message)) throw new HttpError(503, "the French company register is busy; try again in a few seconds, nothing was charged");
    throw e;
  });

export async function frLookup(siren: string) {
  const r = await ask({ q: siren, per_page: "5" });
  const u = (r.results ?? []).find((x) => x.siren === siren);
  if (!u) throw new HttpError(404, `no company with SIREN ${siren} that the register publishes (sole traders and units that opted out are not shown); nothing was charged`);
  if (!shown(u)) throw new HttpError(404, "that SIREN belongs to a sole trader or a unit that opted out of publication; this tool covers companies only; nothing was charged");
  return frCompanyView(u);
}

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const LEGAL = new Set(["sa", "sas", "sasu", "sarl", "eurl", "snc", "se", "sci", "scop", "selarl", "selas", "et", "de", "la", "le", "les", "du", "des"]);
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
const SIZE: Record<string, number> = { GE: 0, ETI: 1, PME: 2 };
/**
 * The API's own order puts small namesakes first ("totalenergies": TotalEnergies SE was not in its top five; "michelin":
 * local shops named MICHELIN before the group). Order: large and mid-sized companies first (a name search usually means the
 * known company), then the exact name, names holding every word whole, size, names starting with the first word, and more
 * open establishments.
 */
function rank(units: Unit[], query: string): Unit[] {
  const q = words(query);
  const core = (ws: string[]) => ws.filter((w) => !LEGAL.has(w)).join(" ");
  return units
    .map((u) => {
      const have = words(u.nom_raison_sociale || u.nom_complet || "");
      const exact = core(have) === core(q) ? 0 : 1;
      const whole = q.every((w) => have.includes(w)) ? 0 : 1;
      const size = u.categorie_entreprise && Object.hasOwn(SIZE, u.categorie_entreprise) ? SIZE[u.categorie_entreprise] : 3;
      const starts = have[0] && q[0] && have[0].startsWith(q[0]) ? 0 : 1;
      const big = size <= 1 ? 0 : 1;
      return { u, key: big * 1e8 + exact * 1e7 + whole * 1e6 + size * 1e5 + starts * 1e4 - Math.min(u.nombre_etablissements_ouverts ?? 0, 9999) };
    })
    .sort((a, b) => a.key - b.key)
    .map((x) => x.u);
}

export async function frSearch(name: string, limit: number, city?: string) {
  // The search text matches addresses too, so a town in it narrows the candidates; the filter below keeps only that town.
  const r = await ask({ q: city ? `${name} ${city}` : name, per_page: "25", etat_administratif: "A" });
  const units = (r.results ?? []).filter(shown).filter((u) => !city || fold(u.siege?.libelle_commune ?? "").startsWith(fold(city)));
  // The API also matches on addresses and establishment signs ("michelin" found a caterer at a Michelin site): keep the
  // companies whose own name holds every word, unless none does.
  const q = words(name).filter((w) => !LEGAL.has(w));
  const named = units.filter((u) => { const have = words(`${u.nom_complet ?? ""} ${u.nom_raison_sociale ?? ""}`); return q.every((w) => have.some((h) => h.startsWith(w))); });
  const rows = rank(named.length ? named : units, name).map((u) => ({ name: u.nom_raison_sociale || u.nom_complet || "", siren: u.siren, legalForm: own(FORMS, u.nature_juridique) ?? u.nature_juridique ?? null, city: u.siege?.libelle_commune ?? null }));
  if (!rows.length) throw new HttpError(404, `no active French company matches "${name.slice(0, 60)}"${city ? ` in ${city.slice(0, 40)}` : ""}; nothing was charged`);
  return {
    query: name, ...(city ? { city } : {}), count: Math.min(limit, rows.length), totalMatches: r.total_results ?? rows.length,
    matches: rows.slice(0, limit),
    next: "Call again with siren for the full register facts of one company.",
    source: SOURCE, note: NOT_A_CREDIT_REPORT,
  };
}
const EXAMPLE = {
  siren: "552032534", siret: "55203253400703", vatNumber: "FR27552032534", name: "DANONE", acronym: null,
  legalForm: { code: "5599", name: "SA à conseil d'administration" }, status: "active", ceased: null, founded: "1955-01-01",
  industry: { naf: "70.10Z", section: "M" }, employees: { band: "1,000-1,999", year: "2024" }, employer: true, category: "large company (GE)",
  establishments: { open: 3, total: 19 }, flags: [],
  headOffice: { address: "59-61 RUE LA FAYETTE 75009 PARIS", postcode: "75009", city: "PARIS", country: "FR" },
  source: SOURCE, note: NOT_A_CREDIT_REPORT,
};

export const FR_COMPANY: Entry[] = [
  entry("/fr/company", "French company lookup, Sirene register",
    "French company by SIREN (552032534), SIRET or VAT number (FR27552032534), or by name, live from the State's company search API (INSEE Sirene and the RNE): name, acronym, legal form, active or ceased, creation date, NAF industry code, workforce band, company size category, establishments, head office address, VAT number. Use to verify a French customer or supplier. Register facts only, not a credit report.",
    ["french-company", "sirene", "siren", "company-registry", "kyb", "france"], {
      siren: { type: "string", description: "SIREN (9 digits), SIRET (14 digits) or French VAT number FR… (give siren or name)", example: "552032534" },
      name: { type: "string", description: "Company name to search for, instead of siren: up to 10 active companies", example: "Danone" },
      city: { type: "string", description: "With name: only companies whose head office is in this town", example: "Paris" },
      limit: { type: "integer", description: "Matches for a name search (1-10, default 5)", example: 5 },
    },
    EXAMPLE,
    async (_env, q) => {
      const raw = opt(q, "siren", 40) ?? opt(q, "siret", 40) ?? opt(q, "vat", 40) ?? opt(q, "id", 40);
      if (raw) return frLookup(sirenOf(raw));
      const name = opt(q, "name", 120) ?? opt(q, "q", 120);
      if (!name) throw new HttpError(400, "give siren (such as 552032534) or name");
      if (fold(name).replace(/[^a-z0-9]/g, "").length < 2) throw new HttpError(400, "name needs at least two letters or digits");
      return frSearch(name, num(q, "limit", { min: 1, max: 10, fallback: 5, integer: true }), opt(q, "city", 60));
    }),
];
