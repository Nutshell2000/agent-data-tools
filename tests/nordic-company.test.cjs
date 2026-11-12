// /no/company and /fi/company: number parsing with check digits, sole proprietorships refused, register flags read as
// plain status, name ranking, and the same "not a credit report" line as /se/company. The registers are mocked.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let N;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/nordic-company.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  N = m.exports;
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function withFetch(handler, fn) {
  const before = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return handler(new URL(String(url))); };
  try { return await fn(calls); } finally { globalThis.fetch = before; }
}
const run = (i, params) => N.NORDIC_COMPANY[i].run({}, (n) => params[n]);

test('Norwegian and Finnish numbers: formats accepted, check digits enforced', () => {
  assert.equal(N.noOrgnrOf('923609016'), '923609016');
  assert.equal(N.noOrgnrOf('NO 923 609 016 MVA'), '923609016');
  assert.equal(N.noOrgnrOf('923609016MVA'), '923609016');
  assert.throws(() => N.noOrgnrOf('923609017'), (e) => e.status === 400 && /check digit/.test(e.message));
  assert.throws(() => N.noOrgnrOf('12345'), (e) => e.status === 400);
  assert.equal(N.fiIdOf('0112038-9'), '0112038-9');
  assert.equal(N.fiIdOf('FI01120389'), '0112038-9');
  assert.equal(N.fiIdOf('01120389'), '0112038-9');
  assert.equal(N.fiIdOf('112038-9'), '0112038-9');
  assert.equal(N.fiIdOf('2336509-6'), '2336509-6');
  assert.throws(() => N.fiIdOf('0112038-8'), (e) => e.status === 400 && /check digit/.test(e.message));
});

test('Norway: bankruptcy reads as status, VAT number only when VAT-registered, phone never returned, ENK refused', async () => {
  const units = {
    '935567645': { organisasjonsnummer: '935567645', navn: 'TEST KAFE AS', organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' }, konkurs: true, registrertIMvaregisteret: false, telefon: '99 99 99 99', mobil: '44 44 44 44', forretningsadresse: { adresse: ['Gata 1'], postnummer: '0150', poststed: 'OSLO', landkode: 'NO' } },
    '933365573': { organisasjonsnummer: '933365573', navn: 'OLA NORDMANN', organisasjonsform: { kode: 'ENK', beskrivelse: 'Enkeltpersonforetak' } },
  };
  await withFetch((u) => {
    const id = u.pathname.split('/').pop();
    return Object.hasOwn(units, id) ? json(units[id]) : json({}, 404);
  }, async (calls) => {
    const k = await run(0, { orgnr: '935567645' });
    assert.equal(k.status, 'registered, bankruptcy in progress');
    assert.deepEqual(k.proceedings, ['bankruptcy (konkurs)']);
    assert.equal(k.vatNumber, null);
    assert.equal(k.address.city, 'OSLO');
    assert.doesNotMatch(JSON.stringify(k), /99 99|44 44/, 'phone numbers are never returned');
    await assert.rejects(run(0, { orgnr: '933365573' }), (e) => e.status === 404 && /sole proprietorship/.test(e.message));
    await assert.rejects(run(0, { orgnr: '923609016' }), (e) => e.status === 404 && /nothing was charged/.test(e.message));
    assert.ok(calls.every((c) => !/roller/.test(c)), 'the roles endpoint (people) is never called');
  });
});

test('Norway name search: whole words and trading companies first, sole proprietorships left out, city filter', async () => {
  const enheter = [
    { organisasjonsnummer: '1', navn: 'KIWISKOLEN AS', organisasjonsform: { kode: 'AS' }, forretningsadresse: { poststed: 'LIER' } },
    { organisasjonsnummer: '2', navn: 'KIWI FOTBALLKLUBB', organisasjonsform: { kode: 'FLI' }, forretningsadresse: { poststed: 'OSLO' } },
    { organisasjonsnummer: '3', navn: 'KIWI NORGE AS', organisasjonsform: { kode: 'AS' }, forretningsadresse: { poststed: 'OSLO' } },
    { organisasjonsnummer: '4', navn: 'KIWI KARI', organisasjonsform: { kode: 'ENK' }, forretningsadresse: { poststed: 'OSLO' } },
  ];
  await withFetch(() => json({ _embedded: { enheter }, page: { totalElements: 4 } }), async () => {
    const r = await run(0, { name: 'kiwi' });
    assert.deepEqual(r.matches.map((m) => m.name), ['KIWI NORGE AS', 'KIWI FOTBALLKLUBB', 'KIWISKOLEN AS']);
    assert.ok(!('formCode' in r.matches[0]));
    const o = await run(0, { name: 'kiwi', city: 'oslo' });
    assert.deepEqual(o.matches.map((m) => m.orgnr), ['3', '2']);
    await assert.rejects(run(0, { name: 'kiwi', city: 'Bergen' }), (e) => e.status === 404);
  });
});

test('Finland: status, proceedings, registers and the VAT number from the register entries', async () => {
  const company = {
    businessId: { value: '0112038-9', registrationDate: '1978-03-15' },
    names: [{ name: 'Test Oyj', type: '1' }, { name: 'Test Aux', type: '3' }, { name: 'Test Abp', type: '2' }, { name: 'Old Oy', type: '1', endDate: '1997-08-31' }],
    companyForms: [{ type: '17', descriptions: [{ languageCode: '3', description: 'Public limited company' }] }],
    companySituations: [{ type: 'KONK', descriptions: [{ languageCode: '3', description: 'Bankrupt' }], registrationDate: '2026-10-01' }],
    registeredEntries: [{ register: '1' }, { register: '6' }, { register: '7' }],
    addresses: [{ type: 1, street: 'Katu', buildingNumber: '7', postCode: '02610', postOffices: [{ city: 'ESBO', languageCode: '2' }, { city: 'ESPOO', languageCode: '1' }] }],
    tradeRegisterStatus: '1',
  };
  await withFetch((u) => json(u.searchParams.get('businessId') === '0112038-9' ? { totalResults: 1, companies: [company] } : { totalResults: 0, companies: [] }), async () => {
    const c = await run(1, { businessId: 'FI01120389' });
    assert.equal(c.name, 'Test Oyj');
    assert.equal(c.vatNumber, 'FI01120389');
    assert.equal(c.status, 'registered, bankrupt in progress');
    assert.deepEqual(c.otherNames.map((n) => n.type), ['parallel name', 'auxiliary name']);
    assert.deepEqual(c.formerNames, [{ name: 'Old Oy', until: '1997-08-31' }]);
    assert.deepEqual(c.registers, ['trade register', 'VAT register', 'employer register']);
    assert.deepEqual(c.address, { street: 'Katu 7', postcode: '02610', city: 'ESPOO', country: 'FI' });
    await assert.rejects(run(1, { businessId: '2336509-6' }), (e) => e.status === 404);
  });
});

test('Finland name search also asks with Oy and Oyj, so a brand found pages away still comes first', async () => {
  const co = (id, name, form = '16', end) => ({ businessId: { value: id }, names: [{ name, type: '1' }], companyForms: [{ type: form, descriptions: [{ languageCode: '3', description: 'x' }] }], addresses: [{ type: 1, postOffices: [{ city: 'ESPOO', languageCode: '1' }] }], ...(end ? { endDate: end } : {}) });
  await withFetch((u) => {
    const n = u.searchParams.get('name');
    if (n === 'kone Oyj') return json({ totalResults: 1, companies: [co('1927400-1', 'KONE Oyj', '17')] });
    if (n === 'kone Oy') return json({ totalResults: 1, companies: [co('0000001-9', 'AT-Kone Oy')] });
    return json({ totalResults: 11959, companies: [co('0110139-9', 'Kone Oyj', '17', '2005-06-01'), co('0000002-7', 'Konekauha Oy'), co('0000001-9', 'AT-Kone Oy')] });
  }, async (calls) => {
    const r = await run(1, { name: 'kone' });
    assert.equal(r.matches[0].businessId, '1927400-1');
    assert.ok(!r.matches.some((m) => m.businessId === '0110139-9'), 'an ended company is left out of searches');
    assert.equal(new Set(r.matches.map((m) => m.businessId)).size, r.matches.length, 'no duplicates across the three searches');
    assert.equal(calls.length, 3);
  });
});

test('the copy never offers a credit score, rating or opinion', () => {
  for (const e of N.NORDIC_COMPANY.map((x) => x.endpoint)) {
    const { note, ...example } = e.outputExample;
    assert.match(note, /not a credit report/);
    const text = `${e.summary} ${e.description} ${JSON.stringify(example)} ${JSON.stringify(e.params)}`;
    assert.doesNotMatch(text, /credit ?score|rating|creditworth|kredittverd|luottoluokit|risk (score|grade)|safe to/i);
    assert.match(e.description, /not a credit report/);
  }
});
