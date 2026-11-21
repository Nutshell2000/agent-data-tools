// Runs every paid tool on exactly the example input it publishes to the Bazaar and directories
// (exampleParams(), the `input` of its discovery extension), through the real Worker with the paywall off
// and live upstreams. Buyer bots call that example; we settle only on success, so an example that fails
// is a first payment lost. Tools that need Workers AI or Browser Rendering are skipped here; check them on staging.
//   node scripts/smoke-examples.mjs [path-filter] [--json out.json] [--retry] [--state progress.jsonl]
// --state <file> (21 Nov 2026) writes each tool's start and answer to a progress file, and a run started with a file
// that already holds answers continues with the tools not yet checked. It exists for
// scripts/smoke-examples-supervised.mjs, which restarts this script when the local runtime ends mid-run; the release
// uses that wrapper. The file belongs to one tree and one run: never reuse one after the source changed.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { markResult, markStart, readSmokeState } from "./smoke-state.mjs";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const valueAt = new Set(["--json", "--cases", "--case-field", "--state"].map((f) => args.indexOf(f)).filter((i) => i >= 0).map((i) => i + 1));
const filter = args.find((a, i) => !a.startsWith("--") && !valueAt.has(i));
const allParams = args.includes("--all-params");
const stateAt = args.indexOf("--state");
const stateFile = stateAt >= 0 ? args[stateAt + 1] : undefined;
if (stateAt >= 0 && !stateFile) { console.error("--state needs a file name"); process.exit(2); }
const earlier = readSmokeState(stateFile);
const casesAt = args.indexOf("--cases");
const fieldAt = args.indexOf("--case-field");
const caseField = fieldAt >= 0 ? args[fieldAt + 1] : "example";
const cases = casesAt >= 0 ? new Map(JSON.parse((await import("node:fs")).readFileSync(args[casesAt + 1], "utf8").replace(/^﻿/, "")).map((c) => [c.path, c])) : undefined;

const urlShim = { name: "url", setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true })); } };
const catalog = await build({
  stdin: { contents: 'export { ENDPOINTS, exampleParams } from "./src/endpoints"; export { CAPACITY_LIMITED } from "./src/lib/capacity"; export { ENTRY_OF } from "./src/routes/entry-paths";', resolveDir: process.cwd(), sourcefile: "smoke-examples-entry.ts" },
  bundle: true, platform: "node", format: "cjs", write: false, plugins: [urlShim],
});
const mod = { exports: {} };
new Function("module", "exports", "require", catalog.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { ENDPOINTS, exampleParams, CAPACITY_LIMITED, ENTRY_OF } = mod.exports;
// An entry path (src/routes/entry-paths.ts) runs its canonical tool: an AI door such as /llm/chat is skipped like /ai/chat.
// /document/extract reads the file here and then asks the chat model for the fields: it needs Workers AI like the /ai/ tools.
const NEEDS_AI = new Set(["/document/extract", "/invoice/check"]);
const isAi = (p) => (ENTRY_OF[p] ?? p).startsWith("/ai/") || NEEDS_AI.has(ENTRY_OF[p] ?? p);

const worker = await build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "browser", write: false, external: ["cloudflare:workers", "node:*"], plugins: [urlShim] });
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, script: worker.outputFiles[0].text, compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"],
  durableObjects: { METRICS: { className: "Metrics", useSQLite: true } }, kvNamespaces: ["TRIALS"],
  bindings: { PAY_TO: "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5", NETWORK: "eip155:8453", PAYWALL: "off", TRIALS_ENABLED: "off", MPP_EVM: "off", FACILITATOR_URL: "https://facilitator.invalid", BASE_RPC_URL: "https://mainnet.base.org" },
  // The Worker's outbound requests go through Node's fetch, so an HTTPS proxy (NODE_USE_ENV_PROXY=1) applies to them too.
  outboundService: async (request) => {
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(await request.arrayBuffer());
    // Node's fetch rejects hop-by-hop and length headers that workerd sets itself (UND_ERR_INVALID_ARG on every POST).
    const headers = {};
    for (const [k, v] of request.headers) if (!/^(content-length|host|connection|transfer-encoding|expect|cf-.*)$/i.test(k)) headers[k] = v;
    try {
      const res = await fetch(request.url, { method: request.method, headers, body, redirect: "manual" });
      // Node's fetch has already decompressed the body; passing content-encoding on would make workerd decompress it
      // again ("Gzip decompression failed", seen with query.wikidata.org on 24 Oct 2026).
      const out = new Headers(res.headers);
      out.delete("content-encoding"); out.delete("content-length");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
    }
    catch (err) {
      const why = String(err?.cause?.code ?? err?.cause?.message ?? err?.message ?? err);
      if (process.env.SMOKE_DEBUG) console.error(`outbound ${request.method} ${request.url}: ${why}`);
      return new Response(why, { status: 599 });
    }
  },
}));

// Reads KV shards that only production and staging hold, so this local run cannot answer it; prove it on staging.
// /defi/yields reads a 10 MB file that Cloudflare serves from its cache in milliseconds but a home connection in ~48 s (6 Nov 2026);
// the staging proof of its release covers it.
const NEEDS_REMOTE_DATA = new Set(["/ip/geolocate", "/ip/geolocation", "/defi/yields", "/defi/usdc-yield", "/econ/national-debt", "/econ/treasury-rates", "/se/company", "/law/search", "/phishing/check"]);
const tools = ENDPOINTS.filter((e) => !CAPACITY_LIMITED.has(e.path) && !NEEDS_REMOTE_DATA.has(e.path) && !isAi(e.path) && (!filter || e.path.includes(filter)));
let results = [];
const isOk = (r) => r.status >= 200 && r.status < 400;
// 21 Nov 2026: a filter that matches nothing (or an empty catalogue) printed "0/0 examples succeed; 0 fail;" and exited
// 0, which is the text and the code a release reads as a pass. Nothing checked is not a pass.
if (!tools.length) { console.error(`no tool to check${filter ? ` (nothing matches "${filter}")` : ""}`); await mf.dispose(); process.exit(2); }
async function runExample(e, retried = false) {
  // --all-params fills EVERY input with its listed example, as routers that plan from the listing schema do (Mercator's
  // suggestedPlanNode, agents filling a form from `examples`): an optional example that conflicts with the required ones
  // is a paid call refused (14 Nov 2026: /extract's section example "retry-policy" on other pages, 9 refusals in 7 days).
  // --cases <file.json> [--case-field example|all] replays inputs a router stored for each path ([{ path, example, all }],
  // e.g. Mercator's copy of our listings): what its router really sends, which can lag our current schema.
  const stored = cases?.get(e.path);
  const params = stored ? Object.entries(stored[caseField] ?? {}).map(([k, v]) => [k, { example: v }])
    : allParams ? Object.entries(e.params).filter(([k, p]) => k !== "only" && p.example !== undefined) : exampleParams(e);
  const query = new URLSearchParams(params.map(([k, p]) => [k, String(p.example)]));
  const url = `https://agent-data-tools.revmesh2074.workers.dev${e.path}${query.size ? `?${query}` : ""}`;
  const t0 = Date.now();
  let status = 0, error = "";
  markStart(stateFile, e.path);
  try {
    const res = await mf.dispatchFetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    status = res.status;
    const text = await res.text();
    if (status >= 400) error = text.slice(0, 160).replace(/\s+/g, " ");
    else if (process.env.SMOKE_SHOW) console.log(`     ${text.slice(0, Number(process.env.SMOKE_SHOW) || 400)}`);
  } catch (err) {
    error = String(err?.message ?? err).slice(0, 160);
  }
  const ms = Date.now() - t0;
  console.log(`${status >= 200 && status < 400 ? "ok  " : "FAIL"} ${String(status).padStart(3)} ${String(ms).padStart(6)}ms ${e.path}${error ? `  ${error}` : ""}`);
  const result = { path: e.path, price: e.price, status, ms, error, url };
  markResult(stateFile, result, retried);
  return result;
}
// A restarted run (--state) takes the answers an earlier attempt already wrote, passes and failures alike, and calls
// only the tools that have none. The tool that was in flight when the earlier attempt ended has none, so it runs again.
const carried = tools.filter((e) => earlier.results.has(e.path));
if (carried.length) console.log(`continuing an earlier attempt: ${carried.length} of ${tools.length} tools already checked (${carried.filter((e) => !isOk(earlier.results.get(e.path).r)).length} of them failed); ${earlier.inFlight ? `it ended while checking ${earlier.inFlight}` : "no tool was in flight when it ended"}`);
for (const e of tools) results.push(earlier.results.has(e.path) ? earlier.results.get(e.path).r : await runExample(e));
// --retry runs each failure once more after 5 s, so one upstream hiccup does not stop a release (scripts/release.ps1);
// a failure that repeats is our bug or a dead source, and that tool's next first payment would fail too.
if (args.includes("--retry") && results.some((r) => !isOk(r))) {
  await new Promise((r) => setTimeout(r, 5_000));
  console.log("\nretrying the failures once:");
  // A failure that an earlier attempt already ran a second time has had its one retry: a restart gives it no third try.
  const hadRetry = (path) => earlier.results.get(path)?.retried === true && earlier.results.get(path).r === results.find((r) => r.path === path);
  for (let i = 0; i < results.length; i++) {
    if (isOk(results[i])) continue;
    if (hadRetry(results[i].path)) { console.log(`FAIL ${String(results[i].status).padStart(3)}  (retried in an earlier attempt) ${results[i].path}`); continue; }
    results[i] = await runExample(tools.find((e) => e.path === results[i].path), true);
  }
}
await mf.dispose();

const failed = results.filter((r) => !isOk(r));
const slow = results.filter((r) => r.ms > 10_000 && !failed.includes(r));
console.log(`\n${results.length - failed.length}/${results.length} examples succeed; ${failed.length} fail; ${slow.length} slower than 10 s; ${ENDPOINTS.filter((e) => CAPACITY_LIMITED.has(e.path) || isAi(e.path)).length} AI/rendering tools skipped (staging).`);
if (jsonOut) await writeFile(jsonOut, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
process.exit(failed.length ? 1 : 0);
