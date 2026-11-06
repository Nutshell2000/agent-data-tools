/**
 * Airport lookup (6 Nov 2026). Bazaar search that day: "airport lookup" 15 results with 40 payers summed and "airport search"
 * 13 with 31, spread over vextorium, SiteCheck, Tanod, munition and others; we only had US delay status. Data: OurAirports
 * (public domain), every large and medium airport plus small ones with an IATA code (~9,500), committed as a snapshot by
 * scripts/fetch-airports.mjs (rerun monthly). No network at call time.
 */
import { entry, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { countryCode, countryName } from "../lib/country-code";
import { AIRPORTS, AIRPORTS_DATE } from "../data/airports.generated";

type Row = (typeof AIRPORTS)[number];
const TYPES: Record<string, string> = { L: "large", M: "medium", S: "small" };
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function airportView(r: Row) {
  const [ident, iata, name, city, country, region, lat, lon, elevationFt, type, scheduled, wikipedia, homepage] = r;
  return {
    iata: iata || null, icao: /^[A-Z]{4}$/.test(ident) ? ident : null, ident, name, city: city || null,
    country, countryName: countryName(country) ?? country, region, lat, lon, elevationFt, type: TYPES[type] ?? type,
    scheduledService: scheduled === 1, wikipedia: wikipedia || null, homepage: homepage || null,
  };
}

const R = 6371;
export const km = (a: [number, number], b: [number, number]) => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Search by code, name or city; large and scheduled airports first. */
export function searchAirports(q: string, country?: string): Row[] {
  const s = q.trim();
  const up = s.toUpperCase();
  if (/^[A-Z0-9]{3}$/.test(up)) { const hit = AIRPORTS.filter((r) => r[1] === up); if (hit.length) return hit; }
  if (/^[A-Z0-9]{4}$/.test(up)) { const hit = AIRPORTS.filter((r) => r[0] === up); if (hit.length) return hit; }
  const want = fold(s);
  if (!want) return [];
  const words = want.split(" ");
  const score = (r: Row) => {
    const name = fold(r[2]), city = fold(r[3]);
    // "Paris (Roissy-en-France, Val-d'Oise)" is Paris too: CDG must rank with the airports whose city is exactly Paris.
    if (city === want || city.startsWith(`${want} `)) return 4;
    if (name === want) return 4;
    if (words.every((w) => city.includes(w))) return 3;
    if (words.every((w) => `${name} ${city}`.includes(w))) return 2;
    return 0;
  };
  return AIRPORTS.filter((r) => (!country || r[4] === country)).map((r) => [r, score(r)] as const).filter(([, s2]) => s2 > 0)
    // Same match strength: larger airports first, then scheduled passenger service (CDG before Le Bourget), then the exact city
    // ("Stockholm" before "Stockholm / Västerås").
    .sort((a, b) => b[1] - a[1] || "LMS".indexOf(a[0][9]) - "LMS".indexOf(b[0][9]) || b[0][10] - a[0][10] || Number(fold(b[0][3]) === want) - Number(fold(a[0][3]) === want)).map(([r]) => r);
}

export const AIRPORT_TOOLS: Entry[] = [
  entry("/airport/lookup", "Airport lookup, IATA and ICAO codes",
    "Look up airports by IATA or ICAO code, name or city (Paris, JFK, EGLL, Heathrow): codes, full name, city, country, region, coordinates, elevation, size, scheduled service and Wikipedia link, for ~9,500 airports worldwide; or give lat and lon for the nearest airports with distances. Data: OurAirports (public domain), committed snapshot, answers in milliseconds. Use for travel tools, flight data enrichment and geocoding airport codes.",
    ["airport-lookup", "airport-search", "iata-code", "icao-code", "airports", "travel"], {
      q: { type: "string", description: "IATA code, ICAO code, airport name or city", example: "Stockholm" },
      country: { type: "string", description: "Only airports in this country (code or name)", example: "SE" },
      lat: { type: "number", description: "Latitude, for the nearest airports (with lon)", example: 59.33 },
      lon: { type: "number", description: "Longitude, for the nearest airports (with lat)", example: 18.07 },
      scheduled: { type: "string", description: "true: only airports with scheduled passenger service", example: "true" },
      limit: { type: "integer", description: "Number of airports (1-25, default 5)", example: 5 },
    },
    {
      count: 1, airports: [{ iata: "ARN", icao: "ESSA", ident: "ESSA", name: "Stockholm-Arlanda Airport", city: "Stockholm", country: "SE", countryName: "Sweden", region: "SE-AB", lat: 59.6485, lon: 17.9288, elevationFt: 137, type: "large", scheduledService: true, wikipedia: "https://en.wikipedia.org/wiki/Stockholm-Arlanda_Airport", homepage: "http://www.swedavia.se/arlanda/" }],
      source: "OurAirports (public domain)", dataDate: "2026-11-06",
    },
    (_env, q) => {
      const limit = num(q, "limit", { min: 1, max: 25, fallback: 5, integer: true });
      const cIn = opt(q, "country", 60);
      const country = cIn ? countryCode(cIn) ?? cIn.toUpperCase() : undefined;
      const scheduledOnly = /^(true|1|yes)$/i.test(q("scheduled") ?? "");
      const latIn = q("lat"), lonIn = q("lon");
      if (latIn !== undefined && latIn !== "" && lonIn !== undefined && lonIn !== "") {
        const at: [number, number] = [num(q, "lat", { min: -90, max: 90 }), num(q, "lon", { min: -180, max: 180 })];
        const near = AIRPORTS.filter((r) => (!country || r[4] === country) && (!scheduledOnly || r[10] === 1)).map((r) => ({ r, d: km(at, [r[6], r[7]]) })).sort((a, b) => a.d - b.d).slice(0, limit);
        return { count: near.length, near: { lat: at[0], lon: at[1] }, airports: near.map(({ r, d }) => ({ ...airportView(r), distanceKm: Math.round(d * 10) / 10 })), source: "OurAirports (public domain)", dataDate: AIRPORTS_DATE };
      }
      const text = opt(q, "q", 100);
      if (!text) throw new HttpError(400, "give q (a code, name or city) or lat and lon");
      const hits = searchAirports(text, country).filter((r) => !scheduledOnly || r[10] === 1).slice(0, limit);
      if (!hits.length) throw new HttpError(404, `no airport matches ${text.slice(0, 60)}; nothing was charged`);
      return { count: hits.length, airports: hits.map(airportView), source: "OurAirports (public domain)", dataDate: AIRPORTS_DATE };
    }),
];
