// IP registration lookups and distances (1.55.0). Bazaar search on 24 Oct 2026: "ip lookup" 49 summed payers over the
// top 20 and "ip geolocation" 50, "distance between" 43, no listing of ours. /ip/lookup reads the regional internet
// registries' public RDAP records through rdap.org (the same source /domain uses): who holds the network, its range,
// type and registration country. It is not city-level geolocation, and the copy says so. /geo/distance is local math.
import { entry, need, num, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { CITIES } from "./weather";

const U = ["utility", "data"];

/**
 * One end of /geo/distance: lat<n>/lon<n>, or `from`/`to` as "59.33,18.07" or a major city by name (the weather tool's
 * built-in table). Agents asked for "Stockholm to Paris" in the 26 Oct 2026 probe and got "lat1 is required". The
 * published inputs stay lat/lon; anything else needs geocode first, and the 400 says so.
 */
function point(q: (name: string) => string | undefined, n: 1 | 2, alt: string): [number, number] {
  if (q(`lat${n}`) !== undefined || q(`lon${n}`) !== undefined) return [num(q, `lat${n}`, { min: -90, max: 90 }), num(q, `lon${n}`, { min: -180, max: 180 })];
  const raw = q(alt)?.trim();
  if (!raw) throw new HttpError(400, `lat${n} and lon${n} are required (or ${alt}= as "lat,lon" or a major city name)`);
  const pair = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(raw);
  if (pair) {
    const [lat, lon] = [Number(pair[1]), Number(pair[2])];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, `${alt} must be a latitude from -90 to 90 and a longitude from -180 to 180`);
    return [lat, lon];
  }
  const key = raw.toLowerCase().replace(/\s+/g, " ").replace(/,.*$/, "").trim();
  if (Object.hasOwn(CITIES, key)) return [CITIES[key][1], CITIES[key][2]];
  throw new HttpError(400, `${alt}="${raw.slice(0, 40)}" is not a "lat,lon" pair or a city this tool knows; look its coordinates up with geocode first`);
}

// ---------- IP lookup (RDAP) ----------
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+(%[0-9a-z]+)?$/i;
export function ipKind(ip: string): 4 | 6 | null {
  if (IPV4.test(ip)) return 4;
  if (ip.includes(":") && IPV6.test(ip) && ip.split(":").length <= 8 && (ip.match(/::/g) ?? []).length <= 1) return 6;
  return null;
}
/** Private, loopback, link-local and other non-public ranges have no registry record worth a paid call. */
export function isNonPublic(ip: string, v: 4 | 6) {
  if (v === 6) { const l = ip.toLowerCase(); return l === "::" || l === "::1" || /^f[cd]/.test(l) || /^fe[89ab]/.test(l); }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
}
type Vcard = [string, Record<string, unknown>, string, unknown][];
type RdapEntity = { roles?: string[]; handle?: string; vcardArray?: [string, Vcard]; entities?: RdapEntity[] };
type RdapIp = { handle?: string; name?: string; type?: string; country?: string; startAddress?: string; endAddress?: string; ipVersion?: string; parentHandle?: string; port43?: string; status?: string[]; entities?: RdapEntity[]; events?: { eventAction: string; eventDate: string }[]; remarks?: { description?: string[] }[] };
const vcard = (e: RdapEntity | undefined, key: string) => e?.vcardArray?.[1]?.find((f) => f[0] === key);
/** The registrant (or the first entity with an org name), its name, kind and the country in its postal address. */
export function holderOf(entities: RdapEntity[] = []) {
  const all = entities.flatMap((e) => [e, ...(e.entities ?? [])]);
  const holder = all.find((e) => e.roles?.includes("registrant")) ?? all.find((e) => vcard(e, "fn"));
  if (!holder) return null;
  const adr = vcard(holder, "adr");
  const label = typeof adr?.[1]?.label === "string" ? (adr[1].label as string) : "";
  const parts = Array.isArray(adr?.[3]) ? (adr![3] as unknown[]).map(String) : [];
  // The country is the last address line (ARIN writes it out: "United States"); a vCard country field wins when present.
  const last = (label.trim().split(/\n/).pop() ?? "").trim().toUpperCase();
  const named: Record<string, string> = { "UNITED STATES": "US", "CANADA": "CA", "UNITED KINGDOM": "GB" };
  const country = parts[6] && /^[A-Za-z]{2}$/.test(parts[6]) ? parts[6].toUpperCase() : named[last] ?? (/^[A-Z]{2}$/.test(last) ? last : null);
  return { name: String(vcard(holder, "fn")?.[3] ?? holder.handle ?? "") || null, handle: holder.handle ?? null, kind: String(vcard(holder, "kind")?.[3] ?? "") || null, country };
}
const abuseOf = (entities: RdapEntity[] = []) => {
  const all = entities.flatMap((e) => [e, ...(e.entities ?? [])]);
  const abuse = all.find((e) => e.roles?.includes("abuse"));
  const email = vcard(abuse, "email")?.[3];
  return typeof email === "string" ? email : null;
};
const REGISTRY: Record<string, string> = { "whois.arin.net": "ARIN", "whois.ripe.net": "RIPE NCC", "whois.apnic.net": "APNIC", "whois.lacnic.net": "LACNIC", "whois.afrinic.net": "AFRINIC" };

// ---------- distance ----------
const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;
/** Great-circle distance (haversine on the mean earth radius), initial bearing and midpoint. */
export function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p1 = rad(lat1), p2 = rad(lat2), dp = rad(lat2 - lat1), dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const km = 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  const bearing = (deg(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))) + 360) % 360;
  const bx = Math.cos(p2) * Math.cos(dl), by = Math.cos(p2) * Math.sin(dl);
  const midLat = deg(Math.atan2(Math.sin(p1) + Math.sin(p2), Math.sqrt((Math.cos(p1) + bx) ** 2 + by ** 2)));
  const midLon = ((deg(rad(lon1) + Math.atan2(by, Math.cos(p1) + bx)) + 540) % 360) - 180;
  return { km, bearing, midLat, midLon };
}
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export const GEO_IP: Entry[] = [
  entry("/ip/lookup", "IP lookup: owner, network range and country (RDAP)",
    "Look up who holds an IPv4 or IPv6 address in the regional internet registries' public RDAP records (ARIN, RIPE NCC, APNIC, LACNIC, AFRINIC): the holding organisation, network name and range, allocation type, registration country, abuse contact and registry. Use to see which company or ISP a log or firewall address belongs to. Registration country, not city geolocation. Private and reserved addresses are refused with 400, uncharged.",
    ["ip-lookup", "ip", "rdap", "whois", "network", ...U], { ip: { type: "string", description: "Public IPv4 or IPv6 address", required: true, example: "8.8.8.8" } },
    { ip: "8.8.8.8", version: 4, registry: "ARIN", network: { name: "GOGL", handle: "NET-8-8-8-0-2", start: "8.8.8.0", end: "8.8.8.255", type: "DIRECT ALLOCATION" }, holder: { name: "Google LLC", handle: "GOGL", kind: "org", country: "US" }, country: "US", abuseEmail: "network-abuse@google.com", registered: "2023-12-28T17:24:33-05:00", lastChanged: "2023-12-28T17:24:56-05:00", source: "RDAP via rdap.org" },
    async (_e, q) => {
      const ip = need(q, "ip", 64).trim().replace(/^\[|\]$/g, "");
      const v = ipKind(ip);
      if (!v) throw new HttpError(400, "ip must be an IPv4 or IPv6 address");
      if (isNonPublic(ip, v)) throw new HttpError(400, "this is a private or reserved address; registries hold no record for it (ip_info classifies it for free of network calls)");
      // The address is validated above (hex digits, dots, colons), so it goes into the path as is: rdap.org refuses
      // percent-encoded colons in IPv6 addresses (400). One retry covers its occasional 5xx (a 525 seen from Workers).
      let res: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch(`https://rdap.org/ip/${ip}`, { headers: { accept: "application/rdap+json", "user-agent": "AgentDataTools/1.0" }, signal: AbortSignal.timeout(6_000) });
        } catch { if (attempt === 1) throw new HttpError(502, "the registry did not answer in time; try again"); continue; }
        if (res.status < 500) break;
      }
      if (!res) throw new HttpError(502, "the registry did not answer in time; try again");
      if (res.status === 404) throw new HttpError(404, "no registry record for this address");
      if (!res.ok) throw new HttpError(502, `the registry answered HTTP ${res.status}; try again`);
      const d = (await res.json()) as RdapIp;
      const holder = holderOf(d.entities);
      const event = (a: string) => d.events?.find((e) => e.eventAction === a)?.eventDate ?? null;
      return {
        ip, version: v, registry: (d.port43 && REGISTRY[d.port43.toLowerCase()]) ?? d.port43 ?? null,
        network: { name: d.name ?? null, handle: d.handle ?? null, start: d.startAddress ?? null, end: d.endAddress ?? null, type: d.type ?? null },
        holder, country: (d.country?.toUpperCase() || holder?.country) ?? null, abuseEmail: abuseOf(d.entities),
        registered: event("registration"), lastChanged: event("last changed"), source: "RDAP via rdap.org",
      };
    }),

  entry("/geo/distance", "Distance between coordinates: km, miles, bearing and midpoint",
    "Great-circle distance between two latitude/longitude points (haversine on the mean earth radius) in kilometres, miles and nautical miles, plus the initial compass bearing and the midpoint. Accurate to about 0.5% against the ellipsoid. Use for delivery radius, travel and proximity checks, or sorting places by distance; for coordinates of a place name use geocode first.",
    ["distance-between", "distance", "haversine", "geo", "coordinates", ...U], {
      lat1: { type: "number", description: "Latitude of the first point (-90 to 90)", required: true, example: 59.3293 },
      lon1: { type: "number", description: "Longitude of the first point (-180 to 180)", required: true, example: 18.0686 },
      lat2: { type: "number", description: "Latitude of the second point", required: true, example: 51.5072 },
      lon2: { type: "number", description: "Longitude of the second point", required: true, example: -0.1276 },
    },
    { km: 1432.79, miles: 890.29, nauticalMiles: 773.64, bearing: 240.6, compass: "WSW", midpoint: { lat: 55.7531, lon: 8.0606 } },
    (_e, q) => {
      const [lat1, lon1] = point(q, 1, "from"), [lat2, lon2] = point(q, 2, "to");
      const g = greatCircle(lat1, lon1, lat2, lon2);
      return { km: r(g.km, 2), miles: r(g.km / 1.609344, 2), nauticalMiles: r(g.km / 1.852, 2), bearing: r(g.bearing, 1), compass: COMPASS[Math.round(g.bearing / 22.5) % 16], midpoint: { lat: r(g.midLat, 4), lon: r(g.midLon, 4) } };
    }),
];
