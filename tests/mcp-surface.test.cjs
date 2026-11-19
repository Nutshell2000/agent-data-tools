// The small /mcp surface (16 Nov 2026). /mcp used to list every tool as its own definition (452 on 11 Nov, about 570 KB);
// it now lists find_tool, describe_tool, call_tool and a dozen pinned tools. What must hold:
//   - tools/call on /mcp still runs ANY name it ran before, listed or not (clients have the old names cached);
//   - the former list is at /mcp/all, without the entry paths (second names), which stay callable everywhere;
//   - no listed schema on any server carries zod's 9007199254740991 "no bound" integers;
//   - free MCP calls are counted per connection (a signed token sent as Mcp-Session-Id), per address only as the fallback.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

let mf, catalog;
const O = 'https://api.test';
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', MCP_FREE_SESSIONS: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async (r) => {
      const u = new URL(r.url);
      if (u.hostname === 'fixture.invalid') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
      return new Response('not expected in this test', { status: 500 });
    } }));
  const lib = await build({ stdin: { contents: 'export { ENDPOINTS, TOOL_COUNT } from "./src/endpoints"; export { ENTRY_OF } from "./src/routes/entry-paths"; export { EXTRA_CHAIN_PATHS } from "./src/routes/chain-reads"; export * as contract from "./src/mcp-contract"; export { MCP_BUNDLES, FOCUSED_SERVERS, mcpBundleTools } from "./src/discovery"; export { FREE_CALLS_PER_CALLER, FREE_SESSIONS_PER_ADDRESS_PER_DAY } from "./src/lib/free-calls";', resolveDir: process.cwd(), sourcefile: 'surface-entry.ts', loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', lib.outputFiles[0].text)(mod, mod.exports, require);
  catalog = mod.exports;
});
after(async () => { await mf?.dispose(); });

async function withClient(fn, { path = '/mcp', ip = '203.0.113.20', session } = {}) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'surface-test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(`${O}${path}`), { requestInit: { headers: { 'cf-connecting-ip': ip } }, fetch: (u, i) => mf.dispatchFetch(u, i), ...(session ? { sessionId: session } : {}) });
  try {
    await client.connect(transport);
    return await fn(client, transport);
  } finally { await client.close(); }
}
const textOf = (result) => result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const jsonOf = (result) => JSON.parse(result.content.find((c) => c.type === 'text').text);
const names = (tools) => tools.map((t) => t.name);
const SHA_HELLO = crypto.createHash('sha256').update('hello').digest('hex');
const freeLeft = (result) => Number(/Free call \((\d+) of \d+ free calls left/.exec(textOf(result))?.[1] ?? NaN);
// One plain JSON-RPC request, for the cases the SDK client hides (headers, a made-up session id).
async function rpc(path, body, headers = {}) {
  const res = await mf.dispatchFetch(`${O}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'cf-connecting-ip': '203.0.113.99', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  const data = /^data: (.+)$/m.exec(text)?.[1];
  return { res, json: text ? JSON.parse(data ?? text) : null };
}
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'surface-raw', version: '1' } } };
const hashCall = (id) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'hash', arguments: { text: 'hello' } } });

test('/mcp lists the finder trio and the pinned tools, under 20 definitions, and says how the small list works', async () => {
  const { contract, ENDPOINTS, ENTRY_OF, TOOL_COUNT } = catalog;
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const pinned = contract.MCP_PINNED_PATHS.map((p) => contract.mcpName(p));
    assert.deepEqual(names(tools), [...contract.SURFACE_TOOLS, ...pinned]);
    assert.ok(tools.length < 20, `/mcp lists ${tools.length} tools`);
    assert.ok(JSON.stringify(tools).length < 60_000, `the list is ${JSON.stringify(tools).length} bytes`);
    // The pinned tools are ordinary definitions: the same ones /mcp/all gives.
    const weather = tools.find((t) => t.name === 'weather');
    assert.match(weather.description, /Price \$0\.002\/call/);
    assert.equal(weather.inputSchema.properties.city.type, 'string');
    assert.deepEqual([weather.inputSchema.properties.hours.minimum, weather.inputSchema.properties.hours.maximum], [1, 48]);
    for (const t of tools) assert.ok(t.title && t.annotations.title, `${t.name} has a title`);
    // The trio carries the same annotations as on the compact server, and describe_tool says what tool_details says there.
    for (const t of tools.slice(0, 3)) assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.match(tools[0].description, new RegExp(`this service's ${TOOL_COUNT} tools`));
    assert.match(tools[2].description, /describe_tool and find_tool show it/);
    assert.doesNotMatch(JSON.stringify(tools.slice(0, 3)), /tool_details/);
    const how = client.getInstructions();
    assert.match(how, new RegExp(`^This server lists ${tools.length} tools and reaches the whole catalog: find_tool`));
    assert.match(how, /then describe_tool .* then call_tool/);
    assert.match(how, /the full list, every tool as its own definition, is at https:\/\/api\.test\/mcp\/all\./);
    assert.match(how, new RegExp(`Agent Data Tools: ${TOOL_COUNT} pay-per-call tools`));
    for (const name of pinned) assert.ok(how.includes(name), `instructions name ${name}`);
  });
  // The pinned list: canonical tools that only read, none of them a finder name.
  for (const path of contract.MCP_PINNED_PATHS) {
    assert.ok(ENDPOINTS.some((e) => e.path === path), `${path} is a tool`);
    assert.ok(!Object.hasOwn(ENTRY_OF, path), `${path} is an entry path`);
    assert.equal(contract.isWriteTool(path), false, `${path} writes`);
  }
  assert.ok(contract.MCP_PINNED_PATHS.length >= 10 && contract.MCP_PINNED_PATHS.length <= 14);
  const taken = new Set(ENDPOINTS.map((e) => contract.toolName(e)));
  for (const name of contract.SURFACE_TOOLS) assert.ok(!taken.has(name), `a catalog tool is named ${name}`);
});

test('tools/call on /mcp still runs a tool that is no longer listed, by its old name, exactly as /mcp/all runs it', async () => {
  const run = (path, ip) => withClient(async (client) => {
    const { tools } = await client.listTools();
    const result = await client.callTool({ name: 'hash', arguments: { text: 'hello' } });
    return { listed: names(tools).includes('hash'), result };
  }, { path, ip });
  const small = await run('/mcp', '203.0.113.21');
  const full = await run('/mcp/all', '203.0.113.22');
  assert.equal(small.listed, false);
  assert.equal(full.listed, true);
  // Same answer, same output contract, same free-call note and the same next-tool names.
  assert.equal(small.result.isError, undefined);
  assert.equal(small.result.structuredContent.hex, SHA_HELLO);
  assert.deepEqual(small.result.structuredContent, full.result.structuredContent);
  assert.equal(freeLeft(small.result), catalog.FREE_CALLS_PER_CALLER - 1);
  assert.equal(textOf(small.result).replace(/"requestId":"[^"]+"/, ''), textOf(full.result).replace(/"requestId":"[^"]+"/, ''));
  assert.deepEqual(small.result._meta.relatedTools, full.result._meta.relatedTools);
  // A tool outside the free calls answers its own payment request, as before, and the same one on both servers.
  const quote = (path, ip) => withClient((client) => client.callTool({ name: 'image', arguments: { prompt: 'a red bicycle' } }), { path, ip });
  const [a, b] = [await quote('/mcp', '203.0.113.23'), await quote('/mcp/all', '203.0.113.24')];
  assert.equal(a.isError, true);
  assert.equal(jsonOf(a).x402Version, 2);
  assert.deepEqual(jsonOf(a).accepts, jsonOf(b).accepts);
  // An unknown name is refused as the SDK always refused it.
  const unknown = await withClient((client) => client.callTool({ name: 'no_such_tool', arguments: {} }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] })), { ip: '203.0.113.25' });
  assert.equal(unknown.isError, true);
  assert.match(textOf(unknown), /no_such_tool/);
});

test('a call is counted under the tool\'s own path whichever way it is reached on /mcp', async () => {
  await withClient(async (client) => {
    // A tool no other test here calls, so the day's count is this test's alone.
    await client.callTool({ name: 'slug', arguments: { text: 'Hello World' } });
    await client.callTool({ name: 'call_tool', arguments: { name: 'slug', arguments: { text: 'Hello World' } } });
  }, { ip: '203.0.113.26' });
  const revenue = await (await mf.dispatchFetch(`${O}/revenue`)).json();
  const day = Object.values(revenue.funnel.days).at(-1);
  assert.equal(day['mcp:/slug:free_call'], 2, 'both calls are counted as /slug free calls');
  assert.ok(!/find_tool|call_tool|describe_tool/.test(JSON.stringify(revenue)), 'no finder tool has a row of its own');
});

test('compact call_tool keeps input aliases so MCP agents can send the names HTTP accepts', async () => {
  await withClient(async (client) => {
    const aliased = await client.callTool({ name: 'call_tool', arguments: { name: 'hash', arguments: { input: 'hello' } } });
    assert.equal(aliased.isError, undefined, JSON.stringify(aliased));
    assert.equal(aliased.structuredContent.hex, SHA_HELLO);
    const declared = await client.callTool({ name: 'call_tool', arguments: { name: 'hash', arguments: { text: 'hello' } } });
    assert.equal(declared.structuredContent.hex, SHA_HELLO);
    const unknown = await client.callTool({ name: 'call_tool', arguments: { name: 'hash', arguments: { text: 'hello', nonsense: 'ignored' } } });
    assert.equal(unknown.structuredContent.hex, SHA_HELLO, 'an unknown key is harmless');
  }, { path: '/mcp/compact', ip: '203.0.113.31' });
});

test('compact call_tool applies alias special handling, not a raw copy (urls → first URL, messages → prompt)', async () => {
  await withClient(async (client) => {
    // The `urls` alias must resolve to the FIRST URL as on HTTP, not a comma-joined malformed url.
    const urls = await client.callTool({ name: 'call_tool', arguments: { name: 'url_parse', arguments: { urls: 'https://example.com/a,https://example.com/b' } } });
    assert.notEqual(urls.isError, true, JSON.stringify(urls));
    const declared = await client.callTool({ name: 'call_tool', arguments: { name: 'url_parse', arguments: { url: 'https://example.com/a' } } });
    // Both should parse the exact same first URL; a raw alias copy leaves ",https://..." in the path.
    assert.equal(urls.structuredContent.path, declared.structuredContent.path);
  }, { path: '/mcp/compact', ip: '203.0.113.33' });
});

test('ordinary MCP servers also accept the HTTP input aliases', async () => {
  await withClient(async (client) => {
    const aliased = await client.callTool({ name: 'hash', arguments: { input: 'hello' } });
    assert.equal(aliased.isError, undefined, JSON.stringify(aliased));
    assert.equal(aliased.structuredContent.hex, SHA_HELLO);
  }, { ip: '203.0.113.32' });
});

test('on /mcp find_tool, describe_tool and call_tool work as on the compact server, and tool_details still answers', async () => {
  await withClient(async (client) => {
    const found = jsonOf(await client.callTool({ name: 'find_tool', arguments: { need: 'sha256 hash of a text', count: 3 } }));
    assert.ok(found.tools.some((t) => t.tool === 'hash'));
    assert.match(found.next, /^describe_tool for every input/);
    const described = await client.callTool({ name: 'describe_tool', arguments: { name: 'hash' } });
    const old = await client.callTool({ name: 'tool_details', arguments: { name: 'hash' } });
    assert.deepEqual(jsonOf(described), jsonOf(old));
    assert.equal(jsonOf(described).exampleCall.name, 'hash');
    const ran = await client.callTool({ name: 'call_tool', arguments: { name: 'hash', arguments: { text: 'hello' } } });
    assert.equal(ran.structuredContent.hex, SHA_HELLO);
    // A chain read of the extra networks is not registered on /mcp by name, and is reached through call_tool.
    const extra = catalog.ENDPOINTS.find((e) => catalog.EXTRA_CHAIN_PATHS.has(e.path) && Object.keys(e.params).length);
    assert.equal(jsonOf(await client.callTool({ name: 'describe_tool', arguments: { name: catalog.contract.toolName(extra) } })).tool, catalog.contract.toolName(extra));
    // The price rule is the compact server's: the $1 audit is refused, uncharged, until the call names its price.
    const dear = await client.callTool({ name: 'call_tool', arguments: { name: 'audit_contract', arguments: { source: 'contract A {}' } } });
    assert.equal(dear.isError, true);
    assert.match(jsonOf(dear).error, /more than the \$0\.10 this server spends on one call/);
  }, { ip: '203.0.113.27' });
  // The compact server itself is what it was: three names, tool_details among them, no describe_tool.
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(names(tools), ['find_tool', 'tool_details', 'call_tool']);
    await assert.rejects(client.callTool({ name: 'describe_tool', arguments: { name: 'hash' } }).then((r) => { if (r.isError) throw new Error(textOf(r)); }), /describe_tool/);
  }, { path: '/mcp/compact', ip: '203.0.113.28' });
});

test('/mcp/all is the former full list without the entry paths; entry paths are listed nowhere and run everywhere they ran', async () => {
  const { contract, ENDPOINTS, ENTRY_OF, EXTRA_CHAIN_PATHS, MCP_BUNDLES, mcpBundleTools } = catalog;
  const alias = (e) => Object.hasOwn(ENTRY_OF, e.path);
  const formerList = ENDPOINTS.filter((e) => !EXTRA_CHAIN_PATHS.has(e.path));
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const expected = formerList.filter((e) => !alias(e)).map((e) => contract.toolName(e));
    assert.deepEqual([...names(tools)].sort(), [...expected].sort());
    assert.ok(tools.length > 400);
    for (const e of formerList.filter(alias)) assert.ok(!names(tools).includes(contract.toolName(e)), `${e.path} is an entry path and is listed`);
    assert.match(client.getInstructions(), new RegExp(`^Agent Data Tools: ${tools.length} pay-per-call tools`));
    // /scrape is the entry path of /extract: not listed, and it still answers by name (here: its own input refusal, uncharged).
    assert.equal(ENTRY_OF['/scrape'], '/extract');
    const door = await client.callTool({ name: 'scrape', arguments: { url: 'http://127.0.0.1/private' } });
    assert.equal(door.isError, true);
    assert.doesNotMatch(textOf(door), /Tool scrape not found/);
  }, { path: '/mcp/all', ip: '203.0.113.29' });
  // The same door by name on /mcp, and on its section server, where it is no longer listed either.
  for (const path of ['/mcp', '/mcp/web']) {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      assert.ok(!names(tools).includes('scrape'), `${path} lists the entry path scrape`);
      const door = await client.callTool({ name: 'scrape', arguments: { url: 'http://127.0.0.1/private' } });
      assert.doesNotMatch(textOf(door), /Tool scrape not found/);
    }, { path, ip: '203.0.113.30' });
  }
  for (const slug of Object.keys(MCP_BUNDLES)) {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      assert.deepEqual([...names(tools)].sort(), mcpBundleTools(slug).filter((e) => !alias(e)).map((e) => contract.toolName(e)).sort(), slug);
    }, { path: `/mcp/${slug}`, ip: '203.0.113.31' });
  }
  // "all" is a name of its own: no section or focused server took it, and a key in the URL reaches it too.
  assert.ok(!Object.hasOwn(MCP_BUNDLES, contract.ALL_BUNDLE) && !Object.hasOwn(catalog.FOCUSED_SERVERS, contract.ALL_BUNDLE));
  const unknown = await mf.dispatchFetch(`${O}/mcp/nope`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unknown.status, 404);
  assert.match((await unknown.json()).error, /use one of: all, compact, /);
});

test('no listed tool schema on any server states 9007199254740991, and every integer input states a real range', async () => {
  const { contract, ENDPOINTS, MCP_BUNDLES, FOCUSED_SERVERS } = catalog;
  const servers = ['/mcp', '/mcp/all', '/mcp/compact', '/mcp/compact-capped', ...Object.keys(MCP_BUNDLES).map((s) => `/mcp/${s}`), ...Object.keys(FOCUSED_SERVERS).map((s) => `/mcp/${s}`)];
  let integers = 0;
  for (const path of servers) {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      assert.ok(tools.length > 0, path);
      assert.doesNotMatch(JSON.stringify(tools), /9007199254740991/, `${path} lists an integer without a real range`);
      for (const t of tools) for (const [input, schema] of Object.entries(t.inputSchema.properties ?? {})) {
        if (schema.type !== 'integer') continue;
        integers++;
        assert.ok(Number.isSafeInteger(schema.minimum) && Number.isSafeInteger(schema.maximum) && schema.minimum <= schema.maximum, `${path} ${t.name}.${input}`);
        assert.ok(Math.abs(schema.minimum) <= 1e12 && Math.abs(schema.maximum) <= 1e12, `${path} ${t.name}.${input}`);
      }
    }, { path, ip: '203.0.113.32' });
  }
  assert.ok(integers > 200, `only ${integers} integer inputs were checked`);
  // The rule itself: the range the description states; a later "up to N" widens it; then the kind of input; then the widest.
  const range = (name, description) => [...contract.integerRange(name, { description })];
  assert.deepEqual(range('limit', 'Number of results, 1-20 (default 5)'), [1, 20]);
  assert.deepEqual(range('shift', 'Places to shift, -25 to 25 (default 13 = ROT13)'), [-25, 25]);
  assert.deepEqual(range('blocks', 'How many recent blocks to scan (1-20000, default 10000; Base makes a block every 0.2 s, so 10,000 blocks is about 33 minutes)'), [1, 20000]);
  assert.deepEqual(range('blocks', 'How many recent blocks to read, 100 to 10000 (default 1800); on Base ten times that (default 18000, up to 100000)'), [100, 100000]);
  assert.deepEqual(range('maxChars', 'Maximum characters (1,000-200,000, default 50,000)'), [1000, 200000]);
  assert.deepEqual(range('days', 'Days to add'), [-100000, 100000]);
  assert.deepEqual(range('code', 'Status code'), [100, 599]);
  assert.deepEqual(range('something', 'A whole number'), [-1e12, 1e12]);
  // Every example the catalog publishes lies inside the range its input states: a published bound never refuses the
  // tool's own example call.
  for (const e of ENDPOINTS) for (const [name, p] of Object.entries(e.params)) {
    if (p.type !== 'integer' || p.enum || typeof p.example !== 'number') continue;
    const [low, high] = contract.integerRange(name, p);
    assert.ok(p.example >= low && p.example <= high, `${e.path} ${name}: example ${p.example} is outside ${low}..${high}`);
  }
});

test('a call is never checked more strictly than before: a value outside the listed range still reaches the tool', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const uuid = tools.find((t) => t.name === 'uuid');
    assert.deepEqual([uuid.inputSchema.properties.count.minimum, uuid.inputSchema.properties.count.maximum], [1, 100]);
    // The handler holds count to its range (family.ts CLAMPED_INPUTS); the MCP layer must not refuse it first.
    const result = await client.callTool({ name: 'uuid', arguments: { count: 5000 } });
    assert.equal(result.isError, undefined, textOf(result));
    assert.equal(result.structuredContent.uuids.length, 100);
  }, { path: '/mcp/all', ip: '203.0.113.33' });
  // The same by its old name on /mcp, and through call_tool, which checks the arguments against the same shape.
  await withClient(async (client) => {
    assert.equal((await client.callTool({ name: 'uuid', arguments: { count: 5000 } })).structuredContent.uuids.length, 100);
    assert.equal((await client.callTool({ name: 'call_tool', arguments: { name: 'uuid', arguments: { count: 5000 } } })).structuredContent.uuids.length, 100);
  }, { ip: '203.0.113.34' });
});

test('free calls are counted per connection: two sessions from one address each have their own', async () => {
  const ip = '198.51.100.1';
  const used = async (calls) => withClient(async (client, transport) => {
    assert.match(transport.sessionId, /^[0-9a-f]{32}\.[0-9a-f]{64}$/, 'initialize answers a session id');
    let left;
    for (let i = 0; i < calls; i++) left = freeLeft(await client.callTool({ name: 'hash', arguments: { text: 'hello' } }));
    return { left, session: transport.sessionId };
  }, { ip });
  const first = await used(3);
  const second = await used(1);
  assert.notEqual(first.session, second.session);
  assert.equal(first.left, catalog.FREE_CALLS_PER_CALLER - 3);
  assert.equal(second.left, catalog.FREE_CALLS_PER_CALLER - 1, 'the second connection did not share the first one\'s calls');
  // The first connection again, by its own session id: it continues where it stopped, it does not start over.
  const again = await rpc('/mcp', hashCall(5), { 'cf-connecting-ip': ip, 'mcp-session-id': first.session });
  assert.match(JSON.stringify(again.json), new RegExp(`Free call \\(${catalog.FREE_CALLS_PER_CALLER - 4} of`));
  // A connection that is opened again with its session id keeps that id: no fresh allowance for re-initializing.
  const reopened = await rpc('/mcp', INIT, { 'cf-connecting-ip': ip, 'mcp-session-id': first.session });
  assert.equal(reopened.res.headers.get('mcp-session-id'), first.session);
});

test('a made-up or altered session id is not honoured: its calls are counted on the address', async () => {
  const ip = '198.51.100.2';
  const forged = `${'ab'.repeat(16)}.${'cd'.repeat(32)}`;
  const a = await rpc('/mcp', hashCall(1), { 'cf-connecting-ip': ip, 'mcp-session-id': forged });
  assert.match(JSON.stringify(a.json), new RegExp(`Free call \\(${catalog.FREE_CALLS_PER_CALLER - 1} of`));
  // A second made-up id from the same address shares the address allowance; so does a request with no id at all.
  const b = await rpc('/mcp', hashCall(2), { 'cf-connecting-ip': ip, 'mcp-session-id': 'not-a-token' });
  assert.match(JSON.stringify(b.json), new RegExp(`Free call \\(${catalog.FREE_CALLS_PER_CALLER - 2} of`));
  const c = await rpc('/mcp', hashCall(3), { 'cf-connecting-ip': ip });
  assert.match(JSON.stringify(c.json), new RegExp(`Free call \\(${catalog.FREE_CALLS_PER_CALLER - 3} of`));
  // A real id with one character of its signature changed is a made-up id.
  const real = (await rpc('/mcp', INIT, { 'cf-connecting-ip': ip })).res.headers.get('mcp-session-id');
  const altered = real.slice(0, -1) + (real.endsWith('0') ? '1' : '0');
  const d = await rpc('/mcp', hashCall(4), { 'cf-connecting-ip': ip, 'mcp-session-id': altered });
  assert.match(JSON.stringify(d.json), new RegExp(`Free call \\(${catalog.FREE_CALLS_PER_CALLER - 4} of`));
});

test('an address admits only a few sessions a day; later ones share the address allowance, and opening sessions writes nothing', async () => {
  const ip = '198.51.100.3';
  const cap = catalog.FREE_SESSIONS_PER_ADDRESS_PER_DAY;
  assert.ok(cap >= 1 && cap <= 5, 'the cap is a small number');
  const open = async () => (await rpc('/mcp', INIT, { 'cf-connecting-ip': ip })).res.headers.get('mcp-session-id');
  // Many sessions are opened and never used: they cost nothing and do not use up the address's admissions.
  for (let i = 0; i < 6; i++) assert.match(await open(), /^[0-9a-f]{32}\./);
  const left = async (session, id) => Number(/Free call \((\d+) of/.exec(JSON.stringify((await rpc('/mcp', hashCall(id), { 'cf-connecting-ip': ip, ...(session ? { 'mcp-session-id': session } : {}) })).json))[1]);
  const full = catalog.FREE_CALLS_PER_CALLER;
  const sessions = [];
  for (let i = 0; i < cap; i++) { sessions.push(await open()); assert.equal(await left(sessions[i], 10 + i), full - 1, `session ${i + 1} has its own allowance`); }
  // The next sessions from this address are valid tokens, but the address has admitted its sessions for today.
  const late = [await open(), await open()];
  assert.equal(await left(late[0], 20), full - 1, 'counted on the address');
  assert.equal(await left(late[1], 21), full - 2, 'and shared with the next late session');
  assert.equal(await left(undefined, 22), full - 3, 'and with a caller that sends no session id');
  // An admitted session keeps its own allowance afterwards.
  assert.equal(await left(sessions[0], 23), full - 2);
});

test('keyed and signed-in callers get no session id, and other servers issue one like /mcp', async () => {
  const keyed = await rpc('/mcp', INIT, { authorization: `Bearer adt_${'a'.repeat(40)}` });
  assert.equal(keyed.res.headers.get('mcp-session-id'), null);
  const inUrl = await rpc(`/mcp/k/adt_${'a'.repeat(40)}`, INIT);
  assert.equal(inUrl.res.headers.get('mcp-session-id'), null);
  const compact = await rpc('/mcp/compact', INIT);
  assert.match(compact.res.headers.get('mcp-session-id'), /^[0-9a-f]{32}\.[0-9a-f]{64}$/);
  // A request that is not initialize never gets one.
  const list = await rpc('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(list.res.headers.get('mcp-session-id'), null);
  assert.equal(list.json.result.tools.length, catalog.contract.SURFACE_TOOLS.length + catalog.contract.MCP_PINNED_PATHS.length);
});
