import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContract,
  compareContracts,
  loadContractHelpers,
  serverVersionProblem,
  updateVersionProblem,
} from "./check-mcp-contract.mjs";

const helpers = await loadContractHelpers();
const endpoint = {
  path: "/lookup",
  price: "$0.005",
  description: "Look up a value.",
  params: {
    name: { type: "string", description: "Name to look up", required: true },
    limit: { type: "integer", description: "Maximum results" },
    score: { type: "number", description: "Minimum score" },
    format: { type: "string", description: "Output format", enum: ["json", "text"] },
  },
};

test("builds a priced contract with required, numeric, and enum parameter schemas", () => {
  const contract = buildContract([endpoint], "2.3.4", helpers);

  assert.deepEqual(contract, {
    version: "2.3.4",
    tools: [
      {
        name: "lookup",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        description: "Look up a value. Costs $0.005 in USDC on Base per successful call, paid with x402.",
        inputSchema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: {
            name: { type: "string", description: "Name to look up" },
            limit: {
              type: "integer",
              minimum: Number.MIN_SAFE_INTEGER,
              maximum: Number.MAX_SAFE_INTEGER,
              description: "Maximum results",
            },
            score: { type: "number", description: "Minimum score" },
            format: { type: "string", enum: ["json", "text"], description: "Output format" },
          },
          required: ["name"],
        },
        price: "$0.005",
      },
    ],
  });
});

test("requires a strictly higher stable version for baseline updates", () => {
  assert.equal(updateVersionProblem("1.0.2", "1.0.1"), undefined);
  assert.match(updateVersionProblem("1.0.1", "1.0.1"), /must increase/);
  assert.match(updateVersionProblem("1.0.0", "1.0.1"), /must increase/);
  assert.match(updateVersionProblem("1.1", "1.0.1"), /stable semantic version/);
});

test("requires registry and runtime MCP versions to match", () => {
  assert.equal(serverVersionProblem("1.0.1", "1.0.1"), undefined);
  assert.match(serverVersionProblem("1.0.2", "1.0.1"), /does not match/);
});

test("detects tool contract drift and order changes", () => {
  const baseline = buildContract([endpoint], "2.3.4", helpers);
  assert.deepEqual(compareContracts(buildContract([endpoint], "2.3.4", helpers), baseline), []);

  const changed = buildContract([{ ...endpoint, price: "$0.01" }], "2.3.4", helpers);
  assert.deepEqual(compareContracts(changed, baseline), ["MCP contract changed: lookup"]);
  assert.deepEqual(compareContracts(buildContract([endpoint], "2.3.5", helpers), baseline), [
    "server.json version 2.3.5 does not match baseline version 2.3.4",
  ]);
  assert.deepEqual(compareContracts(buildContract([{ ...endpoint, path: "/lookup-new" }], "2.3.4", helpers), baseline), [
    "Pinned MCP tool removed: lookup",
    "Unpinned MCP tool added: lookup_new",
    "MCP tool order changed",
  ]);
});

test("pins exact output schemas and detects output-only drift",()=>{
  const schema={type:"object",oneOf:[{required:["text"],not:{required:["markdown"]}},{required:["markdown"],not:{required:["text"]}}]};
  const baseline=buildContract([{...endpoint,outputSchema:schema}],"2.3.4",helpers);
  assert.deepEqual(baseline.tools[0].outputSchema,schema);
  assert.deepEqual(helpers.protocolTool({...endpoint,outputSchema:schema}).outputSchema,schema);
  assert.deepEqual(compareContracts(buildContract([{...endpoint,outputSchema:{type:"object"}}],"2.3.4",helpers),baseline),["MCP contract changed: lookup"]);
});
