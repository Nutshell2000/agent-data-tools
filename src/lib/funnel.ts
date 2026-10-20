import { AsyncLocalStorage } from "node:async_hooks";
import type { Env } from "./env";

// A payment attempt that never reached the facilitator ends in one of the refused_* stages: wrong amount or
// recipient, a network we do not accept, or a header we could not read. facilitator_unavailable means the
// facilitator itself could not be reached, so the buyer was told to retry and was not charged.
// free_exhausted marks a caller who asked for a free call after using them all: the moment they are asked to pay.
export const STAGES = ["visit", "quote", "attempt", "verified", "verification_failed", "settled", "settlement_failed", "completed", "execution_failed", "free_call", "free_exhausted", "credits_call", "refused_amount", "refused_network", "refused_format", "facilitator_unavailable"] as const;
export type FunnelStage = typeof STAGES[number];
export interface FunnelEvent {
  requestId: string; path: string; transport: "http" | "mcp";
  source?: string; stage: FunnelStage; at: string;
}
interface Trace {
  requestId: string; path: string; transport: "http" | "mcp"; source?: string;
  emit: (event: FunnelEvent) => void; stages: Set<FunnelStage>;
}
const traces = new AsyncLocalStorage<Trace>();
export const activeTrace = () => traces.getStore();
export const safeSource = (source?: string | null) => source && /^[a-z0-9_-]{1,40}$/.test(source) ? source : undefined;

export function withRequestTrace<T>(env: Env, path: string, source: string | null, waitUntil: (p: Promise<unknown>) => void, callback: () => T): T {
  const trace: Trace = { requestId: crypto.randomUUID(), path, transport: "http", source: safeSource(source), stages: new Set(), emit(event) {
    if (!env.METRICS) return;
    try { waitUntil(env.METRICS.get(env.METRICS.idFromName("global")).recordFunnel(event).catch(() => console.error("funnel: recording failed"))); }
    catch { console.error("funnel: recording unavailable"); }
  } };
  return traces.run(trace, callback);
}

export function withToolTrace<T>(path: string, callback: () => T): T {
  const parent = activeTrace();
  if (!parent) return callback();
  return traces.run({ ...parent, requestId: crypto.randomUUID(), path, transport: "mcp", stages: new Set() }, callback);
}

export function markStage(stage: FunnelStage) {
  const trace = activeTrace();
  if (!trace || trace.stages.has(stage)) return;
  trace.stages.add(stage);
  trace.emit({ requestId: trace.requestId, path: trace.path, transport: trace.transport,
    ...(trace.source ? { source: trace.source } : {}), stage, at: new Date().toISOString() });
}

// High-volume stages are only counted per day (buffered in the Metrics object, see metrics.ts): one stored row
// per request for crawler quotes used up the free Durable Objects write allowance (100,000 rows a day) on 20 Oct.
// Payment stages keep their per-request evidence row.
export const COUNTED_ONLY: ReadonlySet<FunnelStage> = new Set(["visit", "quote", "free_call", "free_exhausted", "credits_call"]);
export const funnelLabel = (event: FunnelEvent) => `${event.transport}:${event.path}:${event.stage}`;

export function assertFunnelEvent(event: FunnelEvent) {
  if (!/^[0-9a-f-]{36}$/.test(event.requestId) || !STAGES.includes(event.stage) ||
      !/^\/[a-zA-Z0-9/.-]{0,80}$/.test(event.path) || !["http", "mcp"].includes(event.transport) ||
      (event.source !== undefined && safeSource(event.source) !== event.source) || !Number.isFinite(Date.parse(event.at))) throw new Error("invalid funnel event");
}

/** Minimal request evidence only; no input URLs, signatures, page content or keys. */
export async function saveFunnel(storage: DurableObjectStorage, event: FunnelEvent) {
  assertFunnelEvent(event);
  // Copy only allowlisted fields, even on an internal RPC call.
  const clean = { requestId: event.requestId, path: event.path, transport: event.transport,
    source: safeSource(event.source), stage: event.stage, at: event.at };
  const day = event.at.slice(0, 10);
  await storage.transaction(async txn => {
    const key = `funnel:event:${day}:${event.requestId}`;
    const previous = await txn.get<Partial<Record<FunnelStage, FunnelEvent>>>(key) ?? {};
    if (previous[event.stage]) return;
    previous[event.stage] = clean;
    const dayKey = `funnel:day:${day}`;
    const counts = await txn.get<Record<string, number>>(dayKey) ?? {};
    const label = funnelLabel(event);
    counts[label] = (counts[label] ?? 0) + 1;
    await txn.put(key, previous); await txn.put(dayKey, counts);
  });
  // Bounded opportunistic retention cleanup; no timer or scheduled agent run.
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const old = await storage.list({ prefix: "funnel:event:", end: `funnel:event:${cutoff}`, limit: 100 });
  if (old.size) await storage.delete([...old.keys()]);
}

export async function funnelSummary(storage: DurableObjectStorage) {
  const from = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);
  const days = await storage.list<Record<string, number>>({ prefix: "funnel:day:", start: `funnel:day:${from}` });
  return { sinceUtc: from, days: Object.fromEntries([...days].map(([k, v]) => [k.slice(11), v])),
    note: "Visits count successful GET requests to published buying resources, including machine discovery and client downloads; they include bots and operator checks. Stages count server-observed requests, not unique people or customer conversion. Completed means result prepared after settlement; receipt by the buyer is unconfirmed. Source tags are optional, untrusted attribution. Invitations and buyer task confirmation require operator evidence." };
}

/** Successful reads of published buying resources; no identity or cross-request tracking. */
export function isDiscoveryVisit(method: string, path: string, status: number): boolean {
  if (method !== "GET" || status < 200 || status >= 300) return false;
  if (["/skills/index.json","/skills/spellzcode-x402-reader/SKILL.md"].includes(path)) return true;
  if (["/", "/llms.txt", "/openapi.json", "/.well-known/x402", "/.well-known/api-catalog", "/.well-known/mcp/server-card.json", "/examples/extract/", "/examples/extract/manifest.json", "/examples/sitemap/", "/examples/sitemap/manifest.json", "/examples/sitemap/result.json", "/examples/sitemap/source.xml", "/examples/sitemap/index.xml"].includes(path)) return true;
  if (/^\/guides\/(web-reading|bitcoin-fees|dependency-audit|sitemap|local-mcp)(\.md)?$/.test(path)) return true;
  if (/^\/clients\/reader\/\d+\.\d+\.\d+\/(reader-client\.mjs(?:\.sha256)?|reader-mcp\.mjs(?:\.sha256)?|SHA256SUMS)$/.test(path)) return true;
  return /^\/examples\/extract\/(technical-guide|short-article|long-document|section-result)\.json$/.test(path);
}
