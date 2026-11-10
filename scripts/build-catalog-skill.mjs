// Writes skills/agent-data-tools/SKILL.md from src/guides/catalog-skill.ts with the production origin, so the copy that
// skills directories read from the repository is the text the Worker serves. tests/catalog-skill.test.cjs fails when
// the two differ: run `node scripts/build-catalog-skill.mjs` after editing the skill.
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const b = await build({ entryPoints: ["src/guides/catalog-skill.ts"], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent" });
const m = { exports: {} };
new Function("module", "exports", "require", b.outputFiles[0].text)(m, m.exports, require);
mkdirSync("skills/agent-data-tools", { recursive: true });
writeFileSync("skills/agent-data-tools/SKILL.md", m.exports.catalogSkillMarkdown("https://agent-data-tools.revmesh2074.workers.dev"));
console.log("skills/agent-data-tools/SKILL.md written");
