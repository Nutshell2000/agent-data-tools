// Snapshot of the inputs of the tools this node calls, taken from the service's public OpenAPI
// document. Usage: node snapshot-tools.cjs <openapi.json> <out.json>
const fs = require('node:fs');
const [src, out] = process.argv.slice(2);
const api = JSON.parse(fs.readFileSync(src, 'utf8'));
const paths = ['/search', '/extract', '/extract/rendered', '/audit/website', '/news', '/pack/news-sentiment', '/github/repo', '/cve', '/ai/speech', '/text-to-speech', '/price/token', '/hyperliquid/indicators', '/company', '/sec/filings', '/sanctions/check', '/check/payee'];
const tools = {};
for (const p of paths) {
	const op = api.paths[p] && api.paths[p].get;
	if (!op) throw new Error('not in the OpenAPI document: ' + p);
	const params = {};
	for (const raw of op.parameters || []) {
		const param = raw.$ref ? api.components.parameters[raw.$ref.split('/').pop()] : raw;
		if (param.in !== 'query') continue;
		params[param.name] = { required: Boolean(param.required), type: param.schema && param.schema.type, ...(param.schema && param.schema.enum ? { enum: param.schema.enum } : {}) };
	}
	tools[p] = { price: '$' + op['x-payment-info'].price.amount.replace(/0+$/, '').replace(/\.$/, ''), params };
}
// The speech voices are documented in prose: "English: a, b, ... Spanish: c, d, ... Default: ...".
const voiceText = api.paths['/ai/speech'].get.parameters.find((p) => p.name === 'voice').description;
const list = (label) => new RegExp(label + ': ([a-z, ]+)').exec(voiceText)[1].split(',').map((v) => v.trim()).filter(Boolean);
const voices = { en: list('English'), es: list('Spanish') };
fs.writeFileSync(out, JSON.stringify({ source: api.servers[0].url + '/openapi.json', serviceVersion: api.info.version, toolCount: Number(/^(\d+) pay-per-call tools/.exec(api.info.description)[1]), voices, tools }, null, '\t') + '\n');
