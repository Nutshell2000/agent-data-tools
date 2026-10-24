const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let A;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/agent-infra.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  A = m.exports;
});

test('OpenAPI summary: operations, methods, auth, paid and deprecated flags; Swagger 2 servers; refuses non-specs', () => {
  const s = A.summariseSpec({ openapi: '3.1.0', info: { title: 'T', version: '2' }, servers: [{ url: 'https://api.test' }],
    components: { securitySchemes: { key: { type: 'apiKey', in: 'header' } } },
    paths: { '/a': { get: { summary: 'A', operationId: 'getA', tags: ['x'] }, post: { deprecated: true, responses: { 402: {} } } }, '/b': { get: { 'x-payment-info': {} } } } });
  assert.equal(s.operationCount, 3);
  assert.deepEqual(s.byMethod, { GET: 2, POST: 1 });
  assert.equal(s.paidOperations, 2);
  assert.equal(s.deprecatedOperations, 1);
  assert.deepEqual(s.auth, [{ name: 'key', type: 'apiKey', scheme: null, in: 'header' }]);
  const sw = A.summariseSpec({ swagger: '2.0', host: 'h.test', basePath: '/v1', schemes: ['https'], paths: {} });
  assert.deepEqual(sw.servers, ['https://h.test/v1']);
  assert.throws(() => A.summariseSpec({ hello: 1 }), (e) => e.status === 422);
});

test('MCP answers: plain JSON and server-sent events', () => {
  assert.equal(A.rpcResult('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}').result.ok, true);
  assert.equal(A.rpcResult('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n').result.tools.length, 0);
  assert.equal(A.rpcResult('<html>nope</html>'), null);
});

test('targets are checked before any request; names stay within 32 characters', async () => {
  for (const path of ['/openapi/summary', '/mcp/inspect', '/pack/api-health']) {
    const e = A.AGENT_INFRA.find((f) => f.endpoint.path === path);
    await assert.rejects(Promise.resolve().then(() => e.run({}, (n) => (n === 'url' ? 'http://127.0.0.1/x' : undefined))), (err) => err.status === 400, path);
    assert.ok(e.endpoint.summary.split(':')[0].length <= 32, e.endpoint.summary);
  }
});
