// Public data from free, keyless sources, plus sun and moon times computed locally.
// Outside failures are 502 (not charged); "not found" answers are 404 (not charged).
import { entry, getJson, need, num, opt, pick, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { cryptoPrices } from "../lib/coin-prices";
import { countryCode, countryName } from "../lib/country-code";
import { parseDate } from "../lib/relative-date";
import { holidaysFor } from "./holidays";
import { nagerHolidays } from "./holidays-world";
import { CITIES } from "./weather";
import { type Entity, firstQuantity, getEntities, itemIds, labelsOf, searchItems, statements } from "../lib/wikidata";

/** Wikidata classes of inhabited places (city, big city, million city, metropolis, capital, town, village, human settlement, municipality seat, megacity). */
const SETTLEMENT_TYPES: ReadonlySet<string> = new Set(["Q515", "Q1549591", "Q1637706", "Q200250", "Q5119", "Q3957", "Q532", "Q486972", "Q15284", "Q174844", "Q1093829", "Q7930989"]);
/** A place's name: English, else the multilingual label, else any label; a bare Q-id only when the item has no label at all. */
function placeLabel(e: Entity): string {
  const labels = (e.labels ?? {}) as Record<string, { value?: string } | undefined>;
  return labels.en?.value ?? labels.mul?.value ?? Object.values(labels).find((l) => l?.value)?.value ?? e.id;
}

// city=, place= or location= as a major city name (the weather tool's built-in table) when lat/lon are not given:
// /sun?city=Stockholm answered "lat is required" in the 26 Oct 2026 probe.
const knownCity = (q: Parameters<Entry["run"]>[1]) => {
  const key = (q("city") ?? q("place") ?? q("location"))?.toLowerCase().replace(/\s+/g, " ").replace(/,.*$/, "").trim();
  return key && Object.hasOwn(CITIES, key) ? CITIES[key] : undefined;
};
const lat = (q: Parameters<Entry["run"]>[1]) => (q("lat") === undefined && knownCity(q) ? knownCity(q)![1] : num(q, "lat", { min: -90, max: 90 }));
const lon = (q: Parameters<Entry["run"]>[1]) => (q("lon") === undefined && knownCity(q) ? knownCity(q)![2] : num(q, "lon", { min: -180, max: 180 }));
const LATLON = {
  lat: { type: "number" as const, description: "Latitude (-90 to 90)", required: true, example: 59.33 },
  lon: { type: "number" as const, description: "Longitude (-180 to 180)", required: true, example: 18.07 },
};
const enc = encodeURIComponent;
/** Plain text of a Wiktionary HTML fragment. */
export const stripHtml = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// ---------- Sun and moon (standard NOAA/Meeus approximations, accurate to about a minute) ----------
const rad = Math.PI / 180;
function julian(d: Date) { return d.getTime() / 864e5 + 2440587.5; }
export function sunTimes(date: Date, la: number, lo: number) {
  const n = Math.round(julian(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12))) - 2451545.0 + 0.0008);
  const jStar = n - lo / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const decl = Math.asin(Math.sin(lambda * rad) * Math.sin(23.4397 * rad));
  const at = (h: number) => (Math.sin(h * rad) - Math.sin(la * rad) * Math.sin(decl)) / (Math.cos(la * rad) * Math.cos(decl));
  const toDate = (j: number) => new Date((j - 2440587.5) * 864e5).toISOString();
  const cosOmega = at(-0.833);
  const noon = toDate(jTransit);
  if (cosOmega > 1) return { sunrise: null, sunset: null, solarNoon: noon, dayLengthMinutes: 0, polar: "night" };
  if (cosOmega < -1) return { sunrise: null, sunset: null, solarNoon: noon, dayLengthMinutes: 1440, polar: "day" };
  const omega = Math.acos(cosOmega) / rad;
  const twilight = at(-6);
  const civil = twilight >= -1 && twilight <= 1 ? Math.acos(twilight) / rad : null;
  return {
    sunrise: toDate(jTransit - omega / 360), sunset: toDate(jTransit + omega / 360), solarNoon: noon,
    civilDawn: civil != null ? toDate(jTransit - civil / 360) : null, civilDusk: civil != null ? toDate(jTransit + civil / 360) : null,
    dayLengthMinutes: Math.round((2 * omega / 360) * 1440), polar: null,
  };
}
// True new and full moons (Meeus, Astronomical Algorithms, chapter 49): the mean lunation plus the periodic terms of the
// Sun's and Moon's anomalies. Until 11 Nov 2026 this tool used the mean synodic month alone, and its "next new moon"
// could be 14 hours from the real one (9 Nov 2026: 21:57 UTC shown, 07:02 UTC true). Checked against nine published new
// and full moons from 1977 to 2026: within one minute each (tests/moon.test.cjs).
const DEG = Math.PI / 180;
const sind = (d: number) => Math.sin(d * DEG);
/** [coefficient for a new moon, for a full moon, multiples of M, M', F, power of E]. */
const LUNATION_TERMS: readonly (readonly [number, number, number, number, number, number])[] = [
  [-0.40720, -0.40614, 0, 1, 0, 0], [0.17241, 0.17302, 1, 0, 0, 1], [0.01608, 0.01614, 0, 2, 0, 0], [0.01039, 0.01043, 0, 0, 2, 0],
  [0.00739, 0.00734, -1, 1, 0, 1], [-0.00514, -0.00515, 1, 1, 0, 1], [0.00208, 0.00209, 2, 0, 0, 2], [-0.00111, -0.00111, 0, 1, -2, 0],
  [-0.00057, -0.00057, 0, 1, 2, 0], [0.00056, 0.00056, 1, 2, 0, 1], [-0.00042, -0.00042, 0, 3, 0, 0], [0.00042, 0.00042, 1, 0, 2, 1],
  [0.00038, 0.00038, 1, 0, -2, 1], [-0.00024, -0.00024, -1, 2, 0, 1], [-0.00007, -0.00007, 2, 1, 0, 0], [0.00004, 0.00004, 0, 2, -2, 0],
  [0.00004, 0.00004, 3, 0, 0, 0], [0.00003, 0.00003, 1, 1, -2, 0], [0.00003, 0.00003, 0, 2, 2, 0], [-0.00003, -0.00003, 1, 1, 2, 0],
  [0.00003, 0.00003, -1, 1, 2, 0], [-0.00002, -0.00002, -1, 1, -2, 0], [-0.00002, -0.00002, 1, 3, 0, 0], [0.00002, 0.00002, 0, 4, 0, 0],
];
/** Planetary arguments: [degrees at k = 0, degrees per lunation, coefficient in millionths of a day]. */
const PLANETARY_TERMS: readonly (readonly [number, number, number])[] = [
  [299.77, 0.107408, 325], [251.88, 0.016321, 165], [251.83, 26.651886, 164], [349.42, 36.412478, 126], [84.66, 18.206239, 110], [141.74, 53.303771, 62], [207.14, 2.453732, 60],
  [154.84, 7.306860, 56], [34.52, 27.261239, 47], [207.19, 0.121824, 42], [291.34, 1.844379, 40], [161.72, 24.198154, 37], [239.56, 25.513099, 35], [331.55, 3.592518, 23],
];
const LUNATION_DAYS = 29.530588861, LUNATION_EPOCH_JD = 2451550.09766;
/** Lunations since the new moon of 6 Jan 2000 for a moment, as a fraction (mean motion: good for picking the lunation). */
const lunationOf = (ms: number) => (ms / 864e5 + 2440587.5 - LUNATION_EPOCH_JD) / LUNATION_DAYS;
/** The moment of a true phase in UTC milliseconds: k whole is a new moon, k + 0.5 a full moon. */
export function lunarPhaseTime(k: number): number {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const full = Math.abs(k - Math.round(k)) > 0.25;
  let jde = LUNATION_EPOCH_JD + LUNATION_DAYS * k + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;
  for (const [forNew, forFull, m, mp, f, e] of LUNATION_TERMS) jde += (full ? forFull : forNew) * (e === 2 ? E * E : e === 1 ? E : 1) * sind(m * M + mp * Mp + f * F);
  jde -= 0.00017 * sind(124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3);
  PLANETARY_TERMS.forEach(([at0, perK, millionths], i) => { jde += millionths * 1e-6 * sind(at0 + perK * k - (i === 0 ? 0.009173 * T2 : 0)); });
  // Dynamical time to UTC: the difference is about 69 seconds in the 2020s (48 s in 1977, 64 s in 2000).
  return (jde - 2440587.5) * 864e5 - 69_000;
}
const toMinute = (ms: number) => new Date(Math.round(ms / 60_000) * 60_000).toISOString();

export function moonPhase(date: Date) {
  const now = date.getTime();
  // The last true new moon at or before the moment: start one lunation early and step forward.
  let k = Math.floor(lunationOf(now)) - 1;
  while (lunarPhaseTime(k + 1) <= now) k++;
  const lastNew = lunarPhaseTime(k), full = lunarPhaseTime(k + 0.5), nextNew = lunarPhaseTime(k + 1);
  // Position in this lunation, 0 at new and 0.5 at full, measured between the true events on each side.
  const fraction = now < full ? 0.5 * (now - lastNew) / (full - lastNew) : 0.5 + 0.5 * (now - full) / (nextNew - full);
  const illumination = Math.round(((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 1000) / 10;
  const names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
  const phase = names[Math.floor(((fraction * 8) + 0.5) % 8)];
  return {
    phase, illuminationPercent: illumination, ageDays: Math.round(((now - lastNew) / 864e5) * 10) / 10,
    nextNewMoon: toMinute(nextNew), nextFullMoon: toMinute(now < full ? full : lunarPhaseTime(k + 1.5)),
  };
}function dateParam(q: Parameters<Entry["run"]>[1]) {
  const v = q("date")?.trim();
  if (!v) return new Date();
  const d = parseDate(v, "T12:00:00Z");
  if (!d) throw new HttpError(400, "date is not valid (use an ISO date like 2026-10-18, or today, tomorrow, yesterday)");
  return d;
}

const P = ["data"];

/**
 * USGS publishes feeds at 1.0, 2.5, 4.5, "significant" and all magnitudes; any requested minimum ("6") reads the largest
 * feed at or below it and filters (24 Oct 2026: minMagnitude=6 was refused). Returns the feed name and the filter.
 */
export function quakeFeed(raw: string | undefined): { feed: string; min: number | null } {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return { feed: "2.5", min: 2.5 };
  if (s === "significant") return { feed: "significant", min: null };
  if (s === "all") return { feed: "all", min: 0 };
  const n = Number(s.replace(/^m/, ""));
  if (!Number.isFinite(n) || n < 0 || n > 10) throw new HttpError(400, "minMagnitude must be a magnitude from 0 to 10, or significant");
  const feed = n >= 4.5 ? "4.5" : n >= 2.5 ? "2.5" : n >= 1 ? "1.0" : "all";
  return { feed, min: n };
}

export const PUBLIC_DATA: Entry[] = [
  entry("/holidays", "Public holidays by country", "Public holidays for a year in over 100 countries: date, local and English name, whether it is nationwide, and the observed day where a weekend moves it. Statutory rules of our own for the US, UK, Sweden, Germany, France, Norway, Denmark and Finland (2024-2100); Nager.Date for the rest (Japan, Canada, Australia, India, Brazil…). Use for scheduling, delivery dates and business-day maths.",
    ["holidays", "calendar", "date", ...P], { country: { type: "string", description: "ISO 3166-1 alpha-2 code (US, GB, SE, JP, CA…) or English country name", required: true, example: "SE" }, year: { type: "integer", description: "Year, 2024-2100 (default this year)", example: 2026 } },
    { country: "SE", countryName: "Sweden", year: 2026, count: 13, holidays: [{ date: "2026-01-01", localName: "Nyårsdagen", name: "New Year's Day", nationwide: true, types: ["Public"], observed: null }], note: "Computed from statutory rules; nationwide holidays only. Regional holidays and one-off proclamations are not included." },
    async (_e, q) => {
      // What agents type: "UK" (the description's own word), "USA" or the country's English name.
      const typed = need(q, "country", 60).trim();
      // Any English country name or code resolves ("Japan" used to be refused as "not a 2-letter code" rather than as unsupported).
      const country = countryCode(typed) ?? typed.toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, `country must be a 2-letter ISO code such as GB, US or SE, or a country name (got "${typed.slice(0, 40)}")`);
      const year = num(q, "year", { min: 2024, max: 2100, fallback: new Date().getUTCFullYear(), integer: true });
      const out = holidaysFor(country, year);
      if (out) return out;
      // Countries without our statutory rules: Nager.Date (src/routes/holidays-world.ts).
      const world = await nagerHolidays(country, year);
      if (!world) throw new HttpError(404, `no holiday calendar for ${countryName(country) ?? country} (${country}); nothing was charged`);
      return { country, countryName: countryName(country) ?? country, year, count: world.length, holidays: world, note: "From Nager.Date (date.nager.at). Holidays with nationwide false apply only in some regions.", source: "Nager.Date" };
    }),

  entry("/wikipedia", "Wikipedia article summary", "Short summary of a Wikipedia article in any language edition: title, one-paragraph extract, description, thumbnail and page URL. Use to ground an agent's answer in a quick, citable fact sheet.",
    ["wikipedia", "knowledge", ...P], { title: { type: "string", description: "Article title", required: true, example: "Stockholm" }, lang: { type: "string", description: "Language code (default en)", example: "en" } },
    { title: "Stockholm", description: "Capital of Sweden", extract: "Stockholm is the capital and most populous city of Sweden…", url: "https://en.wikipedia.org/wiki/Stockholm", thumbnail: "https://upload.wikimedia.org/…", licence: "CC BY-SA 4.0", attribution: "Text from the Wikipedia article \"Stockholm\" by its contributors, licensed CC BY-SA 4.0" },
    async (_e, q) => {
      const lang = (opt(q, "lang", 12) ?? "en").toLowerCase();
      if (!/^[a-z-]{2,12}$/.test(lang)) throw new HttpError(400, "lang must be a Wikipedia language code like en, sv, de");
      const r = await getJson<{ title: string; description?: string; extract: string; content_urls?: { desktop?: { page?: string } }; thumbnail?: { source: string }; type: string }>(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc(need(q, "title", 300).replace(/ /g, "_"))}`, { notFound: "no article with that title" });
      return { title: r.title, description: r.description ?? null, extract: r.extract, type: r.type, url: r.content_urls?.desktop?.page ?? null, thumbnail: r.thumbnail?.source ?? null, licence: "CC BY-SA 4.0", attribution: `Text from the Wikipedia article "${r.title}" by its contributors, licensed CC BY-SA 4.0` };
    }),

  entry("/dictionary", "Dictionary definition: English words", "Dictionary definition of an English word from Wiktionary, grouped by part of speech, with example sentences where Wiktionary gives them, plus the page link and the CC BY-SA attribution to show. Use for writing help, vocabulary, translation checks and word games.",
    ["dictionary", "language", "english", ...P], { word: { type: "string", description: "An English word", required: true, example: "serendipity" } },
    { word: "serendipity", meanings: [{ partOfSpeech: "Noun", definitions: [{ definition: "An unsought, unintended, and/or unexpected, but fortunate, discovery.", example: null }] }], url: "https://en.wiktionary.org/wiki/serendipity", licence: "CC BY-SA 4.0", attribution: "Definitions from the Wiktionary entry \"serendipity\" by its contributors, licensed CC BY-SA 4.0" },
    async (_e, q) => {
      const typed = need(q, "word", 60).trim();
      type Sense = { definition?: string; examples?: string[] };
      type Meaning = { partOfSpeech: string; definitions: { definition: string; example: string | null }[] };
      const lookup = async (w: string) => {
        const r = await getJson<Record<string, Array<{ partOfSpeech: string; definitions: Sense[] }>>>(`https://en.wiktionary.org/api/rest_v1/page/definition/${enc(w.replaceAll(" ", "_"))}`, { notFound: "word not found" });
        return (r.en ?? []).slice(0, 8).map((m): Meaning => ({
          partOfSpeech: m.partOfSpeech,
          definitions: m.definitions.map((d) => ({ definition: stripHtml(d.definition ?? ""), example: d.examples?.[0] ? stripHtml(d.examples[0]) : null })).filter((d) => d.definition).slice(0, 4),
        })).filter((m) => m.definitions.length);
      };
      // Wiktionary entries are case-sensitive: "Running" is only a surname, "running" the verb. A capitalised word is looked
      // up in lower case first; the spelling as typed is tried when that has no entry (proper nouns, acronyms stay as sent).
      const lower = typed.toLowerCase();
      let word = typed, meanings: Meaning[] = [];
      if (typed !== lower && typed !== typed.toUpperCase()) { meanings = await lookup(lower).catch(() => []); if (meanings.length) word = lower; }
      if (!meanings.length) meanings = await lookup(typed);
      if (!meanings.length) throw new HttpError(404, "no English definitions for this word");
      return { word, meanings, url: `https://en.wiktionary.org/wiki/${enc(word.replaceAll(" ", "_"))}`, licence: "CC BY-SA 4.0", attribution: `Definitions from the Wiktionary entry "${word}" by its contributors, licensed CC BY-SA 4.0` };
    }),

  entry("/earthquakes", "Earthquake data, earthquakes", "Recent earthquakes worldwide from the US Geological Survey: magnitude, place, time, depth, coordinates, tsunami flag and USGS link, for the past day or week, filtered by minimum magnitude (2.5, 4.5 or significant). Use for alerts, news and travel checks.",
    ["earthquakes", "geo", "science", ...P], { period: { type: "string", description: "hour, day (default), week or month", example: "day" }, minMagnitude: { type: "string", description: "Smallest magnitude to include, 0-10 (default 2.5), or significant", example: "4.5" } },
    { period: "day", minMagnitude: "4.5", count: 8, earthquakes: [{ magnitude: 5.1, place: "100 km S of …", time: "2026-10-18T03:12:00.000Z", depthKm: 10, lat: -6.1, lon: 130.2, tsunami: false, url: "https://earthquake.usgs.gov/…" }] },
    async (_e, q) => {
      const period = pick(q, "period", ["hour", "day", "week", "month"] as const, "day");
      const { feed, min } = quakeFeed(q("minMagnitude"));
      const r = await getJson<{ features: Array<{ properties: { mag: number; place: string; time: number; tsunami: number; url: string }; geometry: { coordinates: [number, number, number] } }> }>(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}_${period}.geojson`);
      const features = min === null ? r.features : r.features.filter((f) => typeof f.properties.mag === "number" && f.properties.mag >= min);
      return { period, minMagnitude: min === null ? "significant" : String(min), count: features.length, earthquakes: features.slice(0, 100).map((f) => ({ magnitude: f.properties.mag, place: f.properties.place, time: new Date(f.properties.time).toISOString(), depthKm: f.geometry.coordinates[2], lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], tsunami: f.properties.tsunami === 1, url: f.properties.url })) };
    }),

  entry("/air-quality", "Air quality now", "Current air quality at a point: European and US air-quality index, PM2.5, PM10, ozone, nitrogen dioxide, sulphur dioxide and carbon monoxide (Open-Meteo, CAMS model data). Use for health, outdoor-activity and travel decisions.",
    ["air-quality", "environment", "health", ...P], LATLON,
    { time: "2026-10-18T12:00", europeanAqi: 21, usAqi: 34, pm2_5: 6.1, pm10: 9.8, ozone: 52, nitrogenDioxide: 7.2, sulphurDioxide: 0.9, carbonMonoxide: 160, units: "μg/m³" },
    async (_e, q) => {
      const r = await getJson<{ current: Record<string, number | string> }>(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat(q)}&longitude=${lon(q)}&current=european_aqi,us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide`);
      const c = r.current;
      return { time: c.time, europeanAqi: c.european_aqi, usAqi: c.us_aqi, pm2_5: c.pm2_5, pm10: c.pm10, ozone: c.ozone, nitrogenDioxide: c.nitrogen_dioxide, sulphurDioxide: c.sulphur_dioxide, carbonMonoxide: c.carbon_monoxide, units: "μg/m³" };
    }),

  entry("/uv", "UV index now and today", "Current UV index and today's maximum at a point, with the WHO exposure category and sun-protection advice (Open-Meteo). Use for outdoor planning and health reminders.",
    ["uv", "weather", "health", ...P], LATLON,
    { uvIndex: 2.4, category: "low", todayMax: 3.1, todayMaxCategory: "moderate", advice: "Protection is advisable around midday." },
    async (_e, q) => {
      const r = await getJson<{ current: { uv_index: number }; daily: { uv_index_max: number[] } }>(`https://api.open-meteo.com/v1/forecast?latitude=${lat(q)}&longitude=${lon(q)}&current=uv_index&daily=uv_index_max&forecast_days=1&timezone=auto`);
      const cat = (u: number) => (u < 3 ? "low" : u < 6 ? "moderate" : u < 8 ? "high" : u < 11 ? "very high" : "extreme");
      const max = r.daily.uv_index_max[0];
      return { uvIndex: r.current.uv_index, category: cat(r.current.uv_index), todayMax: max, todayMaxCategory: cat(max), advice: max < 3 ? "No protection needed for most people." : max < 6 ? "Protection is advisable around midday." : "Seek shade at midday; use sunscreen, a hat and sunglasses." };
    }),

  entry("/geocode", "Geocode address, geocoding: place name to latitude and longitude", "Find places by name in Wikidata (CC0) and get their coordinates, description, country, administrative region, population and elevation where recorded, best match first. Cities, towns, landmarks and other places with coordinates. Use before weather, sun or distance lookups, or to tell two places of the same name apart.",
    ["geocode", "geo", "places", ...P], { name: { type: "string", description: "Place name", required: true, example: "Lisbon" }, count: { type: "integer", description: "Max results (1-10, default 5)", example: 3 } },
    { count: 1, results: [{ name: "Lisbon", description: "municipality and capital city of Portugal", country: "Portugal", region: "Lisbon", lat: 38.708, lon: -9.139, population: 545796, elevation: 100, wikidataId: "Q597" }], source: "Wikidata (CC0 public domain)" },
    async (_e, q) => {
      const name = need(q, "name", 100);
      const count = num(q, "count", { min: 1, max: 10, fallback: 5, integer: true });
      const ids = await searchItems(name, Math.min(20, count * 3));
      const entities = ids.length ? await getEntities(ids) : {};
      // 11 Nov 2026 truth audit: "New York" returned New York State first (so /pack/location-brief gave the weather of rural
      // upstate NY). Among the matches, places that are cities, towns or villages come first; search order is kept otherwise.
      const settled = (e: Entity) => itemIds(e, "P31").some((t) => SETTLEMENT_TYPES.has(t));
      const located = ids.map((id) => entities[id]).filter((e): e is Entity => Boolean(e) && statements(e, "P625").length > 0);
      const places = [...located.filter(settled), ...located.filter((e) => !settled(e))].slice(0, count);
      const labels = await labelsOf(places.flatMap((e) => [...itemIds(e, "P17").slice(0, 1), ...itemIds(e, "P131").slice(0, 1)]));
      return {
        count: places.length,
        results: places.map((e) => {
          const at = statements(e, "P625")[0].mainsnak.datavalue!.value as { latitude: number; longitude: number };
          return {
            name: placeLabel(e), description: e.descriptions?.en?.value ?? null,
            country: labels[itemIds(e, "P17")[0]] ?? null, region: labels[itemIds(e, "P131")[0]] ?? null,
            lat: Math.round(at.latitude * 1e4) / 1e4, lon: Math.round(at.longitude * 1e4) / 1e4,
            population: firstQuantity(e, "P1082"), elevation: firstQuantity(e, "P2044"), wikidataId: e.id,
          };
        }),
        source: "Wikidata (CC0 public domain)",
      };
    }),

  entry("/elevation", "Elevation of a point", "Ground elevation in metres above sea level for a latitude and longitude (Copernicus 90 m digital elevation model via Open-Meteo). Use to plan routes, size flood or terrain risk, or enrich location data.",
    ["elevation", "geo", ...P], LATLON, { lat: 59.33, lon: 18.07, elevationM: 28 },
    async (_e, q) => {
      const la = lat(q), lo = lon(q);
      const r = await getJson<{ elevation: number[] }>(`https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`);
      return { lat: la, lon: lo, elevationM: r.elevation?.[0] ?? null };
    }),

  entry("/sun", "Sun times, sunrise sunset", "Sunrise, sunset, solar noon, civil dawn and dusk (UTC) and day length for any place and date, computed with the standard solar equations; handles polar day and night. No outside service. Use for photography, events and outdoor planning.",
    ["sun", "astronomy", "date", ...P], { ...LATLON, date: { type: "string", description: "Date (default today)", example: "2026-12-21" } },
    { date: "2026-12-21", sunrise: "2026-12-21T07:43:00.000Z", sunset: "2026-12-21T13:48:00.000Z", solarNoon: "2026-12-21T10:45:00.000Z", civilDawn: "2026-12-21T06:58:00.000Z", civilDusk: "2026-12-21T14:33:00.000Z", dayLengthMinutes: 365, polar: null },
    (_e, q) => { const d = dateParam(q); return { date: d.toISOString().slice(0, 10), ...sunTimes(d, lat(q), lon(q)) }; }),

  entry("/moon", "Moon phase", "Moon phase name, illuminated percentage and age in days for any date, plus the next new and full moon (UTC, to the minute). Computed locally from the Moon's and Sun's orbital terms; the times agree with published almanacs within about a minute. Use for calendars and night-sky planning.",
    ["moon", "astronomy", "date", ...P], { date: { type: "string", description: "Date or ISO time (default now)", example: "2026-10-18" } },
    { date: "2026-10-18", phase: "Waning Crescent", illuminationPercent: 12.4, ageDays: 26.3, nextNewMoon: "2026-10-21T…", nextFullMoon: "2026-11-05T…" },
    (_e, q) => { const d = dateParam(q); return { date: d.toISOString().slice(0, 10), ...moonPhase(d) }; }),

  entry("/country", "Country info, country facts", "Facts about a country by ISO code (SE, SWE, US…): official World Bank name, ISO-2 and ISO-3 codes, region, income level, capital city and its coordinates, and the latest population figure with its year (World Bank open data). Use to enrich records with country data.",
    ["country", "geo", "reference", ...P], { country: { type: "string", description: "ISO 3166 alpha-2 or alpha-3 code", required: true, example: "SE" } },
    { name: "Sweden", iso2: "SE", iso3: "SWE", region: "Europe & Central Asia", incomeLevel: "High income", capital: "Stockholm", capitalLat: 59.3327, capitalLon: 18.0645, population: 10596620, populationYear: 2025, source: "World Bank" },
    async (_e, q) => {
      // An English country name too ("Sweden", "UK"), as agents send it (26 Oct 2026 probe); World Bank takes ISO2 or ISO3.
      const sent = need(q, "country", 80).trim();
      // 11 Nov 2026 truth audit: "UK" (and "USA") skipped the alias table because they look like codes; UK is not an ISO code.
      const code = /^[A-Za-z]{2,3}$/.test(sent) && !/^(uk|usa)$/i.test(sent) ? sent.toUpperCase() : (countryCode(sent) ?? "");
      if (!/^[A-Z]{2,3}$/.test(code)) throw new HttpError(400, "country must be a 2- or 3-letter ISO code or an English country name");
      type WB<T> = [unknown, T[] | null] | [{ message: unknown }];
      const info = await getJson<WB<{ id: string; iso2Code: string; name: string; region: { value: string }; incomeLevel: { value: string }; capitalCity: string; latitude: string; longitude: string }>>(`https://api.worldbank.org/v2/country/${code}?format=json`);
      const c = Array.isArray(info) && info.length > 1 ? (info[1] as Array<{ id: string; iso2Code: string; name: string; region: { value: string }; incomeLevel: { value: string }; capitalCity: string; latitude: string; longitude: string }> | null)?.[0] : undefined;
      if (!c || c.region.value === "Aggregates") throw new HttpError(404, "no country with that code");
      const pop = await getJson<WB<{ date: string; value: number | null }>>(`https://api.worldbank.org/v2/country/${code}/indicator/SP.POP.TOTL?format=json&mrnev=1`).catch(() => null);
      const p = Array.isArray(pop) && pop.length > 1 ? (pop[1] as Array<{ date: string; value: number | null }> | null)?.[0] : undefined;
      return { name: c.name, iso2: c.iso2Code, iso3: c.id, region: c.region.value, incomeLevel: c.incomeLevel.value, capital: c.capitalCity || null, capitalLat: c.latitude ? Number(c.latitude) : null, capitalLon: c.longitude ? Number(c.longitude) : null, population: p?.value ?? null, populationYear: p ? Number(p.date) : null, source: "World Bank" };
    }),
  entry("/crypto/price", "Crypto prices", "Current price of up to 25 cryptocurrencies by CoinGecko id (bitcoin, ethereum, solana, usd-coin…) in up to 5 currencies, with the 24-hour change (from Coinbase for the coins it trades; tickers such as BTC work too). Use to price coins that are not on-chain tokens, value a portfolio in several currencies, or check a move.",
    ["crypto", "prices", "markets", ...P], { ids: { type: "string", description: "Comma-separated CoinGecko ids", required: true, example: "bitcoin,ethereum" }, vs: { type: "string", description: "Comma-separated currencies (default usd)", example: "usd,eur" } },
    { prices: { bitcoin: { usd: 101250.5, usd_24h_change: -1.2, usd_market_cap: null }, ethereum: { usd: 2241.23, usd_24h_change: 0.84, usd_market_cap: null } }, missing: [], source: "Coinbase" },
    async (_e, q) => {
      const ids = need(q, "ids", 500).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const vs = (opt(q, "vs", 60) ?? "usd").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (ids.length > 25 || vs.length > 5 || ![...ids, ...vs].every((x) => /^[a-z0-9-]+$/.test(x))) throw new HttpError(400, "up to 25 ids and 5 currencies, letters, digits and hyphens only");
      // Coinbase first for the coins it trades, CoinGecko for the rest (src/lib/coin-prices.ts: CoinGecko refuses Workers).
      const r = await cryptoPrices(ids, vs);
      if (!Object.keys(r.prices).length) throw new HttpError(404, "none of those ids were found (use CoinGecko ids such as bitcoin, or tickers such as BTC)");
      return r;
    }),

  entry("/npm/downloads", "npm package downloads", "Download counts of an npm package for the last day, week and month, from the official npm registry API. Use to judge how widely a dependency is used.",
    ["npm", "packages", "dev", ...P], { package: { type: "string", description: "Package name, e.g. react or @scope/name", required: true, example: "hono" } },
    { package: "hono", lastDay: 450000, lastWeek: 3100000, lastMonth: 13000000 },
    async (_e, q) => {
      const pkg = need(q, "package", 214).trim();
      if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(pkg)) throw new HttpError(400, "not a valid npm package name");
      const get = (p: string) => getJson<{ downloads: number }>(`https://api.npmjs.org/downloads/point/${p}/${pkg}`, { notFound: "package not found" });
      const [d, w, m] = await Promise.all([get("last-day"), get("last-week"), get("last-month")]);
      return { package: pkg, lastDay: d.downloads, lastWeek: w.downloads, lastMonth: m.downloads };
    }),

  entry("/pypi", "PyPI package info", "Latest version, summary, licence, required Python version, home page, release date and number of releases of a Python package on PyPI. Use to check a dependency before installing it.",
    ["pypi", "python", "packages", "dev", ...P], { package: { type: "string", description: "PyPI package name", required: true, example: "requests" } },
    { package: "requests", version: "2.32.3", summary: "Python HTTP for Humans.", license: "Apache-2.0", requiresPython: ">=3.8", homePage: "https://requests.readthedocs.io", released: "2024-05-29T15:37:47Z", releases: 157 },
    async (_e, q) => {
      const pkg = need(q, "package", 100).trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pkg)) throw new HttpError(400, "not a valid PyPI package name");
      const r = await getJson<{ info: { name: string; version: string; summary: string; license: string; license_expression?: string; requires_python: string; home_page: string; project_urls?: Record<string, string> }; releases: Record<string, Array<{ upload_time_iso_8601: string }>> }>(`https://pypi.org/pypi/${enc(pkg)}/json`, { notFound: "package not found" });
      const files = r.releases[r.info.version] ?? [];
      return { package: r.info.name, version: r.info.version, summary: r.info.summary, license: r.info.license_expression || r.info.license || null, requiresPython: r.info.requires_python || null, homePage: r.info.home_page || r.info.project_urls?.Homepage || null, released: files[0]?.upload_time_iso_8601 ?? null, releases: Object.keys(r.releases).length };
    }),

  entry("/hackernews/top", "Hacker News top stories", "Current top stories on Hacker News: title, link, points, comment count, author, age and discussion URL (official HN API). Use to follow what developers are discussing right now.",
    ["news", "hackernews", "tech", ...P], { count: { type: "integer", description: "How many (1-20, default 10)", example: 5 } },
    // Five stories, as the example input asks for (the listing showed count 1 beside count=5 until 1.111.4).
    { count: 5, stories: [
      { id: 1, title: "Show HN: …", url: "https://…", points: 312, comments: 140, by: "user", time: "2026-10-18T09:00:00.000Z", discussion: "https://news.ycombinator.com/item?id=1" },
      { id: 2, title: "…", url: "https://…", points: 268, comments: 97, by: "user", time: "2026-10-18T08:10:00.000Z", discussion: "https://news.ycombinator.com/item?id=2" },
      { id: 3, title: "…", url: "https://…", points: 201, comments: 54, by: "user", time: "2026-10-18T07:45:00.000Z", discussion: "https://news.ycombinator.com/item?id=3" },
      { id: 4, title: "…", url: "https://…", points: 150, comments: 212, by: "user", time: "2026-10-18T06:30:00.000Z", discussion: "https://news.ycombinator.com/item?id=4" },
      { id: 5, title: "…", url: "https://…", points: 96, comments: 31, by: "user", time: "2026-10-18T05:05:00.000Z", discussion: "https://news.ycombinator.com/item?id=5" },
    ] },
    async (_e, q) => {
      const n = num(q, "count", { min: 1, max: 20, fallback: 10, integer: true });
      const ids = await getJson<number[]>("https://hacker-news.firebaseio.com/v0/topstories.json");
      const items = await Promise.all(ids.slice(0, n).map((id) => getJson<{ id: number; title: string; url?: string; score: number; descendants?: number; by: string; time: number }>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
      return { count: items.length, stories: items.map((s) => ({ id: s.id, title: s.title, url: s.url ?? null, points: s.score, comments: s.descendants ?? 0, by: s.by, time: new Date(s.time * 1000).toISOString(), discussion: `https://news.ycombinator.com/item?id=${s.id}` })) };
    }),

  entry("/iss", "Where is the ISS now", "Current position of the International Space Station: latitude, longitude, altitude, speed and whether it is in daylight (wheretheiss.at). Use for space apps, education bots and sky-watching alerts.",
    ["space", "iss", "astronomy", ...P], {},
    { lat: 12.3, lon: -45.6, altitudeKm: 418.2, speedKmh: 27580, visibility: "daylight", time: "2026-10-18T12:00:00.000Z" },
    async () => {
      const r = await getJson<{ latitude: number; longitude: number; altitude: number; velocity: number; visibility: string; timestamp: number }>("https://api.wheretheiss.at/v1/satellites/25544");
      return { lat: r.latitude, lon: r.longitude, altitudeKm: Math.round(r.altitude * 10) / 10, speedKmh: Math.round(r.velocity), visibility: r.visibility, time: new Date(r.timestamp * 1000).toISOString() };
    }),
];
