// Regenerates tests/fixtures/price-freeze.json from the catalog after a price decision by the owner.
//   node scripts/freeze-prices.mjs "<one sentence naming the decision and its date>"
// The note is appended to the fixture's history so the freeze test documents why prices moved.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
const decision = process.argv[2];
if (!decision) { console.error("pass the decision sentence as the first argument"); process.exit(2); }
const entry = fileURLToPath(new URL("../src/endpoints.ts", import.meta.url));
const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false });
const Module = require("node:module");
const mod = new Module(entry, null);
mod.filename = entry;
mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(built.outputFiles[0].text, entry);
const { ENDPOINTS } = mod.exports;

const file = fileURLToPath(new URL("../tests/fixtures/price-freeze.json", import.meta.url));
const old = JSON.parse(readFileSync(file, "utf8"));
const prices = Object.fromEntries(ENDPOINTS.map((e) => [e.path, e.price]));
const changed = Object.entries(old.prices).filter(([p, v]) => prices[p] && prices[p] !== v);
const next = { frozenUntil: old.frozenUntil, note: `${old.note} ${decision}`.trim(), prices };
writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
console.log(`${Object.keys(prices).length} prices frozen until ${old.frozenUntil}; ${changed.length} changed: ${changed.map(([p, v]) => `${p} ${v}->${prices[p]}`).join(", ")}`);
