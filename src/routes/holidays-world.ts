/**
 * Public holidays for every country Nager.Date covers (6 Nov 2026), behind our own rules. /holidays and the business-day tool
 * had rules for 8 countries and answered 404 or "weekends only" elsewhere, while open shoppers paid for Japan, New Zealand
 * and other calendars (japan-market-calendar, nzdata working-days and kaisha business-days: 4-5 of the 47 open shoppers each
 * in the 5 Nov sample). Nager.Date (date.nager.at, open source, MIT) is keyless; answers are kept per country and year for
 * 12 hours as plain data.
 */
import { HttpError } from "../lib/env";
import { COUNTRIES, holidaysFor } from "./holidays";

export interface Holiday { date: string; localName: string; name: string; nationwide: boolean; types: string[]; observed: string | null }
const cache = new Map<string, { at: number; list: Holiday[] | null }>();
const TTL = 12 * 3_600_000;

/** Nager.Date's list for one country and year; null when it has no calendar for the country. */
export async function nagerHolidays(country: string, year: number): Promise<Holiday[] | null> {
  const key = `${country}:${year}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.list;
  let res: Response;
  try {
    res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, { headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0" }, signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new HttpError(502, "the holiday calendar source did not answer in time; try again");
  }
  // Nager.Date answers 204 (no body) or 404 for countries it does not cover.
  type Row = { date: string; localName: string; name: string; global: boolean; types?: string[] };
  let rows: Row[] | null = null;
  if (res.status !== 204 && res.status !== 404) {
    if (!res.ok) throw new HttpError(502, `the holiday calendar source answered HTTP ${res.status}; try again`);
    rows = (await res.json().catch(() => null)) as Row[] | null;
  } else await res.body?.cancel().catch(() => {});
  const list = Array.isArray(rows) ? (rows as Row[]).map((r: Row) => ({ date: r.date, localName: r.localName, name: r.name, nationwide: !!r.global, types: r.types ?? ["Public"], observed: null })) : null;
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), list });
  return list;
}

/** Holidays for a country and year: our statutory rules where we have them, Nager.Date otherwise. */
export async function holidaysAnywhere(country: string, year: number): Promise<{ holidays: Holiday[]; source: "rules" | "nager"; note: string } | null> {
  if (Object.hasOwn(COUNTRIES, country)) {
    const out = holidaysFor(country, year);
    if (out) return { holidays: out.holidays as Holiday[], source: "rules", note: out.note };
  }
  const list = await nagerHolidays(country, year).catch(() => null);
  if (!list) return null;
  return { holidays: list, source: "nager", note: "From Nager.Date (date.nager.at). Holidays with nationwide false apply only in some regions." };
}

/** A date -> name map of the nationwide holidays of `years`, for business-day maths; null when no calendar covers the country. */
export async function holidayMap(country: string, years: number[]): Promise<Map<string, string> | null> {
  const map = new Map<string, string>();
  let any = false;
  for (const y of [...new Set(years)].slice(0, 12)) {
    const out = await holidaysAnywhere(country, y);
    if (!out) continue;
    any = true;
    for (const h of out.holidays) if (h.nationwide) map.set(h.date, h.name);
  }
  return any ? map : null;
}
