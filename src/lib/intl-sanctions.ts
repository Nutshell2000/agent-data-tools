// EU, UN and UK sanctions lists, parsed into one compact index for /sanctions/check.
// Sources (all free to reuse):
//   EU  Financial Sanctions Files, consolidated list (European Commission, reuse policy 2011/833/EU)
//   UN  Security Council Consolidated List (United Nations, public)
//   UK  UK Sanctions List (FCDO, Open Government Licence v3.0)
// The XML files are 2-26 MB, so .github/workflows/ofac-mirror.yml parses them on GitHub's servers
// (scripts/build-intl-sanctions-index.mjs) and the Worker only loads the result.

export type ListKey = "eu" | "un" | "uk";
export const LIST_NAMES: Record<ListKey, string> = {
  eu: "EU consolidated financial sanctions list",
  un: "UN Security Council Consolidated List",
  uk: "UK Sanctions List (FCDO)",
};
export const LIST_SOURCES: Record<ListKey, string> = {
  eu: "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw",
  un: "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
  uk: "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml",
};

/** One listed party: [list, list's own id, primary name, person|entity|ship, programmes or regimes]. */
export type IntlParty = [list: ListKey, id: string, name: string, type: string, programs: string[]];
export interface IntlCompact {
  v: 1;
  builtAt: string;
  lists: Partial<Record<ListKey, { date: string | null; entries: number }>>;
  parties: IntlParty[];
  /** [index into parties, alias name] */
  aliases: [number, string][];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unxml = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m)
    .replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => unxml(tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? "");
const text = (block: string, tag: string) => unxml(block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
const texts = (block: string, tag: string) => [...block.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => unxml(m[1])).filter(Boolean);
const blocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "g"))].map((m) => m[0]);
const uniq = <T>(a: T[]) => [...new Set(a)];

interface Parsed { date: string | null; parties: { id: string; name: string; type: string; programs: string[]; aliases: string[] }[] }

/** EU Financial Sanctions Files, xmlFullSanctionsList_1_1. */
export function parseEu(xml: string): Parsed {
  const date = xml.match(/<export[^>]*\sgenerationDate="([^"]+)"/)?.[1] ?? null;
  const parties: Parsed["parties"] = [];
  for (const b of blocks(xml, "sanctionEntity")) {
    const open = b.slice(0, b.indexOf(">") + 1);
    const id = attr(open, "euReferenceNumber") || attr(open, "logicalId");
    // The EU file lists a name in every EU language, in no fixed order: show the English (or an untagged
    // Latin-script) spelling as the name and keep the others as aliases.
    const rank = (lang: string, name: string) => (lang === "EN" ? 0 : !/[^\u0000-ɏ]/.test(name) ? (lang === "" ? 1 : 2) : 3);
    const tagged = [...b.matchAll(/<nameAlias\s[^>]*>/g)].map((m, i) => ({ name: attr(m[0], "wholeName"), r: rank(attr(m[0], "nameLanguage").toUpperCase(), attr(m[0], "wholeName")), i }))
      .filter((n) => n.name).sort((x, y) => x.r - y.r || x.i - y.i);
    const names = uniq(tagged.map((n) => n.name));
    if (!id || !names.length) continue;
    const code = attr(b.match(/<subjectType\s[^>]*>/)?.[0] ?? "", "code");
    const programs = uniq([...b.matchAll(/<regulation\s[^>]*>/g)].map((m) => attr(m[0], "programme")).filter(Boolean));
    parties.push({ id, name: names[0], type: code === "person" ? "person" : "entity", programs, aliases: names.slice(1) });
  }
  return { date: date ? new Date(date).toISOString() : null, parties };
}

/** UN Security Council Consolidated List XML. */
export function parseUn(xml: string): Parsed {
  const date = xml.match(/<CONSOLIDATED_LIST[^>]*\sdateGenerated="([^"]+)"/)?.[1] ?? null;
  const parties: Parsed["parties"] = [];
  for (const [tag, type] of [["INDIVIDUAL", "person"], ["ENTITY", "entity"]] as const) {
    for (const b of blocks(xml, tag)) {
      const id = text(b, "REFERENCE_NUMBER") || text(b, "DATAID");
      const name = ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"].map((t) => text(b, t)).filter(Boolean).join(" ");
      if (!id || !name) continue;
      const aliases = uniq([...texts(b, "ALIAS_NAME"), text(b, "NAME_ORIGINAL_SCRIPT")].filter((a) => a && a !== name));
      parties.push({ id, name, type, programs: uniq([text(b, "UN_LIST_TYPE")].filter(Boolean)), aliases });
    }
  }
  return { date: date ? new Date(date).toISOString() : null, parties };
}

/** UK Sanctions List XML (FCDO, the UK's single list since January 2026). Dates are dd/mm/yyyy. */
export function parseUk(xml: string): Parsed {
  const d = xml.match(/<DateGenerated>(\d\d)\/(\d\d)\/(\d{4})<\/DateGenerated>/);
  const parties: Parsed["parties"] = [];
  for (const b of blocks(xml, "Designation")) {
    const id = text(b, "UniqueID");
    let primary = "";
    const aliases: string[] = [];
    for (const n of blocks(b, "Name")) {
      const full = ["Name1", "Name2", "Name3", "Name4", "Name5", "Name6"].map((t) => text(n, t)).filter(Boolean).join(" ");
      if (!full) continue;
      if (!primary && /primary/i.test(text(n, "NameType"))) primary = full; else aliases.push(full);
    }
    for (const n of texts(b, "NameNonLatinScript")) aliases.push(n);
    if (!primary) primary = aliases.shift() ?? "";
    if (!id || !primary) continue;
    const kind = text(b, "IndividualEntityShip").toLowerCase();
    parties.push({ id, name: primary, type: kind === "individual" ? "person" : kind === "ship" ? "ship" : "entity", programs: uniq([text(b, "RegimeName")].filter(Boolean)), aliases: uniq(aliases.filter((a) => a !== primary)) });
  }
  return { date: d ? `${d[3]}-${d[2]}-${d[1]}T00:00:00.000Z` : null, parties };
}

/** Joins the parsed lists into the compact index. A list missing from `sources` is simply left out. */
export function compactIntl(sources: Partial<Record<ListKey, string>>, builtAt = new Date().toISOString()): IntlCompact {
  const out: IntlCompact = { v: 1, builtAt, lists: {}, parties: [], aliases: [] };
  const parsers: Record<ListKey, (x: string) => Parsed> = { eu: parseEu, un: parseUn, uk: parseUk };
  for (const key of Object.keys(parsers) as ListKey[]) {
    const xml = sources[key];
    if (!xml) continue;
    const parsed = parsers[key](xml);
    out.lists[key] = { date: parsed.date, entries: parsed.parties.length };
    for (const p of parsed.parties) {
      const i = out.parties.push([key, p.id, p.name, p.type, p.programs]) - 1;
      for (const a of p.aliases) out.aliases.push([i, a]);
    }
  }
  return out;
}

/** Fewest entries a list must have to be trusted (well under today's counts: EU ~5,800, UN ~1,000, UK ~5,500). */
export const MIN_ENTRIES: Record<ListKey, number> = { eu: 2000, un: 500, uk: 2000 };
