// Building blocks for endpoint families: one entry = its catalog listing + its implementation.
// Families live in src/routes/{chain-reads,utils,public-data,fun}.ts and are merged into
// ENDPOINTS (endpoints.ts) and TOOLS (tools.ts), which wire the paywall, discovery and MCP.
import type { Endpoint, Param } from "./endpoints";
import { HttpError, type Env } from "./lib/env";

export type Input = (name: string) => string | undefined;

export interface Entry {
  endpoint: Endpoint;
  run: (env: Env, q: Input) => Promise<unknown> | unknown;
}

/** Price for the families: Coinbase's facilitator minimum, the band with the most distinct payers (Peter approved 2026-10-18). */
export const PRICE = "$0.001";

export function entry(
  path: string,
  summary: string,
  description: string,
  tags: string[],
  params: Record<string, Param>,
  outputExample: Record<string, unknown>,
  run: Entry["run"],
  price = PRICE,
): Entry {
  return { endpoint: { path, price, summary, description, tags, params, outputExample }, run };
}

/** Required string input, trimmed, with a length cap. */
export function need(q: Input, name: string, max = 10_000): string {
  const v = q(name);
  if (v === undefined || v.trim() === "") throw new HttpError(400, `${name} is required`);
  if (v.length > max) throw new HttpError(400, `${name} is longer than ${max} characters`);
  return v;
}

/** Optional string input with a length cap. */
export function opt(q: Input, name: string, max = 10_000): string | undefined {
  const v = q(name);
  if (v === undefined || v === "") return undefined;
  if (v.length > max) throw new HttpError(400, `${name} is longer than ${max} characters`);
  return v;
}

/** Number input with range checks; `fallback` makes it optional. */
export function num(q: Input, name: string, { min = -Infinity, max = Infinity, fallback, integer = false }: { min?: number; max?: number; fallback?: number; integer?: boolean } = {}): number {
  const raw = q(name);
  if (raw === undefined || raw.trim() === "") {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${name} is required`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new HttpError(400, `${name} must be ${integer ? "a whole number" : "a number"}${Number.isFinite(min) ? ` from ${min}` : ""}${Number.isFinite(max) ? ` to ${max}` : ""}`);
  }
  return n;
}

/** One of a fixed set of values (case-insensitive). */
export function pick<T extends string>(q: Input, name: string, values: readonly T[], fallback?: T): T {
  const raw = q(name)?.trim().toLowerCase();
  if (!raw) {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${name} is required (one of: ${values.join(", ")})`);
  }
  const hit = values.find((v) => v.toLowerCase() === raw);
  if (!hit) throw new HttpError(400, `${name} must be one of: ${values.join(", ")}`);
  return hit;
}

const UA = { "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)", accept: "application/json" };

/** GET JSON from an outside source. Outside failures become 502 (never charged). */
export async function getJson<T = unknown>(url: string, { timeoutMs = 8000, notFound }: { timeoutMs?: number; notFound?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new HttpError(502, "the data source did not answer in time; try again");
  }
  if (res.status === 404 && notFound) throw new HttpError(404, notFound);
  if (!res.ok) throw new HttpError(502, `the data source answered HTTP ${res.status}; try again`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new HttpError(502, "the data source sent an unreadable answer");
  }
}
