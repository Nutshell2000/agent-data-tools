const esbuild = require("esbuild");
const Module = require("module");
(async () => {
  const b = await esbuild.build({ entryPoints: ["src/routes/recommend.ts"], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" });
  const m = new Module("x", module); m.filename = "x"; m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(b.outputFiles[0].text, "x");
  for (const q of ["extract text from a website","text from a website","read a web page","summarize a long article","summarize this article","summarize a web page"]) {
    const r = await m.exports.recommend({}, q, 3, null);
    console.log(q.padEnd(34), r.picks[0].tool);
  }
})();
