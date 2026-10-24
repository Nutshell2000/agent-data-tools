const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let M;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/math-date.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  M = m.exports;
});
const run = async (path, params = {}) => M.MATH_DATE.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);

test('business days: weekends, Swedish holidays, default end of month, adding days, bad input', async () => {
  const se = await run('/date/business-days', { from: '2026-12-01', to: '2026-12-31', country: 'se' });
  assert.equal(se.calendarDays, 31);
  assert.equal(se.weekendDays, 8);
  assert.ok(se.holidays.some((h) => h.date === '2026-12-25'));
  assert.equal(se.businessDays, 23 - se.holidays.length);
  const plain = await run('/date/business-days', { from: '2026-12-01' });
  assert.equal(plain.to, '2026-12-31');
  assert.equal(plain.businessDays, 23);
  const unknown = await run('/date/business-days', { from: '2026-12-01', to: '2026-12-07', country: 'JP' });
  assert.match(unknown.note, /no holiday rules for JP/);
  assert.equal((await run('/date/business-days', { from: '2026-12-23', add: '2', country: 'SE' })).date, '2026-12-28');
  assert.equal((await run('/date/business-days', { from: '2026-10-26', add: '-1' })).date, '2026-10-23');
  await assert.rejects(run('/date/business-days', { from: '2026-02-30' }), (e) => e.status === 400);
  await assert.rejects(run('/date/business-days', { from: '2026-12-10', to: '2026-12-01' }), (e) => e.status === 400);
});

test('statistics: known values, sample vs population, mode, bad numbers', async () => {
  const s = M.stats([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(s.mean, 5);
  assert.equal(s.stdDev, 2);
  assert.equal(s.median, 4.5);
  assert.deepEqual(s.mode, [4]);
  assert.equal(M.stats([1]).sampleStdDev, null);
  await assert.rejects(run('/math/stats', { values: '1, 2, x' }), (e) => e.status === 400);
});

test('expressions: precedence, functions, factorial, errors and no code execution', async () => {
  assert.equal(M.evaluate('2+3*4'), 14);
  assert.equal(M.evaluate('2^3^2'), 512);
  assert.equal(M.evaluate('-2^2'), -4);
  assert.equal(M.evaluate('2^-1'), 0.5);
  assert.equal(M.evaluate('2*-3'), -6);
  assert.equal(M.evaluate('(2+3)*4^2/sqrt(16)'), 20);
  assert.equal(M.evaluate('max(1, 7, 3) + 5!'), 127);
  assert.equal(M.evaluate('round(pi*100)/100'), 3.14);
  assert.equal(M.evaluate('10 % 4'), 2);
  for (const bad of ['', '2+', 'process.exit()', 'constructor', 'toString(1)', '__proto__', 'alert(1)', '(1', '1)', '171!']) {
    assert.throws(() => M.evaluate(bad), (e) => e.status === 400, bad);
  }
  const inf = await run('/math/evaluate', { expression: '1/0' });
  assert.equal(inf.finite, false);
  assert.equal(inf.value, null);
});

test('zodiac: sign boundaries and the Chinese year', async () => {
  assert.equal(M.westernSign(12, 25), 'Capricorn');
  assert.equal(M.westernSign(1, 19), 'Capricorn');
  assert.equal(M.westernSign(1, 20), 'Aquarius');
  assert.equal(M.westernSign(3, 21), 'Aries');
  assert.equal(M.westernSign(12, 21), 'Sagittarius');
  const z = await run('/date/zodiac', { date: '2000-01-15' });
  assert.equal(z.chinese.animal, 'Dragon');
  assert.equal(z.chinese.nearNewYear, true);
});
