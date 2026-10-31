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
export const PRICE = "$0.01";
/** Price test until 14 Nov 2026 (owner, 31 Oct): half of shopper spend is above one cent, and the sweeper the one-cent cap served is gone. */
export const PACK_PRICE = "$0.03";

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
/** Short inputs (codes, names, addresses: max 500 or less) are trimmed; longer free text is kept exactly as sent. */
const tidy = (v: string, max: number) => (max <= 500 ? v.trim() : v);

export function need(q: Input, name: string, max = 10_000): string {
  const raw = q(name);
  if (raw === undefined || raw.trim() === "") throw new HttpError(400, `${name} is required`);
  const v = tidy(raw, max);
  if (v.length > max) throw new HttpError(400, `${name} is longer than ${max} characters`);
  return v;
}

/** Optional string input with a length cap. */
export function opt(q: Input, name: string, max = 10_000): string | undefined {
  const raw = q(name);
  if (raw === undefined || raw === "") return undefined;
  const v = tidy(raw, max);
  if (v === "") return undefined;
  if (v.length > max) throw new HttpError(400, `${name} is longer than ${max} characters`);
  return v;
}

/** A yes/no input: true, 1, yes or on, in any case. */
export const flag = (q: Input, name: string) => /^(true|1|yes|on)$/i.test(q(name)?.trim() ?? "");

const CLAMPED_INPUTS: ReadonlySet<string> = new Set(["maxChars", "limit", "count", "pages", "blocks", "hours", "days", "top"]);
/** Number input with range checks; `fallback` makes it optional. */
export function num(q: Input, name: string, { min = -Infinity, max = Infinity, fallback, integer = false }: { min?: number; max?: number; fallback?: number; integer?: boolean } = {}): number {
  const raw = q(name);
  if (raw === undefined || raw.trim() === "") {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${name} is required`);
  }
  // Thousands separators as agents write them: "1,000", "1 000", "1_000"; a leading currency sign ("$1234", "€ 50") is not part of the number.
  const bare = raw.trim().replace(/^(-?)\s*[$€£¥]\s*/, "$1");
  const parsed = Number(/^\s*-?\d{1,3}([,_ ]\d{3})+(\.\d+)?\s*$/.test(bare) ? bare.replace(/[,_ ]/g, "") : bare);
  // How-much inputs (limit=500 on a 50-item tool, maxChars=300 under a 1,000 floor) are held to the range instead of
  // refused (26 Oct 2026 probe: the commonest refusals agents got). Values whose meaning would change stay strict.
  const n = CLAMPED_INPUTS.has(name) && Number.isFinite(parsed) && (!integer || Number.isInteger(parsed)) ? Math.min(max, Math.max(min, parsed)) : parsed;
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new HttpError(400, `${name} must be ${integer ? "a whole number" : "a number"}${Number.isFinite(min) ? ` from ${min}` : ""}${Number.isFinite(max) ? ` to ${max}` : ""}`);
  }
  return n;
}

/** One of a fixed set of values (case-insensitive). */
/** Network names and chain ids agents send for our chain slugs ("ethereum", "arbitrum", "42161"…). */
export const CHAIN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ethereum: "eth", mainnet: "eth", "1": "eth", arbitrum: "arb", "arbitrum-one": "arb", arbitrum_one: "arb", "42161": "arb",
  optimism: "op", "10": "op", "8453": "base", matic: "polygon", pol: "polygon", "137": "polygon",
});

/** The allowed value a raw input names, directly or through a chain alias. */
export const allowedValue = <T extends string>(raw: string, values: readonly T[]): T | undefined => {
  const lower = raw.trim().toLowerCase();
  return values.find((v) => v.toLowerCase() === lower) ?? values.find((v) => v.toLowerCase() === CHAIN_ALIASES[lower]);
};

export function pick<T extends string>(q: Input, name: string, values: readonly T[], fallback?: T): T {
  const raw = q(name)?.trim().toLowerCase();
  if (!raw) {
    if (fallback !== undefined) return fallback;
    throw new HttpError(400, `${name} is required (one of: ${values.join(", ")})`);
  }
  const hit = allowedValue(raw, values);
  if (!hit) throw new HttpError(400, `${name} must be one of: ${values.join(", ")}`);
  return hit;
}

const UA = { "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)", accept: "application/json" };

export { retryDelayMs } from "./lib/retry";
import { retryDelayMs } from "./lib/retry";

/**
 * GET JSON from an outside source. Outside failures become 502 (never charged). A 429 or 503 is retried once after a
 * short wait: Workers share egress IPs, so a per-IP limit (Wikimedia) can refuse a caller who sent nothing before.
 */
export async function getJson<T = unknown>(url: string, { timeoutMs = 8000, notFound }: { timeoutMs?: number; notFound?: string } = {}): Promise<T> {
  let res: Response;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    res = await fetch(url, { headers: UA, signal });
    const wait = res.status === 429 || res.status === 503 ? retryDelayMs(res) : null;
    if (wait !== null) {
      await res.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, wait));
      res = await fetch(url, { headers: UA, signal });
    }
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
