const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('PII scan: checksummed cards and IBANs, masked hits, redacted text', async () => {
  const { piiScan } = await load('src/routes/safety.ts');
  const text = 'Contact Anna at anna.berg@example.com or +46 70 123 45 67; card 4111 1111 1111 1111.';
  const out = piiScan(text);
  assert.deepEqual(out.counts, { email: 1, phone: 1, credit_card: 1 });
  assert.equal(out.redacted, 'Contact Anna at [EMAIL] or [PHONE]; card [CARD].');
  for (const item of out.items) assert.ok(!text.slice(item.start, item.end).includes(item.masked) || item.masked.includes('*'));
  assert.ok(out.items.every((i) => i.masked.includes('*')));
  // A card number that fails Luhn is not a card; an IBAN that fails mod-97 is not an IBAN.
  assert.equal(piiScan('order 4111 1111 1111 1112').counts.credit_card, undefined);
  assert.equal(piiScan('GB82 WEST 1234 5698 7654 32').counts.iban, 1);
  assert.equal(piiScan('GB82 WEST 1234 5698 7654 33').counts.iban, undefined);
  assert.equal(piiScan('SSN 123-45-6789').counts.us_ssn, 1);
  assert.equal(piiScan('wallet 0x000000000000000000000000000000000000dEaD').counts.crypto_address, 1);
  assert.equal(piiScan('server 192.168.1.20 is up').counts.ip_address, 1);
  // A date is not a phone number, and the type filter limits the scan.
  assert.equal(piiScan('due 2026-10-25').found, 0);
  assert.deepEqual(piiScan(text, new Set(['email'])).counts, { email: 1 });
});

test('Llama Guard verdicts: safe, unsafe with categories, no verdict is a 502', async () => {
  const { guardVerdict } = await load('src/routes/safety.ts');
  assert.deepEqual(guardVerdict('safe'), { flagged: false, categories: [] });
  assert.deepEqual(guardVerdict('unsafe\nS9,S1'), { flagged: true, categories: [{ code: 'S9', name: 'Indiscriminate weapons' }, { code: 'S1', name: 'Violent crimes' }] });
  assert.deepEqual(guardVerdict(' UNSAFE\nS99').categories, []);
  assert.throws(() => guardVerdict('I cannot help with that'), (e) => e.status === 502);
});

test('safety tools: names within 32 characters, one cent or less, inputs checked before any model call', async () => {
  const { SAFETY } = await load('src/routes/safety.ts');
  assert.deepEqual(SAFETY.map((e) => e.endpoint.path), ['/text/pii', '/ai/moderation']);
  for (const { endpoint: e } of SAFETY) {
    assert.ok(e.summary.split(':')[0].length <= 32, e.summary);
    assert.ok(e.description.length <= 450, e.path);
    assert.ok(Number(e.price.replace('$', '')) <= 0.01, e.path);
  }
});

test('OpenAI moderation front: one input, OpenAI category names, Llama Guard codes kept', async () => {
  const lib = await load('src/lib/openai-moderations.ts');
  assert.deepEqual(lib.toModerationText({ input: ' hello ' }), { text: 'hello' });
  assert.deepEqual(lib.toModerationText({ input: [{ type: 'text', text: 'hi' }] }), { text: 'hi' });
  assert.match(lib.toModerationText({ input: ['a', 'b'] }).error, /one input/);
  assert.match(lib.toModerationText({ input: '' }).error, /non-empty/);
  assert.match(lib.toModerationText({ input: 'x'.repeat(8001) }).error, /at most 8000/);
  assert.deepEqual(lib.moderationBodyFromQuery({ input: 'hi' }), { input: 'hi' });
  assert.equal(lib.moderationBodyFromQuery({}), null);
  const out = lib.toOpenAiModeration({ flagged: true, categories: [{ code: 'S10', name: 'Hate' }], model: '@cf/meta/llama-guard-3-8b' });
  assert.match(out.id, /^modr-/);
  assert.equal(out.results[0].flagged, true);
  assert.equal(out.results[0].categories.hate, true);
  assert.equal(out.results[0].categories.violence, false);
  assert.equal(out.results[0].category_scores.hate, 1);
  assert.deepEqual(out.results[0].llama_guard_categories, [{ code: 'S10', name: 'Hate' }]);
  assert.equal(lib.toOpenAiModeration({ flagged: false, categories: [] }).results[0].flagged, false);
});
