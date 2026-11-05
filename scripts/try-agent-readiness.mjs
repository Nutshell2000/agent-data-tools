import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
const require = createRequire(import.meta.url);
const entry = fileURLToPath(new URL("../src/routes/agent-readiness.ts", import.meta.url));
const built = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent" });
const mod = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, require);
for (const url of process.argv.slice(2)) {
  const t0 = Date.now();
  try { const o = await mod.exports.AGENT_READINESS[0].run({}, (n) => ({ url })[n]); console.log(`${url}: ${Date.now() - t0} ms score ${o.score} ${o.grade} | found ${o.checks.filter((c) => c.found).map((c) => c.id).join(",")} | blocked ${o.aiCrawlers.blocked.join(",") || "-"}`); }
  catch (e) { console.log(`${url}: ERROR ${e.status ?? ""} ${e.message}`); }
}