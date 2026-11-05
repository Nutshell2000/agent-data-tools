import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
const require = createRequire(import.meta.url);
const entry = fileURLToPath(new URL("../src/routes/packs.ts", import.meta.url));
const built = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent", external: ["cloudflare:*"] });
const mod = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, require);
const [token, chain = "base"] = process.argv.slice(2);
const e = mod.exports.PACKS.find((x) => x.endpoint.path === "/token/verdict");
const t0 = Date.now();
try { const out = await e.run({}, (n) => ({ token, chain })[n]); console.log(Date.now() - t0, "ms", JSON.stringify(out, null, 1).slice(0, 1400)); }
catch (err) { console.log("ERROR", err.status ?? "", err.message); }