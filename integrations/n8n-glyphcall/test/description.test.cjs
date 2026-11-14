// Checks the built node description against the service's real tool inputs (test/fixtures/tools.json, the three
// document tools copied from the service's catalog) and unit-tests the file upload. Run `npm run build` first;
// `npm test` does both. No network, no API key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
const { Glyphcall } = require(path.join(dist, 'nodes/Glyphcall/Glyphcall.node.js'));
const { GlyphcallApi } = require(path.join(dist, 'credentials/GlyphcallApi.credentials.js'));
const document = require(path.join(dist, 'nodes/Glyphcall/resources/document.js'));
const fixture = require('./fixtures/tools.json');
const pkg = require('../package.json');

const HOST = 'https://glyphcall.com';
const CONTROL = new Set(['only', 'sample']);
const description = new Glyphcall().description;
const properties = description.properties;

function operations() {
	const selector = properties.find((p) => p.name === 'operation');
	return selector.options.map((option) => {
		const fields = properties.filter((p) => p.name !== 'operation' && p.name !== 'resource' && p.displayOptions?.show?.operation?.includes(option.value));
		const sent = [];
		for (const field of fields) {
			if (field.routing?.send?.property) sent.push({ name: field.routing.send.property, required: Boolean(field.required) });
			for (const sub of field.type === 'collection' ? field.options : []) if (sub.routing?.send?.property) sent.push({ name: sub.routing.send.property, required: false });
		}
		return { operation: option.value, option, path: option.routing.request.url, sent, fields };
	});
}

test('package manifest follows the n8n community node rules', () => {
	assert.equal(pkg.name, 'n8n-nodes-glyphcall');
	assert.ok(pkg.keywords.includes('n8n-community-node-package'));
	assert.equal(pkg.license, 'MIT');
	assert.equal(pkg.dependencies, undefined, 'no run-time dependencies');
	assert.deepEqual(Object.keys(pkg.peerDependencies), ['n8n-workflow']);
	assert.deepEqual(pkg.files, ['dist']);
	assert.equal(pkg.repository.url, 'https://github.com/Nutshell2000/agent-data-tools.git');
	assert.equal(pkg.repository.directory, 'integrations/n8n-glyphcall');
	for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) require(path.join(__dirname, '..', file));
});

test('one service, one key, sent in the Authorization header only', () => {
	const credential = new GlyphcallApi();
	assert.equal(credential.name, description.credentials[0].name);
	assert.equal(description.credentials[0].required, true);
	assert.deepEqual(credential.authenticate, { type: 'generic', properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } } });
	assert.equal(credential.properties[0].typeOptions.password, true);
	assert.equal(credential.test.request.baseURL + credential.test.request.url, `${HOST}/credits/balance`);
	assert.equal(description.requestDefaults.baseURL, HOST);
	assert.ok(!/api_key|apikey=/i.test(JSON.stringify(description) + JSON.stringify(credential)), 'no query-string key anywhere');
});

test('every operation calls a real document tool with real inputs', () => {
	const ops = operations();
	assert.deepEqual(ops.map((o) => o.path).sort(), Object.keys(fixture.tools).sort());
	for (const op of ops) {
		const spec = fixture.tools[op.path];
		assert.equal(op.option.routing.request.method, 'GET', `${op.operation} is declared as a GET`);
		assert.ok(op.option.action, `${op.operation} has an action label`);
		assert.ok(!/\$\d/.test(JSON.stringify(op.option) + JSON.stringify(op.fields)), `${op.operation}: no price in the node's texts`);
		for (const input of op.sent) assert.ok(spec.params[input.name] || CONTROL.has(input.name), `${op.operation}: ${op.path} takes an input named ${input.name}`);
		for (const [name, param] of Object.entries(spec.params)) if (param.required) assert.ok(op.sent.some((s) => s.name === name && s.required), `${op.operation}: required input ${name} is a required field`);
		for (const field of op.fields.flatMap((f) => (f.type === 'collection' ? f.options : [f]))) {
			const allowed = field.routing?.send?.property && spec.params[field.routing.send.property]?.enum;
			if (allowed && field.type === 'options') for (const choice of field.options) assert.ok(allowed.includes(choice.value));
		}
	}
});

test('the README price list matches the service', () => {
	const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
	for (const [toolPath, spec] of Object.entries(fixture.tools)) assert.ok(readme.includes(`| \`${toolPath}\` | ${spec.price} |`), `README lists ${toolPath} at ${spec.price}`);
});

const context = (parameters, binary) => ({
	getNodeParameter: (name, fallback) => (name in parameters ? parameters[name] : fallback),
	getNode: () => ({ name: 'Glyphcall Documents', type: 'n8n-nodes-glyphcall.glyphcall', typeVersion: 1, parameters }),
	helpers: { getBinaryDataBuffer: async (field) => { if (!binary[field]) throw new Error('no binary'); return binary[field]; } },
});

test('a file from an earlier node is sent as the request body; a URL stays a plain GET', async () => {
	const file = Buffer.from('PK\u0003\u0004 fake docx');
	const base = { baseURL: HOST, headers: { Accept: 'application/json' }, method: 'GET', url: '/document/extract', qs: { url: 'https://example.com/a.docx', fields: 'total' } };
	assert.deepEqual(await document.sendFile.call(context({ source: 'url' }, {}), base), base);
	const sent = await document.sendFile.call(context({ source: 'file', binaryPropertyName: 'attachment_0' }, { attachment_0: file }), base);
	assert.equal(sent.method, 'POST');
	assert.deepEqual(sent.qs, { fields: 'total' });
	assert.equal(sent.body, file);
	assert.equal(sent.headers['Content-Type'], 'application/octet-stream');
	assert.equal(sent.baseURL, HOST);
	await assert.rejects(document.sendFile.call(context({ source: 'file', binaryPropertyName: 'data' }, {}), base), /No file found in the binary field "data"/);
	await assert.rejects(document.sendFile.call(context({ source: 'file' }, { data: Buffer.alloc(document.MAX_FILE_BYTES + 1) }), base), /largest file this operation reads is 10 MB/);
});
