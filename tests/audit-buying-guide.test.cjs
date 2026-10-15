const assert = require('node:assert/strict');
const Module = require('node:module');
const vm = require('node:vm');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
let guide;
before(async () => {
  const entry = require.resolve('../src/guides/dependency-audit.ts');
  const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false });
  const loaded = new Module(entry, module); loaded.filename = entry; loaded.paths = Module._nodeModulePaths(process.cwd());
  loaded._compile(built.outputFiles[0].text, entry); guide = loaded.exports;
});
const origin = 'https://api.example.test', recipient = '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5';
const quote = { scheme: 'exact', network: 'eip155:8453', payTo: recipient, asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', amount: '200000' };
const decode = s => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

test('HTML and machine guide contain the same current, compilable client and free quote URL', async () => {
  const html = guide.auditGuideHtml(origin, recipient), markdown = guide.auditGuideMarkdown(origin, recipient);
  const htmlClient = decode(html.match(/<pre class="audit-client"><code>([\s\S]*?)<\/code><\/pre>/)[1]);
  const markdownClient = markdown.match(/```typescript\n([\s\S]*?)\n```/)[1];
  assert.equal(htmlClient, markdownClient);
  assert.equal(htmlClient, guide.auditBuyingGuide(origin, recipient).client);
  assert.match(htmlClient, /maxUsdcAtomic = 200000n/);
  assert.match(html, /Opening it does not pay or run an audit/);
  assert.match(markdown, /Repeated|repeated invocations can each incur a charge/);
  const request = new URL(guide.auditBuyingGuide(origin, recipient).request);
  assert.equal(request.pathname, '/package-audit');
  assert.equal(request.searchParams.get('packages'), 'npm:express@4.21.2,pypi:requests@2.32.3');
  assert.equal(request.searchParams.has('trial'), false);
  assert.doesNotMatch(htmlClient, /0x[0-9a-fA-F]{64}/);
  await esbuild.transform(htmlClient, { loader: 'ts', target: 'es2022', format: 'esm' });
});

async function executeExample(offeredQuote) {
  const source = guide.auditBuyingGuide(origin, recipient).client;
  const lines = source.split('\n'), imports = lines.filter(l => l.startsWith('import '));
  const body = lines.filter(l => !l.startsWith('import '));
  const compiled = await esbuild.transform(imports.join('\n') + '\nexport async function run(){\n' + body.join('\n') + '\n}', { loader: 'ts', target: 'es2022', format: 'cjs' });
  const calls = [], output = [], controls = [];
  class Client {
    register() { return this; }
    setSpendControls(value) { controls.push(value); return this; }
    registerPolicy(policy) { this.policy = policy; return this; }
  }
  // This sandbox has no signing implementation, real wallet or network transport.
  const sandbox = { module: { exports: {} }, URL, process: { env: { X402_PRIVATE_KEY: '0x' + '1'.repeat(64) } },
    console: { log: value => output.push(value) },
    fetch: async url => { calls.push(String(url)); return { ok: true, json: async () => ({ checked: 2, summary: 'fixture only' }) }; },
    require(name) {
      if (name === '@x402/evm') return { ExactEvmScheme: class {} };
      if (name === 'viem/accounts') return { privateKeyToAccount: () => ({ address: 'fixture-with-no-signer' }) };
      if (name === '@x402/fetch') return { x402Client: Client, wrapFetchWithPayment: (transport, client) => async url => {
        if (!client.policy(2, [offeredQuote]).length) throw new Error('quote refused');
        return transport(url);
      } };
      throw new Error('Unexpected dependency');
    },
  };
  vm.runInNewContext(compiled.code, sandbox);
  return { run: () => sandbox.module.exports.run(), calls, output, controls };
}

test('the published example accepts its exact price and makes one mocked audit request', async () => {
  const fixture = await executeExample(quote);
  await fixture.run();
  assert.equal(fixture.calls.length, 1);
  assert.equal(new URL(fixture.calls[0]).pathname, '/package-audit');
  assert.equal(fixture.controls[0].maxAmountPerPayment, '$0.20');
  assert.equal(fixture.output[0].checked, 2);
});

test('the published example refuses excess price, wrong recipient, asset, network and malformed amounts', async () => {
  for (const change of [{ amount: '200001' }, { amount: '0.20' }, { payTo: '0x' + '9'.repeat(40) },
    { network: 'eip155:1' }, { asset: '0x' + '9'.repeat(40) }, { scheme: 'different' }]) {
    const fixture = await executeExample({ ...quote, ...change });
    await assert.rejects(() => fixture.run(), /quote refused/);
    assert.equal(fixture.calls.length, 0);
  }
});
