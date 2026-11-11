// Runs the /audit/contract pipeline from this PC against the real models, without a deploy (wrangler dev loops here).
// The models are called through the Workers AI REST API with the token in CF_AI_TOKEN (never printed):
//   $env:CF_AI_TOKEN = (npx wrangler auth token | Select-Object -Last 1); node scripts/audit-contract-dev.mjs <file.sol | chainId:0xaddress> [--json]
// A development aid: it spends a few cents of Workers AI a run and is not part of the tests or the release.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);
const token = process.env.CF_AI_TOKEN, account = process.env.CF_ACCOUNT ?? "a71d95cc01c3cac8962c09cc2195eb88";
if (!token) { console.error("set CF_AI_TOKEN"); process.exit(2); }
const entry = fileURLToPath(new URL("../src/routes/contract-audit.ts", import.meta.url));
const built = await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent", external: ["@cloudflare/puppeteer"] });
const Module = require("node:module");
const mod = new Module(entry, null);
mod.filename = entry; mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(built.outputFiles[0].text, entry);
const { auditSource, __test } = mod.exports;

const timings = [];
const run = async (model, payload) => {
  const t = Date.now();
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
  const json = await res.json();
  timings.push(`${model.split("/").pop()} HTTP ${res.status} ${((Date.now() - t) / 1000).toFixed(1)} s ${JSON.stringify(json.result?.usage ?? json.errors ?? null)}`);
  if (process.env.AUDIT_RAW_DIR) (await import("node:fs")).writeFileSync(`${process.env.AUDIT_RAW_DIR}/raw-${timings.length}.json`, JSON.stringify(json.result ?? json, null, 1));
  if (!res.ok) throw new Error(`workers ai ${res.status}`);
  return json.result;
};

const target = process.argv[2];
let input;
const onChain = /^(\d+):(0x[0-9a-fA-F]{40})$/.exec(target ?? "");
if (onChain) {
  const get = async (address) => { const r = await fetch(`https://sourcify.dev/server/v2/contract/${onChain[1]}/${address}?fields=sources,compilation,proxyResolution`); return r.ok ? r.json() : null; };
  const top = await get(onChain[2]);
  const implAddress = top?.proxyResolution?.isProxy ? top.proxyResolution.implementations?.[0]?.address : null;
  const code = (implAddress ? await get(implAddress) : null) ?? top;
  if (!code?.sources) { console.error("not verified on Sourcify"); process.exit(1); }
  const files = Object.entries(code.sources).map(([path, v]) => ({ path, content: v.content ?? "" }));
  input = { files, mainPath: __test.mainOf(files, code.compilation?.fullyQualifiedName?.split(":")[0]), name: code.compilation?.name ?? null, compiler: code.compilation?.compilerVersion ?? null, language: code.compilation?.language ?? null, chain: `chain ${onChain[1]}`, address: onChain[2], implementation: implAddress, proxyType: top?.proxyResolution?.proxyType ?? null, verified: code.match ?? null, sourceFrom: "Sourcify verified source (sourcify.dev)", notes: null, facts: null };
} else {
  const files = __test.pastedFiles(readFileSync(target, "utf8"));
  input = { files, mainPath: __test.mainOf(files, null), name: null, compiler: null, language: "Solidity", chain: null, address: null, implementation: null, proxyType: null, verified: null, sourceFrom: "source sent by the caller", notes: null, facts: null };
}
const started = Date.now();
const result = await auditSource(run, input);
console.error(`total ${((Date.now() - started) / 1000).toFixed(1)} s\n${timings.join("\n")}`);
console.log(process.argv.includes("--json") ? JSON.stringify({ ...result, report: undefined }, null, 2) : result.report);
