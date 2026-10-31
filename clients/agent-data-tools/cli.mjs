#!/usr/bin/env node
// npx agent-data-tools list [words]            tools and prices
// npx agent-data-tools <tool> key=value …      call a tool (name or /path); prints its JSON
import { AgentDataTools, PaymentRequired, ToolError } from "./index.mjs";

const [command, ...rest] = process.argv.slice(2);
const adt = new AgentDataTools();
try {
  if (!command || command === "help" || command === "--help") {
    console.log("Usage:\n  agent-data-tools list [words]\n  agent-data-tools <tool> key=value ...\n\n25 free calls without any setup; set ADT_API_KEY for card credits (from $1 at /credits).");
  } else if (command === "list") {
    for (const t of await adt.tools({ search: rest.join(" ") })) console.log(`${t.name.padEnd(30)} ${t.price.padEnd(8)} ${t.summary}`);
  } else {
    const inputs = {};
    for (const arg of rest) {
      const eq = arg.indexOf("=");
      if (eq < 1) throw new ToolError(`expected key=value, got "${arg}"`, 400, null);
      inputs[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
    console.log(JSON.stringify(await adt.call(command, inputs), null, 2));
  }
} catch (e) {
  console.error(e instanceof PaymentRequired || e instanceof ToolError ? e.message : e);
  process.exitCode = 1;
}
