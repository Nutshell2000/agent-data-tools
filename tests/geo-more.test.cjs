const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let G;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/geo-more.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  G = m.exports;
});
const row = (id, name, dist, pop, desc) => ({ place: { value: `http://www.wikidata.org/entity/${id}` }, placeLabel: { value: name }, placeDescription: desc ? { value: desc } : undefined, dist: { value: String(dist) }, pop: { value: String(pop) }, countryLabel: { value: 'Sweden' }, iso: { value: 'SE' } });

test('reverse geocoding: SPARQL puts longitude first, rows are de-duplicated, the largest skips administrative areas', () => {
  assert.match(G.sparqlAround(59.33, 18.07, 10, 25), /Point\(18\.07 59\.33\)/);
  const s = G.shapePlaces([row('Q1754', 'Stockholm', 0.05, 984748, 'capital of Sweden'), row('Q1754', 'Stockholm', 0.05, 984748), row('Q506250', 'Stockholm Municipality', 0.8, 1000962, 'municipality in Stockholm County'), row('Q9', 'Jakob parish', 0.2, 160)]);
  assert.equal(s.places.length, 3);
  assert.equal(s.nearest.name, 'Stockholm');
  assert.equal(s.largest.name, 'Stockholm');
  assert.equal(G.shapePlaces([]).nearest, null);
});

test('reverse geocoding refuses bad coordinates before any request; packs keep their names short', async () => {
  const run = async (params) => G.GEO_MORE[0].run({}, (n) => params[n]);
  await assert.rejects(run({ lat: '95', lon: '10' }), (e) => e.status === 400);
  await assert.rejects(run({ lat: '10', lon: '10', radius: '500' }), (e) => e.status === 400);
  for (const { endpoint: e } of G.GEO_MORE) assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
});
