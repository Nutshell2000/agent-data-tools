import { HttpError, type Env } from "./env";

/**
 * A per-UTC-day call budget for a metered upstream (Workers AI, Browser Rendering), counted in KV like the search cap.
 * On the Workers free plan the platform's own daily allowance stops these first; on Workers Paid they are billed per
 * use, so the cap is what keeps the bill at the plan price (Peter, 24 Oct 2026: the $5 plan only once $5 has been
 * earned, and never a bill above it). Over the cap the tool answers 503 and nothing is charged. KV is eventually
 * consistent, so the cap is approximate.
 */
export async function takeDailyBudget(env: Env, kind: string, capSetting: string | undefined, defaultCap: number, what: string): Promise<void> {
  // No KV binding (unit tests, odd deployments): nothing to count against, so nothing is refused.
  if (!env.TRIALS) return;
  const cap = Number(capSetting) || defaultCap;
  if (cap <= 0) return;
  const key = `cap:${kind}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number(await env.TRIALS.get(key)) || 0;
  if (used >= cap) throw new HttpError(503, `today's ${what} capacity is used up; try again after 00:00 UTC`, "DAILY_CAPACITY");
  await env.TRIALS.put(key, String(used + 1), { expirationTtl: 172_800 });
}
