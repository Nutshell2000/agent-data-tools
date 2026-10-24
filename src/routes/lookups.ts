// Converters and validators with Bazaar demand where we had no listing (CDP search, 24 Oct 2026, 20 results each):
// yaml to json (44 summed payers), phone number validation (56), vin decoder (52), robots.txt (54).
// YAML and phone numbers are local (yaml 2.9.1 ISC, libphonenumber-js 1.13.15 MIT); VINs use NHTSA's vPIC API (US
// federal data, no restrictions on reuse); robots.txt is fetched from the site itself through the public-URL fetcher.
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { entry, need, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { fetchPublic } from "../lib/fetch";

const U = ["utility", "data"];

// ---------- YAML ----------
// Loaded on first use: yaml's Node build requires "process", which breaks the scripts that bundle the whole catalog for
// Node as ESM (bump-version, registry manifests); a lazy import keeps it out of their module initialisation.
const yamlLib = () => import("yaml");
export async function yamlToJson(text: string) {
  const { parse: parseYaml } = await yamlLib();
  try {
    // Alias expansion is capped (the library's default of 100) so a "billion laughs" document cannot blow up memory.
    return parseYaml(text, { maxAliasCount: 100, prettyErrors: true, uniqueKeys: true }) as unknown;
  } catch (e) {
    throw new HttpError(400, `not valid YAML: ${String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200)}`);
  }
}
export async function jsonToYaml(text: string) {
  const { stringify: stringifyYaml } = await yamlLib();
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new HttpError(400, "json is not valid JSON"); }
  return stringifyYaml(value, { lineWidth: 0 });
}

// ---------- phone numbers ----------
export function phoneInfo(raw: string, country?: string) {
  const cc = country?.trim().toUpperCase();
  if (cc && !/^[A-Z]{2}$/.test(cc)) throw new HttpError(400, "country must be a two-letter code such as US, GB or SE");
  const p = parsePhoneNumberFromString(raw, cc as CountryCode | undefined);
  if (!p) return { input: raw, valid: false, possible: false, reason: cc ? "not a phone number" : "not a phone number; give it in +<country code> form or pass country" };
  const type = p.getType() ?? null;
  return {
    input: raw, valid: p.isValid(), possible: p.isPossible(), e164: p.number, country: p.country ?? null, countryCallingCode: `+${p.countryCallingCode}`,
    nationalNumber: p.nationalNumber, international: p.formatInternational(), national: p.formatNational(), uri: p.getURI(),
    type: type ? type.toLowerCase().replace(/_/g, "-") : null,
  };
}

// ---------- VINs ----------
const VIN_VALUES: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
/** The North American check digit (position 9); other markets do not require it, so a mismatch is reported, not refused. */
export function vinCheckDigit(vin: string) {
  const sum = [...vin].reduce((s, ch, i) => s + (/\d/.test(ch) ? Number(ch) : VIN_VALUES[ch] ?? 0) * VIN_WEIGHTS[i], 0);
  const r = sum % 11;
  return r === 10 ? "X" : String(r);
}
const VIN_FIELDS: [string, string][] = [
  ["Make", "make"], ["Manufacturer", "manufacturer"], ["Model", "model"], ["ModelYear", "modelYear"], ["Trim", "trim"], ["Series", "series"],
  ["BodyClass", "bodyClass"], ["VehicleType", "vehicleType"], ["Doors", "doors"], ["DriveType", "driveType"], ["FuelTypePrimary", "fuelType"],
  ["ElectrificationLevel", "electrification"], ["EngineCylinders", "engineCylinders"], ["DisplacementL", "displacementL"], ["EngineHP", "engineHp"],
  ["EngineModel", "engineModel"], ["TransmissionStyle", "transmission"], ["TransmissionSpeeds", "transmissionSpeeds"], ["GVWR", "gvwr"],
  ["PlantCity", "plantCity"], ["PlantState", "plantState"], ["PlantCountry", "plantCountry"],
];

// ---------- robots.txt ----------
interface Group { agents: string[]; rules: { allow: boolean; path: string }[] }
/** Groups of a robots.txt (RFC 9309): consecutive user-agent lines open a group; allow/disallow lines belong to it. */
export function parseRobots(text: string) {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null, lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/).slice(0, 5_000)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") { if (value) sitemaps.push(value); continue; }
    if ((key === "allow" || key === "disallow") && current) {
      if (key === "disallow" && value === "") continue; // "Disallow:" with no path allows everything
      current.rules.push({ allow: key === "allow", path: value });
    }
  }
  return { groups, sitemaps };
}
const ruleRegex = (path: string) => new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
/** Google's matching: the group naming the agent (longest product-token match) or "*"; the longest matching rule wins, allow on ties. */
export function robotsVerdict(text: string, agent: string, path: string) {
  const { groups, sitemaps } = parseRobots(text);
  const ua = agent.toLowerCase();
  const named = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const longest = named.length ? Math.max(...named.flatMap((g) => g.agents.filter((a) => a !== "*" && ua.includes(a)).map((a) => a.length))) : 0;
  const chosen = named.length ? named.filter((g) => g.agents.some((a) => a.length === longest && ua.includes(a))) : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  let decisive: { allow: boolean; path: string } | null = null;
  for (const r of rules) {
    if (!ruleRegex(r.path).test(path)) continue;
    const len = r.path.replace(/\*/g, "").length;
    const best = decisive ? decisive.path.replace(/\*/g, "").length : -1;
    if (len > best || (len === best && r.allow && !decisive!.allow)) decisive = r;
  }
  return { allowed: decisive ? decisive.allow : true, matchedRule: decisive ? `${decisive.allow ? "Allow" : "Disallow"}: ${decisive.path}` : null,
    group: chosen.length ? (named.length ? chosen[0].agents.find((a) => a.length === longest) ?? null : "*") : null, rulesInGroup: rules.length, sitemaps: sitemaps.slice(0, 50) };
}

export const LOOKUPS: Entry[] = [
  entry("/yaml/to-json", "YAML to JSON: convert a YAML document into JSON",
    "Convert a YAML document (config files, Kubernetes manifests, OpenAPI specs, front matter) into JSON, parsed by the yaml library with anchors and aliases resolved (alias expansion capped against billion-laughs documents) and duplicate keys refused. Up to 100 KB. Use before feeding YAML into a JSON-only tool or schema check; for the reverse use json_to_yaml. Invalid YAML is a 400 with the parser's message, uncharged.",
    ["yaml-to-json", "yaml", "json", "convert", ...U], { yaml: { type: "string", description: "The YAML text (up to 100 KB)", required: true, example: "name: agent\nports:\n  - 80\n  - 443\nenabled: true" } },
    { json: { name: "agent", ports: [80, 443], enabled: true } },
    async (_e, q) => ({ json: await yamlToJson(need(q, "yaml", 100_000)) })),

  entry("/json/to-yaml", "JSON to YAML: convert JSON into a readable YAML document",
    "Convert a JSON value into a YAML document (block style, no line folding), for config files, Kubernetes manifests, GitHub Actions or docs that humans edit. Up to 100 KB of JSON. Use when a tool or person wants YAML; for the reverse use yaml_to_json. Invalid JSON is a 400, uncharged.",
    ["json-to-yaml", "yaml", "json", "convert", ...U], { json: { type: "string", description: "The JSON text (up to 100 KB)", required: true, example: '{"name":"agent","ports":[80,443],"enabled":true}' } },
    { yaml: "name: agent\nports:\n  - 80\n  - 443\nenabled: true\n" },
    async (_e, q) => ({ yaml: await jsonToYaml(need(q, "json", 100_000)) })),

  entry("/phone/validate", "Phone number validation: valid, E.164 format, country and line type",
    "Validate and format a phone number with the libphonenumber rules: whether it is valid and possible, the E.164 form, international and national formatting, country, calling code and line type (mobile, fixed-line, toll-free, VoIP…). Give +country code, or a national number and a two-letter country. Offline: nothing is sent and it does not say the line is in service. Use to clean contact lists or check a number before an SMS.",
    ["phone-number-validation", "phone", "validation", "e164", ...U], {
      number: { type: "string", description: "Phone number, ideally with +country code", required: true, example: "+1 650-253-0000" },
      country: { type: "string", description: "Two-letter country for national numbers without +code (US, GB, SE…)", example: "US" },
    },
    { input: "+1 650-253-0000", valid: true, possible: true, e164: "+16502530000", country: "US", countryCallingCode: "+1", nationalNumber: "6502530000", international: "+1 650 253 0000", national: "(650) 253-0000", uri: "tel:+16502530000", type: "fixed-line-or-mobile" },
    (_e, q) => phoneInfo(need(q, "number", 40), opt(q, "country", 2))),

  entry("/vin", "VIN decoder: make, model, year, engine and plant from a VIN",
    "Decode a 17-character vehicle identification number (VIN) with the US NHTSA vPIC database: make, manufacturer, model, model year, trim, body class, vehicle type, doors, drive, fuel and electrification, engine cylinders, displacement and horsepower, transmission, weight class and assembly plant, plus the check-digit test. Best for North American vehicles. Use for listings, insurance and fleet records. A malformed VIN is a 400, uncharged.",
    ["vin-decoder", "vin", "vehicle", "car", "nhtsa", ...U], {
      vin: { type: "string", description: "17-character VIN (letters I, O and Q never appear)", required: true, example: "1HGCM82633A004352" },
      year: { type: "integer", description: "Optional model year, which helps decode older or partial VINs", example: 2003 },
    },
    { vin: "1HGCM82633A004352", checkDigitValid: true, make: "HONDA", manufacturer: "AMERICAN HONDA MOTOR CO., INC.", model: "Accord", modelYear: "2003", trim: "EX-V6", bodyClass: "Coupe", vehicleType: "PASSENGER CAR", engineCylinders: "6", displacementL: "2.998832712", engineHp: "240", transmission: "Automatic", plantCountry: "UNITED STATES (USA)", decoderNote: "0 - VIN decoded clean. Check Digit (9th position) is correct", source: "NHTSA vPIC" },
    async (_e, q) => {
      const vin = need(q, "vin", 17).toUpperCase().replace(/[\s-]/g, "");
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new HttpError(400, "vin must be 17 letters and digits, without I, O or Q");
      const year = q("year")?.trim() ? num(q, "year", { min: 1950, max: 2100, integer: true }) : undefined;
      let res: Response;
      try {
        res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json${year ? `&modelyear=${year}` : ""}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      } catch { throw new HttpError(502, "NHTSA's VIN service did not answer in time; try again"); }
      if (!res.ok) throw new HttpError(502, `NHTSA's VIN service answered HTTP ${res.status}; try again`);
      const row = ((await res.json()) as { Results?: Record<string, string>[] }).Results?.[0] ?? {};
      const out: Record<string, unknown> = { vin, checkDigitValid: vinCheckDigit(vin) === vin[8] };
      for (const [from, to] of VIN_FIELDS) { const v = row[from]?.trim(); if (v && v !== "Not Applicable") out[to] = v; }
      if (!out.make) throw new HttpError(404, `NHTSA has no decode for this VIN${row.ErrorText ? ` (${row.ErrorText.slice(0, 160)})` : ""}`);
      return { ...out, decoderNote: row.ErrorText?.slice(0, 300) ?? null, source: "NHTSA vPIC" };
    }),

  entry("/robots", "Robots.txt check: may this crawler fetch this URL?",
    "Read a site's robots.txt and say whether a crawler may fetch a URL, by RFC 9309 rules as Google applies them (most specific user-agent group, longest matching Allow or Disallow, Allow on ties, * and $ wildcards). Returns the deciding rule, the group used, the rule count and the sitemaps listed. A missing robots.txt (4xx) allows everything. Use before scraping or crawling a site politely; for the sitemap URLs themselves use sitemap.",
    ["robots-txt", "robots", "crawler", "seo", "web", ...U], {
      url: { type: "string", description: "The page URL to check (its site's /robots.txt is read)", required: true, example: "https://www.google.com/search" },
      agent: { type: "string", description: "Crawler user agent or product token (default *)", example: "Googlebot" },
    },
    { url: "https://www.google.com/search", robotsUrl: "https://www.google.com/robots.txt", status: 200, agent: "Googlebot", allowed: false, matchedRule: "Disallow: /search", group: "*", rulesInGroup: 280, sitemaps: ["https://www.google.com/sitemap.xml"] },
    async (_e, q) => {
      let page: URL;
      try { page = new URL(need(q, "url", 2_000)); } catch { throw new HttpError(400, "url must be an absolute http(s) URL"); }
      if (!/^https?:$/.test(page.protocol)) throw new HttpError(400, "url must be an absolute http(s) URL");
      const agent = opt(q, "agent", 200) ?? "*";
      const robotsUrl = new URL("/robots.txt", page.origin);
      const fourXX = Array.from({ length: 100 }, (_, i) => 400 + i);
      const res = await fetchPublic(robotsUrl, "text/plain,*/*;q=0.5", fourXX, { cacheSeconds: 600 });
      const path = `${page.pathname}${page.search}`;
      if (res.status >= 400) return { url: page.href, robotsUrl: robotsUrl.href, status: res.status, agent, allowed: true, matchedRule: null, group: null, rulesInGroup: 0, sitemaps: [], note: "no robots.txt (4xx): everything is allowed" };
      const text = (await res.text()).slice(0, 500_000);
      return { url: page.href, robotsUrl: robotsUrl.href, status: res.status, agent, ...robotsVerdict(text, agent === "*" ? "*" : agent, path) };
    }),
];
