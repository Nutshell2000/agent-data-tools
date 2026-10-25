// Crypto Fear & Greed Index (1.55.0). Bazaar search on 24 Oct 2026: "fear and greed" 64 summed payers over the top 20,
// no listing of ours. Source: alternative.me, whose page allows commercial use "as long as the attribution is given",
// placed next to each display of the data; every answer therefore carries `source` and `attribution`. Never present it
// as alternative.me's own service. The index updates once a day, so answers are cached at the edge for 10 minutes.
import { entry, num, type Entry } from "../family";
import { HttpError } from "../lib/env";

const ATTRIBUTION = "Crypto Fear & Greed Index by alternative.me (https://alternative.me/crypto/fear-and-greed-index/)";
type Row = { value: string; value_classification: string; timestamp: string; time_until_update?: string };

export function summarise(rows: Row[], days = rows.length) {
  const points = rows.map((r) => ({ date: new Date(Number(r.timestamp) * 1000).toISOString().slice(0, 10), value: Number(r.value), classification: r.value_classification }));
  if (!points.length || points.some((p) => !Number.isFinite(p.value))) throw new HttpError(502, "the index source returned no usable data; try again");
  const now = points[0];
  const shown = points.slice(0, days);
  const values = shown.map((p) => p.value);
  const at = (days: number) => points[days]?.value ?? null;
  const delta = (days: number) => (at(days) === null ? null : now.value - at(days)!);
  return {
    value: now.value, classification: now.classification, date: now.date,
    change: { vs1d: delta(1), vs7d: delta(7), vs30d: delta(30) },
    range: { low: Math.min(...values), high: Math.max(...values), average: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10, days: values.length },
    nextUpdateSeconds: rows[0].time_until_update ? Number(rows[0].time_until_update) : null,
    history: shown,
  };
}

export const FEAR_GREED: Entry[] = [
  entry("/crypto/fear-greed", "Fear and greed index, crypto: today's value and history",
    "The Crypto Fear & Greed Index (0 = extreme fear, 100 = extreme greed) from alternative.me: today's value and label, the change against 1, 7 and 30 days ago, the low, high and average over the window, and the daily history (up to 90 days, default 30). Updated once a day. Use as a market-sentiment input for a trading agent, a dashboard or a daily brief; for live prices use price_token.",
    ["fear-and-greed", "crypto-sentiment", "market-sentiment", "crypto", "bitcoin", "data"], {
      days: { type: "integer", description: "Days of history, 1-90 (default 30)", example: 30 },
    },
    { value: 51, classification: "Neutral", date: "2026-10-24", change: { vs1d: 1, vs7d: -17, vs30d: 9 }, range: { low: 38, high: 72, average: 54.2, days: 30 }, nextUpdateSeconds: 62493, history: [{ date: "2026-10-24", value: 51, classification: "Neutral" }], source: "alternative.me", attribution: ATTRIBUTION },
    async (_e, q) => {
      const days = num(q, "days", { min: 1, max: 90, fallback: 30, integer: true });
      // At least 31 days so the 30-day change is known; the history is trimmed back to `days`.
      const url = `https://api.alternative.me/fng/?limit=${Math.max(days, 31)}`;
      const cache = typeof caches !== "undefined" ? (caches as unknown as { default: Cache }).default : undefined;
      let res = cache ? await cache.match(url).catch(() => undefined) : undefined;
      if (!res) {
        try { res = await fetch(url, { headers: { accept: "application/json", "user-agent": "AgentDataTools/1.0" }, signal: AbortSignal.timeout(8000) }); }
        catch { throw new HttpError(502, "the index source did not answer in time; try again"); }
        if (!res.ok) throw new HttpError(502, `the index source answered HTTP ${res.status}; try again`);
        if (cache) { const copy = new Response(await res.clone().arrayBuffer(), { headers: { "content-type": "application/json", "cache-control": "max-age=600" } }); await cache.put(url, copy).catch(() => undefined); }
      }
      const body = (await res.json()) as { data?: Row[]; metadata?: { error?: string | null } };
      if (body.metadata?.error) throw new HttpError(502, "the index source reported an error; try again");
      return { ...summarise(body.data ?? [], days), source: "alternative.me", attribution: ATTRIBUTION };
    }),
];
