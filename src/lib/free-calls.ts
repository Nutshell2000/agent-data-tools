// Free calls: every caller (hashed IP) gets a small allowance of successful calls before paying, so an
// agent can try a tool before its user buys credits. MCP uses it automatically; HTTP opts in with trial=1
// so ordinary unpaid requests still get the 402 challenge that directories and validators probe for.
// Counted in the Metrics Durable Object instance "credits", so the limits are exact.

//
// 21 Nov 2026, the owner: a free user must cost nothing metered, "very minimal free calls", and everything free
// together must never be able to cost more than $5 a month, by code. So a free call runs only a tool outside
// FREE_EXCLUDED_METERED (lib/capacity.ts: nothing that can spend model money, browser rendering, paid search, resold
// data or a Vectorize query), and the numbers went down: MCP 25 -> 10 per caller, the day's total 2,000 -> 500.
// What is left costs requests only, and FREE_CALLS_PER_DAY bounds those: 500 a day is about 15,500 tool runs a month.
// Every text that names a number or the kind of tool reads it from the constants below.

/** Free successful calls per caller over MCP (anonymous per connection or address, signed in per account). */
export const FREE_CALLS_PER_CALLER = 10;
/** Free calls a UTC day for everybody together, HTTP and MCP: the hard ceiling of the free calls. */
export const FREE_CALLS_PER_DAY = 500;
/**
 * Successful calls a free key (lib/free-keys.ts) makes each calendar month, on the same tools as the free calls. Free
 * keys are switched off in production (each sign-up sends an e-mail); the number applies to keys issued from now on,
 * and a key issued earlier keeps the allowance written into its record.
 */
export const FREE_KEY_CALLS_PER_MONTH = 25;
/** The tools a free call runs, for every sentence that says so. */
export const FREE_TOOLS_KIND = "tools that only compute or look up public data";
/** What a free call never runs, for the same sentences. */
export const FREE_NOT_FOR = "not AI, speech, transcription, images, rendering, search or resold data";
/** The sentence that follows a statement of the free calls. */
export const FREE_REST_PAID = "Everything else is prepaid or paid per call.";
// 10 Nov 2026, the owner: "from 25 to 3 is good!" In 15 days 14,352 free calls over plain HTTP (11,047 of them /pdf/text from
// browser-type callers on many addresses) and 24,304 "used up" answers produced no purchase at all. So HTTP trial=1 gives 3
// calls per caller; MCP kept 25 then, because app directories test the server without paying (10 since 21 Nov 2026).
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
/**
 * One caller per IPv4 address or per IPv6 /64 (a home or server usually holds a whole /64, so each address in it is the same caller).
 * Every textual form of one address gives the same bucket: "::" is expanded, leading zeros in a group are dropped
 * (2001:0db8::1 is 2001:db8::1), brackets and a zone are ignored, and an IPv4 address written inside IPv6
 * (::ffff:192.0.2.7 or ::ffff:c000:207) is that IPv4 address, not the all-zero /64 every such address shares.
 * Text that is not an address is its own bucket, unchanged.
 */
export const addressBucket = (ip: string | undefined): string => {
  const raw = (ip ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (!raw.includes(":")) return raw;
  let text = raw.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  // A dotted IPv4 tail is two groups.
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const n = dotted.slice(2).map(Number);
    if (n.some((x) => x > 255)) return raw;
    text = `${dotted[1]}${((n[0] << 8) | n[1]).toString(16)}:${((n[2] << 8) | n[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return raw;
  const part = (h: string) => (h ? h.split(":") : []);
  const head = part(halves[0]), tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 2 && fill === 0)) return raw;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return raw;
  const g = groups.map((x) => parseInt(x, 16));
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  return g.slice(0, 4).map((x) => x.toString(16)).join(":");
};

/**
 * The caller identity: a hash of the connecting address, so no raw address is stored. An IPv6 caller is its /64
 * (21 Nov 2026): counted per full address, one host could take a fresh allowance from each of its 2^64 addresses.
 * IPv4 callers hash exactly as before, so their counters carry on; an IPv6 caller's counters start again once.
 * An IPv4 address written inside IPv6 (::ffff:a.b.c.d) is the same caller as that IPv4 address.
 */
export async function callerHash(ip: string): Promise<string> {
  const bucket = ip.includes(":") && /^[0-9a-f:.]+$/i.test(ip.trim()) ? addressBucket(ip) : ip;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`free-calls:${bucket}`)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const utcDay = () => new Date().toISOString().slice(0, 10);

export function freeCallNote(left: number, origin: string) {
  return `Free call (${left} of ${FREE_CALLS_PER_CALLER} free calls left for this caller; they run ${FREE_TOOLS_KIND}, ${FREE_NOT_FOR}). After that, pay per call with x402, or buy a prepaid key by card at ${origin}/credits and send it as "Authorization: Bearer <key>".`;
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
