// mppx replay protection backed by the "global" Durable Object. A signed Tempo payment can be mined only
// once, and mppx recovers the earlier receipt when the same transaction is broadcast again, so a replay
// marker kept in one isolate's memory would let a second isolate serve a replayed credential for free.
// Every isolate therefore claims through this one object.
import type { Store } from "mppx";
import type { Env } from "./env";

interface Marker { expires: number; type: "mppx:replay" }
const isLive = (value: unknown, now: number) =>
  value !== undefined && value !== null && !((value as Marker).type === "mppx:replay" && (value as Marker).expires <= now);

/** First use of `key` until `expires` (ms): true for the caller that recorded it. Durable Object side. */
export async function claimReplay(storage: DurableObjectStorage, key: string, expires: number): Promise<boolean> {
  if (!Number.isSafeInteger(expires)) throw new Error("invalid replay expiry");
  const now = Date.now();
  const claimed = await storage.transaction(async (txn) => {
    if (isLive(await txn.get(`mpp:${key}`), now)) return false;
    await txn.put(`mpp:${key}`, { expires, type: "mppx:replay" } satisfies Marker);
    await txn.put(`mppexp:${String(expires).padStart(15, "0")}:${key}`, key);
    return true;
  });
  // Bounded opportunistic cleanup of lapsed markers, as the funnel does; no alarm or scheduled run.
  const lapsed = await storage.list<string>({ prefix: "mppexp:", end: `mppexp:${String(now).padStart(15, "0")}`, limit: 20 });
  for (const [indexKey, markerKey] of lapsed) {
    await storage.transaction(async (txn) => {
      const marker = await txn.get<Marker>(`mpp:${markerKey}`);
      // A key claimed again later carries a newer expiry: only the lapsed marker this index names goes.
      if (marker?.type === "mppx:replay" && `mppexp:${String(marker.expires).padStart(15, "0")}:${markerKey}` === indexKey) await txn.delete(`mpp:${markerKey}`);
      await txn.delete(indexKey);
    });
  }
  return claimed;
}

/** Compare-and-set for mppx's atomic update: writes (or deletes, for null) only if the value is unchanged. */
export async function swapReplay(storage: DurableObjectStorage, key: string, expected: string, next: { value: unknown } | null): Promise<boolean> {
  return storage.transaction(async (txn) => {
    if (JSON.stringify((await txn.get(`mpp:${key}`)) ?? null) !== expected) return false;
    if (next) await txn.put(`mpp:${key}`, next.value);
    else await txn.delete(`mpp:${key}`);
    return true;
  });
}

/** The mppx AtomicStore the Tempo charge method uses. Worker side. */
export function replayStore(env: Env): Store.AtomicStore {
  const ledger = () => env.METRICS!.get(env.METRICS!.idFromName("global"));
  return {
    get: async (key) => (await ledger().mppGet(key)) as never,
    put: async (key, value) => { await ledger().mppPut(key, value); },
    delete: async (key) => { await ledger().mppDelete(key); },
    tryClaim: (key, expires) => ledger().mppClaim(key, expires),
    async update(key, fn) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await ledger().mppGet(key);
        const change = fn(current as never);
        if (change.op === "noop") return change.result;
        if (await ledger().mppSwap(key, JSON.stringify(current ?? null), change.op === "set" ? { value: change.value } : null)) return change.result;
      }
      throw new Error("mpp replay store: concurrent update, retry the request");
    },
  };
}
