// 1.325.0: calls that a willing buyer sent and that were refused for their form, not their substance (/status, seven
// days to 21 Nov 2026): regional language tags on the speech tools, and JSON or PDF links sent to the page readers.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

const cache = new Map();
async function load(entry) {
  if (cache.has(entry)) return cache.get(entry);
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{ name: 'url', setup(p) { p.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  cache.set(entry, m.exports);
  return m.exports;
}

/** Minimal valid PDF with one line of Helvetica text per page (as in tests/families.test.cjs). */
function makePdf(pageTexts) {
  const objs = [];
  const kids = pageTexts.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const [i, t] of pageTexts.entries()) {
    const stream = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objs.push('<< /Title (Test) >>');
  let out = '%PDF-1.4\n';
  const offsets = objs.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const serving = async (answers, run) => {
  const real = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const href = String(input instanceof Request ? input.url : input);
    const a = answers[href];
    if (!a) throw new TypeError(`no fixture for ${href}`);
    return new Response(a.body, { status: 200, headers: { 'content-type': a.type } });
  };
  try { return await run(); } finally { globalThis.fetch = real; }
};

test('a regional tag, a three-letter code or a name is the language it stands for', async () => {
  const { languageCode, speechLangOf, retiredSpeechLang } = await load('src/lib/melo.ts');
  for (const [raw, code] of [['en-US', 'en'], ['en_GB', 'en'], ['EN', 'en'], ['eng', 'en'], ['English', 'en'], ['es-MX', 'es'], ['es-419', 'es'], ['spa', 'es'], ['Español', 'es'], ['zh-Hans-CN', 'zh'], ['fr-FR', 'fr']]) assert.equal(languageCode(raw), code, raw);
  assert.equal(speechLangOf('en-US'), 'en');
  assert.equal(speechLangOf('es_ES'), 'es');
  assert.equal(speechLangOf('de-DE'), undefined, 'a language that is not spoken is still not spoken');
  assert.equal(retiredSpeechLang('fr-CA'), 'fr', 'a retired language is named whatever its region');
  assert.equal(retiredSpeechLang('en-US'), undefined);
});

test('the shared list check takes language tags only for a list of language codes', async () => {
  const { allowedValue } = await load('src/family.ts');
  assert.equal(allowedValue('en-US', ['en', 'es']), 'en');
  assert.equal(allowedValue('english', ['en', 'es']), 'en');
  assert.equal(allowedValue('es_MX', ['en', 'es']), 'es');
  assert.equal(allowedValue('fr-FR', ['en', 'es']), undefined);
  assert.equal(allowedValue('base-sepolia', ['base', 'eth', 'op']), undefined, 'a testnet name is never read as its mainnet');
  assert.equal(allowedValue('op-mainnet', ['op', 'eth']), undefined, 'a list that is not all two-letter codes is not a language list');
  assert.equal(allowedValue('mp3', ['mp3', 'wav']), 'mp3');
});

test('the speech tools take en-US and es-MX, and still refuse a retired or unknown language uncharged', async () => {
  const { speechVoice } = await load('src/routes/ai-text.ts');
  const q = (values) => (name) => values[name];
  assert.equal(speechVoice(q({ lang: 'en-US' })).lang, 'en');
  assert.equal(speechVoice(q({ lang: 'es-MX' })).lang, 'es');
  assert.equal(speechVoice(q({})).lang, 'en');
  assert.throws(() => speechVoice(q({ lang: 'de-DE' })), (e) => e.status === 400);
});

test('a page reader reads a JSON or CSV link as its text and says so', async () => {
  const { extract } = await load('src/routes/extract.ts');
  const out = await serving({
    'https://public.example/data.json': { type: 'application/json; charset=utf-8', body: '{"price":12.5,"currency":"EUR"}' },
    'https://public.example/feed': { type: 'application/atom+xml', body: '<feed><title>News</title></feed>' },
    'https://public.example/table': { type: 'text/csv', body: 'a,b\n1,2\n' },
  }, async () => [await extract('https://public.example/data.json'), await extract('https://public.example/feed'), await extract('https://public.example/table')]);
  assert.equal(out[0].text, '{"price":12.5,"currency":"EUR"}');
  assert.equal(out[0].sourceFormat, 'plain');
  assert.ok(out[0].warnings.includes('non_html_source'));
  assert.match(out[1].text, /<title>News<\/title>/);
  assert.equal(out[2].text, 'a,b\n1,2');
});

test('a page reader reads a PDF link through the PDF reader: its first pages, with a warning that names the cut', async () => {
  const { extract } = await load('src/routes/extract.ts');
  const out = await serving({
    'https://public.example/paper.pdf': { type: 'application/pdf', body: makePdf(['Alpha page one', 'Beta page two']) },
    'https://public.example/long': { type: 'application/pdf', body: makePdf(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']) },
  }, async () => [await extract('https://public.example/paper.pdf'), await extract('https://public.example/long')]);
  assert.match(out[0].text, /Alpha page one[\s\S]*Beta page two/);
  assert.ok(out[0].warnings.includes('pdf_source'));
  assert.equal(out[0].truncated, false);
  assert.match(out[1].text, /p1[\s\S]*p5/);
  assert.doesNotMatch(out[1].text, /p6/);
  assert.ok(out[1].warnings.includes('pdf_first_5_pages_of_7'));
  assert.equal(out[1].truncated, true, 'a cut PDF is marked truncated');
});

test('an image or other binary link is still refused uncharged, and a section of a non-HTML file too', async () => {
  const { extract } = await load('src/routes/extract.ts');
  await serving({
    'https://public.example/a.png': { type: 'image/png', body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    'https://public.example/data.json': { type: 'application/json', body: '{}' },
  }, async () => {
    await assert.rejects(() => extract('https://public.example/a.png'), (e) => e.status === 415 && /nothing was charged/.test(e.message));
    await assert.rejects(() => extract('https://public.example/data.json', undefined, 'text', 'intro'), (e) => e.status === 415);
  });
});
