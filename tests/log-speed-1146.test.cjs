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
