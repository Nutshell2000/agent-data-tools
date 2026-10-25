const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// Full OAuth sign-in against the real Worker in Miniflare: Stripe and web pages are mocked, nothing is paid.
let mf;
const O = 'https://api.test';
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', STRIPE_READ_KEY: 'rk_test_fixture' },
    outboundService: async (r) => {
      const u = new URL(r.url);
      if (u.hostname === 'api.stripe.com') return Response.json({ mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 500, metadata: { adt_credits: '5000' } });
      if (u.hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
      return new Response('<html><title>Fixture</title><main><h1>Result</h1><p>Static page for the sign-in test.</p></main></html>', { headers: { 'content-type': 'text/html' } });
    } }));
});
after(async () => { await mf?.dispose(); });

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkce = () => { const verifier = b64url(crypto.randomBytes(32)); return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) }; };
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function register() {
  const r = await mf.dispatchFetch(`${O}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) });
  assert.equal(r.status, 201);
  return (await r.json()).client_id;
}
async function signIn(clientId, fields, headers = {}) {
  const { verifier, challenge } = pkce();
  const q = { client_id: clientId, redirect_uri: REDIRECT, state: 'st4te', code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code' };
  const form = await mf.dispatchFetch(`${O}/oauth/authorize?${new URLSearchParams(q)}`);
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Sign in to Agent Data Tools/);
  const post = await mf.dispatchFetch(`${O}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ ...q, ...fields }) });
  return { post, verifier };
}
async function exchange(clientId, post, verifier) {
  assert.equal(post.status, 302);
  const loc = new URL(post.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, REDIRECT);
  assert.equal(loc.searchParams.get('state'), 'st4te');
  const code = loc.searchParams.get('code');
  const r = await mf.dispatchFetch(`${O}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }) });
  return { r, code };
}
async function mcpCall(token, name, args) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'oauth-fixture', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${O}/mcp/account`), { requestInit: { headers: { authorization: `Bearer ${token}` } }, fetch: (u, i) => mf.dispatchFetch(u, i) }));
    return await client.callTool({ name, arguments: args });
  } finally { await client.close(); }
}

test('discovery: /mcp/account answers 401 with resource metadata; metadata documents points at our endpoints', async () => {
  const r = await mf.dispatchFetch(`${O}/mcp/account`, { method: 'POST' });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /resource_metadata="https:\/\/api\.test\/\.well-known\/oauth-protected-resource\/mcp\/account"/);
  const pr = await (await mf.dispatchFetch(`${O}/.well-known/oauth-protected-resource/mcp/account`)).json();
  assert.equal(pr.resource, `${O}/mcp/account`);
  assert.deepEqual(pr.authorization_servers, [O]);
  const as = await (await mf.dispatchFetch(`${O}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.token_endpoint, `${O}/oauth/token`);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  // The open endpoint is unchanged.
  assert.notEqual((await mf.dispatchFetch(`${O}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })).status, 401);
});

test('sign in with a card-credit key: the token spends that key\'s credits over MCP', async () => {
  const key = (await (await mf.dispatchFetch(`${O}/credits/claim?session_id=cs_test_oauthSession001`, { headers: { accept: 'application/json' } })).json()).apiKey;
  const clientId = await register();
  const { post, verifier } = await signIn(clientId, { mode: 'key', key });
  const { r, code } = await exchange(clientId, post, verifier);
  assert.equal(r.status, 200);
  const tokens = await r.json();
  assert.match(tokens.access_token, /^adtok_/);
  const result = await mcpCall(tokens.access_token, 'extract', { url: 'https://public.example/article' });
  assert.notEqual(result.isError, true);
  const bal = await (await mf.dispatchFetch(`${O}/credits/balance`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.equal(bal.balanceCredits, 4998);
  // A code is single use.
  const again = await mf.dispatchFetch(`${O}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }) });
  assert.equal(again.status, 400);
  // Refresh rotates to a working token.
  const refreshed = await (await mf.dispatchFetch(`${O}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId }) })).json();
  assert.match(refreshed.access_token, /^adtok_/);
  assert.notEqual((await mf.dispatchFetch(`${O}/mcp/account`, { method: 'POST', headers: { authorization: `Bearer ${refreshed.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })).status, 401);
});

test('continue with free calls: a token without a key gets free calls counted per person', async () => {
  const clientId = await register();
  const { post, verifier } = await signIn(clientId, { mode: 'free' });
  const tokens = await (await exchange(clientId, post, verifier)).r.json();
  const result = await mcpCall(tokens.access_token, 'extract', { url: 'https://public.example/article' });
  assert.notEqual(result.isError, true);
  assert.match(result.content.at(-1).text, /^Free call \(24 of 25/);
});

test('rejects wrong PKCE verifiers, unknown keys, unregistered redirects and bad tokens', async () => {
  const clientId = await register();
  const { post } = await signIn(clientId, { mode: 'free' });
  const bad = await exchange(clientId, post, 'x'.repeat(43));
  assert.equal(bad.r.status, 400);
  const unknown = await signIn(clientId, { mode: 'key', key: 'adt_' + 'q'.repeat(43) });
  assert.equal(unknown.post.status, 400);
  assert.match(await unknown.post.text(), /key was not found/);
  const evil = await mf.dispatchFetch(`${O}/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: 'https://evil.example/cb', state: 's', code_challenge: 'c', code_challenge_method: 'S256', response_type: 'code' })}`);
  assert.equal(evil.status, 400);
  const reg = await mf.dispatchFetch(`${O}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) });
  assert.equal(reg.status, 400);
  assert.equal((await mf.dispatchFetch(`${O}/mcp/account`, { method: 'POST', headers: { authorization: 'Bearer adtok_' + 'z'.repeat(43) } })).status, 401);
});

test('signed-in without a key: no crypto payment request, a neutral message once free calls are not available', async () => {
  const clientId = await register();
  const { post, verifier } = await signIn(clientId, { mode: 'free' });
  const tokens = await (await exchange(clientId, post, verifier)).r.json();
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'oauth-fixture', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${O}/mcp/account`), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } }, fetch: (u, i) => mf.dispatchFetch(u, i) }));
    assert.doesNotMatch(client.getInstructions(), /x402|USDC|payment request/);
    const ai = await client.callTool({ name: 'search', arguments: { q: 'x402' } }); // paid search stays outside the free calls (AI text joined them 25 Oct 2026; /image is not on /mcp/account)
    assert.equal(ai.isError, true);
    const text = ai.content.map((c) => c.text).join(' ');
    assert.match(text, /not included in the free calls/);
    assert.doesNotMatch(text, /x402Version|accepts|USDC/);
  } finally { await client.close(); }
});
test('signing in again without a key does not refill the free calls', async () => {
  const freeCall = async (ip) => {
    const clientId = await register();
    const { post, verifier } = await signIn(clientId, { mode: 'free' }, { 'cf-connecting-ip': ip });
    const tokens = await (await exchange(clientId, post, verifier)).r.json();
    const result = await mcpCall(tokens.access_token, 'extract', { url: 'https://public.example/article' });
    return result.content.at(-1).text;
  };
  assert.match(await freeCall('203.0.113.7'), /^Free call \(24 of 25/);
  assert.match(await freeCall('203.0.113.7'), /^Free call \(23 of 25/, 'a second sign-in from the same place continues the same allowance');
  assert.match(await freeCall('198.51.100.9'), /^Free call \(24 of 25/, 'another person gets their own allowance');
});
