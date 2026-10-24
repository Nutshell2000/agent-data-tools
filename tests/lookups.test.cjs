const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let L;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/lookups.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  L = m.exports;
});
const run = async (path, params = {}) => L.LOOKUPS.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);

test('YAML: anchors resolve, duplicate keys and alias bombs are refused, JSON round-trips', async () => {
  assert.deepEqual((await run('/yaml/to-json', { yaml: 'base: &b {x: 1}\nother: *b\nlist: [1, two]' })).json, { base: { x: 1 }, other: { x: 1 }, list: [1, 'two'] });
  await assert.rejects(run('/yaml/to-json', { yaml: 'a: 1\na: 2' }), (e) => e.status === 400);
  await assert.rejects(run('/yaml/to-json', { yaml: 'a: [unclosed' }), (e) => e.status === 400 && /not valid YAML/.test(e.message));
  const bomb = ['a: &a ["x","x","x","x","x","x","x","x","x"]'];
  for (let i = 1; i < 9; i++) bomb.push(`${String.fromCharCode(97 + i)}: &${String.fromCharCode(97 + i)} [${Array(9).fill(`*${String.fromCharCode(96 + i)}`).join(',')}]`);
  await assert.rejects(run('/yaml/to-json', { yaml: bomb.join('\n') }), (e) => e.status === 400);
  const y = (await run('/json/to-yaml', { json: '{"k":[1,{"n":null}],"s":"a: b"}' })).yaml;
  assert.deepEqual((await run('/yaml/to-json', { yaml: y })).json, { k: [1, { n: null }], s: 'a: b' });
  await assert.rejects(run('/json/to-yaml', { json: '{nope' }), (e) => e.status === 400);
});

test('phone numbers: E.164 with a country hint, invalid numbers reported, bad country refused', async () => {
  const se = await run('/phone/validate', { number: '070-123 45 67', country: 'se' });
  assert.equal(se.e164, '+46701234567');
  assert.equal(se.country, 'SE');
  assert.equal(se.type, 'mobile');
  assert.equal(se.valid, true);
  const bad = await run('/phone/validate', { number: '+1 555 0100' });
  assert.equal(bad.valid, false);
  const none = await run('/phone/validate', { number: 'hello' });
  assert.equal(none.valid, false);
  await assert.rejects(run('/phone/validate', { number: '123', country: 'USA' }), (e) => e.status === 400);
});

test('VIN: check digit, and malformed VINs are refused before any request', async () => {
  assert.equal(L.vinCheckDigit('1HGCM82633A004352'), '3');
  assert.equal(L.vinCheckDigit('11111111111111111'), '1');
  await assert.rejects(run('/vin', { vin: '1HGCM82633A00435' }), (e) => e.status === 400);
  await assert.rejects(run('/vin', { vin: '1HGCM82633A0O4352' }), (e) => e.status === 400);
});

test('robots.txt: RFC 9309 group choice, longest match, Allow on ties, wildcards and empty Disallow', () => {
  const txt = [
    'User-agent: *', 'Disallow: /private', 'Allow: /private/public', 'Disallow: /*.pdf$', '',
    'User-agent: Googlebot', 'User-agent: Bingbot', 'Disallow: /nogoogle', 'Allow: /page', 'Disallow: /page', '',
    'User-agent: Googlebot-News', 'Disallow: /', '',
    'User-agent: friendly', 'Disallow:', '',
    'Sitemap: https://example.test/sitemap.xml',
  ].join('\n');
  const v = (agent, path) => L.robotsVerdict(txt, agent, path);
  assert.equal(v('*', '/private/x').allowed, false);
  assert.equal(v('*', '/private/public/a').allowed, true);
  assert.equal(v('*', '/doc.pdf').allowed, false);
  assert.equal(v('*', '/doc.pdf?x=1').allowed, true);
  assert.equal(v('Mozilla/5.0 (compatible; Googlebot/2.1)', '/private/x').allowed, true, 'a named group replaces *');
  assert.equal(v('Googlebot', '/nogoogle').allowed, false);
  assert.equal(v('Googlebot', '/page').allowed, true, 'Allow wins a tie');
  assert.equal(v('Googlebot-News', '/anything').allowed, false, 'the longest product token picks the group');
  assert.equal(v('Bingbot', '/nogoogle').allowed, false);
  assert.equal(v('friendly', '/private').allowed, true);
  assert.deepEqual(v('*', '/').sitemaps, ['https://example.test/sitemap.xml']);
  assert.equal(L.robotsVerdict('', '*', '/x').allowed, true);
});

test('names stay within 32 characters and inputs are checked', async () => {
  for (const { endpoint: e } of L.LOOKUPS) assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
  await assert.rejects(run('/robots', { url: 'ftp://example.test/' }), (e) => e.status === 400);
  await assert.rejects(run('/robots', { url: 'not a url' }), (e) => e.status === 400);
});
