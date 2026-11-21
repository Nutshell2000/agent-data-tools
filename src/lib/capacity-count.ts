// The exact daily count for a metered upstream (Workers AI, the hosted browser, paid search), kept in the Metrics
// Durable Object (21 Nov 2026). Before this the count lived in KV as "read a number, write it back plus one": two
// requests at the same moment both read the old number, and a read in another location could be a minute old, so a
// burst of parallel calls passed the cap. Here one take is one transaction inside one object, so the cap holds.
//
// The same row also holds how many of the day's slots went to UNPAID use (free calls, free keys, voice test keys, the
// free pages). Unpaid use may take only its share of the cap; the rest is always there for calls that are paid for.
// Before this split, free traffic could use the whole day's AI capacity and paying buyers then got 503.
//
// One row per resource, holding the day it counts for, so nothing accumulates per day.

interface Txn { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> }
export interface CapacityStorage { transaction<T>(callback: (txn: Txn) => Promise<T>): Promise<T> }

export interface CapacityRow { day: string; used: number; unpaid: number }
/** "full": the day's cap is used. "unpaid_full": the share for unpaid use is used; a paid call would still pass. */
export type CapacityAnswer = "ok" | "full" | "unpaid_full";

const rowKey = (kind: string) => `capacity:${kind}`;
const KIND = /^[a-z][a-z0-9-]{0,30}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const whole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const onDay = (row: CapacityRow | undefined, day: string): CapacityRow =>
  row && row.day === day && whole(row.used) && whole(row.unpaid) ? row : { day, used: 0, unpaid: 0 };

/**
 * Takes one slot of `kind` for `day` if there is room. `unpaidCap` is null for a paid call (only the day's cap
 * applies); for an unpaid call it is the most slots unpaid use may hold that day.
 */
export async function takeCapacity(storage: CapacityStorage, kind: string, day: string, cap: number, unpaidCap: number | null): Promise<CapacityAnswer> {
  if (!KIND.test(kind) || !DAY.test(day) || !whole(cap) || !(unpaidCap === null || whole(unpaidCap))) throw new Error("capacity: invalid request");
  return storage.transaction(async (txn) => {
    const row = onDay(await txn.get<CapacityRow>(rowKey(kind)), day);
    if (row.used >= cap) return "full";
    if (unpaidCap !== null && row.unpaid >= unpaidCap) return "unpaid_full";
    await txn.put(rowKey(kind), { day, used: row.used + 1, unpaid: row.unpaid + (unpaidCap === null ? 0 : 1) } satisfies CapacityRow);
    return "ok";
  });
}

/** Gives a slot back (the metered call failed before it cost anything). A slot of another day is not touched. */
export async function giveBackCapacity(storage: CapacityStorage, kind: string, day: string, unpaid: boolean): Promise<void> {
  if (!KIND.test(kind) || !DAY.test(day)) throw new Error("capacity: invalid request");
  await storage.transaction(async (txn) => {
    const stored = await txn.get<CapacityRow>(rowKey(kind));
    if (!stored || stored.day !== day || !whole(stored.used) || !whole(stored.unpaid) || stored.used < 1) return;
    await txn.put(rowKey(kind), { day, used: stored.used - 1, unpaid: unpaid ? Math.max(0, stored.unpaid - 1) : stored.unpaid } satisfies CapacityRow);
  });
}

/** What is counted for `kind` today, for reports and tests. */
export async function readCapacity(storage: CapacityStorage, kind: string, day: string): Promise<CapacityRow> {
  return storage.transaction(async (txn) => onDay(await txn.get<CapacityRow>(rowKey(kind)), day));
}
