const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

const supported = {
  kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453',
    extra: { name: 'USD Coin', version: '2', asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', assetTransferMethod: 'eip3009' } }],
  extensions: [],
};

async function fixture({ failFirst = false } = {}) {
  let started, release;
  const firstStarted = new Promise(resolve => { started = resolve; });
  const firstReleased = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const bundle = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false,
    external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'controlled-startup', setup(b) {
      b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true }));
      b.onResolve({ filter: /^\.\/facilitator$/ }, () => ({ path: 'fixture', namespace: 'startup' }));
      b.onLoad({ filter: /.*/, namespace: 'startup' }, () => ({ loader: 'js', contents: `export function buildFacilitator(){return {
        getSupported:async()=>(await fetch('https://facilitator.fixture/supported')).json(),
        verify:async()=>{throw new Error('Unsigned startup test must never verify')},
        settle:async()=>{throw new Error('Unsigned startup test must never settle')}
      }}` }));
    } }] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'off', FACILITATOR_URL: 'https://facilitator.fixture' },
    outboundService: async request => {
      assert.equal(request.url, 'https://facilitator.fixture/supported');
      if (++calls === 1) {
        started(); await firstReleased;
        if (failFirst) return Response.json({ error: 'offline initialization failure' }, { status: 503 });
      }
      return Response.json(supported);
    },
  }));
  return { mf, firstStarted, release, calls: () => calls };
}

test('a stalled cold HTTP initialization does not block another quote or become a shared pending gateway', async () => {
  const f = await fixture();
  const first = f.mf.dispatchFetch('https://api.test/extract?url=https%3A%2F%2Fpublic.example');
  let firstResponse;
  try {
    await f.firstStarted;
    const second = f.mf.dispatchFetch('https://api.test/btc-fees');
    let timer;
    const outcome = await Promise.race([
      second.then(async r => { const status = r.status; await r.body?.cancel(); return status; }),
      new Promise(resolve => { timer = setTimeout(() => resolve('blocked by another request'), 1500); }),
    ]);
    clearTimeout(timer);
    f.release();
    firstResponse = await first;
    await second;
    assert.equal(outcome, 402);
    assert.equal(firstResponse.status, 402);
    assert.equal(f.calls(), 2);
    const warmed = await f.mf.dispatchFetch('https://api.test/time');
    assert.equal(warmed.status, 402); await warmed.body?.cancel();
    assert.equal(f.calls(), 2, 'only a completed HTTP gateway may be reused');
  } finally {
    f.release(); await firstResponse?.body?.cancel(); await f.mf.dispose();
  }
});

test('a failed cold gateway is discarded and the next unsigned request can initialize successfully', async () => {
  const f = await fixture({ failFirst: true });
  try {
    const first = f.mf.dispatchFetch('https://api.test/btc-fees');
    await f.firstStarted; f.release();
    const failed = await first; assert.equal(failed.status, 500); await failed.body?.cancel();
    const recovered = await f.mf.dispatchFetch('https://api.test/btc-fees');
    assert.equal(recovered.status, 402);
    assert.equal(JSON.parse(Buffer.from(recovered.headers.get('PAYMENT-REQUIRED'), 'base64')).accepts[0].amount, '2000');
    await recovered.body?.cancel();
    assert.equal(f.calls(), 2);
  } finally { f.release(); await f.mf.dispose(); }
});

test('MCP quotes initialize independently while a cold HTTP gateway is stalled', async () => {
  const f = await fixture();
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'offline-startup-isolation', version: '1' });
  const first = f.mf.dispatchFetch('https://api.test/btc-fees');
  try {
    await f.firstStarted;
    await client.connect(new StreamableHTTPClientTransport(new URL('https://api.test/mcp'), {
      fetch: async (input, init) => { const r = new Request(input, init); return f.mf.dispatchFetch(r.url, {
        method: r.method, headers: r.headers, ...(r.method === 'POST' ? { body: await r.text() } : {}),
      }); },
    }));
    const quote = await client.callTool({ name: 'extract', arguments: { url: 'https://public.example' } });
    assert.equal(quote.isError, true);
    assert.equal(JSON.parse(quote.content[0].text).accepts[0].amount, '2000');
    f.release(); const initial = await first; assert.equal(initial.status, 402); await initial.body?.cancel();
    assert.equal((await client.listTools()).tools.length, 282);
    assert.equal(f.calls(), 2, 'each transport reuses only its own completed state');
  } finally { f.release(); await client.close(); await f.mf.dispose(); }
});

test('MCP bundles serve one catalog section each and quote like /mcp', async () => {
  const f = await fixture();
  f.release();
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const fetch = async (input, init) => { const r = new Request(input, init); return f.mf.dispatchFetch(r.url, {
    method: r.method, headers: r.headers, ...(r.method === 'POST' ? { body: await r.text() } : {}),
  }); };
  const counts = {};
  try {
    for (const slug of ['prices', 'chain', 'web', 'compliance', 'ai', 'everyday', 'utilities']) {
      const client = new Client({ name: `bundle-${slug}`, version: '1' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`https://api.test/mcp/${slug}`), { fetch }));
      counts[slug] = (await client.listTools()).tools.map((t) => t.name);
      if (slug === 'web') {
        assert.ok(counts.web.includes('extract') && !counts.web.includes('base_balance'));
        const quote = await client.callTool({ name: 'extract', arguments: { url: 'https://public.example' } });
        assert.equal(JSON.parse(quote.content[0].text).accepts[0].amount, '2000');
      }
      await client.close();
    }
    const all = Object.values(counts).flat();
    assert.equal(all.length, 282, 'every tool is in exactly one bundle');
    assert.equal(new Set(all).size, 282);
    const unknown = await f.mf.dispatchFetch('https://api.test/mcp/nope', { method: 'POST' });
    assert.equal(unknown.status, 404); await unknown.body?.cancel();
  } finally { await f.mf.dispose(); }
});

test('an MCP request with a protocol version we do not support gets the spec 400, not a 500', async () => {
  const f = await fixture();
  f.release();
  const post = (version) => f.mf.dispatchFetch('https://api.test/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(version ? { 'mcp-protocol-version': version } : {}) },
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  try {
    // Health probes (mcp-health-probe, agentprobe) send the 2026-07-28 revision, which SDK 1.32 does not know.
    const future = await post('2026-07-28');
    assert.equal(future.status, 400);
    const body = await future.json();
    assert.equal(body.jsonrpc, '2.0');
    assert.match(body.error.message, /Unsupported protocol version.*2025-11-25/);
    for (const version of ['2025-06-18', undefined]) {
      const ok = await post(version);
      assert.equal(ok.status, 200, `version ${version}`); await ok.body?.cancel();
    }
  } finally { await f.mf.dispose(); }
});
