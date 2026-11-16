import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBump, currentPins } from "./bump-version.mjs";

const fixture = () => ({
  "server.json": '{\n  "version": "1.47.11",\n  "description": "181 agent tools: chain data, prices, sanctions, web, PDF. 25 free calls, then from $0.002."\n}\n',
  "src/discovery.ts": 'export const MCP_SERVER_VERSION = "1.47.11";\n',
  "tests/tool-buying.test.cjs": "assert.equal(discovery.ENDPOINTS.length,181);assert.equal(mcp.serverInfo.version,'1.47.11');\n",
  "tests/families.test.cjs": "  assert.equal(ENDPOINTS.length,181);\n",
  "tests/gateway-startup.test.cjs": "assert.equal(all.length, 181, 'every tool is in exactly one bundle');\nassert.equal(new Set(all).size, 181);\n",
  "tests/payment-delivery-runtime.test.cjs": "const listed=(await client.listTools()).tools;assert.equal(listed.length,181);\n",
  "README.md": "# Agent Data Tools\n\n181 pay-per-call tools for AI agents over MCP and plain HTTP.\n- [Browse all 181 tools and prices](https://x.example/tools)\nA Cloudflare Worker that sells 181 tools to AI agents.\nAll 181 catalog tools are reachable from the MCP server.\n",
});

test("bump rewrites every version and count pin together and reports each change", () => {
  const { files, changes } = applyBump(fixture(), { version: "1.48.0", count: 183 });
  assert.equal(currentPins(files).version, "1.48.0");
  assert.equal(currentPins(files).count, 183);
  assert.match(files["server.json"], /"183 agent tools:/);
  assert.match(files["src/discovery.ts"], /"1\.48\.0"/);
  assert.match(files["tests/tool-buying.test.cjs"], /length,183\);.*version,'1\.48\.0'/);
  assert.equal((files["tests/gateway-startup.test.cjs"].match(/183/g) ?? []).length, 2);
  assert.equal((files["README.md"].match(/183/g) ?? []).length, 4);
  assert.match(files["tests/payment-delivery-runtime.test.cjs"], /listed\.length,183\)/);
  assert.equal(changes.length, 13);
});

test("the three counts are kept apart: paid paths, tools without entry paths, and the /mcp/all list", () => {
  const { files } = applyBump(fixture(), { version: "1.48.0", count: 190, toolCount: 170, mcpCount: 120 });
  assert.match(files["tests/families.test.cjs"], /ENDPOINTS\.length,190\)/);
  assert.match(files["tests/tool-buying.test.cjs"], /ENDPOINTS\.length,190\)/);
  assert.match(files["server.json"], /"170 agent tools:/);
  assert.match(files["tests/gateway-startup.test.cjs"], /all\.length, 170,[^]*size, 170\)/);
  assert.match(files["README.md"], /\n170 pay-per-call tools[^]*Browse all 170 tools[^]*sells 170 tools[^]*All 170 catalog tools/);
  assert.match(files["tests/payment-delivery-runtime.test.cjs"], /listed\.length,120\)/);
});

test("a no-op bump changes nothing; a missing or doubled pin and a long description are refused", () => {
  const same = applyBump(fixture(), { version: "1.47.11", count: 181 });
  assert.deepEqual(same.changes, []);
  assert.deepEqual(same.files, fixture());
  const missing = fixture(); missing["src/discovery.ts"] = "nothing here\n";
  assert.throws(() => applyBump(missing, { version: "1.47.12", count: 181 }), /src\/discovery\.ts: expected 1/);
  const doubled = fixture(); doubled["tests/families.test.cjs"] += "  assert.equal(ENDPOINTS.length,181);\n";
  assert.throws(() => applyBump(doubled, { version: "1.47.12", count: 181 }), /found 2/);
  const long = fixture(); long["server.json"] = long["server.json"].replace("25 free calls, then from $0.002.", "x".repeat(90));
  assert.throws(() => applyBump(long, { version: "1.47.12", count: 181 }), /allows 100/);
  assert.throws(() => applyBump(fixture(), { version: "1.47", count: 181 }), /x\.y\.z/);
});
