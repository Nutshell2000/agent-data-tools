import { DurableObject } from "cloudflare:workers";

/** What happened to a request for a paid path. */
export type Outcome = "challenged" | "paid" | "trial" | "failed";
type Day = Record<string, Partial<Record<Outcome, number>>>;

const KEEP_DAYS = 30;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Counts requests per paid path per day, so we can see whether callers look and leave
 * (challenged, never paid) or never arrive. One object holds every counter; it stores
 * no addresses, payers or request contents.
 */
export class Metrics extends DurableObject {
  async bump(path: string, outcome: Outcome): Promise<void> {
    const key = `day:${today()}`;
    const day = (await this.ctx.storage.get<Day>(key)) ?? {};
    const row = (day[path] ??= {});
    row[outcome] = (row[outcome] ?? 0) + 1;
    await this.ctx.storage.put(key, day);
  }

  async report(): Promise<Record<string, Day>> {
    const days = await this.ctx.storage.list<Day>({ prefix: "day:", reverse: true, limit: KEEP_DAYS });
    return Object.fromEntries([...days].map(([k, v]) => [k.slice(4), v]));
  }
}
