const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { build, transform } = require('esbuild');
const vm = require('node:vm');
const { readFile } = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
let readerCommands;
before(async () => {
  const built = await build({ entryPoints: ['src/guides/reader-commands.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, mod, mod.exports);
  readerCommands = mod.exports.readerCommands;
});
const origin = 'https://agent-data-tools.revmesh2074.workers.dev';

test('command builder validates public URLs, options and bounded limits before exposing commands', () => {
  for (const url of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'http://localhost/', 'http://127.1/', 'https://user:secret@example.com/', 'https://example.com:444/', 'https://example.com/\nsecret']) assert.throws(() => readerCommands(origin, url));
  for (const limit of ['499', '100001', '20000; echo bad', '1e4', '1000.5']) assert.throws(() => readerCommands(origin, 'https://example.com', 'markdown', limit));
  assert.throws(() => readerCommands(origin, 'https://example.com', 'html'));
  const result = readerCommands(origin, 'https://example.com');
  assert.match(result.buyCommand, /--max-usdc 0.002 --format markdown --max-chars 20000$/);
  const quote = new URL(result.quoteUrl);
  assert.equal(quote.origin, origin); assert.equal(quote.pathname, '/extract');
  assert.equal(quote.searchParams.get('url'), 'https://example.com/');
  assert.equal(quote.searchParams.get('format'), 'markdown');
});

test('POSIX and PowerShell commands preserve hostile shell characters as a single URL argument', async () => {
  const target = `https://example.com/docs'part?q=';echo INJECTION;#&a=$(echo INJECTION)&b=\`echo INJECTION\`&c="<&x=>`;
  const expected = new URL(target).href;
  const section = `id';echo INJECTION;$(echo INJECTION)&<tag>日`;
  for (const shell of ['posix', 'powershell']) {
    const command = readerCommands(origin, target, 'both', '500', shell, section).buyCommand;
    let result;
    if (shell === 'posix') {
      result = await promisify(execFile)('bash', ['-c', `node(){ printf '%s\\0' "$@"; }; ${command}`]);
      const args = result.stdout.split('\0').slice(0, -1);
      assert.deepEqual(args, ['reader-client.mjs', 'buy', expected, '--max-usdc', '0.002', '--format', 'both', '--max-chars', '500', '--section', section]);
    } else {
      const script = `function node { @($args) | ConvertTo-Json -Compress }; ${command}`;
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      try { result = await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]); }
      catch (error) { if (error.code === 'ENOENT' && process.platform !== 'win32') continue; throw error; }
      assert.deepEqual(JSON.parse(result.stdout).map(String), ['reader-client.mjs', 'buy', expected, '--max-usdc', '0.002', '--format', 'both', '--max-chars', '500', '--section', section]);
    }
    assert.equal(result.stderr, '');
  }
});

test('actual browser bundle updates text locally, clears invalid commands and never fetches or accepts keys', async () => {
  const elements = new Map();
  const ids = ['reader-url', 'reader-format', 'reader-limit', 'reader-shell', 'reader-section', 'reader-quote-link', 'reader-builder-error', 'reader-builder-output', 'reader-quote-command', 'reader-buy-command'];
  for (const id of ids) elements.set(id, { value: '', textContent: '', hidden: false, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; }, removeAttribute(name) { delete this[name]; } });
  elements.get('reader-url').value = 'https://example.com'; elements.get('reader-format').value = 'markdown';
  elements.get('reader-limit').value = '20000'; elements.get('reader-shell').value = 'posix';
  const panel = { dataset: { origin }, querySelectorAll: () => [] }; elements.set('reader-builder', panel);
  for (const el of elements.values()) Object.defineProperty(el, 'innerHTML', { set() { throw Error('HTML injection sink'); } });
  const context = { URL, URLSearchParams, document: { getElementById: id => elements.get(id) }, navigator: {}, fetch() { throw Error('Unexpected request'); } };
  const code = await readFile('public/clients/reader/1.7.5/command-builder.js', 'utf8');
  vm.runInNewContext((await transform(code, { format: "iife" })).code, context);
  assert.equal(elements.get('reader-builder-output').hidden, false);
  elements.get('reader-url').value = 'https://example.com/?q=<img src=x onerror=alert(1)>';
  elements.get('reader-url').listeners.input();
  assert.match(elements.get('reader-buy-command').textContent, /%3Cimg/);
  elements.get('reader-url').value = 'javascript:alert(1)'; elements.get('reader-url').listeners.input();
  assert.equal(elements.get('reader-builder-output').hidden, true);
  assert.equal(elements.get('reader-buy-command').textContent, '');
  assert.equal(elements.get('reader-quote-link').href, undefined);
  assert.ok(elements.get('reader-builder-error').textContent);
  assert.doesNotMatch(code, /localStorage|sessionStorage|createPaymentPayload|privateKeyToAccount|XMLHttpRequest/);
});
