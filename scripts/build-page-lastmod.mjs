#!/usr/bin/env node
// Writes src/data/page-lastmod.generated.ts: for every sitemap URL, the UTC day its page's source files last changed
// (lib/page-lastmod.ts puts it in the sitemap as <lastmod>). Run before a release, on a clone with full history:
//   node scripts/build-page-lastmod.mjs            write the file
//   node scripts/build-page-lastmod.mjs --check    exit 1 when the file would change (nothing is written)
//   node scripts/build-page-lastmod.mjs --base <ref>|none
// A date is the newest commit (committer date, UTC day) among the files that `sourcesFor` names for the page. Files
// that this release changes (uncommitted, or different from --base, default origin/main) count as changed today,
// because that is when the page changes for a reader. The mapping is coarse on purpose: see `sourcesFor`.
// It refuses a shallow clone (CI checks out one commit): there every file would look as new as the clone's oldest commit.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const OUT = "src/data/page-lastmod.generated.ts";

/** Bundles the Worker's own modules (as the tests do) and reads the sitemap and the catalog from them. */
export async function loadSite(root = ROOT) {
  const { build } = await import("esbuild");
  const routeFiles = readdirSync(path.join(root, "src/routes")).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).sort();
  const contents = [
    `export { sitemapXml } from "./discovery";`,
    `export { withEinvoicePages } from "./lib/einvoice-pages";`,
    `export { ENDPOINTS, toolSlug } from "./endpoints";`,
    `export { TOOL_SEO } from "./lib/tool-seo";`,
    `export { productPaths } from "./lib/product-pages";`,
    `export { lastmodOf, lastmodTag } from "./lib/page-lastmod";`,
    `export { PAGE_LASTMOD } from "./data/page-lastmod.generated";`,
    ...routeFiles.map((f, i) => `import * as r${i} from "./routes/${f.slice(0, -3)}";`),
    `export const ROUTES = {${routeFiles.map((f, i) => `${JSON.stringify(`src/routes/${f}`)}: r${i}`).join(",")}};`,
  ].join("\n");
  const built = await build({ stdin: { contents, resolveDir: path.join(root, "src"), loader: "ts", sourcefile: "page-lastmod-entry.ts" }, bundle: true, platform: "node", format: "cjs", write: false, external: ["cloudflare:workers"], logLevel: "silent" });
  const file = path.join(root, "src", "page-lastmod-entry.cjs");
  const mod = new Module(file);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(root);
  mod._compile(built.outputFiles[0].text, file);
  const m = mod.exports;

  const origin = "https://site.invalid";
  const xml = m.withEinvoicePages(m.sitemapXml(origin), origin);
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1].replaceAll("&amp;", "&").slice(origin.length));
  // Which route file defines which tool: every exported catalog entry ({ endpoint: { path } }) of every route module.
  const routeFilesOf = new Map();
  for (const [file, exports] of Object.entries(m.ROUTES)) {
    for (const value of Object.values(exports)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        const toolPath = item && typeof item === "object" ? item.endpoint?.path : undefined;
        if (typeof toolPath === "string") routeFilesOf.set(toolPath, [...new Set([...(routeFilesOf.get(toolPath) ?? []), file])]);
      }
    }
  }
  return {
    paths, xml, routeFilesOf,
    toolOfPage: new Map(m.ENDPOINTS.map((e) => [`/tools/${m.toolSlug(e.path)}`, e.path])),
    seoTools: new Set(Object.keys(m.TOOL_SEO)),
    productPaths: new Set(m.productPaths()),
    lastmodOf: m.lastmodOf, lastmodTag: m.lastmodTag, PAGE_LASTMOD: m.PAGE_LASTMOD,
  };
}

const GUIDE_FILES = {
  "/guides/web-reading": ["src/guides/tool-buying.ts", "src/guides/reader-buying.ts"],
  "/guides/bitcoin-fees": ["src/guides/tool-buying.ts"],
  "/guides/dependency-audit": ["src/guides/dependency-audit.ts"],
  "/guides/sitemap": ["src/guides/sitemap.ts"],
  "/guides/local-mcp": ["src/guides/local-mcp.ts"],
  "/guides/ai-sdk": ["src/guides/ai-sdk.ts"],
};

/**
 * The source files that decide what a sitemap page says, or undefined when no rule knows the page (then it gets no
 * date, and scripts/build-page-lastmod.test.mjs fails until a rule is added).
 *
 * Coarse and honest: a page's file also holds its siblings (one file renders every product page), so a page's date
 * can be later than its own last visible change. It is never earlier than a change to these files. What is NOT
 * followed: prices and plan sizes (credits.ts, key-prices.ts), the shared footer (legal.ts), shared styles and the
 * try form. A change there alone moves no date; following them would give every page the same date at each release.
 */
export function sourcesFor(page, site) {
  if (page === "/") return ["src/lib/home-page.ts", "src/lib/product-pages.ts"];
  if (/^\/(es|de|fr)\/$/.test(page)) return ["src/lib/home-page.ts", "src/lib/product-pages.ts", "src/lib/i18n/home-strings.ts", `src/lib/i18n/home-${page.slice(1, 3)}.ts`];
  if (page === "/docs") return ["src/lib/site-pages.ts"];
  // 20 Nov 2026: the card-credits and free-key pages are indexable and in the sitemap; map them to their renderers.
  if (page === "/credits") return ["src/lib/credit-routes.ts", "src/lib/credits.ts"];
  if (page === "/keys/free") return ["src/lib/free-keys.ts"];
  // 20 Nov 2026: the installable voice app and the transcription plan page were added to the sitemap (SEO batch).
  if (page === "/app") return ["src/lib/voice-app.ts", "src/lib/voice-console.ts", "src/lib/app-jsonld.ts"];
  if (page === "/transcribe-pro") return ["src/lib/voice-pro.ts"];
  if (site.productPaths.has(page)) return ["src/lib/product-pages.ts"];
  if (page === "/lexglyph") return ["src/lib/lexglyph-page.ts", "src/lib/lexglyph-i18n.ts"];
  // 21 Nov 2026: the trust pages linked from every footer joined the sitemap (lib/legal.ts renders them).
  if (["/about", "/faq", "/contact", "/terms", "/privacy"].includes(page)) return ["src/lib/legal.ts"];
  if (page === "/vat-number-check" || page.startsWith("/vat-number-check/")) return ["src/lib/vat-pages.ts"];
  if (page === "/company-register" || page.startsWith("/company-register/")) return ["src/lib/register-pages.ts"];
  if (page === "/tools") return ["src/lib/tool-pages.ts", "src/endpoints.ts", "src/families.ts"];
  if (page.startsWith("/tools/")) {
    const tool = site.toolOfPage.get(page);
    if (!tool) return undefined;
    // A tool no route file exports is one of the core tools, listed in endpoints.ts and run from tools.ts.
    return [...(site.routeFilesOf.get(tool) ?? ["src/endpoints.ts", "src/tools.ts"]), "src/lib/tool-pages.ts", ...(site.seoTools.has(tool) ? ["src/lib/tool-seo.ts"] : [])];
  }
  if (Object.hasOwn(GUIDE_FILES, page)) return GUIDE_FILES[page];
  if (page === "/guides" || page.startsWith("/guides/")) return ["src/guides/task-guides.ts"];
  if (page === "/skills/spellzcode-x402-reader/SKILL.md") return ["src/guides/reader-skill.ts"];
  if (page === "/examples/extract/") return ["scripts/build-reader-assets.mjs", "examples/reader-samples.mjs"];
  if (page === "/e-invoice" || page.startsWith("/e-invoice/")) return ["src/lib/einvoice-pages.ts", "src/lib/einvoice/validate.ts"];
  if (page === "/de/e-rechnung" || page.startsWith("/de/e-rechnung/")) return ["src/lib/einvoice-pages-de.ts", "src/lib/einvoice/rules-de.ts", "src/lib/einvoice/validate.ts"];
  return undefined;
}

export const utcDay = (unixSeconds) => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/**
 * Pure: page -> day. `times` is file -> newest commit (unix seconds), `changed` the files this release changes.
 * A page is left out when no rule knows it, when one of its files has no known date, or when its date is after today.
 */
export function pageLastmod({ paths, sourcesOf, times, changed, today }) {
  const dates = {}, unmapped = [], unknown = [], future = [];
  for (const page of paths) {
    const files = sourcesOf(page);
    if (!files?.length) { unmapped.push(page); continue; }
    const days = files.map((f) => (changed.has(f) ? today : times.has(f) ? utcDay(times.get(f)) : undefined));
    if (days.includes(undefined)) { unknown.push(page); continue; }
    const day = days.reduce((a, b) => (a > b ? a : b));
    if (day > today) { future.push(page); continue; }
    dates[page] = day;
  }
  return { dates, unmapped, unknown, future };
}

export function render(dates) {
  const lines = Object.keys(dates).sort().map((p) => `  ${JSON.stringify(p)}: ${JSON.stringify(dates[p])},`);
  return [
    "// Generated by scripts/build-page-lastmod.mjs from git history. Do not edit by hand; rerun it before a release.",
    "// Sitemap path -> the UTC day its page's source files last changed. A path that is missing gets no <lastmod>.",
    `export const PAGE_LASTMOD: Readonly<Record<string, string>> = {${lines.length ? `\n${lines.join("\n")}\n` : ""}};`,
    "",
  ].join("\n");
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** Throws on a shallow clone: its oldest commit looks like the one that wrote every older file. */
export function assertFullHistory(cwd = ROOT) {
  if (git(cwd, "rev-parse", "--is-shallow-repository").trim() !== "false") {
    throw new Error("this clone is shallow, so the last change of most files cannot be read from it; nothing written. Run on a full clone (git fetch --unshallow).");
  }
}

/** file -> newest commit that touched it (committer date, unix seconds), in one pass over the history of HEAD. */
export function commitTimes(cwd = ROOT) {
  const times = new Map();
  // Merge commits list no files here, so a "merge main into the branch" commit does not make main's files look new.
  for (const block of git(cwd, "log", "--format=%x00%ct", "--name-only", "--no-renames", "HEAD").split("\0").slice(1)) {
    const [when, ...files] = block.split("\n").filter(Boolean);
    for (const f of files) if (!times.has(f) || Number(when) > times.get(f)) times.set(f, Number(when));
  }
  return times;
}

/** Files this release changes: uncommitted or untracked ones, and those that differ from the merge base with `base`. */
export function changedInRelease(cwd = ROOT, base = "origin/main") {
  const changed = new Set(git(cwd, "status", "--porcelain", "-z", "--no-renames", "-uall").split("\0").filter(Boolean).map((entry) => entry.slice(3)));
  if (base && base !== "none") {
    const mergeBase = git(cwd, "merge-base", base, "HEAD").trim();
    for (const f of git(cwd, "diff", "--name-only", "-z", "--no-renames", mergeBase, "HEAD").split("\0").filter(Boolean)) changed.add(f);
  }
  return changed;
}

async function main(argv) {
  const check = argv.includes("--check");
  const baseAt = argv.indexOf("--base");
  let base = baseAt >= 0 ? argv[baseAt + 1] : "origin/main";
  assertFullHistory(ROOT);
  if (baseAt < 0) { try { git(ROOT, "rev-parse", "--verify", "--quiet", `${base}^{commit}`); } catch { base = "none"; } }
  const site = await loadSite(ROOT);
  const today = new Date().toISOString().slice(0, 10);
  const { dates, unmapped, unknown, future } = pageLastmod({ paths: site.paths, sourcesOf: (p) => sourcesFor(p, site), times: commitTimes(ROOT), changed: changedInRelease(ROOT, base), today });
  if (future.length) throw new Error(`${future.length} pages would get a date after today (${today}); check this computer's clock. First: ${future[0]}`);
  const byDay = {};
  for (const day of Object.values(dates)) byDay[day] = (byDay[day] ?? 0) + 1;
  console.log(`page-lastmod: ${Object.keys(dates).length} of ${site.paths.length} sitemap pages dated (base ${base}); ${Object.keys(byDay).sort().reverse().slice(0, 8).map((d) => `${d}: ${byDay[d]}`).join(", ")}`);
  if (unmapped.length) console.log(`page-lastmod: no rule for ${unmapped.length} pages (no date): ${unmapped.slice(0, 10).join(" ")}`);
  if (unknown.length) console.log(`page-lastmod: a source file with no commit for ${unknown.length} pages (no date): ${unknown.slice(0, 10).join(" ")}`);
  const next = render(dates);
  const file = path.join(ROOT, OUT);
  const current = existsSync(file) ? readFileSync(file, "utf8").replaceAll("\r\n", "\n") : "";
  if (current === next) { console.log(`page-lastmod: ${OUT} is up to date`); return; }
  if (check) { console.error(`page-lastmod: ${OUT} is stale; run node scripts/build-page-lastmod.mjs`); process.exitCode = 1; return; }
  writeFileSync(file, next);
  console.log(`page-lastmod: wrote ${OUT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`page-lastmod: ${e.message}`); process.exitCode = 1; });
}
