import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
const result = await build({ entryPoints: ["src/guides/tool-buying.ts"], bundle: true, platform: "node", format: "esm", write: false });
const guides = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const origin = "https://agent-data-tools.revmesh2074.workers.dev";
const recipient = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5";
await mkdir("docs", { recursive: true }); await mkdir("examples", { recursive: true });
for (const kind of ["web-reading", "bitcoin-fees"]) {
  const guide = guides.toolBuyingGuide(kind, origin, recipient);
  await writeFile(`docs/${kind}.md`, guides.toolGuideMarkdown(kind, origin, recipient));
  await writeFile(`examples/${kind}-http.ts`, guide.http + "\n");
  await writeFile(`examples/${kind}-mcp.ts`, guide.mcp + "\n");
}
console.log("Exported two buying guides and four capped clients from the live guide generator. No payment made.");
