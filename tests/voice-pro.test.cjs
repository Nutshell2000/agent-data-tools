const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// Glyphcall Voice Pro (1.203.0, the owner's yes of 15 Nov 2026): the $9 plan under a voice name. Its checkout must be
// granted exactly like the $9 plan, its claim page must show voice instructions, and every hour figure must come from
// the live /transcribe/long price.
let mf;
let lib;
const O = 'https://api.test';
const SESSION = 'cs_live_' + 'a'.repeat(40);
const stripeSession = {
  id: SESSION, status: 'complete', payment_status: 'paid', mode: 'subscription', currency: 'usd', amount_total: 900,
  metadata: { adt_credits: '15000', plan: 'voice-pro' }, client_reference_id: null, subscription: 'sub_' + 'b'.repeat(24), invoice: 'in_' + 'c'.repeat(24),
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

test('the Voice Pro checkout matches the $9 plan, so verifyCheckout grants it', () => {
  const plan = lib.CREDIT_PLANS.find((p) => p.usdCents === 900);
  assert.equal(plan.credits, lib.VOICE_PRO_CREDITS);
  assert.match(lib.VOICE_PRO_URL, /^https:\/\/buy\.stripe\.com\//);
});

test('hours are computed from the catalog price of /transcribe/long', () => {
  const long = lib.ENDPOINTS.find((e) => e.path === '/transcribe/long').price;
  const credits = Math.round(Number(long.slice(1)) * 1000);
  assert.equal(lib.voiceProHours(long), Math.floor(lib.VOICE_PRO_CREDITS / credits));
});

test('/voice-pro shows the plan, the live hours and the checkout link', async () => {
  const r = await mf.dispatchFetch(`${O}/voice-pro`);
  assert.equal(r.status, 200);
  const html = await r.text();
  const long = lib.ENDPOINTS.find((e) => e.path === '/transcribe/long').price;
  assert.ok(html.includes(`about ${lib.voiceProHours(long)} hours`), 'hours from the live price');
  assert.ok(html.includes(lib.VOICE_PRO_URL));
  assert.ok(html.includes('rel="canonical"'));
  assert.doesNotMatch(html, /cheapest|unlimited/i, 'no claims we cannot back');
});

test('a Voice Pro claim returns a key with voice instructions; a plain claim does not', async () => {
  const voice = await mf.dispatchFetch(`${O}/credits/claim?session_id=${SESSION}&for=voice`, { headers: { accept: 'application/json' } });
  assert.equal(voice.status, 200);
  const body = await voice.json();
  assert.match(body.apiKey, /^adt_/);
  assert.equal(body.creditsAdded, 15000);
  assert.ok(body.monthlyPlan, 'granted as a monthly plan');
  assert.ok(body.voicePro && body.voicePro.hoursEachMonth > 0);
  const html = await (await mf.dispatchFetch(`${O}/credits/claim?session_id=${SESSION}&for=voice`, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 Chrome/130' } })).text();
  assert.match(html, /Welcome to Voice Pro/);
  assert.match(html, /Fast mode/);
  const plain = await (await mf.dispatchFetch(`${O}/credits/claim?session_id=${SESSION}`, { headers: { accept: 'application/json' } })).json();
  assert.equal(plain.apiKey, body.apiKey, 'a repeat claim shows the same key');
  assert.equal(plain.voicePro, undefined);
});
