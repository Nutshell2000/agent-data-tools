// Parses the EU, UN and UK sanctions XML files into the compact index /sanctions/check loads
// (src/lib/intl-sanctions.ts), so the Worker never parses 50 MB of XML. Run by .github/workflows/ofac-mirror.yml.
//   node scripts/build-intl-sanctions-index.mjs eu.xml un.xml uk.xml intl-sanctions-index.json
// A missing or failed list is left out (the answer then names it as unavailable); a list under its
// MIN_ENTRIES is refused as truncated.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFile, writeFile, rm } from "node:fs/promises";

const [euPath, unPath, ukPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error("usage: build-intl-sanctions-index.mjs eu.xml un.xml uk.xml out.json");
const out = new URL("../.intl-sanctions-build.cjs", import.meta.url);
const bundled = await build({ entryPoints: ["src/lib/intl-sanctions.ts"], bundle: true, platform: "node", format: "cjs", write: false });
await writeFile(out, bundled.outputFiles[0].text);
const { compactIntl, MIN_ENTRIES } = createRequire(import.meta.url)(out.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await rm(out);

const read = async (p) => { try { return p && p !== "-" ? await readFile(p, "utf8") : undefined; } catch { return undefined; } };
const index = compactIntl({ eu: await read(euPath), un: await read(unPath), uk: await read(ukPath) });
for (const [key, info] of Object.entries(index.lists)) {
  if (info.entries < MIN_ENTRIES[key]) throw new Error(`${key} list looks incomplete: ${info.entries} entries`);
}
if (!Object.keys(index.lists).length) throw new Error("no list could be read");
await writeFile(outPath, JSON.stringify(index));
console.log(Object.entries(index.lists).map(([k, v]) => `${k} ${v.entries} (${v.date})`).join(", "), `- ${index.aliases.length} aliases`);
