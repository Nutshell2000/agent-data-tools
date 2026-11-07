const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

// The hosted browser module only runs on Workers; the scoring helpers are pure and tested without it.
async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent', external: ['@cloudflare/puppeteer'] });
  const m = { exports: {} };
  const req = (id) => (id === '@cloudflare/puppeteer' ? { default: {} } : require(id));
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}

test('website audit: accessibility score weighs rules by impact and lists the worst first', async () => {
  const { __test: { accessibilityReport } } = await load('src/routes/site-audit.ts');
  const r = accessibilityReport({
    violations: [
      { id: 'region', impact: 'moderate', help: 'Content in landmarks', helpUrl: 'u1', tags: ['wcag2a'], nodes: 9, targets: ['div'] },
      { id: 'image-alt', impact: 'critical', help: 'Images need alt text', helpUrl: 'u2', tags: ['wcag2a', 'wcag111'], nodes: 2, targets: ['img.logo'] },
      { id: 'color-contrast', impact: 'serious', help: 'Contrast', helpUrl: 'u3', tags: ['wcag2aa'], nodes: 4, targets: ['.x'] },
    ],
    passes: 30, incomplete: 2,
  });
  assert.equal(r.score, 100 - 15 - 8 - 3);
  assert.deepEqual(r.bySeverity, { critical: 1, serious: 1, moderate: 1, minor: 0 });
  assert.deepEqual(r.issues.map((i) => i.rule), ['image-alt', 'color-contrast', 'region']);
  assert.equal(r.affectedElements, 15);
  assert.equal(r.passedRules, 30);
  assert.match(r.engine, /^axe-core 4\./);
  // Many violations never go below zero.
  const many = accessibilityReport({ violations: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, impact: 'critical', help: 'h', helpUrl: '', tags: [], nodes: 1, targets: [] })), passes: 0, incomplete: 0 });
  assert.equal(many.score, 0);
  assert.equal(many.issues.length, 20);
});

test('website audit: performance report sums weight and flags slow LCP, layout shift and heavy pages', async () => {
  const { __test: { performanceReport } } = await load('src/routes/site-audit.ts');
  const fast = performanceReport({ ttfb: 90.4, dcl: 300, load: 600, fcp: 250, lcp: 400, cls: 0.01, navBytes: 20000, resources: [{ type: 'script', bytes: 50000, thirdParty: false }, { type: 'img', bytes: 30000, thirdParty: true }], domElements: 500 });
  assert.equal(fast.score, 100);
  assert.equal(fast.transferBytes, 100000);
  assert.equal(fast.requests, 3);
  assert.equal(fast.thirdPartyRequests, 1);
  assert.equal(fast.timeToFirstByteMs, 90);
  assert.deepEqual(fast.byType.script, { requests: 1, bytes: 50000 });
  const slow = performanceReport({ ttfb: 1200, dcl: 0, load: null, fcp: null, lcp: 5200, cls: 0.3, navBytes: 5_000_000, resources: [], domElements: 4000 });
  assert.equal(slow.score, 100 - 30 - 20 - 10 - 15 - 5);
  assert.equal(slow.domContentLoadedMs, null);
  assert.equal(slow.issues.length, 5);
  assert.ok(slow.issues[0].startsWith('largest contentful paint 5200 ms'));
});

test('text to speech: model output in any of its shapes becomes base64 audio', async () => {
  const { audioToBase64, SPEECH_VOICES, SPEECH_MAX, SPEECH_PRICE } = await load('src/routes/ai-text.ts');
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 4, 0]);
  const b64 = Buffer.from(bytes).toString('base64');
  assert.equal(await audioToBase64(bytes), b64);
  assert.equal(await audioToBase64(bytes.buffer), b64);
  assert.equal(await audioToBase64(new Response(bytes).body), b64);
  assert.equal(await audioToBase64({ audio: 'QUJD' }), 'QUJD');
  assert.equal(await audioToBase64(null), '');
  assert.ok(SPEECH_VOICES.en.includes('luna') && SPEECH_VOICES.es.includes('aquila'));
  // Aura-2 costs $0.03 per 1,000 characters: the longest text must cost less than the price.
  assert.ok(SPEECH_MAX * 0.03 / 1000 < Number(SPEECH_PRICE.slice(1)));
});
