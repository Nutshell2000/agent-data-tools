// Safety fixes of 21 Nov 2026, the parts that are plain functions: address buckets for free calls, the address ranges
// a fetch tool refuses, keys that travel in a URL, and the hosted-page sanitiser's dropped subtrees. No network.
const assert = require('node:assert/strict');
const Module = require('node:module');
const { before, test } = require('node:test');
const esbuild = require('esbuild');
async function load(entry) {
  const result = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(result.outputFiles[0].text, entry); return m.exports;
}
let free, fetchLib, urlKeys, headers, pages, funnel;
before(async () => {
  free = await load(require.resolve('../src/lib/free-calls.ts'));
  fetchLib = await load(require.resolve('../src/lib/fetch.ts'));
  urlKeys = await load(require.resolve('../src/lib/url-keys.ts'));
  headers = await load(require.resolve('../src/lib/response-headers.ts'));
  pages = await load(require.resolve('../src/routes/pages.ts'));
  funnel = await load(require.resolve('../src/lib/funnel.ts'));
});

test('addressBucket: one bucket per IPv4 address and per IPv6 /64, whatever way the address is written', async () => {
  const table = [
    // input, bucket
    ['203.0.113.7', '203.0.113.7'],
    [' 203.0.113.7 ', '203.0.113.7'],
    ['', 'unknown'],
    [undefined, 'unknown'],
    ['unknown', 'unknown'],
    // An IPv4 address written inside IPv6 is that IPv4 address, in every spelling.
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['::ffff:cb00:7107', '203.0.113.7'],
    ['0:0:0:0:0:ffff:cb00:7107', '203.0.113.7'],
    ['0000:0000:0000:0000:0000:ffff:203.0.113.7', '203.0.113.7'],
    ['[::ffff:203.0.113.7]', '203.0.113.7'],
    ['::ffff:10.0.0.1', '10.0.0.1'],
    // Leading zeros and letter case do not make a second caller.
    ['2001:db8::1', '2001:db8:0:0'],
    ['2001:0db8::1', '2001:db8:0:0'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8:0:0'],
    ['2001:db8:0:0:0:0:0:1', '2001:db8:0:0'],
    // "::" in every place.
    ['::1', '0:0:0:0'],
    ['::', '0:0:0:0'],
    ['2001:db8:1:2::', '2001:db8:1:2'],
    ['2001:db8:1:2::9', '2001:db8:1:2'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2'],
    ['2601:646:100::1', '2601:646:100:0'],
    ['2601:646:100:0:0:0:0:1', '2601:646:100:0'],
    ['2001:db8::1:2:3:4:5', '2001:db8:0:1'],
    ['fe80::1%eth0', 'fe80:0:0:0'],
    ['[2001:db8:1:2::9]', '2001:db8:1:2'],
    // A dotted tail that is not the IPv4-in-IPv6 form is two ordinary groups.
    ['64:ff9b::203.0.113.7', '64:ff9b:0:0'],
    // A bucket is its own bucket.
    ['2001:db8:1:2', '2001:db8:1:2'],
  ];
  for (const [input, bucket] of table) assert.equal(free.addressBucket(input), bucket, String(input));
  // Text that is not an address stays what it was: it is never folded into somebody else's bucket.
  for (const odd of ['1::2::3', '2001:db8:::1', 'g001:db8::1', '1:2:3:4:5:6:7:8:9', '12345::1', '::ffff:999.1.1.1', '1:2:3:4:5:6:7::8']) assert.equal(free.addressBucket(odd), odd, odd);
  // Different /64s and different IPv4 addresses stay different.
  assert.notEqual(free.addressBucket('2001:db8:1:2::1'), free.addressBucket('2001:db8:1:3::1'));
  assert.notEqual(free.addressBucket('::ffff:203.0.113.7'), free.addressBucket('::ffff:203.0.113.8'));
  assert.notEqual(free.addressBucket('::ffff:203.0.113.7'), free.addressBucket('::1'), 'not the all-zero /64');

  // The caller hash follows the bucket.
  const h = free.callerHash;
  assert.equal(await h('::ffff:203.0.113.7'), await h('203.0.113.7'), 'IPv4 inside IPv6 is the IPv4 caller');
  assert.equal(await h('2001:0db8:0001:0002::1'), await h('2001:db8:1:2:ffff::9'));
  assert.equal(await h('2001:db8::1'), await h('2001:0db8:0:0:1::'));
  assert.notEqual(await h('2001:db8:1:2::1'), await h('2001:db8:1:3::1'));
  assert.notEqual(await h('203.0.113.7'), await h('203.0.113.8'));
  assert.notEqual(await h('unknown'), await h('::'));
});

test('parseTarget: every non-public IPv4 range is refused, and the numeric rules apply to address literals only', () => {
  const { parseTarget, nonPublicIpv4 } = fetchLib;
  const refused = [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.9.9.9',
    '100.64.0.1', '100.127.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '192.0.0.1', '192.0.0.170', '192.0.2.1', '192.0.2.255', '198.51.100.1', '198.51.100.200', '203.0.113.1', '203.0.113.99',
    '198.18.0.1', '198.19.255.255', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
  ];
  for (const ip of refused) {
    assert.throws(() => parseTarget(`http://${ip}/`), /private, loopback/, ip);
    assert.equal(nonPublicIpv4(ip.split('.').map(Number)), true, ip);
  }
  // Other spellings of an address are the same address once the URL is parsed.
  for (const url of ['http://127.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://017700000001/', 'http://0xC0000201/', 'http://192.0.2.1./', 'http://[::1]/', 'http://[::ffff:10.0.0.1]/', 'http://localhost/', 'http://a.localhost/', 'http://printer.local/', 'http://db.internal/', 'http://intranet/']) {
    assert.throws(() => parseTarget(url), /private, loopback/, url);
  }
  // Public addresses next to each range stay reachable.
  const allowed = ['1.1.1.1', '8.8.8.8', '9.255.255.255', '11.0.0.1', '100.63.255.255', '100.128.0.1', '126.255.255.255', '128.0.0.1', '169.253.1.1', '169.255.1.1', '172.15.255.255', '172.32.0.1',
    '192.0.1.1', '192.0.3.1', '192.167.1.1', '192.169.1.1', '198.17.255.255', '198.20.0.1', '198.51.99.1', '198.51.101.1', '203.0.112.1', '203.0.114.1', '223.255.255.255'];
  for (const ip of allowed) {
    assert.equal(parseTarget(`https://${ip}/x`).hostname, ip, ip);
    assert.equal(nonPublicIpv4(ip.split('.').map(Number)), false, ip);
  }
  // A public NAME that starts like a private address is a name (before: refused by a pattern meant for addresses).
  for (const name of ['10.example.com', '0.example.org', '127.example.net', '169.254.example.com', '192.168.example.com', '172.16.example.com', '10.0.0.1.example.com', '192.0.2.example.com', '240.example.com', '10.com', '1.2.3.4.5.example']) {
    assert.equal(parseTarget(`https://${name}/`).hostname, name, name);
  }
  // The rules that are not about addresses are as before.
  assert.throws(() => parseTarget('ftp://example.com/'), /only http and https/);
  assert.throws(() => parseTarget('https://user:pw@example.com/'), /credentials/);
  assert.throws(() => parseTarget('https://example.com:8443/'), /standard HTTP and HTTPS ports/);
  assert.throws(() => parseTarget(undefined), /missing required/);
});

test('keys in a URL: cut short in anything logged or counted, and the answer forbids a referrer', () => {
  const key = 'adt_' + 'Ab3'.repeat(14);
  const { redactKeys, urlCarriesKey, keylessPath, loggable } = urlKeys;
  assert.equal(redactKeys(`GET https://api.test/uuid?count=1&api_key=${key}&x=1`), 'GET https://api.test/uuid?count=1&api_key=adt_Ab…&x=1');
  assert.equal(redactKeys(`https://api.test/mcp/k/${key}/web`), 'https://api.test/mcp/k/adt_Ab…/web');
  assert.equal(redactKeys(`${key} and ${key}`), 'adt_Ab… and adt_Ab…');
  assert.equal(redactKeys('nothing here: adtok_x adtc_y adt_short'), 'nothing here: adtok_x adtc_y adt_short');
  assert.ok(!redactKeys(`x ${key} y`).includes(key.slice(0, 7)));

  assert.equal(keylessPath(`/mcp/k/${key}`), '/mcp/k/key');
  assert.equal(keylessPath(`/mcp/k/${key}/web`), '/mcp/k/key/web');
  assert.equal(keylessPath('/mcp/web'), '/mcp/web');
  assert.equal(keylessPath('/uuid'), '/uuid');

  for (const url of [`https://api.test/uuid?api_key=${key}`, `https://api.test/uuid?count=2&apikey=${key}`, `https://api.test/x?key=${key}`, `https://api.test/mcp/k/${key}`, `https://api.test/mcp/k/${key}/web`, `https://api.test/mcp/k/not-a-key`, `/uuid?api_key=${key}`]) assert.equal(urlCarriesKey(url), true, url);
  for (const url of ['https://api.test/uuid?count=1', 'https://api.test/mcp', 'https://api.test/mcp/web', 'https://api.test/x?key=value', 'https://api.test/credits', 'https://api.test/mcp/k/', 'http://[bad']) assert.equal(urlCarriesKey(url), false, url);

  // What goes to the log: the error itself when it holds no key, else its text with the key cut short.
  const plain = new Error('upstream timed out');
  assert.equal(loggable(plain), plain);
  const leaky = loggable(new Error(`fetch failed for https://api.test/uuid?api_key=${key}`));
  assert.equal(typeof leaky, 'string');
  assert.ok(!leaky.includes(key) && leaky.includes('api_key=adt_Ab…'));
  assert.equal(loggable(`bad ${key}`), 'bad adt_Ab…');
  const other = { code: 7 };
  assert.equal(loggable(other), other);

  // The answer to a request whose address held a key: no referrer, for every content type, even over a route's own rule.
  const { withSafetyHeaders, DEFAULT_REFERRER_POLICY } = headers;
  const keyed = `https://api.test/uuid?api_key=${key}`;
  for (const type of ['application/json', 'text/html; charset=utf-8', 'text/plain', 'text/event-stream']) {
    const res = withSafetyHeaders(new Response('x', { status: 200, headers: { 'content-type': type } }), keyed);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', type);
  }
  const own = withSafetyHeaders(new Response('<p>', { headers: { 'content-type': 'text/html', 'referrer-policy': 'origin' } }), `https://api.test/mcp/k/${key}`);
  assert.equal(own.headers.get('referrer-policy'), 'no-referrer');
  // A 402 quote keeps its status and payment headers.
  const quote = withSafetyHeaders(new Response('{}', { status: 402, headers: { 'content-type': 'application/json', 'payment-required': 'abc', 'www-authenticate': 'Payment x' } }), keyed);
  assert.equal(quote.status, 402);
  assert.equal(quote.headers.get('payment-required'), 'abc');
  assert.equal(quote.headers.get('www-authenticate'), 'Payment x');
  assert.equal(quote.headers.get('referrer-policy'), 'no-referrer');
  // An answer whose headers cannot be changed is copied, not lost.
  const fixed = Response.redirect('https://api.test/elsewhere', 302);
  const copied = withSafetyHeaders(fixed, keyed);
  assert.equal(copied.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(copied.status, 302);
  // Without a key in the address nothing changes: the general rule for pages, nothing for JSON, the same object back.
  const page = withSafetyHeaders(new Response('<p>', { headers: { 'content-type': 'text/html' } }), 'https://api.test/credits');
  assert.equal(page.headers.get('referrer-policy'), DEFAULT_REFERRER_POLICY);
  const json = new Response('{}', { headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' } });
  assert.equal(withSafetyHeaders(json, 'https://api.test/uuid?count=1'), json);
  assert.equal(json.headers.has('referrer-policy'), false);
  assert.equal(withSafetyHeaders(json), json, 'the request address is optional');
});

test('a counted request path never holds the key of an MCP connector address', async () => {
  const key = 'adt_' + 'Zz9'.repeat(14);
  const recorded = [];
  const stub = { recordFunnel: async (event) => { recorded.push(event); } };
  const env = { METRICS: { idFromName: (n) => n, get: () => stub } };
  const waits = [];
  funnel.withRequestTrace(env, `/mcp/k/${key}/web`, null, (p) => waits.push(p), () => {
    assert.equal(funnel.activeTrace().path, '/mcp/k/key/web');
    funnel.markStage('attempt');
  });
  await Promise.all(waits);
  assert.ok(recorded.length <= 1);
  assert.ok(!JSON.stringify(recorded).includes('adt_'), 'no key in a funnel row');
  funnel.withRequestTrace(env, '/uuid', null, () => {}, () => assert.equal(funnel.activeTrace().path, '/uuid'));
});

test('hosted pages: a dropped subtree ends where it ends, and what follows it is kept', () => {
  const { sanitizeHtml } = pages;
  const kept = (html) => sanitizeHtml(html);
  let r = kept('<form><label>x</label></form><p>after</p>');
  assert.equal(r.html, '<p>after</p>');
  assert.equal(r.text.trim(), 'after');
  r = kept('<svg><g/></svg><p>after</p>');
  assert.equal(r.html, '<p>after</p>');
  r = kept('<script>alert(1)</script><p>after</p>');
  assert.equal(r.html, '<p>after</p>');
  assert.ok(!r.html.includes('alert') && !r.text.includes('alert'));
  // Void tags inside a dropped subtree open and close at once: the count stays balanced.
  r = kept('<form><input><br></form><p>after</p>');
  assert.equal(r.html, '<p>after</p>');
  r = kept('<form><input><br><hr><img src="https://x.example/a.png"><input type="text"></form><p>after</p>');
  assert.equal(r.html, '<p>after</p>');
  // Nested and repeated drops, self-closing forms, allowed tags inside a drop, and text inside a drop.
  for (const html of [
    '<form><form><input></form></form><p>after</p>',
    '<svg><g><path d="M0 0"/><text>hidden</text></g><circle/></svg><p>after</p>',
    '<form><div><p>hidden <b>bold</b></p></div><select><option>a<option>b</select></form><p>after</p>',
    '<iframe src="https://x.example"></iframe><object><embed></object><p>after</p>',
    '<style>p{color:red}</style><noscript><p>hidden</p></noscript><template><p>hidden</p></template><p>after</p>',
    '<form><p>hidden</form><p>after</p>',
    '<form><table><tr><td>hidden</td></tr></table></form><p>after</p>',
    '<button>hidden<br/></button><textarea>hidden</textarea><p>after</p>',
    '<math><mi>x</mi></math><video><source src="https://x.example/v.mp4"><track></video><p>after</p>',
    '<input><p>after</p>',
    '<link rel="stylesheet" href="https://x.example/a.css"><meta charset="utf-8"><base href="https://x.example/"><p>after</p>',
  ]) {
    r = kept(html);
    assert.equal(r.html, '<p>after</p>', html);
    assert.ok(!r.text.includes('hidden'), html);
  }
  // A dropped subtree in the middle: what stands before and after it is kept, in order and properly closed.
  r = kept('<div><p>before</p><form><input><label>x</label></form><p>after</p></div><p>last</p>');
  assert.equal(r.html, '<div><p>before</p><p>after</p></div><p>last</p>');
  // A dropped tag that is never closed takes the rest with it (the parser closes it at the end), and nothing leaks.
  r = kept('<p>before</p><script>alert(1)');
  assert.equal(r.html, '<p>before</p>');
  // A stray closing tag does not open a hole for a later drop.
  r = kept('</form><p>one</p></script><form><input></form><p>after</p>');
  assert.equal(r.html, '<p>one</p><p>after</p>');
});
