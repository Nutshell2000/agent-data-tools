// Faults found by the 11 Nov 2026 truth audit of the 59 tools whose jobs have buyers (base-bots/data/truth-audit-2026-11-11-demand.txt).
// Each case is an input the audit sent and the answer an independent source gave.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
async function load(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['cloudflare:workers'] });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}
let utils, web, intel, families;
before(async () => {
  utils = await load(require.resolve('../src/routes/utils.ts'));
  web = await load(require.resolve('../src/routes/web-checks.ts'));
  intel = await load(require.resolve('../src/routes/packs-intel.ts'));
  families = await load(require.resolve('../src/families.ts'));
});
const run = (path, params) => {
  const e = families.FAMILIES.find((x) => x.endpoint.path === path);
  assert.ok(e, path);
  return e.run({}, (n) => params[n]);
};

test('hex, decimal and named character references are decoded; keyword density no longer counts "x27"', () => {
  assert.equal(utils.htmlToText('<p>It&#x27;s caf&eacute; &mdash; &#8217;ok&#8217; &Eacute;cole &AMP; &bogus;</p>'), 'It\'s café — ’ok’ École & &bogus;');
  assert.equal(utils.decodeEntities('&#x110000; &#xD800;'), '&#x110000; &#xD800;', 'invalid code points are left as written');
  const kd = web.keywordDensity(utils.decodeEntities('it&#x27;s fine, it&#x27;s good, it&#x27;s done'), 5);
  assert.ok(!kd.keywords.some((k) => k.word === 'x27'), JSON.stringify(kd.keywords));
});

test('github.com is not GitHub Pages; a Pages site still is', () => {
  const gh = new Headers({ server: 'GitHub.com' });
  assert.ok(!intel.detectTech('<meta name="octolytics-url" content="x"><meta name="hostname" content="github.com">', gh).technologies.some((t) => t.name === 'GitHub Pages'));
  assert.ok(intel.detectTech('<html><body>docs</body></html>', gh).technologies.some((t) => t.name === 'GitHub Pages'));
});

test('/http/status knows the registered codes the audit found unlisted, and /mime the common extensions', async () => {
  for (const code of [418, 425, 451, 103, 511]) {
    const r = await run('/http/status', { code: String(code) });
    assert.notEqual(r.name, undefined, String(code));
    assert.doesNotMatch(JSON.stringify(r), /unlisted/i, String(code));
  }
  for (const [file, type] of [['a.heic', 'image/heic'], ['b.7z', 'application/x-7z-compressed'], ['index.ts', 'text/typescript']]) assert.equal((await run('/mime', { file })).mime, type);
});
