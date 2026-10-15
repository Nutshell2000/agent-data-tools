// Private source snapshots and evidence only. No wallets, paid requests or production mutations.
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { Parser } from "htmlparser2";
const require = createRequire(import.meta.url),
  fixtures = require("../tests/fixtures/extract-pages.cjs");
const out = resolve(process.argv[2] ?? ".release-build/reader-benchmark");
await mkdir(out, { recursive: true });
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
  const filename = resolve(out, id + ".html");
  let html;
  try {
    html = await readFile(filename, "utf8");
  } catch {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error("Public source HTTP " + r.status);
    html = await r.text();
    await writeFile(filename, html);
    await writeFile(
      resolve(out, id + "-source.json"),
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
  sources.set(url, html);
  // Six requests maximum on a fresh run. Cached responses prevent repeated free-provider traffic.
  const cache = resolve(out, id + "-jina.json");
  let peer;
  try {
    peer = JSON.parse(await readFile(cache, "utf8"));
  } catch {
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
async function load(baseline) {
  const baseFiles = new Set([
    "src/routes/extract.ts",
    "src/lib/page-content.ts",
  ]);
  const compiled = await build({
    entryPoints: ["src/routes/extract.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: baseline
      ? [
          {
            name: "published-1.1.0-baseline",
            setup(b) {
              b.onLoad({ filter: /\.(ts)$/ }, (args) => {
                const rel = args.path
                  .replaceAll("\\", "/")
                  .split("/x402-income-reliability/")[1];
                if (!baseFiles.has(rel)) return;
                return {
                  contents: execFileSync("git", ["show", "6b3c660:" + rel], {
                    encoding: "utf8",
                  }),
                  loader: "ts",
                  resolveDir: dirname(args.path),
                };
              });
            },
          },
        ]
      : [],
  });
  return (
    await import(
      "data:text/javascript;base64," +
        Buffer.from(compiled.outputFiles[0].text).toString("base64")
    )
  ).extract;
}
const before = await load(true),
  after = await load(false),
  actualFetch = globalThis.fetch;
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
    ["before-1.1.0", before],
    ["after-1.1.1", after],
  ]) {
    for (const [url, html] of sources) {
      const id =
        corpus.find((id) => url === "https://benchmark.example/" + id) ??
        publicPages.find((p) => p[1] === url)[0];
      const started = performance.now();
      let r;
      try {
        r = { status: 200, result: await extract(url, "100000", "both") };
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
  caseCount: sources.size,
  authoredCases: 12,
  publicDocuments: 6,
  primaryLimit: 100000,
  method:
    "Actual local handler; fixed private input snapshots. Processing timings exclude source-network latency and are not production latency or cost. Jina is free direct mode; full output size and equal-budget size are distinct. Authored assertions do not establish universal or competitor superiority. No paid competitor output was purchased.",
  results,
  peers,
  authoredScores: Object.fromEntries(
    ["before-1.1.0", "after-1.1.1"].map((version) => [
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
    afterPublicFailures: results.filter(
      (r) =>
        r.version === "after-1.1.1" &&
        !corpus.includes(r.id) &&
        r.status !== 200,
    ).length,
    jinaStatuses: peers.map((p) => p.status ?? "error"),
    report: resolve(out, "report.json"),
  }),
);
if (
  report.authoredScores["after-1.1.1"] !== 12 ||
  results.some(
    (r) =>
      r.version === "after-1.1.1" && !corpus.includes(r.id) && r.status !== 200,
  )
)
  process.exitCode = 1;
