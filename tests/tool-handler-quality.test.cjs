// Tool handler quality batch, 21 Nov 2026: inputs a willing caller sent that were refused for their form (a ticker on
// the later networks, a regional language tag, a three-letter country code), failures of an outside source that were
// reported as the caller's mistake or as our own error, and a register retry that could not happen. Network is mocked.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');
const { decodeFunctionData, encodeFunctionResult, encodeAbiParameters, multicall3Abi, toFunctionSelector } = require('viem');

const cache = new Map();
async function load(entry) {
  if (cache.has(entry)) return cache.get(entry);
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    plugins: [{ name: 'url', setup(p) { p.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  cache.set(entry, m.exports);
  return m.exports;
}
const q = (values) => (name) => values[name];
const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => { const url = String(input instanceof Request ? input.url : input); calls.push(url); return handler(url, init); };
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}

// ---- A JSON-RPC node that knows one ERC-20 token, one contract that is not a token, and can be switched off. ----
const SEL = Object.fromEntries(['name()', 'symbol()', 'decimals()', 'totalSupply()', 'balanceOf(address)', 'allowance(address,address)'].map((s) => [toFunctionSelector(s), s]));
const word = (type, v) => encodeAbiParameters([{ type }], [v]);
const TOKEN_ANSWERS = { 'name()': word('string', 'USD Coin'), 'symbol()': word('string', 'USDC'), 'decimals()': word('uint256', 6n), 'totalSupply()': word('uint256', 10n ** 15n), 'balanceOf(address)': word('uint256', 2500000n), 'allowance(address,address)': word('uint256', 0n) };
function node({ tokens, others = [], down = false }) {
  const isToken = (a) => tokens.includes(String(a).toLowerCase());
  const hasCode = (a) => isToken(a) || others.includes(String(a).toLowerCase());
  const answer = (to, data) => (isToken(to) ? TOKEN_ANSWERS[SEL[data.slice(0, 10)]] ?? null : null);
  const one = ({ method, params, id }) => {
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    if (down && method !== 'eth_getCode') return { jsonrpc: '2.0', id, error: { code: -32005, message: 'rate limit exceeded' } };
    if (method === 'eth_chainId') return ok('0x1');
    if (method === 'eth_blockNumber') return ok('0x100');
    if (method === 'eth_getCode') return ok(hasCode(params[0]) ? '0x6080' : '0x');
    if (method === 'eth_call') {
      const { to, data } = params[0];
      if (data.startsWith('0x82ad56cb')) {
        const { args } = decodeFunctionData({ abi: multicall3Abi, data });
        return ok(encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: args[0].map((c) => { const r = answer(c.target, c.callData); return { success: r !== null, returnData: r ?? '0x' }; }) }));
      }
      const r = answer(to, data);
      return r === null ? { jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted' } } : ok(r);
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `no mock for ${method}` } };
  };
  return async (_url, init) => { const body = JSON.parse(init.body); return json(Array.isArray(body) ? body.map(one) : one(body)); };
}
const WALLET = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
const NOT_A_TOKEN = '0x00000000000000000000000000000000000000aa';

test('the later networks take token=USDC, as their listings say, and name USDC when another ticker is sent', async () => {
  const { CHAIN_READS, USDC } = await load('src/routes/chain-reads.ts');
  const tool = (path) => CHAIN_READS.find((e) => e.endpoint.path === path).run;
  for (const slug of ['linea', 'scroll', 'mantle', 'gnosis', 'celo', 'avax']) {
    const usdc = USDC[slug];
    await withFetch(node({ tokens: [usdc.toLowerCase()] }), async () => {
      for (const sent of ['USDC', 'usdc', '$USDC', 'usd-coin']) {
        const info = await tool(`/${slug}/token-info`)({}, q({ token: sent }));
        assert.equal(info.token, usdc, `${slug} token-info ${sent}`);
        assert.equal(info.symbol, 'USDC');
      }
      assert.equal((await tool(`/${slug}/token-balance`)({}, q({ token: 'USDC', address: WALLET }))).balance, '2.5');
      assert.equal((await tool(`/${slug}/allowance`)({}, q({ token: 'USDC', owner: WALLET, spender: PERMIT2 }))).unlimited, false);
      // These networks have a ticker table since quality round two (lib/tickers.ts): an unknown ticker is refused with the tickers the network knows.
      await assert.rejects(tool(`/${slug}/token-info`)({}, q({ token: 'ZZZQ' })), (e) => e.status === 400 && /"ZZZQ"/.test(e.message) && /USDC/.test(e.message) && /0x address/.test(e.message));
    });
  }
  // zkSync Era and HyperEVM have no table: USDC is the only ticker there and the refusal says so.
  for (const slug of ['zksync', 'hyperevm']) {
    await assert.rejects(tool(`/${slug}/token-info`)({}, q({ token: 'USDT' })), (e) => e.status === 400 && /"USDT"/.test(e.message) && /USDC is the only ticker/.test(e.message) && /0x address/.test(e.message));
  }
  // The five first networks keep their own ticker table and its list of tickers in the refusal.
  await assert.rejects(tool('/eth/token-info')({}, q({ token: 'zzz' })), (e) => e.status === 400 && /\(ETH, /.test(e.message));
});

test('a node that fails during the token reads is a 502, not "this contract does not behave like an ERC-20 token"', async () => {
  const { CHAIN_READS, USDC, nodeFailed } = await load('src/routes/chain-reads.ts');
  const tool = (path) => CHAIN_READS.find((e) => e.endpoint.path === path).run;
  const usdc = USDC.linea.toLowerCase();
  await withFetch(node({ tokens: [usdc], down: true }), async () => {
    await assert.rejects(tool('/linea/token-info')({}, q({ token: usdc })), (e) => e.status === 502 && /public nodes did not answer/.test(e.message));
    await assert.rejects(tool('/linea/token-balance')({}, q({ token: usdc, address: WALLET })), (e) => e.status === 502);
  });
  // A contract that is not a token is still the caller's input (422), and an address with no contract names the input.
  await withFetch(node({ tokens: [usdc], others: [NOT_A_TOKEN] }), async () => {
    await assert.rejects(tool('/linea/token-info')({}, q({ token: NOT_A_TOKEN })), (e) => e.status === 422 && /does not behave like an ERC-20/.test(e.message));
    await assert.rejects(tool('/linea/token-balance')({}, q({ token: NOT_A_TOKEN, address: WALLET })), (e) => e.status === 422);
    for (const [path, extra] of [['/linea/token-info', {}], ['/linea/token-balance', { address: WALLET }], ['/linea/allowance', { owner: WALLET, spender: PERMIT2 }]]) {
      await assert.rejects(tool(path)({}, q({ token: WALLET, ...extra })), (e) => e.status === 404 && /^token: no contract at this address on Linea/.test(e.message) && /different contract address on each network/.test(e.message), path);
    }
  });
  assert.equal(nodeFailed(Object.assign(new Error('HTTP request failed.'), { name: 'HttpRequestError' })), true);
  assert.equal(nodeFailed(Object.assign(new Error('outer'), { name: 'ContractFunctionExecutionError', cause: Object.assign(new Error('took too long'), { name: 'TimeoutError' }) })), true);
  assert.equal(nodeFailed(Object.assign(new Error('outer'), { name: 'ContractFunctionExecutionError', cause: Object.assign(new Error('execution reverted'), { name: 'RpcRequestError' }) })), false);
  assert.equal(nodeFailed(Object.assign(new Error('The contract function "decimals" returned no data ("0x").'), { name: 'ContractFunctionZeroDataError' })), false);
  assert.equal(nodeFailed(new Error('something of ours')), false);
});

test('language inputs: a regional tag, a three-letter code or a name is the code it stands for', async () => {
  const { languageCode, speechLangOf, retiredSpeechLang } = await load('src/lib/melo.ts');
  for (const [raw, code] of [['German', 'de'], ['deu', 'de'], ['ger', 'de'], ['de-DE', 'de'], ['swe', 'sv'], ['Swedish', 'sv'], ['svenska', 'sv'], ['pt-BR', 'pt'], ['por', 'pt'], ['Português', 'pt'], ['nld', 'nl'], ['ita', 'it'], ['en', 'en'], ['spa', 'es'], ['jpn', 'ja']]) assert.equal(languageCode(raw), code, raw);
  assert.equal(speechLangOf('German'), undefined, 'the speech tools still speak en and es only');
  assert.equal(retiredSpeechLang('German'), undefined);
  assert.equal(languageCode('constructor'), 'constructor', 'a prototype name is not a language');
});

test('/dub and /voice/agent take en-US and eng, and each refusal names the input that was sent', async () => {
  const { dubTarget } = await load('src/routes/voice-plus.ts');
  for (const [raw, code] of [['en-US', 'en'], ['en_GB', 'en'], ['eng', 'en'], ['English', 'en'], ['es-MX', 'es'], ['es-419', 'es'], ['spa', 'es'], ['ES', 'es']]) assert.equal(dubTarget(raw), code, raw);
  assert.throws(() => dubTarget('sv'), (e) => e.status === 400 && /^to must be one of en, es/.test(e.message));
  assert.throws(() => dubTarget('de-DE', 'lang'), (e) => e.status === 400 && /^lang must be one of en, es/.test(e.message));
  assert.throws(() => dubTarget('fr-CA'), (e) => e.status === 422 && /fr speech is retired/.test(e.message));
  assert.throws(() => dubTarget('constructor'), (e) => e.status === 400);
});

test('the transcription tools read swe as Swedish, not as its first two letters, and refuse what they cannot read', async () => {
  const { languageInput } = await load('src/routes/voice.ts');
  assert.equal(languageInput(q({})), '');
  for (const [raw, code] of [['sv', 'sv'], ['swe', 'sv'], ['Swedish', 'sv'], ['spa', 'es'], ['en-US', 'en'], ['pt_BR', 'pt'], ['jpn', 'ja'], ['German', 'de']]) assert.equal(languageInput(q({ language: raw })), code, raw);
  for (const raw of ['xyz', 'klingon', 'e', '12']) assert.throws(() => languageInput(q({ language: raw })), (e) => e.status === 400 && /^language must be a two-letter code/.test(e.message), raw);
});

test('/ai/translate, the e-invoice PDF and keyword ideas take regional tags and names', async () => {
  const { AI_TEXT } = await load('src/routes/ai-text.ts');
  const translate = AI_TEXT.find((e) => e.endpoint.path === '/ai/translate').run;
  // No model is bound here, so a request that passes the language check ends 502; one that fails it ends 400.
  for (const to of ['en-US', 'pt_BR', 'German', 'deu', 'zh-CN', 'sv']) await assert.rejects(Promise.resolve().then(() => translate({}, q({ text: 'hi', to }))), (e) => e.status !== 400, to);
  for (const to of ['zh-TW', 'zh-Hant', 'elvish', '']) await assert.rejects(Promise.resolve().then(() => translate({}, q({ text: 'hi', to }))), (e) => e.status === 400 && /^to must be a language code/.test(e.message), to);

  const einvoice = await load('src/routes/einvoice.ts');
  const create = einvoice.EINVOICE.find((e) => e.endpoint.path === '/einvoice/create').run;
  for (const language of ['German', 'de-DE', 'deu', 'en-GB', 'English']) {
    const pdf = await create({}, q({ invoice: einvoice.EXAMPLE_INVOICE_JSON, format: 'zugferd-pdf', language }));
    assert.equal(pdf.format, 'zugferd-pdf', language);
  }
  assert.throws(() => create({}, q({ invoice: einvoice.EXAMPLE_INVOICE_JSON, format: 'zugferd-pdf', language: 'fr-FR' })), /language must be one of: de, en/);

  const { keywordIdeas } = await load('src/routes/keywords.ts');
  await withFetch(() => json(['x', ['x one', 'x two']]), async (calls) => {
    const out = await keywordIdeas('coffee', { lang: 'en-US', country: 'us', engines: 'google' });
    assert.equal(out.lang, 'en');
    assert.ok(calls.some((u) => u.includes('hl=en&')), 'the engine is asked in en');
    await assert.rejects(keywordIdeas('coffee', { lang: 'elvish', country: 'us' }), (e) => e.status === 400);
  });
});

test('/wikipedia reads en-US as the English edition and keeps the editions whose code has a hyphen', async () => {
  const { PUBLIC_DATA } = await load('src/routes/public-data.ts');
  const wiki = PUBLIC_DATA.find((e) => e.endpoint.path === '/wikipedia').run;
  const page = { title: 'Stockholm', extract: 'Stockholm is the capital of Sweden.', type: 'standard' };
  await withFetch(() => json(page), async (calls) => {
    await wiki({}, q({ title: 'Stockholm', lang: 'en-US' }));
    await wiki({}, q({ title: 'Stockholm', lang: 'pt_BR' }));
    await wiki({}, q({ title: 'Stockholm', lang: 'zh-yue' }));
    await wiki({}, q({ title: 'Stockholm', lang: 'simple' }));
    assert.deepEqual(calls.map((u) => new URL(u).host), ['en.wikipedia.org', 'pt.wikipedia.org', 'zh-yue.wikipedia.org', 'simple.wikipedia.org']);
  });
});

test('a country list takes three-letter codes and the names countries call themselves, and its refusal says what is accepted', async () => {
  const { countriesOf } = await load('src/routes/company-search.ts');
  assert.deepEqual(countriesOf('SWE'), ['SE']);
  assert.deepEqual(countriesOf('deu, FRA; nor'), ['DE', 'FR', 'NO']);
  assert.deepEqual(countriesOf('Deutschland, Sverige, España, Suomi'), ['DE', 'SE', 'ES', 'FI']);
  assert.deepEqual(countriesOf('SE, Germany, UK, EL'), ['SE', 'DE', 'GB', 'GR']);
  assert.equal(countriesOf('EU'), null);
  assert.equal(countriesOf(undefined), null);
  for (const bad of ['Atlantis', 'XXX', 'constructor', '__proto__', 'toString']) {
    assert.throws(() => countriesOf(bad), (e) => e.status === 400 && e.message.startsWith(`country "${bad}" is not a country code or name`) && /ISO codes such as SE or DEU/.test(e.message), bad);
  }
});

test('the Norwegian register is asked once more after a request that did not answer, and only once', async () => {
  const { noLookup } = await load('src/routes/nordic-company.ts');
  const unit = { organisasjonsnummer: '923609016', navn: 'EQUINOR ASA', organisasjonsform: { kode: 'ASA', beskrivelse: 'Allmennaksjeselskap' } };
  let n = 0;
  await withFetch(() => { if (n++ === 0) throw new TypeError('fetch failed'); return json(unit); }, async (calls) => {
    const out = await noLookup('923609016');
    assert.equal(out.name, 'EQUINOR ASA');
    assert.equal(calls.length, 2);
  });
  await withFetch(() => { throw new TypeError('fetch failed'); }, async (calls) => {
    await assert.rejects(noLookup('923609016'), (e) => e.status === 502 && /did not answer in time/.test(e.message) && /nothing was charged/.test(e.message));
    assert.equal(calls.length, 2, 'two tries, not three');
  });
  // A number the register does not hold is final: one request, no retry.
  await withFetch(() => json({}, 404), async (calls) => {
    await assert.rejects(noLookup('923609016'), (e) => e.status === 404);
    assert.equal(calls.length, 1);
  });
});

test('a prototype name sent as a table key is an unknown value, never a table entry', async () => {
  const HOSTILE = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
  const { morse } = await load('src/routes/calc.ts');
  const { stockScreen } = await load('src/routes/stocks.ts');
  const { normalizeZone } = await load('src/routes/time.ts');
  const { exchangeRates } = await load('src/routes/rates.ts');
  const { packageAudit } = await load('src/routes/package-audit.ts');
  const { analyze } = await load('src/routes/x402-check.ts');
  const { DEFI_YIELDS } = await load('src/routes/defi-yields.ts');
  for (const h of HOSTILE) {
    const decoded = morse(h, 'decode');
    assert.equal(decoded.result, '', h);
    assert.deepEqual(decoded.unknown, [h]);
    await assert.rejects(stockScreen(h), (e) => e.status === 400 && /screen must be one of/.test(e.message), h);
    assert.equal(normalizeZone(h), h, 'a zone that is no city is passed on as written');
    await assert.rejects(exchangeRates(h, 'EUR'), (e) => e.status === 400, h);
    await assert.rejects(packageAudit(`${h}:left-pad@1.0.0`), (e) => e.status === 400 && /ecosystem must be one of/.test(e.message), h);
    const terms = analyze('https://seller.example/tool', 402, null, JSON.stringify({ x402Version: 1, accepts: [{ network: h, asset: h, maxAmountRequired: '1000', payTo: '0x0000000000000000000000000000000000000001' }] }));
    assert.equal(terms.accepts[0].network, h);
    assert.equal(terms.accepts[0].assetIsNativeUsdc, false);
  }
  assert.equal(morse('... --- ...', 'auto').result, 'SOS');
  assert.equal(normalizeZone('Tokyo'), 'Asia/Tokyo');
  // The yields filter reads a chain alias from its table and anything else as written.
  const pools = { status: 'success', data: [{ chain: 'Ethereum', project: 'aave-v3', symbol: 'USDC', tvlUsd: 5e8, apy: 4.2, apyBase: 4.2, apyReward: null, stablecoin: true, ilRisk: 'no', exposure: 'single', pool: 'p1' }] };
  await withFetch(() => json(pools), async () => {
    const run = DEFI_YIELDS[0].run;
    const eth = await run({}, q({ chain: 'eth' }));
    assert.equal(eth.pools.length, 1);
    await assert.rejects(run({}, q({ chain: 'constructor' })), (e) => e.status === 404 && /no pool matches/.test(e.message));
  });
});

// ---- Answers of outside sources that are not what the source documents ----
let ALL;
async function allTools() {
  if (ALL) return ALL;
  const b = await build({ stdin: { contents: 'export { TOOLS } from "./src/tools"; export { ENDPOINTS } from "./src/endpoints";', resolveDir: process.cwd(), sourcefile: 'quality.ts', loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return (ALL = m.exports);
}
const exampleOf = (ep) => Object.fromEntries(Object.entries(ep.params).filter(([, v]) => v.example !== undefined).map(([k, v]) => [k, String(v.example)]));
const page = () => new Response('<!doctype html><html><body>Access denied</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });

test('a source that answers 200 with a web page, an empty body or null is a 502 that names it, not an internal error', async () => {
  const { TOOLS, ENDPOINTS } = await allTools();
  const paths = ['/fx', '/fx/all', '/fx/symbols', '/btc-price', '/weather', '/domain', '/email', '/package', '/github/repo', '/github/search', '/github/releases', '/ip/lookup',
    '/sec/filings', '/sec/8k', '/sec/insider', '/sec/13f', '/gov/federal-register', '/gov/clinical-trials', '/contract/abi', '/hyperliquid/prices', '/hyperliquid/market', '/crypto/fear-greed', '/geocode/reverse', '/airport/status'];
  const bodies = { page, empty: () => new Response('', { status: 200, headers: { 'content-type': 'application/json' } }), nothing: () => json('null') };
  for (const path of paths) {
    const ep = ENDPOINTS.find((e) => e.path === path);
    assert.ok(ep && TOOLS[path], path);
    for (const [kind, body] of Object.entries(bodies)) {
      if (path === '/airport/status' && kind === 'nothing') continue; // its source is XML; the word null is covered by the feed check below
      await withFetch(body, () => assert.rejects(Promise.resolve().then(() => TOOLS[path]({}, q(exampleOf(ep)))), (e) => e.status === 502 && typeof e.message === 'string' && e.message.length > 10, `${path} ${kind}`));
    }
  }
  const { sourceJson } = await load('src/lib/source-json.ts');
  await assert.rejects(sourceJson(page(), 'the example source'), (e) => e.status === 502 && e.message === 'the example source sent an answer that could not be read; nothing was charged, try again');
  assert.deepEqual(await sourceJson(json({ a: 1 }), 'x'), { a: 1 });
  assert.deepEqual(await sourceJson(json([]), 'x'), []);
});

test('a 404 from a government search or feed is the source failing, not an empty paid answer', async () => {
  const { TOOLS, ENDPOINTS } = await allTools();
  for (const path of ['/gov/federal-register', '/gov/clinical-trials', '/airport/status']) {
    const ep = ENDPOINTS.find((e) => e.path === path);
    await withFetch(() => json({ error: 'not found' }, 404), () => assert.rejects(Promise.resolve().then(() => TOOLS[path]({}, q(exampleOf(ep)))), (e) => e.status === 502 && /HTTP 404/.test(e.message), path));
  }
  // A filer the SEC does not hold is still "not found" for the caller.
  const filings = ENDPOINTS.find((e) => e.path === '/sec/filings');
  await withFetch(() => json({}, 404), () => assert.rejects(Promise.resolve().then(() => TOOLS['/sec/filings']({}, q({ ...exampleOf(filings), ticker: '', cik: '320193' }))), (e) => e.status === 404));
});

test('the refusals of /company and /stock/quote say what the input takes and where to look next', async () => {
  const { TOOLS } = await allTools();
  await assert.rejects(Promise.resolve().then(() => TOOLS['/company']({}, q({}))), (e) => e.status === 400 && /^name or id is required: /.test(e.message) && /Q60269744/.test(e.message));
  await withFetch((url) => json(url.includes('wbsearchentities') ? { search: [{ id: 'Q1' }] } : { entities: { Q1: { id: 'Q1', labels: { en: { value: 'Something else' } }, claims: {} } } }), () =>
    assert.rejects(Promise.resolve().then(() => TOOLS['/company']({}, q({ name: 'Nonexistent Trading Co' }))), (e) => e.status === 404 && /company\/search/.test(e.message) && /nothing was charged/.test(e.message)));
  for (const body of [() => json({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }, 404), () => json({ chart: { result: null, error: { description: 'No data found, symbol may be delisted' } } })]) {
    await withFetch(body, () => assert.rejects(Promise.resolve().then(() => TOOLS['/stock/quote']({}, q({ symbol: 'ZZZZQ' }))), (e) => e.status === 404 && /^unknown ticker ZZZZQ: symbol is a Yahoo Finance ticker/.test(e.message) && /\/stock\/search/.test(e.message)));
  }
});

test('/token/supply and /price/token: a contract that is not a token is the caller\'s input (422); a failing node is a 502', async () => {
  const { CHAIN_MORE } = await load('src/routes/chain-more.ts');
  const { PRICES } = await load('src/routes/prices.ts');
  const supply = CHAIN_MORE.find((e) => e.endpoint.path === '/token/supply').run;
  const price = PRICES.find((e) => e.endpoint.path === '/price/token').run;
  const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  await withFetch(node({ tokens: [usdc], others: [NOT_A_TOKEN] }), async () => {
    assert.equal((await supply({}, q({ token: usdc, chain: 'base' }))).symbol, 'USDC');
    await assert.rejects(supply({}, q({ token: NOT_A_TOKEN, chain: 'base' })), (e) => e.status === 422 && /does not behave like an ERC-20/.test(e.message));
    await assert.rejects(supply({}, q({ token: WALLET, chain: 'base' })), (e) => e.status === 422);
    await assert.rejects(price({}, q({ address: NOT_A_TOKEN, chain: 'base' })), (e) => e.status === 422 && /does not behave like an ERC-20/.test(e.message));
  });
  await withFetch(node({ tokens: [usdc], down: true }), async () => {
    await assert.rejects(supply({}, q({ token: usdc, chain: 'base' })), (e) => e.status === 502 && /public nodes did not answer/.test(e.message));
    await assert.rejects(price({}, q({ address: usdc, chain: 'base' })), (e) => e.status === 502);
  });
});

test('the x402 checks read this service\'s own quote with a time limit', async () => {
  const { X402_CHECK } = await load('src/routes/x402-check.ts');
  const quote = { x402Version: 1, accepts: [{ scheme: 'exact', network: 'base', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', maxAmountRequired: '10000', payTo: '0x0000000000000000000000000000000000000001' }] };
  const seen = [];
  const env = { SELF: { fetch: async (_url, init) => { seen.push(init); return json(quote, 402); } } };
  const out = await X402_CHECK[0].run(env, q({ url: 'https://agent-data-tools.revmesh2074.workers.dev/btc-fees' }));
  assert.equal(out.accepts[0].assetIsNativeUsdc, true);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].signal instanceof AbortSignal, 'the request carries an abort signal');
});
