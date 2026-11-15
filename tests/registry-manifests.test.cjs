const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const { test } = require('node:test');

// 15 Nov 2026: scripts/build-registry-manifests.mjs only ran in the tag workflow, so a focused server whose description
// passed 100 characters (voice, 101) failed the MCP Registry publish of 1.199.0 and 1.201.0 with nobody noticing. This
// runs the real script on every CI run and checks what it wrote.
test('the registry manifest builder runs and every manifest fits the registry limits', () => {
  const out = execFileSync(process.execPath, ['scripts/build-registry-manifests.mjs'], { encoding: 'utf8', timeout: 120_000 });
  assert.match(out, /agent-data-tools-/);
  const files = readdirSync('registry').filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 8, `only ${files.length} manifests`);
  for (const f of files) {
    const m = JSON.parse(readFileSync(`registry/${f}`, 'utf8'));
    assert.ok(m.description.length <= 100, `${f}: description ${m.description.length} characters`);
    assert.match(m.name, /^io\.github\.Nutshell2000\/agent-data-tools-[a-z0-9-]+$/, f);
    assert.match(m.remotes[0].url, /\/mcp\/[a-z0-9-]+$/, f);
  }
});
