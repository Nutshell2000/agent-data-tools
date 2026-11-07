// 7 Nov 2026: /crypto/price (CoinGecko) and /swap/quote (LI.FI) failed their own listed examples from Cloudflare, because
// both upstreams answer Workers with 429. These pin the fallbacks: Coinbase for coin prices, our ticker table for tokens.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test('crypto prices come from Coinbase for the coins it trades, with the 24-hour change and no market cap', async () => {
  const { cryptoPrices } = await load('src/lib/coin-prices.ts');
  const asked = [];
  const get = async (url) => {
    asked.push(url);
    if (url.includes('exchange.coinbase.com/products/BTC-USD/stats')) return { open: '100000', last: '102000' };
    if (url.includes('exchange.coinbase.com/products/ETH-USD/stats')) return { open: '2000', last: '1900' };
    if (url.includes('/v2/prices/BTC-EUR/spot')) return { data: { amount: '95000.5' } };
    if (url.includes('/v2/prices/ETH-EUR/spot')) return { data: { amount: '1780' } };
    throw new Error(`unexpected ${url}`);
  };
  const r = await cryptoPrices(['bitcoin', 'ETH'], ['usd', 'eur'], get);
  assert.deepEqual(r.prices.bitcoin, { usd: 102000, usd_24h_change: 2, usd_market_cap: null, eur: 95000.5, eur_24h_change: 2, eur_market_cap: null });
  assert.equal(r.prices.ethereum.usd, 1900);
  assert.equal(r.prices.ethereum.usd_24h_change, -5);
  assert.deepEqual(r.missing, []);
  assert.equal(r.source, 'Coinbase');
  assert.ok(!asked.some((u) => u.includes('coingecko')), 'CoinGecko is not asked for coins Coinbase trades');
});

test('coins Coinbase does not trade go to CoinGecko, and its refusal leaves them missing instead of failing the call', async () => {
  const { cryptoPrices } = await load('src/lib/coin-prices.ts');
  const get = async (url) => {
    if (url.includes('exchange.coinbase.com/products/SOL-USD/stats')) return { open: '80', last: '88' };
    if (url.includes('coingecko')) throw new Error('HTTP 429');
    throw new Error(`unexpected ${url}`);
  };
  const r = await cryptoPrices(['solana', 'some-obscure-coin'], ['usd'], get);
  assert.equal(r.prices.solana.usd, 88);
  assert.equal(r.prices.solana.usd_24h_change, 10);
  assert.deepEqual(r.missing, ['some-obscure-coin']);
  const ok = await cryptoPrices(['some-obscure-coin'], ['usd'], async (url) => (url.includes('coingecko') ? { 'some-obscure-coin': { usd: 1.5 } } : null));
  assert.equal(ok.prices['some-obscure-coin'].usd, 1.5);
  assert.equal(ok.source, 'CoinGecko');
});

test('swap tokens resolve from our checked table when LI.FI cannot be asked', async () => {
  const { knownToken } = await load('src/routes/lifi.ts');
  assert.deepEqual(knownToken('8453', 'USDC'), { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, chainId: 8453 });
  assert.deepEqual(knownToken('8453', 'eth'), { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18, chainId: 8453 });
  assert.equal(knownToken('137', 'ETH').symbol, 'WETH', 'ETH on Polygon is the wrapped token, not the native coin');
  assert.equal(knownToken('1', 'WBTC').decimals, 8);
  assert.equal(knownToken('8453', 'DEGEN'), null, 'unknown decimals: no guess');
  assert.equal(knownToken('56', 'USDC'), null, 'networks outside the table: no guess (BSC USDC has 18 decimals)');
  assert.equal(knownToken('8453', 'constructor'), null);
});
