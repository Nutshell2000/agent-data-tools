const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load() {
  const b = await build({ entryPoints: ['src/routes/trust.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('evidence bundle: registered at the one-cent cap with honest limits and no fabricated pass', async () => {
  const { TRUST, receiptFor } = await load();
  const e = TRUST.find((x) => x.endpoint.path === '/evidence/bundle');
  assert.ok(e, 'route registered');
  assert.equal(e.endpoint.price, '$0.01');
  assert.match(e.endpoint.description, /does NOT prove what was delivered/i);
  assert.match(e.endpoint.description, /partial evidence with errors/i);
  assert.ok(e.endpoint.tags.includes('proof-of-payment'));
  assert.ok(typeof receiptFor === 'function', 'receipt helper is shared, not duplicated');
  const original = TRUST.find((x) => x.endpoint.path === '/x402/receipt');
  assert.ok(original, 'the original receipt tool still exists');
});

test('evidence bundle: the published example names this service as issuer and shows the price as the handler computes it', async () => {
  const { TRUST } = await load();
  const e = TRUST.find((x) => x.endpoint.path === '/evidence/bundle');
  const ex = e.endpoint.outputExample;
  assert.equal(ex.iss, 'https://agent-data-tools.revmesh2074.workers.dev');
  assert.ok(ex.keys.startsWith(ex.iss), 'the key document is on the issuer\'s host');
  assert.equal(ex.listing.advertisedPrice, '0.01', 'a plain decimal, not "$0.01"');
  assert.match(e.endpoint.description, /same host and path/);
  assert.match(e.endpoint.description, /issued in our name/);
});

test('evidence bundle: invalid hash is a 400 and never signed', async () => {
  const { TRUST } = await load();
  const e = TRUST.find((x) => x.endpoint.path === '/evidence/bundle');
  await assert.rejects(Promise.resolve().then(() => e.run({}, (n) => ({ hash: 'nope' })[n])), (err) => err.status === 400);
});
