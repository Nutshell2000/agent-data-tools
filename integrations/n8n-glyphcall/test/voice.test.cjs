// The Glyphcall Voice node: its operations call real voice tools with their real input names (test/fixtures/voice-tools.json,
// copied from the service's /openapi.json on 16 Nov 2026), a recording from an earlier node goes as the raw body, and the
// answer's base64 MP3 becomes a binary file. Run `npm run build` first; no network, no API key.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dist = path.join(__dirname, '..', 'dist');
const voice = require(path.join(dist, 'nodes/GlyphcallVoice/GlyphcallVoice.node.js'));
const fixture = require('./fixtures/voice-tools.json');
const pkg = require('../package.json');

const properties = new voice.GlyphcallVoice().description.properties;
const CONTROL = new Set(['only', 'sample']);

function operations() {
	const out = [];
	for (const selector of properties.filter((p) => p.name === 'operation')) {
		const resource = selector.displayOptions.show.resource[0];
		for (const option of selector.options) {
			const fields = properties.filter(
				(p) => p.displayOptions?.show?.resource?.includes(resource) && (!p.displayOptions.show.operation || p.displayOptions.show.operation.includes(option.value)) && p.name !== 'operation',
			);
			const sent = [];
			for (const f of fields) {
				if (f.routing?.send?.property) sent.push(f.routing.send.property);
				for (const sub of f.type === 'collection' ? f.options : []) if (sub.routing?.send?.property) sent.push(sub.routing.send.property);
			}
			out.push({ resource, operation: option.value, path: option.routing.request.url, sent });
		}
	}
	return out;
}

test('the voice node is listed in the package', () => {
	assert.ok(pkg.n8n.nodes.includes('dist/nodes/GlyphcallVoice/GlyphcallVoice.node.js'));
});

test('every voice operation calls a real tool and sends only its real inputs', () => {
	const ops = operations();
	assert.deepEqual(ops.map((o) => o.operation).sort(), ['speak', 'speakLite', 'summarize', 'transcribe']);
	for (const op of ops) {
		const tool = fixture[op.path];
		assert.ok(tool, `${op.operation}: ${op.path} is a live tool`);
		for (const name of op.sent) if (!CONTROL.has(name)) assert.ok(tool.inputs.includes(name), `${op.operation} sends ${name}, which ${op.path} reads`);
		for (const name of tool.required) assert.ok(op.sent.includes(name) || name === 'url', `${op.operation} sends the required ${name}`);
	}
});

function fakeContext(params, bytes) {
	return {
		getNodeParameter: (name, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({ name: 'Glyphcall Voice' }),
		helpers: {
			getBinaryDataBuffer: async () => {
				if (!bytes) throw new Error('none');
				return bytes;
			},
			prepareBinaryData: async (buffer, fileName, mimeType) => ({ data: buffer.toString('base64'), fileName, mimeType }),
		},
	};
}

test('a recording from an earlier node is POSTed as the raw body without the url', async () => {
	const ctx = fakeContext({ source: 'file', binaryPropertyName: 'data' }, Buffer.from('ID3fake'));
	const out = await voice.sendAudio.call(ctx, { method: 'GET', url: '/transcribe/long', qs: { url: '', language: 'sv' }, headers: { Accept: 'application/json' } });
	assert.equal(out.method, 'POST');
	assert.equal(out.headers['Content-Type'], 'application/octet-stream');
	assert.equal(out.qs.url, undefined);
	assert.equal(out.qs.language, 'sv');
	assert.equal(out.body.toString(), 'ID3fake');
});

test('a URL source leaves the GET alone; a missing or too large file is refused before any request', async () => {
	const req = { method: 'GET', url: '/transcribe/long', qs: { url: 'https://example.com/a.mp3' } };
	assert.equal(await voice.sendAudio.call(fakeContext({ source: 'url' }), req), req);
	await assert.rejects(voice.sendAudio.call(fakeContext({ source: 'file' }, null), req), /No recording found/);
	await assert.rejects(voice.sendAudio.call(fakeContext({ source: 'file' }, Buffer.alloc(voice.MAX_AUDIO_BYTES + 1)), req), /25 MB/);
});

test('the spoken MP3 becomes a binary file and leaves the JSON', async () => {
	const ctx = fakeContext({ outputBinaryField: 'speech' });
	const body = { contentType: 'audio/mpeg', audioBase64: Buffer.from('ID3mp3').toString('base64'), bytes: 6, voice: 'luna', characters: 5 };
	const [item] = await voice.audioToBinary.call(ctx, [{ json: body }], { body, headers: {}, statusCode: 200 });
	assert.equal(item.json.audioBase64, undefined);
	assert.equal(item.json.voice, 'luna');
	assert.equal(item.binary.speech.mimeType, 'audio/mpeg');
	assert.equal(Buffer.from(item.binary.speech.data, 'base64').toString(), 'ID3mp3');
});
