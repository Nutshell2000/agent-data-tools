const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { encodePaymentRequiredHeader } = require('@x402/core/http');

const dir = path.join(__dirname, '..', 'clients', 'agent-data-tools');
const load = (f) => import(pathToFileURL(path.join(dir, f)).href);
const PAY_TO = '0x6293ded2684F1A76E26bEcef87c137D691Fbf800';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913';
const required = (amount = '2000') => ({
  x402Version: 2, error: 'Payment required', resource: { url: 'https://api.test/extract?url=x' },
  accepts: [{ scheme: 'exact', network: 'eip155:8453', amount, asset: USDC, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } }],
});
const payer = (guard, signed) => ({ address: '0xabc', guard, sign: async (pr, offer) => { signed.push({ pr, offer }); return { x402Version: 2, payload: 'signed' }; } });

test('payingFetch pays a 402 once and returns the paid result', async () => {
  const { payingFetch, spendGuard } = await load('wallet-pay.mjs');
  const guard = spendGuard({ maxUsd: 0.1, dailyUsd: 1 }), signed = [];
  // Headers object carries .get; detect the signature through it
  const baseFetch = async (url, init) => {
    const h = init.headers;
    const isPaid = h && typeof h.get === 'function' && h.get('PAYMENT-SIGNATURE');
    if (!isPaid) return new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(required()) } });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const fetched = payingFetch(payer(guard, signed), baseFetch);
  const res = await fetched('https://api.test/extract?url=x', { headers: { accept: 'application/json' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(signed.length, 1);
  assert.equal(signed[0].offer.payTo, PAY_TO);
  assert.equal(guard.spentToday, 0.002);
});

test('payingFetch passes non-402 responses through and never signs', async () => {
  const { payingFetch, spendGuard } = await load('wallet-pay.mjs');
  const signed = [];
  const baseFetch = async () => new Response(JSON.stringify({ hi: 1 }), { status: 200 });
  const res = await payingFetch(payer(spendGuard({ maxUsd: 0.1, dailyUsd: 1 }), signed), baseFetch)('https://api.test/time');
  assert.equal(res.status, 200);
  assert.equal(signed.length, 0);
});

test('payingFetch returns the server 402 unchanged when the payer refuses (over cap)', async () => {
  const { payingFetch, spendGuard } = await load('wallet-pay.mjs');
  const signed = [];
  const baseFetch = async () => new Response(JSON.stringify({ error: 'pay' }), { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(required('500000')) } });
  const res = await payingFetch(payer(spendGuard({ maxUsd: 0.01, dailyUsd: 1 }), signed), baseFetch)('https://api.test/extract');
  assert.equal(res.status, 402);
  assert.match(await res.text(), /pay/);
  assert.equal(signed.length, 0);
});
