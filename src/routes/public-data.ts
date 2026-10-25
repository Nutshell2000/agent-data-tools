// Public data from free, keyless sources, plus sun and moon times computed locally.
// Outside failures are 502 (not charged); "not found" answers are 404 (not charged).
import { entry, getJson, need, num, opt, pick, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { countryCode, countryName } from "../lib/country-code";
import { parseDate } from "../lib/relative-date";
import { COUNTRIES, holidaysFor } from "./holidays";
import { type Entity, firstQuantity, getEntities, itemIds, labelsOf, searchItems, statements } from "../lib/wikidata";

const lat = (q: Parameters<Entry["run"]>[1]) => num(q, "lat", { min: -90, max: 90 });
const lon = (q: Parameters<Entry["run"]>[1]) => num(q, "lon", { min: -180, max: 180 });
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
export function moonPhase(date: Date) {
  const synodic = 29.530588853;
  const known = Date.UTC(2000, 0, 6, 18, 14); // a new moon
  const age = (((date.getTime() - known) / 864e5) % synodic + synodic) % synodic;
  const fraction = age / synodic;
  const illumination = Math.round(((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 1000) / 10;
  const names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
  const phase = names[Math.floor(((fraction * 8) + 0.5) % 8)];
  const next = (target: number) => new Date(date.getTime() + ((((target - fraction) % 1) + 1) % 1) * synodic * 864e5).toISOString();
  return { phase, illuminationPercent: illumination, ageDays: Math.round(age * 10) / 10, nextNewMoon: next(0), nextFullMoon: next(0.5) };
}
function dateParam(q: Parameters<Entry["run"]>[1]) {
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
  entry("/holidays", "Public holidays by country", "Nationwide public holidays for a year in the US (federal), UK (England and Wales), Sweden, Germany, France, Norway, Denmark and Finland: date, local and English name, and the weekday it is observed on where a weekend moves it. Computed from statutory rules for 2024-2100. Use for scheduling, delivery dates and business-day maths.",
    ["holidays", "calendar", "date", ...P], { country: { type: "string", description: "ISO 3166-1 alpha-2 code: US, GB (UK), SE, DE, FR, NO, DK or FI; English country names also work", required: true, example: "SE" }, year: { type: "integer", description: "Year, 2024-2100 (default this year)", example: 2026 } },
    { country: "SE", countryName: "Sweden", year: 2026, count: 13, holidays: [{ date: "2026-01-01", localName: "Nyårsdagen", name: "New Year's Day", nationwide: true, types: ["Public"], observed: null }], note: "Computed from statutory rules; nationwide holidays only. Regional holidays and one-off proclamations are not included." },
    async (_e, q) => {
      // What agents type: "UK" (the description's own word), "USA" or the country's English name.
      const typed = need(q, "country", 60).trim();
      // Any English country name or code resolves ("Japan" used to be refused as "not a 2-letter code" rather than as unsupported).
      const country = countryCode(typed) ?? typed.toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, `country must be a 2-letter ISO code such as GB, US or SE, or a country name (got "${typed.slice(0, 40)}")`);
      const year = num(q, "year", { min: 2024, max: 2100, fallback: new Date().getUTCFullYear(), integer: true });
      const out = holidaysFor(country, year);
      if (!out) throw new HttpError(404, `no holiday rules for ${countryName(country) ?? country} (${country}); supported: ${Object.keys(COUNTRIES).join(", ")}`);
      return out;
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

  entry("/dictionary", "Dictionary definition: English words", "Definitions of an English word from Wiktionary, grouped by part of speech, with example sentences where Wiktionary gives them, plus the page link and the CC BY-SA attribution to show. Use for writing help, vocabulary, translation checks and word games.",
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

  entry("/earthquakes", "Recent earthquakes, USGS data", "Recent earthquakes worldwide from the US Geological Survey: magnitude, place, time, depth, coordinates, tsunami flag and USGS link, for the past day or week, filtered by minimum magnitude (2.5, 4.5 or significant). Use for alerts, news and travel checks.",
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

  entry("/geocode", "Geocoding: place name to latitude and longitude", "Find places by name in Wikidata (CC0) and get their coordinates, description, country, administrative region, population and elevation where recorded, best match first. Cities, towns, landmarks and other places with coordinates. Use before weather, sun or distance lookups, or to tell two places of the same name apart.",
    ["geocode", "geo", "places", ...P], { name: { type: "string", description: "Place name", required: true, example: "Uppsala" }, count: { type: "integer", description: "Max results (1-10, default 5)", example: 3 } },
    { count: 1, results: [{ name: "Uppsala", description: "city in Sweden", country: "Sweden", region: "Uppsala Municipality", lat: 59.858, lon: 17.645, population: 170000, elevation: 15, wikidataId: "Q…" }], source: "Wikidata (CC0 public domain)" },
    async (_e, q) => {
      const name = need(q, "name", 100);
      const count = num(q, "count", { min: 1, max: 10, fallback: 5, integer: true });
      const ids = await searchItems(name, Math.min(20, count * 3));
      const entities = ids.length ? await getEntities(ids) : {};
      const places = ids.map((id) => entities[id]).filter((e): e is Entity => Boolean(e) && statements(e, "P625").length > 0).slice(0, count);
      const labels = await labelsOf(places.flatMap((e) => [...itemIds(e, "P17").slice(0, 1), ...itemIds(e, "P131").slice(0, 1)]));
      return {
        count: places.length,
        results: places.map((e) => {
          const at = statements(e, "P625")[0].mainsnak.datavalue!.value as { latitude: number; longitude: number };
          return {
            name: e.labels?.en?.value ?? e.id, description: e.descriptions?.en?.value ?? null,
            country: labels[itemIds(e, "P17")[0]] ?? null, region: labels[itemIds(e, "P131")[0]] ?? null,
            lat: Math.round(at.latitude * 1e4) / 1e4, lon: Math.round(at.longitude * 1e4) / 1e4,
            population: firstQuantity(e, "P1082"), elevation: firstQuantity(e, "P2044"), wikidataId: e.id,
          };
        }),
        source: "Wikidata (CC0 public domain)",
      };
    }),

  entry("/elevation", "Elevation of a point", "Ground elevation in metres above sea level for a latitude and longitude (Copernicus 90 m digital elevation model via Open-Meteo).",
    ["elevation", "geo", ...P], LATLON, { lat: 59.33, lon: 18.07, elevationM: 28 },
    async (_e, q) => {
      const la = lat(q), lo = lon(q);
      const r = await getJson<{ elevation: number[] }>(`https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`);
      return { lat: la, lon: lo, elevationM: r.elevation?.[0] ?? null };
    }),

  entry("/sun", "Sunrise sunset times, day length", "Sunrise, sunset, solar noon, civil dawn and dusk (UTC) and day length for any place and date, computed with the standard solar equations; handles polar day and night. No outside service. Use for photography, events and outdoor planning.",
    ["sun", "astronomy", "date", ...P], { ...LATLON, date: { type: "string", description: "Date (default today)", example: "2026-12-21" } },
    { date: "2026-12-21", sunrise: "2026-12-21T07:43:00.000Z", sunset: "2026-12-21T13:48:00.000Z", solarNoon: "2026-12-21T10:45:00.000Z", civilDawn: "2026-12-21T06:58:00.000Z", civilDusk: "2026-12-21T14:33:00.000Z", dayLengthMinutes: 365, polar: null },
    (_e, q) => { const d = dateParam(q); return { date: d.toISOString().slice(0, 10), ...sunTimes(d, lat(q), lon(q)) }; }),

  entry("/moon", "Moon phase", "Moon phase name, illuminated percentage and age in days for any date, plus the next new and full moon (UTC). Computed locally from the mean synodic month. Use for calendars and night-sky planning.",
    ["moon", "astronomy", "date", ...P], { date: { type: "string", description: "Date or ISO time (default now)", example: "2026-10-18" } },
    { date: "2026-10-18", phase: "Waning Crescent", illuminationPercent: 12.4, ageDays: 26.3, nextNewMoon: "2026-10-21T…", nextFullMoon: "2026-11-05T…" },
    (_e, q) => { const d = dateParam(q); return { date: d.toISOString().slice(0, 10), ...moonPhase(d) }; }),

  entry("/country", "Country info, country facts", "Facts about a country by ISO code (SE, SWE, US…): official World Bank name, ISO-2 and ISO-3 codes, region, income level, capital city and its coordinates, and the latest population figure with its year (World Bank open data). Use to enrich records with country data.",
    ["country", "geo", "reference", ...P], { country: { type: "string", description: "ISO 3166 alpha-2 or alpha-3 code", required: true, example: "SE" } },
    { name: "Sweden", iso2: "SE", iso3: "SWE", region: "Europe & Central Asia", incomeLevel: "High income", capital: "Stockholm", capitalLat: 59.3327, capitalLon: 18.0645, population: 10596620, populationYear: 2025, source: "World Bank" },
    async (_e, q) => {
      const code = need(q, "country", 3).trim().toUpperCase();
      if (!/^[A-Z]{2,3}$/.test(code)) throw new HttpError(400, "country must be a 2- or 3-letter ISO code");
      type WB<T> = [unknown, T[] | null] | [{ message: unknown }];
      const info = await getJson<WB<{ id: string; iso2Code: string; name: string; region: { value: string }; incomeLevel: { value: string }; capitalCity: string; latitude: string; longitude: string }>>(`https://api.worldbank.org/v2/country/${code}?format=json`);
      const c = Array.isArray(info) && info.length > 1 ? (info[1] as Array<{ id: string; iso2Code: string; name: string; region: { value: string }; incomeLevel: { value: string }; capitalCity: string; latitude: string; longitude: string }> | null)?.[0] : undefined;
      if (!c || c.region.value === "Aggregates") throw new HttpError(404, "no country with that code");
      const pop = await getJson<WB<{ date: string; value: number | null }>>(`https://api.worldbank.org/v2/country/${code}/indicator/SP.POP.TOTL?format=json&mrnev=1`).catch(() => null);
      const p = Array.isArray(pop) && pop.length > 1 ? (pop[1] as Array<{ date: string; value: number | null }> | null)?.[0] : undefined;
      return { name: c.name, iso2: c.iso2Code, iso3: c.id, region: c.region.value, incomeLevel: c.incomeLevel.value, capital: c.capitalCity || null, capitalLat: c.latitude ? Number(c.latitude) : null, capitalLon: c.longitude ? Number(c.longitude) : null, population: p?.value ?? null, populationYear: p ? Number(p.date) : null, source: "World Bank" };
    }),
  entry("/crypto/price", "Crypto prices", "Current price of up to 25 cryptocurrencies by CoinGecko id (bitcoin, ethereum, solana, usd-coin…) in up to 5 currencies, with 24-hour change and market cap.",
    ["crypto", "prices", "markets", ...P], { ids: { type: "string", description: "Comma-separated CoinGecko ids", required: true, example: "bitcoin,ethereum" }, vs: { type: "string", description: "Comma-separated currencies (default usd)", example: "usd,eur" } },
    { prices: { bitcoin: { usd: 67000, usd_24h_change: -1.2, usd_market_cap: 1.32e12 } }, source: "CoinGecko" },
    async (_e, q) => {
      const ids = need(q, "ids", 500).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const vs = (opt(q, "vs", 60) ?? "usd").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (ids.length > 25 || vs.length > 5 || ![...ids, ...vs].every((x) => /^[a-z0-9-]+$/.test(x))) throw new HttpError(400, "up to 25 ids and 5 currencies, letters, digits and hyphens only");
      const r = await getJson<Record<string, Record<string, number>>>(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=${vs.join(",")}&include_24hr_change=true&include_market_cap=true`);
      if (!Object.keys(r).length) throw new HttpError(404, "none of those ids were found");
      return { prices: r, missing: ids.filter((i) => !(i in r)), source: "CoinGecko" };
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
    { count: 1, stories: [{ id: 1, title: "Show HN: …", url: "https://…", points: 312, comments: 140, by: "user", time: "2026-10-18T09:00:00.000Z", discussion: "https://news.ycombinator.com/item?id=1" }] },
    async (_e, q) => {
      const n = num(q, "count", { min: 1, max: 20, fallback: 10, integer: true });
      const ids = await getJson<number[]>("https://hacker-news.firebaseio.com/v0/topstories.json");
      const items = await Promise.all(ids.slice(0, n).map((id) => getJson<{ id: number; title: string; url?: string; score: number; descendants?: number; by: string; time: number }>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
      return { count: items.length, stories: items.map((s) => ({ id: s.id, title: s.title, url: s.url ?? null, points: s.score, comments: s.descendants ?? 0, by: s.by, time: new Date(s.time * 1000).toISOString(), discussion: `https://news.ycombinator.com/item?id=${s.id}` })) };
    }),

  entry("/iss", "Where is the ISS now", "Current position of the International Space Station: latitude, longitude, altitude, speed and whether it is in daylight (wheretheiss.at).",
    ["space", "iss", "astronomy", ...P], {},
    { lat: 12.3, lon: -45.6, altitudeKm: 418.2, speedKmh: 27580, visibility: "daylight", time: "2026-10-18T12:00:00.000Z" },
    async () => {
      const r = await getJson<{ latitude: number; longitude: number; altitude: number; velocity: number; visibility: string; timestamp: number }>("https://api.wheretheiss.at/v1/satellites/25544");
      return { lat: r.latitude, lon: r.longitude, altitudeKm: Math.round(r.altitude * 10) / 10, speedKmh: Math.round(r.velocity), visibility: r.visibility, time: new Date(r.timestamp * 1000).toISOString() };
    }),
];
