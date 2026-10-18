import { runChain } from "./core.mjs";
const outcome = await runChain(process.argv.slice(2));
process.stdout.write(JSON.stringify(outcome) + "\n");
if (!outcome.ok) process.exitCode = 1;
