const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let G;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/generators.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  G = m.exports;
});
const run = async (path, params = {}) => G.GENERATORS.find((f) => f.endpoint.path === path).run({}, (n) => params[n]);

test('Code 128 table: 107 distinct symbols, 11 modules each (stop 13), three bars and three spaces', () => {
  assert.equal(G.CODE128.length, 107);
  assert.equal(new Set(G.CODE128).size, 107);
  G.CODE128.forEach((p, k) => {
    assert.equal(p.length, k === 106 ? 13 : 11, `symbol ${k}`);
    assert.ok(p.startsWith('1') && p.endsWith(k === 106 ? '11' : '0'), `symbol ${k}`);
    if (k < 106) assert.equal(p.match(/1+/g).length, 3, `symbol ${k} bars`);
  });
});

test('Code 128 values: set B text with the mod-103 check, set C for digit runs, switching', () => {
  // PJJ123C in set B: 104 + 48 + 2*42 + 3*42 + 4*17 + 5*18 + 6*19 + 7*35 = 879, 879 mod 103 = 55.
  assert.deepEqual(G.code128Values('PJJ123C'), [104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
  const digits = G.code128Values('123456');
  assert.deepEqual(digits.slice(0, 4), [105, 12, 34, 56]);
  const mixed = G.code128Values('AB12345678');
  assert.deepEqual(mixed.slice(0, 7), [104, 33, 34, 99, 12, 34, 56]);
  assert.throws(() => G.code128Values('ä'), (e) => e.status === 400);
});

test('EAN-13: check digit, module count, guard bars, wrong check refused', async () => {
  assert.equal(G.eanCheck('400638133393'), '1');
  assert.equal(G.eanCheck('590123412345'), '7');
  const e = G.ean13Modules('590123412345');
  assert.equal(e.code, '5901234123457');
  assert.equal(e.bits.length, 95);
  assert.ok(e.bits.startsWith('101') && e.bits.endsWith('101') && e.bits.slice(45, 50) === '01010');
  assert.throws(() => G.ean13Modules('5901234123450'), (err) => err.status === 400);
  const out = await run('/barcode', { text: '590123412345', type: 'ean13', label: 'false' });
  assert.equal(out.encoded, '5901234123457');
  assert.doesNotMatch(out.svg, /<text/);
  assert.match(Buffer.from(out.dataUrl.split(',')[1], 'base64').toString(), /^<svg/);
});

test('palette: hex round trip, harmonies, shades, bad colour', async () => {
  const p = G.palette('#3366FF');
  assert.equal(p.base, '#3366ff');
  assert.equal(p.complementary[1], '#ffcc33');
  assert.equal(p.shades.length, 6);
  assert.equal(G.palette('36f').base, '#3366ff');
  assert.equal(G.hslToHex(0, 1, 0.5), '#ff0000');
  await assert.rejects(run('/color/palette', { color: 'blue' }), (e) => e.status === 400);
});

test('tables: CSV to Markdown escaping and alignment; HTML tables with headers, colspan and nesting', async () => {
  const md = G.csvToMarkdown([['a', 'b|c'], ['1', 'x\ny']], true);
  assert.equal(md, '| a | b\\|c |\n| ---: | --- |\n| 1 | x<br>y |');
  const t = G.htmlTables('<table><caption>Pop</caption><thead><tr><th>City</th><th colspan="2">Data</th></tr></thead><tr><td>Oslo &amp; more</td><td>1</td><td>2</td></tr></table><script>"<table>"</script>');
  assert.equal(t.length, 1);
  assert.equal(t[0].caption, 'Pop');
  assert.deepEqual(t[0].rows[0], ['City', 'Data', 'Data']);
  assert.equal(t[0].rows[1][0], 'Oslo & more');
  const out = await run('/html/table-to-json', { html: '<table><tr><th>A</th><th>A</th></tr><tr><td>1</td><td>2</td></tr></table>' });
  assert.deepEqual(out.tables[0].rows[0], { A: '1', A_2: '2' });
  await assert.rejects(run('/html/table-to-json', { html: '<p>none</p>' }), (e) => e.status === 422);
});
