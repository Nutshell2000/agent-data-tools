import { HttpError } from "../lib/env";

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
export async function weather(latInput?: string, lonInput?: string, hoursInput?: string) {
  const lat = coordinate(latInput, "lat", 90);
  const lon = coordinate(lonInput, "lon", 180);
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
