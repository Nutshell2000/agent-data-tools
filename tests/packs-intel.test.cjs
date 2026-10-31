const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { build } = require('esbuild');

let P;
before(async () => {
  const b = await build({ entryPoints: ['src/routes/packs-intel.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  P = m.exports;
});

test('tech stack: headers, generator tags, cookies and page fingerprints; each technology once', () => {
  const html = '<html><head><meta name="generator" content="WordPress 6.6"><script src="/wp-includes/js/jquery/jquery.min.js"></script>'
    + '<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script><script src="https://js.stripe.com/v3/"></script></head></html>';
  const headers = new Headers({ server: 'nginx', 'cf-ray': '8a-ARN', 'set-cookie': 'PHPSESSID=abc; path=/, wp-settings-1=x; path=/' });
  const r = P.detectTech(html, headers);
  const names = r.technologies.map((t) => t.name);
  for (const n of ['WordPress', 'jQuery', 'Google Analytics', 'Stripe', 'Cloudflare', 'Nginx', 'PHP']) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length);
  assert.equal(r.generator, 'WordPress 6.6');
  assert.match(r.technologies.find((t) => t.name === 'WordPress').evidence, /^header|^generator/);
  assert.deepEqual(r.byCategory['Web servers'], ['Nginx']);
});

test('tech stack: brand names in page copy are not fingerprints', () => {
  const r = P.detectTech('<p>Pay later with Klarna. Support by Zendesk. Analytics by PostHog.</p>', new Headers());
  assert.deepEqual(r.technologies, []);
});

test('EVM toolbox: addresses, signatures, calldata, bytes32, numbers and text', () => {
  const a = P.evmToolbox('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
  assert.equal(a.kind, 'address');
  assert.equal(a.checksummed, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  assert.equal(a.checksumValid, null);
  assert.equal(P.evmToolbox('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045').checksumValid, true);
  assert.equal(P.evmToolbox('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96046').checksumValid, false);
  const s = P.evmToolbox('event Transfer(address indexed from, address indexed to, uint256 value)'.replace(/ indexed| from| to| value/g, ''));
  assert.equal(s.eventTopic, '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
  assert.equal(P.evmToolbox('transfer(address,uint256)').functionSelector, '0xa9059cbb');
  const cd = P.evmToolbox('0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000989680');
  assert.equal(cd.kind, 'calldata');
  assert.equal(cd.decode.function, 'transfer(address,uint256)');
  assert.equal(cd.decode.args[1].value, '10000000');
  const b = P.evmToolbox('0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045');
  assert.equal(b.kind, 'bytes32');
  assert.equal(b.asAddress, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  const n = P.evmToolbox('1000000000000000000');
  assert.equal(n.wei.ether, '1');
  assert.equal(n.hex, '0xde0b6b3a7640000');
  assert.equal(P.evmToolbox('1.5', 6).baseUnits, '1500000');
  assert.equal(P.evmToolbox('hello').keccak256, '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8');
  assert.throws(() => P.evmToolbox('1' + '0'.repeat(80)), (e) => e.status === 400);
});

test('mail provider from MX hosts', () => {
  assert.equal(P.mailProvider(['aspmx.l.google.com']), 'Google Workspace');
  assert.equal(P.mailProvider(['contoso-com.mail.protection.outlook.com']), 'Microsoft 365');
  assert.equal(P.mailProvider(['mx1.example.net']), 'self-hosted or other');
  assert.equal(P.mailProvider([]), null);
});

test('inputs are checked before any request; names stay within 32 characters; packs cost $0.03', async () => {
  const run = (path, inputs) => P.PACKS_INTEL.find((e) => e.endpoint.path === path).run({}, (n) => inputs[n]);
  await assert.rejects(Promise.resolve().then(() => run('/tech/stack', { url: 'http://127.0.0.1/' })), (e) => e.status === 400);
  await assert.rejects(Promise.resolve().then(() => run('/pack/seo-toolkit', { url: 'ftp://example.com/' })), (e) => e.status === 400);
  await assert.rejects(Promise.resolve().then(() => run('/pack/domain-intel', { domain: 'not a domain' })), (e) => e.status === 400);
  for (const e of P.PACKS_INTEL) {
    assert.ok(e.endpoint.summary.split(':')[0].length <= 32, e.endpoint.summary);
    assert.ok(e.endpoint.description.length <= 450, e.endpoint.path);
    if (e.endpoint.path.startsWith('/pack/')) assert.equal(e.endpoint.price, '$0.03', e.endpoint.path);
  }
});
