// /se/company: the build script and the Worker agree on the shard layout, the build keeps legal persons only and drops
// c/o lines, and the tool reads what the build writes (end to end, with a fetch that serves the built files).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

let S, B, out;
const BV = [
  'organisationsidentitet;namnskyddslopnummer;registreringsland;organisationsnamn;organisationsform;avregistreringsdatum;avregistreringsorsak;pagandeAvvecklingsEllerOmstruktureringsforfarande;registreringsdatum;verksamhetsbeskrivning;postadress',
  '"5567037485$ORGNR-IDORG";"1";"SE-LAND";"Spotify AB$FORETAGSNAMN-ORGNAM$2006-04-21";"AB-ORGFO";"";"";"";"2006-04-21";"Utveckling av programvara.";"Regeringsgatan 19$c/o Anna Andersson$STOCKHOLM$11153$SE-LAND"',
  '"5560000001$ORGNR-IDORG";"1";"SE-LAND";"Konkursbo Test \\"Exempel\\" AB$FORETAGSNAMN-ORGNAM$1990-01-01|Exempel Handel$SARS_FORNAMN-ORGNAM$1995-02-02$Handel.";"AB-ORGFO";"";"";"KK-AVOMFO$2026-10-01";"1990-01-01";"Handel med varor.";"Box 1$$GÖTEBORG$40010$SE-LAND"',
  '"5560000019$ORGNR-IDORG";"1";"SE-LAND";"Gammal Firma AB$FORETAGSNAMN-ORGNAM$1980-01-01";"AB-ORGFO";"2001-05-05";"KKAV-AVORG";"";"1980-01-01";"Skogsbruk.";"Gatan 2$$UMEÅ$90101$SE-LAND"',
  '"198001011234$PERSON-IDORG";"1";"SE-LAND";"Svenssons Snickeri$FORETAGSNAMN-ORGNAM$2010-01-01";"E-ORGFO";"";"";"";"2010-01-01";"Snickeri.";"Hemvägen 1$$LUND$22100$SE-LAND"',
  '"5560427220$ORGNR-IDORG";"1";"SE-LAND";"H & M Hennes & Mauritz AB$FORETAGSNAMN-ORGNAM$1974-01-01";"AB-ORGFO";"";"";"";"1974-01-01";"Handel med kläder.";"Box 1421$$STOCKHOLM$11184$SE-LAND"',
  '"8025043061$ORGNR-IDORG";"1";"SE-LAND";"HENNES & MAURITZ HK, UNIONENKLUBBEN$FORETAGSNAMN-ORGNAM$2001-01-01";"I-ORGFO";"";"";"";"2001-01-01";"Fackklubb.";"Box 9$$STOCKHOLM$11184$SE-LAND"',
  '"5560000027$ORGNR-IDORG";"1";"SE-LAND";"Lång beskrivning AB$FORETAGSNAMN-ORGNAM$2020-01-01";"AB-ORGFO";"";"";"";"2020-01-01";"Rad ett',
  'rad två.";"Vägen 3$$MALMÖ$21100$SE-LAND"',
].join('\n');
const SCB_HEAD = 'ForAndrTyp\tCOAdress\tForetagsnamn\tFtgStat\tGatuadress\tJEStat\tJurForm\tNamn\tNg1\tNg2\tNg3\tNg4\tNg5\tPeOrgNr\tPostNr\tPostOrt\tRegDatKtid\tReklamsparrtyp';
const SCB = [
  SCB_HEAD,
  '1\t\t\t1\tREGERINGSGATAN 19\t1\t49\tSPOTIFY AB\t63120\t62010\t\t\t\t165567037485\t11153\tSTOCKHOLM\t20060421\t1',
  '1\tPER PERSSON\t\t1\tSTORGATAN 1\t1\t82\tTESTKOMMUN\t84110\t\t\t\t\t162120000001\t11111\tTESTSTAD\t19710101\t1',
  '1\t\t\t1\tHEMVÄGEN 1\t2\t10\tSVEN SVENSSON\t43320\t\t\t\t\t198001011234\t22100\tLUND\t20100101\t1',
  // A dödsbo (SCB legal form 91): named after the deceased person, address often a relative's home. Must never be written.
  '1\t\t\t1\tTESTVÄGEN 9\t1\t91\tTESTSSONS DÖDSBO, KARL\t68209\t\t\t\t\t161029999990\t12345\tTESTBY\t20200101\t1',
].join('\n');

before(async () => {
  const b = await build({ entryPoints: ['src/routes/se-company.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  S = m.exports;
  B = await import(pathToFileURL(join(__dirname, '..', 'scripts', 'build-se-company-index.mjs')).href);
  const dir = mkdtempSync(join(tmpdir(), 'se-company-'));
  writeFileSync(join(dir, 'bv.txt'), BV);
  writeFileSync(join(dir, 'scb.txt'), Buffer.from(SCB, 'latin1'));
  out = join(dir, 'out');
  execFileSync(process.execPath, ['scripts/build-se-company-index.mjs', join(dir, 'bv.txt'), out, join(dir, 'scb.txt')], { env: { ...process.env, SE_MIN_RECORDS: '1', SE_DATA_AS_OF: '2026-11-09' } });
});

/** A fetch that serves the built files by their asset name, as the GitHub release would. */
const served = (calls = []) => async (url, init = {}) => {
  calls.push(String(url));
  const file = join(out, String(url).split('/').pop());
  if (!existsSync(file)) return new Response('Not Found', { status: 404 });
  const body = readFileSync(file);
  const range = /^bytes=(\d+)-(\d+)$/.exec(init.headers?.range ?? '');
  if (!range) return new Response(body, { status: 200 });
  return new Response(body.subarray(Number(range[1]), Number(range[2]) + 1), { status: 206 });
};

test('the build script and the Worker use the same shards and name normalisation', () => {
  assert.equal(B.SHARDS, S.SHARDS);
  for (const o of ['5567037485', '5560000001', '2120000001', '9696123456', '7696000005']) assert.equal(B.shardOf(o), S.shardOf(o));
  for (const w of ['spotify', 'göteborg', 'åkersberga', 'ab', 'x1']) assert.equal(B.nameShardOf(w), S.nameShardOf(w));
  assert.deepEqual(B.nameWords('Aktiebolaget Åkersberga Storband HB'), S.nameWords('Aktiebolaget Åkersberga Storband HB'));
  assert.deepEqual(S.nameWords('Spotify AB (publ)'), ['spotify']);
  for (const n of ['H & M Hennes & Mauritz AB', 'A P Møller Mærsk A/S', 'Bygg i Umeå AB', '3 M Svenska AB']) assert.deepEqual(B.nameWords(n), S.nameWords(n));
  assert.deepEqual(S.nameWords('H & M Hennes & Mauritz AB'), ['hm', 'hennes', 'mauritz'], 'initials are one word');
  assert.deepEqual(S.nameWords('A P Møller Mærsk A/S'), ['ap', 'moller', 'maersk', 'as']);
  assert.deepEqual(S.nameWords('H&M'), ['hm']);
});

test('organisationsnummer input: hyphen, 16 prefix, VAT number; personal numbers and bad check digits refused', () => {
  assert.equal(S.orgnrOf('556703-7485'), '5567037485');
  assert.equal(S.orgnrOf('16 5567037485'), '5567037485');
  assert.equal(S.orgnrOf('SE556703748501'), '5567037485');
  assert.equal(S.orgnrOf('se 5567 0374 8501'), '5567037485');
  assert.throws(() => S.orgnrOf('198001011234'), (e) => e.status === 400 && /personal identity number/.test(e.message));
  assert.throws(() => S.orgnrOf('8001011234'), (e) => e.status === 400 && /personal identity number/.test(e.message));
  assert.throws(() => S.orgnrOf('5567037486'), (e) => e.status === 400 && /check digit/.test(e.message));
  assert.throws(() => S.orgnrOf('hello'), (e) => e.status === 400);
});

test('the build keeps legal persons only and never writes a c/o line or a personnummer', () => {
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.dataAsOf, '2026-11-09');
  assert.equal(manifest.skippedPersons, 1);
  assert.equal(manifest.skippedEstates, 1, 'the dödsbo row is counted and left out');
  assert.equal(manifest.unreadableRows, 0);
  assert.equal(manifest.files.companies.index.length, S.SHARDS);
  assert.equal(manifest.files.names.index.length, S.SHARDS);
  const all = ['companies', 'names'].flatMap((k) => {
    const f = manifest.files[k];
    const bin = readFileSync(join(out, f.file));
    assert.equal(bin.length, f.bytes);
    return f.index.map(([o, n]) => require('node:zlib').gunzipSync(bin.subarray(o, o + n)).toString('utf8'));
  }).join('\n');
  assert.doesNotMatch(all, /Anna Andersson|PER PERSSON|198001011234|Svenssons|SVEN SVENSSON|DÖDSBO|TESTSSONS|1029999990|TESTVÄGEN/);
  assert.match(all, /Konkursbo Test \\"Exempel\\" AB/, 'an escaped quote in a name is read as a quote');
});

test('lookup by organisationsnummer: register facts merged from both files, plain English, not a credit report', async () => {
  const run = (params) => S.SE_COMPANY[0].run({}, (n) => params[n]);
  const calls = [];
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = served(calls);
  try {
    const a = await run({ orgnr: '556703-7485' });
    assert.equal(a.name, 'Spotify AB');
    assert.equal(a.vatNumber, 'SE556703748501');
    assert.deepEqual(a.legalForm, { code: 'AB', name: 'Aktiebolag (limited company)' });
    assert.equal(a.status, 'registered');
    assert.equal(a.registered, '2006-04-21');
    assert.equal(a.taxActive, true);
    assert.deepEqual(a.industries, [{ sni: '63.120' }, { sni: '62.010' }]);
    assert.deepEqual(a.address, { street: 'Regeringsgatan 19', postcode: '11153', city: 'STOCKHOLM', country: 'SE' });
    assert.equal(a.vat, null);
    assert.equal(a.dataAsOf, '2026-11-09');
    assert.match(a.note, /not a credit report/);
    assert.ok(calls.some((u) => u.endsWith('/se-register/manifest.json')));
    assert.ok(calls.some((u) => u.endsWith('/se-register/se-companies-2026-11-09.bin')));

    const k = await run({ orgnr: '5560000001' });
    assert.equal(k.status, 'registered, bankruptcy in progress');
    assert.deepEqual(k.proceedings, [{ code: 'KK', type: 'bankruptcy (konkurs)', since: '2026-10-01' }]);
    assert.equal(k.otherNames[0].name, 'Exempel Handel');
    assert.equal(k.otherNames[0].type, 'secondary business name');

    const d = await run({ orgnr: '5560000019' });
    assert.equal(d.status, 'deregistered');
    assert.deepEqual(d.deregistered, { date: '2001-05-05', reason: 'bankruptcy' });
    assert.equal(d.businessDescription, null, 'deregistered companies carry no description');

    const m = await run({ orgnr: '5560000027' });
    assert.equal(m.businessDescription, 'Rad ett\nrad två.', 'a description across two lines is one field');

    const kommun = await run({ orgnr: '212000-0001' });
    assert.equal(kommun.name, 'TESTKOMMUN');
    assert.deepEqual(kommun.legalForm, { code: 'SCB 82', name: 'Kommun (municipality)' });
    assert.equal(kommun.address.street, 'STORGATAN 1');

    await assert.rejects(run({ orgnr: '5560000035' }), (e) => e.status === 404 && /nothing was charged/.test(e.message));
    await assert.rejects(run({}), (e) => e.status === 400);
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test('name search: every word must match, exact and leading matches first, deregistered companies left out', async () => {
  const run = (params) => S.SE_COMPANY[0].run({}, (n) => params[n]);
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = served();
  try {
    const r = await run({ name: 'spotify' });
    assert.equal(r.matches[0].name, 'Spotify AB');
    assert.equal(r.matches[0].orgnr, '556703-7485');
    assert.match(r.next, /orgnr/);
    const e = await run({ name: 'exempel handel' });
    assert.equal(e.matches[0].orgnr, '556000-0001');
    await assert.rejects(run({ name: 'gammal firma' }), (x) => x.status === 404);
    await assert.rejects(run({ name: 'AB' }), (x) => x.status === 400);

    // Initials: "H&M" finds the company, and a trading company ranks above an association that only starts with the words.
    const hm = await run({ name: 'H&M' });
    assert.equal(hm.matches[0].orgnr, '556042-7220');
    const hennes = await run({ name: 'hennes & mauritz' });
    assert.deepEqual(hennes.matches.map((m) => m.orgnr), ['556042-7220', '802504-3061']);
    assert.equal(hennes.matches[0].city, 'STOCKHOLM');

    // City narrows the search (diacritics and case ignored); a city with no match is a 404.
    const gbg = await run({ name: 'exempel', city: 'goteborg' });
    assert.deepEqual(gbg.matches.map((m) => m.orgnr), ['556000-0001']);
    assert.equal(gbg.city, 'goteborg');
    await assert.rejects(run({ name: 'spotify', city: 'Göteborg' }), (x) => x.status === 404 && /in Göteborg/.test(x.message));
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test('a missing release is an uncharged 503, never a 404 that reads as "no such company"', async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => new Response('Not Found', { status: 404 });
  try {
    await assert.rejects(S.lookupOrgnr('5567037485'), (e) => e.status === 503);
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test('estates (dödsbon, SCB legal form 91) are refused by the Worker and skipped by the build, with one rule', () => {
  for (const v of ['91', ' 91', 91]) { assert.equal(S.isEstate(v), true); assert.equal(B.isEstate(v), true); }
  for (const v of ['49', '9', '191', null, undefined, '']) { assert.equal(S.isEstate(v), false); assert.equal(B.isEstate(v), false); }
  const src = readFileSync(join(__dirname, '..', 'src', 'routes', 'se-company.ts'), 'utf8');
  assert.match(src, /if \(isEstate\(rec\.jf\)\) throw new HttpError\(404, ESTATE_REFUSAL\)/, 'lookup refuses an estate even in a copy built before the build skipped them');
  assert.match(src, /seen\.has\(orgnr\) \|\| isEstate\(form\)/, 'name search skips estates');
});

test('the copy never offers a credit score, rating or opinion', () => {
  const e = S.SE_COMPANY[0].endpoint;
  const { note, ...example } = e.outputExample;
  assert.match(note, /not a credit report/);
  const text = `${e.summary} ${e.description} ${JSON.stringify(example)} ${JSON.stringify(e.params)}`;
  assert.doesNotMatch(text, /credit ?score|rating|creditworth|kreditupplysning|risk (score|grade)|safe to/i);
  assert.match(e.description, /not a credit report/);
});
