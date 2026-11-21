// src/lib/page-beacon.ts: every page for people carries the visit beacon, once, and nothing else is touched.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { build } = require('esbuild');

let cached;
async function load() {
  if (cached) return cached;
  const b = await build({ entryPoints: ['src/lib/page-beacon.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return (cached = m.exports);
}
const page = (body) => new Response(`<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '999', 'x-kept': 'yes' } });

test('an HTML page for people gets the script once, before </body>, and keeps its status and headers', async () => {
  const { beaconed, withBeacon, BEACON_MARK } = await load();
  const out = await beaconed(page('<h1>Hello</h1>'), '/speech-to-text-api');
  const html = await out.text();
  assert.equal(out.status, 200);
  assert.equal(out.headers.get('x-kept'), 'yes');
  assert.equal(out.headers.get('content-length'), null, 'the old length is dropped');
  assert.match(html, new RegExp(`<script ${BEACON_MARK}>[\\s\\S]+</script></body></html>$`));
  assert.equal(withBeacon(html), html, 'never added twice');
  assert.equal(html.split(BEACON_MARK).length, 2);
});

test('nothing is added to answers that are not pages for people', async () => {
  const { beaconed, BEACON_MARK } = await load();
  const same = async (res, path) => { const out = await beaconed(res, path); assert.equal(out, res, path); };
  await same(new Response('{"a":1}', { headers: { 'content-type': 'application/json' } }), '/weather');
  await same(new Response('<html><body>x</body></html>', { status: 404, headers: { 'content-type': 'text/html' } }), '/nope');
  await same(new Response('<html><body>x</body></html>', { status: 402, headers: { 'content-type': 'text/html' } }), '/weather');
  for (const path of ['/p/abc123', '/oauth/authorize', '/mcp/account', '/credits/claim', '/keys/free/confirm']) await same(page('x'), path);
  await same(new Response('<p>fragment without a body end</p>', { headers: { 'content-type': 'text/html' } }), '/x');
  await same(new Response('<html><body>x</body></html>', { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } }), '/x');
  const big = new Response('<html><body>x</body></html>', { headers: { 'content-type': 'text/html', 'content-length': '9000000' } });
  await same(big, '/x');
  assert.doesNotMatch(await (await beaconed(page('x'), '/p/abc')).text(), new RegExp(BEACON_MARK));
});

/** Runs the script in a tiny fake page and returns what it sent. */
async function run({ search = '', referrer = '', visibility = 'visible' } = {}) {
  const { BEACON_TAG } = await load();
  const code = /<script [^>]*>([\s\S]*)<\/script>/.exec(BEACON_TAG)[1];
  const sent = []; const listeners = {}; const timers = [];
  const sandbox = {
    document: { referrer, visibilityState: visibility, addEventListener: (type, fn) => { listeners[type] = fn; } },
    location: { search, pathname: '/speech-to-text-api' },
    navigator: { sendBeacon: (u) => { sent.push(u); return true; } },
    URLSearchParams, encodeURIComponent, setTimeout: (fn) => { timers.push(fn); }, Image: function () {},
  };
  vm.runInNewContext(code, sandbox);
  const el = (attrs) => ({ getAttribute: (n) => (n in attrs ? attrs[n] : null) });
  const click = (attrs) => listeners.click({ target: { closest: () => el(attrs) } });
  const submit = (action) => listeners.submit({ target: el({ action }) });
  return { sent, timers, click, submit, listeners };
}
const ev = (u) => new URL(u, 'https://x.test').searchParams;

test('the script sends one page view with the path, the referrer and a clean source tag, and nothing identifying', async () => {
  const { sent } = await run({ search: '?utm_source=newsletter&q=secret', referrer: 'https://www.google.com/search?q=private+words' });
  assert.equal(sent.length, 1);
  const q = ev(sent[0]);
  assert.deepEqual([q.get('ev'), q.get('p'), q.get('src')], ['page_view', '/speech-to-text-api', 'newsletter']);
  assert.equal(q.get('r'), 'https://www.google.com/search?q=private+words', 'the receiver keeps only its family');
  assert.equal(sent[0].startsWith('/e?'), true);
  assert.doesNotMatch(sent[0], /secret/, 'no other query value of the page is sent');
  const bad = await run({ search: '?src=Not%20A%20Tag!' });
  assert.equal(ev(bad.sent[0]).get('src'), null, 'a source tag of another shape is dropped');
});

test('clicks and form sends are named by where they lead, a data-ev name wins, and other links send nothing', async () => {
  const { sent, click, submit, timers } = await run();
  sent.length = 0;
  for (const [attrs, name] of [
    [{ href: 'https://buy.stripe.com/abc' }, 'checkout_click'], [{ href: '/transcribe-pro' }, 'pro_click'], [{ href: '/keys/free' }, 'free_key_click'],
    [{ href: '/credits' }, 'credits_click'], [{ href: '/credits?x=1' }, 'credits_click'], [{ href: '/app' }, 'install_app'], [{ href: '/docs' }, 'docs_click'], [{ href: '/tools/pdf-text' }, 'docs_click'],
    [{ 'data-ev': 'play', href: '/credits' }, 'play'],
  ]) { click(attrs); assert.equal(ev(sent.at(-1)).get('ev'), name, JSON.stringify(attrs)); }
  const before = sent.length;
  click({ href: 'https://example.com/' }); click({ href: '#pricing' }); click({ 'data-ev': 'Not Allowed!' });
  assert.equal(sent.length, before, 'nothing for an ordinary link or a name of another shape');
  submit('/keys/free'); assert.equal(ev(sent.at(-1)).get('ev'), 'free_key_submit');
  submit('/keys/voice-test'); assert.equal(ev(sent.at(-1)).get('ev'), 'voice_key_submit');
  const n = sent.length; submit('/search'); assert.equal(sent.length, n);
  timers[0](); assert.equal(ev(sent.at(-1)).get('ev'), 'engaged_15s');
  const hidden = await run({ visibility: 'hidden' }); hidden.sent.length = 0; hidden.timers[0](); assert.equal(hidden.sent.length, 0, 'a hidden tab is not engaged');
});

test('every event name the script sends by itself is one the receiver accepts', async () => {
  const { BEACON_EVENTS, BEACON_TAG } = await load();
  for (const name of BEACON_EVENTS) { assert.match(name, /^[a-z0-9_-]{1,40}$/); assert.ok(BEACON_TAG.includes(`"${name}"`), name); }
  assert.doesNotMatch(BEACON_TAG, /cookie|localStorage|sessionStorage|fingerprint/i);
});
