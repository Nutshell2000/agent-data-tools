import { build } from "esbuild";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { READER_SAMPLES, READER_DIAGRAM } from "../examples/reader-samples.mjs";

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
const mcpBundle = await build({
  entryPoints: ["clients/reader-mcp.mjs"], bundle: true, write: false,
  platform: "node", format: "esm", target: "node20.19",
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as mcpCreateRequire } from "node:module"; const require = mcpCreateRequire(import.meta.url);' }
});
const mcpClient = mcpBundle.outputFiles[0].text;
const hash = (s) => createHash("sha256").update(s).digest("hex");
await writeFile(new URL("reader-client.mjs", clientDir), client);
await writeFile(new URL("reader-mcp.mjs", clientDir), mcpClient);
// Buyers need verify only the executable they downloaded, without unrelated files.
await writeFile(new URL("reader-client.mjs.sha256", clientDir), hash(client) + "  reader-client.mjs\n");
await writeFile(new URL("reader-mcp.mjs.sha256", clientDir), hash(mcpClient) + "  reader-mcp.mjs\n");
await writeFile(
  new URL("SHA256SUMS", clientDir),
  hash(client) + "  reader-client.mjs\n" + hash(browser) + "  command-builder.js\n" + hash(mcpClient) + "  reader-mcp.mjs\n",
);
// Preserve the exact previously published version, independently of new bundles.
const archive = new URL("../clients/releases/1.1.1/", import.meta.url);
const oldClient = await readFile(new URL("reader-client.mjs", archive));
if (hash(oldClient) !== "706472f78bc384af2a13e348d82a195c55d161a93816aa10c477c205e357a395") throw Error("Immutable 1.1.1 client changed");
const oldDir = new URL("../public/clients/reader/1.1.1/", import.meta.url);
await mkdir(oldDir, { recursive: true });
for (const file of ["reader-client.mjs", "SHA256SUMS"]) await copyFile(new URL(file, archive), new URL(file, oldDir));
// Retain the second published version as well, including its browser command builder.
const archive112 = new URL("../clients/releases/1.1.2/", import.meta.url);
const old112 = new URL("../public/clients/reader/1.1.2/", import.meta.url);
await mkdir(old112, { recursive: true });
const pinned112 = { "reader-client.mjs": "706472f78bc384af2a13e348d82a195c55d161a93816aa10c477c205e357a395", "command-builder.js": "5b66356133ae5c307680eae0bcf690e96e14db073ea6005a311723a3e1735cd0" };
for (const line of (await readFile(new URL("SHA256SUMS", archive112), "utf8")).trim().split("\n")) {
  const [expected, file] = line.trim().split(/\s+/);
  if (!["reader-client.mjs", "command-builder.js"].includes(file)) throw Error("Unexpected archived file");
  const bytes = await readFile(new URL(file, archive112));
  if (pinned112[file] !== expected || hash(bytes) !== expected) throw Error("Immutable 1.1.2 artifact changed");
  await copyFile(new URL(file, archive112), new URL(file, old112));
}
await copyFile(new URL("SHA256SUMS", archive112), new URL("SHA256SUMS", old112));
// Match the deployed 1.2.0 downloads exactly; new builds never replace old URLs.
const archive120 = new URL("../clients/releases/1.2.0/", import.meta.url);
const old120 = new URL("../public/clients/reader/1.2.0/", import.meta.url);
await mkdir(old120, { recursive: true });
const pinned120 = { "reader-client.mjs": "1ef97c9314184c2d96046b55b22eabdd87168ee58a11f5c7f4be3ddaa9ce7d4f", "command-builder.js": "5b66356133ae5c307680eae0bcf690e96e14db073ea6005a311723a3e1735cd0" };
for (const [file, expected] of Object.entries(pinned120)) {
  const bytes = await readFile(new URL(file, archive120));
  if (hash(bytes) !== expected) throw Error("Immutable 1.2.0 artifact changed");
  await copyFile(new URL(file, archive120), new URL(file, old120));
}
if (hash(await readFile(new URL("SHA256SUMS", archive120))) !== "808a059bb962e37f3fd17dd80dbda5cd6494ea75285800640ea80fc71b0445a9") throw Error("Immutable 1.2.0 checksum changed");
await copyFile(new URL("SHA256SUMS", archive120), new URL("SHA256SUMS", old120));
const archive121 = new URL("../clients/releases/1.2.1/", import.meta.url);
const old121 = new URL("../public/clients/reader/1.2.1/", import.meta.url);
await mkdir(old121, { recursive: true });
const pinned121 = { "reader-client.mjs": "1ef97c9314184c2d96046b55b22eabdd87168ee58a11f5c7f4be3ddaa9ce7d4f", "command-builder.js": "5b66356133ae5c307680eae0bcf690e96e14db073ea6005a311723a3e1735cd0", "reader-mcp.mjs": "fd2f7cbbd69d489d3709a2a3cfe6072f79da3f3682bcb067baa9a613e0fa3557", "SHA256SUMS": "e4942306f221e149e0556bc714a812ece4bcf95c15eb67061799de4db37d6342" };
for(const [file,expected] of Object.entries(pinned121)) {
  const bytes=await readFile(new URL(file,archive121));
  if(hash(bytes)!==expected) throw Error("Immutable 1.2.1 artifact changed");
  await copyFile(new URL(file,archive121),new URL(file,old121));
}
const pinned130 = {"command-builder.js": "5909385fb9455fb2ed16b9ee4580a534e7541ec668a3e650c8131ae08f53a446", "reader-client.mjs": "4ab8363a3380c3debb56ae552fc4f328281b209992b25d38d02df6b59e9da400", "reader-client.mjs.sha256": "1322406c3b4378363da245fdce48b4f5a10134dede69d0087d235446592392e9", "reader-mcp.mjs": "07eea006e23b894a23c0bd78f3244c8fff3cfbb7c5411b938464e14d55f5f90d", "reader-mcp.mjs.sha256": "ca3d5787667c2ee4bac205453a4c3999447693f8a260d32c7ee02189ef39386d", "SHA256SUMS": "545576432640401ff533f88bf3b7f8c8a5c4277b5a638a24afc40b252facd85d"};
for(const [file,expected] of Object.entries(pinned130)) {
  const from=new URL("../clients/releases/1.3.0/"+file,import.meta.url),to=new URL("../public/clients/reader/1.3.0/"+file,import.meta.url);
  const bytes=await readFile(from);if(hash(bytes)!==expected)throw Error("Immutable 1.3.0 artifact changed");
  await mkdir(new URL("../public/clients/reader/1.3.0/",import.meta.url),{recursive:true});await copyFile(from,to);
}
const pinned131 = {"command-builder.js": "5909385fb9455fb2ed16b9ee4580a534e7541ec668a3e650c8131ae08f53a446", "reader-client.mjs": "4ab8363a3380c3debb56ae552fc4f328281b209992b25d38d02df6b59e9da400", "reader-client.mjs.sha256": "1322406c3b4378363da245fdce48b4f5a10134dede69d0087d235446592392e9", "reader-mcp.mjs": "61c39b0f078c3b231ac099c278fd2cc70415cf8d217539835f2209bfa43845c8", "reader-mcp.mjs.sha256": "a139571d01485b7e78150ede925c1b986c99a12477783d606278b9611e4e579d", "SHA256SUMS": "9eae859d77e3e1ebe24998cd03d8cda3474b3a6482a53d6f41cd06056fc16920"};
for(const [file,expected] of Object.entries(pinned131)) {
  const from=new URL("../clients/releases/1.3.1/"+file,import.meta.url),to=new URL("../public/clients/reader/1.3.1/"+file,import.meta.url);
  const bytes=await readFile(from);if(hash(bytes)!==expected)throw Error("Immutable 1.3.1 artifact changed");
  await mkdir(new URL("../public/clients/reader/1.3.1/",import.meta.url),{recursive:true});await copyFile(from,to);
}
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
await writeFile(new URL("sources/job-flow.svg",samplesDir),READER_DIAGRAM);
const actualFetch = globalThis.fetch;
const sources = new Map(
  READER_SAMPLES.map((s) => [
    origin + `/examples/extract/sources/${s.id}.html`,
    s.html,
  ]),
);
const generatedAt = new Date().toISOString(),
  samples = [];
let sectionDemo;
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
  const sectionSource = origin + "/examples/extract/sources/long-document.html";
  const result = await extract(sectionSource,"500","both","example-section-30");
  sectionDemo = JSON.stringify({demonstration:true,generatedAt,toolVersion:version,method:"Actual local extraction of an explicit section in owned HTML; no payment or customer receipt",sectionParameter:"example-section-30",result},null,2)+"\n";
  await writeFile(new URL("section-result.json",samplesDir),sectionDemo);
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
  auxiliarySources: [{url:origin+"/examples/extract/sources/job-flow.svg",sourceSha256:hash(READER_DIAGRAM)}],
  sectionExample: { resultUrl: origin + "/examples/extract/section-result.json", section: "example-section-30", maxChars: 500, resultSha256: hash(sectionDemo) },
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
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Real cached reader examples | SpellzCode</title><style>body{font:17px/1.6 system-ui;max-width:960px;margin:40px auto;padding:0 20px;background:#101621;color:#e8eef8}a{color:#8fc7ff}section{border-top:1px solid #53647b;margin-top:32px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1c2839;padding:20px;border-radius:8px;font-size:14px}h1,h2{line-height:1.25}</style><h1>Real cached reader examples</h1><p>Actual extractor ${version}, generated ${generatedAt}. These owned samples were processed locally during the build. They are cached demonstrations, not production purchases or payment receipts.</p><p>Arbitrary live URLs cost $0.002 per successful call. No JavaScript rendering, authenticated or paywalled access. <a href="/guides/web-reading">Buying guide and capped CLI</a> · <a href="/examples/extract/manifest.json">Manifest and hashes</a></p>${cards.join("")}<section><h2>Read a late section within a small output limit</h2><p><a href="/examples/extract/section-result.json">Actual cached section example</a>: section=example-section-30, maxChars=500, same owned long-document source. Full-page output at this limit truncates before it; explicit selection returns that section only, not complete document coverage. Live selected reads remain $0.002.</p></section><p>Inspect source and output before choosing a tool. No universal extraction-quality claim is made.</p></html>`,
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

// A real cached sitemap result from owned source; no arbitrary live extraction.
const { SITEMAP_SOURCE, SITEMAP_INDEX } = await import("../examples/sitemap-sample.mjs");
const sitemapBundle = await build({entryPoints:["src/routes/sitemap.ts"],bundle:true,write:false,platform:"node",format:"esm"});
const { sitemap } = await import("data:text/javascript;base64," + Buffer.from(sitemapBundle.outputFiles[0].text).toString("base64"));
const sitemapDir = new URL("../public/examples/sitemap/", import.meta.url);
await mkdir(sitemapDir, { recursive: true });
const previousFetch = globalThis.fetch;
let sitemapResult;
try {
  globalThis.fetch = async input => {
    if (String(input) !== origin + "/examples/sitemap/source.xml") throw Error("Unexpected sitemap example request");
    return new Response(SITEMAP_SOURCE,{headers:{"content-type":"application/xml"}});
  };
  sitemapResult = await sitemap(origin + "/examples/sitemap/source.xml", "", "2", "0");
} finally { globalThis.fetch = previousFetch; }
const sitemapOutput = JSON.stringify({demonstration:true,generatedAt,toolVersion:version,method:"Actual local sitemap tool on owned XML; no payment or customer receipt",result:sitemapResult},null,2)+"\n";
await writeFile(new URL("source.xml", sitemapDir), SITEMAP_SOURCE);
await writeFile(new URL("index.xml", sitemapDir), SITEMAP_INDEX);
await writeFile(new URL("result.json", sitemapDir), sitemapOutput);
await writeFile(new URL("manifest.json", sitemapDir), JSON.stringify({demonstration:true,generatedAt,toolVersion:version,sourceSha256:hash(SITEMAP_SOURCE),resultSha256:hash(sitemapOutput),limits:"512 KiB compressed/expanded XML, 1000 entries; no crawling or automatic child requests"},null,2)+"\n");
await writeFile(new URL("index.html", sitemapDir), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Actual cached sitemap example | SpellzCode</title><style>body{font:17px/1.6 system-ui;max-width:900px;margin:40px auto;padding:0 20px}pre{overflow:auto;background:#8881;padding:20px}a{color:LinkText}</style><h1>Actual cached sitemap result</h1><p>Tool ${version}, generated ${generatedAt}. Owned XML processed locally during build; not a customer purchase or receipt. Live arbitrary sitemap requests cost $0.002 per successful call. A valid empty match is charged.</p><p><a href="/examples/sitemap/source.xml">Owned XML source</a> · <a href="/examples/sitemap/index.xml">Example sitemap index</a> · <a href="/examples/sitemap/result.json">Full result</a> · <a href="/examples/sitemap/manifest.json">Hashes</a></p><pre>${esc(JSON.stringify(sitemapResult,null,2))}</pre><p><a href="/guides/sitemap">Quote and capped purchase instructions</a></p></html>`);
