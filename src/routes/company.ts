import { HttpError } from "../lib/env";

const GLEIF = "https://api.gleif.org/api/v1/lei-records";
const LEI = /^[A-Z0-9]{18}[0-9]{2}$/;

interface Address {
  addressLines?: string[];
  city?: string;
  region?: string | null;
  country?: string;
  postalCode?: string | null;
}
interface LeiRecord {
  id: string;
  attributes: {
    lei: string;
    entity: {
      legalName?: { name?: string };
      otherNames?: { name?: string; type?: string }[];
      legalAddress?: Address;
      headquartersAddress?: Address;
      registeredAs?: string | null;
      jurisdiction?: string | null;
      category?: string | null;
      legalForm?: { id?: string | null; other?: string | null };
      status?: string;
      creationDate?: string | null;
    };
    registration: { initialRegistrationDate?: string; lastUpdateDate?: string; status?: string; nextRenewalDate?: string };
    bic?: string[] | null;
  };
}

async function gleif<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${GLEIF}${path}`, {
      headers: { accept: "application/vnd.api+json", "user-agent": "AgentDataTools/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new HttpError(502, "the GLEIF company register did not respond");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `the GLEIF company register returned HTTP ${res.status}`);
  return res.json();
}

const address = (a?: Address) =>
  a ? { lines: a.addressLines ?? [], city: a.city ?? null, region: a.region ?? null, postalCode: a.postalCode ?? null, country: a.country ?? null } : null;

function company(r: LeiRecord) {
  const { entity: e, registration: reg } = r.attributes;
  return {
    lei: r.attributes.lei,
    name: e.legalName?.name ?? null,
    otherNames: (e.otherNames ?? []).map((n) => n.name).filter(Boolean),
    status: e.status ?? null,
    legalForm: e.legalForm?.other ?? e.legalForm?.id ?? null,
    jurisdiction: e.jurisdiction ?? null,
    registryNumber: e.registeredAs ?? null,
    category: e.category ?? null,
    founded: e.creationDate ?? null,
    legalAddress: address(e.legalAddress),
    headquarters: address(e.headquartersAddress),
    bic: r.attributes.bic ?? [],
    leiRegistration: {
      status: reg.status ?? null,
      firstRegistered: reg.initialRegistrationDate ?? null,
      lastUpdated: reg.lastUpdateDate ?? null,
      nextRenewal: reg.nextRenewalDate ?? null,
    },
  };
}

const parent = async (lei: string, kind: "direct-parent" | "ultimate-parent") => {
  const res = await gleif<{ data: LeiRecord }>(`/${lei}/${kind}`).catch(() => null);
  return res?.data ? { lei: res.data.attributes.lei, name: res.data.attributes.entity.legalName?.name ?? null, country: res.data.attributes.entity.legalAddress?.country ?? null } : null;
};

/** Looks up companies in the Global LEI register: by name, or one company by its LEI with its parents. */
export async function companyLookup(queryInput?: string, countryInput?: string, limitInput?: string) {
  const query = (queryInput ?? "").trim();
  const country = (countryInput ?? "").trim().toUpperCase();
  const lei = query.replace(/\s/g, "").toUpperCase();

  if (LEI.test(lei)) {
    const res = await gleif<{ data: LeiRecord }>(`/${lei}`);
    if (!res?.data) throw new HttpError(404, "no company has this LEI");
    const [directParent, ultimateParent] = await Promise.all([parent(lei, "direct-parent"), parent(lei, "ultimate-parent")]);
    return {
      match: "lei",
      companies: [{ ...company(res.data), directParent, ultimateParent }],
      source: "GLEIF Global LEI Index (official, updated daily)",
      checkedAt: new Date().toISOString(),
    };
  }

  if (query.length < 2) throw new HttpError(400, "query must be a company name (at least 2 characters) or a 20-character LEI");
  if (country && !/^[A-Z]{2}$/.test(country)) throw new HttpError(400, "country must be a two-letter ISO code such as US or SE");
  const limit = limitInput ? Math.trunc(Number(limitInput)) : 5;
  if (!(limit >= 1 && limit <= 20)) throw new HttpError(400, "limit must be between 1 and 20");

  const params = new URLSearchParams({ "filter[fulltext]": query, "page[size]": String(limit) });
  if (country) params.set("filter[entity.legalAddress.country]", country);
  const res = await gleif<{ data: LeiRecord[]; meta?: { pagination?: { total?: number } } }>(`?${params}`);
  const companies = (res?.data ?? []).map(company);
  return {
    match: "name",
    query,
    country: country || null,
    total: res?.meta?.pagination?.total ?? companies.length,
    companies,
    note: companies.length ? "Pass a company's LEI as query to get that one company with its direct and ultimate parent." : "No company in the LEI register matches. Small businesses often have no LEI.",
    source: "GLEIF Global LEI Index (official, updated daily)",
    checkedAt: new Date().toISOString(),
  };
}
