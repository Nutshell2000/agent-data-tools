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
/** One caller per IPv4 address or per IPv6 /64 (a home or server usually holds a whole /64, so each address in it is the same caller). */
export const addressBucket = (ip: string | undefined): string => {
  const raw = (ip ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (!raw.includes(":")) return raw;
  // Expand "::" before slicing: raw.split(":").slice(0,4) is misaligned when the shorthand compresses zeros inside
  // the first four groups (e.g. 2601:646:100::1 -> "2601:646:100:"). Canonicalize to eight hextets first so both
  // textual forms of one /64 bucket together and a short address is not mistaken for a whole /32.
  const [head = "", tail = ""] = raw.split("::");
  const h = head ? head.split(":").filter(Boolean) : [];
  const t = tail ? tail.split(":").filter(Boolean) : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return groups.slice(0, 4).join(":");
};

/**
 * The caller identity: a hash of the connecting address, so no raw address is stored. An IPv6 caller is its /64
 * (21 Nov 2026): counted per full address, one host could take a fresh allowance from each of its 2^64 addresses.
 * IPv4 callers hash exactly as before, so their counters carry on; an IPv6 caller's counters start again once.
 */
export async function callerHash(ip: string): Promise<string> {
  const bucket = ip.includes(":") && /^[0-9a-f:.]+$/i.test(ip.trim()) ? addressBucket(ip) : ip;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`free-calls:${bucket}`)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const utcDay = () => new Date().toISOString().slice(0, 10);

export function freeCallNote(left: number, origin: string) {
  return `Free call (${left} of ${FREE_CALLS_PER_CALLER} free calls left for this caller). After that, pay per call with x402, or buy a prepaid key by card at ${origin}/credits and send it as "Authorization: Bearer <key>".`;
}

// Free MCP calls per connection (16 Nov 2026). Cloud assistants reach /mcp from a few shared addresses, so their users
// shared, and used up, one allowance per address. The server now hands each MCP connection a signed token at
// initialize (lib/free-sessions.ts; it travels as Mcp-Session-Id) and counts that connection's free calls on the token.
// What keeps it from becoming a tap for free calls:
//   - only a token this service signed is honoured (a made-up one is counted on the address, as before);
//   - a token gets its own allowance at its first free call, and only FREE_SESSIONS_PER_ADDRESS_PER_DAY tokens per
//     address hash and UTC day do; a later connection from that address is counted on the address, as before;
//   - a token that used its calls is used up (it does not fall back to the address's);
//   - FREE_CALLS_PER_DAY, the total for everybody, is unchanged.
// Nothing is written when a token is issued: the first write is the first free call, which wrote already.
export const FREE_SESSIONS_PER_ADDRESS_PER_DAY = 3;
const sessionCaller = (id: string) => `session:${id}`;
const admittedKey = (addressHash: string) => `free:sessions:${addressHash}`;
const SESSION_SECRET_KEY = "free:session-secret";

/** The key session tokens are signed with: made once and kept in this object's storage, so no secret has to be set. */
export async function freeSessionSecret(storage: FreeCallStorage): Promise<string> {
  return storage.transaction(async (txn) => {
    const kept = await txn.get<string>(SESSION_SECRET_KEY);
    if (kept) return kept;
    const made = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await txn.put(SESSION_SECRET_KEY, made);
    return made;
  });
}

/**
 * Takes one free call for a connection whose token was verified. `caller` is the counter that was used (the token's, or
 * the address's when this address has admitted its tokens for the day): a refund must name the same one.
 */
export async function takeSessionFreeCall(storage: FreeCallStorage, sessionId: string, addressHash: string, day: string, limit = FREE_CALLS_PER_CALLER, perAddress = FREE_SESSIONS_PER_ADDRESS_PER_DAY): Promise<{ left: number | null; caller: string }> {
  return storage.transaction(async (txn) => {
    const own = sessionCaller(sessionId);
    const known = (await txn.get<number>(callerKey(own))) !== undefined;
    const admitted = usedOn(await txn.get<DayCount>(admittedKey(addressHash)), day);
    const caller = known || admitted < perAddress ? own : addressHash;
    const used = (await txn.get<number>(callerKey(caller))) ?? 0;
    const today = (await txn.get<number>(dayKey(day))) ?? 0;
    if (used >= limit || today >= FREE_CALLS_PER_DAY) return { left: null, caller };
    if (caller === own && !known) await txn.put(admittedKey(addressHash), { day, used: admitted + 1 } satisfies DayCount);
    await txn.put(callerKey(caller), used + 1);
    await txn.put(dayKey(day), today + 1);
    return { left: limit - used - 1, caller };
  });
}
