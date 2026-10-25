const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// The ChatGPT plugin server /mcp/chatgpt (1.77.0): the signed-in tools without prices, payment methods, checkout links or
// request ids, as ChatGPT's plugin rules require; plus its OAuth resource metadata and the domain-verification token.
let mf;
const O = 'https://api.test';
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', STRIPE_READ_KEY: 'rk_test_fixture', OPENAI_APPS_CHALLENGE: 'challenge-token-123' },
    outboundService: async (r) => {
      const u = new URL(r.url);
      if (u.hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
      return new Response('<html><title>Fixture</title><main><h1>Result</h1><p>Static page for the ChatGPT server test, long enough to read.</p></main></html>', { headers: { 'content-type': 'text/html' } });
    } }));
});
after(async () => { await mf?.dispose(); });

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';

async function freeToken() {
  const reg = await mf.dispatchFetch(`${O}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [REDIRECT] }) });
  assert.equal(reg.status, 201);
  const clientId = (await reg.json()).client_id;
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const q = { client_id: clientId, redirect_uri: REDIRECT, state: 's', code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code' };
  const post = await mf.dispatchFetch(`${O}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.77' }, body: new URLSearchParams({ ...q, mode: 'free' }) });
  assert.equal(post.status, 302);
  const code = new URL(post.headers.get('location')).searchParams.get('code');
  const tok = await mf.dispatchFetch(`${O}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }) });
  assert.equal(tok.status, 200);
  return (await tok.json()).access_token;
}

async function withClient(token, fn) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'openai-mcp', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${O}/mcp/chatgpt`), { requestInit: { headers: { authorization: `Bearer ${token}` } }, fetch: (u, i) => mf.dispatchFetch(u, i) }));
    return await fn(client);
  } finally { await client.close(); }
}

test('/mcp/chatgpt asks for sign-in with its own resource metadata; the domain token is served as plain text', async () => {
  const r = await mf.dispatchFetch(`${O}/mcp/chatgpt`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /oauth-protected-resource\/mcp\/chatgpt"/);
  const meta = await (await mf.dispatchFetch(`${O}/.well-known/oauth-protected-resource/mcp/chatgpt`)).json();
  assert.equal(meta.resource, `${O}/mcp/chatgpt`);
  assert.deepEqual(meta.authorization_servers, [O]);
  const ch = await mf.dispatchFetch(`${O}/.well-known/openai-apps-challenge`);
  assert.equal(ch.status, 200);
  assert.equal(await ch.text(), 'challenge-token-123');
});

test('/mcp/chatgpt lists the signed-in tools with no prices, payment methods or links, and honest annotations', async () => {
  const token = await freeToken();
  await withClient(token, async (client) => {
    const { tools } = await client.listTools();
    assert.ok(tools.length > 100);
    assert.ok(!tools.some((t) => t.name === 'image' || t.name === 'ai_speech'), 'no generative media tools');
    for (const t of tools) {
      assert.doesNotMatch(t.description, /\$\d|\/credits|buy\.stripe|via x402|card key/i, t.name);
      for (const k of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) assert.equal(typeof t.annotations[k], 'boolean', `${t.name} ${k}`);
    }
    assert.equal(tools.find((t) => t.name === 'memory_set').annotations.readOnlyHint, false);
    assert.equal(tools.find((t) => t.name === 'memory_delete').annotations.destructiveHint, true);
    const instructions = client.getInstructions();
    assert.doesNotMatch(instructions, /\$\d|x402|USDC|\/credits|https?:\/\//);
    assert.doesNotMatch(instructions, /ai_speech|→ image\b|\/mcp\//);
  });
});

test('/mcp/chatgpt free calls answer without links or request ids; tools outside the free calls say so plainly', async () => {
  const token = await freeToken();
  await withClient(token, async (client) => {
    const ok = await client.callTool({ name: 'time', arguments: { zone: 'UTC' } });
    assert.ok(!ok.isError, JSON.stringify(ok).slice(0, 300));
    const note = ok.content.map((c) => c.text).join(' ');
    assert.match(note, /free calls left for this account/);
    assert.doesNotMatch(note, /\/credits|x402|https?:\/\//);
    assert.equal(ok._meta?.requestId, undefined);
    const capped = await client.callTool({ name: 'search', arguments: { q: 'x402' } });
    assert.equal(capped.isError, true);
    const text = capped.content.map((c) => c.text).join(' ');
    assert.match(text, /not available on the current plan/);
    assert.doesNotMatch(text, /\/credits|https?:\/\/|\$\d/);
  });
});
