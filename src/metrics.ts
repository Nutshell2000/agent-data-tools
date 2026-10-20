import { DurableObject } from "cloudflare:workers";
import { reserveAmount, claimTransfer, type AmountReservation, type TransferClaim } from "./store/checkout-state";
import { saveSettlement, ledgerSummary, type SettlementRecord } from "./lib/settlement-ledger";
import { saveFunnel, funnelSummary, assertFunnelEvent, funnelLabel, COUNTED_ONLY, type FunnelEvent } from "./lib/funnel";
import { issueCredits, spendCredits, refundCredits, creditBalance, creditSummary, rotateKey } from "./lib/credits";
import { takeFreeCall, refundFreeCall } from "./lib/free-calls";
import { claimReplay, swapReplay } from "./lib/mpp-store";

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
const capFor = (key: string) => key.startsWith("callers:") || key.startsWith("mcpclients:") ? MAX_CALLERS : undefined;

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

  private add(key: string, counts: Counts) {
    const current = this.pending.get(key) ?? {};
    addCounts(current, counts);
    this.pending.set(key, current);
  }

  private async schedule() {
    if (this.alarmSet) return;
    this.alarmSet = true;
    try { await this.ctx.storage.setAlarm(Date.now() + FLUSH_MS); }
    catch (err) { this.alarmSet = false; throw err; }
  }

  /** Writes buffered counters in one transaction; on failure they stay buffered for the next try. */
  async flush() {
    if (!this.pending.size && !this.pendingLast.size) return;
    const batch = this.pending, last = this.pendingLast;
    this.pending = new Map(); this.pendingLast = new Map();
    try {
      await this.ctx.storage.transaction(async (txn) => {
        for (const [key, counts] of batch) {
          const stored = (await txn.get<Counts>(key)) ?? {};
          addCounts(stored, counts, capFor(key));
          await txn.put(key, stored);
        }
        for (const [path, at] of last) await txn.put(`last:${path}`, at);
      });
    } catch (err) {
      for (const [key, counts] of batch) this.add(key, counts);
      for (const [path, at] of last) if (!this.pendingLast.has(path)) this.pendingLast.set(path, at);
      throw err;
    }
  }

  async alarm() {
    this.alarmSet = false;
    await this.flush();
  }

  async recordSettlement(record: SettlementRecord): Promise<boolean> {
    return saveSettlement(this.ctx.storage, record);
  }

  async revenueSummary() {
    await this.flush().catch(() => console.error("metrics: flush before revenue read failed"));
    return { ...await ledgerSummary(this.ctx.storage), funnel: await funnelSummary(this.ctx.storage) };
  }

  async recordFunnel(event: FunnelEvent) {
    if (!COUNTED_ONLY.has(event.stage)) return saveFunnel(this.ctx.storage, event);
    assertFunnelEvent(event);
    this.add(`funnel:day:${event.at.slice(0, 10)}`, { [funnelLabel(event)]: 1 });
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
    const paid = outcome === "paid" && revenueUsdMicros !== undefined && Number.isSafeInteger(revenueUsdMicros) && revenueUsdMicros > 0;
    this.add(`day:${today()}`, { [path]: { [outcome]: 1, revenueUsdMicros: paid ? revenueUsdMicros : 0, trackedPaidCalls: paid ? 1 : 0 } });
    if (caller) this.add(`callers:${today()}`, { [caller]: { [outcome]: 1 } });
    if (SERVED.includes(outcome)) this.pendingLast.set(path, new Date().toISOString());
    await this.schedule();
  }

  /** Per-path reliability over the last STATUS_DAYS days: executed calls only, never unpaid quotes. */
  async status(paths: readonly string[]) {
    await this.flush().catch(() => console.error("metrics: flush before status read failed"));
    const days = [...(await this.ctx.storage.list<Day>({ prefix: "day:", reverse: true, limit: STATUS_DAYS })).values()];
    const last = await this.ctx.storage.list<string>({ prefix: "last:" });
    const rows = paths.map((path) => {
      let served = 0, serverErrors = 0, buyerErrors = 0;
      for (const day of days) {
        const row = day[path] ?? {};
        served += SERVED.reduce((n, o) => n + (row[o] ?? 0), 0);
        serverErrors += row.errored ?? 0;
        buyerErrors += row.failed ?? 0;
      }
      const ran = served + serverErrors;
      return { path, served, serverErrors, buyerErrors, successRate: ran ? Math.round((served / ran) * 1000) / 1000 : null, lastSuccessAt: last.get(`last:${path}`) ?? null };
    });
    const served = rows.reduce((n, r) => n + r.served, 0), serverErrors = rows.reduce((n, r) => n + r.serverErrors, 0);
    return { windowDays: STATUS_DAYS, served, serverErrors, successRate: served + serverErrors ? Math.round((served / (served + serverErrors)) * 1000) / 1000 : null, tools: rows };
  }

  /** One MCP connection (initialize) by client name and how it connected: open, key or account. */
  async bumpMcpClient(client: string, mode: "open" | "key" | "account"): Promise<void> {
    this.add(`mcpclients:${today()}`, { [client]: { [mode]: 1 } });
    await this.schedule();
  }

  async mcpClients(): Promise<Record<string, McpClients>> {
    await this.flush().catch(() => console.error("metrics: flush before MCP client read failed"));
    const days = await this.ctx.storage.list<McpClients>({ prefix: "mcpclients:", reverse: true, limit: KEEP_DAYS });
    return Object.fromEntries([...days].map(([k, v]) => [k.slice(11), v]));
  }

  /** Requests per day by calling software (see callerFamily) and outcome, newest first. */
  async callers(): Promise<Record<string, Callers>> {
    await this.flush().catch(() => console.error("metrics: flush before callers read failed"));
    const days = await this.ctx.storage.list<Callers>({ prefix: "callers:", reverse: true, limit: KEEP_DAYS });
    return Object.fromEntries([...days].map(([k, v]) => [k.slice(8), v]));
  }

  async report(): Promise<Record<string, Day>> {
    await this.flush().catch(() => console.error("metrics: flush before report read failed"));
    const days = await this.ctx.storage.list<Day>({ prefix: "day:", reverse: true, limit: KEEP_DAYS });
    return Object.fromEntries([...days].map(([k, v]) => [k.slice(4), v]));
  }
}
