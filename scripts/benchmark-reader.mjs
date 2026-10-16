// Private source snapshots and evidence only. No wallets, paid requests or production mutations.
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { Parser } from "htmlparser2";
const require = createRequire(import.meta.url),
  fixtures = require("../tests/fixtures/extract-pages.cjs");
const args = process.argv.slice(2);
const cacheDir = resolve(args[0] && !args[0].startsWith("--") ? args.shift() : ".release-build/reader-benchmark");
let cachedOnly = false, out = cacheDir;
while(args.length) {
  const option=args.shift();
  if(option === "--cached-only") cachedOnly=true;
  else if(option === "--output" && args[0] && !args[0].startsWith("--")) out=resolve(args.shift());
  else throw Error("Usage: node scripts/benchmark-reader.mjs [cache-dir] [--cached-only] [--output report-dir]");
}
await mkdir(out, { recursive: true });
await mkdir(cacheDir, { recursive: true });
const {version:toolVersion}=JSON.parse(await readFile("package.json","utf8"));
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const sourceDirty=Boolean(execFileSync("git",["status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim());
const runtimeSourceDirty=Boolean(execFileSync("git",["diff","HEAD","--","src","tests/fixtures/extract-pages.cjs","package.json","package-lock.json"],{encoding:"utf8"}).trim());
const benchmarkScriptSha256=createHash("sha256").update(await readFile("scripts/benchmark-reader.mjs")).digest("hex");
const snapshots=[];
let sourceRequests=0, peerRequests=0;
const hash = (s) => createHash("sha256").update(s).digest("hex");
const corpus = [
  "short",
  "hidden",
  "code",
  "table",
  "entities",
  "malformed",
  "shell",
  "challenge",
  "spans",
  "tableAfterLinks",
  "codeWhitespace",
  "nestedLists",
];
const publicPages = [
  [
    "rust-functions",
    "https://doc.rust-lang.org/book/ch03-03-how-functions-work.html",
    "another_function",
  ],
  [
    "python-controlflow",
    "https://docs.python.org/3/tutorial/controlflow.html",
    "Please enter an integer",
  ],
  [
    "python-datastructures",
    "https://docs.python.org/3/tutorial/datastructures.html",
    "fruits",
  ],
  [
    "python-errors",
    "https://docs.python.org/3/tutorial/errors.html",
    "ZeroDivisionError",
  ],
  ["rfc9110", "https://www.rfc-editor.org/rfc/rfc9110.html", "HTTP Semantics"],
  ["rfc9111", "https://www.rfc-editor.org/rfc/rfc9111.html", "HTTP Caching"],
];
const sources = new Map(
    corpus.map((id) => ["https://benchmark.example/" + id, fixtures[id]]),
  ),
  peers = [];
for (const [id, url] of publicPages) {
  const filename = resolve(cacheDir, id + ".html");
  let html;
  try {
    html = await readFile(filename, "utf8");
  } catch (error) {
    if(cachedOnly) throw Error("Pinned source missing in cached-only mode: " + id, {cause:error});
    sourceRequests++;
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error("Public source HTTP " + r.status);
    html = await r.text();
    await writeFile(filename, html);
    await writeFile(
      resolve(cacheDir, id + "-source.json"),
      JSON.stringify(
        {
          url,
          fetchedAt: new Date().toISOString(),
          bytes: Buffer.byteLength(html),
          sha256: hash(html),
        },
        null,
        2,
      ),
    );
  }
  const sourceInfo=JSON.parse(await readFile(resolve(cacheDir,id+"-source.json"),"utf8"));
  if(sourceInfo.url!==url || sourceInfo.sha256!==hash(html) || sourceInfo.bytes!==Buffer.byteLength(html)) throw Error("Pinned source integrity mismatch: "+id);
  snapshots.push({id,...sourceInfo});
  sources.set(url, html);
  // Six requests maximum on a fresh run. Cached responses prevent repeated free-provider traffic.
  const cache = resolve(cacheDir, id + "-jina.json");
  let peer;
  try {
    peer = JSON.parse(await readFile(cache, "utf8"));
  } catch (error) {
    if(cachedOnly) throw Error("Cached comparison missing in cached-only mode: "+id,{cause:error});
    peerRequests++;
    const started = performance.now();
    try {
      const r = await fetch("https://r.jina.ai/" + url, {
        headers: { "X-Engine": "direct", Accept: "application/json", DNT: "1" },
        signal: AbortSignal.timeout(40000),
      });
      const raw = await r.text();
      let content = raw;
      try {
        const v = JSON.parse(raw);
        content = v.data?.content ?? v.content ?? raw;
      } catch {}
      peer = {
        url,
        provider: "Jina free direct mode",
        status: r.status,
        fetchedAt: new Date().toISOString(),
        networkElapsedMs: Math.round(performance.now() - started),
        content,
      };
    } catch (error) {
      peer = { url, provider: "Jina free direct mode", error: String(error) };
    }
    await writeFile(cache, JSON.stringify(peer, null, 2));
  }
  if(peer.url !== url) throw Error("Cached comparison URL mismatch: "+id);
  peers.push({
    ...peer,
    content: undefined,
    fullCharacters: peer.content?.length,
    comparableCharacters: peer.content?.slice(0, 100000).length,
    contentSha256: peer.content ? hash(peer.content) : undefined,
  });
  console.log(
    JSON.stringify({
      source: id,
      bytes: Buffer.byteLength(html),
      jinaStatus: peer.status ?? "error",
      sourceSnapshot: filename,
    }),
  );
  if (peer.status === 429)
    throw Error(
      "Free-provider rate limit reached; stop rather than retry or evade it",
    );
}
async function load(path) {
  const compiled=await build({entryPoints:[path],bundle:true,write:false,platform:"node",format:"esm"});
  return import("data:text/javascript;base64,"+Buffer.from(compiled.outputFiles[0].text).toString("base64"));
}
const {extract:currentExtract}=await load("src/routes/extract.ts");
const {assertToolOutput}=await load("src/lib/output-contract.ts");
const actualFetch=globalThis.fetch;
function authoredPass(id, r) {
  if (id === "shell" || id === "challenge")
    return (
      r.status === 422 &&
      r.code === (id === "shell" ? "EXTRACTION_EMPTY" : "EXTRACTION_BLOCKED")
    );
  if (r.status !== 200) return false;
  const v = r.result;
  const checks = {
    short: () =>
      v.text.includes("Version 2 fixes parsing") &&
      !v.text.includes("Unrelated"),
    hidden: () =>
      v.text.includes("Keep this information") &&
      !/HIDDEN_|COOKIE_NOTICE/.test(v.text),
    code: () =>
      v.codeBlocks[0]?.text.includes("\n    return") &&
      v.markdown.includes("```python"),
    table: () =>
      v.text.includes("Starter\t100") && v.tables[0]?.rows[2]?.[1] === "2,000",
    entities: () =>
      v.text.includes("© 2026 — €5 & &lt;tag&gt;") &&
      v.canonical === "https://benchmark.example/docs/prices",
    malformed: () =>
      v.text.includes("Last paragraph") &&
      v.markdown.includes("- First item\n- Second item"),
    spans: () =>
      v.tables[0]?.hasSpans && v.warnings.includes("table_spans_present"),
    tableAfterLinks: () =>
      v.text.includes("critical_limit\t314159") && !v.truncated,
    codeWhitespace: () =>
      v.text === "first  \n\n\n\n    second\nlast  " &&
      v.markdown.includes(v.text),
    nestedLists: () =>
      /\n   - Nested detail[\s\S]*\n     8\. Deeper[\s\S]*\n7\. Next step/.test(
        v.markdown,
      ),
  };
  return Boolean(checks[id]?.());
}
function sourceCode(html) {
  let current = null;
  const blocks = [];
  new Parser(
    {
      onopentag(n) {
        if (n === "pre") current = "";
      },
      ontext(s) {
        if (current !== null) current += s;
      },
      onclosetag(n) {
        if (n === "pre" && current !== null) {
          blocks.push(current.replace(/\r\n?/g, "\n"));
          current = null;
        }
      },
    },
    { decodeEntities: true },
  ).end(html);
  return blocks;
}
const results = [];
try {
  globalThis.fetch = async (input) => {
    const html = sources.get(String(input));
    if (html === undefined) throw Error("Uncached request blocked");
    return new Response(html, {
      headers: { "content-type": "text/html;charset=utf-8" },
    });
  };
  for (const [label, extract] of [
    ["current-"+toolVersion, currentExtract],
  ]) {
    for (const [url, html] of sources) {
      const id =
        corpus.find((id) => url === "https://benchmark.example/" + id) ??
        publicPages.find((p) => p[1] === url)[0];
      const started = performance.now();
      let r;
      try {
        const result=await extract(url,"100000","both");
        assertToolOutput("/extract",result);
        r = { status: 200, result, outputContractValid:true };
      } catch (e) {
        r = { status: e.status ?? 500, code: e.code, error: e.message };
      }
      const v = r.result,
        expected = sourceCode(html),
        publicPage = publicPages.find((p) => p[0] === id);
      const item = {
        version: label,
        id,
        url,
        status: r.status,
        code: r.code,
        outputContractValid: r.outputContractValid,
        sourceBytes: Buffer.byteLength(html),
        sourceSha256: hash(html),
        localProcessingMs:
          Math.round((performance.now() - started) * 100) / 100,
        ...(v
          ? {
              textLength: v.textLength,
              returnedTextCharacters: v.text.length,
              returnedMarkdownCharacters: v.markdown.length,
              codeBlocks: v.codeBlocks.length,
              sourceCodeBlocks: expected.length,
              completeCodeBlocks: v.codeBlocks.filter((c) => !c.truncated)
                .length,
              exactSourceCodeBlocks: v.codeBlocks.filter(
                (c) => !c.truncated && expected.includes(c.text),
              ).length,
              tables: v.tables.length,
              warnings: v.warnings,
              truncated: v.truncated,
              contentSelection: v.contentSelection,
              anchorRetained: publicPage
                ? v.text.includes(publicPage[2])
                : undefined,
            }
          : {}),
        authoredPass: corpus.includes(id) ? authoredPass(id, r) : undefined,
      };
      await writeFile(
        resolve(out, id + "-" + label + ".json"),
        JSON.stringify(r, null, 2),
      );
      results.push(item);
    }
  }
} finally {
  globalThis.fetch = actualFetch;
}
const report = {
  checkedAt: new Date().toISOString(),
  toolVersion,
  sourceCommit, sourceDirty, runtimeSourceDirty, benchmarkScriptSha256, cachedOnly, sourceRequests, peerRequests, snapshots,
  caseCount: sources.size,
  authoredCases: 12,
  publicDocuments: 6,
  primaryLimit: 100000,
  method:
    "Actual local handler; fixed private input snapshots. Processing timings exclude source-network latency and are not production latency or cost. Comparison data is cached Jina free direct mode from the recorded fetch times, not a current provider check; full output size and equal-budget size are distinct. Complete-code matching checks membership in source pre blocks, not exhaustive content coverage. Current successful outputs also satisfy the exact published schema. Authored assertions do not establish universal or competitor superiority. No paid competitor output was purchased.",
  results,
  peers,
  authoredScores: Object.fromEntries(
    ["current-"+toolVersion].map((version) => [
      version,
      results.filter((r) => r.version === version && r.authoredPass === true)
        .length,
    ]),
  ),
};
await writeFile(resolve(out, "report.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    cases: report.caseCount,
    authoredScores: report.authoredScores,
    currentPublicFailures: results.filter(
      (r) =>
        r.version === "current-"+toolVersion &&
        !corpus.includes(r.id) &&
        r.status !== 200,
    ).length,
    jinaStatuses: peers.map((p) => p.status ?? "error"),
    report: resolve(out, "report.json"),
  }),
);
if (
  report.authoredScores["current-"+toolVersion] !== 12 ||
  results.some(
    (r) =>
      r.version === "current-"+toolVersion && !corpus.includes(r.id) && r.status !== 200,
  )
)
  process.exitCode = 1;
