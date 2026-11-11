// The compact MCP server, /mcp/compact: the whole catalog behind three tools (find_tool, tool_details, call_tool), so a
// client carries three tool definitions instead of hundreds (/mcp lists 452, about 570 KB). call_tool must be exactly
// the tool it runs: same free calls, same key price, same payment request, and nothing charged for a call that cannot run.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

let mf, outbound = [];
const O = 'https://api.test';
const SESSION = 'cs_live_CompactKey00001';
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', STRIPE_READ_KEY: 'rk_test_fixture' },
    outboundService: async (r) => {
      const u = new URL(r.url);
      outbound.push(u.hostname + u.pathname);
      if (u.hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
      // The $1 pack bought by card: the claim reads this checkout session.
      if (u.hostname === 'api.stripe.com') return Response.json({ mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'usd', amount_total: 100, metadata: { adt_credits: '1000' } });
      return new Response('not expected in this test', { status: 500 });
    } }));
});
after(async () => { await mf?.dispose(); });

async function withClient(fn, { path = '/mcp/compact', ip = '203.0.113.10', key } = {}) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'compact-test', version: '1' });
  const headers = { 'cf-connecting-ip': ip, ...(key ? { authorization: `Bearer ${key}` } : {}) };
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${O}${path}`), { requestInit: { headers }, fetch: (u, i) => mf.dispatchFetch(u, i) }));
    return await fn(client);
  } finally { await client.close(); }
}
const textOf = (result) => result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const jsonOf = (result) => JSON.parse(result.content.find((c) => c.type === 'text').text);
const call = (client, name, args) => client.callTool({ name, arguments: args });
const SHA_HELLO = crypto.createHash('sha256').update('hello').digest('hex');

test('the compact server lists three small tools and says how to use them; the ordinary server is unchanged', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['find_tool', 'tool_details', 'call_tool']);
    assert.ok(JSON.stringify(tools).length < 6_000, `three definitions must stay small, got ${JSON.stringify(tools).length} bytes`);
    for (const t of tools) {
      assert.equal(t.annotations.readOnlyHint, true, t.name);
      assert.equal(t.annotations.destructiveHint, false, t.name);
      assert.ok(t.annotations.title, t.name);
    }
    assert.deepEqual(tools.find((t) => t.name === 'call_tool').inputSchema.required, ['name']);
    assert.match(client.getInstructions(), /^This is the compact server: three tools reach the whole catalog\. find_tool/);
    assert.match(client.getInstructions(), /free successful calls/);
  });
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.ok(tools.length > 400);
    const names = new Set(tools.map((t) => t.name));
    for (const own of ['find_tool', 'tool_details', 'call_tool']) assert.ok(!names.has(own), `${own} must not be a catalog tool name`);
    assert.ok(names.has('hash') && names.has('weather_forecast'));
  }, { path: '/mcp' });
});

test('find_tool answers a job in plain words with names, prices and inputs, and costs nothing', async () => {
  await withClient(async (client) => {
    let found = jsonOf(await call(client, 'find_tool', { need: 'extract the text of a PDF' }));
    assert.equal(found.tools[0].tool, 'pdf_text');
    assert.deepEqual(found.tools[0].requiredInputs, ['url']);
    assert.equal(found.tools[0].price, '$0.005');
    assert.equal(found.tools[0].priceWithKey, '$0.002');
    assert.ok(found.tools.length >= 2 && found.tools.length <= 5);
    found = jsonOf(await call(client, 'find_tool', { need: 'sha256 hash of a text', count: 1 }));
    assert.equal(found.tools.length, 1);
    assert.equal(found.tools[0].tool, 'hash');
    assert.equal(found.tools[0].priceWithKey, '$0.001');
    assert.equal(found.tools[0].inFreeCalls, true);
    assert.equal(typeof found.tools[0].exampleArguments.text, 'string');
    // The four tools that write are not offered here, even when asked for by their job.
    found = await call(client, 'find_tool', { need: 'publish a web page' });
    assert.ok(!textOf(found).includes('"tool":"page_publish"') && !textOf(found).includes('"tool":"page_host"'));
    const none = await call(client, 'find_tool', { need: 'zzqqxx vvkkjj' });
    assert.equal(none.isError, true);
    assert.match(textOf(none), /Nothing was charged/);
  }, { ip: '203.0.113.11' });
  // Finding and reading details did not use a free call: all 25 are still there for this caller.
  await withClient(async (client) => {
    const first = await call(client, 'call_tool', { name: 'hash', arguments: { text: 'hello' } });
    assert.match(textOf(first), /\(24 of 25 free calls left/);
  }, { ip: '203.0.113.11' });
});

test('tool_details gives every input, the price and an example call, by name or by path', async () => {
  await withClient(async (client) => {
    const d = jsonOf(await call(client, 'tool_details', { name: 'weather_forecast' }));
    assert.equal(d.tool, 'weather_forecast');
    assert.ok(d.inputs.some((i) => i.name === 'city' && i.type === 'string'));
    assert.equal(d.exampleCall.name, 'weather_forecast');
    assert.equal(typeof d.exampleCall.arguments, 'object');
    assert.match(d.charged, /Only a successful call is charged/);
    for (const form of ['/weather/forecast', 'weather/forecast', ' weather_forecast ']) assert.equal(jsonOf(await call(client, 'tool_details', { name: form })).tool, 'weather_forecast', form);
    const search = jsonOf(await call(client, 'tool_details', { name: 'search' }));
    assert.equal(search.inFreeCalls, false);
    assert.equal(search.priceWithKey, undefined);
    for (const missing of ['no_such_tool', 'page_publish', 'memory_set', 'call_tool']) {
      const r = await call(client, 'tool_details', { name: missing });
      assert.equal(r.isError, true, missing);
      assert.match(textOf(r), /no tool named/);
    }
  }, { ip: '203.0.113.12' });
});

test('call_tool runs the tool on a free call, and refuses a wrong name or bad arguments before anything is counted', async () => {
  outbound = [];
  await withClient(async (client) => {
    const ok = await call(client, 'call_tool', { name: 'hash', arguments: { text: 'hello' } });
    assert.ok(!ok.isError);
    assert.ok(textOf(ok).includes(SHA_HELLO));
    assert.match(textOf(ok), /\(24 of 25 free calls left/);
    // Refused before the tool: unknown name, a write tool, a missing required input, a wrong type.
    for (const [args, pattern] of [
      [{ name: 'no_such_tool', arguments: {} }, /no tool named/],
      [{ name: 'memory_set', arguments: { ns: 'x', key: 'k', value: 'v' } }, /no tool named/],
      [{ name: 'hash' }, /hash was not run: text: .*Nothing was charged/],
      [{ name: 'hash', arguments: { text: 42 } }, /hash was not run: text: .*Nothing was charged/],
    ]) {
      const r = await call(client, 'call_tool', args);
      assert.equal(r.isError, true, JSON.stringify(args));
      assert.match(textOf(r), pattern);
    }
    // None of the refusals used a free call: the next good call is the second.
    const again = await call(client, 'call_tool', { name: '/hash', arguments: { text: 'hello' } });
    assert.match(textOf(again), /\(23 of 25 free calls left/);
  }, { ip: '203.0.113.13' });
});

test('a tool outside the free calls answers call_tool with its own payment request and is not run', async () => {
  outbound = [];
  await withClient(async (client) => {
    const r = await call(client, 'call_tool', { name: 'search', arguments: { q: 'agent payments' } });
    assert.equal(r.isError, true);
    const text = textOf(r);
    assert.match(text, /"accepts"/);
    assert.match(text, /prepaid key by card|credits/);
    assert.ok(!outbound.some((h) => h.includes('brave')), 'the search provider was not called');
  }, { ip: '203.0.113.14' });
});

test('with a prepaid key call_tool spends that tool\'s key price, and a refused call spends nothing', async () => {
  const claim = await (await mf.dispatchFetch(`${O}/credits/claim?session_id=${SESSION}`, { headers: { accept: 'application/json' } })).json();
  assert.match(claim.apiKey, /^adt_/);
  assert.equal(claim.balanceCredits, 1000);
  const balance = async () => (await (await mf.dispatchFetch(`${O}/credits/balance`, { headers: { authorization: `Bearer ${claim.apiKey}` } })).json());
  await withClient(async (client) => {
    assert.match(client.getInstructions(), /carries a card-credit API key/);
    const ok = await call(client, 'call_tool', { name: 'hash', arguments: { text: 'hello' } });
    assert.ok(!ok.isError && textOf(ok).includes(SHA_HELLO));
    // /hash costs a key one credit (lib/key-prices.ts), through call_tool as on the ordinary server.
    assert.deepEqual((({ balanceCredits, spentCredits, calls }) => ({ balanceCredits, spentCredits, calls }))(await balance()), { balanceCredits: 999, spentCredits: 1, calls: 1 });
    await call(client, 'call_tool', { name: 'hash' });
    await call(client, 'call_tool', { name: 'no_such_tool', arguments: {} });
    await call(client, 'find_tool', { need: 'sha256 hash' });
    await call(client, 'tool_details', { name: 'hash' });
    assert.equal((await balance()).balanceCredits, 999, 'refusals and the two free tools spend nothing');
    // The key works in the address too, for clients that take only a URL.
  }, { ip: '203.0.113.15', key: claim.apiKey });
  await withClient(async (client) => {
    const ok = await call(client, 'call_tool', { name: 'uuid', arguments: {} });
    assert.ok(!ok.isError);
    assert.equal((await balance()).balanceCredits, 998);
  }, { ip: '203.0.113.16', path: `/mcp/k/${claim.apiKey}/compact` });
});

test('a call above the price ceiling needs its price named; the capped twin has no max_price and no such tool', async () => {
  const { build: bundle } = require('esbuild');
  const Module = require('node:module');
  const b = await bundle({ entryPoints: [require.resolve('../src/mcp-contract.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['cloudflare:workers'], logLevel: 'silent' });
  const m = new Module('mcp-contract', module); m.paths = Module._nodeModulePaths(process.cwd()); m._compile(b.outputFiles[0].text, 'mcp-contract');
  const { compactPricePermits, compactReach, COMPACT_PRICE_CEILING, COMPACT_CAPPED_BUNDLE } = m.exports;
  assert.equal(COMPACT_PRICE_CEILING, '$0.10');
  // At or below the ceiling nothing has to be named, and a named price there changes nothing.
  for (const named of [undefined, '$0.01', 'nonsense', 0]) assert.equal(compactPricePermits('$0.10', named), true);
  assert.equal(compactPricePermits('$0.01', undefined), true);
  // Above it the call runs only when the named price covers the tool's price.
  for (const named of [undefined, null, '', 'yes', '$0.99', 0.5, '0.10', '1e3', '-1', '$1.00 or more']) assert.equal(compactPricePermits('$1.00', named), false, String(named));
  for (const named of ['$1.00', '$1', '1', '1.00', 1, ' $ 1.00 ', '1 USD', '1 usdc', '$2.50', 5]) assert.equal(compactPricePermits('$1.00', named), true, String(named));
  assert.equal(compactPricePermits('$0.25', '$0.25'), true);
  assert.equal(compactPricePermits('$0.25', '$0.24'), false);
  // Reach: a dear read-only tool is on the compact server and absent from the capped twin; a write tool is on neither.
  const dear = { path: '/weather', price: '$1.00' };
  assert.equal(compactReach(dear), true);
  assert.equal(compactReach(dear, true), false);
  assert.equal(compactReach({ path: '/page/publish', price: '$0.01' }), false);

  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const callTool = tools.find((t) => t.name === 'call_tool');
    assert.ok(callTool.inputSchema.properties.max_price, 'the compact server takes max_price');
    assert.deepEqual(callTool.inputSchema.required, ['name']);
    assert.match(callTool.description, /more than \$0\.10 a call .* runs only when you pass that price as "max_price"/);
    assert.match(client.getInstructions(), /a tool above \$0\.10 a call runs only when the call names its price in max_price/);
    // Naming a price on an ordinary tool is harmless: it runs, free, as the tool it is.
    const ok = await client.callTool({ name: 'call_tool', arguments: { name: 'hash', arguments: { text: 'hello' }, max_price: '$1.00' } });
    assert.ok(!ok.isError && textOf(ok).includes(SHA_HELLO));
    // No tool is above the ceiling today, so no pick asks for a price.
    const found = jsonOf(await call(client, 'find_tool', { need: 'text to speech', count: 10 }));
    for (const t of found.tools) assert.equal(t.needsMaxPrice, undefined, t.tool);
  }, { ip: '203.0.113.77' });

  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['find_tool', 'tool_details', 'call_tool']);
    const callTool = tools.find((t) => t.name === 'call_tool');
    assert.equal(callTool.inputSchema.properties.max_price, undefined, 'the capped twin takes no max_price');
    assert.match(callTool.description, /never more than \$0\.10/);
    assert.match(client.getInstructions(), /never more than \$0\.10 a call/);
    const ok = await call(client, 'call_tool', { name: 'hash', arguments: { text: 'hello' } });
    assert.ok(!ok.isError && textOf(ok).includes(SHA_HELLO));
  }, { path: `/mcp/${COMPACT_CAPPED_BUNDLE}`, ip: '203.0.113.78' });
});