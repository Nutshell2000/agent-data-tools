const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let P;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/packs-lead.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  P = m.exports;
});

const byPath = (p) => P.PACKS_LEAD.find((e) => e.endpoint.path === p);

test('lead packs: three paths, one cent, names start with the phrase buyers type, five or more tags', () => {
  assert.deepEqual(P.PACKS_LEAD.map((e) => e.endpoint.path), ['/pack/email-verify', '/pack/contact-verify', '/pack/vendor-check']);
  for (const e of P.PACKS_LEAD) {
    assert.equal(e.endpoint.price, '$0.01');
    assert.ok(e.endpoint.tags.length >= 5);
    assert.ok(e.endpoint.description.length <= 450, `${e.endpoint.path} description is ${e.endpoint.description.length} characters`);
    assert.match(e.endpoint.description, /Use (when|to|for)/);
  }
  assert.match(byPath('/pack/email-verify').endpoint.summary, /^Email verification,/);
  assert.match(byPath('/pack/contact-verify').endpoint.summary, /^Contact verification,/);
  assert.match(byPath('/pack/vendor-check').endpoint.summary, /^Vendor check,/);
});

test('lead packs: published examples repeat their own input', () => {
  const ex = (p) => JSON.stringify(byPath(p).endpoint.example ?? byPath(p).endpoint.exampleResult ?? byPath(p));
  assert.match(ex('/pack/email-verify'), /alex\.morgan@stripe\.com/);
  assert.match(ex('/pack/vendor-check'), /stripe\.com/);
});

test('hostFrom reads a domain, a URL and an e-mail address, and refuses anything else', () => {
  assert.equal(P.hostFrom('https://www.Stripe.com/path?x=1'), 'stripe.com');
  assert.equal(P.hostFrom('hello@linear.app'), 'linear.app');
  assert.equal(P.hostFrom('example.org:8080'), 'example.org');
  assert.throws(() => P.hostFrom('not a domain'), (e) => e.status === 400);
  assert.throws(() => P.hostFrom('localhost'), (e) => e.status === 400);
});

test('mailVerdict: invalid, risky and likely-deliverable', () => {
  const clean = { validSyntax: true, verdict: 'likely-deliverable', reasons: [], acceptsMail: true, hasSpf: true, hasDmarc: true };
  assert.equal(P.mailVerdict({ validSyntax: false, reasons: ['not a valid email address'] }, undefined).verdict, 'invalid');
  assert.equal(P.mailVerdict({ ...clean, verdict: 'undeliverable' }, undefined).verdict, 'invalid');
  assert.equal(P.mailVerdict({ ...clean, verdict: 'risky', reasons: ['disposable mailbox provider'] }, undefined).verdict, 'risky');
  assert.equal(P.mailVerdict({ ...clean, roleAddress: true }, undefined).verdict, 'risky');
  assert.equal(P.mailVerdict(clean, { trust: 'low', summary: 'low trust', flags: [], facts: {} }).verdict, 'risky');
  assert.equal(P.mailVerdict(clean, { trust: 'medium', summary: '', flags: [{ code: 'new' }], facts: {} }).verdict, 'risky');
  assert.equal(P.mailVerdict(clean, { trust: 'high', summary: '', flags: [], facts: {} }).verdict, 'likely-deliverable');
});

test('contact-verify with nothing to check is a 400 and a malformed address is invalid without any network call', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no network in this test'); };
  try {
    await assert.rejects(byPath('/pack/contact-verify').run({}, () => undefined), (e) => e.status === 400);
    const out = await byPath('/pack/email-verify').run({}, (n) => (n === 'email' ? 'not-an-email' : undefined));
    assert.equal(out.verdict, 'invalid');
    assert.equal(out.mailbox, null);
  } finally { globalThis.fetch = realFetch; }
});

test('vendor-check: a bad domain is refused (400) before anything is charged', async () => {
  await assert.rejects(byPath('/pack/vendor-check').run({}, (n) => (n === 'domain' ? 'not a domain' : undefined)), (e) => e.status === 400);
});
