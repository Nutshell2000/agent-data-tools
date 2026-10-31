// Company enrichment from Wikidata. Enrichment is the third-largest category agents pay for
// over x402, and Wikidata's structured data is CC0, so it can be resold without conditions.
// Two requests: search plus the candidates' claims, then labels for the linked items.
import { entry, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { type Entity, firstDate, firstQuantity, firstString, getEntities, itemIds, labelsOf, searchItems, statements } from "../lib/wikidata";

/** Wikidata items that mark an entity as a business. */
const COMPANY_SIGNALS = ["P452", "P1128", "P414", "P1278", "P159", "P169", "P2139"];

const isCompany = (e: Entity) => COMPANY_SIGNALS.some((p) => statements(e, p).length > 0);

/** Picks the first search hit that looks like a business and shapes its facts. */
export function companyFacts(candidates: Entity[], labels: Record<string, string>) {
  const e = candidates.find(isCompany);
  if (!e) return null;
  const names = (ids: string[]) => ids.map((id) => labels[id]).filter(Boolean);
  const listings = statements(e, "P414").map((c) => ({
    exchange: labels[(c.mainsnak.datavalue!.value as { id: string }).id] ?? null,
    ticker: (c.qualifiers?.P249?.[0]?.datavalue?.value as string | undefined) ?? null,
  }));
  const wiki = e.sitelinks?.enwiki?.title;
  return {
    name: e.labels?.en?.value ?? e.id,
    description: e.descriptions?.en?.value ?? null,
    website: firstString(e, "P856"),
    founded: firstDate(e, "P571"),
    dissolved: firstDate(e, "P576"),
    country: names(itemIds(e, "P17"))[0] ?? null,
    headquarters: names(itemIds(e, "P159"))[0] ?? null,
    industries: names(itemIds(e, "P452")),
    ceo: names(itemIds(e, "P169"))[0] ?? null,
    founders: names(itemIds(e, "P112")),
    parent: names(itemIds(e, "P749"))[0] ?? null,
    employees: firstQuantity(e, "P1128"),
    stockListings: listings,
    lei: firstString(e, "P1278"),
    wikidataId: e.id,
    wikidataUrl: `https://www.wikidata.org/wiki/${e.id}`,
    wikipediaUrl: wiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wiki.replaceAll(" ", "_"))}` : null,
    source: "Wikidata (CC0 public domain)",
  };
}

/** The registrable-looking host of a domain or URL, without www. */
function domainOf(raw: string) {
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return raw.toLowerCase(); }
}

const LEGAL_FORMS = new Set(["inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "gmbh", "ag", "sa", "nv", "bv", "ab", "as", "asa", "oy", "oyj", "spa", "srl", "the"]);
const nameWords = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !LEGAL_FORMS.has(w));

/** Whether an item is actually named what was asked for: every word of the name is in its label or one alias. Search also matches descriptions. */
export function namedAs(e: Entity, name: string): boolean {
  const want = nameWords(name);
  if (!want.length) return false;
  return [e.labels?.en?.value, ...(e.aliases?.en ?? []).map((a) => a.value)].some((label) => {
    if (!label) return false;
    const have = new Set(nameWords(label));
    return want.every((w) => have.has(w));
  });
}

/** Linked items whose labels the answer needs. */
function linkedIds(e: Entity): string[] {
  const ids = ["P17", "P159", "P452", "P169", "P112", "P749", "P414"].flatMap((p) => itemIds(e, p));
  return [...new Set(ids)].slice(0, 50);
}

export const COMPANY: Entry[] = [
  entry("/company", "Company data lookup: profile, identifiers and website from Wikidata",
    "Facts about a company by name or Wikidata ID: official website, founding date, country, headquarters, industries, CEO, founders, parent, employee count, stock tickers and exchanges, and LEI, with Wikidata and Wikipedia links. Public domain data (CC0), best for established and listed companies. No match returns 404, uncharged. Use to enrich leads, vendors and counterparties or ground an answer about a company.",
    ["company", "enrichment", "business", "kyb", "wikidata"], {
      name: { type: "string", description: "Company name to search for (give name or id)", example: "Spotify" },
      id: { type: "string", description: "Wikidata item ID such as Q689141, instead of name", example: "Q689141" },
    },
    {
      name: "Spotify", description: "Swedish audio streaming service", website: "https://www.spotify.com/",
      founded: "2006-04-23", dissolved: null, country: "Sweden", headquarters: "Stockholm", industries: ["music streaming"],
      ceo: null, founders: ["Daniel Ek", "Martin Lorentzon"], parent: null, employees: 7000,
      stockListings: [{ exchange: "New York Stock Exchange", ticker: "SPOT" }], lei: null,
      wikidataId: "Q689141", wikidataUrl: "https://www.wikidata.org/wiki/Q689141", wikipediaUrl: "https://en.wikipedia.org/wiki/Spotify",
      source: "Wikidata (CC0 public domain)",
    },
    async (_env, q) => {
      const rawId = opt(q, "id", 20)?.trim().toUpperCase();
      const name = opt(q, "name", 200)?.trim();
      if (!rawId && !name) throw new HttpError(400, "name or id is required");
      if (rawId && !/^Q\d{1,12}$/.test(rawId)) throw new HttpError(400, "id must be a Wikidata item ID such as Q689141");
      // A domain or URL ("stripe.com", "https://www.stripe.com/pricing"): search its label and prefer the company whose
      // official website (P856) is on that domain. Wikidata's text search finds nothing for a bare domain.
      const domain = name && !/\s/.test(name) && /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(name) ? domainOf(name) : null;
      const query = domain ? domain.split(".").slice(0, -1).join(" ").replace(/^www /, "") || domain : name!;
      const ids = rawId ? [rawId] : await searchItems(query, domain ? 10 : 7);
      if (!ids.length) throw new HttpError(404, domain ? `no Wikidata item matches the domain ${domain}` : "no Wikidata item matches this name");
      const entities = await getEntities(ids);
      const candidates = ids.map((id) => entities[id]).filter((e): e is Entity => Boolean(e?.claims));
      const onDomain = (e: Entity) => { try { const host = new URL(firstString(e, "P856") ?? "http://-").hostname.replace(/^www\./, ""); return host === domain || host.endsWith(`.${domain}`); } catch { return false; } };
      // A domain must match the company's own website and a name its own name: a wrong company is worse than an uncharged 404
      // (31 Oct 2026: posthog.com answered a Brussels art school, cal.com answered Caltech).
      const best = rawId ? candidates.find(isCompany) : domain ? candidates.find((e) => isCompany(e) && onDomain(e)) : candidates.find((e) => isCompany(e) && namedAs(e, name!));
      if (!best) throw new HttpError(404, rawId ? "this Wikidata item is not a company" : domain ? `no company on Wikidata has ${domain} as its website; nothing was charged` : "no company found under this name; nothing was charged");
      const labels = await labelsOf(linkedIds(best));
      return companyFacts([best], labels)!;
    }, "$0.01"),
];
