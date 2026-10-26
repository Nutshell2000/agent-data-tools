import { HttpError } from "../lib/env";
import { placeCoordinates } from "../lib/wikidata";
import { countryCode } from "../lib/country-code";

// MET Norway asks callers to identify themselves and to reuse answers instead of asking again.
const HEADERS = { "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)" };
const CACHE_SECONDS = 900;

interface Step {
  time: string;
  data: {
    instant: { details: Record<string, number> };
    next_1_hours?: { summary: { symbol_code: string }; details: { precipitation_amount?: number } };
    next_6_hours?: { summary: { symbol_code: string }; details: { precipitation_amount?: number } };
  };
}

const coordinate = (value: string | undefined, name: string, limit: number) => {
  const n = Number(value);
  if (value === undefined || value.trim() === "" || !Number.isFinite(n) || Math.abs(n) > limit) {
    throw new HttpError(400, `${name} must be a number between -${limit} and ${limit}`);
  }
  // Two decimals is about one kilometre, the resolution of the forecast itself.
  return Math.round(n * 100) / 100;
};

function point(step: Step) {
  const d = step.data.instant.details;
  const next = step.data.next_1_hours ?? step.data.next_6_hours;
  return {
    time: step.time,
    temperatureC: d.air_temperature,
    // Symbol names such as clearsky_day, partlycloudy_night, rain, heavysnow.
    conditions: next?.summary.symbol_code ?? null,
    precipitationMm: next?.details.precipitation_amount ?? null,
    windSpeedMs: d.wind_speed,
    windFromDegrees: d.wind_from_direction,
    humidityPercent: d.relative_humidity,
    cloudCoverPercent: d.cloud_area_fraction,
    pressureHpa: d.air_pressure_at_sea_level,
  };
}

/** Current weather and an hourly forecast for a point on Earth. */
/** Major cities by name, so the common lookups (and the published example) need no Wikidata call. */
export const CITIES: Record<string, [string, number, number]> = Object.fromEntries(([
  ["London", 51.5074, -0.1278], ["New York", 40.7128, -74.006], ["Tokyo", 35.6762, 139.6503], ["Paris", 48.8566, 2.3522],
  ["Berlin", 52.52, 13.405], ["Stockholm", 59.3293, 18.0686], ["San Francisco", 37.7749, -122.4194], ["Los Angeles", 34.0522, -118.2437],
  ["Chicago", 41.8781, -87.6298], ["Singapore", 1.3521, 103.8198], ["Hong Kong", 22.3193, 114.1694], ["Sydney", -33.8688, 151.2093],
  ["Dubai", 25.2048, 55.2708], ["Toronto", 43.6532, -79.3832], ["Madrid", 40.4168, -3.7038], ["Rome", 41.9028, 12.4964],
  ["Amsterdam", 52.3676, 4.9041], ["Seoul", 37.5665, 126.978], ["Mumbai", 19.076, 72.8777], ["São Paulo", -23.5505, -46.6333],
  ["Mexico City", 19.4326, -99.1332], ["Istanbul", 41.0082, 28.9784], ["Beijing", 39.9042, 116.4074], ["Shanghai", 31.2304, 121.4737],
  ["Bangkok", 13.7563, 100.5018], ["Cairo", 30.0444, 31.2357], ["Lagos", 6.5244, 3.3792], ["Johannesburg", -26.2041, 28.0473],
  ["Buenos Aires", -34.6037, -58.3816], ["Miami", 25.7617, -80.1918], ["Seattle", 47.6062, -122.3321], ["Boston", 42.3601, -71.0589],
  ["Washington", 38.9072, -77.0369], ["Oslo", 59.9139, 10.7522], ["Copenhagen", 55.6761, 12.5683], ["Helsinki", 60.1699, 24.9384],
  ["Zurich", 47.3769, 8.5417], ["Vienna", 48.2082, 16.3738], ["Dublin", 53.3498, -6.2603], ["Lisbon", 38.7223, -9.1393],
  ["Barcelona", 41.3874, 2.1686], ["Warsaw", 52.2297, 21.0122], ["Austin", 30.2672, -97.7431], ["Denver", 39.7392, -104.9903],
  ["Vancouver", 49.2827, -123.1207], ["Melbourne", -37.8136, 144.9631], ["Delhi", 28.7041, 77.1025], ["Bangalore", 12.9716, 77.5946],
  ["Jakarta", -6.2088, 106.8456], ["Uppsala", 59.8586, 17.6389],
] as [string, number, number][]).map(([name, lat, lon]) => [name.toLowerCase(), [name, lat, lon]]));

/** A city's coordinates: the built-in table first, then Wikidata's best match. */
async function cityCoordinates(city: string) {
  const tidy = city.toLowerCase().replace(/\s+/g, " ").trim();
  const bare = tidy.replace(/,.*$/, "").trim();
  const known = Object.hasOwn(CITIES, bare) ? CITIES[bare] : undefined;
  // "Paris, TX" must not become Paris, France: a qualifier that is not a country (a state or region) sends the whole
  // phrase to Wikidata first (it finds "Paris, Texas"). A country qualifier ("London, UK", "Stockholm, Sweden") keeps
  // the table's answer without a network call; Wikidata finds nothing for "Stockholm, Sweden" anyway.
  const qualifier = bare !== tidy ? tidy.slice(bare.length + 1).trim() : "";
  if (qualifier && (!known || !countryCode(qualifier))) {
    const qualified = await placeCoordinates(city).catch(() => null);
    if (qualified) return qualified;
  }
  return known ? { name: known[0], lat: known[1], lon: known[2] } : placeCoordinates(bare === tidy ? city : bare);
}

export async function weather(latInput?: string, lonInput?: string, hoursInput?: string, cityInput?: string) {
  // A city name stands in for coordinates (Wikidata's best match); explicit lat/lon win when both are given.
  const city = cityInput?.trim();
  const place = city && (latInput ?? "").trim() === "" && (lonInput ?? "").trim() === ""
    ? await cityCoordinates(city.slice(0, 100)).then((p) => p ?? Promise.reject(new HttpError(404, `no place with coordinates found for "${city.slice(0, 100)}"; pass lat and lon`)))
    : null;
  if (!place && !city && !(latInput ?? "").trim() && !(lonInput ?? "").trim()) {
    throw new HttpError(400, "send city (for example city=London) or lat and lon (for example lat=59.33&lon=18.07)");
  }
  const lat = place ? place.lat : coordinate(latInput, "lat", 90);
  const lon = place ? place.lon : coordinate(lonInput, "lon", 180);
  const hours = Math.min(Math.max(Math.trunc(Number(hoursInput)) || 12, 1), 48);

  let res: Response;
  try {
    res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, {
      signal: AbortSignal.timeout(8_000),
      headers: HEADERS,
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
  } catch {
    throw new HttpError(502, "the weather data source did not respond");
  }
  if (!res.ok) throw new HttpError(502, `the weather data source returned HTTP ${res.status}`);
  const body = (await res.json()) as {
    geometry: { coordinates: number[] };
    properties: { meta: { updated_at: string }; timeseries: Step[] };
  };
  const steps = body.properties.timeseries;
  if (!steps?.length) throw new HttpError(502, "the weather data source returned no forecast");

  return {
    ...(place ? { place: place.name } : {}),
    latitude: lat,
    longitude: lon,
    elevationM: body.geometry.coordinates[2] ?? null,
    current: point(steps[0]),
    // Hourly steps; times are UTC.
    forecast: steps.slice(1, hours + 1).map(point),
    forecastUpdatedAt: body.properties.meta.updated_at,
    source: "MET Norway (api.met.no), licensed CC BY 4.0",
    checkedAt: new Date().toISOString(),
  };
}
