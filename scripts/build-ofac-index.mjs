// Parses OFAC's SDN.CSV and ALT.CSV into the compact index /sanctions/check loads, so the Worker
// never spends its own CPU on the CSVs. Run by .github/workflows/ofac-mirror.yml.
//   node scripts/build-ofac-index.mjs SDN.CSV ALT.CSV ofac-index.json
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFile, writeFile, rm } from "node:fs/promises";

const [sdnPath, altPath, outPath] = process.argv.slice(2);
if (!sdnPath || !altPath || !outPath) throw new Error("usage: build-ofac-index.mjs SDN.CSV ALT.CSV out.json");
const out = new URL("../.ofac-index-build.cjs", import.meta.url);
const bundled = await build({ entryPoints: ["src/routes/sanctions.ts"], bundle: true, platform: "node", format: "cjs", write: false });
await writeFile(out, bundled.outputFiles[0].text);
const { compactFromCsv } = createRequire(import.meta.url)(out.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await rm(out);

const index = compactFromCsv(await readFile(sdnPath, "utf8"), await readFile(altPath, "utf8"), new Date().toISOString());
if (index.parties.length < 1000 || index.addresses.length < 10) throw new Error(`index looks incomplete: ${index.parties.length} parties, ${index.addresses.length} addresses`);
await writeFile(outPath, JSON.stringify(index));
console.log(`${index.parties.length} parties, ${index.aliases.length} aliases, ${index.addresses.length} digital currency addresses`);
