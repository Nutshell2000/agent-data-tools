const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['cloudflare:workers'] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('PDF: arXiv abstract links read as their PDF; a web page is refused with a pointer to extract', async () => {
  const { pdfUrl, readPdf } = await load('src/routes/pdf.ts');
  assert.equal(pdfUrl('https://arxiv.org/abs/1706.03762'), 'https://arxiv.org/pdf/1706.03762');
  assert.equal(pdfUrl('https://arxiv.org/abs/2401.01234v2'), 'https://arxiv.org/pdf/2401.01234v2');
  assert.equal(pdfUrl('https://example.com/abs/x.pdf'), 'https://example.com/abs/x.pdf');
  await assert.rejects(readPdf(new TextEncoder().encode('<!DOCTYPE html><html><body>hi'), 1, 1, 1000), (e) => e.status === 415 && /extract/.test(e.message));
  await assert.rejects(readPdf(new TextEncoder().encode('PK\u0003\u0004zip'), 1, 1, 1000), (e) => e.status === 415 && !/extract/.test(e.message));
});

test('image type from the first bytes, whatever the server called it', async () => {
  const { sniffImage } = await load('src/routes/ai.ts');
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'image/png');
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a')), 'image/gif');
  assert.equal(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(new TextEncoder().encode('<html>')), null);
});

test('API health looks for the OpenAPI document beside the endpoint path, then at the usual root places', async () => {
  const { specCandidates } = await load('src/routes/agent-infra.ts');
  const c = specCandidates('https://petstore3.swagger.io/api/v3/pet/findByStatus?status=available');
  assert.equal(c[0], 'https://petstore3.swagger.io/api/v3/pet/openapi.json');
  assert.ok(c.includes('https://petstore3.swagger.io/api/v3/openapi.json'));
  assert.ok(c.includes('https://petstore3.swagger.io/openapi.json'));
  assert.ok(c.length <= 9 && new Set(c).size === c.length);
  assert.deepEqual(specCandidates('https://api.example.com/').slice(0, 2), ['https://api.example.com/openapi.json', 'https://api.example.com/swagger.json']);
});

test('company name from the page title when there is no og:site_name', async () => {
  const { nameFromTitle } = await load('src/routes/packs-intel.ts');
  assert.equal(nameFromTitle('Stripe | Financial Infrastructure to Grow Your Revenue', 'stripe.com'), 'Stripe');
  assert.equal(nameFromTitle('Home - Acme Widgets', 'acme-widgets.io'), 'Acme Widgets');
  assert.equal(nameFromTitle('Welcome to our site', 'example.com'), null);
  assert.equal(nameFromTitle(undefined, 'example.com'), null);
});

test('a site that blocks bots is named as such, not as a wrong URL', async () => {
  const { targetRefusal } = await load('src/lib/fetch.ts');
  assert.match(targetRefusal(403), /refused automated access \(HTTP 403\)/);
  assert.match(targetRefusal(401), /refused automated access/);
  assert.match(targetRefusal(404), /not found \(HTTP 404\); check the URL/);
  assert.match(targetRefusal(400), /check that the URL is public and correct/);
  for (const s of [400, 401, 403, 404, 410, 451]) assert.match(targetRefusal(s), /nothing was charged/);
});

test('domain input: URLs, ports, paths and Unicode names become the host; junk is refused', async () => {
  const { domainInput } = await load('src/routes/domain.ts');
  assert.equal(domainInput('https://www.stripe.com/pricing?x=1'), 'www.stripe.com');
  assert.equal(domainInput('GitHub.COM:443/x'), 'github.com');
  assert.equal(domainInput('GitHub.COM.'), 'github.com');
  assert.equal(domainInput('例え.テスト'), 'xn--r8jz45g.xn--zckzah');
  for (const bad of ['not a domain', 'localhost', '', 'http://']) assert.throws(() => domainInput(bad), (e) => e.status === 400, bad);
});

test('time zones as agents write them', async () => {
  const { normalizeZone, timeInZone } = await load('src/routes/time.ts');
  assert.equal(normalizeZone('Tokyo'), 'Asia/Tokyo');
  assert.equal(normalizeZone('America/New York'), 'America/New_York');
  assert.equal(normalizeZone('UTC+2'), 'Etc/GMT-2');
  assert.equal(normalizeZone('GMT-5:30'), '-05:30');
  assert.equal(normalizeZone('+02:00'), 'Etc/GMT-2');
  assert.equal(normalizeZone('z'), 'UTC');
  assert.throws(() => normalizeZone('UTC+15'), (e) => e.status === 400);
  assert.equal(timeInZone('europe/stockholm').zone, 'Europe/Stockholm');
  assert.equal(timeInZone('UTC+2').zone, 'UTC+02:00');
  assert.equal(timeInZone('utc', '1792842360').utc, '2026-10-24T11:46:00.000Z');
  assert.equal(timeInZone('utc', '1792842360000').unixSeconds, 1792842360);
  assert.equal(timeInZone('Europe/Berlin', '2026-12-24T18:00:00Z').localTime, '2026-12-24T19:00:00');
  assert.equal(timeInZone('UTC', undefined, 'Tokyo, New York').converted.map((z) => z.zone).join(','), 'Asia/Tokyo,America/New_York');
});

test('feeds: a site URL leads to the feed its head advertises; page metadata falls back to meta name=title', async () => {
  const { discoverFeed, parseMeta } = await load('src/routes/feeds.ts');
  const html = '<html><head><link rel="stylesheet" href="/a.css"><link rel="alternate" type="application/rss+xml" title="Blog" href="/rss/"><link rel="alternate" type="application/atom+xml" href="https://x.test/atom"></head></html>';
  assert.equal(discoverFeed(html, 'https://blog.test/posts/'), 'https://blog.test/rss/');
  assert.equal(discoverFeed('<html><head><title>x</title></head></html>', 'https://blog.test/'), null);
  const meta = parseMeta('<html><head><meta name="title" content="Video title"><meta name="description" content="About it"></head><body></body></html>', 'https://v.test/');
  assert.equal(meta.title, 'Video title');
  assert.equal(meta.description, 'About it');
});

test('units as agents name them: full names, plurals, kph, cups, acres; unknown units name the kinds', async () => {
  const { unitKey, convertUnit } = await load('src/routes/utils.ts');
  assert.equal(unitKey('feet'), 'ft');
  assert.equal(unitKey('Kilometers'), 'km');
  assert.equal(unitKey('kph'), 'km/h');
  assert.equal(unitKey('cups'), 'cup');
  assert.equal(unitKey('acres'), 'acre');
  assert.equal(unitKey('square meters'), 'm2');
  assert.equal(unitKey('ms'), 'ms', 'a known unit is never singularised');
  assert.equal(unitKey('Fahrenheit'), 'f');
  assert.equal(unitKey('furlong'), null);
  assert.equal(Math.round(convertUnit(100, 'kph', 'mph').result * 100) / 100, 62.14);
  assert.equal(convertUnit(1, 'acre', 'hectare').kind, 'area');
  assert.throws(() => convertUnit(1, 'furlong', 'm'), (e) => e.status === 400 && /unknown unit "furlong"/.test(e.message));
  assert.throws(() => convertUnit(1, 'kg', 'liters'), (e) => e.status === 400 && /same kind/.test(e.message));
});

test('dates as agents write them: today, now, tomorrow, yesterday', async () => {
  const { parseDate } = await load('src/lib/relative-date.ts');
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(parseDate('today').toISOString(), `${today}T00:00:00.000Z`);
  assert.equal(parseDate('TODAY', 'T12:00:00Z').toISOString(), `${today}T12:00:00.000Z`);
  assert.equal(parseDate('tomorrow').getTime() - parseDate('today').getTime(), 86_400_000);
  assert.equal(parseDate('yesterday').getTime() - parseDate('today').getTime(), -86_400_000);
  assert.ok(Math.abs(parseDate('now').getTime() - Date.now()) < 5000);
  assert.equal(parseDate('2026-01-31').toISOString(), '2026-01-31T00:00:00.000Z');
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate(''), null);
});

test('country names and codes', async () => {
  const { countryCode, countryName } = await load('src/lib/country-code.ts');
  assert.equal(countryCode('Japan'), 'JP');
  assert.equal(countryCode('uk'), 'GB');
  assert.equal(countryCode('United Kingdom'), 'GB');
  assert.equal(countryCode('USA'), 'US');
  assert.equal(countryCode('se'), 'SE');
  assert.equal(countryCode('Nowhereland'), null);
  assert.equal(countryName('JP'), 'Japan');
});

test('utilities take the forms agents send: hash and case names, cron macros, currency signs, named colours, Bearer tokens, fenced JSON, scheme-less URLs, MIME types', async () => {
  const { UTILS, parseColour, cronNext } = await load('src/routes/utils.ts');
  const { num } = await load('src/family.ts');
  const run = (path, inputs) => UTILS.find((e) => e.endpoint.path === path).run({}, (n) => inputs[n]);
  assert.equal((await run('/hash', { text: 'hello', algorithm: 'SHA-256' })).hex, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal((await run('/case', { text: 'user profile id', to: 'snake_case' })).result, 'user_profile_id');
  assert.equal((await run('/case', { text: 'user profile id', to: 'Title Case' })).result, 'User Profile Id');
  assert.equal((await run('/case', { text: 'user profile id', to: 'SCREAMING_SNAKE_CASE' })).result, 'USER_PROFILE_ID');
  assert.equal(cronNext('@daily', new Date('2026-10-24T10:00:00Z'), 1)[0], '2026-10-25T00:00:00.000Z');
  assert.equal(cronNext('@hourly', new Date('2026-10-24T10:30:00Z'), 1)[0], '2026-10-24T11:00:00.000Z');
  assert.equal(num((n) => ({ number: '$1,234.50' })[n], 'number'), 1234.5);
  assert.equal(num((n) => ({ number: '-€5' })[n], 'number'), -5);
  assert.deepEqual(parseColour('navy'), [0, 0, 128]);
  assert.deepEqual(parseColour('Rebecca Purple'), [102, 51, 153]);
  assert.deepEqual(parseColour('#0F6CBDFF'), [15, 108, 189]);
  assert.deepEqual(parseColour('#0f6c'), [0, 255, 102]);
  assert.throws(() => parseColour('#0f6cb'), (e) => e.status === 400);
  assert.equal((await run('/jwt/decode', { token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJleHAiOjE3OTIyODE2MDB9.sig' })).payload.sub, '123');
  assert.equal((await run('/json/validate', { text: '```json\n{"a":1}\n```' })).valid, true);
  const parsed = await run('/url/parse', { url: 'example.com/a?b=1' });
  assert.deepEqual([parsed.host, parsed.path, parsed.query.b, parsed.assumedScheme], ['example.com', '/a', '1', true]);
  assert.equal((await run('/url/parse', { url: 'https://example.com/' })).assumedScheme, undefined);
  const mime = await run('/mime', { file: 'application/json' });
  assert.equal(mime.extension, 'json');
  assert.ok(mime.extensions.includes('json'));
  await assert.rejects(Promise.resolve().then(() => run('/mime', { file: 'application/x-nothing' })), (e) => e.status === 404);
});

test('fourth batch: coin and interval spellings, SEC company names, airport ICAO, quake feeds, markdown tables and tasks, extract, slugs, scheme-less urls', async () => {
  const { coinKey, intervalKey } = await load('src/routes/hyperliquid.ts');
  assert.equal(coinKey('Bitcoin'), 'BTC'); assert.equal(coinKey('ETH-PERP'), 'ETH'); assert.equal(coinKey('ETHUSDT'), 'ETH'); assert.equal(coinKey('$sol'), 'SOL'); assert.equal(coinKey('BTC/USD'), 'BTC');
  assert.equal(intervalKey('1H', '1h'), '1h'); assert.equal(intervalKey('daily', '1h'), '1d'); assert.equal(intervalKey('60m', '1h'), '1h'); assert.equal(intervalKey(undefined, '4h'), '4h');
  const { secCompanyMatch } = await load('src/routes/gov-data.ts');
  const entries = [{ ticker: 'AAPL', title: 'Apple Inc.' }, { ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' }, { ticker: 'APLE', title: 'Apple Hospitality REIT, Inc.' }];
  assert.equal(secCompanyMatch(entries, 'aapl').ticker, 'AAPL');
  assert.equal(secCompanyMatch(entries, 'brk.b').ticker, 'BRK-B');
  assert.equal(secCompanyMatch(entries, 'Apple').ticker, 'AAPL');
  assert.equal(secCompanyMatch(entries, 'berkshire hathaway').ticker, 'BRK-B');
  assert.equal(secCompanyMatch(entries, 'Nothing Corp'), undefined);
  const { quakeFeed } = await load('src/routes/public-data.ts');
  assert.deepEqual(quakeFeed('6'), { feed: '4.5', min: 6 });
  assert.deepEqual(quakeFeed('M3'), { feed: '2.5', min: 3 });
  assert.deepEqual(quakeFeed(undefined), { feed: '2.5', min: 2.5 });
  assert.deepEqual(quakeFeed('significant'), { feed: 'significant', min: null });
  assert.throws(() => quakeFeed('eleven'), (e) => e.status === 400);
  const { markdownToHtml, slugify, UTILS } = await load('src/routes/utils.ts');
  const html = markdownToHtml('| a | b |\n|---|--:|\n| 1 | 2 |\n\n- [ ] todo\n- [x] done');
  assert.match(html, /<table><thead><tr><th>a<\/th><th style="text-align:right">b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td style="text-align:right">2<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<li><input type="checkbox" disabled> todo<\/li><li><input type="checkbox" disabled checked> done<\/li>/);
  assert.equal(slugify('日本語のタイトル'), '日本語のタイトル');
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
  const extract = await UTILS.find((e) => e.endpoint.path === '/text/extract').run({}, (n) => ({ text: 'Call +1 (555) 123-4567 on 2026-12-24, pay 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045, see www.example.com/p for $1,250.00' })[n]);
  assert.deepEqual(extract.phones, ['+1 (555) 123-4567']);
  assert.deepEqual(extract.urls, ['www.example.com/p']);
  assert.ok(!extract.numbers.some((n) => n === '26964' || n === '2026'), JSON.stringify(extract.numbers));
  assert.ok(extract.numbers.includes('1,250.00'), JSON.stringify(extract.numbers));
  const { normalizedInput } = await load('src/tools.ts');
  assert.equal(normalizedInput((n) => ({ url: 'example.com/a?b=1' })[n])('url'), 'https://example.com/a?b=1');
  assert.equal(normalizedInput((n) => ({ url: 'https://example.com/' })[n])('url'), 'https://example.com/');
  assert.equal(normalizedInput((n) => ({ url: 'not a url' })[n])('url'), 'not a url');
});

test('daily spend caps count calls per UTC day in KV and refuse, uncharged, over the cap', async () => {
  const { takeDailyBudget } = await load('src/lib/daily-cap.ts');
  const store = new Map();
  const env = { TRIALS: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } } };
  for (let i = 0; i < 3; i++) await takeDailyBudget(env, 'ai', '3', 1000, 'AI');
  await assert.rejects(takeDailyBudget(env, 'ai', '3', 1000, 'AI'), (e) => e.status === 503 && /AI capacity/.test(e.message));
  await takeDailyBudget(env, 'browser', undefined, 60, 'hosted browser'); // another kind has its own count
  assert.equal([...store.keys()].filter((k) => k.startsWith('cap:')).length, 2);
  await takeDailyBudget({}, 'ai', '1', 1000, 'AI'); // no KV binding: nothing to count against
  await takeDailyBudget(env, 'ai', '0', 1000, 'AI'); // a cap of 0 means no cap
});
