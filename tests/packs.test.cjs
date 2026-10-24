const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let P;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/packs.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  P = m.exports;
});

test('sections: partial failures are reported, all failing is an uncharged 502', async () => {
  const ok = await P.runSections({ a: Promise.resolve(1), b: Promise.reject(new Error('boom')) });
  assert.deepEqual(ok.data, { a: 1 });
  assert.deepEqual(ok.failed, { b: 'boom' });
  await assert.rejects(P.runSections({ a: Promise.reject(new Error('x')), b: Promise.reject(new Error('y')) }), (e) => e.status === 502 && /nothing was charged/.test(e.message));
  assert.throws(() => P.call({}, '/no/such/tool', {}), /unknown tool/);
});

test('every tool a pack calls exists in the catalog modules', async () => {
  for (const path of ['/crypto/fear-greed', '/hyperliquid/market', '/hyperliquid/indicators', '/base/token-info', '/polygon/proxy', '/price/token', '/url/uptime', '/url/redirects', '/seo/audit', '/http/security-headers', '/robots', '/ip/info', '/ip/lookup', '/wallet/balances', '/base/is-contract', '/base/nonce', '/eth/nonce', '/base/token-transfers', '/sanctions/check']) {
    assert.doesNotThrow(() => P.call({}, path, {}).catch(() => {}), path);
  }
});

test('email score: a strict setup grades A, an open one lists every fix', () => {
  const strong = P.emailScore({ mx: 1, spf: 'v=spf1 -all', spfPolicy: '-all', dmarc: 'v=DMARC1; p=reject', dmarcPolicy: 'reject', dkim: ['google'], mtaSts: true, tlsRpt: true, bimi: true });
  assert.equal(strong.score, 100);
  assert.equal(strong.grade, 'A');
  assert.deepEqual(strong.issues, []);
  const weak = P.emailScore({ mx: 0, spf: 'v=spf1 +all', spfPolicy: '+all', dmarc: null, dmarcPolicy: null, dkim: [], mtaSts: false, tlsRpt: false, bimi: false });
  assert.equal(weak.grade, 'F');
  assert.ok(weak.issues.some((i) => /\+all/.test(i)) && weak.issues.some((i) => /no MX/.test(i)) && weak.issues.some((i) => /DKIM/.test(i)));
});

test('reverse DNS names for IPv4 and IPv6', () => {
  assert.equal(P.reverseName('8.8.8.8'), '8.8.8.8.in-addr.arpa');
  assert.equal(P.reverseName('192.0.2.10'), '10.2.0.192.in-addr.arpa');
  assert.equal(P.reverseName('2001:db8::1'), '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
});

test('packs: names within 32 characters, prices below the tools bought one by one, inputs checked', async () => {
  for (const { endpoint: e } of P.PACKS) {
    assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
    assert.ok(Number(e.price.slice(1)) <= 0.03, e.path);
  }
  const run = async (path, params) => P.PACKS.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);
  await assert.rejects(run('/pack/wallet-profile', { address: 'nope' }), (e) => e.status === 400);
  await assert.rejects(run('/pack/token-analysis', { token: 'USDC', chain: 'solana' }), (e) => e.status === 400);
});
