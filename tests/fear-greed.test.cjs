const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { build } = require('esbuild');

let F;
const realFetch = globalThis.fetch;
let answer;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/fear-greed.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  F = m.exports;
  globalThis.fetch = async (url) => answer(url);
});
after(() => { globalThis.fetch = realFetch; });
const run = async (params = {}) => F.FEAR_GREED[0].run({}, (n) => params[n]);
const day = (i, v, c = 'Neutral') => ({ value: String(v), value_classification: c, timestamp: String(1792800000 - i * 86400), ...(i === 0 ? { time_until_update: '600' } : {}) });

test('fear and greed: value, deltas, range, attribution on every answer, days bounded', async () => {
  let asked;
  answer = (url) => { asked = url; return new Response(JSON.stringify({ data: Array.from({ length: 31 }, (_, i) => day(i, 50 + (i % 5))), metadata: { error: null } })); };
  const out = await run({ days: '31' });
  assert.match(asked, /limit=31$/);
  const ten = await run({ days: '10' });
  assert.equal(ten.history.length, 10);
  assert.equal(ten.change.vs30d, 0, 'the 30-day change is known even for a 10-day window');
  assert.match(asked, /limit=31$/);
  assert.equal(out.value, 50);
  assert.equal(out.change.vs1d, -1);
  assert.equal(out.change.vs7d, -2);
  assert.equal(out.range.high, 54);
  assert.equal(out.history.length, 31);
  assert.equal(out.date, '2026-10-24');
  assert.match(out.attribution, /alternative\.me/);
  assert.equal(out.nextUpdateSeconds, 600);
  const short = await (answer = () => new Response(JSON.stringify({ data: [day(0, 70, 'Greed')] })), run({ days: '1' }));
  assert.equal(short.change.vs7d, null);
  // days above the range is held to it (num() clamps how-much inputs since 26 Oct 2026); a non-number is still refused.
  assert.ok((await run({ days: '91' })).history.length <= 90);
  await assert.rejects(run({ days: 'many' }), (e) => e.status === 400);
  answer = () => new Response('{}', { status: 500 });
  await assert.rejects(run(), (e) => e.status === 502);
  answer = () => new Response(JSON.stringify({ data: [], metadata: { error: null } }));
  await assert.rejects(run(), (e) => e.status === 502);
});
