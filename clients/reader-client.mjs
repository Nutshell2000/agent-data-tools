import { runReader } from "./reader-core.mjs";
const outcome = await runReader(process.argv.slice(2));
process.stdout.write(JSON.stringify(outcome) + "\n");
if (!outcome.ok) process.exitCode = 1;
