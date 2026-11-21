import { HttpError, type Env } from "./env";
import { switchedOff } from "./switches";
import { isUnpaidCall, markUnpaidCall } from "./unpaid-call";

/**
 * Of a metered resource's daily cap, the part that UNPAID use may take (21 Nov 2026): free calls, free keys, voice test
 * keys, the capped PDF try and the free pages. With AI_DAILY_CAP 1,000 that is 300 calls; the other 700 can only be
 * used by calls that are paid for, and paid calls may use all 1,000. Before this, free traffic and paying buyers drew
 * from one count, so a day of free calls could leave buyers with 503 until midnight.
 */
export const UNPAID_SHARE = 0.3;
/** The slots unpaid use may hold of a cap: 30%, rounded down, never fewer than one. */
export const unpaidCapOf = (cap: number) => Math.max(1, Math.floor(cap * UNPAID_SHARE));

/** Budgets that only free offers draw from: a call that takes one of these is unpaid by definition. */
const UNPAID_ONLY_KINDS: ReadonlySet<string> = new Set(["lexglyph", "pdftry", "pdftry-upload"]);

/** How long the exact counter may take before the call goes on without it (it normally answers in a few milliseconds). */
const COUNTER_WAIT_MS = 2_000;

/** A taken slot. `giveBack` returns it when the metered call failed before it cost anything; it never rejects. */
export interface BudgetSlot { giveBack(): Promise<void> }
const NO_SLOT: BudgetSlot = { giveBack: async () => {} };

const utcDay = () => new Date().toISOString().slice(0, 10);

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export interface ExactBudget {
  /** Counter name: "ai", "browser", "search". */
  kind: string;
  cap: number;
  /** The KV key of the approximate count, used only while the exact counter cannot be reached. */
  kvKey: string;
  /** The refusal when the day's cap is used up. */
  full: () => HttpError;
  /** The refusal for an unpaid call when the unpaid share is used up (paid calls still pass). */
  unpaidFull: () => HttpError;
}

/**
 * One slot of a metered resource, counted exactly in the Metrics Durable Object (lib/capacity-count.ts): the take is
 * one transaction, so parallel calls cannot pass the cap, and unpaid calls stop at their share (UNPAID_SHARE).
 *
 * The counter must never cost a sale. When it cannot be reached (no binding, an error, no answer in two seconds) the
 * old approximate KV count is used instead, and when that fails too the call simply goes on, with a log line: a paid
 * call is worth more than an exact count on a bad day.
 */
export async function takeExactBudget(env: Env, budget: ExactBudget): Promise<BudgetSlot> {
  const { kind, cap, kvKey } = budget;
  const day = utcDay();
  const unpaid = isUnpaidCall();
  if (env.METRICS) {
    // Only a failure of the counter itself is caught here; the refusals below are thrown outside the try, so a full
    // day can never be mistaken for a broken counter and waved through.
    let counter: DurableObjectStub<import("../metrics").Metrics> | undefined;
    let answer: unknown;
    try {
      counter = env.METRICS.get(env.METRICS.idFromName("global"));
      answer = await within(counter.capacityTake(kind, day, cap, unpaid ? unpaidCapOf(cap) : null), COUNTER_WAIT_MS);
      if (answer !== "ok" && answer !== "full" && answer !== "unpaid_full") throw new Error(`unexpected answer ${String(answer)}`);
    } catch (e) {
      answer = undefined;
      console.error(`daily cap ${kind}: exact counter unavailable, using the approximate count (${e instanceof Error ? e.message : String(e)})`);
    }
    if (answer === "full") throw budget.full();
    if (answer === "unpaid_full") throw budget.unpaidFull();
    if (answer === "ok" && counter) {
      const taken = counter;
      return { giveBack: async () => { try { await within(taken.capacityGiveBack(kind, day, unpaid), COUNTER_WAIT_MS); } catch (e) { console.error(`daily cap ${kind}: giving a slot back failed`, e); } } };
    }
  }
  if (!env.TRIALS) return NO_SLOT;
  const kv = env.TRIALS;
  let used: number;
  try { used = Number(await kv.get(kvKey)) || 0; }
  catch (e) { console.error(`daily cap ${kind}: no counter could be read; the call goes on uncounted`, e); return NO_SLOT; }
  if (used >= cap) throw budget.full();
  // KV accepts about one write a second to one key; a refused write must not fail the call that is about to run.
  try { await kv.put(kvKey, String(used + 1), { expirationTtl: 172_800 }); }
  catch (e) { console.error(`daily cap ${kind}: the approximate count could not be written; the call goes on`, e); return NO_SLOT; }
  return {
    giveBack: async () => {
      try { const now = Number(await kv.get(kvKey)) || 0; if (now > 0) await kv.put(kvKey, String(now - 1), { expirationTtl: 172_800 }); }
      catch (e) { console.error(`daily cap ${kind}: giving a slot back failed`, e); }
    },
  };
}

/**
 * A per-UTC-day call budget for a metered upstream (Workers AI, Browser Rendering) or a free offer. On the Workers
 * free plan the platform's own daily allowance stops these first; on Workers Paid they are billed per use, so the cap
 * is what keeps the bill at the plan price (the owner, 24 Oct 2026: the $5 plan only once $5 has been earned, and
 * never a bill above it). Over the cap the tool answers 503 and nothing is charged.
 *
 * `exact` (21 Nov 2026) is set for the resources that paying buyers need (AI, the hosted browser): they are counted in
 * the Metrics object, exactly, with a share for unpaid use (takeExactBudget). The free offers' own budgets (the PDF
 * try, the LexGlyph page, payee claims) stay in KV, where an approximate count is enough.
 */
export async function takeDailyBudget(env: Env, kind: string, capSetting: string | undefined, defaultCap: number, what: string, exact = false): Promise<BudgetSlot> {
  // A free offer's own budget is being taken: whatever this call goes on to use (AI, the browser) is unpaid use.
  if (UNPAID_ONLY_KINDS.has(kind)) markUnpaidCall();
  // No KV binding (unit tests, odd deployments) and no exact counter: nothing to count against, so nothing is refused.
  if (!env.TRIALS && !(exact && env.METRICS)) return NO_SLOT;
  // The operator's off-switch for this resource (lib/switches.ts): refused before anything is counted or run.
  if (await switchedOff(env, kind)) throw new HttpError(503, `${what} calls are paused by the operator right now; nothing was charged, try again later`, "PAUSED_BY_OPERATOR");
  const cap = Number(capSetting) || defaultCap;
  if (cap <= 0) return NO_SLOT;
  const key = `cap:${kind}:${utcDay()}`;
  if (exact) {
    return takeExactBudget(env, {
      kind, cap: Math.floor(cap), kvKey: key,
      full: () => new HttpError(503, `today's ${what} capacity is used up; try again after 00:00 UTC`, "DAILY_CAPACITY"),
      unpaidFull: () => new HttpError(503, `today's ${what} capacity for free calls is used up; paid calls still run, and free ones again after 00:00 UTC`, "DAILY_CAPACITY"),
    });
  }
  const kv = env.TRIALS!;
  const used = Number(await kv.get(key)) || 0;
  if (used >= cap) throw new HttpError(503, `today's ${what} capacity is used up; try again after 00:00 UTC`, "DAILY_CAPACITY");
  await kv.put(key, String(used + 1), { expirationTtl: 172_800 });
  return { giveBack: () => refundDailyBudget(env, kind).catch((e: unknown) => { console.error(`daily cap ${kind}: giving a slot back failed`, e); }) };
}

/** Give back a daily slot when the tool failed, so a failed free try does not burn a scarce shared allowance. */
export async function refundDailyBudget(env: Env, kind: string): Promise<void> {
  if (!env.TRIALS) return;
  const key = `cap:${kind}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number(await env.TRIALS.get(key)) || 0;
  if (used > 0) await env.TRIALS.put(key, String(used - 1), { expirationTtl: 172_800 });
}
