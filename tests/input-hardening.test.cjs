// Input, fetch and parser hardening (21 Nov 2026): counted reads instead of whole-body reads, a regex check that
// reads the pattern properly, a linear robots.txt matcher, a counted inflate for embedded invoices, the DOCTYPE rule
// over the whole prolog, WebSocket and WebRTC closed in the hosted browser, one list of the service's own hosts, and
// https for the Danish register. No network: fetch, the edge cache and the browser are stand-ins.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { build } = require('esbuild');
const vm = require('node:vm');
const zlib = require('node:zlib');

const fakeBrowser = { launch: null };
async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['@cloudflare/puppeteer', 'cloudflare:workers'] });
  const m = { exports: {} };
  const req = (id) => (id === '@cloudflare/puppeteer' ? { __esModule: true, default: { launch: (...a) => fakeBrowser.launch(...a) } } : id === 'cloudflare:workers' ? { DurableObject: class {}, WorkerEntrypoint: class {} } : require(id));
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}

const MB = 1024 * 1024;
/** A body of `total` bytes handed out 64 KiB at a time; `sent.bytes` counts what was really asked for. */
function bigBody(total, sent = { bytes: 0 }) {
  const chunk = new Uint8Array(64 * 1024).fill(0x61);
  return { sent, stream: new ReadableStream({ pull(controller) { if (sent.bytes >= total) { controller.close(); return; } sent.bytes += chunk.byteLength; controller.enqueue(chunk); } }, { highWaterMark: 0 }) };
}
const q = (input) => (name) => input[name];
const toolOf = (list, path) => list.find((e) => e.endpoint.path === path);

/** Runs `fn` with `fetch` replaced, and the edge cache replaced by one that records what is stored. */
async function withNetwork(handler, fn, { cache = false } = {}) {
  const realFetch = globalThis.fetch, hadCaches = 'caches' in globalThis, realCaches = globalThis.caches;
  const stored = [];
  const calls = [];
  globalThis.fetch = async (input, init) => { const url = String(input instanceof Request ? input.url : input); calls.push(url); return handler(new URL(url), init); };
  if (cache) globalThis.caches = { default: { match: async () => undefined, put: async (_key, res) => { stored.push((await res.arrayBuffer()).byteLength); } } };
  else delete globalThis.caches;
  try { return await fn({ calls, stored }); }
  finally { globalThis.fetch = realFetch; if (hadCaches) globalThis.caches = realCaches; else delete globalThis.caches; }
}

let R, F, FI, S, G, U, L, X, P, B, REG, INFRA, READY, MEDIA, INTEL;
before(async () => {
  R = await load('src/lib/read-capped.ts');
  F = await load('src/lib/fetch.ts');
  FI = await load('src/lib/file-input.ts');
  S = await load('src/lib/self-fetch.ts');
  G = await load('src/lib/regex-guard.ts');
  U = await load('src/routes/utils.ts');
  L = await load('src/routes/lookups.ts');
  X = await load('src/lib/einvoice/pdf-xml.ts');
  P = await load('src/lib/einvoice/parse.ts');
  B = await load('src/lib/browser.ts');
  REG = await load('src/routes/gb-dk-registers.ts');
  INFRA = await load('src/routes/agent-infra.ts');
  READY = await load('src/routes/agent-readiness.ts');
  MEDIA = await load('src/routes/media-text.ts');
  INTEL = await load('src/routes/packs-intel.ts');
});

// ---------- counted reads ----------
test('a counted read stops at the limit and leaves the rest of the stream unread', async () => {
  const big = bigBody(50 * MB);
  const cut = await R.readCapped(big.stream, 1 * MB);
  assert.equal(cut.over, true);
  assert.equal(cut.bytes.byteLength, 1 * MB);
  assert.ok(big.sent.bytes <= 1 * MB + 128 * 1024, `asked for ${big.sent.bytes} bytes of 50 MB`);
  const small = await R.readCapped(new Response('hello').body, 5);
  assert.deepEqual([small.over, new TextDecoder().decode(small.bytes)], [false, 'hello'], 'a body of exactly the limit is whole');
  assert.equal((await R.readCapped(null, 10)).bytes.byteLength, 0);
  assert.equal(await R.jsonCapped(new Response('{"a":1}'), 100).then((j) => j.a), 1);
  assert.equal(await R.jsonCapped(new Response('{"a":"' + 'x'.repeat(500) + '"}'), 100), null, 'an answer over the limit is not parsed');
  assert.equal(await R.jsonCapped(new Response('<html>'), 100), null);
});

test('peeking a body gives it whole when it fits and hands on every byte when it does not', async () => {
  const fits = await R.peekBody(new Response('abcdef').body, 6);
  assert.equal(new TextDecoder().decode(fits.complete), 'abcdef');
  const big = bigBody(3 * MB);
  const over = await R.peekBody(big.stream, 1 * MB);
  assert.equal('complete' in over, false);
  assert.ok(big.sent.bytes <= 1 * MB + 128 * 1024, 'only the look-ahead was read');
  assert.equal((await new Response(over.rest).arrayBuffer()).byteLength, 3 * MB, 'nothing is lost or repeated');
});

// ---------- F2: fetched bodies ----------
test('a cached fetch no longer reads a file over the limit whole: it is refused, uncharged, and not cached', async () => {
  const big = bigBody(200 * MB);
  await withNetwork(async () => new Response(big.stream, { headers: { 'content-type': 'application/pdf' } }), async ({ stored }) => {
    await assert.rejects(F.fetchFile('https://files.example/huge.pdf', /pdf/, 3 * MB, 'a PDF', { cacheSeconds: 600 }),
      (e) => e.status === 422 && /larger than the 3 MB limit \(nothing was charged\)/.test(e.message));
    assert.deepEqual(stored, [], 'nothing went into the cache');
  }, { cache: true });
  assert.ok(big.sent.bytes <= 3 * MB + 512 * 1024, `asked for ${big.sent.bytes} bytes of a 200 MB file`);
});

test('a cached fetch of an ordinary file still answers, is kept in the cache, and names its final URL', async () => {
  await withNetwork(async () => new Response('%PDF-1.4 small', { headers: { 'content-type': 'application/pdf', 'set-cookie': 'a=b' } }), async ({ stored }) => {
    const file = await F.fetchFile('https://files.example/small.pdf', /pdf/, 3 * MB, 'a PDF', { cacheSeconds: 600 });
    assert.equal(new TextDecoder().decode(file.bytes), '%PDF-1.4 small');
    assert.equal(file.finalUrl, 'https://files.example/small.pdf');
    assert.deepEqual(stored, [14]);
  }, { cache: true });
});

test('a cached page larger than the cache ceiling is handed on as a stream instead of being held', async () => {
  const big = bigBody(40 * MB);
  await withNetwork(async () => new Response(big.stream, { headers: { 'content-type': 'text/html' } }), async ({ stored }) => {
    const res = await F.fetchPublic(new URL('https://pages.example/long'), 'text/html', [], { cacheSeconds: 600 });
    assert.ok(big.sent.bytes <= 12 * MB + 512 * 1024, 'only the cache ceiling was looked at');
    assert.equal(res.url, 'https://pages.example/long');
    const head = await R.readCapped(res.body, 1000);
    assert.equal(head.over, true);
    assert.deepEqual(stored, []);
  }, { cache: true });
});

for (const [name, load_, path, limit] of [
  ['/robots', () => L.LOOKUPS, '/robots', 2_000_000],
  ['/url/favicon', () => MEDIA.MEDIA_TEXT, '/url/favicon', 2_000_000],
  ['/tech/stack', () => INTEL.PACKS_INTEL, '/tech/stack', 4_000_000],
]) {
  test(`${name} reads the start of an endless page and stops`, async () => {
    const big = bigBody(300 * MB);
    const out = await withNetwork(async (url) => (url.pathname === '/favicon.ico' ? new Response('', { status: 404 }) : new Response(big.stream, { headers: { 'content-type': 'text/html' } })),
      () => toolOf(load_(), path).run({}, q({ url: 'https://big.example/page' })));
    assert.ok(out && typeof out === 'object');
    assert.ok(big.sent.bytes <= limit + 512 * 1024, `asked for ${big.sent.bytes} bytes`);
  });
}

test('the readers answer as before on an ordinary page', async () => {
  const robots = 'User-agent: *\nDisallow: /private\nAllow: /private/open\nSitemap: https://site.example/sitemap.xml\n';
  const out = await withNetwork(async () => new Response(robots, { headers: { 'content-type': 'text/plain' } }), () => toolOf(L.LOOKUPS, '/robots').run({}, q({ url: 'https://site.example/private/x' })));
  assert.deepEqual([out.allowed, out.matchedRule, out.group, out.rulesInGroup, out.sitemaps], [false, 'Disallow: /private', '*', 2, ['https://site.example/sitemap.xml']]);
  const html = '<html><head><link rel="icon" href="/i.svg" type="image/svg+xml"><meta name="generator" content="WordPress 6.5"></head><body><script src="/wp-content/x.js"></script></body></html>';
  const icons = await withNetwork(async (url) => (url.pathname === '/favicon.ico' ? new Response('', { status: 404 }) : new Response(html, { headers: { 'content-type': 'text/html' } })), () => toolOf(MEDIA.MEDIA_TEXT, '/url/favicon').run({}, q({ url: 'https://site.example/' })));
  assert.equal(icons.best, 'https://site.example/i.svg');
  const tech = await withNetwork(async () => new Response(html, { headers: { 'content-type': 'text/html' } }), () => toolOf(INTEL.PACKS_INTEL, '/tech/stack').run({}, q({ url: 'https://site.example/' })));
  assert.ok(tech.technologies.some((t) => t.name === 'WordPress'));
});

test('agent readiness reads at most 1.2 MB of each file a site answers with', async () => {
  const bodies = [];
  const out = await withNetwork(async () => { const b = bigBody(100 * MB); bodies.push(b); return new Response(b.stream, { headers: { 'content-type': 'text/plain' } }); },
    () => toolOf(READY.AGENT_READINESS, '/agent-readiness').run({}, q({ url: 'https://big.example' })));
  assert.equal(out.origin, 'https://big.example');
  assert.ok(bodies.length >= 10);
  for (const b of bodies) assert.ok(b.sent.bytes <= 1_200_000 + 512 * 1024, `asked for ${b.sent.bytes} bytes of one file`);
});

// ---------- F1: uploads ----------
test('an upload sent without a Content-Length is refused at the limit instead of being read whole', async () => {
  for (const type of ['application/pdf', 'application/json', 'multipart/form-data; boundary=x']) {
    const big = bigBody(400 * MB);
    const request = new Request('https://api.test/pdf/text', { method: 'POST', headers: { 'content-type': type }, body: big.stream, duplex: 'half' });
    assert.equal(request.headers.get('content-length'), null);
    const sent = await FI.sentFile(request, 1 * MB);
    assert.deepEqual(sent, { kind: 'too-large', limit: 1 * MB }, type);
    assert.ok(big.sent.bytes <= 1.4 * MB + 1 * MB, `${type}: asked for ${big.sent.bytes} bytes of 400 MB`);
  }
});

test('a chunked upload inside the limit is read as the file it is, and other bodies are never read', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.4 a small file sent in pieces');
  const pieces = () => new ReadableStream({ start(c) { c.enqueue(pdf.subarray(0, 10)); c.enqueue(pdf.subarray(10)); c.close(); } });
  const raw = await FI.sentFile(new Request('https://api.test/pdf/text', { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: pieces(), duplex: 'half' }), MB);
  assert.equal(raw.kind, 'file');
  assert.deepEqual([...raw.bytes], [...pdf]);
  const asked = { bytes: 0 };
  const text = await FI.sentFile(new Request('https://api.test/pdf/text', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: bigBody(10 * MB, asked).stream, duplex: 'half' }), MB);
  assert.equal(text.kind, 'none');
  assert.equal(asked.bytes, 0, 'a body that cannot hold a file is left alone');
  // The body's own keys only: an inherited name is never a field.
  const json = await FI.sentFile(new Request('https://api.test/pdf/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"__proto__":{"file":"JVBERi0xLjQgYSBzbWFsbCBmaWxl"},"url":"https://example.com/a.pdf"}' }), MB);
  assert.equal(json.kind, 'none');
});

// ---------- F3: regular expressions ----------
const REFUSED = [
  ['(a|aa)+$', 'alternation'], ['(a|a?)+$', 'nested'], ['(a+)+', 'nested'], ['((a+))+$', 'nested'], ['(?:(?:a*))*b', 'nested'], [String.raw`(\d|\w)+!`, 'alternation'],
  ['(a|b|ab)*c', 'alternation'], ['(.|a)+b', 'alternation'], [String.raw`^(\w+\s?)*$`, 'nested'], [String.raw`(a)\1`, 'backreference'], [String.raw`(?<x>a)\k<x>`, 'backreference'],
];
const TOO_LONG_AT_5000 = ['a*a*a*a*a*a*a*b', 'a*a*b', '.*x.*y', String.raw`\d+\.?\d*\s*kg`, '(.*)=(.*);', '[ab]*a[ab]*a[ab]*c', 'a{0,20}a{0,20}a{0,20}a{0,20}b', '(?:ab)+(?:ab)+c', 'a+?a+?a+?b',
  'a?'.repeat(30) + 'a'.repeat(30), '(a|b|c|d)*(a|b)*(c|d|a)*z', '(?=a*b)a*c', 'x*y*x*y*x*y*z'];
const ORDINARY = [String.raw`(\d{4})-(\d{2})`, String.raw`\b\w+@\w+\.\w+\b`, String.raw`https?://[^\s]+`, '(foo|bar)+', '(?:ab)+', '[A-Z][a-z]+ [A-Z][a-z]+', String.raw`(\d+)\.(\d+)\.(\d+)`, '<[^>]+>',
  String.raw`"([^"\\]|\\.)*"`, String.raw`(?<year>\d{4})-(?<month>\d{2})`, String.raw`\$\d+(?:\.\d{2})?`, String.raw`[\w.+-]+@[\w-]+\.[\w.-]+`, String.raw`#[0-9a-fA-F]{3,6}\b`, String.raw`\d{1,3}(,\d{3})*`,
  '(é|è)+', 'a{2,}', String.raw`https?://(www\.)?[\w.-]+/?`, String.raw`\d+ ?(kg|g|lb|oz|ml|l)`, String.raw`\s+`, String.raw`^\d+$`, String.raw`(?:Mr|Mrs|Dr)\.? [A-Z]\w+`, String.raw`^#+\s+(.*)$`,
  String.raw`(\w+)=("[^"]*"|\S+)`, String.raw`\d+(\.\d+)?%`, '.*', '(.*)', '^(.*)=(.*)$', String.raw`\w+\s*:\s*\w+`, 'a{3}{', 'x{,2}', '[[]a]+'];

test('the regex check refuses the shapes that run without end and says which', () => {
  for (const [pattern, reason] of REFUSED) assert.deepEqual(G.regexRisk(pattern, '', 50), { ok: false, reason }, pattern);
});

test('repeats that overlap are weighed against the text: refused on a long text, allowed on a short one', () => {
  for (const pattern of TOO_LONG_AT_5000) {
    const long = G.regexRisk(pattern, '', 5000);
    assert.equal(long.ok, false, pattern);
    assert.equal(long.reason, 'overlap', pattern);
    assert.ok(long.maxText < 5000, pattern);
    if (long.maxText > 0) assert.deepEqual(G.regexRisk(pattern, '', long.maxText), { ok: true }, `${pattern} at ${long.maxText}`);
  }
  assert.equal(G.regexRisk('a?'.repeat(40) + 'a'.repeat(40), '', 5000).maxText, 0, 'forty optional parts in a row are refused at any length');
  // The same two repeats cost a tenth when the search can only start at the first character.
  assert.ok(G.regexRisk('^a*a*b', '', 5000).ok);
  assert.equal(G.regexRisk('^a*a*b', 'm', 5000).ok, false);
});

test('ordinary patterns pass on the full 5,000 characters', () => {
  for (const pattern of ORDINARY) assert.deepEqual(G.regexRisk(pattern, '', 5000), { ok: true }, pattern);
  assert.deepEqual(G.regexRisk(String.raw`\p{L}+\s\p{Lu}`, 'u', 5000), { ok: true });
});

test('every pattern the check lets through finishes quickly on the text built to slow it down', () => {
  const units = ['a', 'ab', 'b', '1', 'x', '=', 'a ', 'xy', ' '];
  let slowest = 0, slowestPattern = '';
  for (const pattern of [...TOO_LONG_AT_5000, ...ORDINARY, 'a*b|a*c|a*d|a*e|a*f|a*g', 'a{0,200}a{0,200}b', String.raw`[ab]+\w*?b`, String.raw`.{1,30}a?[^b]+?c`]) {
    const verdict = G.regexRisk(pattern, '', 5000);
    const n = verdict.ok ? 5000 : verdict.maxText;
    if (!n) continue;
    for (const unit of units) for (const end of ['', '\n', '!']) {
      const text = (unit.repeat(Math.ceil(n / unit.length)).slice(0, n - end.length) + end);
      const started = process.hrtime.bigint();
      let count = 0;
      for (const _ of text.matchAll(new RegExp(pattern, 'g'))) if (++count >= 200) break;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      if (ms > slowest) { slowest = ms; slowestPattern = `${pattern} on ${JSON.stringify(unit)}`; }
    }
  }
  assert.ok(slowest < 2000, `slowest was ${Math.round(slowest)} ms: ${slowestPattern}`);
});

test('/regex/test: same answers for ordinary patterns, uncharged refusals for unsafe ones, 200 matches at most', async () => {
  const run = async (input) => toolOf(U.UTILS, '/regex/test').run({}, q(input));
  assert.deepEqual(await run({ pattern: String.raw`(\d{4})-(\d{2})`, text: '2026-10 and 2027-01' }), { valid: true, count: 2, matches: [
    { match: '2026-10', index: 0, groups: ['2026', '10'], named: null }, { match: '2027-01', index: 12, groups: ['2027', '01'], named: null }] });
  const named = await run({ pattern: '(?<word>[a-z]+)', text: 'One two', flags: 'i' });
  assert.deepEqual(named.matches.map((m) => m.named.word), ['One', 'two']);
  assert.deepEqual(await run({ pattern: '(', text: 'x' }).then((r) => r.valid), false, 'an invalid pattern is answered as before');
  assert.equal((await run({ pattern: '(?:ab)+', text: 'ababab' })).matches[0].match, 'ababab', 'a repeated non-capturing group is no longer refused by mistake');
  const many = await run({ pattern: 'a', text: 'a'.repeat(5000) });
  assert.deepEqual([many.count, many.matches.length], [200, 200]);
  assert.equal((await run({ pattern: 'b*', text: 'abc' })).count, 4, 'empty matches still advance');
  for (const pattern of ['(a|aa)+$', '(a+)+', '((a+))+$', String.raw`(a)\1`]) await assert.rejects(async () => run({ pattern, text: 'a'.repeat(40) + 'b' }), (e) => e.status === 400 && /pattern refused/.test(e.message), pattern);
  await assert.rejects(async () => run({ pattern: 'a*a*a*a*a*a*a*b', text: 'a'.repeat(5000) }), (e) => e.status === 400 && /at most 9 characters/.test(e.message) && /nothing was charged/.test(e.message));
  assert.equal((await run({ pattern: 'a*a*a*a*a*a*a*b', text: 'aaab' })).matches[0].match, 'aaab', 'the same pattern runs on a short text');
  await assert.rejects(async () => run({ pattern: 'x'.repeat(301), text: 'x' }), (e) => e.status === 400);
  await assert.rejects(async () => run({ pattern: 'x', text: 'x'.repeat(5001) }), (e) => e.status === 400);
});

// ---------- F3: robots.txt rules ----------
test('the robots.txt matcher gives the answers of the expression it replaces', () => {
  const old = (rule, path) => new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`).test(path);
  const cases = [['/', '/a'], ['', '/a'], ['/a', '/a/b'], ['/a', '/b'], ['/*.php$', '/x/index.php'], ['/*.php$', '/x/index.php?a=1'], ['/*.php', '/x/index.php?a=1'], ['/fish*', '/fishheads/y.html'], ['/fish*.php', '/fish.asp'],
    ['/a*b*c$', '/a1b2c'], ['/a*b*c$', '/a1b2c3'], ['/a*bc$', '/abcbc'], ['*', '/'], ['$', ''], ['$', '/'], ['/a$b', '/a$bc'], ['/**/x', '/q/x'], ['/a*a$', '/a'], ['/a*a$', '/aa'], ['/x.y', '/xzy'], ['/a*$', '/abc'], ['/p?q', '/p?q=1']];
  for (const [rule, path] of cases) assert.equal(L.robotsRuleMatches(rule, path), old(rule, path), `${rule} against ${path}`);
  let seed = 42;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const word = (alphabet, max) => Array.from({ length: rnd(max + 1) }, () => alphabet[rnd(alphabet.length)]).join('');
  for (let i = 0; i < 4000; i++) {
    const rule = word(['a', 'b', '/', '*', '*', '.', '$'], 7) + (rnd(3) === 0 ? '$' : '');
    const path = word(['a', 'b', '/', '.', '$'], 9);
    assert.equal(L.robotsRuleMatches(rule, path), old(rule, path), `${JSON.stringify(rule)} against ${JSON.stringify(path)}`);
  }
});

test('a robots.txt full of starred rules is answered at once', () => {
  const evil = `User-agent: *\n${Array.from({ length: 2000 }, (_, i) => `Disallow: /${'*a'.repeat(40)}${i % 2 ? '$' : 'b'}`).join('\n')}\nDisallow: /private\n`;
  const started = Date.now();
  const verdict = L.robotsVerdict(evil, '*', `/${'a'.repeat(1900)}`);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.rulesInGroup, 2001);
  assert.equal(L.robotsVerdict(evil, '*', '/private/x').matchedRule, 'Disallow: /private');
});

// ---------- F5 and F17: e-invoices ----------
const pdfWith = (dict, data) => Buffer.concat([Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')]);

test('an embedded invoice is still read, and a stream that expands past 5 MB is dropped while it is being inflated', async () => {
  const xml = '<?xml version="1.0"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:x"><a>1</a></rsm:CrossIndustryInvoice>';
  assert.equal(await X.embeddedInvoiceXml(new Uint8Array(pdfWith('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(xml))))), xml);
  assert.equal(await X.embeddedInvoiceXml(new Uint8Array(pdfWith('', Buffer.from(xml)))), xml);
  // 300 MB of one invoice-like line packs into about 300 KB.
  const bomb = zlib.deflateSync(Buffer.alloc(300 * MB, '<Invoice > '), { level: 9 });
  assert.ok(bomb.length < 2 * MB);
  const before_ = process.memoryUsage().arrayBuffers;
  const started = Date.now();
  assert.equal(await X.embeddedInvoiceXml(new Uint8Array(pdfWith('/Filter /FlateDecode', bomb))), null);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  assert.ok(process.memoryUsage().arrayBuffers - before_ < 100 * MB, 'the 300 MB were never held');
});

test('a DOCTYPE anywhere before the root element is refused, however long the comment in front of it', () => {
  const licence = `<!--${' licence text'.repeat(1000)}-->`;
  assert.ok(licence.length > 4000);
  const body = '<Invoice><ID>1</ID></Invoice>';
  assert.equal(P.parseXml(`<?xml version="1.0"?>\n${licence}\n${body}`).name, 'Invoice', 'a long comment alone is fine');
  for (const doc of [`<?xml version="1.0"?>${licence}<!DOCTYPE Invoice [<!ENTITY x "y">]>${body}`, `${licence}\n<?pi x?>\n  <!doctype Invoice>${body}`, `<!DOCTYPE Invoice>${body}`, `﻿<!DOCTYPE Invoice>${body}`])
    assert.throws(() => P.parseXml(doc), (e) => e instanceof P.XmlError && /DOCTYPE/.test(e.message));
  assert.equal(P.prologHasDoctype(`${licence}${body}<!DOCTYPE late>`), false, 'only the prolog is searched');
  assert.equal(P.prologHasDoctype('<!-- never closed <!DOCTYPE x>'), false);
});

// ---------- F7: the hosted browser ----------
test('the hosted browser closes WebSocket, WebRTC and WebTransport before the page runs, and still loads the page', async () => {
  const order = [];
  let script = null;
  const page = {
    setRequestInterception: async () => { order.push('intercept'); }, on: () => {}, setViewport: async () => {},
    evaluateOnNewDocument: async (source) => { order.push('script'); script = source; },
    goto: async () => { order.push('goto'); return { status: () => 200 }; }, url: () => 'https://site.example/', mainFrame: () => ({}),
  };
  fakeBrowser.launch = async () => ({ newPage: async () => page, close: async () => {} });
  const out = await B.withBrowserPage({ BROWSER: {} }, new URL('https://site.example/'), { width: 800, height: 600 }, async (_page, status) => status);
  assert.equal(out, 200);
  assert.deepEqual(order, ['intercept', 'script', 'goto'], 'the script is installed before the page is opened');
  assert.equal(typeof script, 'string', 'source text, so no bundler helper can be missing inside the page');

  // The same text in a stand-in page.
  const events = [];
  const sandbox = { EventTarget, Event, setTimeout, WebSocket: class Real {}, RTCPeerConnection: class {}, webkitRTCPeerConnection: class {}, RTCDataChannel: class {}, WebTransport: class {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'WebTransport']) assert.equal(vm.runInContext(`typeof ${name}`, sandbox), 'undefined', name);
  sandbox.events = events;
  vm.runInContext(`var s = new WebSocket("wss://elsewhere.example:8443/x"); s.onerror = function () { events.push("error"); }; s.addEventListener("close", function (e) { events.push("close " + e.code); }); s.send("x"); events.push("state " + s.readyState);
    try { WebSocket = null; } catch (e) {} events.push(typeof WebSocket);`, sandbox);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(events, ['state 0', 'function', 'error', 'close 1006'], 'a socket that fails like a refused connection, and cannot be put back');

  // A browser that refuses the script still renders the page.
  page.evaluateOnNewDocument = async () => { throw new Error('not supported'); };
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await B.withBrowserPage({ BROWSER: {} }, new URL('https://site.example/'), { width: 800, height: 600 }, async (_p, status) => status), 200); }
  finally { console.warn = warn; }
});

// ---------- F8: our own hosts ----------
test('every address of the service is an own host, and look-alikes are not', () => {
  for (const host of ['agent-data-tools.revmesh2074.workers.dev', 'agent-data-tools-staging.revmesh2074.workers.dev', 'tools.funwords.eu', 'glyphcall.com', 'www.glyphcall.com', 'api.glyphcall.com', 'MCP.glyphcall.com',
    'lex.glyphcall.com', 'tts.glyphcall.com', 'web.glyphcall.com', 'new-next-year.glyphcall.com', 'api.glyphcall.com.']) assert.equal(S.isOwnHost(host), true, host);
  for (const host of ['funwords.eu', 'notglyphcall.com', 'glyphcall.com.evil.example', 'api.glyphcall.co', 'revmesh2074.workers.dev', 'example.com']) assert.equal(S.isOwnHost(host), false, host);
});

test('only the four hosts of this Worker are answered through the service binding: never staging, never a host that was not measured', () => {
  for (const host of ['agent-data-tools.revmesh2074.workers.dev', 'tools.funwords.eu', 'glyphcall.com', 'www.glyphcall.com']) assert.equal(S.isSelfHost({}, host), true, host);
  // Staging is another Worker with testnet terms: production must not answer for it. The other names stay on the network path.
  for (const host of ['agent-data-tools-staging.revmesh2074.workers.dev', 'api.glyphcall.com', 'lex.glyphcall.com', 'example.com']) assert.equal(S.isSelfHost({}, host), false, host);
});

test('the tools that send many requests to one target refuse our own hosts; the page readers read our public pages as before', async () => {
  const refused = (e) => e.status === 400 && /own host/.test(e.message) && /nothing was charged/.test(e.message);
  await withNetwork(async () => new Response('reached'), async ({ calls }) => {
    await assert.rejects(toolOf(INFRA.AGENT_INFRA, '/mcp/inspect').run({}, q({ url: 'https://mcp.glyphcall.com/mcp' })), refused);
    await assert.rejects(toolOf(INFRA.AGENT_INFRA, '/openapi/summary').run({}, q({ url: 'https://api.glyphcall.com/openapi.json' })), refused);
    assert.deepEqual(calls, [], 'nothing was sent');
    // The published examples and the build of the reader's demo read pages on our own host: that must keep working.
    assert.equal(await (await F.fetchPublic(new URL('https://agent-data-tools.revmesh2074.workers.dev/examples/extract/index.html'), '*/*')).text(), 'reached');
    assert.equal(await (await F.fetchPublic(new URL('https://lex.glyphcall.com/'), '*/*')).text(), 'reached');
    assert.equal(await (await F.fetchPublic(new URL('https://example.com/'), '*/*')).text(), 'reached');
  });
});

// ---------- F10: the Danish register ----------
test('the Danish register is asked over https; http is tried only when the https connection cannot be made', async () => {
  const hit = { hits: { hits: [{ _source: { Vrvirksomhed: { cvrNummer: 24256790, virksomhedMetadata: { nyesteNavn: { navn: 'NOVO NORDISK A/S' }, nyesteVirksomhedsform: { langBeskrivelse: 'Aktieselskab' }, sammensatStatus: 'NORMAL' } } } }] } };
  const urls = [];
  const ok = async (url, init) => { urls.push(url); assert.match(init.headers.authorization, /^Basic /); return new Response(JSON.stringify(hit), { status: 200 }); };
  assert.equal((await REG.dkSearch('u', 'p', 'novo', 5, ok)).matches[0].number, '24256790');
  assert.deepEqual(urls, ['https://distribution.virk.dk/cvr-permanent/virksomhed/_search']);

  urls.length = 0;
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try {
    const httpsDown = async (url, init) => { if (url.startsWith('https:')) { urls.push(url); throw new TypeError('connection refused'); } return ok(url, init); };
    assert.equal((await REG.dkSearch('u', 'p', 'novo', 5, httpsDown)).matches.length, 1);
    assert.deepEqual(urls.map((u) => new URL(u).protocol), ['https:', 'http:']);
    assert.equal(warned, 1, 'the fallback is logged');
  } finally { console.warn = warn; }

  urls.length = 0;
  const slow = async (url) => { urls.push(url); throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); };
  await assert.rejects(REG.dkSearch('u', 'p', 'novo', 5, slow), (e) => e.name === 'TimeoutError');
  assert.equal(urls.length, 1, 'a timeout is not a reason to send the password in the clear');
  urls.length = 0;
  await assert.rejects(REG.dkSearch('u', 'p', 'novo', 5, async (url) => { urls.push(url); return new Response('', { status: 500 }); }), (e) => e.status === 502);
  assert.equal(urls.length, 1, 'an HTTP answer over https is final');
  await assert.rejects(REG.dkSearch('u', 'p', 'novo', 5, async () => new Response('x'.repeat(3_000_000), { status: 200 })).then(() => { throw new Error('answered'); }, (e) => { throw e; }), () => true);
});
