const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('PDF: arXiv abstract links read as their PDF; a web page is refused with a pointer to extract', async () => {
  const { pdfUrl, readPdf } = await load('src/routes/pdf.ts');
  assert.equal(pdfUrl('https://arxiv.org/abs/1706.03762'), 'https://arxiv.org/pdf/1706.03762');
  assert.equal(pdfUrl('https://arxiv.org/abs/2401.01234v2'), 'https://arxiv.org/pdf/2401.01234v2');
  assert.equal(pdfUrl('https://example.com/abs/x.pdf'), 'https://example.com/abs/x.pdf');
  await assert.rejects(readPdf(new TextEncoder().encode('<!DOCTYPE html><html><body>hi'), 1, 1, 1000), (e) => e.status === 415 && /extract/.test(e.message));
  await assert.rejects(readPdf(new TextEncoder().encode('PK\u0003\u0004zip'), 1, 1, 1000), (e) => e.status === 415 && !/extract/.test(e.message));
});

test('image type from the first bytes, whatever the server called it', async () => {
  const { sniffImage } = await load('src/routes/ai.ts');
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'image/png');
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a')), 'image/gif');
  assert.equal(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(new TextEncoder().encode('<html>')), null);
});

test('API health looks for the OpenAPI document beside the endpoint path, then at the usual root places', async () => {
  const { specCandidates } = await load('src/routes/agent-infra.ts');
  const c = specCandidates('https://petstore3.swagger.io/api/v3/pet/findByStatus?status=available');
  assert.equal(c[0], 'https://petstore3.swagger.io/api/v3/pet/openapi.json');
  assert.ok(c.includes('https://petstore3.swagger.io/api/v3/openapi.json'));
  assert.ok(c.includes('https://petstore3.swagger.io/openapi.json'));
  assert.ok(c.length <= 9 && new Set(c).size === c.length);
  assert.deepEqual(specCandidates('https://api.example.com/').slice(0, 2), ['https://api.example.com/openapi.json', 'https://api.example.com/swagger.json']);
});

test('company name from the page title when there is no og:site_name', async () => {
  const { nameFromTitle } = await load('src/routes/packs-intel.ts');
  assert.equal(nameFromTitle('Stripe | Financial Infrastructure to Grow Your Revenue', 'stripe.com'), 'Stripe');
  assert.equal(nameFromTitle('Home - Acme Widgets', 'acme-widgets.io'), 'Acme Widgets');
  assert.equal(nameFromTitle('Welcome to our site', 'example.com'), null);
  assert.equal(nameFromTitle(undefined, 'example.com'), null);
});

test('a site that blocks bots is named as such, not as a wrong URL', async () => {
  const { targetRefusal } = await load('src/lib/fetch.ts');
  assert.match(targetRefusal(403), /refused automated access \(HTTP 403\)/);
  assert.match(targetRefusal(401), /refused automated access/);
  assert.match(targetRefusal(404), /not found \(HTTP 404\); check the URL/);
  assert.match(targetRefusal(400), /check that the URL is public and correct/);
  for (const s of [400, 401, 403, 404, 410, 451]) assert.match(targetRefusal(s), /nothing was charged/);
});
