const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// Glyphcall Transcribe Pro: the entry plan ($3 a month, 3,000 credits since 21 Nov 2026) under a voice name. Its checkout
// must be granted exactly like the entry plan, its claim page must show voice instructions, and every hour figure must
// come from the live /transcribe/long price and the credits the plan really gives.
let mf;
let lib;
const O = 'https://api.test';
const SESSION = 'cs_live_' + 'a'.repeat(40);
const stripeSession = {
  id: SESSION, status: 'complete', payment_status: 'paid', mode: 'subscription', currency: 'usd', amount_total: 300,
  metadata: { adt_credits: '3000', plan: 'voice-pro' }, client_reference_id: null, subscription: 'sub_' + 'b'.repeat(24), invoice: 'in_' + 'c'.repeat(24),
};
before(async () => {
  const d = await build({ entryPoints: ['src/lib/voice-pro.ts', 'src/lib/credits.ts', 'src/discovery.ts'], bundle: true, format: 'cjs', platform: 'node', write: false, outdir: 'out',
    plugins: [{ name: 'stub', setup(b) {
      b.onResolve({ filter: /^(cloudflare:workers|@cloudflare\/puppeteer)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = { DurableObject: class {} };', loader: 'js' }));
    } }] });
  lib = {};
  for (const f of d.outputFiles) { const m = { exports: {} }; new Function('module', 'exports', 'require', f.text)(m, m.exports, require); Object.assign(lib, m.exports); }
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'],
    plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } },
    bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid', STRIPE_READ_KEY: 'rk_test_fixture' },
    outboundService: async (req) => {
      const url = new URL(req.url);
      if (url.hostname === 'api.stripe.com' && url.pathname.endsWith(SESSION)) return Response.json(stripeSession);
      if (url.hostname === 'api.stripe.com') return Response.json({ data: [] });
      return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453', extra: { name: 'USD Coin', version: '2' } }], extensions: [] });
    } }));
});
after(async () => { await mf?.dispose(); });

test('the Transcribe Pro $3 checkout matches the $3 plan, so verifyCheckout grants it', () => {
  const plan = lib.CREDIT_PLANS.find((p) => p.usdCents === lib.VOICE_PRO_CENTS && p.credits === lib.VOICE_PRO_CREDITS);
  assert.ok(plan, 'the pair Transcribe Pro is sold with is a row verifyCheckout reads');
  assert.equal(plan.kind, 'developer', 'it is the entry plan, not a retired pair');
  assert.equal(lib.VOICE_PRO_CREDITS, 3000);
  assert.ok(lib.VOICE_PRO_CREDITS <= lib.VOICE_PRO_CENTS * 10, 'never more credits than the price covers');
  assert.equal(lib.VOICE_PRO_URL, 'https://buy.stripe.com/5kQ8wP7uiflZcJYejjbII0h');
  assert.notEqual(lib.VOICE_PRO_URL, plan.url, 'its own link, which returns to the voice site');
});

test('hours are computed from the catalog price of /transcribe/long', () => {
  const long = lib.ENDPOINTS.find((e) => e.path === '/transcribe/long').price;
  const credits = Math.round(Number(long.slice(1)) * 1000);
  assert.equal(lib.voiceProHours(long), Math.floor(lib.VOICE_PRO_CREDITS / credits));
  assert.equal(lib.voiceProHours('$0.05'), 60, '3,000 credits at 50 credits an hour');
  // A plan bought through an older link is told the hours of the credits it was granted, not today's.
  assert.equal(lib.voiceProHours('$0.05', 15000), 300);
  assert.equal(lib.voiceKeyJson('https://x.test', 'adt_k', { long: '$0.05', short: '$0.01', summary: '$0.05' }, 15000).voicePro.hoursEachMonth, 300);
  assert.match(lib.voiceKeyHtml('https://x.test', 'adt_k', { long: '$0.05', short: '$0.01', summary: '$0.05' }, 7000), /Your plan adds 7,000 credits each month: about 140 hours/);
});

test('/transcribe-pro shows the plan, the live hours and the checkout link', async () => {
  const r = await mf.dispatchFetch(`${O}/transcribe-pro`);
  assert.equal(r.status, 200);
  const html = await r.text();
  const long = lib.ENDPOINTS.find((e) => e.path === '/transcribe/long').price;
  assert.ok(html.includes(`about ${lib.voiceProHours(long)} hours`), 'hours from the live price');
  assert.ok(html.includes(`adds ${lib.VOICE_PRO_CREDITS.toLocaleString('en-US')} credits`), 'the credits the plan gives');
  assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ''), /15,000|40,000|300 hours|800 hours/, 'none of the allowances of before 21 Nov 2026');
  assert.doesNotMatch(html, /bJe28r01Q5Lp6lA7UVbII0d|fZu7sLdSG0r5dO22ABbII08|00w3cvbKygq3bFU5MNbII0e/, 'none of the retired payment links');
  assert.ok(html.includes(lib.VOICE_PRO_URL));
  assert.ok(html.includes(lib.VOICE_HOURS_PACK_URL), 'the $1 pack for one-off files');
  assert.match(html, /Transcribe Pro/);
  assert.doesNotMatch(html, /Voice Pro/, 'one product, one name');
  assert.ok(html.includes('rel="canonical"'));
  assert.doesNotMatch(html, /cheapest|unlimited/i, 'no claims we cannot back');
  // 20 Nov 2026: the $3 revenue page had no social/og tags, unlike every product page.
  for (const tag of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image', 'twitter:card']) assert.ok(html.includes(`${tag}"`) || html.includes(`${tag}="`), `${tag} present`);
  assert.match(html, /og:price:amount" content="3\.00"/, 'the og price matches the $3 plan');
});

test('a Transcribe Pro claim returns a key with voice instructions; a plain claim does not', async () => {
  const voice = await mf.dispatchFetch(`${O}/credits/claim?session_id=${SESSION}&for=voice`, { headers: { accept: 'application/json' } });
  assert.equal(voice.status, 200);
  const body = await voice.json();
  assert.match(body.apiKey, /^adt_/);
  assert.equal(body.creditsAdded, 3000);
  assert.equal(body.voicePro.hoursEachMonth, lib.voiceProHours(lib.ENDPOINTS.find((e) => e.path === '/transcribe/long').price, 3000));
  assert.ok(body.monthlyPlan, 'granted as a monthly plan');
  assert.ok(body.voicePro && body.voicePro.hoursEachMonth > 0);
  const html = await (await mf.dispatchFetch(`${O}/credits/claim?session_id=${SESSION}&for=voice`, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 Chrome/130' } })).text();
  assert.match(html, /You(&#39;|')re in\. Transcribe Pro is on\./);
  // 21 Nov 2026: the voice page has no "Fast mode"; the key goes into its Pro section, on the transcribe page itself.
  assert.match(html, /Already have an access key\?/);
  assert.match(html, /voice\.glyphcall\.com\/transcribe#fast/);
  const plain = await (await mf.dispatchFetch(`${O}/credits/claim?session_id=${SESSION}`, { headers: { accept: 'application/json' } })).json();
  assert.equal(plain.apiKey, body.apiKey, 'a repeat claim shows the same key');
  assert.equal(plain.voicePro, undefined);
});
