// Public data from free, keyless sources, plus sun and moon times computed locally.
// Outside failures are 502 (not charged); "not found" answers are 404 (not charged).
import { entry, getJson, need, num, opt, pick, type Entry } from "../family";
import { HttpError } from "../lib/env";

const lat = (q: Parameters<Entry["run"]>[1]) => num(q, "lat", { min: -90, max: 90 });
const lon = (q: Parameters<Entry["run"]>[1]) => num(q, "lon", { min: -180, max: 180 });
const LATLON = {
  lat: { type: "number" as const, description: "Latitude (-90 to 90)", required: true, example: 59.33 },
  lon: { type: "number" as const, description: "Longitude (-180 to 180)", required: true, example: 18.07 },
};
const enc = encodeURIComponent;

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
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, "date is not valid");
  return d;
}

const P = ["data"];

export const PUBLIC_DATA: Entry[] = [
  entry("/holidays", "Public holidays by country", "Official public holidays for a country and year: date, local and English name, whether nationwide or regional, and holiday type. 100+ countries by ISO code (Nager.Date). Use for scheduling, delivery dates and business-day maths.",
    ["holidays", "calendar", "date", ...P], { country: { type: "string", description: "ISO 3166-1 alpha-2 code, e.g. SE, US, DE", required: true, example: "SE" }, year: { type: "integer", description: "Year (default this year)", example: 2026 } },
    { country: "SE", year: 2026, count: 16, holidays: [{ date: "2026-01-01", localName: "Nyårsdagen", name: "New Year's Day", nationwide: true, types: ["Public"] }] },
    async (_e, q) => {
      const country = need(q, "country", 2).toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, "country must be a 2-letter ISO code");
      const year = num(q, "year", { min: 1975, max: 2075, fallback: new Date().getUTCFullYear(), integer: true });
      const list = await getJson<Array<{ date: string; localName: string; name: string; global: boolean; counties: string[] | null; types: string[] }>>(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, { notFound: `no holiday data for ${country}` });
      return { country, year, count: list.length, holidays: list.map((h) => ({ date: h.date, localName: h.localName, name: h.name, nationwide: h.global, regions: h.counties, types: h.types })) };
    }),

  entry("/wikipedia", "Wikipedia summary", "Short summary of a Wikipedia article in any language edition: title, one-paragraph extract, description, thumbnail and page URL. Use to ground an agent's answer in a quick, citable fact sheet.",
    ["wikipedia", "knowledge", ...P], { title: { type: "string", description: "Article title", required: true, example: "Stockholm" }, lang: { type: "string", description: "Language code (default en)", example: "en" } },
    { title: "Stockholm", description: "Capital of Sweden", extract: "Stockholm is the capital and most populous city of Sweden…", url: "https://en.wikipedia.org/wiki/Stockholm", thumbnail: "https://upload.wikimedia.org/…" },
    async (_e, q) => {
      const lang = (opt(q, "lang", 12) ?? "en").toLowerCase();
      if (!/^[a-z-]{2,12}$/.test(lang)) throw new HttpError(400, "lang must be a Wikipedia language code like en, sv, de");
      const r = await getJson<{ title: string; description?: string; extract: string; content_urls?: { desktop?: { page?: string } }; thumbnail?: { source: string }; type: string }>(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc(need(q, "title", 300).replace(/ /g, "_"))}`, { notFound: "no article with that title" });
      return { title: r.title, description: r.description ?? null, extract: r.extract, type: r.type, url: r.content_urls?.desktop?.page ?? null, thumbnail: r.thumbnail?.source ?? null };
    }),

  entry("/dictionary", "English dictionary lookup", "Definitions of an English word grouped by part of speech, with phonetic spelling, example sentences, synonyms and antonyms (Free Dictionary API). Use for writing help, vocabulary and word games.",
    ["dictionary", "language", "english", ...P], { word: { type: "string", description: "An English word", required: true, example: "serendipity" } },
    { word: "serendipity", phonetic: "/ˌsɛɹ.ənˈdɪp.ɪ.ti/", meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "An unsought, unintended, and/or unexpected, but fortunate, discovery.", example: null }], synonyms: ["chance"] }] },
    async (_e, q) => {
      const word = need(q, "word", 60).trim().toLowerCase();
      const r = await getJson<Array<{ word: string; phonetic?: string; phonetics?: Array<{ text?: string }>; meanings: Array<{ partOfSpeech: string; definitions: Array<{ definition: string; example?: string }>; synonyms: string[]; antonyms: string[] }> }>>(`https://api.dictionaryapi.dev/api/v2/entries/en/${enc(word)}`, { notFound: "word not found" });
      const first = r[0];
      return { word: first.word, phonetic: first.phonetic ?? first.phonetics?.find((p) => p.text)?.text ?? null, meanings: r.flatMap((e) => e.meanings).slice(0, 8).map((m) => ({ partOfSpeech: m.partOfSpeech, definitions: m.definitions.slice(0, 4).map((d) => ({ definition: d.definition, example: d.example ?? null })), synonyms: m.synonyms.slice(0, 10), antonyms: m.antonyms.slice(0, 10) })) };
    }),

  entry("/earthquakes", "Recent earthquakes", "Recent earthquakes worldwide from the US Geological Survey: magnitude, place, time, depth, coordinates, tsunami flag and USGS link, for the past day or week, filtered by minimum magnitude (2.5, 4.5 or significant).",
    ["earthquakes", "geo", "science", ...P], { period: { type: "string", description: "day (default) or week", example: "day" }, minMagnitude: { type: "string", description: "2.5 (default), 4.5 or significant", example: "4.5" } },
    { period: "day", minMagnitude: "4.5", count: 8, earthquakes: [{ magnitude: 5.1, place: "100 km S of …", time: "2026-10-18T03:12:00.000Z", depthKm: 10, lat: -6.1, lon: 130.2, tsunami: false, url: "https://earthquake.usgs.gov/…" }] },
    async (_e, q) => {
      const period = pick(q, "period", ["day", "week"] as const, "day");
      const mag = pick(q, "minMagnitude", ["2.5", "4.5", "significant"] as const, "2.5");
      const r = await getJson<{ features: Array<{ properties: { mag: number; place: string; time: number; tsunami: number; url: string }; geometry: { coordinates: [number, number, number] } }> }>(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${mag}_${period}.geojson`);
      return { period, minMagnitude: mag, count: r.features.length, earthquakes: r.features.slice(0, 100).map((f) => ({ magnitude: f.properties.mag, place: f.properties.place, time: new Date(f.properties.time).toISOString(), depthKm: f.geometry.coordinates[2], lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], tsunami: f.properties.tsunami === 1, url: f.properties.url })) };
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

  entry("/geocode", "Place name to coordinates", "Find places by name and get their coordinates, country, region, population, elevation and time zone (Open-Meteo geocoding, GeoNames data). Use before weather, sun or air-quality lookups.",
    ["geocode", "geo", "places", ...P], { name: { type: "string", description: "Place name", required: true, example: "Uppsala" }, count: { type: "integer", description: "Max results (1-10, default 5)", example: 3 } },
    { count: 1, results: [{ name: "Uppsala", country: "Sweden", countryCode: "SE", region: "Uppsala", lat: 59.858, lon: 17.645, population: 133117, elevation: 18, timezone: "Europe/Stockholm" }] },
    async (_e, q) => {
      const r = await getJson<{ results?: Array<{ name: string; country: string; country_code: string; admin1?: string; latitude: number; longitude: number; population?: number; elevation?: number; timezone: string }> }>(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(need(q, "name", 100))}&count=${num(q, "count", { min: 1, max: 10, fallback: 5, integer: true })}&language=en&format=json`);
      const list = r.results ?? [];
      return { count: list.length, results: list.map((p) => ({ name: p.name, country: p.country, countryCode: p.country_code, region: p.admin1 ?? null, lat: p.latitude, lon: p.longitude, population: p.population ?? null, elevation: p.elevation ?? null, timezone: p.timezone })) };
    }),

  entry("/elevation", "Elevation of a point", "Ground elevation in metres above sea level for a latitude and longitude (Copernicus 90 m digital elevation model via Open-Meteo).",
    ["elevation", "geo", ...P], LATLON, { lat: 59.33, lon: 18.07, elevationM: 28 },
    async (_e, q) => {
      const la = lat(q), lo = lon(q);
      const r = await getJson<{ elevation: number[] }>(`https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`);
      return { lat: la, lon: lo, elevationM: r.elevation?.[0] ?? null };
    }),

  entry("/sun", "Sunrise, sunset and day length", "Sunrise, sunset, solar noon, civil dawn and dusk (UTC) and day length for any place and date, computed with the standard solar equations; handles polar day and night. No outside service.",
    ["sun", "astronomy", "date", ...P], { ...LATLON, date: { type: "string", description: "Date (default today)", example: "2026-12-21" } },
    { date: "2026-12-21", sunrise: "2026-12-21T07:43:00.000Z", sunset: "2026-12-21T13:48:00.000Z", solarNoon: "2026-12-21T10:45:00.000Z", civilDawn: "2026-12-21T06:58:00.000Z", civilDusk: "2026-12-21T14:33:00.000Z", dayLengthMinutes: 365, polar: null },
    (_e, q) => { const d = dateParam(q); return { date: d.toISOString().slice(0, 10), ...sunTimes(d, lat(q), lon(q)) }; }),

  entry("/moon", "Moon phase", "Moon phase name, illuminated percentage and age in days for any date, plus the next new and full moon (UTC). Computed locally from the mean synodic month.",
    ["moon", "astronomy", "date", ...P], { date: { type: "string", description: "Date or ISO time (default now)", example: "2026-10-18" } },
    { date: "2026-10-18", phase: "Waning Crescent", illuminationPercent: 12.4, ageDays: 26.3, nextNewMoon: "2026-10-21T…", nextFullMoon: "2026-11-05T…" },
    (_e, q) => { const d = dateParam(q); return { date: d.toISOString().slice(0, 10), ...moonPhase(d) }; }),

  entry("/country", "Country facts", "Facts about a country by ISO code (SE, SWE, US…): official World Bank name, ISO-2 and ISO-3 codes, region, income level, capital city and its coordinates, and the latest population figure with its year (World Bank open data).",
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
