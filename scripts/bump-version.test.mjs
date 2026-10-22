import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBump, currentPins } from "./bump-version.mjs";

const fixture = () => ({
  "server.json": '{\n  "version": "1.47.11",\n  "description": "181 agent tools: chain data, prices, sanctions, web, PDF. 25 free calls, then from $0.002."\n}\n',
  "src/discovery.ts": 'export const MCP_SERVER_VERSION = "1.47.11";\n',
  "tests/tool-buying.test.cjs": "assert.equal(discovery.ENDPOINTS.length,181);assert.equal(mcp.serverInfo.version,'1.47.11');\n",
  "tests/families.test.cjs": "  assert.equal(ENDPOINTS.length,181);\n",
  "tests/gateway-startup.test.cjs": "assert.equal((await client.listTools()).tools.length, 181);\nassert.equal(all.length, 181, 'every tool is in exactly one bundle');\nassert.equal(new Set(all).size, 181);\n",
  "src/endpoints.ts": '"181 pay-per-call tools for AI agents over HTTP or MCP"\n',
});

test("bump rewrites every version and count pin together and reports each change", () => {
  const { files, changes } = applyBump(fixture(), { version: "1.48.0", count: 183 });
  assert.equal(currentPins(files).version, "1.48.0");
  assert.equal(currentPins(files).count, 183);
  assert.match(files["server.json"], /"183 agent tools:/);
  assert.match(files["src/discovery.ts"], /"1\.48\.0"/);
  assert.match(files["tests/tool-buying.test.cjs"], /length,183\);.*version,'1\.48\.0'/);
  assert.equal((files["tests/gateway-startup.test.cjs"].match(/183/g) ?? []).length, 3);
  assert.match(files["src/endpoints.ts"], /"183 pay-per-call tools/);
  assert.equal(changes.length, 10);
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
