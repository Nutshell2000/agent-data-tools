// Wikidata reads shared by /company and /geocode. Wikidata's structured data is CC0.
import { getJson } from "../family";

export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

export interface Snak { datavalue?: { value: unknown } }
export interface Claim { rank?: string; mainsnak: Snak; qualifiers?: Record<string, Snak[]> }
export interface Entity {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Claim[]>;
  sitelinks?: Record<string, { title: string }>;
}

/** Statements of a property, preferred rank first, deprecated ones dropped. */
export function statements(e: Entity, prop: string): Claim[] {
  const all = (e.claims?.[prop] ?? []).filter((c) => c.rank !== "deprecated" && c.mainsnak.datavalue);
  const preferred = all.filter((c) => c.rank === "preferred");
  return preferred.length ? preferred : all;
}
export const itemIds = (e: Entity, prop: string) => statements(e, prop).map((c) => (c.mainsnak.datavalue!.value as { id: string }).id);
export const firstString = (e: Entity, prop: string) => {
  const v = statements(e, prop)[0]?.mainsnak.datavalue?.value;
  return typeof v === "string" ? v : null;
};
/** Year, year-month or full date, as precise as the statement is. */
export function firstDate(e: Entity, prop: string): string | null {
  const v = statements(e, prop)[0]?.mainsnak.datavalue?.value as { time?: string; precision?: number } | undefined;
  const m = v?.time?.match(/^\+?(-?\d{1,6})-(\d\d)-(\d\d)/);
  if (!m) return null;
  return (v!.precision ?? 11) >= 11 ? `${m[1]}-${m[2]}-${m[3]}` : v!.precision === 10 ? `${m[1]}-${m[2]}` : m[1];
}
export function firstQuantity(e: Entity, prop: string): number | null {
  const amount = (statements(e, prop)[0]?.mainsnak.datavalue?.value as { amount?: string } | undefined)?.amount;
  const n = amount === undefined ? NaN : Number(amount);
  return Number.isFinite(n) ? n : null;
}

/** Item IDs matching a search, best first. */
export async function searchItems(text: string, limit: number): Promise<string[]> {
  const found = await getJson<{ search?: { id: string }[] }>(
    `${WIKIDATA_API}?action=wbsearchentities&format=json&language=en&uselang=en&type=item&limit=${limit}&search=${encodeURIComponent(text)}`,
  );
  return (found.search ?? []).map((s) => s.id);
}

/** Entities with English labels, descriptions, claims and the English Wikipedia link. */
export async function getEntities(ids: string[]): Promise<Record<string, Entity>> {
  const got = await getJson<{ entities?: Record<string, Entity> }>(
    `${WIKIDATA_API}?action=wbgetentities&format=json&languages=en&props=labels|descriptions|claims|sitelinks&sitefilter=enwiki&ids=${ids.join("|")}`,
  );
  return got.entities ?? {};
}

/** English labels of linked items, at most 50 per call. */
export async function labelsOf(ids: string[]): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  if (!ids.length) return labels;
  const lab = await getJson<{ entities?: Record<string, Entity> }>(
    `${WIKIDATA_API}?action=wbgetentities&format=json&languages=en&props=labels&ids=${[...new Set(ids)].slice(0, 50).join("|")}`,
  );
  for (const [id, e] of Object.entries(lab.entities ?? {})) if (e.labels?.en) labels[id] = e.labels.en.value;
  return labels;
}
