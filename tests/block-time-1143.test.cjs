// Block times read from the chain (1.143.0, 11 Nov 2026). Base went from 2 s to 0.2 s blocks around 5 Nov 2026, so a
// fixed 2 s made /x402/seller-record call a 5-hour read "2 days, complete" and /wallet/balance-history label blocks
// 2.4 hours apart as days. A fake chain with exactly that change checks the block search, and a fake log node checks
// that the seller record's counts and its coverage always describe the same stretch of chain.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const esbuild = require("esbuild");
const Module = require("node:module");

async function load(entry) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"] });
  const mod = new Module(entry, null);
  mod.filename = entry;
  mod.paths = Module._nodeModulePaths(process.cwd());
  mod._compile(built.outputFiles[0].text, entry);
  return mod.exports;
}

let B, T;
before(async () => {
  B = await load(require.resolve("../src/lib/block-time.ts"));
  T = (await load(require.resolve("../src/routes/trust.ts"))).__test;
});

// Base-like: 2 s blocks until SWITCH, 0.2 s after (timestamps in whole seconds, as Base reports them).
const SWITCH = 37_000_000n, SWITCH_TS = 1_762_300_000;
const tsAt = (b) => (b <= SWITCH ? SWITCH_TS - Number(SWITCH - b) * 2 : SWITCH_TS + Math.floor(Number(b - SWITCH) / 5));
function chain(head) {
  let reads = 0;
  return {
    reads: () => reads,
    getBlock: async ({ blockNumber }) => { reads++; if (blockNumber < 0n || blockNumber > head) throw new Error("no such block"); return { timestamp: BigInt(tsAt(blockNumber)) }; },
  };
}

test("recent block time is read from the chain, with the measured table only as a fallback", async () => {
  const head = SWITCH + 3_000_000n;
  B.__test.measured.clear();
  assert.equal(await B.recentBlockSeconds(chain(head), "base", head, 1), 0.2);
  B.__test.measured.clear();
  const broken = { getBlock: async () => { throw new Error("down"); } };
  assert.equal(await B.recentBlockSeconds(broken, "base", head, 2), B.NOMINAL_BLOCK_SECONDS.base);
  assert.equal(B.NOMINAL_BLOCK_SECONDS.base, 0.2);
  B.__test.measured.clear();
});

test("the block at a time is found across a change of block time, in a few header reads", async () => {
  const head = SWITCH + 2_000_000n; // 400,000 s (4.6 days) of 0.2 s blocks
  const cl = chain(head);
  const h = { block: head, ts: tsAt(head) };
  for (const back of [3_600, 86_400, 4 * 86_400, 7 * 86_400, 30 * 86_400]) {
    const target = h.ts - back;
    const r = await B.blockAtTime(cl, h, target, { secs: 0.2, tolerance: 60 });
    assert.ok(Math.abs(r.ts - target) <= 60, `${back} s back: got ${r.ts - target} s off`);
    assert.equal(r.exact, true);
  }
  // The old fixed rule would have put "7 days ago" 3,024,000 blocks back from 0.2 s alone, or 302,400 from 2 s alone:
  const seven = await B.blockAtTime(cl, h, h.ts - 7 * 86_400, { secs: 0.2 });
  assert.ok(seven.block < SWITCH && seven.block > head - 3_024_000n);
  assert.ok(cl.reads() < 40, `${cl.reads()} header reads`);
});

test("shared samples make later targets cheap; a target in the future is the head itself", async () => {
  const head = SWITCH + 2_000_000n;
  const cl = chain(head);
  const h = { block: head, ts: tsAt(head) };
  const samples = [h];
  await B.blockAtTime(cl, h, h.ts - 7 * 86_400, { secs: 0.2, tolerance: 300, samples });
  const before = cl.reads();
  for (let d = 6; d >= 1; d--) await B.blockAtTime(cl, h, h.ts - d * 86_400, { secs: 0.2, tolerance: 300, samples });
  assert.ok(cl.reads() - before <= 14, `${cl.reads() - before} reads for six more days`);
  assert.deepEqual(await B.blockAtTime(cl, h, h.ts + 10, { secs: 0.2 }), { block: head, ts: h.ts, exact: true });
});

// A log node: every block from 1,000 to `head` holds one payment; it refuses ranges over 50,000 and any range that
// touches a block in `refuse`.
function logNode({ refuse = [] } = {}) {
  const calls = [];
  const read = async (from, to) => {
    calls.push([from, to]);
    if (to - from + 1n > 50_000n) throw new Error("exceed maximum block range: 50000");
    if (refuse.some((b) => b >= from && b <= to)) throw new Error("busy");
    const out = [];
    for (let b = from; b <= to; b++) if (b >= 1_000n) out.push({ blockNumber: "0x" + b.toString(16), transactionHash: "0x", topics: [], data: "0x1" });
    return out;
  };
  return { read, calls };
}

test("seller record scan: windows of at most 50,000 blocks, all of them, complete", async () => {
  const n = logNode();
  const r = await T.scanInflows(n.read, 300_000n, 100_001n);
  assert.equal(r.complete, true);
  assert.equal(r.reached, 100_001n);
  assert.equal(r.logs.length, 200_000);
  assert.ok(n.calls.every(([a, b]) => b - a + 1n <= T.SCAN_WINDOW));
});

test("seller record scan: a refused window is retried in quarters before the scan gives up", async () => {
  // Block 160,000 is refused in its full window and in its quarter. The fourth window, read in the same parallel batch,
  // succeeds but lies beyond the gap, so it is dropped: the scan keeps the unbroken newest part only.
  const n = logNode({ refuse: [160_000n] });
  const r = await T.scanInflows(n.read, 300_000n, 100_001n);
  assert.equal(r.complete, false);
  assert.equal(r.reached, 200_001n);
  assert.equal(r.logs.length, 100_000);
  assert.ok(n.calls.some(([a, b]) => b - a + 1n === 12_500n), "the refused window was retried in quarters");
  assert.ok(r.logs.every((l) => BigInt(l.blockNumber) >= r.reached), "no log from beyond the reported coverage");
});

test("seller record scan: nothing readable is an error, not an empty record", async () => {
  const n = logNode({ refuse: [299_999n] });
  await assert.rejects(T.scanInflows(n.read, 300_000n, 100_001n), (e) => e.status === 502);
});
