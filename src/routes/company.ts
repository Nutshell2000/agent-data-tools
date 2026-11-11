// Company enrichment from Wikidata. Enrichment is the third-largest category agents pay for
// over x402, and Wikidata's structured data is CC0, so it can be resold without conditions.
// Two requests: search plus the candidates' claims, then labels for the linked items.
import { entry, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { type Entity, firstDate, firstQuantity, firstString, getEntities, itemIds, labelsOf, searchItems, statements } from "../lib/wikidata";

/** Wikidata items that mark an entity as a business. */
const COMPANY_SIGNALS = ["P452", "P1128", "P414", "P1278", "P159", "P169", "P2139"];

const isCompany = (e: Entity) => COMPANY_SIGNALS.some((p) => statements(e, p).length > 0);
/** How many kinds of company fact an item holds (the signals plus country), for choosing between items of one name. */
export const companySignals = (e: Entity) => [...COMPANY_SIGNALS, "P17"].filter((p) => statements(e, p).length > 0).length;

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

/** Whether the item's label or an alias is the name asked for and nothing more ("Spotify", not "Spotify Technology"). */
export function exactlyNamed(e: Entity, name: string): boolean {
  const want = nameWords(name);
  if (!want.length) return false;
  return [e.labels?.en?.value, ...(e.aliases?.en ?? []).map((a) => a.value)].some((label) => {
    const have = label ? nameWords(label) : [];
    return have.length === want.length && want.every((w) => have.includes(w));
  });
}

/**
 * The item that answers for a name or a domain, among those that matched: first the ones named exactly what was asked,
 * then the one holding the most company facts, then search order. Wikidata splits "Spotify" into the service (Q689141,
 * a CEO and little else), the company that runs it and the Luxembourg holding company. The first match used to win, so
 * the published example answered without country, headquarters, employees, industries or listings (11 Nov 2026).
 */
export function bestCompany(matches: Entity[], name?: string): Entity | undefined {
  return matches
    .map((e, i) => ({ e, i, exact: name && exactlyNamed(e, name) ? 1 : 0, facts: companySignals(e) }))
    .sort((a, b) => b.exact - a.exact || b.facts - a.facts || a.i - b.i)[0]?.e;
}

/** Linked items whose labels the answer needs. */
function linkedIds(e: Entity): string[] {
  const ids = ["P17", "P159", "P452", "P169", "P112", "P749", "P414"].flatMap((p) => itemIds(e, p));
  return [...new Set(ids)].slice(0, 50);
}

export const COMPANY: Entry[] = [
  entry("/company", "Company data lookup: profile, identifiers and website from Wikidata",
    "Facts about a company by name or Wikidata ID: official website, founding date, country, headquarters, industries, CEO, founders, parent, employee count, stock tickers and exchanges, and LEI, with Wikidata and Wikipedia links. Public domain data (CC0), best for established and listed companies. No match returns 422, uncharged. Use to enrich leads, vendors and counterparties or ground an answer about a company.",
    ["company", "enrichment", "business", "kyb", "wikidata"], {
      name: { type: "string", description: "Company name to search for (give name or id)", example: "Spotify" },
      id: { type: "string", description: "Wikidata item ID such as Q60269744, instead of name", example: "Q60269744" },
    },
    {
      // The tool's own answer for name=Spotify on 11 Nov 2026: the listed company, not the service of the same name.
      name: "Spotify Technology", description: "Luxembourgish holding company", website: "https://investors.spotify.com/home/default.aspx",
      founded: "2007-01-08", dissolved: null, country: "Luxembourg", headquarters: "Luxembourg", industries: ["software development", "streaming media"],
      ceo: "Daniel Ek", founders: ["Daniel Ek", "Martin Lorentzon"], parent: null, employees: 6617,
      stockListings: [{ exchange: "New York Stock Exchange", ticker: "SPOT" }], lei: "549300B4X0JHWV0DTD60",
      wikidataId: "Q60269744", wikidataUrl: "https://www.wikidata.org/wiki/Q60269744", wikipediaUrl: "https://en.wikipedia.org/wiki/Spotify",
      source: "Wikidata (CC0 public domain)",
    },
    async (_env, q) => {
      const rawId = opt(q, "id", 20)?.trim().toUpperCase();
      const name = opt(q, "name", 200)?.trim();
      if (!rawId && !name) throw new HttpError(400, "name or id is required");
      if (rawId && !/^Q\d{1,12}$/.test(rawId)) throw new HttpError(400, "id must be a Wikidata item ID such as Q60269744");
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
      // Several items can carry one name; bestCompany picks between them.
      const matches = rawId ? candidates.filter(isCompany) : domain ? candidates.filter((e) => isCompany(e) && onDomain(e)) : candidates.filter((e) => isCompany(e) && namedAs(e, name!));
      const best = rawId ? matches[0] : bestCompany(matches, domain ? undefined : name);
      if (!best) throw new HttpError(404, rawId ? "this Wikidata item is not a company" : domain ? `no company on Wikidata has ${domain} as its website; nothing was charged` : "no company found under this name; nothing was charged");
      const labels = await labelsOf(linkedIds(best));
      const facts = companyFacts([best], labels)!;
      // A holding or operating company often has no Wikipedia article of its own: the article hangs on the item of the
      // same name that people know (the service, the brand). Link that one rather than nothing.
      const article = facts.wikipediaUrl ? null : matches.find((e) => e.sitelinks?.enwiki?.title)?.sitelinks!.enwiki!.title;
      return article ? { ...facts, wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(article.replaceAll(" ", "_"))}` } : facts;
    }, "$0.01"),
];
