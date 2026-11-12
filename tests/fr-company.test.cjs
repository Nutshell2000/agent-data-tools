// /fr/company: SIREN, SIRET and VAT parsing with the Luhn and VAT-key checks; sole traders and opted-out units never shown;
// directors and finances never read into the answer; large companies first in a name search. The API is mocked.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let F;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/fr-company.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  F = m.exports;
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function withFetch(handler, fn) {
  const before = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(new URL(String(url))); return handler(new URL(String(url))); };
  try { return await fn(calls); } finally { globalThis.fetch = before; }
}
const run = (params) => F.FR_COMPANY[0].run({}, (n) => params[n]);
const unit = (siren, name, extra = {}) => ({ siren, nom_complet: name, nom_raison_sociale: name, nature_juridique: '5710', etat_administratif: 'A', statut_diffusion: 'O', siege: { siret: `${siren}00012`, adresse: '1 RUE X 75001 PARIS', code_postal: '75001', libelle_commune: 'PARIS' }, complements: { est_entrepreneur_individuel: false }, ...extra });

test('SIREN, SIRET and VAT numbers: Luhn and VAT key checked', () => {
  assert.equal(F.sirenOf('552032534'), '552032534');
  assert.equal(F.sirenOf('552 032 534'), '552032534');
  assert.equal(F.sirenOf('55203253400703'), '552032534');
  assert.equal(F.sirenOf('FR27552032534'), '552032534');
  assert.equal(F.frVat('552032534'), 'FR27552032534');
  assert.throws(() => F.sirenOf('552032535'), (e) => e.status === 400 && /check digit/.test(e.message));
  assert.throws(() => F.sirenOf('FR28552032534'), (e) => e.status === 400 && /key/.test(e.message));
  assert.throws(() => F.sirenOf('1234'), (e) => e.status === 400);
});

test('lookup: register facts only; directors, finances and coordinates never returned; sole traders refused', async () => {
  const danone = unit('552032534', 'DANONE', {
    nature_juridique: '5599', categorie_entreprise: 'GE', tranche_effectif_salarie: '42', annee_tranche_effectif_salarie: '2024', tva: ['FR27552032534'],
    dirigeants: [{ nom: 'DUPONT', prenoms: 'Jean', annee_de_naissance: '1960', type_dirigeant: 'personne physique' }],
    finances: { 2024: { ca: 27000000000, resultat_net: 2000000000 } },
    siege: { siret: '55203253400703', adresse: '59-61 RUE LA FAYETTE 75009 PARIS', code_postal: '75009', libelle_commune: 'PARIS', latitude: '48.87', longitude: '2.34', caractere_employeur: 'O' },
  });
  const trader = unit('531722742', 'OLIVIA DANON', { nature_juridique: '1000', complements: { est_entrepreneur_individuel: true } });
  await withFetch((u) => json({ total_results: 1, results: u.searchParams.get('q') === '552032534' ? [danone] : u.searchParams.get('q') === '531722742' ? [trader] : [] }), async (calls) => {
    const d = await run({ siren: '552032534' });
    assert.equal(d.name, 'DANONE');
    assert.equal(d.vatNumber, 'FR27552032534');
    assert.deepEqual(d.legalForm, { code: '5599', name: "SA à conseil d'administration" });
    assert.deepEqual(d.employees, { band: '1,000-1,999', year: '2024' });
    assert.equal(d.employer, true);
    assert.equal(d.category, 'large company (GE)');
    const text = JSON.stringify(d);
    assert.doesNotMatch(text, /DUPONT|Jean|1960|27000000000|resultat|48\.87/, 'no directors, finances or coordinates');
    await assert.rejects(run({ siren: '531722742' }), (e) => e.status === 404 && /sole trader/.test(e.message));
    await assert.rejects(run({ siren: '732829320' }), (e) => e.status === 404 && /nothing was charged/.test(e.message));
    assert.ok(calls.every((c) => c.searchParams.get('est_entrepreneur_individuel') === 'false'), 'sole traders are never asked for');
  });
});

test('name search: words must be in the name, large companies first, opted-out units dropped, city filter', async () => {
  const results = [
    unit('100000001', 'MICHELIN', { categorie_entreprise: 'PME', siege: { libelle_commune: 'GRUFFY' } }),
    unit('100000002', 'ELIOR RESTAURATION FRANCE', { categorie_entreprise: 'GE' }),
    unit('100000003', 'MANUFACTURE FRANCAISE DES PNEUMATIQUES MICHELIN', { categorie_entreprise: 'GE', siege: { libelle_commune: 'CLERMONT-FERRAND' } }),
    unit('100000004', 'MICHELIN PRIVE', { statut_diffusion: 'P' }),
  ];
  await withFetch(() => json({ total_results: 4, results }), async (calls) => {
    const r = await run({ name: 'michelin' });
    assert.deepEqual(r.matches.map((m) => m.siren), ['100000003', '100000001']);
    const c = await run({ name: 'michelin', city: 'clermont' });
    assert.deepEqual(c.matches.map((m) => m.siren), ['100000003']);
    assert.equal(calls.at(-1).searchParams.get('q'), 'michelin clermont', 'the town goes into the search text');
  });
});

test('a busy register is an uncharged 503', async () => {
  await withFetch(() => new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }), async () => {
    await assert.rejects(run({ siren: '552032534' }), (e) => e.status === 503 && /nothing was charged/.test(e.message));
  });
});

test('the copy never offers a credit score, rating or opinion', () => {
  const e = F.FR_COMPANY[0].endpoint;
  const { note, ...example } = e.outputExample;
  assert.match(note, /not a credit report/);
  assert.doesNotMatch(`${e.summary} ${e.description} ${JSON.stringify(example)} ${JSON.stringify(e.params)}`, /credit ?score|rating|creditworth|solvabilit|risk (score|grade)|safe to/i);
});
