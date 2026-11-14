const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Wallet mode of the npm client's MCP proxy: a tool call that comes back as an x402 payment request is paid and sent
// once more. The server is a fake fetch; the last test signs for real with Hardhat's public test key #0 (no funds, no network).
const dir = path.join(__dirname, '..', 'clients', 'agent-data-tools');
const load = (f) => import(pathToFileURL(path.join(dir, f)).href);
const PAY_TO = '0x6293ded2684F1A76E26bEcef87c137D691Fbf800';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const quote = (amount = '2000', extra = {}) => ({
  x402Version: 2, error: 'Payment required', resource: { url: 'mcp://tool/weather' },
  accepts: [
    { scheme: 'exact', network: 'eip155:137', amount, asset: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } },
    { scheme: 'exact', network: 'eip155:8453', amount, asset: USDC, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' }, ...extra },
  ],
});
const needsPayment = (id, q = quote()) => ({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify(q) }], structuredContent: q } });
const call = (id, name = 'weather') => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { city: 'Lisbon' } } });
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function server(answerPaid = (id) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '{"tempC":18}' }] } })) {
  const bodies = [];
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return json(body.params?._meta?.['x402/payment'] ? answerPaid(body.id) : needsPayment(body.id));
  };
  return { bodies, fetch };
}

test('a payment request is paid from the wallet and the client sees only the answer', async () => {
  const { forward } = await load('mcp-stdio.mjs');
  const { spendGuard } = await load('wallet-pay.mjs');
  const s = server(), wrote = [], signed = [];
  const payer = { address: '0xabc', guard: spendGuard({ maxUsd: 0.1, dailyUsd: 1 }), sign: async (pr, offer) => { signed.push(offer); return { x402Version: 2, payload: 'signed' }; } };
  await forward({ url: 'https://x.example/mcp', payer, session: {}, write: (m) => wrote.push(m), fetch: s.fetch }, call(7));
  assert.equal(s.bodies.length, 2);
  assert.deepEqual(s.bodies[1].params._meta['x402/payment'], { x402Version: 2, payload: 'signed' });
  assert.deepEqual(s.bodies[1].params.arguments, { city: 'Lisbon' });
  assert.equal(signed[0].network, 'eip155:8453');
  assert.equal(wrote.length, 1);
  assert.equal(wrote[0].id, 7);
  assert.equal(wrote[0].result.isError, undefined);
  assert.equal(payer.guard.spentToday, 0.002);
});

test('without a payer the payment request passes through untouched', async () => {
  const { forward } = await load('mcp-stdio.mjs');
  const s = server(), wrote = [];
  await forward({ url: 'https://x.example/mcp', session: {}, write: (m) => wrote.push(m), fetch: s.fetch }, call(1));
  assert.equal(s.bodies.length, 1);
  assert.equal(wrote[0].result.isError, true);
});

test('a call over the per-call limit is not signed and the request is shown as the server sent it', async () => {
  const { forward } = await load('mcp-stdio.mjs');
  const { spendGuard } = await load('wallet-pay.mjs');
  const wrote = []; let signs = 0;
  const fetch = async (_u, init) => json(needsPayment(JSON.parse(init.body).id, quote('1000000')));
  const payer = { address: '0xabc', guard: spendGuard({ maxUsd: 0.1, dailyUsd: 1 }), sign: async () => { signs++; return {}; } };
  await forward({ url: 'https://x.example/mcp', payer, session: {}, write: (m) => wrote.push(m), fetch }, call(2));
  assert.equal(signs, 0);
  assert.equal(wrote.length, 1);
  assert.equal(wrote[0].result.isError, true);
  assert.equal(payer.guard.spentToday, 0);
});

test('a paid call that fails gives its reserved amount back, and it is tried only once', async () => {
  const { forward } = await load('mcp-stdio.mjs');
  const { spendGuard } = await load('wallet-pay.mjs');
  const s = server((id) => ({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'city not found' }] } })), wrote = [];
  const payer = { address: '0xabc', guard: spendGuard({ maxUsd: 0.1, dailyUsd: 1 }), sign: async () => ({ p: 1 }) };
  await forward({ url: 'https://x.example/mcp', payer, session: {}, write: (m) => wrote.push(m), fetch: s.fetch }, call(3));
  assert.equal(s.bodies.length, 2);
  assert.equal(wrote.length, 1);
  assert.equal(wrote[0].result.content[0].text, 'city not found');
  assert.equal(payer.guard.spentToday, 0);
});

test('spend limits: daily total, wrong payee, other networks only, malformed amount', async () => {
  const { spendGuard, baseOffer, paymentRequiredOf, limitsFromEnv } = await load('wallet-pay.mjs');
  const g = spendGuard({ maxUsd: 0.01, dailyUsd: 0.005, payTo: PAY_TO });
  assert.equal(g.take(quote('2000')).usd, 0.002);
  assert.equal(g.take(quote('2000')).usd, 0.002);
  assert.throws(() => g.take(quote('2000')), /daily limit/);
  g.refund(0.002);
  assert.equal(g.take(quote('2000')).usd, 0.002);
  assert.throws(() => spendGuard({ maxUsd: 1, dailyUsd: 1, payTo: '0x0000000000000000000000000000000000000001' }).take(quote()), /other than/);
  assert.throws(() => spendGuard({ maxUsd: 1, dailyUsd: 1 }).take({ x402Version: 2, accepts: [quote().accepts[0]] }), /no USDC-on-Base/);
  assert.throws(() => spendGuard({ maxUsd: 1, dailyUsd: 1 }).take(quote('2e3')), /whole number/);
  assert.equal(baseOffer(quote()).network, 'eip155:8453');
  assert.equal(paymentRequiredOf({ isError: true, content: [{ type: 'text', text: 'plain error' }] }), null);
  assert.equal(paymentRequiredOf({ content: [{ type: 'text', text: JSON.stringify(quote()) }] }), null);
  assert.deepEqual(limitsFromEnv({}), { maxUsd: 0.1, dailyUsd: 1, chain: { network: 'eip155:8453', asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' } });
  assert.equal(limitsFromEnv({ AGENT_DATA_TOOLS_MAX_USD: '0.5', AGENT_DATA_TOOLS_DAILY_USD: '5' }).maxUsd, 0.5);
  assert.equal(limitsFromEnv({ AGENT_DATA_TOOLS_TESTNET: '1' }).chain.network, 'eip155:84532');
  assert.throws(() => limitsFromEnv({ AGENT_DATA_TOOLS_MAX_USD: 'lots' }), /dollar amount/);
});

test('a real signature: the payload authorizes exactly the quoted USDC amount to the quoted payee on Base', async () => {
  const { walletPayer } = await load('wallet-pay.mjs');
  // Hardhat's published test account #0: a public key with no funds, used here only to produce a signature.
  const payer = await walletPayer({ key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', maxUsd: 0.1, dailyUsd: 1 });
  assert.equal(payer.address, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  const q = quote('2000');
  const { offer } = payer.guard.take(q);
  const payment = await payer.sign(q, offer);
  const auth = payment.payload.authorization;
  assert.equal(payment.accepted.network, 'eip155:8453');
  assert.equal(auth.value, '2000');
  assert.equal(auth.to.toLowerCase(), PAY_TO.toLowerCase());
  assert.equal(auth.from, payer.address);
  assert.match(payment.payload.signature, /^0x[0-9a-f]{130}$/);
  await assert.rejects(walletPayer({ key: 'not-a-key', maxUsd: 0.1, dailyUsd: 1 }), /32-byte hex/);
});
