// Keeps the ClawHub skill and bundle true to the service. No dependencies, no network.
// Usage: node integrations/openclaw/check.cjs <openapi.json>
//   <openapi.json> is a saved copy of https://agent-data-tools.revmesh2074.workers.dev/openapi.json
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const here = __dirname;
const HOST = 'https://agent-data-tools.revmesh2074.workers.dev';
const skillFile = path.join(here, 'skill', 'agent-data-tools', 'SKILL.md');
const bundleSkillFile = path.join(here, 'bundle', 'skills', 'agent-data-tools', 'SKILL.md');
const skill = fs.readFileSync(skillFile, 'utf8');
const api = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('the bundle carries the same SKILL.md, byte for byte', () => {
	assert.ok(fs.readFileSync(skillFile).equals(fs.readFileSync(bundleSkillFile)));
	assert.ok(!skill.includes('\r'), 'LF line endings');
});

check('frontmatter is what ClawHub and OpenClaw read', () => {
	const front = /^---\n([\s\S]*?)\n---\n/.exec(skill);
	assert.ok(front, 'YAML frontmatter');
	const text = front[1];
	const name = /^name: (.+)$/m.exec(text)[1];
	assert.equal(name, 'agent-data-tools');
	assert.equal(name, path.basename(path.dirname(skillFile)), 'name matches its folder');
	assert.match(name, /^[a-z0-9-]{1,64}$/);
	assert.match(/^version: (.+)$/m.exec(text)[1], /^\d+\.\d+\.\d+$/);
	const description = JSON.parse(/^description: (".*")$/m.exec(text)[1]);
	assert.ok(description.length >= 80 && description.length <= 1024, `description length ${description.length}`);
	assert.match(text, /^metadata:\n {2}openclaw:\n/m);
	assert.match(text, /^ {4}homepage: https:\/\/agent-data-tools\.revmesh2074\.workers\.dev$/m);
	assert.match(text, /^ {4}primaryEnv: AGENT_DATA_TOOLS_KEY$/m);
	assert.match(text, /^ {6}- name: AGENT_DATA_TOOLS_KEY\n {8}required: false\n/m);
	// The key is optional, so it must not gate the skill.
	assert.ok(!/requires:/.test(text), 'no requires block');
	// ClawHub does not support paid skills or pricing metadata.
	assert.ok(!/^(price|pricing|license):/m.test(text));
	// Every environment variable the body mentions is declared.
	for (const [, variable] of skill.matchAll(/\$\{?([A-Z][A-Z0-9_]{3,})\}?/g)) assert.equal(variable, 'AGENT_DATA_TOOLS_KEY');
});

check('every tool path in the skill is a tool of the service', () => {
	const rows = [...skill.matchAll(/^\| [^|]+ \| `(\/[^`]+)` \| (.+) \|$/gm)];
	assert.ok(rows.length >= 25, `${rows.length} job rows`);
	for (const [, toolPath, inputs] of rows) {
		const op = api.paths[toolPath]?.get;
		assert.ok(op, `${toolPath} is in the OpenAPI document`);
		const known = new Set((op.parameters ?? []).map((p) => p.name));
		for (const [, input] of inputs.matchAll(/[`&]([A-Za-z]+)=/g)) assert.ok(known.has(input), `${toolPath} takes ${input}`);
	}
	// The balance row names the same tool on four more chains.
	for (const chain of ['eth', 'arb', 'op', 'polygon']) assert.ok(api.paths[`/${chain}/balance`], `/${chain}/balance`);
	for (const p of ['/credits/usdc/1', '/credits/usdc/5', '/credits/usdc/20']) assert.ok(api.paths[p], p);
	// Every URL points at the service, GitHub or nothing else.
	for (const [url] of skill.matchAll(/https?:\/\/[^\s`"')>]+/g)) {
		assert.ok(url.startsWith(HOST) || url.startsWith('https://github.com/Nutshell2000/agent-data-tools') || url.startsWith('https://example.com'), url);
	}
});

check('numbers in the skill match the service', () => {
	const count = Number(/^(\d+) pay-per-call tools/.exec(api.info.description)[1]);
	assert.ok(count >= 680, `the service lists ${count} tools; the skill says more than 680`);
	assert.match(api.info.description, /from \$0\.002 a call, most at \$0\.01/);
	assert.match(api.info.description, /25 over MCP, 3 over HTTP/);
	const price = (p) => api.paths[p].get['x-payment-info'].price.amount;
	assert.equal(price('/credits/usdc/5'), '5.00');
	assert.match(api.paths['/credits/usdc/1'].get.summary, /1,000 tool credits/);
	assert.match(api.paths['/credits/usdc/5'].get.summary, /5,000 tool credits/);
	assert.match(api.paths['/credits/usdc/20'].get.summary, /22,000 tool credits/);
	assert.match(api.paths['/credits/buy/100'].get.summary, /125,000 prepaid tool credits/);
	// The example quote: /cve at $0.002 is 2000 base units of USDC.
	assert.equal(price('/cve'), '0.002');
	for (const network of ['Base', 'Polygon', 'Arbitrum', 'Solana']) assert.ok(api.info.description.includes(network), network);
});

check('the bundle is a Claude-format bundle with one remote MCP server', () => {
	const bundle = path.join(here, 'bundle');
	const manifest = JSON.parse(fs.readFileSync(path.join(bundle, '.claude-plugin', 'plugin.json'), 'utf8'));
	assert.equal(manifest.name, 'agent-data-tools');
	assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
	assert.equal(manifest.author.name, 'SpellzCode');
	assert.equal(manifest.repository, 'https://github.com/Nutshell2000/agent-data-tools');
	assert.equal(manifest.mcpServers, undefined, 'MCP servers live in .mcp.json');
	const mcp = JSON.parse(fs.readFileSync(path.join(bundle, '.mcp.json'), 'utf8'));
	assert.deepEqual(mcp, { mcpServers: { 'agent-data-tools': { url: `${HOST}/mcp/compact`, transport: 'streamable-http' } } });
	// Exactly one bundle marker, no native manifest (OpenClaw would treat the folder as a native plugin).
	for (const other of ['.codex-plugin', '.cursor-plugin', 'openclaw.plugin.json', 'plugin.json', 'package.json']) assert.ok(!fs.existsSync(path.join(bundle, other)), other);
	const icon = fs.readFileSync(path.join(bundle, 'assets', 'icon.png'));
	assert.equal(icon.subarray(1, 4).toString(), 'PNG');
	assert.ok(icon.length <= 512 * 1024);
	const files = [];
	const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : files.push(path.relative(bundle, path.join(dir, e.name)).replace(/\\/g, '/'))));
	walk(bundle);
	assert.deepEqual(files.sort(), ['.claude-plugin/plugin.json', '.mcp.json', 'assets/icon.png', 'skills/agent-data-tools/SKILL.md']);
});

let failed = 0;
for (const [name, fn] of checks) {
	try {
		fn();
		console.log(`ok   ${name}`);
	} catch (error) {
		failed++;
		console.log(`FAIL ${name}\n     ${String(error.message).split('\n').join('\n     ')}`);
	}
}
process.exit(failed ? 1 : 0);
