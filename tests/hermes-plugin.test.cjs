// The Hermes Agent plugin package in integrations/hermes (a portable Agent Plugins v1 package: plugin.json, mcp.json,
// skills/). Hermes's plugin catalog pins one commit of this repository, so what the package says must stay true while
// prices move: it connects the compact server (three tools), declares call_tool's cost as the range from the cheapest
// key price to the compact server's price ceiling (both constants the service enforces, not today's prices), and its
// skill and README name only tools that server reaches. Rerun `node scripts/build-hermes-plugin.mjs` after changing
// src/lib/hermes-plugin.ts or the ceiling, and bump HERMES_PLUGIN_VERSION when the package's files change.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const esbuild = require('esbuild');
const Module = require('node:module');

async function load(entry) {
  const b = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['cloudflare:workers'], logLevel: 'silent' });
  const m = new Module(entry, module); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(b.outputFiles[0].text, entry); return m.exports;
}
const DIR = join(__dirname, '..', 'integrations', 'hermes');
// A Windows checkout may hold CRLF; the committed files are LF.
const read = (file) => readFileSync(join(DIR, file), 'utf8').replace(/\r\n/g, '\n');
const filesIn = (dir, prefix = '') => readdirSync(dir).flatMap((name) => statSync(join(dir, name)).isDirectory() ? filesIn(join(dir, name), `${prefix}${name}/`) : [`${prefix}${name}`]);
const credits = (price) => Math.round(Number(price.slice(1)) * 1000);

let hermes, contract, reach, names, sections, CAPACITY_LIMITED, keyPrice, ENDPOINTS;
before(async () => {
  hermes = await load(require.resolve('../src/lib/hermes-plugin.ts'));
  contract = await load(require.resolve('../src/mcp-contract.ts'));
  ({ ENDPOINTS } = await load(require.resolve('../src/endpoints.ts')));
  ({ CAPACITY_LIMITED } = await load(require.resolve('../src/lib/capacity.ts')));
  ({ keyPrice } = await load(require.resolve('../src/lib/key-prices.ts')));
  const { mcpBundleTools } = await load(require.resolve('../src/discovery.ts'));
  sections = (name) => Boolean(mcpBundleTools(name)?.length);
  // What call_tool can run at the address the package connects, the capped twin: the filter mcp.ts handleMcp applies.
  reach = ENDPOINTS.filter((e) => contract.compactReach(e, true));
  names = new Set(reach.map((e) => contract.toolName(e)));
});

test('the package holds configuration and text only, and its manifests are the generated ones', () => {
  assert.deepEqual(filesIn(DIR).sort(), ['README.md', 'config.yaml', 'mcp.json', 'plugin.json', 'skills/agent-data-tools/SKILL.md']);
  for (const [file, value] of Object.entries(hermes.hermesPluginFiles())) {
    assert.equal(read(file), `${JSON.stringify(value, null, 2)}\n`, `run \`node scripts/build-hermes-plugin.mjs\`: ${file} is stale`);
  }
});

test('plugin.json: one untrusted server; finding is free and call_tool is declared from the cheapest key price to the ceiling', () => {
  const plugin = JSON.parse(read('plugin.json'));
  assert.equal(plugin.name, 'agent-data-tools');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  const servers = plugin.extensions['com.nousresearch.hermes'].servers;
  assert.deepEqual(Object.keys(servers), ['agent-data-tools']);
  const server = servers['agent-data-tools'];
  assert.equal(server.trust, 'untrusted');
  assert.equal(server.cost_unit, 'credits');
  // A cost for each of the compact server's tools and for nothing else.
  assert.deepEqual(Object.keys(server.costs).sort(), [...contract.COMPACT_TOOLS].sort());
  assert.equal(server.costs.find_tool, 0);
  assert.equal(server.costs.tool_details, 0);
  // Hermes accepts a number, [min, max] or { credits, note } and nothing else in a cost (tools/mcp_tool_costs.py).
  assert.deepEqual(Object.keys(server.costs.call_tool).sort(), ['credits', 'note']);
  const [low, high] = server.costs.call_tool.credits;
  assert.equal(high, credits(contract.COMPACT_PRICE_CEILING));
  assert.equal(low, 1);
  // Every tool call_tool can run costs a key something inside the declared range, at today's prices and any later
  // ones: the ceiling is applied to the public price, and a key never pays more than that.
  assert.ok(reach.length > 600);
  for (const e of reach) {
    const cost = credits(keyPrice(e.path, e.price));
    assert.ok(cost >= low && cost <= high && cost <= credits(e.price), `${e.path}: ${cost} credits is outside the declared ${low}-${high}`);
  }
  assert.ok(reach.some((e) => credits(keyPrice(e.path, e.price)) === low), 'the declared minimum is a real price');
  // Hermes books the top of the range per call: the limit holds a whole number of calls, and more than a handful.
  assert.equal(server.spend_limit, hermes.HERMES_SPEND_LIMIT);
  assert.ok(server.spend_limit % high === 0 && server.spend_limit / high >= 10);
  // No key is declared: the package must work for the free calls with nothing set (see mcp.json below).
  assert.equal(plugin.extensions['com.nousresearch.hermes'].config_schema, undefined);
});

test('mcp.json: one Streamable HTTP server on the capped compact address, with no header and no placeholder', () => {
  assert.equal(hermes.HERMES_BUNDLE, contract.COMPACT_CAPPED_BUNDLE);
  const url = `https://agent-data-tools.revmesh2074.workers.dev/mcp/${contract.COMPACT_CAPPED_BUNDLE}`;
  const mcp = JSON.parse(read('mcp.json'));
  assert.deepEqual(mcp.mcpServers, { 'agent-data-tools': { type: 'streamable-http', url } });
  // Hermes refuses to start a remote server whose url or headers still hold an unset ${VAR}.
  assert.ok(!read('mcp.json').includes('${'));
  // The key entry a user adds themselves names the same server and address, in the file and in the README.
  const entry = `mcp_servers:\n  agent-data-tools:\n    url: "${url}"\n    headers:\n      Authorization: "Bearer \${AGENT_DATA_TOOLS_KEY}"\n`;
  assert.ok(read('config.yaml').endsWith(entry));
  assert.ok(read('README.md').includes(entry));
});

test('the skill and the README name only tools the compact server has or reaches', () => {
  const skill = read('skills/agent-data-tools/SKILL.md');
  assert.match(skill, /^---\nname: agent-data-tools\ndescription: "/);
  const description = /\ndescription: "([^"\n]+)"\n/.exec(skill)[1];
  assert.ok(description.length <= 1024 && /Use when /.test(description));
  const own = new Set(contract.COMPACT_TOOLS);
  // Words in backticks that are not tools: config keys, argument names, a field of find_tool's answer.
  const notTools = new Set(['spend_limit', 'mcp_servers', 'name', 'arguments', 'inFreeCalls', 'terms', 'untrusted', 'max_price']);
  const mentioned = new Set();
  for (const text of [skill, read('README.md')]) {
    for (const [, name] of text.matchAll(/`(?:mcp__agent-data-tools__)?([a-z][A-Za-z0-9_]*)`/g)) if (!notTools.has(name)) mentioned.add(name);
  }
  for (const name of own) assert.ok(mentioned.has(name), `${name} is not explained`);
  const called = [...mentioned].filter((name) => !own.has(name));
  // No name here may be a tool on the approved price ladder (11 Nov 2026: /news and the two research packs go to $0.25, above
  // the capped address's limit): a pinned skill must not name a tool that is about to leave the address it connects.
  for (const laddered of ['news', 'pack_news_sentiment', 'pack_web_research', 'crypto_news']) assert.ok(!mentioned.has(laddered), ` is on the price ladder`);
  assert.ok(called.length >= 15, `expected the skill to name tools for call_tool, found ${called.length}`);
  for (const name of called) assert.ok(names.has(name), `${name} is not a tool call_tool can run`);
  // No catalog tool may be named like one of the compact server's own tools.
  for (const name of own) assert.ok(!names.has(name));
});

test('what the texts say about free calls, prices, approvals and counts is what the service does', () => {
  const skill = read('skills/agent-data-tools/SKILL.md');
  const readme = read('README.md');
  const byName = (name) => reach.find((e) => contract.toolName(e) === name);
  // Tools named as needing a key from the first call are capacity-limited; the reading tools are in the free calls.
  for (const paidOnly of ['search', 'extract_rendered', 'screenshot', 'transcribe']) assert.ok(CAPACITY_LIMITED.has(byName(paidOnly).path), `${paidOnly} is named as needing a key`);
  for (const free of ['extract', 'pdf_text', 'contents', 'wikipedia', 'weather', 'fx', 'price_token', 'sanctions_check', 'dns_lookup', 'hash']) assert.ok(!CAPACITY_LIMITED.has(byName(free).path), `${free} is described as in the free calls`);
  // "Most tools cost 10 credits, reading a page or a PDF 2, a converter or hash 1, and none more than 100."
  const cost = (name) => credits(keyPrice(byName(name).path, byName(name).price));
  assert.ok(reach.filter((e) => credits(keyPrice(e.path, e.price)) === 10).length > reach.length / 2);
  assert.equal(cost('extract'), 2);
  assert.equal(cost('pdf_text'), 2);
  assert.equal(cost('hash'), 1);
  const flat = (text) => text.replace(/\s+/g, ' ');
  const [, high] = hermes.hermesCallRange();
  for (const text of [skill, readme]) assert.ok(text.replace(/\s+/g, ' ').includes(`more than ${high}`), 'the ceiling is stated in credits');
  assert.ok(readme.replace(/\s+/g, ' ').includes(`never more than ${high} credits ($${(high / 1000).toFixed(2)}) a call`));
  // The ceiling is enforced, not only stated: a tool priced above it is outside call_tool's reach, one at it is inside.
  const sample = byName('weather');
  assert.equal(contract.compactReach({ ...sample, price: contract.COMPACT_PRICE_CEILING }, true), true);
  assert.equal(contract.compactReach({ ...sample, price: '$0.11' }, true), false);
  assert.equal(contract.compactReach({ ...sample, price: '$1.00' }, true), false);
  // The uncapped address reaches it, which is why the package does not connect that one (the README says so).
  assert.equal(contract.compactReach({ ...sample, price: '$1.00' }), true);
  assert.ok(flat(readme).includes('The same three tools without the cap are at `/mcp/compact`'));
  // Every tool it reaches only reads: the four that write are the whole difference from the read-only catalog.
  assert.ok(reach.every((e) => contract.annotationsFor(e.path).readOnlyHint === true));
  assert.equal(ENDPOINTS.filter((e) => contract.annotationsFor(e.path).readOnlyHint !== true).length, 4);
  assert.ok(readme.includes("the service's four tools that write"));
  assert.ok(readme.includes('(Streamable HTTP, 3 tools)') && contract.COMPACT_TOOLS.length === 3);
  // The section servers the README offers as the alternative exist.
  for (const [, section] of readme.matchAll(/`\/mcp\/([a-z]+)`/g)) assert.ok(section === contract.COMPACT_BUNDLE || sections(section), `/mcp/${section} is not a server`);
  // The spend numbers in the texts are the package's own.
  const limit = hermes.HERMES_SPEND_LIMIT;
  assert.ok(flat(readme).includes(`a range of 1 to ${high} credits`));
  assert.ok(flat(readme).includes(`limit of ${limit.toLocaleString('en-US')} credits ($${(limit / 1000).toFixed(2)}) per chat`));
  assert.equal(limit / high, 10);
  assert.ok(flat(readme).includes('asks after ten `call_tool` calls'));
  assert.ok(flat(skill).includes(`counts every \`call_tool\` call as ${high} and stops to ask when one chat has reached ${limit}`));
  for (const text of [skill, readme]) assert.match(flat(text), /first 25 successful `call_tool` calls/);
  // Rule 13 of the catalog: network, money, approvals, credentials and stored data are each disclosed.
  for (const heading of ['**Network.**', '**Money.**', '**Approvals.**', '**Credentials.**', '**What the service keeps.**', '**No telemetry, no background process, no self-update.**']) assert.ok(readme.includes(heading), heading);
});
