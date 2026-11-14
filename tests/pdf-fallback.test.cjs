const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { build } = require('esbuild');

// /pdf/text reads the Internet Archive's copy when the site refuses us; fetch is replaced by a fake, no network.
async function load() {
  const b = await build({ entryPoints: ['src/routes/pdf.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['unpdf'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
let calls;
function route(fn) {
  calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return fn(String(url)); };
}
const PDF = () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), { status: 200, headers: { 'content-type': 'application/pdf' } });
const archive302 = () => new Response(null, { status: 302, headers: { location: 'https://web.archive.org/web/20261106144110id_/https://site.example/a.pdf' } });
beforeEach(() => { delete globalThis.caches; });
afterEach(() => { globalThis.fetch = realFetch; if (realCaches) globalThis.caches = realCaches; else delete globalThis.caches; });

test('a readable PDF comes from the origin and the archive is never asked', async () => {
  const { loadPdf } = await load();
  route(() => PDF());
  const f = await loadPdf('https://site.example/a.pdf');
  assert.equal(f.source, 'origin');
  assert.equal(calls.length, 1);
});

test('a 403 from the site falls back to the dated archive copy', async () => {
  const { loadPdf } = await load();
  route((u) => u.startsWith('https://web.archive.org/web/2id_/') ? archive302() : u.includes('20261106144110id_') ? PDF() : new Response('no', { status: 403 }));
  const f = await loadPdf('https://site.example/a.pdf');
  assert.equal(f.source, 'internet-archive');
  assert.equal(f.snapshot, '2026-11-06');
  assert.equal(f.url, 'https://site.example/a.pdf');
});

test('a bot-check page served as 200 also falls back', async () => {
  const { loadPdf } = await load();
  route((u) => u.includes('web.archive.org/web/2id_') ? archive302() : u.includes('20261106144110id_') ? PDF() : new Response('<!doctype html><title>Just a moment</title>', { status: 200, headers: { 'content-type': 'text/html' } }));
  assert.equal((await loadPdf('https://site.example/a.pdf')).source, 'internet-archive');
});

test('no archived copy: the site\'s own refusal is the error', async () => {
  const { loadPdf } = await load();
  route(() => new Response('no', { status: 403 }));
  await assert.rejects(loadPdf('https://site.example/a.pdf'), (e) => e.status === 422 && /refused automated access/.test(e.message));
});

// Changed 14 Nov 2026: a down or bot-walled (503 challenge) site now reads the archive too, like /extract; 124 of 571
// refused /pdf/text calls in 7 days were this class, and paid calls ended in execution_failed.
test('a target that is down (5xx) reads the archive copy', async () => {
  const { loadPdf } = await load();
  route((u) => u.includes('web.archive.org/web/2id_') ? archive302() : u.includes('20261106144110id_') ? PDF() : new Response('boom', { status: 503 }));
  const f = await loadPdf('https://site.example/a.pdf');
  assert.equal(f.source, 'internet-archive');
  assert.equal(f.snapshot, '2026-11-06');
});

test('down with no archived copy: the site\'s own 502 is the error', async () => {
  const { loadPdf } = await load();
  route(() => new Response('boom', { status: 500 }));
  await assert.rejects(loadPdf('https://site.example/a.pdf'), (e) => e.status === 502 && /HTTP 500/.test(e.message));
  assert.ok(calls.some((u) => u.includes('archive.org')));
});

test('a malformed URL is refused before any fetch', async () => {
  const { loadPdf } = await load();
  route(() => PDF());
  await assert.rejects(loadPdf('not a url'), (e) => e.status === 400);
  assert.equal(calls.length, 0);
});
