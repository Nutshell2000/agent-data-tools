/**
 * Place names for telling a keyword suggestion that merely names the caller's location apart from a real keyword
 * (11 Nov 2026 audit of /keywords/ideas: autocomplete engines localise by the caller's IP whatever region is asked, so
 * production answers carried "running shoes stockholm" and "running shoes sweden" for country=gb, "crm software 11e arr."
 * and "plumber florissant-malagnou" from Cloudflare's egress). The gazetteer is the cities with a scheduled-service
 * airport in OurAirports (public domain, already bundled for the airport tools): about 3,000 cities, which include every
 * city a Cloudflare data centre is named after. Country names come from Intl. Smaller districts are not covered.
 */
import { AIRPORTS } from "../data/airports.generated";

/** City names that are also ordinary words or first names, so "crm software page" or "running shoes nice" stay. */
const ORDINARY = new Set(["page", "eagle", "horn", "mobile", "nice", "split", "salmon", "ruby", "mesa", "dover", "flint", "george", "david", "mary", "tours", "homer", "beaver", "bishop", "tame", "fare", "coca", "aspen", "cruz", "marion", "regina", "natal", "mora", "galena", "savoy", "pierre", "ogle", "goin", "wick", "tyler", "nelson", "monroe", "quincy", "hayden", "hailey", "sidney", "eugene", "austin", "dallas", "clovis", "lovell", "gary", "pasco", "salina", "rivera", "sharma", "medina", "victoria", "hope", "eagle", "pueblo", "bethel", "moab", "naga", "chipi"]);

/** Country names that are also products or words ("jordan" shoes, a "jersey", "turkey" recipes, "china" plates). */
const ORDINARY_COUNTRY = new Set(["turkey", "jordan", "chad", "georgia", "china", "jersey", "guernsey", "guinea", "panama", "chile", "cuba", "malta", "niger"]);

let cities: Map<string, Set<string>> | null = null;
function cityTable(): Map<string, Set<string>> {
  if (cities) return cities;
  const t = new Map<string, Set<string>>();
  for (const a of AIRPORTS) {
    // [ident, iata, name, city, country, region, lat, lon, elevation, type, scheduledService, …]
    if (a[10] !== 1 || (a[9] !== "L" && a[9] !== "M")) continue;
    const name = String(a[3] ?? "").toLowerCase().split(/[/,(]/)[0].trim();
    if (name.length < 4 || ORDINARY.has(name)) continue;
    const set = t.get(name) ?? new Set<string>();
    set.add(a[4].toUpperCase());
    t.set(name, set);
  }
  return (cities = t);
}

const countryNameCache = new Map<string, Map<string, string>>();
const EXTRA: Record<string, string> = { uk: "GB", "united kingdom": "GB", england: "GB", scotland: "GB", wales: "GB", britain: "GB", "great britain": "GB", usa: "US", america: "US", "united states": "US", holland: "NL", "the netherlands": "NL", russia: "RU", "south korea": "KR", korea: "KR", uae: "AE", dubai: "AE" };
/** Country name (English and the requested language) to ISO code. */
function countryNames(lang: string): Map<string, string> {
  const hit = countryNameCache.get(lang);
  if (hit) return hit;
  const map = new Map<string, string>(Object.entries(EXTRA));
  for (const l of new Set(["en", lang])) {
    let names: Intl.DisplayNames;
    try { names = new Intl.DisplayNames([l], { type: "region" }); } catch { continue; }
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      try { const n = names.of(code); if (n && n !== code && !/^Unknown/i.test(n)) map.set(n.toLowerCase(), code); } catch { /* not a region */ }
    }
  }
  countryNameCache.set(lang, map);
  return map;
}

/** Parts of an address that no keyword needs: arrondissements, cantons, municipalities. */
const ADMIN_PART = /(^|\s)(\d{1,2}(e|er|eme|ème|st|nd|rd|th)?\s*arr\.?|arrondissement|canton( of)?|kommun|municipality|borough of|county of)(\s|$)/;

/** The ISO country codes a phrase names as a city or country, or null when it names none. */
export function placeCountries(phrase: string, lang = "en"): Set<string> | null {
  const p = phrase.trim().toLowerCase().replace(/^(in|near|around|i|nära|en|à|a|in der|bei)\s+/, "");
  if (!p) return null;
  const country = ORDINARY_COUNTRY.has(p) ? undefined : countryNames(lang).get(p);
  if (country) return new Set([country]);
  return cityTable().get(p) ?? null;
}

const same = (a: string, b: string) => a === b || a === `${b}s` || a === `${b}es` || b === `${a}s`;

/**
 * Whether a suggestion only adds a place outside the requested country (or an address part) to the seed, which is the
 * engine echoing where the request came from. A seed that names a place itself is never filtered.
 */
export function addsForeignPlace(seed: string, suggestion: string, country: string, lang = "en"): boolean {
  const s = seed.split(" "), k = suggestion.split(" ");
  if (k.length <= s.length) return false;
  let added: string[] | null = null;
  if (s.every((w, i) => same(k[i], w))) added = k.slice(s.length);
  else if (s.every((w, i) => same(k[k.length - s.length + i], w))) added = k.slice(0, k.length - s.length);
  if (!added) return false;
  const part = added.join(" ");
  if (ADMIN_PART.test(part)) return true;
  const where = placeCountries(part, lang);
  return Boolean(where && !where.has(country.toUpperCase()));
}

/** True when the seed itself names a city or country (then place suggestions are what the caller asked for). */
export function seedNamesPlace(seed: string, lang = "en"): boolean {
  const w = seed.split(" ");
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= Math.min(w.length, i + 3); j++) if (placeCountries(w.slice(i, j).join(" "), lang)) return true;
  return false;
}
