const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// While the Metrics object is out of its daily write quota a free call cannot be counted. Someone who clicked
// "Run it free" must be told that free calls are paused until 00:00 UTC, not handed the paywall without a word;
// HTTP clients still get the 402 with a header that says why, and nothing is charged or counted.
let mf;
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'dead-free-calls', setup(b) {
    b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
    b.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async()=>({isValid:false,invalidReason:'fixture'}), settle:async()=>({success:false,errorReason:'fixture'})
    }}` }));
    b.onResolve({ filter: /^\.\/metrics$/ }, () => ({ path: 'dead', namespace: 'dead' }));
    b.onLoad({ filter: /.*/, namespace: 'dead' }, () => ({ loader: 'js', contents: `import { DurableObject } from 'cloudflare:workers';
      const down = () => { throw new Error('Exceeded allowed rows written in Durable Objects free tier.'); };
      export class Metrics extends DurableObject {}
      for (const name of ['bump','bumpMcpClient','callers','creditBalance','ingest','mcpClients','recordFunnel','refundFreeCall','report','status','takeFreeCall']) Metrics.prototype[name] = async function () { down(); };` }));
  } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', MPP_EVM: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => new Response('not used', { status: 500 }) }));
});
after(async () => { await mf?.dispose(); });

const browser = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'cf-connecting-ip': '198.51.100.21' };

test('a browser free trial that cannot be counted says free calls are paused until 00:00 UTC', async () => {
  const res = await mf.dispatchFetch('https://api.test/time?zone=UTC&trial=1', { headers: browser });
  assert.equal(res.status, 503);
  assert.ok(Number(res.headers.get('retry-after')) >= 3600);
  const html = await res.text();
  assert.match(html, /Free calls are paused until 00:00 UTC/);
  assert.match(html, /Nothing was charged/);
  assert.match(html, /href="\/time\?sample=1"/, 'the free static example stays reachable');
  assert.doesNotMatch(html, /<script/i);
});

test('an HTTP client asking for a free call gets the normal 402 plus a header saying why', async () => {
  const res = await mf.dispatchFetch('https://api.test/time?zone=UTC&trial=1', { headers: { accept: 'application/json', 'cf-connecting-ip': '198.51.100.22' } });
  assert.equal(res.status, 402);
  assert.ok(res.headers.get('payment-required'), 'the x402 terms are unchanged');
  assert.match(res.headers.get('x-free-trial-unavailable'), /paused until 00:00 UTC/);
  await res.arrayBuffer();
});

test('a plain unpaid request is unaffected', async () => {
  const res = await mf.dispatchFetch('https://api.test/time?zone=UTC', { headers: { accept: 'application/json' } });
  assert.equal(res.status, 402);
  assert.equal(res.headers.get('x-free-trial-unavailable'), null);
  await res.arrayBuffer();
});
