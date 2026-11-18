// 18 Nov 2026: the four tools that open vAPI topic listings now answer an HTTP call with no input at all,
// using a documented default and a note. The listing still names the input, so a router plans a real one.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('no input at all: the four vAPI front-door tools get past their input check only with the route flag', async () => {
  const T = await load('src/tools.ts');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('NET'); };
  const env = new Proxy({}, { get: () => undefined });
  const paths = ['/dns/lookup', '/ai/chat', '/transcribe', '/page/markdown'];
  try {
    for (const path of paths) {
      assert.ok(Object.hasOwn(T.EMPTY_CALL_DEFAULTS, path), `${path} has a documented empty-call default`);
      assert.match(T.EMPTY_CALL_DEFAULTS[path].note, /^No input was sent/, `${path} explains the default`);
      // No flag: the original 400 is unchanged, so a misspelled input is never silently defaulted.
      await assert.rejects(T.TOOLS[path](env, () => undefined), (e) => e.status === 400, `${path} still refuses a plain empty call`);
      // With the HTTP route's flag, the default is swapped in; the cut network fails later, not at the input check.
      await assert.rejects(T.TOOLS[path](env, (n) => (n === T.NO_INPUT ? '1' : undefined)), (e) => e.status !== 400, `${path} accepts the flagged empty call`);
      // A caller that names the main input keeps it; no note is added. Other inputs stay absent.
      const first = Object.keys(T.EMPTY_CALL_DEFAULTS[path].input)[0];
      const sent = { '/dns/lookup': 'example.org', '/ai/chat': 'Say hello.', '/transcribe': 'https://example.com/a.mp3', '/page/markdown': 'https://example.com/page' }[path];
      await assert.rejects(T.TOOLS[path](env, (n) => (n === first ? sent : undefined)), (e) => e.status !== 400, `${path} keeps a named input`);
    }
  } finally { globalThis.fetch = realFetch; }
});
