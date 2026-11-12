// Log reads when the free log nodes rate-limit Cloudflare (1.146.0, 12 Nov 2026). Measured from a throwaway Worker:
// Base publicnode answers in tens of milliseconds or holds a refused call 3 s; Tenderly refuses everything; Nodies hangs.
// /base/logs took 7-14 s for 20 blocks and a one-day /x402/seller-record over 120 s.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const http = require("node:http");
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

let R, T;
before(async () => {
  R = await load(require.resolve("../src/lib/rpc.ts"));
  T = (await load(require.resolve("../src/routes/trust.ts"))).__test;
});

test("log node order: no hanging Nodies on Base, QuickNode first on Polygon", () => {
  assert.equal(R.LOG_RPCS.base[0], "https://base-rpc.publicnode.com");
  assert.ok(!R.LOG_RPCS.base.some((u) => u.includes("nodies")));
  assert.equal(R.LOG_RPCS.polygon[0], "https://rpc-mainnet.matic.quiknode.pro");
  assert.ok(R.LOG_RPCS.polygon.includes("https://polygon-bor-rpc.publicnode.com"));
});

test("publicnode gets short tries and quick retries; other nodes one bounded try", () => {
  assert.deepEqual(R.logTransport("https://base-rpc.publicnode.com"), { timeout: 1500, retryCount: 3, retryDelay: 50 });
  assert.deepEqual(R.logTransport("https://polygon-bor-rpc.publicnode.com"), { timeout: 1500, retryCount: 3, retryDelay: 50 });
  const other = R.logTransport("https://base.gateway.tenderly.co");
  assert.equal(other.retryCount, 0);
  assert.ok(other.timeout <= 4000);
});

test("a node that holds 2 of 3 calls for 3 s: short tries answer every call in about half the time", async () => {
  const { createPublicClient, http: viemHttp, fallback } = require("viem");
  const { base } = require("viem/chains");
  let hits = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits++;
      const { id } = JSON.parse(body);
      const limited = hits % 3 !== 0;
      setTimeout(() => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(limited ? { jsonrpc: "2.0", id, error: { code: -32005, message: "Rate limit exceeded" } } : { jsonrpc: "2.0", id, result: [] }));
      }, limited ? 3000 : 20);
    });
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const opts = R.logTransport("https://base-rpc.publicnode.com");
    const cl = createPublicClient({ chain: base, transport: fallback([viemHttp(url, opts)], { rank: false }) });
    const t = Date.now();
    for (let i = 0; i < 3; i++) assert.deepEqual(await cl.request({ method: "eth_getLogs", params: [{}] }), []);
    const ms = Date.now() - t;
    // With the old 5 s / one retry each call waited about 6 s; three short tries per call cost about 3 s.
    assert.ok(ms < 12_000, `${ms} ms for three calls`);
  } finally {
    server.close();
  }
});

test("seller record scan stops starting batches after its time budget and says so", async () => {
  let clock = 0;
  const read = async (from, to) => { clock += 10_000; return [{ blockNumber: "0x" + to.toString(16), transactionHash: "0x", topics: [], data: "0x1" }]; };
  // 20 windows of 50,000 blocks, four at a time; the fake clock moves 10 s per read, so the budget ends after one batch.
  const r = await T.scanInflows(read, 1_000_000n, 1n, 25_000, () => clock);
  assert.equal(r.complete, false);
  assert.equal(r.outOfTime, true);
  assert.equal(r.logs.length, 4);
  assert.equal(r.reached, 1_000_000n - 4n * T.SCAN_WINDOW + 1n);
  // With time to spare the same scan reads everything.
  clock = 0;
  const full = await T.scanInflows(async (f, t) => [], 1_000_000n, 1n, 25_000, () => 0);
  assert.equal(full.complete, true);
  assert.equal(full.outOfTime, undefined);
});

test("a log scan stops starting windows after its time budget and says it is incomplete", async () => {
  const C = await load(require.resolve("../src/routes/chain-reads.ts"));
  let clock = 0, calls = 0;
  const cl = { request: async () => { calls++; clock += 15_000; return []; } };
  const r = await C.recentLogs(cl, { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, 1_000_000n, 100_000n, 50, { now: () => clock });
  assert.equal(r.complete, false);
  assert.equal(calls, 2, "two windows of 15 s pass the 20 s budget");
  // Inside the budget the same scan reads the whole span.
  clock = 0; calls = 0;
  const fast = await C.recentLogs({ request: async () => { calls++; return []; } }, { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, 1_000_000n, 100_000n, 50, { now: () => 0 });
  assert.equal(fast.complete, true);
  assert.equal(C.LOG_SCAN_BUDGET_MS, 20_000);
});

test("log scan windows follow the density seen: quiet logs finish in two calls, busy ones stay small", async () => {
  const C = await load(require.resolve("../src/routes/chain-reads.ts"));
  const fake = (perBlock) => { const sizes = []; return { sizes, cl: { request: async ({ params: [{ fromBlock, toBlock }] }) => { const n = Number(BigInt(toBlock) - BigInt(fromBlock) + 1n); sizes.push(n); return Array.from({ length: Math.floor(n * perBlock) }, (_, i) => ({ blockNumber: toBlock, logIndex: "0x" + i.toString(16) })); } } }; };
  // Quiet: one log every 20 blocks, want 3,000 over 18,000 blocks (the /token/buyers default on Base).
  const quiet = fake(0.05);
  const q = await C.recentLogs(quiet.cl, { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" }, 10_000_000n, 18_000n, 3000, { now: () => 0 });
  assert.equal(q.complete, true);
  assert.ok(quiet.sizes.length <= 2, `quiet scan took ${quiet.sizes.length} calls: ${quiet.sizes}`);
  // Busy: 27 logs a block (USDC on Base), want 3,000: the second window asks for about what is missing, not 40 blocks x 4.
  const busy = fake(27);
  const b = await C.recentLogs(busy.cl, { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, 10_000_000n, 18_000n, 3000, { now: () => 0 });
  assert.ok(b.logs.length >= 3000);
  assert.ok(Math.max(...busy.sizes) <= 200, `busy windows ${busy.sizes}`);
  // A caller's own cap still holds.
  const capped = fake(0);
  await C.recentLogs(capped.cl, { topics: [] }, 10_000_000n, 5_000n, 50, { first: 1000n, max: 1000n, now: () => 0 });
  assert.ok(capped.sizes.every((n) => n <= 1000));
});
