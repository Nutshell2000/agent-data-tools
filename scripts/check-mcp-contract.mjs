import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { z } from "zod";
import * as z4mini from "zod/v4-mini";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = resolve(root, "scripts/mcp-contract-baseline.json");

async function loadTypeScriptModule(path) {
  const compiled = await build({
    entryPoints: [path],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const url = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`;
  return import(url);
}

export async function loadContractHelpers() {
  return loadTypeScriptModule(resolve(root, "src/mcp-contract.ts"));
}

export function buildContract(endpoints, version, helpers) {
  versionParts(version);
  const names = new Set();
  return {
    version,
    tools: endpoints.map((endpoint) => {
      const name = helpers.toolName(endpoint);
      if (names.has(name)) throw new Error(`Duplicate MCP tool name: ${name}`);
      names.add(name);
      return {
        name,
        description: helpers.toolDescription(endpoint),
        annotations: helpers.toolAnnotations,
        inputSchema: z4mini.toJSONSchema(z.object(helpers.toolInputShape(endpoint, z)), {
          target: "draft-7",
          io: "input",
        }),
        price: endpoint.price,
      };
    }),
  };
}

export function compareContracts(current, baseline) {
  const problems = [];
  if (current.version !== baseline.version) {
    problems.push(`server.json version ${current.version} does not match baseline version ${baseline.version}`);
  }

  const baselineTools = new Map(baseline.tools.map((tool) => [tool.name, tool]));
  const currentTools = new Map(current.tools.map((tool) => [tool.name, tool]));
  for (const name of new Set([...baselineTools.keys(), ...currentTools.keys()])) {
    const expected = baselineTools.get(name);
    const actual = currentTools.get(name);
    if (!expected) problems.push(`Unpinned MCP tool added: ${name}`);
    else if (!actual) problems.push(`Pinned MCP tool removed: ${name}`);
    else if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`MCP contract changed: ${name}`);
  }

  if (
    current.tools.length === baseline.tools.length &&
    current.tools.map((tool) => tool.name).join("\0") !== baseline.tools.map((tool) => tool.name).join("\0")
  ) {
    problems.push("MCP tool order changed");
  }
  return problems;
}

function versionParts(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error(`Expected a stable semantic version (for example 1.2.3), got "${version}"`);
  return match.slice(1).map(Number);
}

function isNewerVersion(next, previous) {
  const a = versionParts(next);
  const b = versionParts(previous);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function updateVersionProblem(next, previous) {
  try {
    return isNewerVersion(next, previous)
      ? undefined
      : `server.json version must increase beyond baseline version ${previous} before updating the MCP contract baseline`;
  } catch (error) {
    return error.message;
  }
}

export function serverVersionProblem(registryVersion, runtimeVersion) {
  return registryVersion === runtimeVersion
    ? undefined
    : `server.json version ${registryVersion} does not match the runtime MCP_SERVER_VERSION ${runtimeVersion}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--update")) {
    throw new Error("Usage: node scripts/check-mcp-contract.mjs [--update]");
  }

  const server = JSON.parse(await readFile(resolve(root, "server.json"), "utf8"));
  const endpointModule = await loadTypeScriptModule(resolve(root, "src/endpoints.ts"));
  const discoveryModule = await loadTypeScriptModule(resolve(root, "src/discovery.ts"));
  const helpers = await loadContractHelpers();
  const versionProblem = serverVersionProblem(server.version, discoveryModule.MCP_SERVER_VERSION);
  if (versionProblem) throw new Error(versionProblem);
  const current = buildContract(endpointModule.ENDPOINTS, server.version, helpers);

  if (args[0] === "--update") {
    let baseline;
    try {
      baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (baseline) {
      const versionProblem = updateVersionProblem(current.version, baseline.version);
      if (versionProblem) throw new Error(versionProblem);
    }
    await writeFile(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Updated MCP contract baseline to version ${current.version} (${current.tools.length} tools).`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("MCP contract baseline is missing; initialize it with npm run update:mcp-contract");
    }
    throw error;
  }
  const problems = compareContracts(current, baseline);
  if (problems.length) {
    throw new Error(
      `${problems.join("\n")}\nReview the contract change, increase server.json version, then run npm run update:mcp-contract.`,
    );
  }
  console.log(`MCP contract matches version ${current.version} (${current.tools.length} tools).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
