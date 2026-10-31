const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const fakeKv = () => { const data = new Map(); return { data, async put(k, v, o) { data.set(k, { v, ttl: o?.expirationTtl }); }, async get(k) { return data.has(k) ? data.get(k).v : null; } }; };
const safe = async () => ({ flagged: false, categories: [] });

test('the indexing test host keeps workers.dev on and does not serve hosted pages', () => {
  const fs = require('node:fs');
  const config = fs.readFileSync(require.resolve('../wrangler.jsonc'), 'utf8');
  assert.match(config, /"workers_dev": true/, 'adding routes without this switches workers.dev off');
  assert.match(config, /"pattern": "tools\.funwords\.eu", "custom_domain": true/);
  assert.match(fs.readFileSync(require.resolve('../src/index.ts'), 'utf8'), /=== INDEXING_TEST_HOST\) return c\.notFound\(\)/);
});

test('pages: the sanitiser keeps content tags and drops scripts, styles, frames, forms, handlers and javascript links', async () => {
  const { sanitizeHtml } = await load('src/routes/pages.ts');
  const r = sanitizeHtml('<html><head><title>x</title><style>p{}</style></head><body><h1 onclick="evil()">Hi</h1><script>alert(1)</script><p style="color:red">Text <a href="javascript:evil()">bad</a> <a href="https://example.com/a?b=1">ok</a> <img src="http://x/y.png" alt="no"> <img src="https://x/y.png" alt="yes" width="10"></p><iframe src="https://x"></iframe><form><input></form><table><tr><td colspan="2">c</td></tr></table></body></html>');
  assert.equal(r.html, '<h1>Hi</h1><p>Text <a rel="nofollow noopener noreferrer ugc" target="_blank">bad</a> <a href="https://example.com/a?b=1" rel="nofollow noopener noreferrer ugc" target="_blank">ok</a> <img alt="no" loading="lazy" referrerpolicy="no-referrer"> <img src="https://x/y.png" alt="yes" width="10" loading="lazy" referrerpolicy="no-referrer"></p><table><tr><td colspan="2">c</td></tr></table>');
  assert.ok(!r.html.includes('alert') && !r.html.includes('onclick') && !r.html.includes('style'));
  assert.equal(r.text, 'Hi\nText bad ok\nc');
  assert.equal(sanitizeHtml('<p>a &lt; b &amp; "c"</p>').html, '<p>a &lt; b &amp; &quot;c&quot;</p>');
  assert.equal(sanitizeHtml('<div><p>open').html, '<div><p>open</p></div>');
});

test('pages: publish stores a sanitised page under a random id with the TTL, refuses flagged or empty content', async () => {
  const { publishPage, readPage, pageHtml, PAGES } = await load('src/routes/pages.ts');
  const kv = fakeKv();
  const out = await publishPage(kv, { html: '<h1>Report</h1><script>x</script><p>Body</p>', days: 3 }, safe, 'https://api.test');
  assert.match(out.id, /^[a-z0-9]{12}$/);
  assert.equal(out.url, `https://api.test/p/${out.id}`);
  assert.equal(out.title, 'Report');
  assert.equal(out.days, 3);
  const [k, v] = [...kv.data.entries()][0];
  assert.equal(k, `page:${out.id}`);
  assert.equal(v.ttl, 3 * 86400);
  const page = await readPage(kv, out.id);
  assert.equal(page.html, '<h1>Report</h1><p>Body</p>');
  const html = pageHtml(page, 'support@example.com');
  assert.ok(html.includes('noindex') && html.includes('<h1>Report</h1>') && html.includes('support@example.com') && html.includes(page.expiresAt.slice(0, 10)));
  assert.equal(await readPage(kv, 'nope'), null);
  await assert.rejects(publishPage(kv, { html: '<script>only</script>' }, safe), (e) => e.status === 400);
  await assert.rejects(publishPage(kv, { html: '<p>bad</p>' }, async () => ({ flagged: true, categories: [{ code: 'S10', name: 'Hate' }] })), (e) => e.status === 422 && /Hate/.test(e.message));
  await assert.rejects(publishPage(null, { html: '<p>x</p>' }, safe), (e) => e.status === 503);
  await assert.rejects(publishPage(kv, { html: 'x'.repeat(200_001) }, safe), (e) => e.status === 400);
  const e = PAGES[0].endpoint;
  assert.equal(e.path, '/page/publish');
  assert.ok(e.summary.split(':')[0].length <= 32 && e.description.length <= 450 && e.price === '$0.01', e.summary);
});

test('A2A agent card lists the service, payment and the leading tools as skills', async () => {
  const { agentCard } = await load('src/discovery.ts');
  const card = agentCard('https://api.test', ['eip155:8453']);
  assert.equal(card.url, 'https://api.test');
  assert.ok(card.skills.length >= 40 && card.skills.length <= 80);
  assert.ok(card.skills.every((s) => s.id && s.name && s.description && s.examples?.[0]?.startsWith('https://api.test/')));
  assert.equal(card.capabilities.streaming, false);
  assert.ok(card.securitySchemes.x402 && card.payment.protocol === 'x402');
});
