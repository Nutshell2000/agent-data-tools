const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const esbuild = require('esbuild');
const Module = require('node:module');

// A page that is missing, gone or forbidden is the caller's input (422, never counted as our server error);
// rate limits, timeouts and the target's own 5xx remain upstream failures (502).
async function loadTypeScript(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const loaded = new Module(entry, module);
  loaded.filename = entry;
  loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(result.outputFiles[0].text, entry);
  return loaded.exports;
}

let fetchPublic;
const realFetch = globalThis.fetch;
before(async () => { ({ fetchPublic } = await loadTypeScript('src/lib/fetch.ts')); });
after(() => { globalThis.fetch = realFetch; });

for (const [upstream, expected] of [[404, 422], [403, 422], [410, 422], [401, 422], [429, 502], [408, 502], [500, 502], [503, 502]]) {
  test(`a target answering ${upstream} becomes ${expected}`, async () => {
    globalThis.fetch = async () => new Response('x', { status: upstream });
    await assert.rejects(fetchPublic(new URL('https://example.org/a.pdf'), 'application/pdf'), (err) => {
      assert.equal(err.status, expected);
      assert.match(err.message, new RegExp(`HTTP ${upstream}`));
      if (expected === 422) assert.match(err.message, /nothing was charged/);
      return true;
    });
  });
}

test('an allowed status is still returned, not thrown', async () => {
  globalThis.fetch = async () => new Response('pay', { status: 402 });
  const res = await fetchPublic(new URL('https://example.org/x'), 'application/json', [402]);
  assert.equal(res.status, 402);
});
