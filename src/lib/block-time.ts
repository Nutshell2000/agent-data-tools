/**
 * Block times read from the chain, not assumed (1.143.0, 11 Nov 2026).
 *
 * Base moved from 2-second to 0.2-second blocks around 5 Nov 2026 (measured from public nodes on 11 Nov: 1,000,000
 * blocks back = 200,000 s; 3,000,000 back = 1,234,440 s). Every tool that turned "days" or "minutes" into a block count
 * with a fixed 2 s then read a tenth of the time it named: /x402/seller-record called a 5-hour read "2 days, complete",
 * /wallet/balance-history labelled blocks 2.4 hours apart as days. So time-to-block conversions measure the chain:
 * `recentBlockSeconds` for "about how long" and `blockAtTime` for "the block at that moment", which also holds across a
 * change of block time inside the window. `NOMINAL_BLOCK_SECONDS` is only the fallback when the chain cannot be read.
 */
import type { PublicClient } from "viem";

/** Measured 11 Nov 2026 over the last 20,000 blocks of each network's public node. A fallback only: block times change. */
export const NOMINAL_BLOCK_SECONDS: Record<string, number> = {
  base: 0.2, eth: 12, arb: 0.31, op: 2, polygon: 1.5, avax: 0.97, gnosis: 5.1, linea: 10, zksync: 4.4, scroll: 7.3,
  mantle: 2, celo: 1, sonic: 1.6, unichain: 1, hyperevm: 1, bera: 2, ink: 1, sei: 0.5,
};

const SAMPLE = 20_000n;
const KEEP_MS = 10 * 60_000;
/** Plain numbers per network, kept ten minutes (never a client or a promise: see the viem note in CLAUDE.md). */
const measured = new Map<string, { at: number; secs: number }>();

type Clock = Pick<PublicClient, "getBlock">;
const tsOf = async (cl: Clock, block: bigint) => Number((await cl.getBlock({ blockNumber: block })).timestamp);

/** Seconds per block over the last 20,000 blocks, read from the chain (two headers), else the measured fallback. */
export async function recentBlockSeconds(cl: Clock, slug: string, latest: bigint, now = Date.now()): Promise<number> {
  const hit = measured.get(slug);
  if (hit && now - hit.at < KEEP_MS) return hit.secs;
  const fallback = NOMINAL_BLOCK_SECONDS[slug] ?? 2;
  if (latest <= SAMPLE) return fallback;
  try {
    const [a, b] = await Promise.all([tsOf(cl, latest), tsOf(cl, latest - SAMPLE)]);
    const secs = (a - b) / Number(SAMPLE);
    if (!(secs > 0) || !Number.isFinite(secs)) return fallback;
    measured.set(slug, { at: now, secs });
    return secs;
  } catch {
    return fallback;
  }
}

export type Sample = { block: bigint; ts: number };

/** The block whose time is closest to `target` by linear interpolation between the two samples around it. */
export function interpolate(samples: Sample[], target: number, fallbackSecs: number): bigint {
  const s = [...samples].sort((x, y) => (x.block < y.block ? -1 : 1));
  let lo: Sample | undefined, hi: Sample | undefined;
  for (const p of s) { if (p.ts <= target) lo = p; if (p.ts >= target && !hi) hi = p; }
  if (lo && hi) {
    if (hi.ts === lo.ts) return lo.block;
    const f = (target - lo.ts) / (hi.ts - lo.ts);
    return lo.block + BigInt(Math.round(f * Number(hi.block - lo.block)));
  }
  // Outside the samples: extend from the nearest one with the slope of the nearest pair (or the fallback rate).
  const edge = (lo ?? hi)!;
  const i = s.indexOf(edge);
  const other = s[i === 0 ? 1 : i - 1];
  const rate = other && other.ts !== edge.ts ? Math.abs(Number(edge.block - other.block) / (edge.ts - other.ts)) : 1 / fallbackSecs;
  const guess = edge.block + BigInt(Math.round((target - edge.ts) * rate));
  return guess < 0n ? 0n : guess;
}

/**
 * The block at (or within `tolerance` seconds of) unix time `target`, at or before `head`: regula falsi over real block
 * headers, at most `tries` reads. Every header read is added to `samples`, so several targets can share the work.
 * Returns the block and its real time; `exact` is false when the reads ran out before the tolerance was met.
 */
export async function blockAtTime(cl: Clock, head: Sample, target: number, opts: { secs: number; tolerance?: number; tries?: number; samples?: Sample[] }) {
  const samples = opts.samples ?? [head];
  if (!samples.some((p) => p.block === head.block)) samples.push(head);
  const tolerance = opts.tolerance ?? 60;
  if (target >= head.ts) return { block: head.block, ts: head.ts, exact: true };
  let best: Sample = head;
  let lastSide = 0, sameSide = 0;
  for (let i = 0; i < (opts.tries ?? 24); i++) {
    // Interpolation lands in one read on a stretch with one block time. Across a change of block time it keeps landing
    // on the same side of the target (regula falsi's slow end), so after two such reads the next guess bisects.
    let guess = interpolate(samples, target, opts.secs);
    if (sameSide >= 2) {
      const lo = samples.filter((p) => p.ts <= target).reduce<Sample | undefined>((m, p) => (!m || p.block > m.block ? p : m), undefined);
      const hi = samples.filter((p) => p.ts >= target).reduce<Sample | undefined>((m, p) => (!m || p.block < m.block ? p : m), undefined);
      if (lo && hi) guess = (lo.block + hi.block) / 2n;
    }
    if (guess > head.block) guess = head.block;
    if (guess < 0n) guess = 0n;
    const known = samples.find((p) => p.block === guess);
    const ts = known ? known.ts : await tsOf(cl, guess);
    if (!known) samples.push({ block: guess, ts });
    if (Math.abs(ts - target) < Math.abs(best.ts - target)) best = { block: guess, ts };
    if (Math.abs(ts - target) <= tolerance) return { block: guess, ts, exact: true };
    if (known && sameSide >= 2) break; // the bracket cannot narrow any further
    const side = ts < target ? -1 : 1;
    sameSide = side === lastSide ? sameSide + 1 : 1;
    lastSide = side;
  }
  return { block: best.block, ts: best.ts, exact: Math.abs(best.ts - target) <= tolerance };
}

export const __test = { measured };
