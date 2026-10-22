// Shared retry timing for outside sources. Workers share egress IPs, so a per-IP limit at an upstream can refuse a
// caller who sent nothing before; one short retry gets most of those through.

/** How long to wait before one retry of a 429 or 5xx: Retry-After up to 2 s, else 700 ms; null when the source asks for longer. */
export function retryDelayMs(res: Response): number | null {
  const after = res.headers.get("retry-after");
  if (after === null) return 700;
  const seconds = Number(after);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 2 ? Math.max(seconds * 1000, 200) : null;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
