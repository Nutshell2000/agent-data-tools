// 15 Nov 2026: the speech-to-text product page showed the PDF upload example (report.pdf, application/pdf, 10 MB).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('the speech page shows an audio upload with its real limits; PDF pages keep the PDF example', async () => {
  const pp = await load('src/lib/product-pages.ts');
  const speech = pp.productPage(pp.productBySlug('speech-to-text-api'), 'https://o.test', false, () => undefined);
  assert.ok(!/report\.pdf|application\/pdf/.test(speech), 'no PDF example on the speech page');
  assert.match(speech, /file=@meeting\.mp3/);
  assert.match(speech, /Content-Type: audio\/mpeg/);
  assert.match(speech, /60 minutes/);
  const pdfProduct = pp.PRODUCTS.find((p) => p.upload && !p.uploadExample);
  assert.ok(pdfProduct, 'a PDF upload product exists');
  assert.match(pp.productPage(pdfProduct, 'https://o.test', false, () => undefined), /file=@report\.pdf/);
});
