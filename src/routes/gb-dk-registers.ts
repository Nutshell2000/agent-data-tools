/**
 * UK and Danish company registers for /company/search (15 Nov 2026, Beat-Exa plan 4b step 5). Both need credentials,
 * so each searcher exists only when its Worker secret is set; without it the country is searched through GLEIF, as before.
 * - United Kingdom: Companies House public data API (free key; 600 requests per 5 minutes per key; Open Government
 *   Licence). Secret COMPANIES_HOUSE_API_KEY. Company search only: officers and persons with significant control are
 *   never read.
 * - Denmark: the Central Business Register (CVR) system-to-system access of the Danish Business Authority
 *   (Erhvervsstyrelsen), an Elasticsearch index. Secrets CVR_USER and CVR_PASSWORD. Sole proprietorships are left out
 *   (they are named after a person), and beneficial-owner data (closed since 1 Sep 2025) is never asked for.
 * Register facts only: no score, rating or opinion on creditworthiness, the same line as /se/company.
 */
import { HttpError, type Env } from "../lib/env";
import { rankByName } from "./cz-ee-company";

const UA = "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)";
export const GB_SOURCE = "Companies House (UK), Open Government Licence v3.0";
export const DK_SOURCE = "CVR, Danish Business Authority (Erhvervsstyrelsen)";

/** Companies House company_type codes for the common forms; any other code is shown as given. */
const GB_TYPES: Record<string, string> = {
  ltd: "Private limited company (Ltd)", plc: "Public limited company (PLC)", llp: "Limited liability partnership (LLP)",
  "private-limited-guarant-nsc": "Private company limited by guarantee", "private-limited-guarant-nsc-limited-exemption": "Private company limited by guarantee",
  "private-unlimited": "Private unlimited company", "limited-partnership": "Limited partnership",
  "oversea-company": "Overseas company (UK establishment of a foreign company)", "registered-society-non-jurisdictional": "Registered society",
  "scottish-partnership": "Scottish partnership",
};

export interface RegisterMatch { name: string; number: string; legalForm: string | null; city: string | null; status: string | null }

/** Active entries first (a UK name search returns many dissolved companies), each group ranked by name. */
const activeFirst = (rows: RegisterMatch[], query: string) => {
  const ranked = rankByName(rows, query);
  return [...ranked.filter((r) => !r.status || /^(active|aktiv|normal)/i.test(r.status)), ...ranked.filter((r) => r.status && !/^(active|aktiv|normal)/i.test(r.status))];
};

export function gbMatches(body: unknown, query: string, limit: number): RegisterMatch[] {
  const items = ((body as { items?: unknown[] } | null)?.items ?? []) as { title?: string; company_number?: string; company_status?: string; company_type?: string; address?: { locality?: string } }[];
  const rows = items.filter((i) => i.title && i.company_number).map((i) => ({
    name: i.title!, number: i.company_number!,
    legalForm: i.company_type ? (Object.hasOwn(GB_TYPES, i.company_type) ? GB_TYPES[i.company_type] : i.company_type) : null,
    city: i.address?.locality ?? null, status: i.company_status ?? null,
  }));
  return activeFirst(rows, query).slice(0, limit);
}

export async function gbSearch(key: string, name: string, limit: number, fetcher: typeof fetch = fetch) {
  const r = await fetcher(`https://api.company-information.service.gov.uk/search/companies?${new URLSearchParams({ q: name, items_per_page: String(Math.min(50, limit * 4)) })}`, {
    headers: { authorization: `Basic ${btoa(`${key}:`)}`, accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(8_000),
  });
  if (r.status === 404) return { matches: [] };
  if (r.status === 429) throw new HttpError(503, "Companies House is busy (rate limit); try again in a minute");
  if (!r.ok) throw new HttpError(502, `Companies House answered HTTP ${r.status}`);
  return { matches: gbMatches(await r.json(), name, limit) };
}

const DK_FIELDS = ["cvrNummer", "nyesteNavn.navn", "nyesteVirksomhedsform.langBeskrivelse", "nyesteBeliggenhedsadresse.postdistrikt", "sammensatStatus"];
/** The Elasticsearch body: every query word in the newest name. */
export function dkQuery(name: string, size: number) {
  return {
    size,
    _source: DK_FIELDS.map((f) => `Vrvirksomhed.${f.startsWith("cvr") ? f : `virksomhedMetadata.${f}`}`),
    query: { bool: { must: [{ match: { "Vrvirksomhed.virksomhedMetadata.nyesteNavn.navn": { query: name, operator: "and" } } }] } },
  };
}
/** Sole proprietorships are named after their owner: left out, as in the other registers. */
const DK_PERSONAL = /enkeltmandsvirksomhed|personligt ejet/i;
export function dkMatches(body: unknown, query: string, limit: number): RegisterMatch[] {
  const hits = ((body as { hits?: { hits?: { _source?: { Vrvirksomhed?: Record<string, unknown> } }[] } } | null)?.hits?.hits ?? []);
  const rows: RegisterMatch[] = [];
  for (const h of hits) {
    const v = h._source?.Vrvirksomhed as { cvrNummer?: number | string; virksomhedMetadata?: { nyesteNavn?: { navn?: string }; nyesteVirksomhedsform?: { langBeskrivelse?: string }; nyesteBeliggenhedsadresse?: { postdistrikt?: string }; sammensatStatus?: string } } | undefined;
    const m = v?.virksomhedMetadata;
    const form = m?.nyesteVirksomhedsform?.langBeskrivelse ?? null;
    if (!v?.cvrNummer || !m?.nyesteNavn?.navn || (form && DK_PERSONAL.test(form))) continue;
    rows.push({ name: m.nyesteNavn.navn, number: String(v.cvrNummer).padStart(8, "0"), legalForm: form, city: m.nyesteBeliggenhedsadresse?.postdistrikt ?? null, status: m.sammensatStatus ?? null });
  }
  return activeFirst(rows, query).slice(0, limit);
}

export async function dkSearch(user: string, password: string, name: string, limit: number, fetcher: typeof fetch = fetch) {
  const r = await fetcher("http://distribution.virk.dk/cvr-permanent/virksomhed/_search", {
    method: "POST", body: JSON.stringify(dkQuery(name, Math.min(50, limit * 4))),
    headers: { authorization: `Basic ${btoa(`${user}:${password}`)}`, "content-type": "application/json", accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(8_000),
  });
  if (r.status === 401 || r.status === 403) throw new HttpError(503, "the Danish CVR register refused our credentials");
  if (!r.ok) throw new HttpError(502, `the Danish CVR register answered HTTP ${r.status}`);
  return { matches: dkMatches(await r.json(), name, limit) };
}

/** The searchers whose credentials are set on this deployment (none on a deployment without the secrets). */
export function keyedSearchers(env: Pick<Env, "COMPANIES_HOUSE_API_KEY" | "CVR_USER" | "CVR_PASSWORD"> | undefined) {
  const out: Record<string, { search: (n: string, l: number) => Promise<{ matches: RegisterMatch[] }>; idType: string; id: (m: RegisterMatch) => string; source: string }> = {};
  if (env?.COMPANIES_HOUSE_API_KEY) out.GB = { search: (n, l) => gbSearch(env.COMPANIES_HOUSE_API_KEY!, n, l), idType: "company number", id: (m) => m.number, source: GB_SOURCE };
  if (env?.CVR_USER && env?.CVR_PASSWORD) out.DK = { search: (n, l) => dkSearch(env.CVR_USER!, env.CVR_PASSWORD!, n, l), idType: "CVR number", id: (m) => m.number, source: DK_SOURCE };
  return out;
}
