const assert = require('node:assert/strict');
const { test } = require('node:test');

test('check:live recognises only the throttled-validator shape, not a real refusal', async () => {
  const { isValidatorGlitch } = await import('../scripts/validator-glitch.mjs');
  const required = (n, passed = false) => Array.from({ length: n }, () => ({ severity: 'required', passed }));
  const quote = [{ amount: '2000' }];
  assert.equal(isValidatorGlitch({ valid: false, preflight: required(21), simulation: { outcome: 'rejected' } }), true);
  assert.equal(isValidatorGlitch({ valid: false, preflight: required(21), simulation: { outcome: 'rejected' }, paymentRequirements: { accepts: [] } }), true);
  assert.equal(isValidatorGlitch({ valid: true, preflight: required(21, true), simulation: { outcome: 'accepted' }, paymentRequirements: { accepts: quote } }), false);
  assert.equal(isValidatorGlitch({ valid: false, preflight: required(1), simulation: { outcome: 'rejected' } }), false, 'a single failed check is a real refusal');
  assert.equal(isValidatorGlitch({ valid: false, preflight: required(21), simulation: { outcome: 'accepted' } }), false);
  assert.equal(isValidatorGlitch(null), false);
});
