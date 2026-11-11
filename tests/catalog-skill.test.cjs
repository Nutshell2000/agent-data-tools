// The catalog skill (src/guides/catalog-skill.ts), the Agent Skills discovery index, the Claude Code plugin files and the
// free tool finder: what a model reads to learn which of our paths to call must stay true to the catalog.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

const PRODUCTION = 'https://agent-data-tools.revmesh2074.workers.dev';
async function load(entry) {
  const b = await build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

let mf;
before(async () => {
  const b = await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser', write: false, external: ['cloudflare:workers', 'node:*'], plugins: [{ name: 'url', setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: 'node:url', external: true })); } }] });
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: b.outputFiles[0].text, compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'], durableObjects: { METRICS: { className: 'Metrics', useSQLite: true } }, bindings: { PAY_TO: '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5', NETWORK: 'eip155:8453', PAYWALL: 'on', TRIALS_ENABLED: 'on', FACILITATOR_URL: 'https://fixture.invalid', BASE_RPC_URL: 'https://fixture.invalid' }, outboundService: async () => new Response('no network in this test', { status: 500 }) }));
});
after(async () => { await mf?.dispose(); });
const get = (path) => mf.dispatchFetch('https://api.test' + path, { headers: { accept: 'application/json' } });

test('the repository skill is the text the Worker serves, and names only live tools and real inputs', async () => {
  const { catalogSkillMarkdown, CATALOG_SKILL_JOBS, CATALOG_SKILL_NAME, CATALOG_SKILL_DESCRIPTION } = await load('src/guides/catalog-skill.ts');
  const { ENDPOINTS } = await load('src/endpoints.ts');
  const repo = readFileSync(`skills/${CATALOG_SKILL_NAME}/SKILL.md`, 'utf8');
  assert.equal(repo, catalogSkillMarkdown(PRODUCTION), 'run `node scripts/build-catalog-skill.mjs` after editing the skill');
  // Agent Skills format: name is the folder name, lowercase with hyphens, and the description fits 1,024 characters.
  assert.match(repo, new RegExp(`^---\\nname: ${CATALOG_SKILL_NAME}\\ndescription: "`));
  assert.match(CATALOG_SKILL_NAME, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(CATALOG_SKILL_DESCRIPTION.length <= 1024 && /Use when /.test(CATALOG_SKILL_DESCRIPTION));
  for (const [job, path, inputs] of CATALOG_SKILL_JOBS) {
    const e = ENDPOINTS.find((x) => x.path === path);
    assert.ok(e, `${job}: ${path} is not a live tool`);
    for (const [, name] of inputs.matchAll(/(?:^|[&\s(])([a-zA-Z_]+)=/g)) assert.ok(Object.hasOwn(e.params, name), `${path} has no input ${name}`);
    for (const [name, p] of Object.entries(e.params)) if (p.required) assert.ok(inputs.includes(`${name}=`), `${path}: required input ${name} is not shown`);
  }
  // Every other path the text mentions exists too.
  for (const path of ['/find', '/credits', '/credits/balance', '/credits/usdc/5', '/openapi.json', '/llms.txt', '/terms', '/mcp']) assert.ok(repo.includes(`${PRODUCTION}${path}`), path);
  assert.ok(!/\$0\.0\d+ (for|per) [a-z/]+\b.*\$0\.0\d+ (for|per)/.test(repo.split('\n').find((l) => l.startsWith('| ')) ?? ''), 'no per-tool prices in the table: they change');
});

test('the skill and its discovery index are served, with the digest of the served bytes', async () => {
  const served = await get('/.well-known/agent-skills/agent-data-tools/SKILL.md');
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type'), /text\/markdown/);
  const text = await served.text();
  assert.match(text, /^---\nname: agent-data-tools\n/);
  assert.ok(text.includes('https://api.test/find?need='), 'the served copy names the host that served it');
  assert.equal(await (await get('/skills/agent-data-tools/SKILL.md')).text(), text);
  const index = await (await get('/.well-known/agent-skills/index.json')).json();
  assert.equal(index.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  assert.deepEqual(index.skills.map((s) => s.name), ['agent-data-tools', 'spellzcode-x402-reader']);
  for (const s of index.skills) {
    assert.equal(s.type, 'skill-md');
    const body = Buffer.from(await (await get(s.url)).arrayBuffer());
    assert.equal(s.digest, 'sha256:' + createHash('sha256').update(body).digest('hex'), s.name);
  }
});

test('the free finder names the call for a job without a payment', async () => {
  const res = await get('/find?need=current%20gas%20price%20on%20Base');
  assert.equal(res.status, 200);
  assert.equal(res.headers.has('PAYMENT-REQUIRED'), false);
  const found = await res.json();
  assert.equal(found.free, true); assert.equal(found.method, 'lexical');
  assert.equal(found.picks[0].tool, '/base-gas');
  assert.match(found.picks[0].call.url, /^https:\/\/api\.test\/base-gas/);
  assert.match(found.howToPay, /https:\/\/api\.test\/credits\/usdc\/5/);
  // Other spellings of the question, the count, and the two refusals.
  assert.equal((await (await get('/find?q=pdf%20to%20text&count=2')).json()).picks.length, 2);
  const empty = await get('/find');
  assert.equal(empty.status, 400); assert.match((await empty.json()).error, /plain words/);
  const none = await get('/find?need=zzzzqqqq');
  assert.equal(none.status, 404);
  const body = await none.json(); assert.deepEqual(body.picks, []); assert.match(body.catalog, /discovery\/resources/);
  // A guessed path points at the finder.
  assert.match((await (await get('/no-such-tool')).json()).find, /\/find\?need=/);
});

test('the Claude Code plugin is its own small folder: manifest, icon and the same skill text, nothing else', () => {
  // The plugin directory scans every file of a plugin. With the repository root as the plugin (1.110.0) its validator
  // blocked on the service's own code (package.json, lockfile, test fixtures that look like credentials). The plugin is
  // therefore a folder that holds only what a user installs.
  const { readdirSync, statSync } = require('node:fs');
  const files = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const p = `${dir}/${name}`; if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk('claude-plugin');
  assert.deepEqual(files.sort(), ['claude-plugin/.claude-plugin/icon.png', 'claude-plugin/.claude-plugin/plugin.json', 'claude-plugin/skills/agent-data-tools/SKILL.md']);
  const plugin = JSON.parse(readFileSync('claude-plugin/.claude-plugin/plugin.json', 'utf8'));
  assert.equal(plugin.name, 'agent-data-tools');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.license, require('../package.json').license);
  assert.equal(plugin.privacyPolicyUrl, `${PRODUCTION}/privacy`);
  // The directory's listing links: without these it took support and documentation from the README (/openapi.json and a download).
  for (const [field, path] of Object.entries({ termsOfServiceUrl: '/terms', supportUrl: '/support', documentationUrl: '/tools' })) assert.equal(plugin[field], `${PRODUCTION}${path}`, field);
  assert.deepEqual(plugin.mcpServers['agent-data-tools'], { type: 'http', url: `${PRODUCTION}/mcp/compact` });
  // The plugin's skill is the repository skill, byte for byte (scripts/build-catalog-skill.mjs writes both).
  assert.equal(readFileSync('claude-plugin/skills/agent-data-tools/SKILL.md', 'utf8'), readFileSync('skills/agent-data-tools/SKILL.md', 'utf8'));
  // A square PNG of at least 512 px, as the directory asks (width and height are in the PNG header).
  const png = readFileSync('claude-plugin/.claude-plugin/icon.png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
  assert.ok(png.readUInt32BE(16) >= 512 && png.length < 2 * 1024 * 1024);
  const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, './claude-plugin');
  // No plugin manifest at the repository root: the root must not be read as a plugin again.
  assert.equal(require('node:fs').existsSync('.claude-plugin/plugin.json'), false);
});