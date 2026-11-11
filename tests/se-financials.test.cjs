// Swedish annual-report key figures (scripts/se-financials): the iXBRL reader takes the figures a company filed and
// nothing else (never the signatories' names), handles format, scale, sign and dimensional contexts, survives a
// filer's missing scale, and the merge keeps every fiscal year from the newest report that holds it.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { gunzipSync, crc32 } = require('node:zlib');

let X, B;
before(async () => {
  X = await import(pathToFileURL(join(__dirname, '..', 'scripts', 'se-financials', 'ixbrl.mjs')).href);
  B = await import(pathToFileURL(join(__dirname, '..', 'scripts', 'se-financials', 'build.mjs')).href);
});

/** A stored (method 0) zip of [name, Buffer] pairs. */
function zip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const ctx = (id, period) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.bolagsverket.se">556000-0001</xbrli:identifier></xbrli:entity><xbrli:period>${period}</xbrli:period></xbrli:context>`;
const nf = (name, c, v, extra = '') => `<ix:nonFraction name="se-gen-base:${name}" contextRef="${c}" unitRef="SEK" decimals="0" scale="0" format="ixt:numspacecomma"${extra}>${v}</ix:nonFraction>`;

/** A K2 report: two years, a dimensional context that must be ignored, a missing scale, and signatory names. */
function report({ revenue = '1 234 567', prevRevenue = '900 000' } = {}) {
  return Buffer.from(`<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"><head><link:schemaRef xlink:href="http://xbrl.taxonomier.se/se/fr/gaap/k2/2021-10-31/se-k2-type-2021-10-31.xsd"/></head><body>
  <ix:header><ix:resources>
  ${ctx('period0', '<xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate>')}
  ${ctx('period1', '<xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate>')}
  ${ctx('balans0', '<xbrli:instant>2025-12-31</xbrli:instant>')}
  ${ctx('balans1', '<xbrli:instant>2024-12-31</xbrli:instant>')}
  <xbrli:context id="dim0"><xbrli:entity><xbrli:identifier scheme="http://www.bolagsverket.se">556000-0001</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="x:Komponent">x:Balanserat</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2025-12-31</xbrli:instant></xbrli:period></xbrli:context>
  </ix:resources></ix:header>
  <p>${nf('Nettoomsattning', 'period0', revenue)} ${nf('Nettoomsattning', 'period1', prevRevenue)}</p>
  <p>${nf('AretsResultat', 'period0', '12 345', ' sign="-"')} ${nf('AretsResultat', 'period1', '5 000')}</p>
  <p>${nf('Tillgangar', 'balans0', '2 000', ' scale="3"'.replace('', ''))}</p>
  <p><ix:nonFraction name="se-gen-base:EgetKapital" contextRef="balans0" unitRef="SEK" decimals="0" scale="3" format="ixt:numspacecomma">500</ix:nonFraction>
     <ix:nonFraction name="se-gen-base:EgetKapital" contextRef="balans0" unitRef="SEK" decimals="0" scale="0" format="ixt:numspacecomma">500</ix:nonFraction></p>
  <p><ix:nonFraction name="se-gen-base:EgetKapital" contextRef="dim0" unitRef="SEK" decimals="0" scale="0" format="ixt:numspacecomma">999 999</ix:nonFraction></p>
  <p><ix:nonFraction name="se-gen-base:Soliditet" contextRef="balans0" unitRef="procent" decimals="0" scale="-2" format="ixt:numspacecomma">25</ix:nonFraction></p>
  <p>${nf('MedelantaletAnstallda', 'period0', '3')} <ix:nonFraction name="se-gen-base:KassaBank" contextRef="balans0" unitRef="SEK" decimals="INF" scale="0" format="ixt:fixed-zero">-</ix:nonFraction></p>
  <p><ix:nonNumeric name="se-gen-base:UnderskriftHandlingTilltalsnamn" contextRef="period0">Annika</ix:nonNumeric>
     <ix:nonNumeric name="se-gen-base:UnderskriftHandlingEfternamn" contextRef="period0">Testsdotter</ix:nonNumeric>
     <ix:nonNumeric name="se-ar-base:UnderskriftRevisionsberattelseRevisorEfternamn" contextRef="period0">Revisorsson</ix:nonNumeric></p>
  </body></html>`);
}
const col = (k) => 2 + X.FIELDS.findIndex(([n]) => n === k);

test('figures as filed: format, sign, scale, percentage, zero dash, dimensions ignored', () => {
  const r = X.companyReport('5560000001_2025-12-31.zip', zip([['a.xhtml', report()]]));
  assert.equal(r.o, '5560000001');
  assert.equal(r.fw, 'K2');
  assert.equal(r.y.length, 2);
  const [now, prev] = r.y;
  assert.deepEqual([now[0], now[1], prev[1]], ['2025-01-01', '2025-12-31', '2024-12-31']);
  assert.equal(now[col('revenue')], 1234567);
  assert.equal(prev[col('revenue')], 900000);
  assert.equal(now[col('netProfit')], -12345);
  assert.equal(now[col('totalAssets')], 2000);
  assert.equal(now[col('equity')], 500000, 'the scaled occurrence wins over the one missing its scale; the dimensional one is ignored');
  assert.equal(now[col('equityRatioReported')], 0.25);
  assert.equal(now[col('employees')], 3);
  assert.equal(now[col('cash')], 0);
  assert.equal(prev[col('equity')], null);
});

test('no personal data: signatory and auditor names never reach the output', () => {
  const r = X.companyReport('5560000001_2025-12-31.zip', zip([['a.xhtml', report()]]));
  const out = JSON.stringify(r);
  for (const name of ['Annika', 'Testsdotter', 'Revisorsson']) assert.ok(!out.includes(name), name);
});

test('a file name holding a personnummer-shaped number is never read', () => {
  assert.equal(X.companyReport('8001011234_2025-12-31.zip', zip([['a.xhtml', report()]])), null);
  assert.equal(X.companyReport('not-a-report.zip', zip([['a.xhtml', report()]])), null);
});

test('agreed(): mode first, then a 1,000x tie goes to the scaled value', () => {
  assert.equal(X.agreed([5, 5, 7]), 5);
  assert.equal(X.agreed([14186, 14185000]), 14185000);
  assert.equal(X.agreed([3, 4]), 3);
});

test('number formats', () => {
  assert.equal(X.factValue('<ix:nonFraction format="ixt:numdotdecimal" scale="0">', '1,234.50'), 1234.5);
  assert.equal(X.factValue('<ix:nonFraction format="ixt:numspacecomma" scale="6">', '1,5'), 1500000);
  assert.equal(X.factValue('<ix:nonFraction format="ixt:numspacecomma" scale="0" sign="-">', '&#160;7&nbsp;000'), -7000);
  assert.equal(X.factValue('<ix:nonFraction xsi:nil="true">', ''), null);
});

test('merge: each fiscal year from the newest report that holds it; build packs by organisationsnummer shard', () => {
  const older = X.companyReport('5560000001_2024-12-31.zip', zip([['a.xhtml', report({ revenue: '900 000', prevRevenue: '1' })]]));
  older.fe = '2024-12-31';
  older.y = older.y.map((row, i) => (i === 0 ? ['2024-01-01', '2024-12-31', ...row.slice(2)] : ['2023-01-01', '2023-12-31', ...row.slice(2)]));
  older.y[0][col('revenue')] = 111; // the 2025 report restates 2024 as 900 000
  const newer = X.companyReport('5560000001_2025-12-31.zip', zip([['a.xhtml', report()]]));
  const store = new Map();
  X.addReport(store, { ...newer, week: '2026/20_1' });
  X.addReport(store, { ...older, week: '2025/20_1' });
  const rec = X.finishRecord(store.get('5560000001'));
  assert.deepEqual(rec.y.map((r) => r[1]), ['2025-12-31', '2024-12-31', '2023-12-31']);
  assert.equal(rec.y[1][col('revenue')], 900000, 'restated comparative from the newer report wins');
  assert.equal(rec.y[1].at(-1), '2025-12-31');
  assert.equal(rec.latest, '2025-12-31');

  // State round trip, then pack and read one shard back by byte range.
  const store2 = new Map();
  for (const [o, r] of store) X.loadStateLine(store2, JSON.parse(JSON.stringify(X.stateLine(o, r))));
  const dir = mkdtempSync(join(tmpdir(), 'sefin-'));
  const m = B.pack(store2, dir, { dataAsOf: '2026-11-11', tag: 't' });
  assert.equal(m.companies, 1);
  assert.equal(m.shards, 509);
  assert.equal(B.shardOf('5560000001'), 556000000 % 509);
  const [off, len] = m.files.financials.index[B.shardOf('5560000001')];
  const shard = JSON.parse(gunzipSync(readFileSync(join(dir, m.files.financials.file)).subarray(off, off + len)).toString());
  assert.deepEqual(shard['5560000001'].y.map((r) => r[1]), ['2025-12-31', '2024-12-31', '2023-12-31']);
  assert.equal(m.row.length, shard['5560000001'].y[0].length);
});

test('no credit wording or computed ratios in the pipeline', () => {
  for (const f of ['ixbrl.mjs', 'build.mjs', 'extract.mjs', 'list.mjs']) {
    const src = readFileSync(join(__dirname, '..', 'scripts', 'se-financials', f), 'utf8').toLowerCase();
    // Words only ("operating" holds "rating"); the header comments may name the rule, so look at code lines.
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const w of [/creditworth/, /credit score/, /kreditvärdig/, /\brating\b/, /riskklass/]) assert.ok(!w.test(code), `${f}: ${w}`);
  }
});

test('list plan: skips processed files and balances chunks', async () => {
  const L = await import(pathToFileURL(join(__dirname, '..', 'scripts', 'se-financials', 'list.mjs')).href);
  const files = [
    { key: 'arsredovisningar/2023/01_1.zip', size: 50 }, { key: 'arsredovisningar/2024/01_1.zip', size: 100 },
    { key: 'arsredovisningar/2024/02_1.zip', size: 90 }, { key: 'arsredovisningar/2026/45_1.zip', size: 20 },
  ];
  const bins = L.plan(files, 2024, 2, new Set(['arsredovisningar/2026/45_1.zip:20']));
  assert.equal(bins.length, 2);
  assert.deepEqual(bins.flatMap((b) => b.files.map((f) => f.key)).sort(), ['arsredovisningar/2024/01_1.zip', 'arsredovisningar/2024/02_1.zip']);
});
