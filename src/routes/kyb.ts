// KYB check for European companies in one call (Beat-Exa plan 4b, 15 Nov 2026): the official register entry, the GLEIF
// record and group parent, the EU VAT number checked in VIES, and the company and its parent screened against the OFAC,
// EU, UN and UK sanctions lists. Every part names its source and when it was read. Exa answers none of this from
// records; compliance agents buy it as one step.
import { entry, opt, type Entry, type Input } from "../family";
import { HttpError, type Env } from "../lib/env";
import { companySearch, countriesOf, type CompanyHit } from "./company-search";
import { REGISTRIES, VIES_COUNTRIES, vatParts, viesCheck } from "./registries";
import { SANCTIONS } from "./sanctions";

type Run = (env: Env, q: Input) => Promise<unknown> | unknown;
const runOf = (list: Entry[], path: string): Run => list.find((e) => e.endpoint.path === path)!.run;
const asInput = (o: Record<string, string | undefined>): Input => (n) => o[n];

/** The EU VAT number a register ID implies, where the member state's rule is public and fixed. */
export function vatFromRegister(hit: Pick<CompanyHit, "country" | "id">): string | null {
  const digits = hit.id.replace(/\D/g, "");
  switch (hit.country) {
    case "SE": return digits.length === 10 ? `SE${digits}01` : null; // organisationsnummer + 01
    case "FI": return digits.length === 8 ? `FI${digits}` : null; // Y-tunnus without the dash
    case "FR": { // SIREN with the key (12 + 3 x (SIREN mod 97)) mod 97
      if (digits.length !== 9) return null;
      const key = (12 + 3 * (Number(digits) % 97)) % 97;
      return `FR${String(key).padStart(2, "0")}${digits}`;
    }
    case "CZ": return digits.length === 8 ? `CZ${digits}` : null; // IČO; valid only if the company is VAT-registered
    default: return null;
  }
}

const LEGAL_FORMS = new Set(["AB", "PUBL", "OY", "OYJ", "AS", "ASA", "SA", "SAS", "SARL", "SE", "GMBH", "AG", "KG", "LTD", "LIMITED", "PLC", "LLC", "INC", "CORP", "NV", "BV", "SPA", "SRL", "SL", "APS", "PJSC", "JSC", "OJSC", "OOO", "AO", "OAO", "SRO", "OU", "UAB", "SIA", "KFT", "ZRT", "SP", "ZOO", "CO", "THE"]);
/** "Spotify AB" -> "Spotify", "PJSC Rosneft Oil Company" -> "Rosneft Oil Company": legal forms make word matching miss. */
export function coreName(name: string): string {
  const words = name.replace(/[.,()/]/g, " ").split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !LEGAL_FORMS.has(w.toUpperCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")));
  return (kept.length ? kept : words).join(" ");
}

export interface KybDeps {
  search: (name: string, countries: string[] | null) => Promise<{ results: CompanyHit[]; searched?: string[]; complete?: boolean }>;
  vies: (vat: string) => Promise<Record<string, unknown>>;
  lei: (lei: string) => Promise<Record<string, unknown> | null>;
  sanctions: (name: string) => Promise<{ verdict: string; matches: Record<string, unknown>[]; lists: Record<string, unknown>[] }>;
  now?: () => Date;
}

export const kybDeps = (env: Env): KybDeps => defaultDeps(env);
const defaultDeps = (env: Env): KybDeps => ({
  search: (name, countries) => companySearch(name, countries, 5, { env }) as ReturnType<KybDeps["search"]>,
  vies: async (vat) => {
    const parts = vatParts(vat);
    if (!parts || !VIES_COUNTRIES.has(parts.country)) throw new HttpError(400, `${vat.slice(0, 20)} is not an EU VAT number`);
    return viesCheck(parts) as Promise<Record<string, unknown>>;
  },
  lei: async (lei) => {
    const r = (await runOf(REGISTRIES, "/lei/lookup")(env, asInput({ lei }))) as { records?: Record<string, unknown>[] };
    return r.records?.[0] ?? null;
  },
  sanctions: async (name) => (await runOf(SANCTIONS, "/sanctions/check")(env, asInput({ name, lists: "all" }))) as Awaited<ReturnType<KybDeps["sanctions"]>>,
});

const message = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

export async function kybCheck(input: { q?: string; vat?: string; lei?: string; country?: string }, deps: KybDeps) {
  const failed: Record<string, string> = {};
  const flags: string[] = [];
  const sources = new Set<string>();
  const countries = countriesOf(input.country);
  let name = input.q?.trim() || undefined;

  // 1. Starting points other than a name: a VAT number (VIES gives the registered name where the state shares it) or an LEI.
  let vat: Record<string, unknown> | null = null;
  let firstError: unknown;
  if (input.vat) {
    const parts = vatParts(input.vat);
    if (!parts) throw new HttpError(400, "vat must start with a 2-letter EU country code, e.g. SE556703748501");
    if (!VIES_COUNTRIES.has(parts.country)) throw new HttpError(400, `${parts.country} is not an EU VIES country`);
    try {
      const v = await deps.vies(input.vat);
      vat = { ...v, given: true, derived: false };
      sources.add("EU VIES (European Commission)");
      if (!name && typeof v.name === "string" && v.name && v.name !== "---") name = v.name;
    } catch (e) { failed.vat = message(e); firstError ??= e; }
  }
  let leiRecord: Record<string, unknown> | null = null;
  if (input.lei) {
    try {
      leiRecord = await deps.lei(input.lei.toUpperCase().replace(/\s+/g, ""));
      sources.add("GLEIF (CC0)");
      if (!name && typeof leiRecord?.legalName === "string") name = leiRecord.legalName;
    } catch (e) { failed.lei = message(e); firstError ??= e; }
  }
  if (!name) {
    // Nothing found from the only starting point given: pass its own answer on (a 404 stays a 404, uncharged).
    if (!vat && !leiRecord && typeof (firstError as HttpError | undefined)?.status === "number") throw firstError;
    if (vat || leiRecord) flags.push("no company name to search the registers or sanctions lists with (the VAT authority does not share it)");
    else throw new HttpError(input.vat || input.lei ? 502 : 400, input.vat || input.lei ? `the ${input.vat ? "VAT" : "LEI"} lookup failed (${Object.values(failed)[0] ?? "no answer"}); nothing was charged` : "give q (company name), vat or lei");
  }

  // 2. Registers (FR, SE, NO, FI, CZ, EE) plus GLEIF for every other country; the VAT number's country narrows the search.
  const vatCountry = input.vat ? vatParts(input.vat)?.country : undefined;
  // An LEI names one entity: search its own country and keep the hit that carries that LEI.
  const askedLei = input.lei ? input.lei.toUpperCase().replace(/\s+/g, "") : null;
  const leiCountry = askedLei && leiRecord ? String((leiRecord.legalAddress as { country?: string } | null)?.country ?? leiRecord.jurisdiction ?? "").slice(0, 2) || null : null;
  const narrowed = countries ?? (vatCountry ? [vatCountry === "EL" ? "GR" : vatCountry] : leiCountry ? [leiCountry] : null);
  let company: CompanyHit | null = null, alternatives: CompanyHit[] = [], parent: CompanyHit | null = null;
  if (name) {
    try {
      const found = await deps.search(name, narrowed);
      const results = found.results ?? [];
      company = (askedLei && results.find((r) => r.lei === askedLei)) || results[0] || null;
      // A group parent comes first when its name holds the name asked for. With countries named (or implied by a VAT
      // number or LEI), the entity there is the subject and the parent is reported beside it; without, the group itself is.
      if (company?.groupParent) {
        parent = company;
        const local = narrowed ? results.find((r) => !r.groupParent && narrowed.includes(r.country)) : undefined;
        if (local) company = local; else parent = null;
      }
      alternatives = results.filter((r) => r !== company && r !== parent).slice(0, 3);
      for (const r of results.slice(0, 2)) sources.add(r.source);
      if (!company) flags.push("no entry found in the official registers searched or in GLEIF");
      else if (askedLei && company.lei !== askedLei) flags.push(`no register entry carries LEI ${askedLei}; "${company.name}" is the closest by name`);
      else if (!company.exact && !company.groupParent && !(askedLei && company.lei === askedLei)) flags.push(`closest register entry is "${company.name}", not an exact name match: confirm it is the company meant`);
      if (company?.status && !/active|registered|aktiv|actif|in business|^a$/i.test(company.status)) flags.push(`register status: ${company.status}`);
    } catch (e) { failed.register = message(e); }
  }

  // 3. In parallel: the LEI record, the VAT number implied by the register ID, and sanctions on the company and its parent.
  const leiToRead = !leiRecord ? company?.lei ?? null : null;
  const derivedVat = !vat && company ? vatFromRegister(company) : null;
  const names = [...new Set([name, company?.name, parent?.name].filter((n): n is string => !!n).map(coreName))].slice(0, 3);
  const [leiDone, vatDone, sanctionsDone] = await Promise.all([
    leiToRead ? deps.lei(leiToRead).then((r) => ({ r }), (e) => ({ e })) : Promise.resolve(null),
    derivedVat ? deps.vies(derivedVat).then((r) => ({ r }), (e) => ({ e })) : Promise.resolve(null),
    Promise.all(names.map((n) => deps.sanctions(n).then((r) => ({ n, r }), (e) => ({ n, e })))),
  ]);
  if (leiDone && "r" in leiDone) { leiRecord = leiDone.r; sources.add("GLEIF (CC0)"); }
  else if (leiDone) failed.lei = message(leiDone.e);
  if (vatDone && "r" in vatDone) { vat = { ...vatDone.r, given: false, derived: true }; sources.add("EU VIES (European Commission)"); }
  else if (vatDone) failed.vat = message(vatDone.e);

  if (leiRecord) {
    const st = String(leiRecord.entityStatus ?? ""), reg = String((leiRecord.registration as Record<string, unknown> | undefined)?.status ?? "");
    if (st && st !== "ACTIVE") flags.push(`LEI entity status: ${st}`);
    if (reg && !["ISSUED", "PENDING_TRANSFER", "PENDING_ARCHIVAL"].includes(reg)) flags.push(`LEI registration status: ${reg} (not renewed)`);
  }
  if (vat && vat.valid === false) flags.push(vat.derived ? `VAT number ${vat.vat ?? derivedVat} (worked out from the register ID) is not valid in VIES: the company may not be VAT-registered` : "the VAT number given is not valid in VIES");

  const matches = new Map<string, Record<string, unknown>>();
  let lists: Record<string, unknown>[] = [];
  let screened = 0;
  for (const s of sanctionsDone) {
    if ("e" in s) { failed[`sanctions:${s.n}`] = message(s.e); continue; }
    screened++;
    lists = s.r.lists;
    for (const m of s.r.matches) matches.set(`${m.list}:${m.listId ?? m.sdnId}`, { ...m, screenedName: s.n });
  }
  if (screened) sources.add("OFAC, EU, UN and UK sanctions lists");
  if (matches.size) flags.push(`${matches.size} sanctions list match${matches.size > 1 ? "es" : ""} on the name: review each one (it may be a namesake)`);
  if (names.length && !screened) flags.push("sanctions screening failed; try again");

  const verdict = matches.size || !company || (vat?.given && vat.valid === false) || (names.length && !screened) ? "review" : "pass";
  return {
    query: { q: input.q ?? null, vat: input.vat ?? null, lei: input.lei ?? null, country: input.country ?? null },
    verdict, flags,
    company, groupParent: parent, alternatives,
    lei: leiRecord,
    vat,
    sanctions: { verdict: matches.size ? "review" : screened ? "pass" : "not checked", screenedNames: names, matches: [...matches.values()].slice(0, 15), lists },
    sources: [...sources], failed,
    checkedAt: (deps.now?.() ?? new Date()).toISOString(),
    note: "Official records only, each read live from its source. A screening and verification aid, not legal advice or a credit view: confirm any match against the official record before acting.",
  };
}

export const KYB: Entry[] = [
  entry("/pack/kyb-eu", "KYB check, EU company verification",
    "Know-your-business check in one call: finds the company in official registers (FR, SE, NO, FI, CZ, EE) or GLEIF, reads its LEI record and group parent, checks its EU VAT number in VIES (given, or worked out from the register ID) and screens the company and its parent against the OFAC, EU, UN and UK sanctions lists. Returns pass or review with plain flags and every source. Use when you onboard an EU customer, supplier or counterparty.",
    ["kyb", "kyb-check", "company-verification", "business-verification", "eu-companies", "sanctions", "vat-validation"], {
      q: { type: "string", description: "Company name (give q, vat or lei)", example: "Spotify" },
      vat: { type: "string", description: "EU VAT number with its country prefix; VIES gives the name where the member state shares it", example: "SE556703748501" },
      lei: { type: "string", description: "LEI (20 characters) instead of a name", example: "5493004INDUJX1TDHI57" },
      country: { type: "string", description: "Only these countries for the register search: ISO codes or names, comma-separated", example: "SE" },
    },
    {
      query: { q: "Spotify", vat: null, lei: null, country: "SE" },
      verdict: "pass", flags: [],
      company: { name: "Spotify AB", country: "SE", idType: "organisationsnummer", id: "556703-7485", legalForm: "Aktiebolag (limited company)", city: "STOCKHOLM", exact: true, url: null, details: "/se/company?orgnr=556703-7485", lei: "5493004INDUJX1TDHI57", source: "Bolagsverket and SCB (Sweden)" },
      groupParent: null, alternatives: [],
      lei: { lei: "5493004INDUJX1TDHI57", legalName: "Spotify AB", entityStatus: "ACTIVE", jurisdiction: "SE", registration: { status: "ISSUED", nextRenewal: "2027-05-30" }, url: "https://search.gleif.org/#/record/5493004INDUJX1TDHI57" },
      vat: { vat: "SE556703748501", country: "SE", number: "556703748501", valid: true, name: "Spotify AB", address: "REGERINGSGATAN 19, 111 53 STOCKHOLM", checkedAt: "2026-11-15T08:00:00.000Z", source: "EU VIES (European Commission)", given: false, derived: true },
      sanctions: { verdict: "pass", screenedNames: ["Spotify"], matches: [], lists: [{ list: "ofac", name: "OFAC Specially Designated Nationals (SDN)", date: "2026-11-14T18:00:00.000Z", entries: 18000, checked: true }, { list: "eu", name: "EU consolidated financial sanctions list", date: "2026-10-23T15:05:43.888Z", entries: 6269, checked: true }] },
      sources: ["Bolagsverket and SCB (Sweden)", "GLEIF (CC0)", "EU VIES (European Commission)", "OFAC, EU, UN and UK sanctions lists"], failed: {},
      checkedAt: "2026-11-15T08:00:00.000Z",
      note: "Official records only, each read live from its source. A screening and verification aid, not legal advice or a credit view: confirm any match against the official record before acting.",
    },
    async (env, q) => {
      const input = { q: opt(q, "q", 200) ?? opt(q, "name", 200), vat: opt(q, "vat", 40), lei: opt(q, "lei", 40), country: opt(q, "country", 200) };
      if (!input.q && !input.vat && !input.lei) throw new HttpError(400, "give q (company name), vat or lei");
      return kybCheck(input, defaultDeps(env));
    }, "$0.02"), // 15 Nov 2026 (prices delegated 14 Nov): four official sources in one call; still a fraction of KYB vendors' per-check prices
];
