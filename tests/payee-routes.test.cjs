// Payee record routes through the real Worker (Miniflare): the free claim, the record page and registry, our own
// declaration, the key document, and the paid check staying behind the paywall. The only outside site answering is a
// fake shop that serves a declaration; every other request fails, as registers would when unreachable.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

const SHOP = 'shop.example.com';
const DECLARATION = { version: 1, payTo: [{ address: '0x1111111111111111111111111111111111111111', network: 'base' }] };

let mf;
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, kvNamespaces: ['TRIALS'],
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', PAYEE_SIGNING_KEY: JSON.stringify(jwk) },
    outboundService: async (req) => {
      const url = new URL(req.url);
      if (url.hostname === SHOP && url.pathname === '/.well-known/agent-payee.json') return Response.json(DECLARATION);
      if (url.hostname === SHOP) return new Response('not found', { status: 404 });
      return new Response('no network in this test', { status: 500 });
    },
  }));
});
after(async () => { await mf?.dispose(); });
const get = (path, accept = 'application/json') => mf.dispatchFetch('https://api.test' + path, { headers: { accept, ...(accept.includes('html') ? { 'user-agent': 'Mozilla/5.0 Chrome/130' } : {}) } });

test('our own declaration and the public key document are served', async () => {
  const own = await (await get('/.well-known/agent-payee.json')).json();
  assert.equal(own.company, null);
  assert.ok(own.payTo.some((w) => w.address.toLowerCase() === '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5'));
  const keys = await (await get('/.well-known/agent-payee-keys.json')).json();
  assert.equal(keys.keys.length, 1);
  assert.equal(keys.keys[0].crv, 'Ed25519');
  assert.equal(keys.keys[0].d, undefined, 'the private part is never published');
});

test('a claim checks the domain, stores the record and signs it; the page and registry show it', async () => {
  const res = await get(`/payee/claim?domain=https://${SHOP}/anything`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.has('PAYMENT-REQUIRED'), false, 'claiming is free');
  const body = await res.json();
  assert.equal(body.record.domain, SHOP);
  assert.equal(body.record.status, 'partial');
  assert.equal(body.record.checks.domain, 'proven');
  assert.equal(body.record.checks.company, 'not-declared');
  assert.match(body.attestation.signature, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal(body.cached, false);

  const again = await (await get(`/payee/claim?domain=${SHOP}`)).json();
  assert.equal(again.cached, true, 'a second claim within the cooldown returns the stored record');

  const record = await get(`/payee/${SHOP}`);
  assert.equal(record.status, 200);
  assert.equal((await record.json()).record.status, 'partial');
  const page = await (await get(`/payee/${SHOP}`, 'text/html')).text();
  assert.ok(page.includes('<h1>shop.example.com</h1>') && page.includes('partial'));

  const reg = await (await get('/payee/registry')).json();
  assert.ok(reg.records.some((r) => r.domain === SHOP && r.status === 'partial'));
});

test('a domain without a declaration is not stored', async () => {
  const body = await (await get('/payee/claim?domain=nothing.example.org')).json();
  assert.equal(body.record.status, 'none');
  assert.equal(body.attestation, null);
  assert.equal((await get('/payee/nothing.example.org')).status, 404);
});

test('bad domains are refused; the landing page explains the file; the paid check stays behind the paywall', async () => {
  assert.equal((await get('/payee/claim?domain=127.0.0.1')).status, 400);
  const landing = await (await get('/payee', 'text/html')).text();
  assert.ok(landing.includes('/.well-known/agent-payee.json') && landing.includes('agent-payee:&lt;your domain&gt;'));
  const paid = await get(`/payee/check?domain=${SHOP}`);
  // 402 with a reachable facilitator; this test has none, so the paywall answers 503. Either way it is never served free.
  assert.ok([402, 503].includes(paid.status), String(paid.status));
  assert.equal((await paid.json()).record, undefined);
  const lookup = await mf.dispatchFetch('https://api.test/payee/lookup?domain=Shop.Example.com', { redirect: 'manual' });
  assert.equal(lookup.status, 303);
  assert.equal(lookup.headers.get('location'), `/payee/${SHOP}`);
});
