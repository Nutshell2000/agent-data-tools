// Writes one Official MCP Registry manifest per MCP section server (/mcp/<slug>) into registry/,
// from the live catalog, so directories that mirror the registry list each focused server too.
// The publish workflow runs this before publishing server.json and registry/*.json.
//   node scripts/build-registry-manifests.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const server = JSON.parse(await readFile(new URL("server.json", root), "utf8"));
const bundled = await build({
  stdin: { contents: 'export { CAPACITY_LIMITED, MCP_BUNDLES, mcpBundleTools } from "./src/discovery";', resolveDir: root.pathname.replace(/^\/([A-Za-z]:)/, "$1"), sourcefile: "registry-entry.ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
  plugins: [{ name: "stub-workers", setup(b) {
    b.onResolve({ filter: /^(cloudflare:workers|@cloudflare\/puppeteer)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class DurableObject {}; export default {};", loader: "js" }));
  } }],
});
const { CAPACITY_LIMITED, MCP_BUNDLES, mcpBundleTools } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

// What each section does, in the registry's 100-character description budget.
const WHAT = {
  prices: "token prices, wallet and contract risk, liquidity pools, FX",
  chain: "balances, blocks, gas, txs and logs on 5 EVM chains, plus Bitcoin",
  web: "web pages, JS apps and PDFs as text, feeds, sitemaps, search",
  compliance: "OFAC sanctions, counterparty checks, company, domain, email",
  ai: "LLM chat, summaries, translation, embeddings, speech, images",
  everyday: "weather, time zones, sun and moon, earthquakes, countries",
  utilities: "JSON repair, CSV, hashes, cron, dates, units, validators",
};
const origin = server.remotes[0].url.replace(/\/mcp$/, "");
await mkdir(new URL("registry/", root), { recursive: true });
for (const [slug, title] of Object.entries(MCP_BUNDLES)) {
  const tools = mcpBundleTools(slug);
  const count = tools.length;
  // Free calls do not cover capacity-limited tools, so only sections with free tools say so.
  const free = tools.some((e) => !CAPACITY_LIMITED.has(e.path)) ? "25 free calls." : "From $0.002.";
  const description = `${count} tools: ${WHAT[slug] ?? title.toLowerCase()}. ${free}`;
  if (description.length > 100) throw new Error(`${slug}: description is ${description.length} characters (max 100)`);
  const manifest = {
    $schema: server.$schema,
    name: `${server.name}-${slug}`,
    title: `${server.title}: ${title}`,
    description,
    version: server.version,
    repository: server.repository,
    ...(server.websiteUrl ? { websiteUrl: server.websiteUrl } : {}),
    ...(server.icons ? { icons: server.icons } : {}),
    remotes: [{ ...server.remotes[0], url: `${origin}/mcp/${slug}` }],
  };
  await writeFile(new URL(`registry/${slug}.json`, root), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${manifest.name} (${count} tools, ${description.length} chars)`);
}
