const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// The hand-picked product servers (FOCUSED_SERVERS in src/discovery.ts) at /mcp/documents and /mcp/company-check:
// directories score each registry entry on its own, so each must stay small, free of second names and packs, and its
// instructions must describe only what it offers.
let mf;
let discovery;
const O = 'https://api.test';
before(async () => {
  const d = await build({ entryPoints: ['src/discovery.ts'], bundle: true, format: 'cjs', platform: 'node', write: false,
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /^(cloudflare:workers|@cloudflare\/puppeteer)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = { DurableObject: class {} };', loader: 'js' }));
    } }] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', d.outputFiles[0].text)(m, m.exports, require);
  discovery = m.exports;
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' },
    outboundService: async () => Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] }) }));
});
after(async () => { await mf?.dispose(); });

async function connect(slug) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'focused-fixture', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${O}/mcp/${slug}`), { fetch: (u, i) => mf.dispatchFetch(u, i) }));
  return client;
}

test('every focused server lists exactly its canonical tools, at most ten, no entry paths and no packs', () => {
  const paths = new Set(discovery.ENDPOINTS.map((e) => e.path));
  for (const [slug, f] of Object.entries(discovery.FOCUSED_SERVERS)) {
    assert.ok(!Object.hasOwn(discovery.MCP_BUNDLES, slug), `${slug} must not shadow a section server`);
    assert.ok(f.paths.length >= 3 && f.paths.length <= 10, `${slug}: ${f.paths.length} tools`);
    for (const p of f.paths) {
      assert.ok(paths.has(p), `${slug}: ${p} is not a live tool`);
      assert.ok(!p.startsWith('/pack/'), `${slug}: ${p} is a pack`);
    }
    assert.equal(discovery.focusedServerTools(slug).length, f.paths.length);
  }
});

for (const slug of ['documents', 'company-check']) {
  test(`/mcp/${slug} serves its own tools, title and instructions`, async () => {
    const f = discovery.FOCUSED_SERVERS[slug];
    const client = await connect(slug);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      const expected = f.paths.map((p) => p.slice(1).replace(/[/-]/g, '_')).sort();
      assert.deepEqual(names, expected);
      assert.equal(client.getServerVersion().title, `Agent Data Tools: ${f.title}`);
      const how = client.getInstructions();
      assert.match(how, new RegExp(`^Agent Data Tools, ${f.paths.length} pay-per-call tools for `));
      assert.match(how, /per successful call/);
      // The pick-by-task line names only tools this server offers.
      for (const word of f.pick.match(/→ ([a-z_]+)/g).map((s) => s.slice(2))) assert.ok(names.includes(word), `${slug} pick names ${word}`);
      assert.ok(!/ai_chat|wallet_portfolio|price_token/.test(how), 'catalog-wide pick list leaked into a focused server');
    } finally { await client.close(); }
  });
}

test('an unknown bundle still answers 404 and names the focused servers', async () => {
  const r = await mf.dispatchFetch(`${O}/mcp/nope`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.match(body.error, /documents/);
  assert.match(body.error, /company-check/);
});

test('the registry manifest builder writes the focused and compact entries', () => {
  const src = readFileSync('scripts/build-registry-manifests.mjs', 'utf8');
  assert.match(src, /FOCUSED_SERVERS/);
  assert.match(src, /slug: "compact"/);
  if (existsSync('registry/documents.json')) {
    const m = JSON.parse(readFileSync('registry/documents.json', 'utf8'));
    assert.equal(m.name, 'io.github.Nutshell2000/agent-data-tools-documents');
    assert.match(m.remotes[0].url, /\/mcp\/documents$/);
    assert.ok(m.description.length <= 100);
  }
});
