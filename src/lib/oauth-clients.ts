// OAuth client registrations: a daily limit per network address and an expiry while unused (21 Nov 2026).
//
// Registration (RFC 7591) has to stay open: Claude, ChatGPT and other apps register a client by themselves when a
// person adds the connector, with no account and no secret. But it was also unlimited and for ever: every POST wrote a
// record that was never removed, so anyone could grow the store without end.
//
// Bounds, all chosen so that no real app is turned away:
// - A registration that is never used to complete a sign-in is removed after UNUSED_CLIENT_DAYS. A client that
//   completed one sign-in is kept for good, as before: apps keep their client id and come back with it months later.
//   Records written before this change carry no expiry and are never removed.
// - At most REGISTRATIONS_PER_ADDRESS_PER_DAY registrations per network address (IPv4 address or IPv6 /64) and UTC
//   day. Cloud apps register for all their users from a few addresses, so the number is far above what one app's new
//   users need in a day here, and it only stops a flood from one place. A request with no known address is not limited
//   per address. The count is one small record per address and day, removed two days later.
// - At most REGISTRATIONS_PER_DAY registrations a day from everybody together, so a flood from many addresses cannot
//   grow the store either: unused registrations can never be more than that number times UNUSED_CLIENT_DAYS.
// - Authorization codes and hashed tokens are written with their expiry (putExpiring) and removed once it has passed.
//   Before, a code that was never exchanged and every expired token stayed for ever.
//
// Nothing here has a timer: each write removes a few records whose time is over (SWEEP), so the store shrinks at
// least as fast as it is written to.
//
// Runs inside the Metrics Durable Object ("credits" instance), so the count is exact.

export const UNUSED_CLIENT_DAYS = 30;
export const REGISTRATIONS_PER_ADDRESS_PER_DAY = 500;
export const REGISTRATIONS_PER_DAY = 5000;
/** Expired records of each kind removed per write: the cleanup rides on writes, with no timer. */
const SWEEP = 50;

export interface StoredClient { clientId: string; clientName: string; redirectUris: string[]; createdAt: string; /** Set while no sign-in was completed: when the record may be removed (ms). */ unusedUntil?: number }
export interface ClientRegistration { client: StoredClient; /** Hash of the registering address bucket, or null when unknown. */ address: string | null; day: string; now: number }

interface Txn { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<boolean> }
export interface ClientStorage {
  transaction<T>(callback: (txn: Txn) => Promise<T>): Promise<T>;
  list<T>(options: { prefix: string; end?: string; limit?: number }): Promise<Map<string, T>>;
  delete(keys: string[]): Promise<number>;
}

const clientKey = (id: string) => `oauth:client:${id}`;
const UNUSED_PREFIX = "oauth:unused:";
const unusedKey = (until: number, id: string) => `${UNUSED_PREFIX}${new Date(until).toISOString()}:${id}`;
const countKey = (day: string, address: string) => `oauth:regs:${day}:${address}`;
const TOTAL_KEY = "oauth:regs-total";
interface DayCount { day: string; used: number }
/** One entry per record that ends by itself (a code, a token, a day's count): its time, then the record's own key. */
const EXPIRY_PREFIX = "oauth:exp:";
const expiryKey = (at: number, key: string) => `${EXPIRY_PREFIX}${new Date(at).toISOString()}:${key}`;
const COUNT_KEPT_MS = 2 * 86_400_000;

/** Removes up to SWEEP records whose time is over, with their entries. Never throws: cleaning must not fail a write. */
export async function sweepExpired(storage: ClientStorage, now: number): Promise<number> {
  try {
    const old = await storage.list<string>({ prefix: EXPIRY_PREFIX, end: `${EXPIRY_PREFIX}${new Date(now).toISOString()}`, limit: SWEEP });
    if (!old.size) return 0;
    await storage.delete([...old.keys(), ...[...old.values()].map(String).filter((k) => k.startsWith("oauth:"))]);
    return old.size;
  } catch (e) {
    console.error("oauth: removing expired records failed", e);
    return 0;
  }
}

/** Stores a record that is removed after `expiresAt` (an authorization code, a hashed token). `key` is the storage key. */
export async function putExpiring(storage: ClientStorage, key: string, value: unknown, expiresAt: number, now: number): Promise<void> {
  if (!key.startsWith("oauth:") || !Number.isFinite(expiresAt)) throw new Error("oauth: invalid expiring record");
  await storage.transaction(async (txn) => {
    await txn.put(key, value);
    await txn.put(expiryKey(expiresAt, key), key);
  });
  await sweepExpired(storage, now);
}

/** True when a registration was never used and its time is over: it is treated as unknown even before it is removed. */
export const clientExpired = (client: { unusedUntil?: number } | null | undefined, now: number) =>
  typeof client?.unusedUntil === "number" && client.unusedUntil < now;

/** Stores a new client, or answers "limit" when this address, or everybody together, has registered the day's worth. */
export async function registerClient(storage: ClientStorage, r: ClientRegistration, perDay = REGISTRATIONS_PER_ADDRESS_PER_DAY, unusedDays = UNUSED_CLIENT_DAYS, totalPerDay = REGISTRATIONS_PER_DAY): Promise<"ok" | "limit"> {
  if (!/^adtc_[A-Za-z0-9_-]{10,60}$/.test(r.client?.clientId ?? "")) throw new Error("oauth: invalid client");
  const until = r.now + unusedDays * 86_400_000;
  const answer = await storage.transaction(async (txn) => {
    const total = await txn.get<DayCount>(TOTAL_KEY);
    const all = total && total.day === r.day ? total.used : 0;
    if (all >= totalPerDay) return "limit" as const;
    if (r.address) {
      const key = countKey(r.day, r.address);
      const count = await txn.get<DayCount>(key);
      const used = count && count.day === r.day ? count.used : 0;
      if (used >= perDay) return "limit" as const;
      await txn.put(key, { day: r.day, used: used + 1 } satisfies DayCount);
      // The count is for this day only: its record goes two days later.
      if (!count) await txn.put(expiryKey(r.now + COUNT_KEPT_MS, key), key);
    }
    await txn.put(TOTAL_KEY, { day: r.day, used: all + 1 } satisfies DayCount);
    await txn.put(clientKey(r.client.clientId), { ...r.client, unusedUntil: until } satisfies StoredClient);
    await txn.put(unusedKey(until, r.client.clientId), r.client.clientId);
    return "ok" as const;
  });
  // Remove registrations whose time ran out. A failure here must never fail the registration that was just stored.
  try {
    const old = await storage.list<string>({ prefix: UNUSED_PREFIX, end: `${UNUSED_PREFIX}${new Date(r.now).toISOString()}`, limit: SWEEP });
    if (old.size) await storage.delete([...old.keys(), ...[...old.values()].map((id) => clientKey(String(id)))]);
  } catch (e) {
    console.error("oauth: removing expired registrations failed", e);
  }
  await sweepExpired(storage, r.now);
  return answer;
}

/** A sign-in was completed with this client: it is kept from now on. */
export async function markClientUsed(storage: ClientStorage, clientId: string): Promise<void> {
  await storage.transaction(async (txn) => {
    const client = await txn.get<StoredClient>(clientKey(clientId));
    if (!client || typeof client.unusedUntil !== "number") return;
    const { unusedUntil, ...kept } = client;
    await txn.delete(unusedKey(unusedUntil, clientId));
    await txn.put(clientKey(clientId), kept);
  });
}
