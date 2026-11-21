// Writes one Official MCP Registry manifest per MCP section server (/mcp/<slug>) into registry/,
// from the live catalog, so directories that mirror the registry list each focused server too.
// The publish workflow runs this before publishing server.json and registry/*.json.
//   node scripts/build-registry-manifests.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const server = JSON.parse(await readFile(new URL("server.json", root), "utf8"));
const bundled = await build({
  stdin: { contents: 'export { FREE_EXCLUDED_METERED } from "./src/lib/capacity"; export { FREE_CALLS_PER_CALLER } from "./src/lib/free-calls"; export { ENDPOINTS, FOCUSED_SERVERS, focusedServerTools, MCP_BUNDLES, mcpBundleTools, mcpListed, TOOL_COUNT } from "./src/discovery"; export { EXTRA_CHAIN_PATHS } from "./src/routes/chain-reads";', resolveDir: root.pathname.replace(/^\/([A-Za-z]:)/, "$1"), sourcefile: "registry-entry.ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
  plugins: [{ name: "stub-workers", setup(b) {
    b.onResolve({ filter: /^(cloudflare:workers|@cloudflare\/puppeteer)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export class DurableObject {}; export default {};", loader: "js" }));
  } }],
});
const { FREE_EXCLUDED_METERED, FREE_CALLS_PER_CALLER, ENDPOINTS, EXTRA_CHAIN_PATHS, FOCUSED_SERVERS, focusedServerTools, MCP_BUNDLES, mcpBundleTools, mcpListed, TOOL_COUNT } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

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
  // What the section's tools/list shows: entry paths (second names) run by name and are not listed (16 Nov 2026).
  const tools = mcpListed(mcpBundleTools(slug));
  const count = tools.length;
  // Free calls run only tools outside FREE_EXCLUDED_METERED (no AI, speech, images, rendering, search), so only
  // sections with such tools say so; the number is the one in src/lib/free-calls.ts.
  const free = tools.some((e) => !FREE_EXCLUDED_METERED.has(e.path)) ? `${FREE_CALLS_PER_CALLER} free calls.` : "From $0.002.";
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

// Hand-picked product servers (FOCUSED_SERVERS) and the compact server: small, single-purpose entries, which is what
// Glama's connector scores and searches reward (14 Nov 2026).
const extra = [
  // 15 Nov 2026: the voice server's "6 tools: …" ran to 101 characters and failed every publish (1.199.0, 1.201.0), so the
  // registry missed whole releases. A product line that does not fit drops its tool count instead of stopping the run;
  // tests/registry-manifests.test.cjs runs this script in CI so it cannot fail silently again.
  ...Object.entries(FOCUSED_SERVERS).map(([slug, f]) => {
    const counted = `${focusedServerTools(slug).length} tools: ${f.registry}.`;
    return { slug, title: f.title, description: counted.length <= 100 ? counted : `${f.registry}.` };
  }),
  // TOOL_COUNT is the one tool count (src/endpoints.ts); tests/tool-count.test.cjs holds these manifests to it.
  { slug: "compact", title: "Compact (find, describe, run)", description: `3 tools that find, describe and run ${TOOL_COUNT} data tools: prices, chain, web, PDF. ${FREE_CALLS_PER_CALLER} free calls.` },
  // 16 Nov 2026: /mcp (server.json) lists a small surface; the list with every tool as its own definition is /mcp/all.
  { slug: "all", title: "Full list (every tool as its own definition)", description: `${mcpListed(ENDPOINTS.filter((e) => !EXTRA_CHAIN_PATHS.has(e.path))).length} tools, each its own definition: prices, chain, web, PDF, AI. ${FREE_CALLS_PER_CALLER} free calls.` },
];
for (const { slug, title, description } of extra) {
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
  console.log(`${manifest.name} (${description.length} chars)`);
}
// Drafts for the com.glyphcall namespace (16 Nov 2026): the same three servers under the brand's own domain. NOT
// published: publish-mcp.yml reads server.json and registry/*.json only, and registry-drafts/ is outside both
// (tests/glyphcall-registry-drafts.test.cjs holds that). Publishing needs the owner to prove control of
// glyphcall.com to the registry first. No tool counts in these.
const BRAND = "Glyphcall", BRAND_ORIGIN = "https://glyphcall.com";
const rebased = (value) => JSON.parse(JSON.stringify(value).replaceAll(origin, BRAND_ORIGIN));
const drafts = [
  { name: "tools", slug: "compact", title: "Tools (find, describe, run)", what: "find, describe and run pay-per-call data tools: prices, chain, web, PDF" },
  { name: "company-check", slug: "company-check", title: FOCUSED_SERVERS["company-check"].title, what: FOCUSED_SERVERS["company-check"].registry },
  // The voice server's own registry line does not fit behind the brand (100 characters), so this one is written here.
  { name: "voice", slug: "voice", title: FOCUSED_SERVERS.voice.title, what: "transcribe audio and video with SRT/VTT subtitles, and text to speech as MP3" },
];
await mkdir(new URL("registry-drafts/com.glyphcall/", root), { recursive: true });
for (const { name, slug, title, what } of drafts) {
  const description = `${BRAND}: ${what}.`;
  if (description.length > 100) throw new Error(`com.glyphcall/${name}: description is ${description.length} characters (max 100)`);
  const manifest = {
    $schema: server.$schema,
    name: `com.glyphcall/${name}`,
    title: `${BRAND}: ${title}`,
    description,
    version: server.version,
    repository: server.repository,
    websiteUrl: `${BRAND_ORIGIN}/`,
    ...(server.icons ? { icons: rebased(server.icons) } : {}),
    remotes: [{ ...rebased(server.remotes[0]), url: `${BRAND_ORIGIN}/mcp/${slug}` }],
  };
  await writeFile(new URL(`registry-drafts/com.glyphcall/${name}.json`, root), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`draft, not published: ${manifest.name} (${description.length} chars)`);
}
