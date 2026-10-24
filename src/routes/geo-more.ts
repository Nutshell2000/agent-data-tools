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
export function sparqlAround(lat: number, lon: number, radiusKm: number, limit: number) {
  return `SELECT ?place ?placeLabel ?placeDescription ?dist ?pop ?countryLabel ?iso ?adminLabel WHERE {
  SERVICE wikibase:around { ?place wdt:P625 ?loc . bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" . bd:serviceParam wikibase:distance ?dist . }
  ?place wdt:P1082 ?pop .
  OPTIONAL { ?place wdt:P17 ?country . ?country wdt:P297 ?iso . }
  OPTIONAL { ?place wdt:P131 ?admin . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGUAGES}" . }
} ORDER BY ?dist LIMIT ${limit}`;
}
export function shapePlaces(rows: Binding[]) {
  const seen = new Set<string>();
  const places = [];
  for (const r of rows) {
    const id = r.place?.value.split("/").pop() ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    places.push({
      // The label service answers a bare id when an item has no label in any listed language: no name beats a fake one.
      name: r.placeLabel?.value && !/^Q\d+$/.test(r.placeLabel.value) ? r.placeLabel.value : null, description: r.placeDescription?.value ?? null, distanceKm: Math.round(Number(r.dist?.value ?? 0) * 100) / 100,
      population: r.pop ? Math.round(Number(r.pop.value)) : null, region: r.adminLabel?.value ?? null, country: r.countryLabel?.value ?? null,
      countryCode: r.iso?.value ?? null, wikidataId: id,
    });
  }
  // The most populous place nearby is usually the town or city the point is in; the nearest may be a parish or district.
  // Administrative areas (municipality, county, parish…) often hold the largest population figure, so they are skipped
  // when a settlement is available.
  const admin = /municipality|county|province|parish|district|region|state of|prefecture|oblast|kommun|commune|department/i;
  const settlements = places.filter((p) => !admin.test(`${p.name} ${p.description ?? ""}`));
  const largest = (settlements.length ? settlements : places).reduce<(typeof places)[number] | null>((best, p) => ((p.population ?? 0) > (best?.population ?? -1) ? p : best), null);
  return { nearest: places.find((p) => p.name) ?? places[0] ?? null, largest, places };
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
      const url = `${WDQS}?format=json&query=${encodeURIComponent(sparqlAround(rl, ro, radius, 25))}`;
      const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : undefined;
      let res = cache ? await cache.match(url).catch(() => undefined) : undefined;
      if (!res) {
        try { res = await fetch(url, { headers: { accept: "application/sparql-results+json", "user-agent": "AgentDataTools/1.0 (https://agent-data-tools.revmesh2074.workers.dev; reverse geocoding)" }, signal: AbortSignal.timeout(9_000) }); }
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

  entry("/pack/coin-research", "Crypto coin research pack: price, funding, depth, signals",
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
    }, "$0.03"),
];
