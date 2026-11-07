/**
 * Company and domain registries (6 Nov 2026). Bazaar search that day, payers summed over the top 20: "lei lookup" 48,
 * "vat validation" 48, "domain availability" 32; we had none of the three.
 * - LEI: GLEIF's public API (api.gleif.org, CC0, keyless, ~240 ms from Cloudflare).
 * - VAT: the EU Commission's VIES REST API (keyless, ~700 ms from Cloudflare; it refused the home PC in Oct 2026).
 * - Domain availability: RDAP through rdap.org's bootstrap redirect; a 404 from the registry's own RDAP server means the name
 *   is not registered. rdap.org answers 404 itself for TLDs without RDAP (.io, .me, .co), so those fall back to DNS: no NS
 *   records reads "likely available".
 */
import { entry, getJson, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";

// ---------- LEI ----------
interface LeiRecord {
  id: string;
  attributes: {
    lei: string;
    entity: { legalName?: { name?: string }; otherNames?: { name?: string }[]; status?: string; jurisdiction?: string; category?: string; legalForm?: { id?: string; other?: string | null };
      legalAddress?: Address; headquartersAddress?: Address; registeredAs?: string | null; creationDate?: string | null };
    registration?: { status?: string; initialRegistrationDate?: string; lastUpdateDate?: string; nextRenewalDate?: string; corroborationLevel?: string };
  };
}
interface Address { addressLines?: string[]; city?: string; region?: string | null; country?: string; postalCode?: string | null }
const addr = (a?: Address) => (a ? { lines: a.addressLines ?? [], city: a.city ?? null, region: a.region ?? null, country: a.country ?? null, postalCode: a.postalCode ?? null } : null);

export function leiView(r: LeiRecord) {
  const e = r.attributes.entity, g = r.attributes.registration ?? {};
  return {
    lei: r.attributes.lei, legalName: e.legalName?.name ?? null, otherNames: (e.otherNames ?? []).map((n) => n.name).filter(Boolean).slice(0, 5),
    entityStatus: e.status ?? null, category: e.category ?? null, jurisdiction: e.jurisdiction ?? null, registeredAs: e.registeredAs ?? null,
    legalAddress: addr(e.legalAddress), headquarters: addr(e.headquartersAddress), founded: e.creationDate?.slice(0, 10) ?? null,
    registration: { status: g.status ?? null, issued: g.initialRegistrationDate?.slice(0, 10) ?? null, lastUpdate: g.lastUpdateDate?.slice(0, 10) ?? null, nextRenewal: g.nextRenewalDate?.slice(0, 10) ?? null, corroboration: g.corroborationLevel ?? null },
    url: `https://search.gleif.org/#/record/${r.attributes.lei}`,
  };
}
const LEI = /^[A-Z0-9]{18}[0-9]{2}$/;

// ---------- VAT ----------
/** "SE556703748501", "SE 5567-0374-8501 01", "GB…" -> country prefix and number. Greece's prefix in VIES is EL. */
export function vatParts(raw: string): { country: string; number: string } | null {
  const s = raw.toUpperCase().replace(/[\s.\-/]/g, "");
  const m = /^([A-Z]{2})([0-9A-Z+*]{2,14})$/.exec(s);
  if (!m) return null;
  return { country: m[1] === "GR" ? "EL" : m[1], number: m[2] };
}
const VIES_COUNTRIES = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"]);

// ---------- domains ----------
const DEFAULT_TLDS = ["com", "net", "org", "io", "ai", "co", "app", "dev", "xyz", "me"];
interface Rdap { events?: { eventAction?: string; eventDate?: string }[]; entities?: { roles?: string[]; vcardArray?: [string, [string, unknown, string, string][]] }[]; status?: string[] }

export async function domainStatus(domain: string, fetcher: typeof fetch = fetch) {
  // Why the answer falls back to DNS: no RDAP service for the TLD, or a registry RDAP server that refused us. CentralNic
  // (.xyz, .site, .online, .store and others) answers Cloudflare Workers with 403 (checked from Cloudflare on 7 Nov 2026).
  let why = "no RDAP for this TLD";
  try {
    // rdap.org answers 403 to requests without a User-Agent (6 Nov 2026).
    const res = await fetcher(`https://rdap.org/domain/${domain}`, { headers: { accept: "application/rdap+json", "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)" }, redirect: "follow", signal: AbortSignal.timeout(6_000) });
    const fromRegistry = !/^https:\/\/rdap\.org\//.test(res.url || "https://rdap.org/");
    if (res.status === 200) {
      const b = (await res.json().catch(() => ({}))) as Rdap;
      const ev = (a: string) => b.events?.find((e) => e.eventAction === a)?.eventDate?.slice(0, 10) ?? null;
      const registrar = b.entities?.find((e) => e.roles?.includes("registrar"))?.vcardArray?.[1]?.find((f) => f[0] === "fn")?.[3] ?? null;
      return { domain, status: "taken", method: "rdap", registrar, created: ev("registration"), expires: ev("expiration") };
    }
    await res.body?.cancel().catch(() => {});
    if (res.status === 404 && fromRegistry) return { domain, status: "available", method: "rdap" };
    if (fromRegistry) why = `the registry's RDAP server answered HTTP ${res.status}`;
  } catch {
    why = "the RDAP lookup did not answer in time";
  }
  // No RDAP for this TLD (or it failed): name servers in DNS mean registered.
  try {
    const r = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(4_000) });
    const d = (await r.json()) as { Status?: number };
    if (d.Status === 3) return { domain, status: "likely available", method: "dns", note: `${why}; the name does not exist in DNS, so it is probably unregistered (check with a registrar)` };
    if (d.Status === 0) return { domain, status: "taken", method: "dns" };
  } catch {
    // unknown below
  }
  return { domain, status: "unknown", method: null };
}

export const REGISTRIES: Entry[] = [
  entry("/lei/lookup", "LEI lookup, legal entity identifier",
    "Look up a Legal Entity Identifier from GLEIF: by 20-character LEI, or search by company name for up to 10 matches. Legal name, other names, entity status, category, jurisdiction, company register ID, legal and headquarters address, LEI registration status, issue, renewal and corroboration. Source: GLEIF (CC0). Use for KYB, counterparty checks, trade reporting and matching companies across systems.",
    ["lei-lookup", "legal-entity-identifier", "gleif", "kyb", "company-lookup", "compliance"], {
      lei: { type: "string", description: "A 20-character LEI", example: "HWUPKR0MPOU8FGXBT394" },
      name: { type: "string", description: "Company name to search, instead of lei", example: "Volvo" },
      limit: { type: "integer", description: "Matches for a name search (1-10, default 5)", example: 5 },
    },
    {
      count: 1, records: [{ lei: "HWUPKR0MPOU8FGXBT394", legalName: "Apple Inc.", otherNames: [], entityStatus: "ACTIVE", category: "GENERAL", jurisdiction: "US-CA", registeredAs: "806592", legalAddress: { lines: ["C/O C T Corporation System", "330 N. Brand Blvd", "Suite 700"], city: "Glendale", region: "US-CA", country: "US", postalCode: "91203" }, headquarters: null, founded: null, registration: { status: "ISSUED", issued: "2012-06-06", lastUpdate: "2026-03-03", nextRenewal: "2027-03-08", corroboration: "FULLY_CORROBORATED" }, url: "https://search.gleif.org/#/record/HWUPKR0MPOU8FGXBT394" }],
      source: "GLEIF (CC0)",
    },
    async (_env, q) => {
      const lei = opt(q, "lei", 40)?.toUpperCase().replace(/\s+/g, "");
      if (lei) {
        if (!LEI.test(lei)) throw new HttpError(400, "lei must be 20 characters: 18 letters or digits and 2 check digits");
        const r = await getJson<{ data?: LeiRecord }>(`https://api.gleif.org/api/v1/lei-records/${lei}`, { timeoutMs: 8_000, notFound: `no LEI record ${lei}; nothing was charged` });
        if (!r.data) throw new HttpError(404, `no LEI record ${lei}; nothing was charged`);
        return { count: 1, records: [leiView(r.data)], source: "GLEIF (CC0)" };
      }
      const name = opt(q, "name", 200) ?? opt(q, "q", 200);
      if (!name) throw new HttpError(400, "give lei or name");
      const limit = num(q, "limit", { min: 1, max: 10, fallback: 5, integer: true });
      const r = await getJson<{ data?: LeiRecord[] }>(`https://api.gleif.org/api/v1/lei-records?${new URLSearchParams({ "filter[fulltext]": name, "page[size]": String(limit) })}`, { timeoutMs: 8_000 });
      const records = (r.data ?? []).map(leiView);
      if (!records.length) throw new HttpError(404, `no LEI record matches ${name.slice(0, 60)}; nothing was charged`);
      return { count: records.length, records, source: "GLEIF (CC0)" };
    }),

  entry("/vat/validate", "VAT number validation, EU VIES",
    "Check an EU VAT number against the European Commission's VIES service: valid or not, and the registered company name and address where the member state shares them, with the check time. Accepts the number with its country prefix in any spacing (SE556703748501, DE 123 456 789, GR or EL for Greece, XI for Northern Ireland). Use to verify a B2B customer before invoicing without VAT, or to confirm a supplier.",
    ["vat-validation", "vat-number", "vies", "eu-vat", "kyb", "compliance"], {
      vat: { type: "string", description: "VAT number with its 2-letter EU country prefix", required: true, example: "SE556703748501" },
    },
    { vat: "SE556703748501", country: "SE", number: "556703748501", valid: true, name: "Spotify AB", address: "REGERINGSGATAN 19, 111 53 STOCKHOLM", checkedAt: "2026-11-06T14:36:47.903Z", source: "EU VIES (European Commission)" },
    async (_env, q) => {
      const raw = need(q, "vat", 40);
      const parts = vatParts(raw);
      if (!parts) throw new HttpError(400, "vat must start with a 2-letter EU country code, e.g. SE556703748501");
      if (!VIES_COUNTRIES.has(parts.country)) throw new HttpError(400, `${parts.country} is not an EU VIES country (GB numbers are checked by HMRC, not VIES)`);
      let res: Response;
      try {
        res = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${parts.country}/vat/${encodeURIComponent(parts.number)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      } catch {
        throw new HttpError(502, "VIES did not answer in time; try again");
      }
      const b = (await res.json().catch(() => null)) as { isValid?: boolean; requestDate?: string; userError?: string; name?: string; address?: string } | null;
      if (!res.ok || !b || typeof b.isValid !== "boolean") throw new HttpError(502, `VIES answered ${b?.userError ?? `HTTP ${res.status}`}; the member state's service may be down, try again`);
      if (b.userError && !["VALID", "INVALID"].includes(b.userError)) throw new HttpError(502, `VIES answered ${b.userError}; try again`);
      const clean = (s?: string) => (s && s !== "---" ? s.replace(/\s*\n\s*/g, ", ").trim() : null);
      return { vat: `${parts.country}${parts.number}`, country: parts.country, number: parts.number, valid: b.isValid, name: clean(b.name), address: clean(b.address), checkedAt: b.requestDate ?? new Date().toISOString(), source: "EU VIES (European Commission)" };
    }),

  entry("/domain/availability", "Domain availability, domain name search",
    "Is a domain name free? Check one name across up to 20 TLDs at once (default com, net, org, io, ai, co, app, dev, xyz, me): available, taken (with registrar, creation and expiry dates) or likely available, from each registry's RDAP server, with DNS where a TLD has no RDAP. Use to pick a product or company name, or to check a brand before launch. Availability is not a price quote: premium and reserved names exist.",
    ["domain-availability", "domain-search", "domain-name", "rdap", "domains", "branding"], {
      name: { type: "string", description: "The name to check, with or without a TLD (acme, acme.com)", required: true, example: "agentdatatools" },
      tlds: { type: "string", description: "TLDs to check, comma-separated (default com,net,org,io,ai,co,app,dev,xyz,me)", example: "com,io,ai" },
    },
    {
      name: "agentdatatools", available: ["agentdatatools.com", "agentdatatools.net"], results: [
        { domain: "agentdatatools.com", status: "available", method: "rdap" },
        { domain: "agentdatatools.net", status: "available", method: "rdap" },
      ],
    },
    async (_env, q) => {
      const raw = need(q, "name", 100).toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
      const [label, ...rest] = raw.split(".");
      if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label)) throw new HttpError(400, "name must be a domain label: letters, digits and hyphens, at most 63 characters");
      const given = opt(q, "tlds", 300)?.toLowerCase().split(/[,\s]+/).map((t) => t.replace(/^\./, "")).filter(Boolean);
      const tlds = [...new Set(given?.length ? given : rest.length ? [rest.join("."), ...DEFAULT_TLDS] : DEFAULT_TLDS)].slice(0, 20);
      for (const t of tlds) if (!/^[a-z0-9-]{2,30}(\.[a-z0-9-]{2,30})?$/.test(t)) throw new HttpError(400, `"${t.slice(0, 20)}" is not a TLD`);
      const results = await Promise.all(tlds.map((t) => domainStatus(`${label}.${t}`)));
      return { name: label, available: results.filter((r) => r.status === "available").map((r) => r.domain), results };
    }),
];
