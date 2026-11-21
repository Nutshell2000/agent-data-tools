// Whether the tool call that is running is UNPAID (21 Nov 2026): a free call, one of a free key's monthly calls, a
// free voice test or trial key, the capped PDF try or a free page's own search. The daily budget of a metered upstream
// (lib/daily-cap.ts) gives unpaid calls only a share of the day, so paid calls always find room.
//
// The mark rides on the request's funnel trace (lib/funnel.ts), which already follows the call through every await,
// so no new context has to be threaded through the tools. An MCP tool call has its own trace, so a mark never leaks
// from one tool call of a connection to the next.
//
// A call is unpaid ONLY when something marked it. Everything else counts as paid: a wrong guess must never take
// capacity away from a buyer.
import { activeTrace } from "./funnel";

const unpaidTraces = new WeakSet<object>();

/** Call this where a free allowance has just been taken for the running call, before the tool runs. */
export function markUnpaidCall(): void {
  const trace = activeTrace();
  if (trace) unpaidTraces.add(trace);
}

/** True when the running call was marked unpaid. False when nothing is known. */
export function isUnpaidCall(): boolean {
  const trace = activeTrace();
  return Boolean(trace && unpaidTraces.has(trace));
}
