const assert = require('node:assert/strict');
const { test } = require('node:test');
const esbuild = require('esbuild');

async function load() {
  const b = await esbuild.build({ entryPoints: ['src/lib/openai-images.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('OpenAI images body: one image per request, prompt bounds, GET query', async () => {
  const lib = await load();
  assert.deepEqual(lib.toImagePrompt({ prompt: ' a red fox ', n: 1, size: '1024x1024' }), { prompt: 'a red fox' });
  assert.match(lib.toImagePrompt({ prompt: 'a red fox', n: 2 }).error, /n must be 1/);
  assert.match(lib.toImagePrompt({ prompt: 'ab' }).error, /at least 3/);
  assert.match(lib.toImagePrompt({ prompt: 'x'.repeat(801) }).error, /at most 800/);
  assert.match(lib.toImagePrompt(null).error, /JSON object/);
  assert.deepEqual(lib.imageBodyFromQuery({ prompt: 'a red fox' }), { prompt: 'a red fox' });
  assert.equal(lib.imageBodyFromQuery({}), null);
});

test('OpenAI images answer: b64_json and a data URL for clients that read url', async () => {
  const lib = await load();
  const out = lib.toOpenAiImage('a red fox', { imageBase64: 'AAAA', contentType: 'image/jpeg', model: '@cf/black-forest-labs/flux-1-schnell' });
  assert.equal(out.data.length, 1);
  assert.equal(out.data[0].b64_json, 'AAAA');
  assert.equal(out.data[0].url, 'data:image/jpeg;base64,AAAA');
  assert.equal(out.data[0].revised_prompt, 'a red fox');
  assert.equal(out.output_format, 'jpeg');
  assert.ok(Number.isInteger(out.created));
});
