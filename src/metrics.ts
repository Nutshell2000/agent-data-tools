import { DurableObject } from "cloudflare:workers";

/** What happened to a request for a paid path. */
export type Outcome = "challenged" | "paid" | "unsettled" | "trial" | "failed" | "marketplace";
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
 * One object holds every counter; it stores no addresses, payers or request contents.
 */
export class Metrics extends DurableObject {
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
    });
  }

  async report(): Promise<Record<string, Day>> {
    const days = await this.ctx.storage.list<Day>({ prefix: "day:", reverse: true, limit: KEEP_DAYS });
    return Object.fromEntries([...days].map(([k, v]) => [k.slice(4), v]));
  }
}
