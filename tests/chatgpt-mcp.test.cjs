const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// The ChatGPT plugin server /mcp/chatgpt. Since 1.111.5 it is free inside ChatGPT: OpenAI rejected the first submission
// (5 Nov 2026) for commerce, annotations and restricted data, and its rules allow no sale of digital services and no
// freemium upsell. So: a fixed list of allowed tools (src/lib/chatgpt-tools.ts), a daily allowance per signed-in user,
// and no price, plan, credit, key, link or request id anywhere ChatGPT can see. Plus its OAuth resource metadata and the
// domain-verification token.
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

async function freeToken(redirect = REDIRECT) {
  const reg = await mf.dispatchFetch(`${O}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [redirect] }) });
  assert.equal(reg.status, 201);
  const clientId = (await reg.json()).client_id;
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const q = { client_id: clientId, redirect_uri: redirect, state: 's', code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code' };
  const post = await mf.dispatchFetch(`${O}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.77' }, body: new URLSearchParams({ ...q, mode: 'free' }) });
  assert.equal(post.status, 302);
  const code = new URL(post.headers.get('location')).searchParams.get('code');
  const tok = await mf.dispatchFetch(`${O}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect }) });
  assert.equal(tok.status, 200);
  return (await tok.json()).access_token;
}

async function withClient(token, fn, path = '/mcp/chatgpt') {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'openai-mcp', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${O}${path}`), { requestInit: { headers: { authorization: `Bearer ${token}` } }, fetch: (u, i) => mf.dispatchFetch(u, i) }));
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

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
// Words that would read as selling or upselling inside ChatGPT (OpenAI plugin guidelines, commerce).
// "USDC" alone is a token's ticker (price_token, wallet_balances), not a way to pay us.
const COMMERCE = /\$\d|\/credits|buy\.stripe|x402|\bMPP\b|card key|credit|free call|free trial|(paid|pricing|free|your) plan|upgrade (to|your)|subscri|pric(e|ing) (is|of \$)|pay per|charged|paid call|not free/i;
// Wording that would read as preparing a payment or a trade, which this server does not do.
const DEALING = /before (a |an |you )?(swap|trade|trading|transfer|payment|paying|pay|bridge|sending|approving|buying|investing)|payable|payment request|can pay|Lightning payment|a payment or|or paying/i;

test('the ChatGPT tool list keeps every rule it was chosen by', async () => {
  const { CHATGPT_TOOLS, CHATGPT_CALLS_PER_DAY, CHATGPT_CALLS_TOTAL_PER_DAY } = await load('src/lib/chatgpt-tools.ts');
  const { ENDPOINTS, CAPACITY_LIMITED } = await load('src/discovery.ts');
  const { ENTRY_OF } = await load('src/routes/entry-paths.ts');
  const { annotationsFor } = await load('src/mcp-contract.ts');
  const byPath = new Map(ENDPOINTS.map((e) => [e.path, e]));
  assert.ok(CHATGPT_TOOLS.size >= 60 && CHATGPT_TOOLS.size <= 100, `a focused list, not the catalog: ${CHATGPT_TOOLS.size}`);
  assert.ok(CHATGPT_CALLS_PER_DAY > 0 && CHATGPT_CALLS_TOTAL_PER_DAY >= CHATGPT_CALLS_PER_DAY);
  for (const path of CHATGPT_TOOLS) {
    const e = byPath.get(path);
    assert.ok(e, `${path} is a live tool`);
    assert.ok(!CAPACITY_LIMITED.has(path), `${path} costs us per call (AI, browser or search): not for a free server`);
    assert.ok(!Object.hasOwn(ENTRY_OF, path), `${path} is an entry path: each tool appears once`);
    const a = annotationsFor(path);
    assert.deepEqual([a.readOnlyHint, a.destructiveHint], [true, false], `${path} must only read`);
    // Restricted or sensitive data must not be asked for: no input is named for a card, a credential, a health value,
    // an e-mail, a phone or a bank account.
    // (`token` on the token-balance reads is an ERC-20 contract address or ticker, not a credential.)
    for (const input of Object.keys(e.params)) assert.doesNotMatch(input, /card|password|passwd|secret|(access|auth|api|id|bearer|session)[_-]?token|^key$|apikey|ssn|email|phone|iban|bic|weight|height|birth|health/i, `${path} input ${input}`);
  }
  // Gambling, trading and payment preparation, restricted-data tools, built-in duplicates and writers stay out by name.
  const banned = /^\/(polymarket|hyperliquid|swap|bridge|ln-invoice|trade-insight|token\/verdict|check\/|x402|mev|dex|options|defi|stock|crypto|memory|page|ai\/|llm|image|transcribe|describe|summarize|search|news|extract|scrape|web\/|validate\/|calc\/|jwt|hmac|random|text\/|email|phone|ip\/|vat\/|geocode|geo\/|pack\/(?!website-audit))/;
  for (const path of CHATGPT_TOOLS) assert.doesNotMatch(path, banned, path);
  for (const must of ['/sanctions/check', '/sec/filings', '/domain', '/pdf/text', '/wallet/balances', '/price/token', '/fx', '/weather']) assert.ok(CHATGPT_TOOLS.has(must), must);
});

test('what ChatGPT reads about a tool has no paid-service or deal wording and names no tool it cannot call', async () => {
  const { CHATGPT_TOOLS, CHATGPT_WORDING, chatgptText } = await load('src/lib/chatgpt-tools.ts');
  const { ENDPOINTS } = await load('src/discovery.ts');
  const { mcpName, directoryToolDescription } = await load('src/mcp-contract.ts');
  const byPath = new Map(ENDPOINTS.map((e) => [e.path, e]));
  // Every replacement still finds its text in the catalog, and only tools on the list have one.
  for (const [path, pairs] of Object.entries(CHATGPT_WORDING)) {
    assert.ok(CHATGPT_TOOLS.has(path), `${path} has wording but is not offered`);
    const e = byPath.get(path);
    const all = [e.description, ...Object.entries(e.params).flatMap(([name, p]) => [p.description, `${name}=${p.example}`])].join('\n');
    for (const [from] of pairs) assert.ok(all.includes(from), `${path}: the catalog no longer says "${from}"`);
  }
  const offered = new Set([...CHATGPT_TOOLS].map(mcpName));
  // Names of tools this server does not offer; one-word names (time, domain, feed…) are ordinary words and are skipped.
  const others = ENDPOINTS.map((e) => mcpName(e.path)).filter((n) => n.includes('_') && !offered.has(n));
  const otherPaths = ENDPOINTS.map((e) => e.path).filter((p) => !CHATGPT_TOOLS.has(p));
  const problems = [];
  for (const path of CHATGPT_TOOLS) {
    const e = byPath.get(path);
    const texts = [directoryToolDescription(e), e.summary, ...Object.values(e.params).map((p) => chatgptText(path, p.description))];
    for (const text of texts) {
      for (const [what, re] of [['paid-service wording', COMMERCE], ['deal wording', DEALING], ['catalog wording', /<chain>|uncharged/]]) {
        const hit = text.match(re); if (hit) problems.push(`${path}: ${what} "${hit[0]}" in: ${text}`);
      }
      for (const name of others) if (new RegExp(`\\b${name}\\b`).test(text)) problems.push(`${path} names ${name}, which ChatGPT cannot call`);
      for (const p of otherPaths) if (new RegExp(`(^|[\\s(])${p.replace(/[/-]/g, '\\$&')}(?![\\w/-])`).test(text)) problems.push(`${path} names ${p}, which ChatGPT cannot call`);
    }
  }
  assert.deepEqual(problems, []);
  assert.equal(chatgptText('/vin', 'A malformed VIN is a 400, uncharged.'), 'A malformed VIN is a 400.');
  assert.equal(chatgptText('/x', 'returns 404 and 422, both uncharged. Files fail uncharged.'), 'returns 404 and 422. Files fail.');
});

test('/mcp/chatgpt lists only the allowed tools, with explicit annotations and no word about money', async () => {
  const { CHATGPT_TOOLS } = await load('src/lib/chatgpt-tools.ts');
  const token = await freeToken();
  await withClient(token, async (client) => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, CHATGPT_TOOLS.size);
    for (const t of tools) {
      assert.doesNotMatch(t.description, COMMERCE, `${t.name}: ${t.description.slice(-160)}`);
      for (const [input, schema] of Object.entries(t.inputSchema.properties ?? {})) assert.doesNotMatch(schema.description ?? '', COMMERCE, `${t.name} input ${input}`);
      assert.match(t.description, /Reads or computes only and changes nothing\.$/, t.name);
      // OpenAI requires the three hints as explicit booleans on every tool; here every tool reads only.
      for (const k of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) assert.equal(typeof t.annotations[k], 'boolean', `${t.name} ${k}`);
      assert.equal(t.annotations.readOnlyHint, true, t.name);
      assert.equal(t.annotations.destructiveHint, false, t.name);
    }
    const hint = (name) => tools.find((t) => t.name === name).annotations.openWorldHint;
    assert.equal(hint('weather'), true); assert.equal(hint('sanctions_check'), true);
    assert.equal(hint('semver'), false); assert.equal(hint('qr'), false); assert.equal(hint('time'), false);
    for (const name of ['base_call', 'validate_luhn', 'calc_bmi', 'jwt_decode', 'text_pii', 'memory_set', 'page_publish', 'search', 'ai_chat', 'image', 'polymarket_markets', 'swap_quote', 'check_payee', 'email', 'screenshot']) {
      assert.ok(!tools.some((t) => t.name === name), `${name} is not offered to ChatGPT`);
    }
    const instructions = client.getInstructions();
    assert.doesNotMatch(instructions, COMMERCE);
    assert.doesNotMatch(instructions, /https?:\/\/|\/mcp\//);
    assert.match(instructions, /can make 50 calls a day/);
    // Every tool the instructions name is on the list.
    const named = [...instructions.matchAll(/\b([a-z0-9]+(?:_[a-z0-9]+)+|company|domain|feed|package|fx|weather|time)\b(?=[,;.]| →|$)/g)].map((m) => m[1]).filter((n) => instructions.includes('→') && instructions.indexOf(n) > instructions.indexOf('Pick by task'));
    for (const n of new Set(named)) assert.ok(tools.some((t) => t.name === n), `instructions name ${n}`);
  });
});

test('/mcp/chatgpt answers within the daily allowance with no note about money, and says plainly when the day is used up', async () => {
  const token = await freeToken();
  await withClient(token, async (client) => {
    const ok = await client.callTool({ name: 'time', arguments: { zone: 'UTC' } });
    assert.ok(!ok.isError, JSON.stringify(ok).slice(0, 300));
    assert.equal(ok.content.length, 1, 'the result only: no allowance or payment note is added');
    assert.doesNotMatch(ok.content.map((c) => c.text).join(' '), COMMERCE);
    assert.equal(ok._meta?.requestId, undefined);
    // A failed call does not count; then the allowance runs out after 50 successful calls in all.
    const bad = await client.callTool({ name: 'semver', arguments: { a: 'not-a-version', b: '1.0.0' } });
    assert.equal(bad.isError, true);
    assert.doesNotMatch(bad.content.map((c) => c.text).join(' '), COMMERCE, 'a refused call says nothing about charges either');
    for (let i = 0; i < 49; i++) { const r = await client.callTool({ name: 'time', arguments: { zone: 'UTC' } }); assert.ok(!r.isError, `call ${i + 2}`); }
    const over = await client.callTool({ name: 'time', arguments: { zone: 'UTC' } });
    assert.equal(over.isError, true);
    const text = over.content.map((c) => c.text).join(' ');
    assert.match(text, /Today's call limit is reached \(50 calls a day per account\)\. It resets at 00:00 UTC\. Nothing was run\./);
    assert.doesNotMatch(text, COMMERCE);
    assert.doesNotMatch(text, /https?:\/\//);
  });
});

test('a sign-in from ChatGPT sees one Continue button and no key, credits or prices; a key is never attached', async () => {
  const reg = await mf.dispatchFetch(`${O}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [REDIRECT, 'https://claude.ai/api/mcp/auth_callback'] }) });
  const clientId = (await reg.json()).client_id;
  const q = (redirect) => new URLSearchParams({ client_id: clientId, redirect_uri: redirect, state: 's', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', response_type: 'code' });
  const page = await (await mf.dispatchFetch(`${O}/oauth/authorize?${q(REDIRECT)}`)).text();
  assert.match(page, /<button type="submit" name="mode" value="free">Continue<\/button>/);
  assert.doesNotMatch(page.replace(/<style[\s\S]*?<\/style>/, ''), /adt_|API key|\/credits|credit|free call|\$\d|buy/i);
  // Another app's sign-in keeps the key field.
  const other = await (await mf.dispatchFetch(`${O}/oauth/authorize?${q('https://claude.ai/api/mcp/auth_callback')}`)).text();
  assert.match(other, /Sign in with key/);
  // Posting a key from ChatGPT's return address is ignored rather than attached (the form has no key field).
  const post = await mf.dispatchFetch(`${O}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.99' }, body: new URLSearchParams({ ...Object.fromEntries(q(REDIRECT)), mode: 'key', key: 'adt_' + 'A'.repeat(43) }) });
  assert.equal(post.status, 302);
  assert.ok(new URL(post.headers.get('location')).searchParams.get('code'));
  const meta = await (await mf.dispatchFetch(`${O}/.well-known/oauth-authorization-server`)).json();
  assert.doesNotMatch(meta.service_documentation, /credits/);
});
test('the signed-in server for other apps lists each tool once: no entry paths', async () => {
  const { ENTRY_OF } = await load('src/routes/entry-paths.ts');
  const { mcpName } = await load('src/mcp-contract.ts');
  const token = await freeToken('https://claude.ai/api/mcp/auth_callback');
  await withClient(token, async (client) => {
    const names = new Set((await client.listTools()).tools.map((t) => t.name));
    for (const [door, canonical] of Object.entries(ENTRY_OF)) assert.ok(!names.has(mcpName(door)), `${door} is a second name for ${canonical}`);
    for (const kept of ['weather', 'extract', 'price_token', 'ai_chat']) assert.ok(names.has(kept), kept);
    assert.ok(names.size > 300, `still the full signed-in catalog: ${names.size}`);
  }, '/mcp/account');
});