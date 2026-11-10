// Free calls: every caller (hashed IP) gets a small allowance of successful calls before paying, so an
// agent can try a tool before its user buys credits. MCP uses it automatically; HTTP opts in with trial=1
// so ordinary unpaid requests still get the 402 challenge that directories and validators probe for.
// Counted in the Metrics Durable Object instance "credits", so the limits are exact.

export const FREE_CALLS_PER_CALLER = 25;
export const FREE_CALLS_PER_DAY = 2000;
// 10 Nov 2026, the owner: "from 25 to 3 is good!" In 15 days 14,352 free calls over plain HTTP (11,047 of them /pdf/text from
// browser-type callers on many addresses) and 24,304 "used up" answers produced no purchase at all. So HTTP trial=1 gives 3
// calls per caller; MCP keeps 25, because app directories test the server without paying.
export const FREE_HTTP_CALLS_PER_CALLER = 3;
// Not in the HTTP free calls at all (owner: "disable all free trials for the heavy user"): one caller group took 400-1,300
// free PDF reads a day from many addresses and cannot be told apart, so the tool itself leaves the HTTP trial. It stays in
// the MCP free calls, and its price is the lowest in the catalog.
export const HTTP_FREE_EXCLUDED: ReadonlySet<string> = new Set(["/pdf/text", "/pdf/extract"]);

interface Txn { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> }
export interface FreeCallStorage { transaction<T>(callback: (txn: Txn) => Promise<T>): Promise<T> }

const callerKey = (hash: string) => `free:caller:${hash}`;
const dayKey = (day: string) => `free:day:${day}`;

/** Takes one free call; returns how many the caller has left after it, or null when none can be given. */
export async function takeFreeCall(storage: FreeCallStorage, callerHash: string, day: string, limit = FREE_CALLS_PER_CALLER): Promise<number | null> {
  return storage.transaction(async (txn) => {
    const used = (await txn.get<number>(callerKey(callerHash))) ?? 0;
    const today = (await txn.get<number>(dayKey(day))) ?? 0;
    if (used >= limit || today >= FREE_CALLS_PER_DAY) return null;
    await txn.put(callerKey(callerHash), used + 1);
    await txn.put(dayKey(day), today + 1);
    return limit - used - 1;
  });
}

/** Gives back a free call whose tool failed, so only successful calls use the allowance. */
export async function refundFreeCall(storage: FreeCallStorage, callerHash: string, day: string): Promise<void> {
  await storage.transaction(async (txn) => {
    const used = (await txn.get<number>(callerKey(callerHash))) ?? 0;
    const today = (await txn.get<number>(dayKey(day))) ?? 0;
    if (used > 0) await txn.put(callerKey(callerHash), used - 1);
    if (today > 0) await txn.put(dayKey(day), today - 1);
  });
}

// A daily allowance (1.111.5, the free ChatGPT plugin server): unlike the free calls above it comes back every UTC day,
// because inside ChatGPT there is nothing to buy afterwards. One record per caller and one for everybody, each holding the
// day it counts for, so nothing accumulates per day.
interface DayCount { day: string; used: number }
const dailyCallerKey = (hash: string) => `daily:caller:${hash}`;
const DAILY_TOTAL_KEY = "daily:total";
const usedOn = (c: DayCount | undefined, day: string) => (c && c.day === day ? c.used : 0);

/** Takes one call of the day; returns how many the caller has left today, or null when the caller or the day is used up. */
export async function takeDailyCall(storage: FreeCallStorage, callerHash: string, day: string, perCaller: number, total: number): Promise<number | null> {
  return storage.transaction(async (txn) => {
    const mine = usedOn(await txn.get<DayCount>(dailyCallerKey(callerHash)), day);
    const all = usedOn(await txn.get<DayCount>(DAILY_TOTAL_KEY), day);
    if (mine >= perCaller || all >= total) return null;
    await txn.put(dailyCallerKey(callerHash), { day, used: mine + 1 } satisfies DayCount);
    await txn.put(DAILY_TOTAL_KEY, { day, used: all + 1 } satisfies DayCount);
    return perCaller - mine - 1;
  });
}

/** Gives back a call of the day whose tool failed, so only successful calls count. */
export async function refundDailyCall(storage: FreeCallStorage, callerHash: string, day: string): Promise<void> {
  await storage.transaction(async (txn) => {
    const mine = usedOn(await txn.get<DayCount>(dailyCallerKey(callerHash)), day);
    const all = usedOn(await txn.get<DayCount>(DAILY_TOTAL_KEY), day);
    if (mine > 0) await txn.put(dailyCallerKey(callerHash), { day, used: mine - 1 } satisfies DayCount);
    if (all > 0) await txn.put(DAILY_TOTAL_KEY, { day, used: all - 1 } satisfies DayCount);
  });
}
/** The caller identity: a hash of the connecting IP, so no raw address is stored. */
export async function callerHash(ip: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`free-calls:${ip}`)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const utcDay = () => new Date().toISOString().slice(0, 10);

export function freeCallNote(left: number, origin: string) {
  return `Free call (${left} of ${FREE_CALLS_PER_CALLER} free calls left for this caller). After that, pay per call with x402, or buy a prepaid key by card at ${origin}/credits and send it as "Authorization: Bearer <key>".`;
}
