// A PDF sent as a file in a POST body (14 Nov 2026): automation tools and upload forms hold a file, not a public URL.
// The bytes wait in lib/file-input.ts and the forwarded GET carries "@file:<sha256>". No network: nothing is fetched.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['@cloudflare/puppeteer', 'cloudflare:workers'] });
  const m = { exports: {} };
  const req = (id) => (id === '@cloudflare/puppeteer' ? { default: {} } : id === 'cloudflare:workers' ? { DurableObject: class {} } : require(id));
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}

/** A one-page PDF with a text layer, with a correct cross-reference table. */
function tinyPdf(line = 'Invoice 2026-001 total 1250 SEK') {
  const stream = `BT /F1 18 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

let F;
before(async () => { F = await load('src/lib/file-input.ts'); });

test('a file waits under the hash of its bytes until every holder has let go', async () => {
  const bytes = new Uint8Array(tinyPdf());
  const ref = await F.holdFile(bytes);
  assert.match(ref, /^@file:[0-9a-f]{64}$/);
  assert.equal(await F.holdFile(bytes), ref, 'the same bytes give the same reference');
  assert.equal(F.heldFile(ref).byteLength, bytes.byteLength);
  assert.equal(F.heldFile('https://example.com/a.pdf'), null);
  assert.equal(F.heldFile(undefined), null);
  F.releaseFile(ref);
  assert.ok(F.heldFile(ref), 'still held by the second holder');
  F.releaseFile(ref);
  assert.equal(F.heldFile(ref), null);
  assert.equal(F.isFileRef(`@file:${'a'.repeat(64)}`), true);
  assert.equal(F.isFileRef('@file:constructor'), false);
});

test('the file is found however it was sent, and a body without one is left alone', async () => {
  const pdf = tinyPdf();
  const limit = 1024 * 1024;
  const post = (headers, body) => new Request('https://api.test/pdf/text', { method: 'POST', headers, body });
  const raw = await F.sentFile(post({ 'content-type': 'application/pdf' }, pdf), limit);
  assert.equal(raw.kind, 'file');
  assert.equal(raw.bytes.byteLength, pdf.length);
  const octet = await F.sentFile(post({ 'content-type': 'application/octet-stream' }, pdf), limit);
  assert.equal(octet.kind, 'file');
  const form = new FormData();
  form.set('file', new Blob([pdf], { type: 'application/pdf' }), 'invoice.pdf');
  form.set('pages', '1');
  const multi = await F.sentFile(new Request('https://api.test/pdf/text', { method: 'POST', body: form }), limit);
  assert.equal(multi.kind, 'file');
  assert.equal(multi.bytes.byteLength, pdf.length);
  assert.deepEqual(multi.fields, { pages: '1' });
  for (const body of [{ file: pdf.toString('base64') }, { data: `data:application/pdf;base64,${pdf.toString('base64')}` }, { content: pdf.toString('base64url') }]) {
    const json = await F.sentFile(post({ 'content-type': 'application/json' }, JSON.stringify(body)), limit);
    assert.equal(json.kind, 'file', Object.keys(body)[0]);
    assert.equal(Buffer.from(json.bytes).equals(pdf), true);
  }
  assert.equal((await F.sentFile(post({ 'content-type': 'application/json' }, JSON.stringify({ url: 'https://example.com/a.pdf' })), limit)).kind, 'none');
  assert.equal((await F.sentFile(post({ 'content-type': 'application/json' }, '{'), limit)).kind, 'none');
  assert.equal((await F.sentFile(post({ 'content-type': 'application/pdf' }, pdf), 100)).kind, 'too-large');
  assert.equal((await F.sentFile(post({ 'content-type': 'application/json' }, JSON.stringify({ file: pdf.toString('base64') })), 100)).kind, 'too-large');
});

test('the PDF tool reads a held file without fetching anything, and refuses a reference nobody holds', async () => {
  // One bundle, so the tool and this test share the module that holds the file.
  const b = await build({ stdin: { contents: `export * as P from './src/routes/pdf.ts'; export * as F from './src/lib/file-input.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['@cloudflare/puppeteer', 'cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const { P, F: held } = m.exports;
  const tool = P.PDF.find((e) => e.endpoint.path === '/pdf/text');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('the network must not be used for an uploaded file'); };
  try {
    const ref = await held.holdFile(new Uint8Array(tinyPdf()));
    const q = (input) => (name) => input[name];
    const answer = await tool.run({}, q({ '@file': ref }));
    assert.equal(answer.source, 'upload');
    assert.equal(answer.url, null);
    assert.equal(answer.totalPages, 1);
    assert.match(answer.pages[0].text, /Invoice 2026-001 total 1250 SEK/);
    held.releaseFile(ref);
    await assert.rejects(tool.run({}, q({ '@file': ref })), (e) => e.status === 400 && /POST body/.test(e.message));
    const notPdf = await held.holdFile(new TextEncoder().encode('<!doctype html><html><body>hello there</body></html>'));
    await assert.rejects(tool.run({}, q({ '@file': notPdf })), (e) => e.status === 415 && /nothing was charged/.test(e.message));
    held.releaseFile(notPdf);
  } finally { globalThis.fetch = realFetch; }
});

let mf;
after(async () => { await mf?.dispose(); });
test('through the Worker: an uploaded PDF is quoted under its hash when unpaid, and read when the paywall is off', async () => {
  const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent', external: ['cloudflare:workers', 'node:*'], alias: { 'ajv/dist/2020.js': require('node:path').resolve('src/lib/ajv-unavailable.ts') }, plugins: [{ name: 'fixture-facilitator', setup(p) {
    p.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
    p.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    p.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async()=>({isValid:false,invalidReason:'fixture'}), settle:async()=>({success:false,errorReason:'fixture'})
    }}` }));
  } }] });
  const worker = (paywall) => new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: paywall, TRIALS_ENABLED: 'on', MPP_EVM: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => new Response('not used', { status: 500 }) }));
  const pdf = tinyPdf();

  mf = worker('on');
  const quoteOf = async (res) => { const q = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString('utf8')); await res.text(); return q; };
  const unpaid = await mf.dispatchFetch('https://api.test/pdf/text?pages=1', { method: 'POST', headers: { 'content-type': 'application/pdf', accept: 'application/json' }, body: pdf });
  assert.equal(unpaid.status, 402);
  const quote = await quoteOf(unpaid);
  assert.match(quote.resource.url, /^https:\/\/api\.test\/pdf\/text\?pages=1&file=%40file%3A[0-9a-f]{64}$/);
  const again = await mf.dispatchFetch('https://api.test/pdf/text?pages=1', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ file: pdf.toString('base64') }) });
  assert.equal((await quoteOf(again)).resource.url, quote.resource.url, 'the same file sent another way names the same resource');
  // A JSON body with a url is the call it always was.
  const byUrl = await mf.dispatchFetch('https://api.test/pdf/text', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ url: 'https://example.com/a.pdf' }) });
  assert.equal(byUrl.status, 402);
  assert.match((await quoteOf(byUrl)).resource.url, /\/pdf\/text\?url=https%3A%2F%2Fexample\.com%2Fa\.pdf$/);
  await mf.dispose();

  mf = worker('off');
  const read = await mf.dispatchFetch('https://api.test/pdf/extract', { method: 'POST', headers: { 'content-type': 'application/octet-stream', accept: 'application/json' }, body: pdf });
  const text = await read.text();
  assert.equal(read.status, 200, text);
  const answer = JSON.parse(text);
  assert.equal(answer.source, 'upload');
  assert.match(answer.pages[0].text, /Invoice 2026-001/);
  // The multipart body is written out by hand: Miniflare's fetch does not take Node's own FormData.
  const boundary = 'x-test-boundary-7f3a';
  const multipart = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="maxChars"\r\n\r\n1000\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="invoice.pdf"\r\nContent-Type: application/pdf\r\n\r\n`, 'latin1'),
    pdf, Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1')]);
  const multi = await mf.dispatchFetch('https://api.test/pdf/text', { method: 'POST', headers: { accept: 'application/json', 'content-type': `multipart/form-data; boundary=${boundary}` }, body: multipart });
  const multiText = await multi.text();
  assert.equal(multi.status, 200, multiText);
  assert.match(JSON.parse(multiText).pages[0].text, /total 1250 SEK/);
  const html = await mf.dispatchFetch('https://api.test/pdf/text', { method: 'POST', headers: { 'content-type': 'application/pdf', accept: 'application/json' }, body: '<html>not a pdf, just a page of text</html>' });
  assert.equal(html.status, 415);
  await html.text();
});
