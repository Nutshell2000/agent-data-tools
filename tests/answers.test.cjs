// Composed answers (src/routes/answers.ts). Until 1.323.0 both tools threw "pack references unknown tool" on every
// call, because they asked packs.ts's call() for tools it cannot reach; nothing tested them. These tests run each
// handler with the network cut: a handler must fail as an uncharged HTTP error of its own, never on its wiring.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

let cached;
async function load() {
  if (cached) return cached;
  const b = await build({ entryPoints: ['src/routes/answers.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{ name: 'url', setup(p) { p.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return (cached = m.exports);
}

const offline = async (run) => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed: network cut by the test'); };
  try { return await run(); } finally { globalThis.fetch = real; }
};
const input = (values) => (name) => values[name];

test('both answers are registered at their price with a use sentence and an example in the handler\'s shape', async () => {
  const { ANSWERS } = await load();
  assert.deepEqual(ANSWERS.map((e) => e.endpoint.path), ['/answers/page-evidence', '/answers/company-diligence']);
  for (const e of ANSWERS) {
    assert.equal(e.endpoint.price, '$0.05');
    assert.match(e.endpoint.description, /\bUse when\b/);
    const ex = e.endpoint.outputExample;
    assert.ok(ex.receipt && ex.receipt.payload && 'signature' in ex.receipt, `${e.endpoint.path}: the example carries the receipt the handler returns`);
    assert.equal(ex.receipt.payload.iss, 'https://agent-data-tools.revmesh2074.workers.dev');
    assert.ok(!('signature' in ex), `${e.endpoint.path}: no top-level signature (the handler has none)`);
  }
  const page = ANSWERS[0].endpoint.outputExample, company = ANSWERS[1].endpoint.outputExample;
  for (const key of ['url', 'text', 'textLength', 'security', 'hashSha256', 'failed']) assert.ok(key in page, `page-evidence example has ${key}`);
  for (const key of ['domain', 'intel', 'sanctions', 'failed']) assert.ok(key in company, `company-diligence example has ${key}`);
  assert.ok(!('site' in company) && !('registration' in company), 'site and registration live under intel');
  assert.match(ANSWERS[1].endpoint.description, /No company register is read/);
});

test('with the network cut each answer fails as its own uncharged HTTP error, never on an unknown tool', async () => {
  const { ANSWERS } = await load();
  const [page, company] = ANSWERS;
  await offline(() => assert.rejects(
    Promise.resolve().then(() => page.run({}, input({ url: 'https://example.com' }))),
    // Every section failed, so the pack runner refuses the call (502); with only the page unreadable it is the handler's 404.
    (err) => { assert.doesNotMatch(String(err.message), /unknown tool|is missing/); assert.ok([404, 502].includes(err.status), `status ${err.status}`); return true; }));
  await offline(() => assert.rejects(
    Promise.resolve().then(() => company.run({}, input({ domain: 'stripe.com' }))),
    (err) => { assert.doesNotMatch(String(err.message), /unknown tool|is missing/); assert.equal(err.status, 502); return true; }));
});

test('a missing input is a 400 before anything is read', async () => {
  const { ANSWERS } = await load();
  for (const e of ANSWERS) await assert.rejects(Promise.resolve().then(() => e.run({}, input({}))), (err) => err.status === 400);
});
