const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');

test('published buying guides and capped clients name the production payTo, never staging', () => {
  const production = '0x6293ded2684f1a76e26becef87c137d691fbf800';
  const staging = '0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5';
  for (const file of ['docs/bitcoin-fees.md', 'examples/bitcoin-fees-http.ts', 'examples/bitcoin-fees-mcp.ts']) {
    const text = readFileSync(file, 'utf8');
    assert.ok(text.toLowerCase().includes(production), `${file} must name the production payTo`);
    assert.ok(!text.toLowerCase().includes(staging), `${file} must not name the staging payTo`);
  }
});

test('general client skill copies teach live input aliases and recoverable sections', () => {
  for (const file of [
    'skills/agent-data-tools/SKILL.md',
    'claude-plugin/skills/agent-data-tools/SKILL.md',
    'integrations/openclaw/skill/agent-data-tools/SKILL.md',
    'integrations/openclaw/bundle/skills/agent-data-tools/SKILL.md',
  ]) {
    const text = readFileSync(file, 'utf8');
    assert.ok(/`ids=`|ids=/.test(text), `${file} teaches input aliases`);
    assert.ok(/sections/.test(text), `${file} teaches the structured section list`);
  }
  // The reader skill is scoped to the page reader: it teaches section recovery, not general input aliases.
  assert.ok(/sections/.test(readFileSync('skills/spellzcode-x402-reader/SKILL.md', 'utf8')));
});
