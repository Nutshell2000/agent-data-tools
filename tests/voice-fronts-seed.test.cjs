const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// 1.202.0 (15 Nov 2026): scripts/seed-bazaar.mjs lists the drop-in voice fronts, so the owner's Refresh click gives each
// a Bazaar listing (Mercator and the other routers import only Bazaar listings). Each seed example must be a GET that
// the front quotes under its own path: the listing is written from that quote's resource.
const EXAMPLES = [
  ['/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', '?text=' + encodeURIComponent('Your payment was received. Thank you!')],
  ['/v1/speech-to-text', '?cloud_storage_url=' + encodeURIComponent('https://commons.wikimedia.org/wiki/Special:FilePath/En-us-hello.ogg')],
  ['/v1/audio/transcriptions', '?url=' + encodeURIComponent('https://commons.wikimedia.org/wiki/Special:FilePath/En-us-hello.ogg')],
];
let mf;
const O = 'https://api.test';
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] }) }));
});
after(async () => { await mf?.dispose(); });

test('seed-bazaar.mjs lists the three voice fronts with GET examples', () => {
  const src = readFileSync('scripts/seed-bazaar.mjs', 'utf8');
  for (const [path] of EXAMPLES) assert.ok(src.includes(`path: "${path}"`), `${path} missing from FRONTS`);
});

for (const [path, query] of EXAMPLES) {
  test(`the seed example for ${path} is quoted under its own path`, async () => {
    const r = await mf.dispatchFetch(`${O}${path}${query}`);
    assert.equal(r.status, 402);
    const terms = JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64').toString('utf8'));
    assert.equal(new URL(terms.resource.url).pathname, path);
  });
}
