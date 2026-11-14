/**
 * Business verification by name (12 Nov 2026): /vat/validate also answers "is there a registered company called X?" when the
 * caller sends a name instead of a VAT number. It searches the four company registers we already read (France, Sweden,
 * Norway, Finland) through the same functions as /fr/company, /se/company, /no/company and /fi/company, so the source rules
 * stay theirs: sole traders and opted-out units are never shown, register facts only.
 *
 * Why: Datacircle's public benchmark "Business verification in France" called /vat/validate on 11 Nov 2026 with
 * {"entity_name": "..."} only. Every input got "No answer" (vat is required), and we ranked 25th of 25. Its right answers
 * are "Found" or "Not found", so a name that matches no company is an answer (`found: false`), like VIES's `valid: false`
 * for a VAT number; it is charged the same way. A register that does not answer is named in `registersFailed` with
 * `complete: false` (Finland's PRH timed out for every query on 12 Nov 2026); only when no register answered is the call
 * an uncharged 502.
 */
import { HttpError } from "../lib/env";
import { countryCode } from "../lib/country-code";
import { frSearch } from "./fr-company";
import { searchName } from "./se-company";
import { noSearch, fiSearch } from "./nordic-company";

export const NAME_REGISTERS = ["FR", "SE", "NO", "FI"] as const;
export type NameRegister = (typeof NAME_REGISTERS)[number];

export interface NameMatch { country: NameRegister; name: string; id: string; idType: string; legalForm: string | null; city: string | null; exact: boolean }

type Found = { name: string; legalForm?: string | null; city?: string | null; siren?: string; orgnr?: string; businessId?: string };
type Searcher = (name: string, limit: number) => Promise<{ matches: Found[] }>;

export const SEARCHERS: Record<NameRegister, { search: Searcher; idType: string; id: (m: Found) => string | undefined; tool: string; source: string }> = {
  FR: { search: (n, l) => frSearch(n, l), idType: "SIREN", id: (m) => m.siren, tool: "/fr/company?siren=", source: "INSEE Sirene and INPI RNE (France)" },
  SE: { search: (n, l) => searchName(n, l), idType: "organisationsnummer", id: (m) => m.orgnr, tool: "/se/company?orgnr=", source: "Bolagsverket and SCB (Sweden)" },
  NO: { search: (n, l) => noSearch(n, l), idType: "organisasjonsnummer", id: (m) => m.orgnr, tool: "/no/company?orgnr=", source: "Brønnøysund Register Centre (Norway)" },
  FI: { search: (n, l) => fiSearch(n, l), idType: "Y-tunnus", id: (m) => m.businessId, tool: "/fi/company?id=", source: "PRH YTJ (Finland)" },
};

/** Legal-form words dropped before two names are compared: "Spotify AB" is "Spotify", "DANONE SA" is "DANONE". */
// Spelled-out forms too (14 Nov 2026, /company/search): registers write "Aktiebolaget Volvo" and GLEIF "Siemens
// Aktiengesellschaft", which are the companies a search for "Volvo" or "Siemens" means.
const FORMS = new Set(["sa", "sas", "sasu", "sarl", "eurl", "snc", "sci", "scop", "se", "ab", "publ", "hb", "kb", "as", "asa", "ans", "da", "oy", "oyj", "ky", "ay", "ltd", "limited", "inc", "gmbh", "ag", "plc", "llc", "bv", "nv",
  "aktiebolag", "aktiebolaget", "aktiengesellschaft", "aksjeselskap", "aksjeselskapet", "allmennaksjeselskap", "osakeyhtio", "julkinen", "spa", "srl", "corp", "corporation", "incorporated"]);
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
export const coreName = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w && !FORMS.has(w)).join(" ");

const OWN_NAMES: Record<string, NameRegister> = { france: "FR", sweden: "SE", sverige: "SE", norway: "NO", norge: "NO", finland: "FI", suomi: "FI" };
/** FR, SE, NO or FI from a code or an English name; anything else is refused (other countries have no name register here). */
export function nameRegister(raw: string | undefined): NameRegister | null {
  if (!raw?.trim()) return null;
  // Own names first: the Intl lookup in countryCode() reads "France" as FX (Metropolitan France).
  const key = fold(raw.trim());
  const code = (Object.hasOwn(OWN_NAMES, key) ? OWN_NAMES[key] : countryCode(raw) ?? raw.trim().toUpperCase()) as NameRegister;
  if (!(NAME_REGISTERS as readonly string[]).includes(code)) {
    throw new HttpError(400, "a name search covers the French, Swedish, Norwegian and Finnish company registers (country FR, SE, NO or FI); for another EU country give the VAT number");
  }
  return code;
}

export async function verifyCompanyByName(name: string, country: NameRegister | null, searchers = SEARCHERS) {
  if (coreName(name).replace(/\s/g, "").length < 2) throw new HttpError(400, "name needs at least two letters or digits besides the legal form");
  const registers: NameRegister[] = country ? [country] : [...NAME_REGISTERS];
  const want = coreName(name);
  const failed: NameRegister[] = [];
  const perRegister = await Promise.all(registers.map(async (c) => {
    const s = searchers[c];
    try {
      const r = await s.search(name, 3);
      return r.matches.map((m): NameMatch | null => {
        const id = s.id(m);
        return id ? { country: c, name: m.name, id, idType: s.idType, legalForm: m.legalForm ?? null, city: m.city ?? null, exact: coreName(m.name) === want } : null;
      }).filter((m): m is NameMatch => m !== null);
    } catch (e) {
      // Each register answers "nothing matches" with a 404; anything else means it could not be searched.
      const status = (e as { status?: number } | null)?.status;
      if (status === 404) return [];
      if (status === 400) throw e;
      failed.push(c);
      return [];
    }
  }));
  const matches = perRegister.flat().sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, 5);
  // Nothing searched at all (or the one register asked for failed) is an uncharged 502. When some registers answered, the
  // answer says which did not (`complete: false`), like the log scans that answer what they read.
  if (failed.length === registers.length) {
    throw new HttpError(502, `the ${failed.join(", ")} company register did not answer; nothing was charged`);
  }
  const best = matches[0] ?? null;
  return {
    query: name,
    country,
    found: matches.length > 0,
    exactMatch: Boolean(best?.exact),
    bestMatch: best,
    matches,
    registersSearched: registers.filter((c) => !failed.includes(c)),
    complete: failed.length === 0,
    ...(failed.length ? { registersFailed: failed } : {}),
    next: best
      ? `Full register facts: ${searchers[best.country].tool}${best.id}. A VAT number is checked here with vat=.`
      : `No active company in the ${registers.join(", ")} register${registers.length > 1 ? "s" : ""} holds every word of that name.`,
    source: registers.map((c) => searchers[c].source).join("; "),
    note: "Register facts only: a company with that name is registered, not a statement about the company. Sole traders are not covered.",
  };
}
