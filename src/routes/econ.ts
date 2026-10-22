// Country economic indicators from a committed World Bank snapshot (src/data/world-bank.generated.ts, built by
// scripts/fetch-world-bank.mjs). Licence: World Bank Open Data, CC BY 4.0, named in every answer. The snapshot, not the
// live API, because api.worldbank.org answered 7-20 s for cold country/indicator pairs on 22 Oct 2026 (a paid call has
// an 8 s budget) and the series change once a year. Demand (Bazaar search, 22 Oct): "gdp", "inflation rate",
// "population", "unemployment rate" and "world bank" each have 2-5 payers at #1 and no listing of ours.
import { entry, need, num, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { WORLD_BANK_COUNTRIES, WORLD_BANK_FETCHED, WORLD_BANK_INDICATOR_NAMES, WORLD_BANK_SERIES } from "../data/world-bank.generated";

const SOURCE = `World Bank Open Data (CC BY 4.0), snapshot ${WORLD_BANK_FETCHED}`;

/** Names agents type that differ from the World Bank's official short names. */
const ALIASES: Record<string, string> = {
  usa: "USA", us: "USA", "united states": "USA", "united states of america": "USA", america: "USA",
  uk: "GBR", "united kingdom": "GBR", britain: "GBR", "great britain": "GBR", england: "GBR",
  "south korea": "KOR", korea: "KOR", "north korea": "PRK", russia: "RUS", iran: "IRN", egypt: "EGY", vietnam: "VNM",
  turkey: "TUR", turkiye: "TUR", "czech republic": "CZE", czechia: "CZE", "ivory coast": "CIV", "cote d'ivoire": "CIV",
  venezuela: "VEN", syria: "SYR", laos: "LAO", bolivia: "BOL", tanzania: "TZA", congo: "COD", "dr congo": "COD",
  "democratic republic of the congo": "COD", "republic of the congo": "COG", gambia: "GMB", bahamas: "BHS",
  slovakia: "SVK", kyrgyzstan: "KGZ", yemen: "YEM", "hong kong": "HKG", macao: "MAC", macau: "MAC", brunei: "BRN",
  micronesia: "FSM", "saint lucia": "LCA", "st lucia": "LCA", "saint kitts and nevis": "KNA", "st kitts and nevis": "KNA",
  "saint vincent and the grenadines": "VCT", taiwan: "TWN", netherlands: "NLD", "the netherlands": "NLD", holland: "NLD",
  "cape verde": "CPV", eswatini: "SWZ", swaziland: "SWZ", myanmar: "MMR", burma: "MMR", "east timor": "TLS", "timor-leste": "TLS",
  "sao tome and principe": "STP", "são tomé and príncipe": "STP", curacao: "CUW", "west bank and gaza": "PSE", palestine: "PSE",
  "united arab emirates": "ARE", uae: "ARE", "saudi arabia": "SAU", "new zealand": "NZL", "south africa": "ZAF",
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.,']/g, "").replace(/\s+/g, " ").trim();
const BY_NAME = new Map<string, string>();
for (const [code, c] of Object.entries(WORLD_BANK_COUNTRIES)) { BY_NAME.set(norm(c.name), code); BY_NAME.set(c.iso2.toLowerCase(), code); BY_NAME.set(code.toLowerCase(), code); }
for (const [alias, code] of Object.entries(ALIASES)) if (WORLD_BANK_COUNTRIES[code]) BY_NAME.set(norm(alias), code);

/** The ISO3 code for an ISO2/ISO3 code or an English country name; 404 (uncharged) when unknown. */
export function resolveCountry(input: string): string {
  const key = norm(input);
  const code = BY_NAME.get(key) ?? [...BY_NAME.entries()].find(([name]) => name.length > 4 && (name.startsWith(key) || key.startsWith(name)))?.[1];
  if (!code) throw new HttpError(404, `no World Bank country matches "${input}"; use an ISO code such as SE or a name such as Sweden`);
  return code;
}

type Series = { indicator: string; latest: { year: number; value: number } | null; values: { year: number; value: number }[] };
/** The newest `years` values of one indicator for a country, newest first; `latest` is the newest non-missing year. */
export function seriesFor(key: string, code: string, years: number): Series {
  const byYear = WORLD_BANK_SERIES[key]?.[code] ?? {};
  const values = Object.entries(byYear).map(([year, value]) => ({ year: Number(year), value })).sort((a, b) => b.year - a.year).slice(0, years);
  return { indicator: WORLD_BANK_INDICATOR_NAMES[key] ?? key, latest: values[0] ?? null, values };
}

const COUNTRY_PARAM = { country: { type: "string" as const, description: "ISO 3166 code (SE, SWE) or English country name (Sweden)", required: true, example: "SE" } };
const YEARS_PARAM = { years: { type: "integer" as const, description: "Years of history to return, 1-10 (default 5)", example: 5 } };

function countryBlock(code: string) {
  const c = WORLD_BANK_COUNTRIES[code];
  return { code, name: c.name, iso2: c.iso2, region: c.region, incomeLevel: c.income, capital: c.capital };
}

/** One tool per economic question, each named with the phrase buyers search for; all read the same snapshot. */
function econTool(path: string, summary: string, description: string, tags: string[], keys: Record<string, string>, example: Record<string, unknown>): Entry {
  return entry(path, summary, description, tags, { ...COUNTRY_PARAM, ...YEARS_PARAM }, example, async (_e, q) => {
    const code = resolveCountry(need(q, "country", 80));
    const years = num(q, "years", { min: 1, max: 10, fallback: 5, integer: true });
    const out: Record<string, unknown> = { country: countryBlock(code) };
    let any = false;
    for (const [field, key] of Object.entries(keys)) { const s = seriesFor(key, code, years); out[field] = s; any ||= s.latest !== null; }
    if (!any) throw new HttpError(404, `the World Bank has no recent ${summary.split(":")[0].toLowerCase()} data for ${WORLD_BANK_COUNTRIES[code].name}`);
    out.source = SOURCE;
    return out;
  });
}

const SWE = { code: "SWE", name: "Sweden", iso2: "SE", region: "Europe & Central Asia", incomeLevel: "High income", capital: "Stockholm" };

export const ECON: Entry[] = [
  econTool("/econ/gdp", "GDP by country, World Bank data: current US$, real growth and per capita",
    "GDP of any country from World Bank data: GDP in current US dollars, annual real GDP growth in % and GDP per capita in US dollars, for the last 1-10 years with the newest year first. Country by ISO code (SE, SWE) or English name. Read from a committed World Bank Open Data snapshot (CC BY 4.0), so every call answers at once; the snapshot date is in the answer. Use for country comparisons, market sizing and macro context.",
    ["gdp", "economy", "world-bank", "macro", "statistics", "data"],
    { gdp: "gdpUsd", gdpGrowth: "gdpGrowthPct", gdpPerCapita: "gdpPerCapitaUsd" },
    { country: SWE, gdp: { indicator: "GDP (current US$)", latest: { year: 2025, value: 668998664082.08 }, values: [{ year: 2025, value: 668998664082.08 }] },
      gdpGrowth: { indicator: "GDP growth (annual %)", latest: { year: 2025, value: 1.2 }, values: [{ year: 2025, value: 1.2 }] },
      gdpPerCapita: { indicator: "GDP per capita (current US$)", latest: { year: 2025, value: 63133.5 }, values: [{ year: 2025, value: 63133.5 }] }, source: SOURCE }),
  econTool("/econ/inflation", "Inflation rate by country: consumer prices, annual % (World Bank)",
    "Inflation rate of any country: annual % change in consumer prices (CPI) from World Bank data, for the last 1-10 years with the newest year first. Country by ISO code (SE, SWE) or English name. Read from a committed World Bank Open Data snapshot (CC BY 4.0), so every call answers at once; the snapshot date is in the answer. Use for real-return, pricing and macro questions.",
    ["inflation", "cpi", "economy", "world-bank", "macro", "data"],
    { inflation: "inflationPct" },
    { country: SWE, inflation: { indicator: "Inflation, consumer prices (annual %)", latest: { year: 2025, value: 0.68 }, values: [{ year: 2025, value: 0.68 }, { year: 2024, value: 2.84 }] }, source: SOURCE }),
  econTool("/econ/population", "Population by country: total, growth and urban share (World Bank)",
    "Population of any country from World Bank data: total population, annual population growth in % and the urban share of the population in %, for the last 1-10 years with the newest year first. Country by ISO code (SE, SWE) or English name. Read from a committed World Bank Open Data snapshot (CC BY 4.0), so every call answers at once; the snapshot date is in the answer. Use for market sizing, per-capita figures and demographics.",
    ["population", "demographics", "world-bank", "statistics", "country", "data"],
    { population: "population", populationGrowth: "populationGrowthPct", urbanShare: "urbanPct" },
    { country: SWE, population: { indicator: "Population, total", latest: { year: 2025, value: 10596620 }, values: [{ year: 2025, value: 10596620 }] },
      populationGrowth: { indicator: "Population growth (annual %)", latest: { year: 2025, value: 0.25 }, values: [{ year: 2025, value: 0.25 }] },
      urbanShare: { indicator: "Urban population (% of total population)", latest: { year: 2025, value: 89.0 }, values: [{ year: 2025, value: 89.0 }] }, source: SOURCE }),
  econTool("/econ/unemployment", "Unemployment rate by country: total and youth, % of labour force (World Bank)",
    "Unemployment rate of any country from World Bank data (ILO modelled estimates): total unemployment and youth unemployment (ages 15-24) as % of the labour force, for the last 1-10 years with the newest year first. Country by ISO code (SE, SWE) or English name. Read from a committed World Bank Open Data snapshot (CC BY 4.0), so every call answers at once; the snapshot date is in the answer. Use for labour-market and macro questions.",
    ["unemployment", "labour", "economy", "world-bank", "macro", "data"],
    { unemployment: "unemploymentPct", youthUnemployment: "youthUnemploymentPct" },
    { country: SWE, unemployment: { indicator: "Unemployment, total (% of total labor force) (modeled ILO estimate)", latest: { year: 2025, value: 8.69 }, values: [{ year: 2025, value: 8.69 }] },
      youthUnemployment: { indicator: "Unemployment, youth total (% of total labor force ages 15-24) (modeled ILO estimate)", latest: { year: 2025, value: 24.1 }, values: [{ year: 2025, value: 24.1 }] }, source: SOURCE }),
];
