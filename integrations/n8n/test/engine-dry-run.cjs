// Runs every operation of the built node through n8n's own declarative engine (n8n-core
// RoutingNode) and checks the HTTP request each one would send. Requests are captured at the axios
// adapter, the last step before the socket, and answered with a canned body: nothing is sent and
// no API key is needed. With --live-find the free finder call alone goes to the live service.
//
// n8n-core is deliberately not a dev dependency of this package (it is large). To run:
//   npm run build
//   npm install --no-save --ignore-scripts n8n-core@2.47.2      (or anywhere else, then set N8N_ENGINE_DIR)
//   npm run test:engine -- --live-find
//
// One part is a stand-in: n8n's CredentialsHelper lives in the n8n server package, not in
// n8n-core, so the credential's own `authenticate` rule is applied here by a few lines below.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert/strict');

// n8n-core creates its settings folder on first use: keep it out of the real home directory.
process.env.N8N_USER_FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'adt-n8n-dry-run-'));
process.env.N8N_DIAGNOSTICS_ENABLED = 'false';
process.env.N8N_ENCRYPTION_KEY = 'dry-run-only';

const engineDir = process.env.N8N_ENGINE_DIR || path.join(__dirname, '..');
const fromEngine = (name) => require(require.resolve(name, { paths: [engineDir] }));
const live = process.argv.includes('--live-find');
const verbose = process.argv.includes('--verbose');

const { Workflow, createRunExecutionData } = fromEngine('n8n-workflow');
const core = fromEngine('n8n-core');
const axios = require(require.resolve('axios', { paths: [require.resolve('n8n-core', { paths: [engineDir] })] }));
const realAdapter = axios.getAdapter(['http']);

const dist = path.join(__dirname, '..', 'dist');
const { AgentDataTools } = require(path.join(dist, 'nodes/AgentDataTools/AgentDataTools.node.js'));
const { AgentDataToolsApi } = require(path.join(dist, 'credentials/AgentDataToolsApi.credentials.js'));
const nodeType = new AgentDataTools();
const credentialType = new AgentDataToolsApi();
const nodeTypes = { getByName: () => nodeType, getByNameAndVersion: () => nodeType, getKnownTypes: () => ({}) };

const HOST = 'https://agent-data-tools.revmesh2074.workers.dev';
// Shaped like a key, valid nowhere.
const KEY = 'adt_DRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUN0000';

const captured = [];
let canned = { ok: true };
// With --live-find exactly one request, the first to the free finder, goes to the live service.
let liveCallsLeft = live ? 1 : 0;
axios.defaults.adapter = async (config) => {
	const url = new URL(axios.getUri(config));
	const headers = { ...(config.headers?.toJSON?.() ?? config.headers ?? {}) };
	const record = { method: String(config.method).toUpperCase(), origin: url.origin, path: url.pathname, query: Object.fromEntries(url.searchParams), headers, raw: url.href };
	captured.push(record);
	if (liveCallsLeft > 0 && url.origin === HOST && url.pathname === '/find') {
		liveCallsLeft--;
		record.live = true;
		return await realAdapter(config);
	}
	return { data: canned, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config, request: {} };
};

const additionalData = () => ({
	executionId: 'dry-run',
	restApiUrl: 'http://localhost/rest',
	instanceBaseUrl: 'http://localhost/',
	webhookBaseUrl: 'http://localhost/webhook',
	webhookTestBaseUrl: 'http://localhost/webhook-test',
	webhookWaitingBaseUrl: 'http://localhost/webhook-waiting',
	formWaitingBaseUrl: 'http://localhost/form-waiting',
	variables: {},
	credentialsHelper: {
		getDecrypted: async () => ({ apiKey: KEY }),
		getParentTypes: () => [],
		getCredentialsProperties: () => credentialType.properties,
		isCredentialUsableByNode: () => true,
		preAuthentication: async () => undefined,
		authenticate: async (credentials, _typeName, requestOptions) => {
			const rule = credentialType.authenticate;
			assert.equal(rule.type, 'generic');
			const out = { ...requestOptions };
			for (const [area, values] of Object.entries(rule.properties)) {
				out[area] = { ...out[area] };
				for (const [name, template] of Object.entries(values)) {
					out[area][name] = String(template).replace(/^=/, '').replace(/\{\{\s*\$credentials\??\.(\w+)\s*\}\}/g, (_m, field) => credentials[field]);
				}
			}
			return out;
		},
	},
});

async function run({ parameters, key = true, answer = { ok: true } }) {
	const node = {
		id: 'n1', name: 'Agent Data Tools', type: 'n8n-nodes-agent-data-tools.agentDataTools', typeVersion: 1, position: [0, 0],
		parameters,
		...(key ? { credentials: { agentDataToolsApi: { id: '1', name: 'Agent Data Tools key' } } } : {}),
	};
	const workflow = new Workflow({ id: 'w1', name: 'dry run', nodes: [node], connections: {}, active: false, nodeTypes, settings: {} });
	const wfNode = workflow.getNode(node.name);
	const inputData = { main: [[{ json: {} }]] };
	const executeData = { data: inputData, node: wfNode, source: null };
	const context = new core.ExecuteContext(workflow, wfNode, additionalData(), 'manual', createRunExecutionData({}), 0, [{ json: {} }], inputData, executeData, [], undefined);
	captured.length = 0;
	canned = answer;
	try {
		const output = await new core.RoutingNode(context, nodeType).runNode();
		return { requests: captured.map((r) => ({ ...r })), output: output?.[0] };
	} catch (error) {
		return { requests: captured.map((r) => ({ ...r })), error };
	}
}

const AUTH = `Bearer ${KEY}`;
/** [name, node parameters, expected path, expected query] — sent with the key unless noted. */
const cases = [
	['web.search, defaults', { resource: 'web', operation: 'search', q: 'x402 payment protocol' }, '/search', { q: 'x402 payment protocol', count: '10' }],
	['web.search, options', { resource: 'web', operation: 'search', q: 'x402', count: 3, options: { category: 'news', includeDomains: 'x402.org, github.com/coinbase', highlights: true, summary: false, textChars: 2000, startPublishedDate: '2026-01-01', only: 'results', sample: false } }, '/search', { q: 'x402', count: '3', category: 'news', includeDomains: 'x402.org, github.com/coinbase', highlights: 'true', summary: 'false', textChars: '2000', startPublishedDate: '2026-01-01', only: 'results' }],
	['web.readPage, static', { resource: 'web', operation: 'readPage', url: 'https://example.com/a?b=1&c=2' }, '/extract', { url: 'https://example.com/a?b=1&c=2', format: 'markdown' }],
	['web.readPage, rendered', { resource: 'web', operation: 'readPage', url: 'https://example.com/', format: 'both', renderJavaScript: true, options: { maxChars: 5000, section: 'main' } }, '/extract/rendered', { url: 'https://example.com/', format: 'both', maxChars: '5000', section: 'main' }],
	['web.audit', { resource: 'web', operation: 'audit', url: 'https://www.wikipedia.org/' }, '/audit/website', { url: 'https://www.wikipedia.org/' }],
	['news.search', { resource: 'news', operation: 'search', q: 'bitcoin ETF', options: { freshness: 'day' } }, '/news', { q: 'bitcoin ETF', count: '10', freshness: 'day' }],
	['news.getSentiment', { resource: 'news', operation: 'getSentiment', q: 'bitcoin' }, '/pack/news-sentiment', { q: 'bitcoin', count: '5' }],
	['githubRepository.get', { resource: 'githubRepository', operation: 'get', repo: 'vercel/next.js' }, '/github/repo', { repo: 'vercel/next.js' }],
	['vulnerability.get', { resource: 'vulnerability', operation: 'get', cve: 'CVE-2021-44228' }, '/cve', { cve: 'CVE-2021-44228' }],
	['vulnerability.get, free sample', { resource: 'vulnerability', operation: 'get', cve: 'CVE-2021-44228', options: { sample: true } }, '/cve', { cve: 'CVE-2021-44228', sample: '1' }],
	['speech.generate, short', { resource: 'speech', operation: 'generate', text: 'Your payment was received. Thank you!', binaryPropertyName: '', options: { lang: 'en', voice: 'luna' } }, '/ai/speech', { text: 'Your payment was received. Thank you!', lang: 'en', voice: 'luna' }],
	['speech.generate, long text', { resource: 'speech', operation: 'generate', text: 'A longer paragraph.', longText: true, binaryPropertyName: '' }, '/text-to-speech', { text: 'A longer paragraph.' }],
	['crypto.getPrice, by symbol (a stale address is not sent)', { resource: 'crypto', operation: 'getPrice', priceLookup: 'symbol', symbol: 'ETH', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' }, '/price/token', { symbol: 'ETH', chain: 'base' }],
	['crypto.getPrice, by address', { resource: 'crypto', operation: 'getPrice', priceLookup: 'address', address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', chain: 'eth' }, '/price/token', { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', chain: 'eth' }],
	['crypto.getIndicators', { resource: 'crypto', operation: 'getIndicators', coin: 'ETH', interval: '1d' }, '/hyperliquid/indicators', { coin: 'ETH', interval: '1d' }],
	['company.get, by name', { resource: 'company', operation: 'get', name: 'Spotify' }, '/company', { name: 'Spotify' }],
	['company.get, by Wikidata ID', { resource: 'company', operation: 'get', companyLookup: 'id', id: 'Q60269744', name: 'stale' }, '/company', { id: 'Q60269744' }],
	['company.getFilings, by ticker', { resource: 'company', operation: 'getFilings', ticker: 'AAPL', options: { form: '10-K' } }, '/sec/filings', { ticker: 'AAPL', limit: '10', form: '10-K' }],
	['company.getFilings, by CIK', { resource: 'company', operation: 'getFilings', filingsLookup: 'cik', cik: '320193', count: 3 }, '/sec/filings', { cik: '320193', limit: '3' }],
	['screening.checkSanctions, address', { resource: 'screening', operation: 'checkSanctions', address: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96' }, '/sanctions/check', { address: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96' }],
	['screening.checkSanctions, name', { resource: 'screening', operation: 'checkSanctions', sanctionsSubject: 'name', name: 'Lazarus Group' }, '/sanctions/check', { name: 'Lazarus Group' }],
	['screening.checkSanctions, both', { resource: 'screening', operation: 'checkSanctions', sanctionsSubject: 'both', address: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96', name: 'Lazarus Group' }, '/sanctions/check', { address: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96', name: 'Lazarus Group' }],
	['screening.checkPayee', { resource: 'screening', operation: 'checkPayee', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', chain: 'polygon', options: { domain: 'ethereum.org' } }, '/check/payee', { address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', chain: 'polygon', domain: 'ethereum.org' }],
	['tool.call', { resource: 'tool', operation: 'call', path: '/weather', parameters: '{"city":"London","days":3,"tags":["a","b"],"empty":""}' }, '/weather', { city: 'London', days: '3', tags: '["a","b"]' }],
];

(async () => {
	const failures = [];
	const check = async (name, fn) => {
		try {
			await fn();
			console.log(`ok   ${name}`);
		} catch (error) {
			failures.push(name);
			console.log(`FAIL ${name}\n     ${String(error.message).split('\n').join('\n     ')}`);
		}
	};

	for (const [name, parameters, expectedPath, expectedQuery] of cases) {
		await check(name, async () => {
			const { requests, error } = await run({ parameters });
			assert.equal(error, undefined, error?.message);
			assert.equal(requests.length, 1, 'exactly one request');
			const [request] = requests;
			if (verbose) console.log(`     ${request.method} ${request.raw}`);
			assert.equal(request.method, 'GET');
			assert.equal(request.origin, HOST);
			assert.equal(request.path, expectedPath);
			assert.deepEqual(request.query, expectedQuery);
			assert.equal(request.headers.Authorization, AUTH, 'key in the Authorization header');
			assert.equal(request.headers['User-Agent'], 'n8n-nodes-agent-data-tools');
			assert.ok(!request.raw.includes(KEY), 'key is not in the URL');
		});
	}

	await check('a paid operation without a credential is sent without any key', async () => {
		const { requests, error } = await run({ key: false, parameters: { resource: 'vulnerability', operation: 'get', cve: 'CVE-2021-44228' } });
		assert.equal(error, undefined, error?.message);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].path, '/cve');
		assert.equal(requests[0].headers.Authorization, undefined);
	});

	for (const bad of ['https://evil.example/steal', '//evil.example/steal', 'weather', '/a/../b', '/weather?x=1']) {
		await check(`tool.call refuses the path ${JSON.stringify(bad)} and sends nothing`, async () => {
			const { requests, error } = await run({ parameters: { resource: 'tool', operation: 'call', path: bad, parameters: '{}' } });
			assert.equal(requests.length, 0, 'no request left the node');
			assert.match(String(error?.message), /Tool Path must be a path/);
		});
	}

	await check('tool.call refuses parameters that are not a JSON object', async () => {
		const { requests, error } = await run({ parameters: { resource: 'tool', operation: 'call', path: '/weather', parameters: '[1,2]' } });
		assert.equal(requests.length, 0);
		assert.match(String(error?.message), /Parameters must be a JSON object/);
	});

	await check('speech.generate keeps the audio as base64 when no binary field is named', async () => {
		const answer = { contentType: 'audio/mpeg', audioBase64: Buffer.from('ID3 fake').toString('base64'), bytes: 8 };
		const { output, error } = await run({ answer, parameters: { resource: 'speech', operation: 'generate', text: 'Hello', binaryPropertyName: '' } });
		assert.equal(error, undefined, error?.message);
		assert.equal(output[0].json.audioBase64, answer.audioBase64);
		assert.equal(output[0].binary, undefined);
	});

	await check('speech.generate moves the audio into the named binary field', async () => {
		const audio = Buffer.from('ID3 fake mp3 bytes');
		const answer = { contentType: 'audio/mpeg', audioBase64: audio.toString('base64'), bytes: audio.length, voice: 'luna' };
		const { output, error } = await run({ answer, parameters: { resource: 'speech', operation: 'generate', text: 'Hello' } });
		assert.equal(error, undefined, error?.message);
		assert.deepEqual(output[0].json, { contentType: 'audio/mpeg', bytes: audio.length, voice: 'luna' });
		const binary = output[0].binary.data;
		assert.equal(binary.mimeType, 'audio/mpeg');
		assert.equal(binary.fileName, 'speech.mp3');
		assert.equal(Buffer.from(binary.data, 'base64').toString(), audio.toString());
	});

	await check(`tool.find without a credential${live ? ' (LIVE call to the service)' : ''}`, async () => {
		const { requests, output, error } = await run({ key: false, parameters: { resource: 'tool', operation: 'find', need: 'current gas price on Base', count: 3 } });
		assert.equal(error, undefined, error?.message);
		assert.equal(requests.length, 1);
		const [request] = requests;
		assert.equal(request.method, 'GET');
		assert.equal(request.origin + request.path, `${HOST}/find`);
		assert.deepEqual(request.query, { need: 'current gas price on Base', count: '3' });
		assert.equal(request.headers.Authorization, undefined, 'no key is sent to the free finder');
		if (!live) return;
		assert.equal(request.live, true);
		const answer = output[0].json;
		assert.equal(answer.free, true);
		assert.equal(answer.need, 'current gas price on Base');
		assert.ok(Array.isArray(answer.picks) && answer.picks.length >= 1 && answer.picks.length <= 3, 'one to three picks');
		for (const pick of answer.picks) {
			assert.match(pick.tool, /^\//);
			assert.match(pick.price, /^\$\d/);
			assert.ok(pick.call.url.startsWith(HOST));
		}
		console.log(`     live answer: ${answer.picks.map((p) => `${p.tool} ${p.price}`).join(', ')}`);
	});

	await check('tool.find with a credential set still sends no key (the credential is hidden there)', async () => {
		const { requests, error } = await run({ key: true, parameters: { resource: 'tool', operation: 'find', need: 'weather in London' } });
		assert.equal(error, undefined, error?.message);
		assert.equal(requests[0].live, undefined, 'answered from the canned body');
		assert.equal(requests[0].headers.Authorization, undefined);
		assert.deepEqual(requests[0].query, { need: 'weather in London', count: '5' });
	});

	console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
	process.exit(failures.length ? 1 : 0);
})().catch((error) => {
	console.error('harness failure', error);
	process.exit(3);
});
