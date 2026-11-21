import type { Env } from "./env";

/**
 * Off-switches the operator can flip without a release (21 Nov 2026). Before this, stopping a free offer or a metered
 * upstream that was being abused meant a full release (about 25 minutes) while the spend went on.
 *
 * One KV value, key `switches` in TRIALS, holds a JSON object whose keys are switch names and whose value "off" stops
 * that thing; anything else, a missing key or a missing value leaves it running:
 *   free        the free calls (HTTP trial=1 and MCP)
 *   free-keys   free keys by e-mail (no new sign-ups, no new keys)
 *   voice-keys  free voice test and trial keys (no new keys, and issued ones stop working)
 *   ai          every Workers AI call, paid ones too (503, nothing charged)
 *   browser     every hosted-browser call, paid ones too
 *   search      every paid-search upstream call
 * and any other name `takeDailyBudget` is called with (lib/daily-cap.ts).
 *
 *   npx wrangler kv key put --binding TRIALS --remote switches "{\"free\":\"off\"}"      stop
 *   npx wrangler kv key delete --binding TRIALS --remote switches                        everything back on
 *
 * Cost: the value is read only where something free or metered is about to be given, never on a plain unpaid quote,
 * and each isolate keeps what it read for a minute. So a switch takes up to a minute to reach every isolate (plus
 * KV's own propagation, usually under a minute).
 */
export const SWITCHES_KEY = "switches";
const MEMO_MS = 60_000;

let memo: { at: number; off: ReadonlySet<string> } | undefined;

/** For tests: forget what this isolate read. */
export const forgetSwitches = () => { memo = undefined; };

/** The names switched off in a stored value; a value that is not a JSON object switches nothing off. */
export function switchedOffNames(raw: string | null | undefined): ReadonlySet<string> {
  const off = new Set<string>();
  if (!raw) return off;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [name, value] of Object.entries(parsed)) if (value === "off") off.add(name);
    }
  } catch {
    // An unreadable value must never stop the service: nothing is off.
  }
  return off;
}

/** True when the operator switched `name` off. Never throws; when the value cannot be read, nothing is off. */
export async function switchedOff(env: Pick<Env, "TRIALS">, name: string): Promise<boolean> {
  if (!env.TRIALS) return false;
  if (!memo || Date.now() - memo.at >= MEMO_MS) {
    const raw = await env.TRIALS.get(SWITCHES_KEY).catch(() => null);
    memo = { at: Date.now(), off: switchedOffNames(typeof raw === "string" ? raw : null) };
  }
  return memo.off.has(name);
}
