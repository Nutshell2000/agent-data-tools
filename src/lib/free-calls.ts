// Free calls: every caller (hashed IP) gets a small allowance of successful calls before paying, so an
// agent can try a tool before its user buys credits. MCP uses it automatically; HTTP opts in with trial=1
// so ordinary unpaid requests still get the 402 challenge that directories and validators probe for.
// Counted in the Metrics Durable Object instance "credits", so the limits are exact.

export const FREE_CALLS_PER_CALLER = 25;
export const FREE_CALLS_PER_DAY = 2000;

interface Txn { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> }
export interface FreeCallStorage { transaction<T>(callback: (txn: Txn) => Promise<T>): Promise<T> }

const callerKey = (hash: string) => `free:caller:${hash}`;
const dayKey = (day: string) => `free:day:${day}`;

/** Takes one free call; returns how many the caller has left after it, or null when none can be given. */
export async function takeFreeCall(storage: FreeCallStorage, callerHash: string, day: string): Promise<number | null> {
  return storage.transaction(async (txn) => {
    const used = (await txn.get<number>(callerKey(callerHash))) ?? 0;
    const today = (await txn.get<number>(dayKey(day))) ?? 0;
    if (used >= FREE_CALLS_PER_CALLER || today >= FREE_CALLS_PER_DAY) return null;
    await txn.put(callerKey(callerHash), used + 1);
    await txn.put(dayKey(day), today + 1);
    return FREE_CALLS_PER_CALLER - used - 1;
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

/** The caller identity: a hash of the connecting IP, so no raw address is stored. */
export async function callerHash(ip: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`free-calls:${ip}`)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const utcDay = () => new Date().toISOString().slice(0, 10);

export function freeCallNote(left: number, origin: string) {
  return `Free call (${left} of ${FREE_CALLS_PER_CALLER} free calls left for this caller). After that, pay per call with x402, or buy a prepaid key by card at ${origin}/credits and send it as "Authorization: Bearer <key>".`;
}
