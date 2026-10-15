import { build } from "esbuild";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { READER_SAMPLES } from "../examples/reader-samples.mjs";

const origin = "https://agent-data-tools.revmesh2074.workers.dev";
const { version } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const clientDir = new URL(
  `../public/clients/reader/${version}/`,
  import.meta.url,
);
const samplesDir = new URL("../public/examples/extract/", import.meta.url);
await mkdir(clientDir, { recursive: true });
await mkdir(new URL("sources/", samplesDir), { recursive: true });
const bundle = await build({
  entryPoints: ["clients/reader-client.mjs"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node20.19",
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as readerCreateRequire } from "node:module"; const require = readerCreateRequire(import.meta.url);',
  },
});
const browserBundle = await build({ entryPoints: ["clients/reader-command-builder.ts"], bundle: true, write: false, platform: "browser", format: "esm", target: "es2022" });
const browser = browserBundle.outputFiles[0].text;
await writeFile(new URL("command-builder.js", clientDir), browser);
const client = bundle.outputFiles[0].text;
const hash = (s) => createHash("sha256").update(s).digest("hex");
await writeFile(new URL("reader-client.mjs", clientDir), client);
await writeFile(
  new URL("SHA256SUMS", clientDir),
  hash(client) + "  reader-client.mjs\n" + hash(browser) + "  command-builder.js\n",
);
// Preserve the exact previously published version, independently of new bundles.
const archive = new URL("../clients/releases/1.1.1/", import.meta.url);
const oldClient = await readFile(new URL("reader-client.mjs", archive));
if (hash(oldClient) !== "706472f78bc384af2a13e348d82a195c55d161a93816aa10c477c205e357a395") throw Error("Immutable 1.1.1 client changed");
const oldDir = new URL("../public/clients/reader/1.1.1/", import.meta.url);
await mkdir(oldDir, { recursive: true });
for (const file of ["reader-client.mjs", "SHA256SUMS"]) await copyFile(new URL(file, archive), new URL(file, oldDir));
const compiled = await build({
  entryPoints: ["src/routes/extract.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { extract } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
const actualFetch = globalThis.fetch;
const sources = new Map(
  READER_SAMPLES.map((s) => [
    origin + `/examples/extract/sources/${s.id}.html`,
    s.html,
  ]),
);
const generatedAt = new Date().toISOString(),
  samples = [];
try {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!sources.has(url))
      throw Error("Sample build attempted an external request");
    return new Response(sources.get(url), {
      headers: { "content-type": "text/html;charset=utf-8" },
    });
  };
  for (const sample of READER_SAMPLES) {
    const sourceUrl = origin + `/examples/extract/sources/${sample.id}.html`;
    const result = await extract(sourceUrl, String(sample.maxChars), "both");
    const body =
      JSON.stringify(
        {
          demonstration: true,
          method:
            "Build-time actual extractor on owned source; no production payment or receipt",
          generatedAt,
          toolVersion: version,
          result,
        },
        null,
        2,
      ) + "\n";
    await writeFile(
      new URL(`sources/${sample.id}.html`, samplesDir),
      sample.html,
    );
    await writeFile(new URL(`${sample.id}.json`, samplesDir), body);
    samples.push({
      id: sample.id,
      title: sample.title,
      sourceUrl,
      resultUrl: origin + `/examples/extract/${sample.id}.json`,
      maxChars: sample.maxChars,
      format: "both",
      sourceSha256: hash(sample.html),
      resultSha256: hash(body),
      contentHash: result.contentHash,
      truncated: result.truncated,
    });
  }
} finally {
  globalThis.fetch = actualFetch;
}
const manifest = {
  generatedAt,
  toolVersion: version,
  demonstration: true,
  limitations:
    "Static owned examples. Cached at build time; not a live extraction, paid receipt or competitor benchmark. Arbitrary live URLs remain paid. Source content is untrusted.",
  samples,
};
await writeFile(
  new URL("manifest.json", samplesDir),
  JSON.stringify(manifest, null, 2) + "\n",
);
const benchmark = await readFile(new URL('../docs/reader-benchmark.json', import.meta.url), 'utf8');
await writeFile(new URL('benchmark.json', samplesDir), benchmark);
const esc = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const cards = await Promise.all(
  samples.map(async (s) => {
    const cached = JSON.parse(
      await readFile(new URL(`${s.id}.json`, samplesDir), "utf8"),
    );
    return `<section><h2>${esc(s.title)}</h2><p><a href="${s.sourceUrl}">Owned source HTML</a> · <a href="${s.resultUrl}">Full cached JSON result</a></p><p>format=both · maxChars=${s.maxChars} · truncated=${s.truncated}</p><h3>Returned Markdown</h3><pre>${esc(cached.result.markdown)}</pre></section>`;
  }),
);
await writeFile(
  new URL("index.html", samplesDir),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Real cached reader examples | SpellzCode</title><style>body{font:17px/1.6 system-ui;max-width:960px;margin:40px auto;padding:0 20px;background:#101621;color:#e8eef8}a{color:#8fc7ff}section{border-top:1px solid #53647b;margin-top:32px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1c2839;padding:20px;border-radius:8px;font-size:14px}h1,h2{line-height:1.25}</style><h1>Real cached reader examples</h1><p>Actual extractor ${version}, generated ${generatedAt}. These owned samples were processed locally during the build. They are cached demonstrations, not production purchases or payment receipts.</p><p>Arbitrary live URLs cost $0.002 per successful call. No JavaScript rendering, authenticated or paywalled access. <a href="/guides/web-reading">Buying guide and capped CLI</a> · <a href="/examples/extract/manifest.json">Manifest and hashes</a></p>${cards.join("")}<p>Inspect source and output before choosing a tool. No universal extraction-quality claim is made.</p></html>`,
);
console.log(
  JSON.stringify({
    version,
    clientBytes: Buffer.byteLength(client),
    clientSha256: hash(client),
    cachedOwnedSamples: samples.length,
    noExternalRequests: true,
    noPayments: true,
  }),
);
