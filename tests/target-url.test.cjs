// src/lib/target-url.ts: a target URL whose own query was cut at "&" gets the rest of its query back.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { build } = require('esbuild');

let cached;
async function load() {
  if (cached) return cached;
  const b = await build({ entryPoints: ['src/lib/target-url.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return (cached = m.exports);
}
const ours = (n) => ['url', 'question', 'maxChars', 'format', 'only', 'trial', 'sample'].includes(n);
const run = async (query) => (await load()).rejoinedTargetUrl(new URL(`https://api.test/describe?${query}`).searchParams, ours);

test('the cut-off tail of a target query is put back, in order, encoded', async () => {
  assert.equal(await run('url=https://cdn.example/img.jpg?w=600&q=80&sig=a%2Bb%3D'), 'https://cdn.example/img.jpg?w=600&q=80&sig=a%2Bb%3D');
  assert.equal(await run('url=https://cdn.example/img.jpg?w=600&h=400&question=What+is+this'), 'https://cdn.example/img.jpg?w=600&h=400', 'our own input is not moved');
  assert.equal(await run('question=x&url=https://a.example/p?id=1&page=2'), 'https://a.example/p?id=1&page=2');
});

test('nothing changes when the target has no query, is encoded, or nothing unknown follows it', async () => {
  assert.equal(await run('url=https://cdn.example/img.jpg&q=80'), 'https://cdn.example/img.jpg', 'no "?" in the target: the unknown input is not its query');
  assert.equal(await run('url=https%3A%2F%2Fcdn.example%2Fimg.jpg%3Fw%3D600%26q%3D80'), 'https://cdn.example/img.jpg?w=600&q=80', 'an encoded target arrives whole already');
  assert.equal(await run('url=https://cdn.example/img.jpg?w=600&maxChars=500&trial=1'), 'https://cdn.example/img.jpg?w=600');
  assert.equal(await run('utm=1&url=https://cdn.example/img.jpg?w=600'), 'https://cdn.example/img.jpg?w=600', 'what comes before url is not its tail');
  assert.equal(await run('url=https://cdn.example/p?a=1%23frag&b=2'), 'https://cdn.example/p?a=1#frag', 'a target with a fragment is left as sent');
  assert.equal(await run('question=x'), undefined);
  assert.equal(await run('url=ftp://x/y?a=1&b=2'), 'ftp://x/y?a=1', 'not an http target: left for the tool to refuse');
});

test('a tool path written another way has one plain form; a plain or impossible path has none', async () => {
  const { plainToolPath } = await load();
  for (const [sent, plain] of [['/btc-fees/', '/btc-fees'], ['/BTC-FEES', '/btc-fees'], ['//weather', '/weather'], ['/weather.json', '/weather'], ['/Pack//URL-Safety/', '/pack/url-safety'], ['/weather///', '/weather']]) assert.equal(plainToolPath(sent), plain, sent);
  for (const sent of ['/btc-fees', '/', '//', '/weather%3Fcity', '/a b', '/' + 'x'.repeat(250) + '/']) assert.equal(plainToolPath(sent), undefined, sent);
});

test('the URL-safety pack and its entry path read the URL exactly as sent', () => {
  const source = readFileSync('src/index.ts', 'utf8');
  const set = source.match(/const TARGET_URL_AS_SENT: ReadonlySet<string> = new Set\(\[([^\]]+)\]\)/)[1];
  for (const p of ['/pack/url-safety', '/url/safety-check']) assert.ok(set.includes(`"${p}"`), p);
});
