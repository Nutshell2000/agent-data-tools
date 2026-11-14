/**
 * EU company search across official registers (14 Nov 2026): one call searches a company name in the French, Swedish,
 * Norwegian and Finnish company registers and in GLEIF's LEI records (which cover registered entities in every country),
 * and returns one ranked list with each entity's register ID, legal form, place, a link to the register's own public page
 * and the time it was read.
 *
 * Why: the plan to compete with Exa (business/research-2026-11-14-biggest-earners/beat-exa-master-plan.md). Exa's company
 * search answers from crawled web pages, and its official-records vertical lists only US sources; nobody serves the EU's
 * registers as one search for agents. This needs no search index and no Brave call: every source is an official register
 * read live (France, Norway, Finland, GLEIF) or from its weekly open data (Sweden). Register facts only, never a credit view.
 *
 * Rules: a register that does not answer is named in `failed` with `complete: false`; only when no source answered is the
 * call an uncharged 502. A name that matches nothing anywhere is an answer (`count: 0`), like /vat/validate's `found: false`.
 */
import { entry, getJson, num, need, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { countryCode } from "../lib/country-code";
import { NAME_REGISTERS, SEARCHERS, coreName, type NameRegister } from "./company-verify";
import { leiView } from "./registries";

/** The register's own public page for one entity; Sweden's register has no free page per company, so its link is our tool. */
const PAGES: Record<NameRegister, (id: string) => string | null> = {
  FR: (id) => `https://annuaire-entreprises.data.gouv.fr/entreprise/${id}`,
  SE: () => null,
  NO: (id) => `https://data.brreg.no/enhetsregisteret/oppslag/enheter/${id}`,
  FI: (id) => `https://tietopalvelu.ytj.fi/yritys/${id}`,
};
const DETAIL: Record<NameRegister, string> = { FR: "/fr/company?siren=", SE: "/se/company?orgnr=", NO: "/no/company?orgnr=", FI: "/fi/company?businessId=" };

export interface CompanyHit {
  name: string;
  country: string;
  idType: string;
  id: string;
  legalForm: string | null;
  city: string | null;
  /** The name equals the query once legal-form words (AB, Oy, SA, Ltd…) are set aside. */
  exact: boolean;
  /** The register's own public page, or GLEIF's record page. */
  url: string | null;
  /** Our tool that returns the full register facts for this entity. */
  details: string | null;
  lei: string | null;
  source: string;
  status?: string | null;
  /** A register's entry for a company incorporated in another country (a branch or foreign legal person). */
  branchOfForeign?: boolean;
}

type LeiRecord = Parameters<typeof leiView>[0];
export type LeiSearch = (name: string, limit: number, country: string | null) => Promise<LeiRecord[]>;

const leiSearch: LeiSearch = async (name, limit, country) => {
  const params = new URLSearchParams({ "filter[fulltext]": name, "page[size]": String(limit) });
  if (country) params.set("filter[entity.legalAddress.country]", country);
  const r = await getJson<{ data?: LeiRecord[] }>(`https://api.gleif.org/api/v1/lei-records?${params}`, { timeoutMs: 8_000 });
  return r.data ?? [];
};

/** ISO codes from "SE,NO", "Sweden, Germany", "EU" (all) or nothing (all). Unknown names are refused. */
export function countriesOf(raw: string | undefined): string[] | null {
  if (!raw?.trim() || /^(eu|all|europe)$/i.test(raw.trim())) return null;
  const out = new Set<string>();
  for (const part of raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const code = /^[A-Za-z]{2}$/.test(part) ? part.toUpperCase() : countryCode(part);
    if (!code || !/^[A-Z]{2}$/.test(code)) throw new HttpError(400, `country "${part.slice(0, 40)}" is not a country code or name`);
    out.add(code === "UK" ? "GB" : code === "EL" ? "GR" : code);
  }
  if (out.size > 10) throw new HttpError(400, "country takes at most 10 countries");
  return [...out];
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * A register's entry for a company incorporated abroad: Sweden's "utländsk juridisk person", Norway's NUF ("norskregistrert
 * utenlandsk foretak") and France's legal form 3220 ("société étrangère immatriculée au RCS"). They are real register
 * entries, but not the company's home record.
 */
export const isForeignBranch = (h: Pick<CompanyHit, "country" | "legalForm">) =>
  (h.country === "SE" && /foreign legal person|utländsk juridisk person/i.test(h.legalForm ?? ""))
  || (h.country === "NO" && /utenlandsk foretak/i.test(h.legalForm ?? ""))
  || (h.country === "FR" && h.legalForm === "3220");

export async function companySearch(name: string, countries: string[] | null, limit: number, deps: { searchers?: typeof SEARCHERS; lei?: LeiSearch; now?: () => Date } = {}) {
  const searchers = deps.searchers ?? SEARCHERS;
  const lei = deps.lei ?? leiSearch;
  const want = coreName(name);
  if (want.replace(/\s/g, "").length < 2) throw new HttpError(400, "q needs at least two letters or digits besides the legal form");
  const registers = NAME_REGISTERS.filter((c) => !countries || countries.includes(c));
  // GLEIF covers every country; with a country list it is asked once per country it is the only source for, plus once
  // overall when the list holds a register country (LEI records then add LEIs to the register's own entities).
  const leiOnly = countries ? countries.filter((c) => !(NAME_REGISTERS as readonly string[]).includes(c)) : [];
  const leiAsks: (string | null)[] = countries ? [...leiOnly, ...(registers.length ? [null] : [])] : [null];
  const failed: string[] = [];
  const searched: string[] = [];

  const fromRegisters = Promise.all(registers.map(async (c): Promise<CompanyHit[]> => {
    const s = searchers[c];
    try {
      const r = await s.search(name, Math.min(10, limit));
      searched.push(c);
      return r.matches.map((m) => {
        const id = s.id(m);
        if (!id) return null;
        const extra = m as { bankrupt?: boolean };
        return {
          name: m.name, country: c, idType: s.idType, id, legalForm: m.legalForm ?? null, city: m.city ?? null,
          exact: coreName(m.name) === want, url: PAGES[c](id), details: `${DETAIL[c]}${encodeURIComponent(id)}`, lei: null, source: s.source,
          ...(extra.bankrupt ? { status: "bankrupt" } : {}),
        } satisfies CompanyHit;
      }).filter((h): h is NonNullable<typeof h> => h !== null);
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status === 404) { searched.push(c); return []; }
      if (status === 400) throw e;
      failed.push(c);
      return [];
    }
  }));
  const fromLei = Promise.all(leiAsks.map(async (country): Promise<CompanyHit[]> => {
    const label = country ? `LEI:${country}` : "LEI";
    try {
      // GLEIF's full-text order puts subsidiaries before the parent ("Siemens" in DE: five Siemens GmbHs, no Siemens AG),
      // so more records are read and ranked here.
      const records = await lei(name, 30, country);
      searched.push(label);
      return records.map((r) => {
        const v = leiView(r);
        return {
          name: v.legalName ?? "", country: v.legalAddress?.country ?? (v.jurisdiction ?? "").slice(0, 2), idType: "LEI", id: v.lei,
          legalForm: null, city: v.legalAddress?.city ?? null, exact: coreName(v.legalName ?? "") === want, url: v.url,
          details: `/lei/lookup?lei=${v.lei}`, lei: v.lei, source: "GLEIF (CC0)", status: v.entityStatus === "ACTIVE" ? "active" : (v.entityStatus ?? "").toLowerCase() || null,
          registeredAs: v.registeredAs,
        } as CompanyHit & { registeredAs: string | null };
      }).filter((h) => h.name);
    } catch {
      failed.push(label);
      return [];
    }
  }));
  const [reg, leiHits] = await Promise.all([fromRegisters, fromLei]);
  if (searched.length === 0) throw new HttpError(502, `no register answered (${failed.join(", ")}); nothing was charged`);

  // A GLEIF record of an entity a register already returned (same country, same register number) adds its LEI there.
  const registerHits = reg.flat();
  const leiRest: CompanyHit[] = [];
  for (const h of leiHits.flat() as (CompanyHit & { registeredAs?: string | null })[]) {
    const { registeredAs, ...hit } = h;
    const twin = registerHits.find((r) => r.country === hit.country && digits(registeredAs) !== "" && digits(r.id) === digits(registeredAs));
    if (twin) { twin.lei = hit.id; continue; }
    if (!leiRest.some((x) => x.id === hit.id)) leiRest.push(hit);
  }
  // Order: exact names, then a country's own companies before the local registrations of foreign ones (Spotify AB in
  // Sweden before its French and Swedish branch entries), then register entities before LEI-only ones, then names that
  // start with the query, then shorter names, then the sources' own order.
  for (const h of registerHits) if (isForeignBranch(h)) h.branchOfForeign = true;
  // Whole words: "Equinor OTS AB" starts with "Equinor", "EquiNorr AB" does not.
  const starts = (h: CompanyHit) => { const core = coreName(h.name); return core === want || core.startsWith(`${want} `); };
  const results = [...registerHits, ...leiRest]
    .map((h, i) => ({ h, i }))
    .sort((a, b) => Number(b.h.exact) - Number(a.h.exact)
      || Number(Boolean(a.h.branchOfForeign)) - Number(Boolean(b.h.branchOfForeign))
      || Number(a.h.idType === "LEI") - Number(b.h.idType === "LEI")
      || Number(starts(b.h)) - Number(starts(a.h))
      || coreName(a.h.name).length - coreName(b.h.name).length
      || a.i - b.i)
    .map(({ h }) => h)
    .slice(0, limit)
    // A field a source does not give is left out rather than sent as null: the published output schema is derived from
    // the example's first result, and an absent field never contradicts it.
    .map((h) => Object.fromEntries(Object.entries(h).filter(([, v]) => v !== null && v !== undefined)) as Partial<CompanyHit> & Pick<CompanyHit, "name" | "country" | "idType" | "id" | "exact" | "source">);
  return {
    query: name,
    countries: countries ?? "all",
    count: results.length,
    results,
    searched,
    complete: failed.length === 0,
    ...(failed.length ? { failed } : {}),
    retrievedAt: (deps.now ?? (() => new Date()))().toISOString(),
    note: "Official register facts only: a registered entity with that name exists; this is not a credit view. Sole traders are not covered. Countries without a register here are searched through GLEIF, which lists only entities that hold an LEI.",
  };
}

export const COMPANY_SEARCH: Entry[] = [
  entry("/company/search", "Company search, EU official registers",
    "Search a company name across official registers in one call: France (Sirene), Sweden (Bolagsverket), Norway (Brønnøysund), Finland (PRH), plus GLEIF LEI records for every other country. One ranked list: register ID, legal form, city, LEI, a link to the register's own page, time read. A source that does not answer is named; the rest still answer. Use for KYB, supplier and customer checks, and facts about a European company.",
    ["company-search", "company-registry", "kyb", "eu-companies", "business-search", "lei", "registry-search"], {
      q: { type: "string", description: "Company name, with or without the legal form (AB, Oy, SA, GmbH…)", required: true, example: "Spotify" },
      country: { type: "string", description: "Only these countries: ISO codes or names, comma-separated (FR, SE, NO, FI search their registers; any other country searches GLEIF). Default: all", example: "SE" },
      limit: { type: "integer", description: "Results (1-20, default 10)", example: 10 },
    },
    // A real answer, read live on 14 Nov 2026 (the first 3 of 10 results shown). The first result carries every field a
    // result can have, so the derived output schema describes them all.
    {
      query: "Spotify", countries: "all", count: 10,
      results: [
        { name: "Spotify AB", country: "SE", idType: "organisationsnummer", id: "556703-7485", legalForm: "Aktiebolag (limited company)", city: "STOCKHOLM", exact: true, details: "/se/company?orgnr=556703-7485", lei: "5493004INDUJX1TDHI57", source: "Bolagsverket and SCB (Sweden)" },
        { name: "SPOTIFY AB", country: "FR", idType: "SIREN", id: "511237240", legalForm: "3220", exact: true, url: "https://annuaire-entreprises.data.gouv.fr/entreprise/511237240", details: "/fr/company?siren=511237240", source: "INSEE Sirene and INPI RNE (France)", branchOfForeign: true },
        { name: "SPOTIFY FRANCE SAS", country: "FR", idType: "SIREN", id: "511930729", legalForm: "SAS, société par actions simplifiée", city: "PARIS", exact: false, url: "https://annuaire-entreprises.data.gouv.fr/entreprise/511930729", details: "/fr/company?siren=511930729", source: "INSEE Sirene and INPI RNE (France)" },
      ],
      searched: ["LEI", "NO", "SE", "FR", "FI"], complete: true, retrievedAt: "2026-11-14T14:52:10.000Z",
      note: "Official register facts only: a registered entity with that name exists; this is not a credit view. Sole traders are not covered. Countries without a register here are searched through GLEIF, which lists only entities that hold an LEI.",
    },
    async (_env, q) => {
      const name = need(q, "q", 200);
      const countries = countriesOf(opt(q, "country", 200));
      const limit = num(q, "limit", { min: 1, max: 20, fallback: 10, integer: true });
      return companySearch(name, countries, limit);
    }),
];
