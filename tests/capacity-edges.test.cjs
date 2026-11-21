// Quality round two, 21 Nov 2026, against the real Worker in Miniflare (the facilitator is a fixture, nothing is paid):
// a POST body is read through a counter before the paywall, the payee page escapes the name it prints, and client
// registration still works for the apps that register by themselves.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, test } = require('node:test');
const { readFileSync } = require('node:fs');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

let mf;
const O = 'https://api.test';
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async (r) => {
      const u = new URL(r.url);
      if (u.hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
      return new Response('not found', { status: 404 });
    } }));
});
after(async () => { await mf?.dispose(); });

const post = (path, body, headers = { 'content-type': 'application/json' }) => mf.dispatchFetch(`${O}${path}`, { method: 'POST', headers, body });
const MB = 1024 * 1024;

test('an unpaid GET and an ordinary POST of a tool still answer the same 402', async () => {
  const get = await mf.dispatchFetch(`${O}/time?zone=Europe/Stockholm`);
  assert.equal(get.status, 402);
  assert.ok(get.headers.get('payment-required'));
  await get.arrayBuffer();
  const sent = await post('/time', JSON.stringify({ zone: 'Europe/Stockholm' }));
  assert.equal(sent.status, 402);
  assert.ok(sent.headers.get('payment-required'));
  const quoted = JSON.parse(Buffer.from(sent.headers.get('payment-required'), 'base64').toString());
  assert.match(quoted.resource.url, /\/time\?zone=Europe%2FStockholm$/, 'the POST fields still become the quoted URL');
  await sent.arrayBuffer();
  const empty = await post('/time', '');
  assert.equal(empty.status, 402, 'an empty body gets the quote, as before');
  await empty.arrayBuffer();
  const broken = await post('/time', '{not json');
  assert.equal(broken.status, 402, 'an unreadable body gets the quote, as before');
  await broken.arrayBuffer();
});

// The POST body limit is the one 1.329.0 shipped (2 MB, counted read; its own tests). This file keeps the paywall,
// payee page and app-registration edges of the capacity work.

test('the payee page prints the name escaped and still answers as before', async () => {
  const page = await mf.dispatchFetch(`${O}/payee/shop.example.com`, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' } });
  assert.equal(page.status, 404);
  const html = await page.text();
  assert.match(html, /<title>No payee record for shop\.example\.com<\/title>/);
  assert.match(html, /<h1>No record for shop\.example\.com yet<\/h1>/);
  assert.match(html, /\/payee\/claim\?domain=shop\.example\.com"/);
  const json = await mf.dispatchFetch(`${O}/payee/shop.example.com`, { headers: { accept: 'application/json' } });
  assert.equal(json.status, 404);
  assert.equal((await json.json()).error, 'no payee record for shop.example.com');
  for (const bad of ['%3Cb%3Ex.example.com', 'x.example.com%22%3E%3Cscript%3E']) {
    const res = await mf.dispatchFetch(`${O}/payee/${bad}`, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 Chrome/130' } });
    assert.doesNotMatch(await res.text(), /<b>|<script>x|"><script>/i, 'markup in the name never reaches the page');
  }
  // In the source: the page line prints only the escaped name.
  const line = readFileSync('src/index.ts', 'utf8').split('\n').find((l) => l.includes('<title>No payee record for'));
  assert.ok(line, 'the page line exists');
  assert.doesNotMatch(line.split(': c.json(')[0], /\$\{domain\}/);
  assert.match(line, /\$\{shown\}/);
});

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
test('an app that registers by itself can still sign in, with or without a known address, many times over', async () => {
  for (const [name, redirect, headers] of [['Claude', 'https://claude.ai/api/mcp/auth_callback', { 'cf-connecting-ip': '203.0.113.9' }], ['ChatGPT', 'https://chatgpt.com/connector_platform_oauth_redirect', {}], ['Desktop', 'http://localhost:33418/callback', { 'cf-connecting-ip': '2001:db8:1:2::7' }]]) {
    let clientId;
    // Directories register a new client on every connection: forty in a row from one address must all pass.
    for (let i = 0; i < 40; i++) {
      const reg = await mf.dispatchFetch(`${O}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ client_name: name, redirect_uris: [redirect] }) });
      assert.equal(reg.status, 201, `${name} registration ${i + 1}`);
      const made = await reg.json();
      assert.match(made.client_id, /^adtc_/);
      assert.deepEqual(made.redirect_uris, [redirect]);
      clientId = made.client_id;
    }
    const verifier = b64url(crypto.randomBytes(32));
    const q = { client_id: clientId, redirect_uri: redirect, state: 's', code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', response_type: 'code' };
    const form = await mf.dispatchFetch(`${O}/oauth/authorize?${new URLSearchParams(q)}`);
    assert.equal(form.status, 200, `${name}: the sign-in page knows the new client`);
    await form.text();
    const sent = await mf.dispatchFetch(`${O}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ ...q, mode: 'free' }) });
    assert.equal(sent.status, 302);
    const code = new URL(sent.headers.get('location')).searchParams.get('code');
    const token = await mf.dispatchFetch(`${O}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect }) });
    assert.equal(token.status, 200, `${name}: tokens are issued`);
    const issued = await token.json();
    assert.match(issued.access_token, /^adtok_/);
    // The same client signs in again later (it was used, so it is kept).
    const again = await mf.dispatchFetch(`${O}/oauth/authorize?${new URLSearchParams(q)}`);
    assert.equal(again.status, 200);
    await again.text();
    const refreshed = await mf.dispatchFetch(`${O}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: clientId }) });
    assert.equal(refreshed.status, 200);
    await refreshed.arrayBuffer();
  }
  const unknown = await mf.dispatchFetch(`${O}/oauth/authorize?${new URLSearchParams({ client_id: 'adtc_doesnotexist000', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', state: 's', code_challenge: 'x', code_challenge_method: 'S256', response_type: 'code' })}`);
  assert.equal(unknown.status, 400);
  assert.match(await unknown.text(), /unknown client_id; the app must register first/);
});
