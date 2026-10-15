const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
const { Hono } = require('hono');

async function load(entry, plugins = []) {
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, plugins });
  const m = new Module(entry, module);
  m.filename = entry;
  m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(built.outputFiles[0].text, entry);
  return m.exports;
}
let fetchPublic, parseTarget;
before(async () => ({ fetchPublic, parseTarget } = await load(require.resolve('../src/lib/fetch.ts'))));

test('redirect into a blocked host is rejected before a second network request', async () => {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push([String(url), options.redirect]);
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  };
  try {
    await assert.rejects(() => fetchPublic(new URL('https://public.example/start'), '*/*'), /private|loopback/);
    assert.deepEqual(calls, [['https://public.example/start', 'manual']]);
  } finally { global.fetch = original; }
});

test('relative public redirects preserve one deadline and return the final response URL', async () => {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), signal: options.signal });
    return calls.length === 1
      ? new Response(null, { status: 301, headers: { location: '/article' } })
      : new Response('article', { status: 200 });
  };
  try {
    const response = await fetchPublic(new URL('https://public.example/start'), 'text/html');
    assert.equal(await response.text(), 'article');
    assert.equal(response.url, 'https://public.example/article');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal, calls[1].signal);
  } finally { global.fetch = original; }
});

test('redirect loops stop after the bounded request count', async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: '/loop' } }); };
  try {
    await assert.rejects(() => fetchPublic(new URL('https://public.example/start'), '*/*'), /redirect/);
    assert.equal(calls, 6);
  } finally { global.fetch = original; }
});

test('target parsing rejects localhost aliases, reserved address literals and nonstandard ports', () => {
  for (const url of ['https://localhost./', 'https://127.1/', 'http://100.64.0.1/', 'http://224.1.2.3/', 'https://example.com:8443/']) {
    assert.throws(() => parseTarget(url), url);
  }
  assert.equal(parseTarget('https://example.com:443/').hostname, 'example.com');
});

test('HEAD probe drops payment, trial and marketplace credentials and cannot reach paid work', async () => {
  const { headPaymentProbe } = await load(require.resolve('../src/lib/payment-probe.ts'));
  let work = 0, trials = 0, marketplace = 0;
  const app = new Hono();
  app.get('/buy/x402-seller-kit', (c) => {
    if (c.req.header('payment-signature') || c.req.header('x-payment')) { work++; return c.json({ purchased: true }); }
    if (c.req.query('trial') === '1') { trials++; return c.json({ trial: true }); }
    if (c.req.header('x-rapidapi-proxy-secret')) { marketplace++; return c.json({ marketplace: true }); }
    return c.json({ payment: 'required' }, 402, { 'PAYMENT-REQUIRED': 'fixture-challenge' });
  });
  const request = new Request('https://example.test/buy/x402-seller-kit?trial=1', { method: 'HEAD', headers: {
    'payment-signature': 'fixture', 'x-payment': 'fixture', 'x-rapidapi-proxy-secret': 'fixture', authorization: 'fixture',
  } });
  const response = await headPaymentProbe(request, probe => app.fetch(probe));
  assert.equal(response.status, 402);
  assert.equal(response.headers.get('PAYMENT-REQUIRED'), 'fixture-challenge');
  assert.equal(await response.text(), '');
  assert.deepEqual([work, trials, marketplace], [0, 0, 0]);
});

test('browser redirects and subresources are guarded before rendering; browser always closes', async () => {
  const plugin = { name: 'browser-fixture', setup(build) {
    build.onResolve({ filter: /^@cloudflare\/puppeteer$/ }, () => ({ path: 'browser', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export default { launch: async () => globalThis.__auditBrowser };', loader: 'js' }));
  } };
  const { screenshot } = await load(require.resolve('../src/routes/screenshot.ts'), [plugin]);
  const original = global.__auditBrowser;
  try {
    for (const blockNavigation of [true, false]) {
      let handler, closed = 0, captured = 0;
      const requests = [];
      const frame = {};
      const page = {
        setRequestInterception: async value => assert.equal(value, true),
        on: (event, callback) => { assert.equal(event, 'request'); handler = callback; },
        mainFrame: () => frame, setViewport: async () => {},
        goto: async () => {
          const request = { url: () => 'http://127.0.0.1/private', isNavigationRequest: () => blockNavigation, frame: () => frame,
            abort: async () => { requests.push('aborted'); }, continue: async () => { requests.push('continued'); } };
          handler(request);
          if (blockNavigation) throw new Error('navigation blocked');
          return { status: () => 200 };
        },
        url: () => 'https://public.example/', title: async () => 'fixture',
        screenshot: async () => { captured++; return Buffer.from('fixture'); },
      };
      global.__auditBrowser = { newPage: async () => page, close: async () => { closed++; } };
      if (blockNavigation) {
        await assert.rejects(() => screenshot({ BROWSER: {} }, 'https://public.example/'), /blocked URL/);
        assert.equal(captured, 0);
      } else {
        const result = await screenshot({ BROWSER: {} }, 'https://public.example/');
        assert.equal(result.finalUrl, 'https://public.example/');
        assert.equal(captured, 1);
      }
      assert.deepEqual(requests, ['aborted']);
      assert.equal(closed, 1);
    }
  } finally { global.__auditBrowser = original; }
});
