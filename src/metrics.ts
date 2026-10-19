import { DurableObject } from "cloudflare:workers";
import { reserveAmount, claimTransfer, type AmountReservation, type TransferClaim } from "./store/checkout-state";
import { saveSettlement, ledgerSummary, type SettlementRecord } from "./lib/settlement-ledger";
import { saveFunnel, funnelSummary, type FunnelEvent } from "./lib/funnel";
import { issueCredits, spendCredits, refundCredits, creditBalance } from "./lib/credits";
import { takeFreeCall, refundFreeCall } from "./lib/free-calls";

/**
 * What happened to a request for a paid path. "failed" is a 4xx (caller error), "errored" a 5xx (ours or upstream),
 * "sample" a free ?sample=1 preview of the static example (the tool did not run).
 */
export type Outcome = "challenged" | "paid" | "unsettled" | "trial" | "failed" | "errored" | "marketplace" | "sample" | "credits";
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

const KEEP_DAYS = 30;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Counts requests per paid path per day, including gross revenue for x402 settlements.
 * Public reports contain aggregates only. Private settlement records retain payer
 * and authorization identities for deduplication and operator reconciliation.
 */
export class Metrics extends DurableObject {
  async recordSettlement(record: SettlementRecord): Promise<boolean> {
    return saveSettlement(this.ctx.storage, record);
  }

  async revenueSummary() {
    return { ...await ledgerSummary(this.ctx.storage), funnel: await funnelSummary(this.ctx.storage) };
  }

  async recordFunnel(event: FunnelEvent) { await saveFunnel(this.ctx.storage, event); }

  // Card credits. Called only on the instance named "credits" (see lib/credit-routes.ts).
  async issueCredits(grant: Parameters<typeof issueCredits>[1]) { return issueCredits(this.ctx.storage, grant); }
  async spendCredits(keyHash: string, micros: number) { return spendCredits(this.ctx.storage, keyHash, micros); }
  async refundCredits(keyHash: string, micros: number) { return refundCredits(this.ctx.storage, keyHash, micros); }
  async creditBalance(keyHash: string) { return creditBalance(this.ctx.storage, keyHash); }
  async takeFreeCall(caller: string, day: string) { return takeFreeCall(this.ctx.storage, caller, day); }
  async refundFreeCall(caller: string, day: string) { return refundFreeCall(this.ctx.storage, caller, day); }

  async reserveCheckoutAmount(reservation: AmountReservation): Promise<boolean> {
    return reserveAmount(this.ctx.storage, reservation);
  }

  async claimCheckoutPayment(claim: TransferClaim): Promise<boolean> {
    return claimTransfer(this.ctx.storage, claim);
  }

  async bump(path: string, outcome: Outcome, revenueUsdMicros?: number): Promise<void> {
    const key = `day:${today()}`;
    await this.ctx.storage.transaction(async (txn) => {
      const day = (await txn.get<Day>(key)) ?? {};
      const row = (day[path] ??= {});
      row[outcome] = (row[outcome] ?? 0) + 1;
      row.revenueUsdMicros ??= 0;
      row.trackedPaidCalls ??= 0;
      if (outcome === "paid" && revenueUsdMicros !== undefined && Number.isSafeInteger(revenueUsdMicros) && revenueUsdMicros > 0) {
        row.revenueUsdMicros += revenueUsdMicros;
        row.trackedPaidCalls++;
      }
      await txn.put(key, day);
      if (SERVED.includes(outcome)) await txn.put(`last:${path}`, new Date().toISOString());
    });
  }

  /** Per-path reliability over the last STATUS_DAYS days: executed calls only, never unpaid quotes. */
  async status(paths: readonly string[]) {
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

  async report(): Promise<Record<string, Day>> {
    const days = await this.ctx.storage.list<Day>({ prefix: "day:", reverse: true, limit: KEEP_DAYS });
    return Object.fromEntries([...days].map(([k, v]) => [k.slice(4), v]));
  }
}
