const assert = require('node:assert/strict');
const { test } = require('node:test');

const load = () => import('../clients/agent-data-tools/index.mjs');
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const API = { paths: { '/weather': { get: { operationId: 'weather', summary: 'Weather forecast', description: 'Current weather by city', 'x-payment-info': { price: { amount: '0.01' } }, parameters: [{ in: 'query', name: 'city', required: true, schema: { type: 'string' }, description: 'City' }, { in: 'header', name: 'x', schema: { type: 'string' } }] } }, '/status': { get: { operationId: 'status' } } } };

function withCatalog(fn) { const real = globalThis.fetch; globalThis.fetch = async (...a) => (String(a[0]).endsWith('/openapi.json') ? json(200, API) : real(...a)); return fn().finally(() => { globalThis.fetch = real; }); }

test('npm client: free trial without setup, the key as a header, a paying fetch untouched', async () => {
  const { AgentDataTools } = await load();
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init }); return json(200, { ok: true }); };
  const real = globalThis.fetch; globalThis.fetch = f;
  try {
    const free = new AgentDataTools({ apiKey: undefined });
    free.apiKey = undefined;
    assert.deepEqual(await free.call('/weather', { city: 'London', skip: undefined }), { ok: true });
    assert.equal(seen[0].url, 'https://agent-data-tools.revmesh2074.workers.dev/weather?city=London&trial=1');
    assert.equal(seen[0].init.headers.authorization, undefined);
  } finally { globalThis.fetch = real; }
  seen.length = 0;
  const keyed = new AgentDataTools({ apiKey: 'adt_x', fetch: f, origin: 'https://api.test/' });
  await keyed.call('/weather', { city: 'Oslo' });
  assert.equal(seen[0].url, 'https://api.test/weather?city=Oslo');
  assert.equal(seen[0].init.headers.authorization, 'Bearer adt_x');
  seen.length = 0;
  const paying = new AgentDataTools({ fetch: f }); paying.apiKey = undefined;
  await paying.call('/weather', { city: 'Oslo' });
  assert.ok(!seen[0].url.includes('trial='));
});

test('npm client: long inputs go as a JSON body; 402 and other failures throw with what the caller needs', async () => {
  const { AgentDataTools, PaymentRequired, ToolError } = await load();
  let got;
  const client = new AgentDataTools({ apiKey: 'adt_x', fetch: async (url, init) => { got = { url, init }; return json(200, { saved: true }); } });
  await client.call('/page/publish', { html: 'x'.repeat(7000) });
  assert.equal(got.url, 'https://agent-data-tools.revmesh2074.workers.dev/page/publish');
  assert.equal(got.init.method, 'POST');
  assert.equal(JSON.parse(got.init.body).html.length, 7000);
  const quoted = new AgentDataTools({ apiKey: 'adt_x', fetch: async () => json(402, { accepts: [{ amount: '10000' }] }) });
  await assert.rejects(quoted.call('/image', {}), (e) => e instanceof PaymentRequired && e.priceUsd === 0.01 && e.buyUrl.endsWith('/credits') && e.status === 402);
  const failing = new AgentDataTools({ apiKey: 'adt_x', fetch: async () => json(422, { error: 'no such page' }) });
  await assert.rejects(failing.call('/extract', {}), (e) => e instanceof ToolError && e.status === 422 && /no such page/.test(e.message));
});

test('npm client: catalog from OpenAPI, names resolve to paths, OpenAI definitions carry the required inputs', () => withCatalog(async () => {
  const { AgentDataTools, ToolError } = await load();
  let url;
  const adt = new AgentDataTools({ apiKey: 'adt_x', fetch: async (u) => { url = u; return json(200, {}); } });
  const tools = await adt.tools();
  assert.deepEqual(tools.map((t) => [t.name, t.path, t.price]), [['weather', '/weather', '$0.01']]);
  assert.deepEqual(tools[0].params.map((p) => p.name), ['city']);
  assert.equal((await adt.tools({ search: 'weather CITY' })).length, 1);
  assert.equal((await adt.tools({ search: 'pdf' })).length, 0);
  await adt.call('weather', { city: 'Rome' });
  assert.ok(url.endsWith('/weather?city=Rome'));
  await assert.rejects(adt.call('nope'), (e) => e instanceof ToolError && e.status === 404);
  const [def] = await adt.openAiTools(['weather']);
  assert.equal(def.function.name, 'weather');
  assert.deepEqual(def.function.parameters.required, ['city']);
  assert.equal(def.function.parameters.properties.city.type, 'string');
}));

test('npm client buyer docs state the real 3-HTTP / 25-MCP free split, not a bare 25', async () => {
  const { readFileSync } = require('node:fs');
  const dir = 'clients/agent-data-tools/';
  const files = ['package.json', 'README.md', 'cli.mjs', 'index.mjs'];
  for (const file of files) {
    const text = readFileSync(dir + file, 'utf8');
    // The npm client adds trial=1 to keyless HTTP calls, and the live server gives only 3 such calls. A bare
    // "25 free calls" promised a call the buyer never gets. Every buyer-facing string must now carry the split.
    assert.ok(!/(?:25 free calls|25 successful calls per caller|gives 25 free calls|holds no payment or wallet code)/.test(text), `${file}: no bare 25-free claim`);
  }
  const pkg = JSON.parse(readFileSync(dir + 'package.json', 'utf8'));
  assert.match(pkg.description, /3 free HTTP calls \(25 over MCP\)/);
  const readme = readFileSync(dir + 'README.md', 'utf8');
  assert.match(readme, /3 free calls over HTTP \(25 over MCP\)/);
  assert.match(readme, /3 successful calls per caller over HTTP, 25 over MCP/);
});

test('MCP registry advertises the npm client version this repo builds', () => {
  const { readFileSync } = require('node:fs');
  const npmVersion = JSON.parse(readFileSync('clients/agent-data-tools/package.json', 'utf8')).version;
  const registry = JSON.parse(readFileSync('server.json', 'utf8'));
  const npmPackage = registry.packages.find((p) => p.registryType === 'npm' && p.identifier === 'agent-data-tools');
  assert.ok(npmPackage, 'server.json declares the npm package');
  assert.equal(npmPackage.version, npmVersion, 'the registry pointer must match the built client version');
  assert.equal(npmVersion, '1.4.1', 'the published npm client version');
});
