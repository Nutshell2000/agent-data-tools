// One tool count (16 Nov 2026). The number of tools was typed by hand in several places and they disagreed (the README
// said 187 and "more than 600", server.json 725). TOOL_COUNT (src/endpoints.ts) is the count: the tools a caller can
// call, entry paths (second names) left out. Code reads it; the static files cannot, so this test fails when README.md,
// server.json or a generated registry manifest states another number. To fix a failure: node scripts/bump-version.mjs <version>.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync, readdirSync } = require('node:fs');
const { before, test } = require('node:test');
const { build } = require('esbuild');

let lib;
before(async () => {
  const built = await build({ stdin: { contents: 'export * from "./src/discovery"; export { ENTRY_OF } from "./src/routes/entry-paths"; export { EXTRA_CHAIN_PATHS } from "./src/routes/chain-reads";', resolveDir: process.cwd(), sourcefile: 'tool-count-entry.ts', loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(mod, mod.exports, require);
  lib = mod.exports;
});

test('TOOL_COUNT is every tool once: the catalog without its entry paths, the /mcp/all list plus the extra chain reads', () => {
  const { ENDPOINTS, ENTRY_OF, EXTRA_CHAIN_PATHS, TOOL_COUNT, MCP_BUNDLES, mcpBundleTools, mcpListed } = lib;
  const canonical = ENDPOINTS.filter((e) => !Object.hasOwn(ENTRY_OF, e.path));
  assert.equal(TOOL_COUNT, canonical.length);
  assert.ok(TOOL_COUNT > 500 && TOOL_COUNT < ENDPOINTS.length);
  assert.equal(TOOL_COUNT, canonical.filter((e) => !EXTRA_CHAIN_PATHS.has(e.path)).length + canonical.filter((e) => EXTRA_CHAIN_PATHS.has(e.path)).length);
  // Every entry path runs a tool that is counted, so nothing a caller can reach is left out of the count.
  for (const [door, tool] of Object.entries(ENTRY_OF)) if (ENDPOINTS.some((e) => e.path === door)) assert.ok(canonical.some((e) => e.path === tool), `${door} runs ${tool}`);
  // The section servers together list each counted tool exactly once.
  assert.equal(Object.keys(MCP_BUNDLES).reduce((sum, slug) => sum + mcpListed(mcpBundleTools(slug)).length, 0), TOOL_COUNT);
});

test('everything the service generates states TOOL_COUNT', () => {
  const { TOOL_COUNT, SERVICE_SUMMARY, PAGE_TITLE, mcpServerCard, homePage, llmsTxt, mcpInstallLinks } = lib;
  const payTo = '0x0000000000000000000000000000000000000001';
  assert.match(SERVICE_SUMMARY, new RegExp(`^${TOOL_COUNT} pay-per-call tools`));
  assert.match(PAGE_TITLE, new RegExp(` ${TOOL_COUNT} tools, `));
  const card = mcpServerCard('https://example.test');
  assert.equal(card.toolCount, TOOL_COUNT);
  assert.equal(card.transport.endpoint, 'https://example.test/mcp');
  assert.equal(card.fullList.endpoint, 'https://example.test/mcp/all');
  assert.equal(card.bundles.reduce((sum, b) => sum + b.tools, 0), TOOL_COUNT);
  const home = homePage('https://example.test', payTo);
  assert.ok(home.includes(`Tools and prices: all ${TOOL_COUNT}`));
  // The install links promise "every tool as its own definition" at the address that lists them.
  assert.equal(mcpInstallLinks('https://example.test').full, 'https://example.test/mcp/all');
  assert.ok(home.includes('For every tool as its own definition, connect <code>https://example.test/mcp/all</code>'));
  assert.match(llmsTxt('https://example.test', false, payTo), /every tool as its own definition: https:\/\/example\.test\/mcp\/all\)/);
});

test('README.md and server.json state TOOL_COUNT wherever they count the tools', () => {
  const { TOOL_COUNT } = lib;
  const server = JSON.parse(readFileSync('server.json', 'utf8'));
  // The release train's own check: every pinned count and version against the live catalog.
  const out = execFileSync(process.execPath, ['scripts/bump-version.mjs', server.version, '--check'], { encoding: 'utf8', timeout: 120_000 });
  assert.match(out, new RegExp(`: ${TOOL_COUNT} tools, `));
  assert.match(server.description, new RegExp(`^${TOOL_COUNT} agent tools:`));
  // And no other number of tools anywhere in the README (it said 187, 179 and "more than 600" at once).
  const readme = readFileSync('README.md', 'utf8');
  const stated = [...readme.matchAll(/\b(\d{3,4}) (?:pay-per-call |catalog |data |agent )?tools\b/g)].map((m) => Number(m[1]));
  assert.ok(stated.length >= 4, `the README states the count ${stated.length} times`);
  for (const n of stated) assert.equal(n, TOOL_COUNT, `README.md states ${n} tools`);
  assert.doesNotMatch(readme, /more than \d+ tools/);
  assert.match(readme, /Every tool as its own definition: `https:\/\/agent-data-tools\.revmesh2074\.workers\.dev\/mcp\/all`/);
});

test('the registry manifests state the same counts and name /mcp/all for the full list', () => {
  const { TOOL_COUNT, ENDPOINTS, ENTRY_OF, EXTRA_CHAIN_PATHS, MCP_BUNDLES, mcpBundleTools, mcpListed } = lib;
  execFileSync(process.execPath, ['scripts/build-registry-manifests.mjs'], { encoding: 'utf8', timeout: 120_000 });
  const manifest = (slug) => JSON.parse(readFileSync(`registry/${slug}.json`, 'utf8'));
  assert.match(manifest('compact').description, new RegExp(`find, describe and run ${TOOL_COUNT} data tools`));
  const all = manifest('all');
  assert.match(all.remotes[0].url, /\/mcp\/all$/);
  assert.match(all.description, new RegExp(`^${ENDPOINTS.filter((e) => !EXTRA_CHAIN_PATHS.has(e.path) && !Object.hasOwn(ENTRY_OF, e.path)).length} tools, each its own definition`));
  let sections = 0;
  for (const slug of Object.keys(MCP_BUNDLES)) {
    const listed = mcpListed(mcpBundleTools(slug)).length;
    assert.match(manifest(slug).description, new RegExp(`^${listed} tools: `), slug);
    sections += listed;
  }
  assert.equal(sections, TOOL_COUNT);
  assert.ok(readdirSync('registry').includes('all.json'));
});
