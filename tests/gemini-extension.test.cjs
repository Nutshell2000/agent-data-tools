// The Gemini CLI extension manifest (repository root): the gallery at geminicli.com lists a public repository that carries the
// topic gemini-cli-extension and this file at its root. It must stay valid JSON, keep the plugin's name and point at the
// same MCP server as the Claude plugin manifest.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const gemini = JSON.parse(readFileSync(join(root, "gemini-extension.json"), "utf8"));
const claude = JSON.parse(readFileSync(join(root, "claude-plugin", ".claude-plugin", "plugin.json"), "utf8"));

test("the Gemini CLI extension manifest names the same server as the Claude plugin", () => {
  assert.equal(gemini.name, claude.name);
  assert.match(gemini.version, /^\d+\.\d+\.\d+$/);
  assert.ok(gemini.description.length > 40 && gemini.description.length <= 300);
  const servers = Object.entries(gemini.mcpServers);
  assert.equal(servers.length, 1);
  const [name, server] = servers[0];
  assert.equal(name, claude.name);
  // Gemini CLI reads a streamable-HTTP server from httpUrl; a plain url would be read as SSE.
  assert.equal(server.httpUrl, claude.mcpServers[claude.name].url);
  assert.deepEqual(Object.keys(server), ["httpUrl"]);
});

test("the manifest holds nothing a clone would run", () => {
  assert.deepEqual(Object.keys(gemini).sort(), ["description", "mcpServers", "name", "version"]);
});
