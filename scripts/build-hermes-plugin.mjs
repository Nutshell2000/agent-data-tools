// Writes integrations/hermes/plugin.json and mcp.json: the portable Agent Plugins v1 package that Hermes Agent's plugin
// catalog pins (NousResearch/hermes-agent, plugin-catalog/agent-data-tools.yaml). Configuration only: one remote MCP
// server (the compact server, /mcp/compact) and one skill. The declared costs come from two constants (the cheapest key
// price and the compact server's price ceiling): after changing either, tests/hermes-plugin.test.cjs fails until this
// script is rerun, and the catalog entry then needs a new pin.
// Run: node scripts/build-hermes-plugin.mjs
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const b = await build({ entryPoints: ["src/lib/hermes-plugin.ts"], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent", external: ["cloudflare:workers"] });
const m = { exports: {} };
new Function("module", "exports", "require", b.outputFiles[0].text)(m, m.exports, require);
mkdirSync("integrations/hermes", { recursive: true });
for (const [file, value] of Object.entries(m.exports.hermesPluginFiles())) {
  writeFileSync(`integrations/hermes/${file}`, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`integrations/hermes/${file} written`);
}
