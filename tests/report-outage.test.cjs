const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// While the Metrics object is out of its daily quota every call to it throws. The report routes must then say so
// with a retryable 503 (tools keep working), never the bare 500 that directories read as a dead seller.
let mf;
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'dead-metrics', setup(b) {
    b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
    b.onResolve({ filter: /^\.\/metrics$/ }, () => ({ path: 'dead', namespace: 'dead' }));
    b.onLoad({ filter: /.*/, namespace: 'dead' }, () => ({ loader: 'js', contents: `import { DurableObject } from 'cloudflare:workers';
      const down = () => { throw new Error('Exceeded allowed rows written in Durable Objects free tier.'); };
      export class Metrics extends DurableObject {}
      for (const name of ['ingest','report','callers','mcpClients','status','revenueSummary','creditSummary']) Metrics.prototype[name] = async function () { down(); };` }));
  } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', MPP_EVM: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => new Response('not used', { status: 500 }) }));
});
after(async () => { await mf?.dispose(); });

for (const path of ['/status', '/revenue', '/metrics', '/metrics/callers']) {
  test(`${path}: a retryable 503 that says the tools still work while the Metrics object is down`, async () => {
    const res = await mf.dispatchFetch(`https://api.test${path}`);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '600');
    assert.match((await res.json()).error, /tools and x402 payments keep working/);
  });
}
