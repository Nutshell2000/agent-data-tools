import type { Outcome } from "../metrics";
import type { FunnelEvent } from "./funnel";

// Counter updates for unpaid traffic are collected per isolate and sent to the Metrics object in one call at most
// every SEND_MS: one call per event used 55,000 of the free plan's 100,000 Durable Object requests a day by
// mid-afternoon on 20 Oct. Paid outcomes and payment-stage funnel events are still sent at once by the callers.
// A batch is lost if its isolate is evicted before the next request; these are traffic counters, not receipts.

export type McpMode = "open" | "key" | "account";
export interface MetricsBatch {
  bumps: [path: string, outcome: Outcome, revenueUsdMicros: number | undefined, caller: string | undefined][];
  funnel: FunnelEvent[];
  mcp: [client: string, mode: McpMode][];
}
export interface BatchTarget { ingest(batch: MetricsBatch): Promise<void> }

const SEND_MS = 10_000;
const SEND_SIZE = 500;
const empty = (): MetricsBatch => ({ bumps: [], funnel: [], mcp: [] });
const size = (b: MetricsBatch) => b.bumps.length + b.funnel.length + b.mcp.length;
// One batch per isolate, kept on globalThis so every bundle copy of this module (tests load several) shares it.
// Each batch has a generation, so its self-send timer only ever sends the batch it was started for, and `wake`
// ends that timer's wait once the batch has been sent another way.
interface BatchState { batch: MetricsBatch; startedAt: number; generation: number; wake: (() => void) | null }
const state: BatchState =
  ((globalThis as { __adtMetricsBatch?: BatchState }).__adtMetricsBatch ??= { batch: empty(), startedAt: 0, generation: 0, wake: null });
state.generation ??= 0;
state.wake ??= null;

function take(): MetricsBatch | null {
  if (!size(state.batch)) return null;
  const sending = state.batch;
  state.batch = empty();
  state.startedAt = 0;
  state.generation++;
  const w = state.wake; state.wake = null; w?.(); // the batch is on its way: end its self-send wait now
  return sending;
}

/** Adds one update; sends the isolate's batch through this request's stub when it is old or large enough. */
export function queueBatched(target: BatchTarget, waitUntil: (p: Promise<unknown>) => void, add: (b: MetricsBatch) => void) {
  add(state.batch);
  const now = Date.now();
  if (!state.startedAt) {
    state.startedAt = now;
    // An isolate that gets no later request would lose its batch (quiet periods, staging): it sends the batch
    // itself SEND_MS after the first item, inside waitUntil (which may run up to 30 s after the response).
    // Still at most one Metrics call per batch, so the Durable Object request budget is unchanged.
    const gen = state.generation;
    waitUntil(new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, SEND_MS);
      state.wake = () => { clearTimeout(timer); resolve(); };
    }).then(() => {
      if (gen !== state.generation) return; // already sent by a later request or a report read
      const sending = take();
      return sending ? target.ingest(sending) : undefined;
    }).catch(() => console.error("metrics: batch send failed")));
  }
  if (now - state.startedAt < SEND_MS && size(state.batch) < SEND_SIZE) return;
  const sending = take();
  if (sending) waitUntil(target.ingest(sending).catch(() => console.error("metrics: batch send failed")));
}

/** Sends whatever this isolate holds, so a report read right after traffic includes it. */
export async function sendBatchNow(target: BatchTarget) {
  const sending = take();
  if (sending) await target.ingest(sending).catch(() => console.error("metrics: batch send failed"));
}

export const canBatch = (target: unknown): target is BatchTarget => typeof (target as BatchTarget | undefined)?.ingest === "function";
