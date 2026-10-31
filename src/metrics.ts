import { DurableObject } from "cloudflare:workers";
import { reserveAmount, claimTransfer, type AmountReservation, type TransferClaim } from "./store/checkout-state";
import { saveSettlement, ledgerSummary, type SettlementRecord } from "./lib/settlement-ledger";
import { saveFunnel, funnelSummary, assertFunnelEvent, funnelLabel, COUNTED_ONLY, type FunnelEvent } from "./lib/funnel";
import { issueCredits, spendCredits, refundCredits, creditBalance, creditSummary, rotateKey } from "./lib/credits";
import { takeFreeCall, refundFreeCall } from "./lib/free-calls";
import { claimReplay, swapReplay } from "./lib/mpp-store";
import type { MetricsBatch } from "./lib/metrics-batch";
import { FAILURE_PREFIX, REFUSED_PAYMENT } from "./lib/failure-reason";

/**
 * What happened to a request for a paid path. "failed" is a 4xx (caller error), "errored" a 5xx (ours or upstream),
 * "sample" a free ?sample=1 preview of the static example (the tool did not run).
 */
export type Outcome = "challenged" | "paid" | "unsettled" | "trial" | "failed" | "errored" | "marketplace" | "sample" | "credits" | "v1_payment" | "v2_payment" | "mpp_payment";
/** Outcomes where the tool ran and answered 2xx. */
const SERVED: readonly Outcome[] = ["paid", "unsettled", "trial", "marketplace", "credits"];
const STATUS_DAYS = 7;
interface PathMetrics extends Partial<Record<Outcome, number>> {
  /** USD multiplied by 1,000,000, tracked only for settled x402 API calls. */
  revenueUsdMicros?: number;
  /** Settled x402 API calls included in revenueUsdMicros. */
  trackedPaidCalls?: number;
}
type Day = Record<string, PathMetrics>;
/** Per calling-software family: requests by outcome. */
type Callers = Record<string, Partial<Record<Outcome, number>>>;
/** MCP connections (initialize requests) per client name and connection mode. */
type McpClients = Record<string, Partial<Record<"open" | "key" | "account", number>>>;
/** Distinct software families kept per day; the rest count as "other". */
const MAX_CALLERS = 60;

const KEEP_DAYS = 30;
const today = () => new Date().toISOString().slice(0, 10);
/**
 * Counters (per-path outcomes, callers, MCP clients, counted-only funnel stages) are added up in memory and
 * written at most once per FLUSH_MS, one row per day key. Writing them per request used up the free Durable
 * Objects allowance of 100,000 rows a day on 20 Oct, after which free calls and card credits failed with 500.
 * Settlements, credits, free calls and replay state still write immediately.
 */
const FLUSH_MS = 30_000;
type Counts = { [name: string]: number | Counts };
/** Adds the numbers in b into a at any depth; a top-level name beyond `cap` distinct names counts as "other". */
function addCounts(a: Counts, b: Counts, cap?: number) {
  for (const [name, value] of Object.entries(b)) {
    const key = name in a || cap === undefined || Object.keys(a).length < cap ? name : "other";
    if (typeof value === "number") a[key] = ((a[key] as number | undefined) ?? 0) + value;
    else addCounts((a[key] ??= {}) as Counts, value);
  }
}
/**
 * After the daily write allowance is used up every write fails, and a failed write resets the object and fails
 * the requests in flight with it. So buffered counters stop trying until the allowance resets (00:00 UTC). Kept
 * at module level so it outlives the reset of the object instance.
 */
let writesBlockedUntil = 0;
/** The last failed counter write, for the X-Metrics-State header on /metrics. */
let lastWriteError: { at: string; message: string } | null = null;
const nextUtcMidnight = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
function noteWriteError(err: unknown) {
  const message = String(err instanceof Error ? err.message : err);
  lastWriteError = { at: new Date().toISOString(), message: message.slice(0, 200) };
  if (message.includes("Exceeded allowed rows written")) writesBlockedUntil = nextUtcMidnight();
}
const writesBlocked = () => Date.now() < writesBlockedUntil;
export const __test = { writesBlocked, unblockWrites: () => { writesBlockedUntil = 0; } };
/** Distinct "path reason" failure keys kept per day; the rest count as "other" (one stored row stays far below 128 KiB). */
const MAX_FAILURE_REASONS = 200;
const capFor = (key: string) => key.startsWith("callers:") || key.startsWith("mcpclients:") ? MAX_CALLERS : key.startsWith("errors:") ? MAX_FAILURE_REASONS : undefined;

/**
 * Counts requests per paid path per day, including gross revenue for x402 settlements.
 * Public reports contain aggregates only. Private settlement records retain payer
 * and authorization identities for deduplication and operator reconciliation.
 */
export class Metrics extends DurableObject {
  /** Unwritten counter increments by storage key (day:, callers:, mcpclients:, funnel:day:). */
  private pending = new Map<string, Counts>();
  /** Unwritten last-success times by path. */
  private pendingLast = new Map<string, string>();
  private alarmSet = false;
  /** When the oldest unwritten count arrived (0 when nothing is buffered). */
  private pendingSince = 0;
  /** When this instance started and last wrote its counters (for the X-Metrics-State header). */
  private readonly startedAt = new Date().toISOString();
  private lastFlushAt: string | null = null;

  /** Buffer and write state, so an operator can see from /metrics whether counters are being written. */
  async flushState() {
    return {
      instanceStartedAt: this.startedAt,
      lastFlushAt: this.lastFlushAt,
      pendingKeys: this.pending.size,
      pendingSince: this.pendingSince ? new Date(this.pendingSince).toISOString() : null,
      alarmSet: this.alarmSet,
      writesBlockedUntil: writesBlocked() ? new Date(writesBlockedUntil).toISOString() : null,
      lastWriteError,
    };
  }

  private add(key: string, counts: Counts) {
    const current = this.pending.get(key) ?? {};
    addCounts(current, counts);
    this.pending.set(key, current);
    if (!this.pendingSince) this.pendingSince = Date.now();
  }

  /** When this instance last wrote its counters (0: never, so the first update writes at once). */
  private lastFlushMs = 0;

  /**
   * An idle object is evicted with its memory, often before its alarm, which then wakes a new, empty instance:
   * on staging on 21 Oct a paid call's count was in /metrics at once and gone two minutes later, a lone quote's
   * count never arrived, and production never kept a paid count. So an update writes at once when the last
   * write is FLUSH_MS old or more (a quiet object writes its first update straight away; a busy one still writes
   * at most once per FLUSH_MS), and the alarm only covers the tail of a busy spell.
   */
  private async schedule() {
    if (writesBlocked()) return;
    if (this.pending.size && Date.now() - this.lastFlushMs >= FLUSH_MS) {
      try { await this.flush(); return; } catch { /* stays buffered; the alarm retries */ }
    }
    if (this.alarmSet) return;
    this.alarmSet = true;
    try { await this.ctx.storage.setAlarm(Date.now() + FLUSH_MS); }
    catch (err) { this.alarmSet = false; noteWriteError(err); throw err; }
  }

  /** Writes buffered counters in one transaction; on failure they stay buffered for the next try. */
  async flush() {
    if (!this.pending.size && !this.pendingLast.size) return;
    if (writesBlocked()) return;
    const batch = this.pending, last = this.pendingLast;
    this.pending = new Map(); this.pendingLast = new Map(); this.pendingSince = 0;
    this.lastFlushMs = Date.now(); // also on failure, so a failing write is not retried on every request
    try {
      await this.ctx.storage.transaction(async (txn) => {
        for (const [key, counts] of batch) {
          const stored = (await txn.get<Counts>(key)) ?? {};
          addCounts(stored, counts, capFor(key));
          await txn.put(key, stored);
        }
        for (const [path, at] of last) await txn.put(`last:${path}`, at);
      });
      this.lastFlushAt = new Date().toISOString();
    } catch (err) {
      for (const [key, counts] of batch) this.add(key, counts);
      for (const [path, at] of last) if (!this.pendingLast.has(path)) this.pendingLast.set(path, at);
      noteWriteError(err);
      throw err;
    }
  }

  async alarm() {
    this.alarmSet = false;
    await this.flush();
  }

  /**
   * Stored rows plus the unwritten counts, without writing: a failed write resets the object and fails every
   * request in flight, so reads must work while the daily write allowance is used up.
   */
  private async listMerged<T>(options: DurableObjectListOptions & { prefix: string }): Promise<Map<string, T>> {
    const stored = await this.ctx.storage.list<Counts>(options);
    const keys = new Set(stored.keys());
    for (const key of this.pending.keys()) if (key.startsWith(options.prefix) && (!options.start || key >= options.start)) keys.add(key);
    const sorted = [...keys].sort();
    if (options.reverse) sorted.reverse();
    return new Map(sorted.slice(0, options.limit ?? sorted.length).map((key) => {
      const row = structuredClone(stored.get(key) ?? {});
      const extra = this.pending.get(key);
      if (extra) addCounts(row, extra, capFor(key));
      return [key, row as T];
    }));
  }

  async recordSettlement(record: SettlementRecord): Promise<boolean> {
    return saveSettlement(this.ctx.storage, record);
  }

  async revenueSummary() {
    return { ...await ledgerSummary(this.ctx.storage), funnel: await funnelSummary(this.ctx.storage, (o) => this.listMerged({ ...o, prefix: o.prefix ?? "" })) };
  }

  async recordFunnel(event: FunnelEvent) {
    if (!COUNTED_ONLY.has(event.stage)) return saveFunnel(this.ctx.storage, event);
    this.addFunnel(event);
    await this.schedule();
  }

  private addFunnel(event: FunnelEvent) {
    assertFunnelEvent(event);
    this.add(`funnel:day:${event.at.slice(0, 10)}`, { [funnelLabel(event)]: 1 });
  }

  /** One call for an isolate's batch of counter updates (lib/metrics-batch.ts); a bad item is skipped. */
  async ingest(batch: MetricsBatch) {
    for (const [path, outcome, revenueUsdMicros, caller] of batch.bumps ?? []) this.addBump(path, outcome, revenueUsdMicros, caller);
    for (const event of batch.funnel ?? []) {
      if (!COUNTED_ONLY.has(event.stage)) { await saveFunnel(this.ctx.storage, event).catch(() => {}); continue; }
      try { this.addFunnel(event); } catch { console.error("metrics: invalid funnel event in batch"); }
    }
    for (const [client, mode] of batch.mcp ?? []) this.addMcpClient(client, mode);
    await this.schedule();
  }

  // Card credits. Called only on the instance named "credits" (see lib/credit-routes.ts).
  async issueCredits(grant: Parameters<typeof issueCredits>[1]) { return issueCredits(this.ctx.storage, grant); }
  async spendCredits(keyHash: string, micros: number) { return spendCredits(this.ctx.storage, keyHash, micros); }
  async refundCredits(keyHash: string, micros: number) { return refundCredits(this.ctx.storage, keyHash, micros); }
  async creditBalance(keyHash: string) { return creditBalance(this.ctx.storage, keyHash); }
  async creditSummary() { return creditSummary(this.ctx.storage); }
  async rotateKey(oldHash: string, newKey: string, newHash: string) { return rotateKey(this.ctx.storage, oldHash, newKey, newHash); }
  // OAuth sign-in records (clients, codes, hashed tokens); see lib/oauth.ts. Expiry is checked by the caller.
  async oauthGet(key: string): Promise<unknown> { return (await this.ctx.storage.get(`oauth:${key}`)) ?? null; }
  async oauthPut(key: string, value: unknown) { await this.ctx.storage.put(`oauth:${key}`, value); }
  async oauthTake(key: string): Promise<unknown> {
    return this.ctx.storage.transaction(async (txn) => {
      const value = await txn.get(`oauth:${key}`);
      if (value !== undefined) await txn.delete(`oauth:${key}`);
      return value ?? null;
    });
  }
  // MPP replay state for per-call Tempo payments (lib/mpp-tempo.ts), shared by every isolate. Called on "global".
  async mppGet(key: string): Promise<unknown> { return (await this.ctx.storage.get(`mpp:${key}`)) ?? null; }
  async mppPut(key: string, value: unknown) { await this.ctx.storage.put(`mpp:${key}`, value); }
  async mppDelete(key: string) { await this.ctx.storage.delete(`mpp:${key}`); }
  async mppClaim(key: string, expires: number) { return claimReplay(this.ctx.storage, key, expires); }
  async mppSwap(key: string, expected: string, next: { value: unknown } | null) { return swapReplay(this.ctx.storage, key, expected, next); }
  async takeFreeCall(caller: string, day: string) { return takeFreeCall(this.ctx.storage, caller, day); }
  async refundFreeCall(caller: string, day: string) { return refundFreeCall(this.ctx.storage, caller, day); }

  async reserveCheckoutAmount(reservation: AmountReservation): Promise<boolean> {
    return reserveAmount(this.ctx.storage, reservation);
  }

  async claimCheckoutPayment(claim: TransferClaim): Promise<boolean> {
    return claimTransfer(this.ctx.storage, claim);
  }

  async bump(path: string, outcome: Outcome, revenueUsdMicros?: number, caller?: string): Promise<void> {
    this.addBump(path, outcome, revenueUsdMicros, caller);
    // A paid call is rare and is the count that matters: write it now, with whatever else is buffered.
    if (outcome === "paid" && !writesBlocked()) {
      try { await this.flush(); return; } catch { /* stays buffered; the alarm retries */ }
    }
    await this.schedule();
  }

  private addBump(path: string, outcome: Outcome, revenueUsdMicros?: number, caller?: string) {
    if (typeof path !== "string" || typeof outcome !== "string") return;
    if (path.startsWith(FAILURE_PREFIX)) return this.add(`errors:${today()}`, { [path.slice(FAILURE_PREFIX.length).slice(0, 160)]: 1 });
    const paid = outcome === "paid" && revenueUsdMicros !== undefined && Number.isSafeInteger(revenueUsdMicros) && revenueUsdMicros > 0;
    this.add(`day:${today()}`, { [path]: { [outcome]: 1, revenueUsdMicros: paid ? revenueUsdMicros : 0, trackedPaidCalls: paid ? 1 : 0 } });
    if (caller) this.add(`callers:${today()}`, { [caller]: { [outcome]: 1 } });
    if (SERVED.includes(outcome)) this.pendingLast.set(path, new Date().toISOString());
  }

  /** Per-path reliability over the last STATUS_DAYS days: executed calls only, never unpaid quotes. */
  async status(paths: readonly string[]) {
    const days = [...(await this.listMerged<Day>({ prefix: "day:", reverse: true, limit: STATUS_DAYS })).values()];
    const last = await this.ctx.storage.list<string>({ prefix: "last:" });
    // Failure reasons ("<path> <status> <message without the caller's input>"), summed over the same days.
    const reasons = new Map<string, Map<string, number>>();
    for (const day of (await this.listMerged<Record<string, number>>({ prefix: "errors:", reverse: true, limit: STATUS_DAYS })).values()) {
      for (const [key, n] of Object.entries(day)) {
        const at = key.indexOf(" ");
        if (at < 1) continue;
        const byReason = reasons.get(key.slice(0, at)) ?? new Map<string, number>();
        byReason.set(key.slice(at + 1), (byReason.get(key.slice(at + 1)) ?? 0) + n);
        reasons.set(key.slice(0, at), byReason);
      }
    }
    const rows = paths.map((path) => {
      let served = 0, serverErrors = 0, buyerErrors = 0;
      for (const day of days) {
        const row = day[path] ?? {};
        served += SERVED.reduce((n, o) => n + (row[o] ?? 0), 0);
        serverErrors += row.errored ?? 0;
        buyerErrors += row.failed ?? 0;
      }
      const ran = served + serverErrors;
      const counted = [...(reasons.get(path) ?? [])].sort((a, b) => b[1] - a[1]);
      const topOf = (refused: boolean) => counted.filter(([reason]) => reason.startsWith(`${REFUSED_PAYMENT} `) === refused).slice(0, 3).map(([reason, count]) => ({ reason, count }));
      const top = topOf(false), refusals = topOf(true);
      return { path, served, serverErrors, buyerErrors, successRate: ran ? Math.round((served / ran) * 1000) / 1000 : null, lastSuccessAt: this.pendingLast.get(path) ?? last.get(`last:${path}`) ?? null, ...(top.length ? { topFailures: top } : {}), ...(refusals.length ? { paymentRefusals: refusals } : {}) };
    });
    const served = rows.reduce((n, r) => n + r.served, 0), serverErrors = rows.reduce((n, r) => n + r.serverErrors, 0);
    return { windowDays: STATUS_DAYS, served, serverErrors, successRate: served + serverErrors ? Math.round((served / (served + serverErrors)) * 1000) / 1000 : null, tools: rows };
  }

  /** One MCP connection (initialize) by client name and how it connected: open, key or account. */
  async bumpMcpClient(client: string, mode: "open" | "key" | "account"): Promise<void> {
    this.addMcpClient(client, mode);
    await this.schedule();
  }

  private addMcpClient(client: string, mode: "open" | "key" | "account") {
    if (typeof client === "string" && typeof mode === "string") this.add(`mcpclients:${today()}`, { [client]: { [mode]: 1 } });
  }

  async mcpClients(): Promise<Record<string, McpClients>> {
    const days = await this.listMerged<McpClients>({ prefix: "mcpclients:", reverse: true, limit: KEEP_DAYS });
    return Object.fromEntries([...days].map(([k, v]) => [k.slice(11), v]));
  }

  /** Requests per day by calling software (see callerFamily) and outcome, newest first. */
  async callers(): Promise<Record<string, Callers>> {
    const days = await this.listMerged<Callers>({ prefix: "callers:", reverse: true, limit: KEEP_DAYS });
    return Object.fromEntries([...days].map(([k, v]) => [k.slice(8), v]));
  }

  async report(): Promise<Record<string, Day>> {
    const days = await this.listMerged<Day>({ prefix: "day:", reverse: true, limit: KEEP_DAYS });
    return Object.fromEntries([...days].map(([k, v]) => [k.slice(4), v]));
  }
}
