// /vat/validate by name (1.152.0): a company name is verified in the FR, SE, NO and FI registers. Why: Datacircle's
// "Business verification in France" benchmark (11 Nov 2026) sent {"entity_name": ...} only and got no answer 8 times in 10.
// The registers are stubbed here; the register tools' own tests cover their sources.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let V, R;
before(async () => {
  const load = async (entry) => {
    const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
    const m = { exports: {} };
    new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
    return m.exports;
  };
  V = await load('src/routes/company-verify.ts');
  R = await load('src/routes/registries.ts');
});

// Each register answers "nothing matches" with a 404 (status on the error); anything else means it could not be searched.
function stubs(map) {
  const out = {};
  for (const c of V.NAME_REGISTERS) {
    const rows = map[c];
    out[c] = {
      idType: c === 'FR' ? 'SIREN' : 'id', tool: `/${c.toLowerCase()}/company?id=`, source: `${c} register`,
      id: (m) => m.siren ?? m.orgnr ?? m.businessId,
      search: async () => {
        if (rows === 'down') throw new Error('upstream timeout');
        if (!rows || !rows.length) throw Object.assign(new Error('nothing'), { status: 404 });
        return { matches: rows };
      },
    };
  }
  return out;
}

test('core names drop legal forms and accents', () => {
  assert.equal(V.coreName('Société Générale SA'), 'societe generale');
  assert.equal(V.coreName('Spotify AB'), 'spotify');
  assert.equal(V.coreName('KONE Oyj'), 'kone');
});

test('country: codes and names of the four registers; anything else refused', () => {
  assert.equal(V.nameRegister('fr'), 'FR');
  assert.equal(V.nameRegister('France'), 'FR');
  assert.equal(V.nameRegister('Sweden'), 'SE');
  assert.equal(V.nameRegister(undefined), null);
  assert.throws(() => V.nameRegister('DE'), /FR, SE, NO or FI/);
});

test('a real French company is found, exact match first', async () => {
  const r = await V.verifyCompanyByName('Société Générale', null, stubs({
    FR: [{ name: 'SOCIETE GENERALE SECURITIES', siren: '111111111' }, { name: 'SOCIETE GENERALE', siren: '552120222', legalForm: 'SA', city: 'PARIS' }],
    SE: [{ name: 'Societe Generale Stockholm filial', orgnr: '516406-0120' }],
  }));
  assert.equal(r.found, true);
  assert.equal(r.exactMatch, true);
  assert.equal(r.bestMatch.country, 'FR');
  assert.equal(r.bestMatch.id, '552120222');
  assert.deepEqual(r.registersSearched, ['FR', 'SE', 'NO', 'FI']);
  assert.match(r.next, /552120222/);
});

test('a made-up name is an answer: found false', async () => {
  const r = await V.verifyCompanyByName('Vornelle Quistade', null, stubs({}));
  assert.equal(r.found, false);
  assert.equal(r.bestMatch, null);
  assert.deepEqual(r.matches, []);
});

test('a register that is down is named and the answer marked incomplete; all down is an uncharged 502', async () => {
  const miss = await V.verifyCompanyByName('Vornelle Quistade', null, stubs({ NO: 'down' }));
  assert.equal(miss.found, false);
  assert.equal(miss.complete, false);
  assert.deepEqual(miss.registersFailed, ['NO']);
  assert.deepEqual(miss.registersSearched, ['FR', 'SE', 'FI']);
  const hit = await V.verifyCompanyByName('Pigment', null, stubs({ FR: [{ name: 'PIGMENT', siren: '852000000' }] }));
  assert.equal(hit.complete, true);
  assert.equal(hit.registersFailed, undefined);
  await assert.rejects(V.verifyCompanyByName('Pigment', 'FI', stubs({ FI: 'down' })), (e) => e.status === 502 && /FI/.test(e.message));
  await assert.rejects(V.verifyCompanyByName('Pigment', null, stubs({ FR: 'down', SE: 'down', NO: 'down', FI: 'down' })), (e) => e.status === 502);
});

test('one country searches one register only', async () => {
  const seen = [];
  const s = stubs({ FR: [{ name: 'LESIEUR', siren: '395000000' }] });
  for (const c of Object.keys(s)) { const f = s[c].search; s[c].search = (...a) => { seen.push(c); return f(...a); }; }
  const r = await V.verifyCompanyByName('LESIEUR', 'FR', s);
  assert.deepEqual(seen, ['FR']);
  assert.equal(r.found, true);
});

test('/vat/validate: a name instead of a VAT number goes to the registers; no input is still a 400', async () => {
  const entry = R.REGISTRIES.find((e) => e.endpoint.path === '/vat/validate');
  assert.ok(entry);
  assert.notEqual(entry.endpoint.params.vat.required, true);
  assert.ok(entry.endpoint.params.name && entry.endpoint.params.country);
  await assert.rejects(entry.run({}, () => undefined), (e) => e.status === 400);
  await assert.rejects(entry.run({}, (n) => ({ name: 'Acme', country: 'DE' })[n]), (e) => e.status === 400 && /FR, SE, NO or FI/.test(e.message));
});
