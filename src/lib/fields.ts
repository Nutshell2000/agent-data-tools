// `only`: an optional comma-separated list of top-level result keys to keep. Every tool accepts it (smaller
// answers for agents that need one number); the tools that take no other input declare it in their schema, so every
// paid route has an input schema, which directory validators (AgentCash, MPPScan) require for listing.
import type { Param } from "../endpoints";

export const FIELDS_PARAM: Param = {
  type: "string",
  description: "Optional: comma-separated top-level result keys to keep, for a smaller answer (for example only=fastestFee,halfHourFee); unknown keys are ignored and an empty match returns the full result",
  example: "",
};

/** The result reduced to the listed top-level keys; unchanged when `only` is absent or matches nothing. */
export function pickFields<T>(result: T, fields: string | undefined): T {
  if (!fields || !result || typeof result !== "object" || Array.isArray(result)) return result;
  const wanted = fields.split(",").map((k) => k.trim()).filter(Boolean);
  const record = result as Record<string, unknown>;
  const kept = wanted.filter((k) => Object.hasOwn(record, k));
  if (!kept.length) return result;
  return Object.fromEntries(kept.map((k) => [k, record[k]])) as T;
}
