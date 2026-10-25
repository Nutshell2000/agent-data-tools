import { HttpError } from "../lib/env";

const MAX_ZONES = 10;

/** Cities agents name instead of a zone (24 Oct 2026: "Tokyo" was refused). Lower case, spaces kept. */
const CITY_ZONES: Record<string, string> = {
  london: "Europe/London", paris: "Europe/Paris", berlin: "Europe/Berlin", madrid: "Europe/Madrid", rome: "Europe/Rome", amsterdam: "Europe/Amsterdam",
  brussels: "Europe/Brussels", zurich: "Europe/Zurich", vienna: "Europe/Vienna", prague: "Europe/Prague", warsaw: "Europe/Warsaw", stockholm: "Europe/Stockholm",
  oslo: "Europe/Oslo", copenhagen: "Europe/Copenhagen", helsinki: "Europe/Helsinki", dublin: "Europe/Dublin", lisbon: "Europe/Lisbon", athens: "Europe/Athens",
  istanbul: "Europe/Istanbul", moscow: "Europe/Moscow", kyiv: "Europe/Kyiv", kiev: "Europe/Kyiv", cairo: "Africa/Cairo", lagos: "Africa/Lagos", nairobi: "Africa/Nairobi",
  johannesburg: "Africa/Johannesburg", dubai: "Asia/Dubai", riyadh: "Asia/Riyadh", tehran: "Asia/Tehran", "tel aviv": "Asia/Jerusalem", jerusalem: "Asia/Jerusalem",
  karachi: "Asia/Karachi", mumbai: "Asia/Kolkata", delhi: "Asia/Kolkata", "new delhi": "Asia/Kolkata", bangalore: "Asia/Kolkata", bengaluru: "Asia/Kolkata",
  kolkata: "Asia/Kolkata", dhaka: "Asia/Dhaka", bangkok: "Asia/Bangkok", jakarta: "Asia/Jakarta", singapore: "Asia/Singapore", "kuala lumpur": "Asia/Kuala_Lumpur",
  manila: "Asia/Manila", "hong kong": "Asia/Hong_Kong", shanghai: "Asia/Shanghai", beijing: "Asia/Shanghai", shenzhen: "Asia/Shanghai", taipei: "Asia/Taipei",
  seoul: "Asia/Seoul", tokyo: "Asia/Tokyo", osaka: "Asia/Tokyo", sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", brisbane: "Australia/Brisbane",
  perth: "Australia/Perth", auckland: "Pacific/Auckland", honolulu: "Pacific/Honolulu", anchorage: "America/Anchorage", vancouver: "America/Vancouver",
  seattle: "America/Los_Angeles", "san francisco": "America/Los_Angeles", "los angeles": "America/Los_Angeles", "san diego": "America/Los_Angeles",
  "las vegas": "America/Los_Angeles", phoenix: "America/Phoenix", denver: "America/Denver", "salt lake city": "America/Denver", chicago: "America/Chicago",
  dallas: "America/Chicago", houston: "America/Chicago", austin: "America/Chicago", minneapolis: "America/Chicago", "new york": "America/New_York",
  nyc: "America/New_York", boston: "America/New_York", washington: "America/New_York", "washington dc": "America/New_York", miami: "America/New_York",
  atlanta: "America/New_York", toronto: "America/Toronto", montreal: "America/Toronto", "mexico city": "America/Mexico_City", bogota: "America/Bogota",
  lima: "America/Lima", santiago: "America/Santiago", "buenos aires": "America/Argentina/Buenos_Aires", "sao paulo": "America/Sao_Paulo", "são paulo": "America/Sao_Paulo",
  "rio de janeiro": "America/Sao_Paulo",
};

/**
 * What agents send as a zone: IANA names with spaces ("America/New York"), city names ("Tokyo"), fixed offsets ("UTC+2",
 * "GMT-5:30", "+02:00") and "Z". Anything else is passed to Intl as written (it takes IANA names in any case, EST, CET…).
 */
export function normalizeZone(raw: string): string {
  const z = raw.trim();
  if (!z || /^(z|utc|gmt|zulu)$/i.test(z)) return "UTC";
  const offset = /^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(z);
  if (offset) {
    const sign = offset[1] === "-" ? -1 : 1, h = Number(offset[2]), m = Number(offset[3] ?? 0);
    if (h > 14 || m > 59) throw new HttpError(400, `unknown time zone "${z}"; offsets run from -14:00 to +14:00`);
    // Etc/GMT zones carry the opposite sign (Etc/GMT-2 is UTC+2); minutes need an offset zone, which recent engines accept.
    return m === 0 ? `Etc/GMT${sign > 0 ? "-" : "+"}${h}` : `${sign > 0 ? "+" : "-"}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const city = CITY_ZONES[z.toLowerCase()];
  if (city) return city;
  return z.replace(/\s+/g, "_");
}

/** The wall-clock time of one instant in one IANA time zone. */
function inZone(instant: Date, zone: string) {
  let parts: Intl.DateTimeFormatPart[];
  let canonical = zone;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "long",
      timeZoneName: "longOffset",
    });
    parts = fmt.formatToParts(instant);
    // The IANA spelling ("europe/stockholm" becomes Europe/Stockholm), so callers see the zone they can reuse.
    canonical = fmt.resolvedOptions().timeZone;
  } catch {
    throw new HttpError(400, `unknown time zone "${zone}"; use an IANA name such as Europe/Stockholm or America/New_York`);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // "GMT" for UTC itself, otherwise "GMT+02:00".
  const utcOffset = get("timeZoneName").replace("GMT", "") || "+00:00";
  const local = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  // en-US names American zones (EDT) and en-GB European ones (CEST, BST); each gives a bare GMT offset
  // for the other's, so take the first that is a real abbreviation.
  const short = (locale: string) => new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "short" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")?.value;
  const us = short("en-US");
  const abbreviation = us && /^GMT[+-]/.test(us) ? (short("en-GB") ?? us) : us;
  // Etc/GMT-2 names a fixed offset the way agents never spell it: report the offset form instead.
  const shown = /^Etc\/GMT[+-]\d+$/.test(canonical) || /^[+-]\d{2}:\d{2}$/.test(canonical) ? `UTC${utcOffset}` : canonical;
  return { zone: shown, localTime: local, isoWithOffset: local + utcOffset, utcOffset, weekday: get("weekday"), abbreviation: abbreviation ?? null };
}

/** Current time in a time zone, or one instant converted between time zones. */
export function timeInZone(zoneInput?: string, atInput?: string, toInput?: string) {
  const zone = normalizeZone(zoneInput ?? "");
  // Unix seconds (10 digits) and milliseconds (13) are read as such; everything else as an ISO 8601 date-time.
  const at = atInput?.trim() ?? "";
  const instant = !at ? new Date() : /^\d{10}$/.test(at) ? new Date(Number(at) * 1000) : /^\d{13}$/.test(at) ? new Date(Number(at)) : new Date(at);
  if (Number.isNaN(instant.getTime())) {
    throw new HttpError(400, "at must be an ISO 8601 date-time with an offset, e.g. 2026-03-01T09:00:00+01:00, or a Unix timestamp");
  }
  const others = (toInput ?? "")
    .split(",")
    .map((z) => z.trim())
    .filter(Boolean)
    .map(normalizeZone);
  if (others.length > MAX_ZONES) throw new HttpError(400, `to accepts at most ${MAX_ZONES} time zones`);
  return {
    utc: instant.toISOString(),
    unixSeconds: Math.floor(instant.getTime() / 1000),
    ...inZone(instant, zone),
    converted: others.map((z) => inZone(instant, z)),
  };
}
