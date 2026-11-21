// src/lib/accepted-terms.ts: a v2 payment's `accepted` that means one of our terms is aligned to it; anything that
// changes the money (amount, recipient, token, network) is not, and the refusal says which field differed.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

let cached;
async function load() {
  if (cached) return cached;
  const b = await build({ entryPoints: ['src/lib/accepted-terms.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return (cached = m.exports);
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const un = (h) => JSON.parse(Buffer.from(h, 'base64').toString());

const OURS = { scheme: 'exact', network: 'eip155:8453', amount: '10000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: '0x6293ded2684F1A76E26bEcef87c137D691Fbf800', maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } };
const POLYGON = { ...OURS, network: 'eip155:137', asset: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' };
const required = b64({ x402Version: 2, error: 'No matching payment requirements', resource: { url: 'https://x.test/contents' }, accepts: [OURS, POLYGON] });
const pay = (accepted, more = {}) => b64({ x402Version: 2, resource: { url: 'https://x.test/contents' }, accepted, payload: { signature: '0xabc', authorization: { nonce: '0x01' } }, ...more });

test('spelling differences are aligned to our term, and the signed payload is untouched', async () => {
  const { alignAccepted } = await load();
  for (const [name, accepted] of [
    ['lower-case addresses', { ...OURS, payTo: OURS.payTo.toLowerCase(), asset: OURS.asset.toLowerCase() }],
    ['another timeout', { ...OURS, maxTimeoutSeconds: 60 }],
    ['no timeout', (({ maxTimeoutSeconds, ...rest }) => rest)(OURS)],
    ['amount as a number', { ...OURS, amount: 10000 }],
    ['v1 network name and maxAmountRequired', { scheme: 'exact', network: 'base', maxAmountRequired: '10000', asset: OURS.asset, payTo: OURS.payTo, resource: 'https://x.test/contents', description: 'd', mimeType: 'application/json' }],
    ['no extra', (({ extra, ...rest }) => rest)(OURS)],
    ['the second network', { ...POLYGON, payTo: POLYGON.payTo.toUpperCase().replace('0X', '0x') }],
  ]) {
    const out = alignAccepted(pay(accepted), required);
    assert.ok(out.header, `${name}: aligned`);
    const sent = un(out.header);
    assert.deepEqual(sent.accepted, accepted.network === 'eip155:137' ? POLYGON : OURS, name);
    assert.deepEqual(sent.payload, { signature: '0xabc', authorization: { nonce: '0x01' } }, `${name}: payload untouched`);
    assert.ok(out.differs.length > 0, name);
  }
});

test('a client\'s own extra entries are kept and ours win', async () => {
  const { alignAccepted } = await load();
  const out = alignAccepted(pay({ ...OURS, maxTimeoutSeconds: 1, extra: { name: 'USDC', gasless: true } }), required);
  assert.deepEqual(un(out.header).accepted.extra, { name: 'USD Coin', gasless: true, version: '2' });
});

test('anything that changes the money is never aligned, and the difference is named without values', async () => {
  const { alignAccepted, differsNote } = await load();
  for (const [accepted, word] of [
    [{ ...OURS, amount: '9999' }, 'amount lower than quoted'],
    [{ ...OURS, amount: '20000' }, 'amount higher than quoted'],
    [{ ...OURS, amount: 'ten' }, 'amount missing'],
    [{ ...OURS, payTo: '0x000000000000000000000000000000000000dEaD' }, 'payTo'],
    [{ ...OURS, asset: '0x000000000000000000000000000000000000dEaD' }, 'asset'],
    [{ ...OURS, network: 'eip155:1' }, 'network not offered'],
    [{ ...OURS, scheme: 'upto' }, 'scheme'],
  ]) {
    const out = alignAccepted(pay(accepted), required);
    assert.equal(out.header, undefined, word);
    assert.ok(out.differs.includes(word), `${word}: ${out.differs}`);
    assert.doesNotMatch(differsNote(out), /0x|9999|20000/, 'no values in the note');
  }
});

test('an exact match, a missing accepted and unreadable headers give no aligned header and never throw', async () => {
  const { alignAccepted, differsNote } = await load();
  assert.deepEqual(alignAccepted(pay(OURS), required), { differs: [] });
  assert.equal(differsNote({ differs: [] }), '');
  assert.deepEqual(alignAccepted(b64({ x402Version: 2, payload: {} }), required).differs, ['accepted missing']);
  assert.deepEqual(alignAccepted('not base64 json', required).differs, ['unreadable']);
  assert.deepEqual(alignAccepted(pay(OURS), null).differs, ['unreadable']);
  assert.equal(differsNote(alignAccepted(pay({ ...OURS, maxTimeoutSeconds: 60, weird$field: 1 }), required)), ' (differs: maxTimeoutSeconds, added fields weirdfield)');
});
