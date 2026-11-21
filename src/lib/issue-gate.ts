// One counted slot for issuing a free key (21 Nov 2026). The per-address caps on free keys, voice test keys and trial
// keys were read from KV and written back, so requests sent at the same moment all read the same number and all
// passed: fifty parallel sign-ups from one address got fifty confirmation mails or keys instead of the allowed few.
// The credit store's free-call counter is a Durable Object transaction, so it counts each request exactly once.
//
// The KV day totals stay where they were and are checked first: this counter is only asked once a request is otherwise
// allowed, so it holds at most about one small record per issued key.
import type { Env } from "./env";

/**
 * Takes one of `limit` slots for `caller` (a hash, never an address) under `name` today. True when the slot was taken.
 * `null` when the counter cannot be reached: the caller then keeps its own (approximate) check, as before.
 */
export async function takeIssueSlot(env: Env, name: string, day: string, caller: string, limit: number): Promise<boolean | null> {
  const store = env.METRICS?.get(env.METRICS.idFromName("credits"));
  if (!store) return null;
  try {
    return (await store.takeFreeCall(`issue:${name}:${day}:${caller}`, `issue:${name}:${day}`, limit)) !== null;
  } catch (e) {
    console.error("issue gate: counter unavailable", e);
    return null;
  }
}
