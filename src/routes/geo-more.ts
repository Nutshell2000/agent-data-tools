// Reverse geocoding and a single-coin research pack (1.63.0). Bazaar search on 24 Oct 2026, summed 30-day payers over the
// top 20: reverse geocoding 48 (ours was #10 with a forward-only tool), token research 26, crypto research 14.
// Reverse geocoding asks the Wikidata Query Service (CC0 data) for populated places around a point; answers are cached at
// the edge for a day per rounded point because the service is shared and slow when cold (about 2 s, then 0.2 s).
import { entry, num, opt, type Entry } from "../family";
import { HttpError } from "../lib/env";
import { call, runSections } from "./packs";

const WDQS = "https://query.wikidata.org/sparql";
type Binding = Record<string, { value: string } | undefined>;
/**
 * English first, then the multilingual label and widely used languages: a small place with no English label came back
 * named by its bare Wikidata id (Q65194616, a Swedish locality, 24 Oct 2026).
 */
const LABEL_LANGUAGES = "en,mul,sv,no,da,fi,de,fr,es,it,nl,pt,pl,cs,ru,uk,tr,ar,ja,zh,ko,hi,id,vi";
/**
 * Wikidata classes that mark a town or city (city, big city, capital, human settlement, town, village, million city,
 * metropolis, global city, city in the United States and similar). Population alone let dioceses, eparchies and
 * historical states win "largest" (11 Nov 2026 audit: New York returned an Armenian Catholic eparchy of 342 million
 * people, Paris the First French Empire).
 */
export const SETTLEMENT_CLASSES = ["Q515", "Q1549591", "Q5119", "Q486972", "Q3957", "Q532", "Q1637706", "Q200250", "Q208511", "Q1093829", "Q484170", "Q15284", "Q123705", "Q2154459",
  // Swedish urban area and minor locality, locality, hamlet, US census-designated place and unincorporated community.
  "Q12813115", "Q14839548", "Q3257686", "Q5084", "Q498162", "Q17343829"];
export function sparqlAround(lat: number, lon: number, radiusKm: number, limit: number) {
  return `SELECT ?place ?placeLabel ?placeDescription ?dist ?pop ?countryLabel ?iso ?adminLabel ?settled ?ended WHERE {
  SERVICE wikibase:around { ?place wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" . bd:serviceParam wikibase:distance ?dist . }
  ?place wdt:P1082 ?pop .
  OPTIONAL { ?place wdt:P17 ?country . ?country wdt:P297 ?iso . }
  OPTIONAL { ?place wdt:P131 ?admin . }
  OPTIONAL { ?place wdt:P31 ?settled . VALUES ?settled { ${SETTLEMENT_CLASSES.map((q) => `wd:${q}`).join(" ")} } }
  OPTIONAL { ?place wdt:P576 ?ended . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGUAGES}" . }
} ORDER BY ?dist LIMIT ${limit}`;
}
/** Items that carry a population but are not places a person would name as where a point is. */
const NOT_A_PLACE_TEXT = /\b(eparchy|diocese|archdiocese|archeparchy|exarchate|parish|församling|socken|pfarrei|paroisse|parroquia|assembly|congregation|church|cathedral|census division|statistical|electoral|constituency|empire|kingdom of|dynasty)\b/i;
/** Area words count in the name only: Swedish towns are described as "urban area in … Municipality". */
const NOT_A_PLACE_NAME = /\b(metropolitan area|urban area|conurbation|agglomeration|metropolitan region)\b/i;
const NOT_A_PLACE = { test: (s: string) => NOT_A_PLACE_TEXT.test(s) || NOT_A_PLACE_NAME.test(s.split("\u0000")[0]) };
export function shapePlaces(rows: Binding[]) {
  const seen = new Set<string>();
  const idOf = (r: Binding) => r.place?.value.split("/").pop() ?? "";
  const settledIds = new Set(rows.filter((r) => r.settled?.value).map(idOf));
  // Dissolved or abolished items (P576: historical states, merged municipalities) are not where a point is today. As an
  // OPTIONAL rather than FILTER NOT EXISTS: the filter made dense cities time out (Paris over 25 s on 11 Nov 2026).
  const endedIds = new Set(rows.filter((r) => r.ended?.value).map(idOf));
  const places: {
    name: string | null; description: string | null; distanceKm: number; population: number | null; region: string | null;
    country: string | null; countryCode: string | null; wikidataId: string; settlement: boolean;
  }[] = [];
  for (const r of rows) {
    const id = idOf(r);
    if (!id || seen.has(id) || endedIds.has(id)) continue;
    seen.add(id);
    places.push({
      // The label service answers a bare id when an item has no label in any listed language: no name beats a fake one.
      name: r.placeLabel?.value && !/^Q\d+$/.test(r.placeLabel.value) ? r.placeLabel.value : null, description: r.placeDescription?.value ?? null, distanceKm: Math.round(Number(r.dist?.value ?? 0) * 100) / 100,
      population: r.pop ? Math.round(Number(r.pop.value)) : null, region: r.adminLabel?.value ?? null, country: r.countryLabel?.value ?? null,
      countryCode: r.iso?.value ?? null, wikidataId: id, settlement: settledIds.has(id),
    });
  }
  // The most populous place nearby is usually the town or city the point is in; the nearest may be a parish or district.
  // Administrative areas (municipality, county, parish…) often hold the largest population figure, so they are skipped
  // when a settlement is available.
  // Items typed as a town or city win; without one, administrative areas, dioceses, urban areas and the like are skipped.
  const admin = /municipality|county|province|parish|district|region|state of|prefecture|oblast|kommun|commune|department/i;
  const text = (p: (typeof places)[number]) => `${p.name}\u0000 ${p.description ?? ""}`;
  const typed = places.filter((p) => p.settlement && !NOT_A_PLACE.test(text(p)));
  const plain = places.filter((p) => !admin.test(text(p)) && !NOT_A_PLACE.test(text(p)));
  const pool = typed.length ? typed : plain.length ? plain : places;
  const largest = pool.reduce<(typeof places)[number] | null>((best, p) => ((p.population ?? 0) > (best?.population ?? -1) ? p : best), null);
  const named = places.filter((p) => p.name);
  const nearest = named.find((p) => !NOT_A_PLACE.test(text(p))) ?? named[0] ?? places[0] ?? null;
  return { nearest, largest, places };
}

export const GEO_MORE: Entry[] = [
  entry("/geocode/reverse", "Reverse geocoding: place name from coordinates",
    "Turn latitude and longitude into place names: the nearest populated place and the largest one within the radius (usually the town or city the point is in), with country and ISO code, administrative region, population, distance and Wikidata id, plus the other places nearby. Data from Wikidata (CC0). Use to label GPS points, photos, deliveries or IP-derived coordinates; for place name to coordinates use geocode.",
    ["reverse-geocoding", "geocoding", "geo", "places", "coordinates", "data"], {
      lat: { type: "number", description: "Latitude (-90 to 90)", required: true, example: 59.3293 },
      lon: { type: "number", description: "Longitude (-180 to 180)", required: true, example: 18.0686 },
      radius: { type: "number", description: "Search radius in km, 1-50 (default 10)", example: 10 },
    },
    { lat: 59.3293, lon: 18.0686, radiusKm: 10, nearest: { name: "Stockholm", description: "capital and largest city of Sweden", distanceKm: 0.02, population: 984748, region: "Stockholm Municipality", country: "Sweden", countryCode: "SE", wikidataId: "Q1754" }, largest: { name: "Stockholm", population: 984748, distanceKm: 0.02 }, places: [{ name: "Stockholm", distanceKm: 0.02, population: 984748 }], source: "Wikidata (CC0)" },
    async (_e, q) => {
      const lat = num(q, "lat", { min: -90, max: 90 }), lon = num(q, "lon", { min: -180, max: 180 });
      const radius = num(q, "radius", { min: 1, max: 50, fallback: 10 });
      // Round to about 100 m so nearby points share a cache entry.
      const rl = Math.round(lat * 1000) / 1000, ro = Math.round(lon * 1000) / 1000;
      const url = `${WDQS}?format=json&query=${encodeURIComponent(sparqlAround(rl, ro, radius, 80))}`;
      const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : undefined;
      let res = cache ? await cache.match(url).catch(() => undefined) : undefined;
      if (!res) {
        try { res = await fetch(url, { headers: { accept: "application/sparql-results+json", "user-agent": "AgentDataTools/1.0 (https://agent-data-tools.revmesh2074.workers.dev; reverse geocoding)" }, signal: AbortSignal.timeout(12_000) }); }
        catch { throw new HttpError(502, "Wikidata did not answer in time; try again"); }
        if (res.status === 429) throw new HttpError(502, "Wikidata is rate-limiting; try again shortly");
        if (!res.ok) throw new HttpError(502, `Wikidata answered HTTP ${res.status}; try again`);
        if (cache) { const copy = new Response(await res.clone().arrayBuffer(), { headers: { "content-type": "application/json", "cache-control": "max-age=86400" } }); await cache.put(url, copy).catch(() => undefined); }
      }
      const body = (await res.json()) as { results?: { bindings?: Binding[] } };
      const shaped = shapePlaces(body.results?.bindings ?? []);
      if (!shaped.nearest) throw new HttpError(404, `no populated place within ${radius} km; try a larger radius`);
      return { lat, lon, radiusKm: radius, ...shaped, places: shaped.places.slice(0, 10), source: "Wikidata (CC0)" };
    }),

  entry("/pack/coin-research", "Coin research, crypto research: price, funding, depth, signals",
    "One call to research a single coin traded on Hyperliquid (BTC, ETH, SOL, HYPE and about 200 more): price, 24-hour change, volume and open interest, the funding rate now and over the last 3 days, order-book depth and spread, technical readings on the 4-hour and daily charts (RSI, MACD, moving averages, Bollinger, volatility), and market-wide sentiment (Fear & Greed, attributed). Use before a trade or for a coin brief.",
    ["crypto-research", "token-research", "coin", "pack", "crypto", "trading"], { coin: { type: "string", description: "Coin symbol such as BTC, ETH, SOL or HYPE (default BTC)", example: "ETH" } },
    { pack: "coin-research", coin: "ETH", market: { markPx: 2380.5, change24hPct: -0.9, dayVolumeUsd: 531266943, openInterestUsd: 2562637002, fundingAprPct: 3.38 }, funding3d: { averageAprPct: 8.15 }, depth: { spreadBps: 0.42, bidDepthUsd: 1200000, askDepthUsd: 980000 }, signals: { "4h": { rsi14: 40.8, readings: ["RSI neutral (30-70)"] }, "1d": { rsi14: 45.1, readings: ["price below SMA 200"] } }, sentiment: { value: 51, classification: "Neutral" }, failed: {} },
    async (env, q) => {
      const coin = (opt(q, "coin", 20) ?? "BTC").toUpperCase();
      const { data, failed } = await runSections({
        market: call(env, "/hyperliquid/market", { coin }),
        funding: call(env, "/hyperliquid/funding-history", { coin, hours: 72 }),
        depth: call(env, "/hyperliquid/orderbook", { coin, levels: 20 }),
        h4: call(env, "/hyperliquid/indicators", { coin, interval: "4h" }),
        d1: call(env, "/hyperliquid/indicators", { coin, interval: "1d" }),
        sentiment: call(env, "/crypto/fear-greed", { days: 8 }),
      });
      if (!data.market && /no Hyperliquid perpetual/.test(failed.market ?? "")) throw new HttpError(404, failed.market!);
      const m = (data.market as { markets?: Record<string, unknown>[] } | undefined)?.markets?.[0];
      const f = data.funding as { averageAprPct?: number; averageRateHourly?: number } | undefined;
      const d = data.depth as Record<string, unknown> | undefined;
      const sig = (x: unknown) => x ? Object.fromEntries(["close", "rsi14", "macd", "sma", "bollinger", "atr14", "realizedVolPct", "readings"].map((k) => [k, (x as Record<string, unknown>)[k]])) : null;
      const s = data.sentiment as { value?: number; classification?: string; attribution?: string } | undefined;
      return {
        pack: "coin-research", coin,
        market: m ? Object.fromEntries(["markPx", "change24hPct", "dayVolumeUsd", "openInterestUsd", "fundingAprPct", "premium", "maxLeverage"].map((k) => [k, m[k]])) : null,
        funding3d: f ? { averageAprPct: f.averageAprPct, averageRateHourly: f.averageRateHourly } : null,
        depth: d ? { mid: d.mid, spreadBps: d.spreadBps, bidDepthUsd: d.bidDepthUsd, askDepthUsd: d.askDepthUsd } : null,
        signals: { "4h": sig(data.h4), "1d": sig(data.d1) },
        sentiment: s ? { value: s.value, classification: s.classification, attribution: s.attribution } : null, failed,
      };
    }, "$0.01"),
];
