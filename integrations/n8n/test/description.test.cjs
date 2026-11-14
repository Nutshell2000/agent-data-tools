// Checks the built node description against the service's real tool inputs (test/fixtures/tools.json,
// a snapshot of the public OpenAPI document) and unit-tests the two custom functions.
// Run `npm run build` first; `npm test` does both. No network, no API key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
const { AgentDataTools } = require(path.join(dist, 'nodes/AgentDataTools/AgentDataTools.node.js'));
const { AgentDataToolsApi } = require(path.join(dist, 'credentials/AgentDataToolsApi.credentials.js'));
const tool = require(path.join(dist, 'nodes/AgentDataTools/resources/tool.js'));
const speech = require(path.join(dist, 'nodes/AgentDataTools/resources/speech.js'));
const document = require(path.join(dist, 'nodes/AgentDataTools/resources/document.js'));
const fixture = require('./fixtures/tools.json');
const pkg = require('../package.json');

const HOST = 'https://agent-data-tools.revmesh2074.workers.dev';
// Inputs every tool reads next to its own (CONTROL_PARAMS in the service's src/index.ts).
const CONTROL = new Set(['only', 'sample']);
const description = new AgentDataTools().description;
const properties = description.properties;

const shownFor = (property, resource, operation) => {
	const show = property.displayOptions?.show ?? {};
	return (!show.resource || show.resource.includes(resource)) && (!show.operation || show.operation.includes(operation));
};

/** Every resource/operation pair with the paths it can call and the query inputs it can send. */
function operations() {
	const out = [];
	const resources = properties.find((p) => p.name === 'resource').options.map((o) => o.value);
	for (const resource of resources) {
		const selector = properties.find((p) => p.name === 'operation' && shownFor(p, resource, undefined) && p.displayOptions.show.resource.includes(resource));
		assert.ok(selector, `resource ${resource} has operations`);
		for (const option of selector.options) {
			const url = option.routing?.request?.url ?? '';
			const paths = [...String(url).matchAll(/["']?(\/[a-z0-9/-]+)["']?/g)].map((m) => m[1]);
			const fields = properties.filter((p) => p.name !== 'operation' && p.name !== 'resource' && p.displayOptions?.show?.resource?.includes(resource) && p.displayOptions.show.operation?.includes(option.value));
			const sent = [];
			for (const field of fields) {
				if (field.routing?.send?.property) sent.push({ name: field.routing.send.property, required: Boolean(field.required), optional: false });
				for (const sub of field.type === 'collection' ? field.options : []) {
					if (sub.routing?.send?.property) sent.push({ name: sub.routing.send.property, required: false, optional: true });
				}
			}
			out.push({ resource, operation: option.value, option, paths, sent, fields });
		}
	}
	return out;
}

test('package manifest follows the n8n community node rules', () => {
	assert.match(pkg.name, /^n8n-nodes-/);
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.equal(pkg.license, 'MIT');
	assert.equal(pkg.dependencies, undefined, 'no run-time dependencies');
	assert.deepEqual(Object.keys(pkg.peerDependencies), ['n8n-workflow']);
	assert.deepEqual(pkg.files, ['dist']);
	assert.equal(pkg.repository.url, 'https://github.com/Nutshell2000/agent-data-tools.git');
	assert.equal(pkg.repository.directory, 'integrations/n8n');
	assert.equal(pkg.author.name, 'SpellzCode');
	for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) require(path.join(__dirname, '..', file));
});

test('the key travels in the Authorization header and never in the URL', () => {
	const credential = new AgentDataToolsApi();
	assert.equal(credential.name, description.credentials[0].name);
	assert.deepEqual(credential.authenticate, { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } } });
	assert.equal(credential.properties[0].typeOptions.password, true);
	assert.equal(credential.test.request.baseURL + credential.test.request.url, `${HOST}/credits/balance`);
	assert.equal(description.requestDefaults.baseURL, HOST);
	const source = JSON.stringify(description) + JSON.stringify(credential);
	assert.ok(!/api_key|apikey=/i.test(source), 'no query-string key anywhere');
});

test('"Find a tool" is free and needs no credential', () => {
	const find = operations().find((o) => o.resource === 'tool' && o.operation === 'find');
	assert.deepEqual(find.paths, ['/find']);
	assert.deepEqual(find.sent.map((s) => s.name).sort(), ['count', 'need']);
	// The credential is shown for every operation value except "find" ...
	const paid = [...new Set(operations().map((o) => o.operation))].filter((o) => o !== 'find').sort();
	assert.deepEqual(description.credentials[0].displayOptions, { show: { operation: paid } });
	assert.equal(description.credentials[0].required, false);
	// ... and "find" is a value only the Tool resource has, so no paid operation loses its key.
	assert.deepEqual(operations().filter((o) => o.operation === 'find').map((o) => o.resource), ['tool']);
	assert.equal(properties.find((p) => p.name === 'resource').default, 'tool');
});

test('every flagship operation calls a real tool with real inputs', () => {
	const flagship = operations().filter((o) => o.resource !== 'tool');
	assert.equal(flagship.length, 18);
	const called = new Set();
	for (const op of flagship) {
		const label = `${op.resource}.${op.operation}`;
		assert.ok(op.paths.length >= 1, `${label} has a path`);
		assert.equal(op.option.routing.request.method, 'GET', `${label} is a GET`);
		assert.ok(op.option.action, `${label} has an action label`);
		for (const p of op.paths) {
			const spec = fixture.tools[p];
			assert.ok(spec, `${label}: ${p} is a tool of the service`);
			called.add(p);
			// Prices can change on the service, so the node's own texts name none; the README lists them.
			assert.ok(!/\$\d/.test(JSON.stringify(op.option) + JSON.stringify(op.fields)), `${label}: no price in the node's texts`);
			for (const input of op.sent) {
				assert.ok(spec.params[input.name] || CONTROL.has(input.name), `${label}: ${p} takes an input named ${input.name}`);
			}
			for (const [name, param] of Object.entries(spec.params)) {
				if (param.required) assert.ok(op.sent.some((s) => s.name === name && s.required), `${label}: required input ${name} of ${p} is a required field`);
			}
		}
		assert.ok(op.sent.some((s) => s.name === 'only' && s.optional) && op.sent.some((s) => s.name === 'sample' && s.optional), `${label} offers the common options`);
	}
	assert.deepEqual([...called].sort(), Object.keys(fixture.tools).sort(), 'every tool in the fixture is used');
});

test('the README price list matches the service', () => {
	const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
	const rows = readme.split('\n').filter((line) => line.startsWith('| ') && line.includes('`/'));
	for (const [toolPath, spec] of Object.entries(fixture.tools)) {
		const row = rows.find((line) => line.includes(`| \`${toolPath}\` |`));
		assert.ok(row, `README lists ${toolPath}`);
		assert.ok(row.trimEnd().endsWith(`| ${spec.price} |`), `README price of ${toolPath} is ${spec.price}: ${row}`);
	}
	assert.equal(rows.length, Object.keys(fixture.tools).length + 1, 'one row per tool, plus the free finder');
	// Card packs as the service sells them (src/lib/credits.ts CREDIT_PACKS, GET /credits).
	for (const pack of ['| $1 | 1,000 |', '| $5 | 5,000 |', '| $20 | 22,000 |', '| $100 | 125,000 |']) assert.ok(readme.includes(pack), pack);
});

test('option lists only offer values the tools accept', () => {
	for (const op of operations()) {
		for (const p of op.paths) {
			const spec = fixture.tools[p];
			if (!spec) continue;
			const all = op.fields.flatMap((f) => (f.type === 'collection' ? f.options : [f]));
			for (const field of all) {
				const name = field.routing?.send?.property;
				const allowed = name && spec.params[name]?.enum;
				if (!allowed || field.type !== 'options') continue;
				for (const choice of field.options) assert.ok(allowed.includes(choice.value), `${op.resource}.${op.operation}: ${name}=${choice.value} is accepted by ${p}`);
			}
		}
	}
});

test('tool paths are confined to the service host', () => {
	for (const good of ['/weather', '/price/token', '/pack/news-sentiment', '/base-gas', '/v1/audio/speech', '/a.b_c-1']) assert.ok(tool.TOOL_PATH.test(good), good);
	for (const bad of ['', 'weather', '//evil.example/x', 'https://evil.example/x', '/\\evil.example', '/a//b', '/a/../b', '/..', '/.', '/a?x=1', '/a#b', '/a b', '/a/', '/@evil.example', '/a:80', '/%2e%2e/x']) assert.ok(!tool.TOOL_PATH.test(bad), JSON.stringify(bad));
});

test('"Call any tool" turns JSON parameters into query values', () => {
	assert.deepEqual(tool.toQuery('{"city":"London","days":3,"flag":true,"tags":["a","b"],"skip":"","none":null}'), { city: 'London', days: 3, flag: true, tags: '["a","b"]' });
	assert.deepEqual(tool.toQuery({ url: 'https://example.com' }), { url: 'https://example.com' });
	assert.deepEqual(tool.toQuery(''), {});
	assert.throws(() => tool.toQuery('[1,2]'), /JSON object/);
	assert.throws(() => tool.toQuery('"text"'), /JSON object/);
	assert.throws(() => tool.toQuery('{not json'));
});

const fakeContext = (parameters) => ({
	getNodeParameter: (name, fallback) => (name in parameters ? parameters[name] : fallback),
	getNode: () => ({ name: 'Agent Data Tools', type: 'n8n-nodes-agent-data-tools.agentDataTools', typeVersion: 1, parameters }),
	helpers: {
		prepareBinaryData: async (buffer, fileName, mimeType) => ({ data: buffer.toString('base64'), fileName, mimeType, fileSize: String(buffer.length) }),
	},
});

test('"Call any tool" builds a GET on the tool path and refuses anything else', async () => {
	const base = { baseURL: HOST, headers: { Accept: 'application/json' }, qs: {} };
	const request = await tool.callAnyTool.call(fakeContext({ path: ' /weather ', parameters: '{"city":"London"}' }), base);
	assert.deepEqual(request, { baseURL: HOST, headers: { Accept: 'application/json' }, method: 'GET', url: '/weather', qs: { city: 'London' } });
	for (const p of ['https://evil.example/steal', '//evil.example/steal', 'weather', '']) {
		await assert.rejects(tool.callAnyTool.call(fakeContext({ path: p, parameters: '{}' }), base), /Tool Path must be a path/);
	}
	await assert.rejects(tool.callAnyTool.call(fakeContext({ path: '/weather', parameters: '{oops' }), base), /Parameters is not valid JSON/);
	await assert.rejects(tool.callAnyTool.call(fakeContext({ path: '/weather', parameters: '[1]' }), base), /Parameters must be a JSON object/);
});

test('speech audio moves into a binary field, or stays as base64 when no field is named', async () => {
	const audio = Buffer.from('ID3 fake mp3 bytes');
	const json = { contentType: 'audio/mpeg', audioBase64: audio.toString('base64'), bytes: audio.length, voice: 'luna' };
	const [moved] = await speech.audioToBinary.call(fakeContext({ binaryPropertyName: 'data' }), [{ json: { ...json } }]);
	assert.deepEqual(moved.json, { contentType: 'audio/mpeg', bytes: audio.length, voice: 'luna' });
	assert.deepEqual(moved.binary.data, { data: audio.toString('base64'), fileName: 'speech.mp3', mimeType: 'audio/mpeg', fileSize: String(audio.length) });
	const [kept] = await speech.audioToBinary.call(fakeContext({ binaryPropertyName: '' }), [{ json: { ...json } }]);
	assert.equal(kept.json.audioBase64, json.audioBase64);
	assert.equal(kept.binary, undefined);
	// A free sample answer has no top-level audio: it passes through untouched.
	const sample = { json: { sample: true, example: { audioBase64: 'SUQz' } } };
	assert.deepEqual(await speech.audioToBinary.call(fakeContext({ binaryPropertyName: 'data' }), [sample]), [sample]);
});

test('voices offered are the voices the speech tool documents', () => {
	const generate = operations().find((o) => o.resource === 'speech');
	const voices = generate.fields.find((f) => f.type === 'collection').options.find((o) => o.name === 'voice').options.map((o) => o.value);
	assert.deepEqual([...voices].sort(), [...fixture.voices.en, ...fixture.voices.es].sort());
});

test('a file from an earlier node is sent as the request body; a URL stays a plain GET', async () => {
	const pdf = Buffer.from('%PDF-1.4 fake');
	const context = (parameters, binary) => ({ ...fakeContext(parameters), helpers: { getBinaryDataBuffer: async (field) => { if (!binary[field]) throw new Error('no binary'); return binary[field]; } } });
	const base = { baseURL: HOST, headers: { Accept: 'application/json' }, method: 'GET', url: '/pdf/text', qs: { url: 'https://example.com/a.pdf', pages: 2 } };
	assert.deepEqual(await document.sendFile.call(context({ source: 'url' }, {}), base), base);
	const sent = await document.sendFile.call(context({ source: 'file', binaryPropertyName: 'attachment_0' }, { attachment_0: pdf }), base);
	assert.equal(sent.method, 'POST');
	assert.equal(sent.url, '/pdf/text');
	assert.deepEqual(sent.qs, { pages: 2 });
	assert.equal(sent.body, pdf);
	assert.equal(sent.headers['Content-Type'], 'application/octet-stream');
	assert.equal(sent.baseURL, HOST);
	await assert.rejects(document.sendFile.call(context({ source: 'file', binaryPropertyName: 'data' }, {}), base), /No file found in the binary field "data"/);
	await assert.rejects(document.sendFile.call(context({ source: 'file' }, { data: Buffer.alloc(document.MAX_FILE_BYTES + 1) }), base), /largest file this operation reads is 10 MB/);
});