// 1.111.4 (11 Nov 2026): what three sweeps over every tool found before the full Bazaar re-settle. Hostile inputs that
// crashed five tools, the company tool answering from the thinnest of several items of one name, listings with fewer than
// five tags, and published examples whose answer did not belong to their input.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

async function load(contents) {
  const b = await build({ stdin: { contents, resolveDir: process.cwd(), sourcefile: 'sweep-fixes.ts', loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const input = (o) => (n) => o[n];

let M;
before(async () => {
  M = await load('export { TOOLS } from "./src/tools"; export { ENDPOINTS, exampleParams } from "./src/endpoints"; export { listingTags, FILL_TAGS, SEARCH_TAGS } from "./src/lib/bazaar-extension"; export { bestCompany, exactlyNamed, companySignals } from "./src/routes/company"; export { ENTRY_PATHS } from "./src/routes/entry-paths";');
});

test('names of Object.prototype members are refused as dates and models, not looked up', async () => {
  const cases = [
    ['/date/add', { days: '1' }, 'date'], ['/date/info', {}, 'date'], ['/sun', { lat: '59', lon: '18' }, 'date'], ['/moon', {}, 'date'],
    ['/ai/chat-large', { prompt: 'hi' }, 'model'],
  ];
  for (const [path, base, name] of cases) {
    for (const hostile of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      await assert.rejects(M.TOOLS[path]({}, input({ ...base, [name]: hostile })), (e) => e.status === 400, `${path} ${name}=${hostile}`);
    }
  }
});

test('an unknown ticker is refused without an empty list of known ones', async () => {
  await assert.rejects(M.TOOLS['/avax/token-info']({}, input({ token: 'zzz' })), (e) => e.status === 400 && !e.message.includes('()') && /0x address/.test(e.message));
  await assert.rejects(M.TOOLS['/base/token-info']({}, input({ token: 'zzz' })), (e) => e.status === 400 && /\(ETH, /.test(e.message));
});

test('of several companies with one name, the one named exactly and holding the most facts answers', () => {
  const claim = { mainsnak: { datavalue: { value: { id: 'Q1' } } } };
  const item = (id, label, props, aliases = []) => ({ id, labels: { en: { value: label } }, aliases: { en: aliases.map((value) => ({ value })) }, claims: Object.fromEntries(props.map((p) => [p, [claim]])) });
  const service = item('Q689141', 'Spotify', ['P169']);
  const company = item('Q87067874', 'Spotify', ['P17', 'P159', 'P1128', 'P452']);
  const holding = item('Q20', 'Spotify Technology', ['P17', 'P159', 'P1128', 'P452', 'P414', 'P1278', 'P169']);
  assert.equal(M.companySignals(service), 1);
  assert.equal(M.companySignals(holding), 7);
  assert.equal(M.exactlyNamed(holding, 'Spotify'), false);
  assert.equal(M.exactlyNamed(company, 'Spotify AB'), true, 'legal form ignored');
  assert.equal(M.exactlyNamed(item('Q2', 'Alphabet Inc.', [], ['Google']), 'google'), true, 'alias');
  // Search order is service, company, holding: the company named exactly "Spotify" with the most facts wins.
  assert.equal(M.bestCompany([service, company, holding], 'Spotify').id, 'Q87067874');
  // No exact name: most facts; equal facts: search order.
  assert.equal(M.bestCompany([service, holding], 'Spotify Tech').id, 'Q20');
  assert.equal(M.bestCompany([item('Qa', 'Acme', ['P17']), item('Qb', 'Acme', ['P159'])], 'Acme').id, 'Qa');
  // A domain match has no name to compare: most facts.
  assert.equal(M.bestCompany([service, company]).id, 'Q87067874');
  assert.equal(M.bestCompany([], 'x'), undefined);
});

test('every listing carries five tags, and a fill tag is never a duplicate of one the tool has', () => {
  for (const e of M.ENDPOINTS) assert.equal(M.listingTags(e.tags, e.path).length, 5, `${e.path}: ${JSON.stringify(M.listingTags(e.tags, e.path))}`);
  const paths = new Set(M.ENDPOINTS.map((e) => e.path));
  for (const [path, fill] of Object.entries(M.FILL_TAGS)) {
    assert.ok(paths.has(path), `${path} is not a tool`);
    const e = M.ENDPOINTS.find((x) => x.path === path);
    for (const t of fill) {
      assert.match(t, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${path} ${t}`);
      assert.ok(!e.tags.includes(t) && !(M.SEARCH_TAGS[path] ?? []).includes(t), `${path}: ${t} is already a tag`);
    }
  }
});

test('a published example answer belongs to its example input', () => {
  // The answer shows the final URL after the site's own redirect (HTTP_402 is a section of the status-code list).
  const REDIRECTED = new Set(['/summarize']);
  for (const e of M.ENDPOINTS) {
    if (REDIRECTED.has(e.path)) continue;
    for (const [k, p] of M.exampleParams(e)) {
      // Inputs a tool repeats in its answer as sent. Others are transformed on purpose (a decoded text, a block number
      // for "latest", a compact IBAN).
      if (!['url', 'address', 'domain', 'symbol', 'count'].includes(k)) continue;
      const shown = Object.hasOwn(e.outputExample, k) ? e.outputExample[k] : undefined;
      if ((typeof shown !== 'string' && typeof shown !== 'number') || String(shown).length >= 80) continue;
      if (typeof p.example !== 'string' && typeof p.example !== 'number') continue;
      // A URL comes back normalised, so a closing slash is not a difference.
      const plain = (v) => String(v).toLowerCase().replace(/\/$/, '');
      assert.equal(plain(shown), plain(p.example), `${e.path}: example input ${k} and the example answer's ${k} differ`);
    }
    if (Array.isArray(e.outputExample.stories) && typeof e.outputExample.count === 'number') assert.equal(e.outputExample.stories.length, e.outputExample.count, e.path);
  }
});

test('transfer scans publish an address that moves tokens; the dropped card door stays dropped', () => {
  const personal = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
  const scans = M.ENDPOINTS.filter((e) => /\/token-transfers$/.test(e.path) || ['/wallet/transactions', '/wallet/related'].includes(e.path));
  assert.ok(scans.length >= 7, `only ${scans.length} transfer scans found`);
  for (const e of scans) assert.notEqual(String(e.params.address.example).toLowerCase(), personal, e.path);
  assert.ok(!M.ENDPOINTS.some((e) => e.path === '/card/validate'));
});
