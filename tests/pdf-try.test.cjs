const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// The capped free PDF try (src/lib/pdf-try.ts): off by default, and when the owner switches it on a browser gets at most
// two pages of its own PDF, inside its three free HTTP calls and a total per day. Two Workers: switch unset, switch on.
const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
function makePdf(pageTexts) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const kids = pageTexts.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const [i, t] of pageTexts.entries()) {
    const stream = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objs.push('<< /Title (Try doc) >>');
  let out = '%PDF-1.4\n';
  const offsets = objs.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
const PDF = makePdf(['Page one text', 'Page two text', 'Page three text', 'Page four text']);

let off, on, capped;
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'fixture-facilitator', setup(b) {
    b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
    b.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export function buildFacilitator(){return {
      getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453',extra:{name:'USD Coin',version:'2',asset:'${asset}',assetTransferMethod:'eip3009'}}],extensions:[]}),
      verify:async()=>({isValid:false,invalidReason:'fixture'}), settle:async()=>({success:false,errorReason:'fixture'})
    }}` }));
  } }] });
  const worker = (extra) => new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', MPP_EVM: 'off', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', ...extra },
    outboundService: async (req) => (new URL(req.url).pathname.endsWith('.pdf') ? new Response(PDF, { headers: { 'content-type': 'application/pdf' } }) : new Response('not used', { status: 500 })) }));
  off = worker({});
  on = worker({ PDF_TRY: 'on' });
  capped = worker({ PDF_TRY: 'on', PDF_TRY_DAILY_CAP: '1' });
});
after(async () => { await Promise.all([off, on, capped].map((m) => m?.dispose())); });

const browser = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const url = 'https://api.test/pdf/text?url=https%3A%2F%2Fdocs.example%2Fa.pdf&pages=50&maxChars=200000&trial=1';

test('switch unset: PDF reading stays paid for a browser, and its page offers no free run', async () => {
  const res = await off.dispatchFetch(url, { headers: { ...browser, 'cf-connecting-ip': '198.51.100.20' } });
  assert.equal(res.status, 402);
  const page = await (await off.dispatchFetch('https://api.test/tools/pdf-text', { headers: browser })).text();
  assert.doesNotMatch(page, /Run it free/);
});

test('switch on: a browser reads two pages of its own PDF, told that it is a capped try', async () => {
  const res = await on.dispatchFetch(url, { headers: { ...browser, 'cf-connecting-ip': '198.51.100.21' } });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Page one text/);
  assert.match(html, /Page two text/);
  assert.doesNotMatch(html, /Page three text/, 'pages=50 was asked; the try reads two');
  assert.match(html, /at most 2 pages/);
  const page = await (await on.dispatchFetch('https://api.test/tools/pdf-text', { headers: browser })).text();
  assert.match(page, /Try it free on your PDF \(first 2 pages\)/);
  assert.doesNotMatch(page, /Or one of your 3 free calls/, 'the try is for browsers, so no curl line');
});

test('switch on: code without a browser still gets the payment request', async () => {
  const res = await on.dispatchFetch(url, { headers: { accept: 'application/json', 'user-agent': 'python-requests/2.32', 'cf-connecting-ip': '198.51.100.22' } });
  assert.equal(res.status, 402);
});

test('switch on: the fourth try of one visitor and the try after the day total both get the payment request', async () => {
  const ip = { ...browser, 'cf-connecting-ip': '198.51.100.23' };
  for (let i = 0; i < 3; i++) assert.equal((await on.dispatchFetch(url, { headers: ip })).status, 200, `try ${i + 1}`);
  assert.equal((await on.dispatchFetch(url, { headers: ip })).status, 402);
  assert.equal((await capped.dispatchFetch(url, { headers: { ...browser, 'cf-connecting-ip': '198.51.100.24' } })).status, 200);
  assert.equal((await capped.dispatchFetch(url, { headers: { ...browser, 'cf-connecting-ip': '198.51.100.25' } })).status, 402);
});

test('a visitor who is out of tries does not use up the day total for others', async () => {
  const worker = capped; // day total 1, already used by the test above
  assert.ok(worker);
  const fresh = await on.dispatchFetch(url, { headers: { ...browser, 'cf-connecting-ip': '198.51.100.30' } });
  assert.equal(fresh.status, 200);
  const spent = { ...browser, 'cf-connecting-ip': '198.51.100.23' }; // this visitor used all three tries above
  for (let i = 0; i < 5; i++) assert.equal((await on.dispatchFetch(url, { headers: spent })).status, 402);
  const kv = await on.getKVNamespace('TRIALS');
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(Number(await kv.get('cap:pdftry:' + day)), 5, 'five real tries so far in this Worker; the five refused ones were not counted');
});
test('a paid-path call can never be capped by sending the reserved input itself', async () => {
  const res = await off.dispatchFetch('https://api.test/pdf/text?url=https%3A%2F%2Fdocs.example%2Fa.pdf&%40pdf-try=1', { headers: { accept: 'application/json' } });
  assert.equal(res.status, 402, 'unpaid stays unpaid; the reserved name is not read from the query');
});
