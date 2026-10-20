import { HttpError } from "../lib/env";

const MAX_ZONES = 10;

/** The wall-clock time of one instant in one IANA time zone. */
function inZone(instant: Date, zone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
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
    }).formatToParts(instant);
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
  return { zone, localTime: local, isoWithOffset: local + utcOffset, utcOffset, weekday: get("weekday"), abbreviation: abbreviation ?? null };
}

/** Current time in a time zone, or one instant converted between time zones. */
export function timeInZone(zoneInput?: string, atInput?: string, toInput?: string) {
  const zone = (zoneInput ?? "").trim();
  if (!zone) throw new HttpError(400, "zone is required: an IANA time zone name such as Europe/Stockholm");
  const instant = atInput?.trim() ? new Date(atInput.trim()) : new Date();
  if (Number.isNaN(instant.getTime())) {
    throw new HttpError(400, "at must be an ISO 8601 date-time with an offset, e.g. 2026-03-01T09:00:00+01:00");
  }
  const others = (toInput ?? "")
    .split(",")
    .map((z) => z.trim())
    .filter(Boolean);
  if (others.length > MAX_ZONES) throw new HttpError(400, `to accepts at most ${MAX_ZONES} time zones`);
  return {
    utc: instant.toISOString(),
    unixSeconds: Math.floor(instant.getTime() / 1000),
    ...inZone(instant, zone),
    converted: others.map((z) => inZone(instant, z)),
  };
}
