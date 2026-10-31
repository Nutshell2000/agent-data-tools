// Runs every paid tool on exactly the example input it publishes to the Bazaar and directories
// (exampleParams(), the `input` of its discovery extension), through the real Worker with the paywall off
// and live upstreams. Buyer bots call that example; we settle only on success, so an example that fails
// is a first payment lost. Tools that need Workers AI or Browser Rendering are skipped here; check them on staging.
//   node scripts/smoke-examples.mjs [path-filter] [--json out.json]
import { build } from "esbuild";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const filter = args.find((a, i) => !a.startsWith("--") && (jsonAt < 0 || i !== jsonAt + 1));

const urlShim = { name: "url", setup(b) { b.onResolve({ filter: /^url$/ }, () => ({ path: "node:url", external: true })); } };
const catalog = await build({
  stdin: { contents: 'export { ENDPOINTS, exampleParams } from "./src/endpoints"; export { CAPACITY_LIMITED } from "./src/lib/capacity";', resolveDir: process.cwd(), sourcefile: "smoke-examples-entry.ts" },
  bundle: true, platform: "node", format: "cjs", write: false, plugins: [urlShim],
});
const mod = { exports: {} };
new Function("module", "exports", "require", catalog.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
const { ENDPOINTS, exampleParams, CAPACITY_LIMITED } = mod.exports;

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
const NEEDS_REMOTE_DATA = new Set(["/ip/geolocate"]);
const tools = ENDPOINTS.filter((e) => !CAPACITY_LIMITED.has(e.path) && !NEEDS_REMOTE_DATA.has(e.path) && !e.path.startsWith("/ai/") && (!filter || e.path.includes(filter)));
let results = [];
async function runExample(e) {
  const query = new URLSearchParams(exampleParams(e).map(([k, p]) => [k, String(p.example)]));
  const url = `https://agent-data-tools.revmesh2074.workers.dev${e.path}${query.size ? `?${query}` : ""}`;
  const t0 = Date.now();
  let status = 0, error = "";
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
  return { path: e.path, price: e.price, status, ms, error, url };
}
const isOk = (r) => r.status >= 200 && r.status < 400;
for (const e of tools) results.push(await runExample(e));
// --retry runs each failure once more after 5 s, so one upstream hiccup does not stop a release (scripts/release.ps1);
// a failure that repeats is our bug or a dead source, and that tool's next first payment would fail too.
if (args.includes("--retry") && results.some((r) => !isOk(r))) {
  await new Promise((r) => setTimeout(r, 5_000));
  console.log("\nretrying the failures once:");
  for (let i = 0; i < results.length; i++) if (!isOk(results[i])) results[i] = await runExample(tools.find((e) => e.path === results[i].path));
}
await mf.dispose();

const failed = results.filter((r) => !isOk(r));
const slow = results.filter((r) => r.ms > 10_000 && !failed.includes(r));
console.log(`\n${results.length - failed.length}/${results.length} examples succeed; ${failed.length} fail; ${slow.length} slower than 10 s; ${ENDPOINTS.filter((e) => CAPACITY_LIMITED.has(e.path) || e.path.startsWith("/ai/")).length} AI/rendering tools skipped (staging).`);
if (jsonOut) await writeFile(jsonOut, JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
process.exit(failed.length ? 1 : 0);
