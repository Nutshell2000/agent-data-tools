import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
const { version } = JSON.parse(await readFile(new URL("package.json", import.meta.url), "utf8"));

export async function buildChain(outDir = new URL(`../../.release-build/chain-client/${version}/`, import.meta.url)) {
  const output = outDir instanceof URL ? outDir : pathToFileURL(outDir.replace(/[\\/]?$/, "/"));
  const bundle = await build({
    absWorkingDir: fileURLToPath(new URL("../../", import.meta.url)),
    entryPoints: [fileURLToPath(new URL("chain-client.mjs", import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm", target: "node20.19",
    banner: { js: '#!/usr/bin/env node\nimport { createRequire as chainRequire } from "node:module"; const require = chainRequire(import.meta.url);' },
  });
  const bytes = bundle.outputFiles[0].contents;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(output, { recursive: true });
  await writeFile(new URL("chain-client.mjs", output), bytes);
  await writeFile(new URL("chain-client.mjs.sha256", output), `${sha256}  chain-client.mjs\n`);
  return { version, directory: fileURLToPath(output), sha256, bytes: bytes.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await buildChain()));
