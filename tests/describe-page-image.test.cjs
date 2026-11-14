const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const { build } = require('esbuild');

// /describe given a web page reads the page's own preview image (og:image); fetch and the model are fakes, no network.
async function load() {
  const b = await build({ entryPoints: ['src/routes/ai.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
afterEach(() => { globalThis.fetch = realFetch; if (realCaches) globalThis.caches = realCaches; else delete globalThis.caches; });
let calls;
function route(fn) {
  calls = [];
  delete globalThis.caches;
  globalThis.fetch = async (url) => { calls.push(String(url)); return fn(String(url)); };
}
const PNG = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), { status: 200, headers: { 'content-type': 'image/png' } });
const page = (head) => new Response(`<!doctype html><html><head><title>A post</title>${head}</head><body><p>Hello</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const env = { AI: { run: async () => ({ response: 'Two dice on a table.' }) }, AI_DAILY_CAP: '0' };

test('an image URL is described as before, with the four fields only', async () => {
  const { describeImage } = await load();
  route(() => PNG());
  const out = await describeImage(env, 'https://img.example/a.png');
  assert.deepEqual(Object.keys(out), ['url', 'question', 'description', 'model']);
  assert.equal(out.url, 'https://img.example/a.png');
  assert.equal(calls.length, 1);
});

test('a web page is read through its og:image and the answer names the image', async () => {
  const { describeImage } = await load();
  route((u) => u.includes('/post') ? page('<meta property="og:image" content="/media/cover.png">') : PNG());
  const out = await describeImage(env, 'https://site.example/post/1', 'What is shown?');
  assert.equal(out.url, 'https://site.example/post/1');
  assert.equal(out.imageUrl, 'https://site.example/media/cover.png');
  assert.match(out.note, /preview image/);
  assert.equal(out.description, 'Two dice on a table.');
  assert.deepEqual(calls, ['https://site.example/post/1', 'https://site.example/media/cover.png']);
});

test('twitter:image is used when there is no og:image', async () => {
  const { pagePreviewImage } = await load();
  const html = new TextEncoder().encode('<html><head><meta name="twitter:image" content="https://cdn.example/c.jpg"></head></html>');
  assert.equal(pagePreviewImage(html, 'https://site.example/'), 'https://cdn.example/c.jpg');
});

test('a page without og:image is read through the first content image it shows', async () => {
  const { describeImage } = await load();
  const body = '<!doctype html><html><head><title>Shop</title></head><body><img src="/logo.png"><img src="data:image/gif;base64,R0l"><img src="/px.gif" width="1" height="1"><img src="/i/icon.svg"><img src="/products/dice.jpg" alt="Dice"></body></html>';
  route((u) => u.includes('/item') ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }) : PNG());
  const out = await describeImage(env, 'https://shop.example/item/7');
  assert.equal(out.imageUrl, 'https://shop.example/products/dice.jpg');
  assert.match(out.note, /first content image/);
  assert.deepEqual(calls, ['https://shop.example/item/7', 'https://shop.example/products/dice.jpg']);
});

test('og:image still wins over page images', async () => {
  const { pagePreviewImage, pageMainImage } = await load();
  const html = new TextEncoder().encode('<html><head><meta property="og:image" content="https://cdn.example/og.png"></head><body><img src="/a.jpg"></body></html>');
  assert.equal(pagePreviewImage(html, 'https://site.example/'), 'https://cdn.example/og.png');
  assert.equal(pageMainImage(html, 'https://site.example/'), 'https://site.example/a.jpg');
  assert.equal(pageMainImage(new TextEncoder().encode('<html><body><img src="/logo.png"></body></html>'), 'https://site.example/'), null);
});

test('a page without a preview image is refused 415 and nothing else is fetched', async () => {
  const { describeImage } = await load();
  route(() => page(''));
  await assert.rejects(describeImage(env, 'https://site.example/post/2'), (e) => e.status === 415 && /preview image/.test(e.message));
  assert.equal(calls.length, 1);
});

test('a preview image that points at a private address is never requested', async () => {
  const { describeImage } = await load();
  route((u) => u.includes('site.example') ? page('<meta property="og:image" content="http://127.0.0.1/secret.png">') : PNG());
  await assert.rejects(describeImage(env, 'https://site.example/post/3'));
  assert.equal(calls.length, 1);
});

test('bytes that are neither an image nor a page are refused 415', async () => {
  const { describeImage, pagePreviewImage } = await load();
  assert.equal(pagePreviewImage(new TextEncoder().encode('just some text'), 'https://x.example/'), null);
  route(() => new Response('plain words', { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
  await assert.rejects(describeImage(env, 'https://site.example/file.bin'), (e) => e.status === 415);
});
