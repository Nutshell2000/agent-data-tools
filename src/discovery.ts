import { FREE_CALLS_PER_CALLER, FREE_CALLS_PER_DAY } from "./lib/free-calls";
import { mcpName } from "./mcp-contract";
import { readerBuyingCss, readerBuyingHtml, type ReaderDemo } from "./guides/reader-buying";
import { ENDPOINTS, EXTRA_LINKS, GUIDANCE, SERVICE_ID, SERVICE_NAME, SERVICE_SUMMARY, SUPPORT_EMAIL, exampleParams, toolSlug, type Endpoint } from "./endpoints";
import { schemaFromExample } from "./lib/output-schema";
import { salesOrdered } from "./lib/discovery-index";

export * from "./endpoints";

/** Version of the MCP tool catalog (server.json and serverInfo); raised when tools are added or changed. */
export const MCP_SERVER_VERSION = "1.50.3";
/** Version of the downloadable reader client under /clients/reader/ (package.json version). */
export const READER_VERSION = "1.7.6";

// Always carries at least one parameter so "path?query" stays well-formed.
export const exampleQuery = (e: Endpoint) =>
  exampleParams(e)
    .map(([k, p]) => `${k}=${encodeURIComponent(String(p.example))}`)
    .join("&") || "format=json";

const trialNote = (enabled: boolean) =>
  enabled
    ? `Free calls: every caller gets ${FREE_CALLS_PER_CALLER} free successful calls (failed calls do not count). Over MCP they are used automatically before any payment; over HTTP add trial=1 to a GET request. Not for the AI, rendering, screenshot, transcription and search tools, and at most ${FREE_CALLS_PER_DAY.toLocaleString("en-US")} free calls a day in total. The operator can switch this off.`
    : "Free trials are disabled. Requests with trial=1 receive the normal 402 payment challenge.";

/** Every way a buyer can pay per call: the x402 networks (primary first) and the MPP methods (Tempo first). */
export type PaymentRails = { networks: readonly string[]; mpp: readonly string[] };

export function serviceCard(origin: string, payTo: string, network: string, rails?: PaymentRails) {
  return {
    name: SERVICE_NAME,
    description: SERVICE_SUMMARY,
    // `network` stays the primary one for older readers; `networks` and `mpp` list every accepted rail.
    payment: { protocol: "x402", version: 2, scheme: "exact", network, ...(rails ? { networks: rails.networks, mpp: rails.mpp } : {}), asset: "USDC", payTo },
    endpoints: salesOrdered(ENDPOINTS).map((e) => ({
      method: "GET",
      url: origin + e.path,
      price: e.price,
      summary: e.summary,
      params: e.params,
      example: `${origin}${e.path}?${exampleQuery(e)}`,
    })),
    docs: { buyerSkill: `${origin}/skills/spellzcode-x402-reader/SKILL.md`, buyerSkillIndex: `${origin}/skills/index.json`, readerSingleChecksum: `${origin}/clients/reader/${READER_VERSION}/reader-client.mjs.sha256`, localMcpChecksum: `${origin}/clients/reader/${READER_VERSION}/reader-mcp.mjs.sha256`, localMcpGuide: `${origin}/guides/local-mcp`, localMcpClient: `${origin}/clients/reader/${READER_VERSION}/reader-mcp.mjs`, readerClient: `${origin}/clients/reader/${READER_VERSION}/reader-client.mjs`, readerChecksum: `${origin}/clients/reader/${READER_VERSION}/SHA256SUMS`, readerExamples: `${origin}/examples/extract/manifest.json`, webReading: `${origin}/guides/web-reading`, bitcoinFees: `${origin}/guides/bitcoin-fees`, sitemap: `${origin}/guides/sitemap`, openapi: `${origin}/openapi.json`, llms: `${origin}/llms.txt`, mcp: `${origin}/mcp`, dependencyAudit: `${origin}/guides/dependency-audit` },
  };
}

/** Advertises the MCP endpoint to clients that look for a server card. */
export function mcpServerCard(origin: string, networks: readonly string[] = ["base"]) {
  return {
    serverInfo: { name: SERVICE_ID, title: SERVICE_NAME, version: MCP_SERVER_VERSION },
    description: SERVICE_SUMMARY,
    transport: { type: "streamable-http", endpoint: `${origin}/mcp` },
    bundles: Object.entries(MCP_BUNDLES).map(([slug, title]) => ({ title, endpoint: `${origin}/mcp/${slug}`, tools: mcpBundleTools(slug)!.length })),
    capabilities: { tools: { listChanged: false } },
    // /mcp needs no sign-in; /mcp/account is the same tools behind OAuth for app directories.
    authentication: { required: false, optional: { type: "oauth2", endpoint: `${origin}/mcp/account`, metadata: `${origin}/.well-known/oauth-authorization-server` } },
    freeCalls: { perCaller: FREE_CALLS_PER_CALLER },
    payment: {
      // MCP tool payments accept x402 on every network listed (the first is the default).
      protocol: "x402", asset: "USDC", network: networks[0], networks,
      // Card alternative: a prepaid key from /credits sent on the MCP request replaces x402 for every call.
      alternatives: [{ method: "card-credits", buy: `${origin}/credits`, header: "Authorization: Bearer adt_…", balance: `${origin}/credits/balance` }],
    },
    tools: salesOrdered(ENDPOINTS).map((e) => ({ name: mcpName(e.path), description: e.summary, price: e.price, ...("outputSchema" in e ? { outputSchema: e.outputSchema } : {}) })),
  };
}

/** Legacy ChatGPT plugin manifest: some agent crawlers still look for it first; it only points at the OpenAPI. */
export function aiPluginManifest(origin: string) {
  return {
    schema_version: "v1",
    name_for_human: SERVICE_NAME,
    name_for_model: "agent_data_tools",
    description_for_human: "Pay-per-call data tools for AI agents: payee and sanctions checks, prices, chain data, web reading.",
    description_for_model: `${SERVICE_SUMMARY} Every unpaid call answers HTTP 402 with x402 and MPP payment terms; ${FREE_CALLS_PER_CALLER} free calls per caller with trial=1. Pick a tool from ${origin}/llms.txt or ${origin}/discovery/resources.`,
    auth: { type: "none" },
    api: { type: "openapi", url: `${origin}/openapi.json` },
    logo_url: `${origin}/logo.png`,
    contact_email: SUPPORT_EMAIL,
    legal_info_url: `${origin}/terms`,
  };
}

/** Words in a guessed URL that say nothing about the tool wanted. */
const PATH_NOISE = new Set(["api", "v1", "v2", "v3", "get", "tool", "tools", "data", "paid", "rest", "json", "query", "lookup", "info", "check", "the", "www", "http", "https"]);

/** Words agents use for a tool whose path says it differently. */
const PATH_SYNONYMS: Record<string, string[]> = {
  ofac: ["sanctions"], sdn: ["sanctions"], aml: ["sanctions"], kyc: ["counterparty"], kyt: ["counterparty"],
  honeypot: ["token", "report"], rug: ["token", "report"], scrape: ["extract"], scraper: ["extract"], markdown: ["extract"],
  crawl: ["extract"], whois: ["domain"], rdap: ["domain"], dns: ["domain"], currency: ["fx"], exchange: ["fx"],
  mempool: ["btc", "fees"], forecast: ["weather"], geoip: ["ip"], edgar: ["sec", "filings"], stock: ["sec", "filings"],
};

/**
 * Tools whose path shares a word with a path that does not exist ("/api/v1/weather" -> /weather), best sellers first
 * on ties, so a bot that guessed our URL scheme is sent to the paid tool instead of a dead end.
 */
export function suggestTools(path: string, max = 3): string[] {
  const words = path.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !PATH_NOISE.has(w));
  for (const w of [...words]) words.push(...(PATH_SYNONYMS[w] ?? []));
  if (!words.length) return [];
  const scored = salesOrdered(ENDPOINTS).map((e, rank) => {
    const own = e.path.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const hits = words.filter((w) => own.some((o) => o === w || (w.length >= 4 && (o.startsWith(w) || w.startsWith(o)) && o.length >= 3))).length;
    return { path: e.path, hits, extra: own.length - hits, rank };
  });
  return scored.filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits || a.extra - b.extra || a.rank - b.rank).slice(0, max).map((s) => s.path);
}

/** RFC 9727 API catalog pointing at the machine-readable descriptions. */
export function apiCatalog(origin: string) {
  return {
    linkset: [
      {
        anchor: origin,
        "service-desc": [{ href: `${origin}/openapi.json`, type: "application/openapi+json" }],
        "service-doc": [{ href: `${origin}/llms.txt`, type: "text/markdown" }],
      },
    ],
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

function catalogEndpoint(path: string): Endpoint {
  const endpoint = ENDPOINTS.find((item) => item.path === path);
  if (!endpoint) throw new Error(`Missing catalog endpoint ${path}`);
  return endpoint;
}

function endpointSpendCap(path: string) {
  const endpoint = catalogEndpoint(path);
  const match = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec(endpoint.price);
  if (!match) throw new Error(`Cannot express ${endpoint.price} as six-decimal USDC`);
  const atomic = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return { price: endpoint.price, atomic: atomic.toString() };
}

/**
 * The per-payment cap in the published client example: the ordinary per-call price, which most tools charge.
 * An example capped at the cheapest tool's price would make an agent that copies it refuse almost every tool.
 */
export const ORDINARY_PRICE = "$0.01";
const atomicOf = (price: string) => {
  const match = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec(price);
  if (!match) throw new Error(`Cannot express ${price} as six-decimal USDC`);
  return (BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0")).toString();
};
const exampleSpendCap = () => ({ price: ORDINARY_PRICE, atomic: atomicOf(ORDINARY_PRICE) });

/**
 * capMode "exact" (tool guides) pins the one tool's price; "ordinary" (homepage, llms.txt, OpenAPI guidance)
 * caps at ORDINARY_PRICE so the copied client can pay for every ordinary tool, unless the tool costs more.
 */
export function paymentClientExample(origin: string, payTo: string, path = "/extract", query = "url=https%3A%2F%2Fexample.com", capMode: "exact" | "ordinary" = "exact") {
  const own = endpointSpendCap(path);
  const ordinary = exampleSpendCap();
  const cap = capMode === "ordinary" && BigInt(own.atomic) <= BigInt(ordinary.atomic) ? ordinary : own;
  const capNote = cap === own ? `the current ${path} price` : `the ordinary per-call price (${path} costs ${own.price})`;
  const requestPath = `${path}?${query}`;
  return [
    "// Save as client.ts; set X402_PRIVATE_KEY in your environment, never in source.",
    'import { ExactEvmScheme } from "@x402/evm";',
    'import { wrapFetchWithPayment, x402Client } from "@x402/fetch";',
    'import { privateKeyToAccount } from "viem/accounts";',
    "",
    "const rawPrivateKey = process.env.X402_PRIVATE_KEY;",
    'if (!rawPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(rawPrivateKey)) {',
    '  throw new Error("Set X402_PRIVATE_KEY in a secret manager or process environment.");',
    "}",
    "const account = privateKeyToAccount(rawPrivateKey as `0x${string}`);",
    `const serviceOrigin = ${JSON.stringify(origin)};`,
    `const expectedPayTo = ${JSON.stringify(payTo.toLowerCase())};`,
    'const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";',
    `const maxUsdcAtomic = ${cap.atomic}n; // ${cap.price} USDC, ${capNote}`,
    "",
    'const client = new x402Client()',
    '  .register("eip155:8453", new ExactEvmScheme(account))',
    `  .setSpendControls({ maxAmountPerPayment: "${cap.price}" })`,
    "  .registerPolicy((_version, requirements) =>",
    "    requirements.filter((requirement) => {",
    '      if (requirement.network !== "eip155:8453" || requirement.scheme !== "exact") return false;',
    "      if (requirement.payTo.toLowerCase() !== expectedPayTo) return false;",
    "      if (requirement.asset.toLowerCase() !== baseUsdc.toLowerCase()) return false;",
    "      return /^\\d+$/.test(requirement.amount) && BigInt(requirement.amount) <= maxUsdcAtomic;",
    "    }),",
    "  );",
    "",
    "const fetchWithPayment = wrapFetchWithPayment(fetch, client);",
    `const response = await fetchWithPayment(new URL(${JSON.stringify(requestPath)}, serviceOrigin));`,
    'if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);',
    "console.log(await response.json());",
  ].join("\n");
}

function clientGuidance() {
  const cap = exampleSpendCap().price;
  const packageAuditPrice = catalogEndpoint("/package-audit").price;
  return `Start with /guides/web-reading and the bundled Node CLI at /clients/reader/${READER_VERSION}/reader-client.mjs; quote needs no key and never signs, while buy requires an explicit cap. Cached examples: /examples/extract/manifest.json. The homepage and llms.txt also include a TypeScript x402 client example pinned to Base, this service's PAY_TO recipient and Base USDC. It caps each payment at ${cap}, the ordinary per-call price, so it pays for every tool priced at ${cap} or less; /package-audit costs ${packageAuditPrice} and is intentionally rejected by that example.`;
}

/** Catalog sections for people browsing: first matching rule wins, everything else is a utility. */
const CATEGORY_RULES: [string, (path: string) => boolean][] = [
  ["Prices and DeFi", (p) => /^\/(price\/|wallet\/portfolio|token|trade-insight|liquidity-pool-audit|mev-simulator|contract-risk|wallet-audit|btc-price|hyperliquid\/|fx$)/.test(p)],
  ["Chain data", (p) => /^\/(base|eth|arb|op|polygon)\//.test(p) || /^\/(base-gas|base-tx|base-allowance|ens|wallet|wallet\/balances|btc-fees|btc-address|ln-invoice|network|keccak)$/.test(p)],
  ["Web, documents and search", (p) => /^\/(extract|extract\/rendered|sitemap|summarize|screenshot|pdf\/text|feed|url\/meta|search|news|wikipedia|dictionary|papers)$/.test(p)],
  ["Company, compliance and checks", (p) => /^\/(company|sanctions\/check|check\/counterparty|check\/payee|check\/x402-seller|domain|domain-report|email|package|package-audit|x402\/check|sec\/filings|text\/prompt-injection|http\/security-headers|dockerfile\/lint)$/.test(p)],
  ["AI", (p) => p.startsWith("/ai/") || /^\/(image|transcribe|describe)$/.test(p)],
  ["Everyday data", (p) => /^\/(weather|time|holidays|geocode|earthquakes|airport\/status|sun|moon|country|npm\/downloads|pypi)$/.test(p) || p.startsWith("/econ/")],
];
export const CATEGORY_ORDER = [...CATEGORY_RULES.map(([name]) => name), "Utilities"];
export const categoryOf = (path: string) => CATEGORY_RULES.find(([, match]) => match(path))?.[0] ?? "Utilities";
/**
 * Smaller MCP servers, one per catalog section, at /mcp/<slug>. Many MCP clients cap or slow
 * down past a few dozen tools, and every listed tool costs the agent context.
 */
export const MCP_BUNDLES: Readonly<Record<string, string>> = Object.freeze({
  prices: "Prices and DeFi",
  chain: "Chain data",
  web: "Web, documents and search",
  compliance: "Company, compliance and checks",
  ai: "AI",
  everyday: "Everyday data",
  utilities: "Utilities",
});
export const mcpBundleTools = (slug: string) =>
  Object.hasOwn(MCP_BUNDLES, slug) ? ENDPOINTS.filter((e) => categoryOf(e.path) === MCP_BUNDLES[slug]) : undefined;
/** Tools shown first on the homepage. */
const START_HERE = ["/extract", "/price/token", "/wallet/portfolio", "/check/counterparty", "/company", "/pdf/text"];
export const byCategory = () => CATEGORY_ORDER.map((name) => ({ name, tools: ENDPOINTS.filter((e) => categoryOf(e.path) === name) })).filter((g) => g.tools.length);

/**
 * Page title. x402scan scrapes it as the origin title and puts it in the search text of every one of
 * our resources (origin title | resource description | origin description | tags), so it names what
 * buyers search for, not just a tool count.
 */
// Google Search Console ownership (URL-prefix property for the worker origin, added by Peter on 2026-10-20). Public by design.
const GOOGLE_SITE_VERIFICATION = "HeQjGo464TFyKSavKXvOaOF3C2o62GLeO5XySvLiHco";
/** What a tool does first, then its fine print: directories and agents read the opening words to pick a tool. */
export const fullDescription = (e: Pick<Endpoint, "description"> & { details?: string }) => e.details ? `${e.description} Details: ${e.details}` : e.description;

export const PAGE_TITLE = `${SERVICE_NAME}: token prices, wallet and chain data, OFAC sanctions screening, web and PDF reading. ${ENDPOINTS.length} tools, 25 free calls, then from $0.002`;

/**
 * One-click installs of the MCP server: Cursor and VS Code deep links (each opens the editor's own "add server"
 * prompt), the Claude Code command and the Claude.ai/ChatGPT connector URL. Directories send developers to the
 * homepage and the README; before these, both only showed the bare URL to copy.
 */
export function mcpInstallLinks(origin: string) {
  const url = `${origin}/mcp`;
  const vscodeConfig = encodeURIComponent(JSON.stringify({ name: "agent-data-tools", type: "http", url }));
  return {
    url,
    cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=agent-data-tools&config=${encodeURIComponent(btoa(JSON.stringify({ url })))}`,
    vscode: `vscode:mcp/install?${vscodeConfig}`,
    vscodeInsiders: `vscode-insiders:mcp/install?${vscodeConfig}`,
    claudeCode: `claude mcp add --transport http agent-data-tools ${url}`,
    claudeAi: `${origin}/mcp/account`,
  };
}

/** Human-readable front page for people arriving from a directory listing. */
export function homePage(origin: string, payTo: string, trialsEnabled = false, demo?: ReaderDemo) {
  const clientExample = paymentClientExample(origin, payTo, "/extract", "url=https%3A%2F%2Fexample.com", "ordinary");
  const install = mcpInstallLinks(origin);
  const row = (e: (typeof ENDPOINTS)[number]) =>
    `<tr><td class="path"><a href="/tools/${esc(toolSlug(e.path))}"><code>${esc(e.path)}</code></a></td><td>${esc(e.summary)}</td><td class="price">${esc(e.price)}</td></tr>`;
  const starters = START_HERE.map((p) => ENDPOINTS.find((e) => e.path === p)).filter((e): e is (typeof ENDPOINTS)[number] => Boolean(e));
  const head = "<tr><th>Endpoint</th><th>What it does</th><th>Price</th></tr>";
  const rows = [
    `<h3 class="cat">Start here</h3><div class="wrap"><table>${head}${starters.map(row).join("")}</table></div>`,
    ...byCategory().map((g) => `<h3 class="cat">${esc(g.name)} (${g.tools.length})</h3><div class="wrap"><table>${head}${g.tools.map(row).join("")}</table></div>`),
  ].join("");
  const details = ENDPOINTS.map((e) => {
    const params = Object.entries(e.params)
      .map(([k, p]) => `<li><code>${esc(k)}</code>${p.required ? " (required)" : ""}: ${esc(p.description)}</li>`)
      .join("");
    const query = exampleQuery(e);
    // Keep the trial opt-in limited to human-facing homepage links; machine-readable
    // discovery examples should continue to trigger the normal 402 challenge.
    const example = `${origin}${e.path}?${query}${trialsEnabled ? "&trial=1" : ""}`;
    const exampleLabel = trialsEnabled ? "Try free once" : "Example";
    return `<section id="tool-${esc(e.path.slice(1).replaceAll("/", "_"))}"><h3><code>GET ${esc(e.path)}</code> <span class="price">${esc(e.price)}</span></h3><p>${esc(fullDescription(e as Endpoint))}</p><ul>${params}</ul><p class="ex">Example: <a ${trialsEnabled ? 'rel="nofollow" ' : ""}href="${esc(example)}">${exampleLabel}</a> — <code>${esc(example)}</code> · <a href="/tools/${esc(toolSlug(e.path))}">Tool page</a></p></section>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(PAGE_TITLE)}</title>
<link rel="canonical" href="${esc(origin)}/">
<meta name="google-site-verification" content="${GOOGLE_SITE_VERIFICATION}">
<meta name="description" content="${esc(SERVICE_SUMMARY)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SERVICE_NAME)}">
<meta property="og:title" content="${esc(PAGE_TITLE)}">
<meta property="og:description" content="${esc(SERVICE_SUMMARY)}">
<meta property="og:url" content="${esc(origin)}/">
<meta property="og:image" content="${esc(origin)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(SERVICE_NAME)}: pay-per-call data tools for AI agents over x402">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(origin)}/og.png">
<style>
:root { --bg:#fbfaf7; --fg:#1d1b16; --muted:#6b665c; --line:#e3ded3; --accent:#0b6e4f; --code:#f1ede4; }
@media (prefers-color-scheme: dark) { :root { --bg:#15140f; --fg:#ece8dd; --muted:#a39d8f; --line:#2e2b23; --accent:#5fd0a5; --code:#221f18; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:860px; margin:0 auto; padding:40px 16px 64px; }
h1 { font-size:2rem; margin:0 0 8px; letter-spacing:-0.01em; }
h2 { font-size:1.15rem; margin:40px 0 12px; }
h3 { font-size:1rem; margin:0 0 6px; display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
h3.cat { display:block; margin:24px 0 8px; }
p { margin:0 0 12px; }
.lead { color:var(--muted); font-size:1.05rem; }
code { background:var(--code); padding:2px 6px; border-radius:4px; font:0.9em ui-monospace,Consolas,monospace; overflow-wrap:anywhere; }
table { width:100%; border-collapse:collapse; }
td, th { text-align:left; padding:8px 10px 8px 0; border-bottom:1px solid var(--line); vertical-align:top; }
.price, .path { white-space:nowrap; }
.price { color:var(--accent); font-weight:600; }
section { border-top:1px solid var(--line); padding:18px 0 6px; }
ul { margin:0 0 12px; padding-left:20px; }
a { color:var(--accent); overflow-wrap:anywhere; }
.ex, .note { color:var(--muted); font-size:0.92rem; }
.wrap { overflow-x:auto; }
pre { overflow-x:auto; padding:16px; border:1px solid var(--line); border-radius:6px; background:var(--code); white-space:pre; }
pre code { padding:0; background:transparent; }
.start { border:1px solid var(--line); border-radius:8px; padding:4px 18px 8px; margin:18px 0 26px; }
.start h2 { margin:14px 0 6px; font-size:1.1rem; } .start li { margin:8px 0; }
.install { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0 4px; } .install a { display:inline-block; padding:6px 12px; border:1px solid var(--line); border-radius:6px; text-decoration:none; font-weight:600; }
input,select,button{font:inherit;padding:8px;max-width:100%}label{display:inline-block;margin:6px 10px 6px 0}#reader-url{display:block;width:100%;min-width:min(600px,75vw)}#reader-builder-error{color:#b24430}button{cursor:pointer}nav a{line-height:2}${readerBuyingCss}</style>
</head>
<body>
<main>
<h1>${esc(SERVICE_NAME)}</h1>
<p class="lead">${esc(SERVICE_SUMMARY)}</p>
<section class="start" aria-label="Get started"><h2>Get started</h2><ol>
<li><strong>Try it free from Claude, Cursor or any MCP client.</strong> Add <code>${esc(origin)}/mcp</code> as a remote MCP server. The first 25 successful calls are free, and failed calls never count.
<div class="install"><a href="${esc(install.cursor)}">Add to Cursor</a><a href="${esc(install.vscode)}">Install in VS Code</a><a href="${esc(install.vscodeInsiders)}">VS Code Insiders</a></div>
Claude Code: <code>${esc(install.claudeCode)}</code>. Claude.ai and ChatGPT: add a custom connector with <code>${esc(install.claudeAi)}</code>. If your client limits how many tools it loads, add one section instead, such as <code>${esc(origin)}/mcp/web</code> or <code>/mcp/chain</code>.</li>
<li><strong>Pay by card, no wallet.</strong> <a href="/credits">Buy credits from $5</a> (5,000 credits; most tools cost 3). The key works over HTTP (<code>Authorization: Bearer adt_…</code>) and MCP.</li>
<li><strong>Agents with a wallet pay per call:</strong> x402 (USDC on Base and four more chains) or MPP (Tempo). Terms are in every 402; see <a href="/llms.txt">llms.txt</a>.</li>
</ol></section>
${readerBuyingHtml(origin, READER_VERSION, ENDPOINTS.length, demo)}
<p><a href="/guides/web-reading">Full reader guide, three-page research workflow and failure handling</a> · <a href="/guides/sitemap">Discover documentation URLs from a sitemap for $0.002</a> · Secondary tool: <a href="/guides/bitcoin-fees">Bitcoin fees for $0.002</a></p>

<h2 id="tools" tabindex="-1">Tools and prices: all ${ENDPOINTS.length}</h2>
${rows}

<h2>How paying works</h2>
<p>Call any endpoint. Without payment it answers <code>402 Payment Required</code> with a <code>PAYMENT-REQUIRED</code> header describing the price in USDC on Base (x402 v2, exact scheme) and a <code>WWW-Authenticate: Payment</code> challenge for MPP (USDC on Base or USDC.e on Tempo). An x402 client signs the payment and retries with a <code>PAYMENT-SIGNATURE</code> header; an MPP client (mppx) answers the challenge in <code>Authorization: Payment</code>. Calls that fail are not charged.</p>
<p>${esc(trialNote(trialsEnabled))}</p>
<p class="note">Payments go to <code>${esc(payTo)}</code> on Base.</p>
<p><strong>Speak OpenAI already?</strong> Point an OpenAI SDK at <code>${origin}/v1</code>: <code>POST /v1/chat/completions</code>, <code>POST /v1/responses</code> and <code>POST /v1/embeddings</code> run the same paid tools at the same prices (Llama 3.1 8B at ${catalogEndpoint(CHAT_TOOL_PATH).price}, Llama 3.3 70B or gpt-oss-120b at ${catalogEndpoint(CHAT_LARGE_TOOL_PATH).price} by model name, BGE-M3 embeddings at ${catalogEndpoint(EMBED_TOOL_PATH).price}). Pay with an x402 or MPP fetch wrapper, or use a card-credit key as the SDK apiKey. GET-only clients send the same inputs in the query (<code>/v1/chat/completions?prompt=…</code>).</p>
    <p><strong>No crypto wallet? Pay by card.</strong> <a href="/credits">Buy prepaid credits</a> ($5, $20 or $100) and get an API key; send it as <code>Authorization: Bearer adt_…</code> on any call or on the MCP server. Same prices, failed calls refunded.</p>

<h2>Advanced TypeScript client</h2>
<p>Install with <code>npm install @x402/fetch @x402/evm viem</code> and <code>npm install --save-dev typescript tsx @types/node</code>. Save this as <code>client.ts</code> and run <code>npx tsx client.ts</code>. It reads the private key only from the environment, pins Base, this service's recipient and Base USDC, and caps spend at the <code>/extract</code> price. It does not request a free trial. <code>/package-audit</code> costs $0.20 and is rejected by this lower cap.</p>
<pre class="client-example"><code>${esc(clientExample)}</code></pre>

<p class="note"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></p>

<h2>For agents and developers</h2>
<ul>
<li>MCP server (streamable HTTP): <code>${esc(origin)}/mcp</code>. Smaller servers, one per section: ${Object.keys(MCP_BUNDLES).map((slug) => `<code>/mcp/${slug}</code>`).join(", ")}</li>
<li><a href="/openapi.json">OpenAPI 3.1 description</a></li>
<li><a href="/status">Reliability: success rate and last success per tool over 7 days</a></li>
<li><a href="/llms.txt">llms.txt</a></li>
<li><a href="/.well-known/x402">x402 resource list</a></li>${EXTRA_LINKS.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join("")}
</ul>

<h2>Endpoint details</h2>
${details}
</main>
</body>
</html>`;
}

/**
 * EIP-191 signatures of the bare public origin ("https://agent-data-tools.revmesh2074.workers.dev")
 * by the PAY_TO wallet. x402scan and AgentCash read them from openapi.json and then list the
 * origin as ownership_verified. Produce one with scripts/sign-ownership-proof.mjs; a test
 * rejects any entry that does not recover to PAY_TO. Signatures are public, not secrets.
 */
export const OWNERSHIP_PROOFS: readonly string[] = [
  // Coinbase Wallet (EIP-7702 account) signature of the bare origin by PAY_TO, 2026-10-18. It is an
  // ERC-1271 wrapped signature, so CI verifies it on Base with scripts/check-ownership-proofs.mjs.
  "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000413e5f9cac8f7c1dfe7f44c5b57ddf3618682fffeeed033d842128e30775141f38083802e95f2cda9eea4002ececa24d1bdbc5ec23c58d4e2320d081840d38bad91c00000000000000000000000000000000000000000000000000000000000000",
];

type MppOffer = { mpp: { method: string; intent: string; currency: string } };
/** `mpp`: the MPP offers each tool also accepts (lib/mpp-evm.ts, lib/mpp-tempo.ts), declared next to x402 while on. */
export function openApi(origin: string, trialsEnabled = false, mpp: readonly MppOffer[] = []) {
  const guidance = `${GUIDANCE} ${clientGuidance()} ${trialNote(trialsEnabled)} No USDC wallet: buy card credits at ${origin}/credits and send the key as Authorization: Bearer adt_….`;
  return {
    openapi: "3.1.0",
    info: {
      title: SERVICE_NAME,
      version: MCP_SERVER_VERSION,
      description: SERVICE_SUMMARY,
      contact: { name: "SpellzCode support", email: SUPPORT_EMAIL, url: `${origin}/support` },
      termsOfService: `${origin}/terms`,
      "x-status": `${origin}/status`,
      "x-guidance": guidance,
      "x-card-credits": `${origin}/credits`,
    },
    externalDocs: { description: "Reader buying guide, real examples and capped CLI", url: `${origin}/guides/web-reading` },
    // Optional alternative to x402, so not applied as a requirement on any operation.
    components: { securitySchemes: { cardCredits: { type: "http", scheme: "bearer", description: `Optional: an adt_ API key bought by card at ${origin}/credits pays any call instead of x402.` } } },
    // x-agentcash-provenance is the current field; x-discovery is the older one some indexers still read.
    ...(OWNERSHIP_PROOFS.length
      ? { "x-agentcash-provenance": { ownershipProofs: [...OWNERSHIP_PROOFS] }, "x-discovery": { ownershipProofs: [...OWNERSHIP_PROOFS] } }
      : {}),
    servers: [{ url: origin }],
    paths: completeResponses({ ...openAiOpenApiPaths(origin, { small: catalogEndpoint(CHAT_TOOL_PATH).price, large: catalogEndpoint(CHAT_LARGE_TOOL_PATH).price }, mpp), ...openAiEmbeddingsOpenApiPath(origin, catalogEndpoint(EMBED_TOOL_PATH).price, mpp), ...openAiResponsesOpenApiPath(origin, { small: catalogEndpoint(CHAT_TOOL_PATH).price, large: catalogEndpoint(CHAT_LARGE_TOOL_PATH).price }, mpp), ...Object.fromEntries(
      salesOrdered(ENDPOINTS).map((e) => [
        e.path,
        {
          get: {
            operationId: mcpName(e.path),
            summary: e.summary,
            description: fullDescription(e as Endpoint),
            ...(e.path === "/sitemap" ? { externalDocs: { description: "Discover documentation URLs before choosing pages to read", url: `${origin}/guides/sitemap` } } : {}),
            ...(e.path === "/extract" ? { externalDocs: { description: "Read a public documentation page for $0.002", url: `${origin}/guides/web-reading` } } : {}),
            ...(e.path === "/package-audit" ? { externalDocs: { description: "Dependency audit buying guide and capped client", url: `${origin}/guides/dependency-audit` } } : {}),
            tags: e.tags,
            // Shape required by x402scan's discovery spec. Amount is decimal USD. x402 tooling keeps reading the
            // x402 entry; MPP directories (MPPScan) read the mpp one.
            "x-payment-info": paymentInfo({ amount: e.price }, mpp),
            parameters: Object.entries(e.params).map(([name, p]) => ({
              name,
              in: "query",
              required: p.required ?? false,
              description: p.description,
              schema: { type: p.type, ...(p.enum ? { enum: p.enum } : {}) },
              example: p.example,
            })),
            responses: {
              "200": {
                description: "Result",
                content: {
                  "application/json": {
                    schema: (e as Endpoint).outputSchema ?? schemaFromExample(e.outputExample),
                    example: e.outputExample,
                  },
                },
              },
              "402": { description: "Payment Required" },
              "400": { description: "Invalid input (not charged)" },
            },
          },
        },
      ]),
    ) }),
  };
}

type Operation = { responses?: Record<string, { description?: string; content?: Record<string, { schema?: unknown; example?: unknown }> }> };

/**
 * Every 200 an agent can be charged for describes its body: a GET variant without content takes its POST's 200, and
 * a 200 with only an example gets a schema derived from it (MPP discovery warns "output-schema-missing" otherwise).
 */
export function completeResponses<T extends Record<string, Record<string, unknown>>>(paths: T): T {
  for (const item of Object.values(paths)) {
    const get = item.get as Operation | undefined;
    const post = item.post as Operation | undefined;
    if (get?.responses?.["200"] && !get.responses["200"].content && post?.responses?.["200"]?.content) {
      get.responses["200"] = { ...post.responses["200"], description: get.responses["200"].description ?? post.responses["200"].description };
    }
    for (const op of Object.values(item) as Operation[]) {
      const json = op?.responses?.["200"]?.content?.["application/json"];
      if (json && !json.schema && json.example !== undefined) json.schema = schemaFromExample(json.example as Record<string, unknown>);
    }
  }
  return paths;
}

// Left out of marketplace listings: these run on a limited daily allowance, which a
// subscription plan with a monthly quota could exhaust.
import { CAPACITY_LIMITED } from "./lib/capacity";
import { CHAT_LARGE_TOOL_PATH, CHAT_TOOL_PATH, openAiOpenApiPaths } from "./lib/openai-chat";
import { EMBED_TOOL_PATH, openAiEmbeddingsOpenApiPath } from "./lib/openai-embeddings";
import { openAiResponsesOpenApiPath } from "./lib/openai-responses";
import { MODELS } from "./lib/ai";
import { paymentInfo } from "./lib/payment-info";
export { CAPACITY_LIMITED };

/** The same tools described for an API marketplace, where the marketplace handles payment. */
export function marketplaceOpenApi(origin: string, trialsEnabled = false) {
  const doc = openApi(origin, trialsEnabled);
  return {
    openapi: doc.openapi,
    info: {
      title: SERVICE_NAME,
      version: doc.info.version,
      description:
        "Everyday lookups in one API: currency exchange rates, weather, time zones, email validation, domain DNS and WHOIS, web page text extraction, package metadata and bounded dependency-risk signals, academic paper search, Bitcoin price, fees and address balances, Lightning invoice decoding, ENS names, and Base token, wallet, transaction and gas data. All endpoints are GET and return JSON.",
    },
    servers: doc.servers,
    paths: Object.fromEntries(
      // Tools only: the OpenAI-style /v1 paths are a front for the capacity-limited /ai/chat and stay out too.
      (Object.entries(doc.paths) as unknown as [string, { get: { "x-payment-info"?: unknown; responses: Record<string, unknown>; [key: string]: unknown } }][])
        .filter(([path]) => !CAPACITY_LIMITED.has(path) && !path.startsWith("/v1/"))
        .map(([path, item]) => {
          const { "x-payment-info": _payment, responses, ...get } = item.get;
          const { "402": _unpaid, ...rest } = responses;
          return [path, { get: { ...get, responses: { ...rest, "404": { description: "Not found" } } } }];
        }),
    ),
  };
}

export function llmsTxt(origin: string, trialsEnabled: boolean, payTo: string) {
  const clientExample = paymentClientExample(origin, payTo, "/extract", "url=https%3A%2F%2Fexample.com", "ordinary");
  const lines = [
    `# ${SERVICE_NAME}`,
    "",
    `> ${SERVICE_SUMMARY}`,
    "",
    "All endpoints are GET (a POST with a flat JSON body of the same inputs works too), return JSON, and cost a fixed price per successful call. An unpaid request returns HTTP 402 with a PAYMENT-REQUIRED header (x402 v2, exact scheme, USDC on Base) and a WWW-Authenticate: Payment challenge (MPP: evm/charge with USDC on Base, or tempo/charge with USDC.e on Tempo). Pay with x402 (sign and retry with PAYMENT-SIGNATURE) or with MPP (an mppx client answers the challenge in Authorization: Payment; the receipt comes back in Payment-Receipt). With mppx, tempo({ account }) pays the Tempo challenge as is; the evm method needs the token named, because a challenge cannot carry its EIP-712 name: charge({ account, currencies: [assets.base.USDC], networks: [8453] }) from mppx/evm/client. Failed calls (4xx/5xx) are not charged on either path.",
    "",
    trialNote(trialsEnabled),
    "",
    `No USDC wallet? Pay by card instead: buy prepaid credits at ${origin}/credits ($5 = 5,000 credits, $20 = 22,000, $100 = 125,000; 1 credit = $0.001, the same prices as x402). You get an API key; send it as \`Authorization: Bearer adt_…\` or \`X-API-Key\` on any tool call or on the MCP server, and no x402 payment is needed. Failed calls are refunded. Balance: ${origin}/credits/balance.`,
    "",
    `Start here: ${origin}/guides/web-reading.md (static web reading, capped HTTP and x402-capable MCP examples, $0.002 per call). Bitcoin fees: ${origin}/guides/bitcoin-fees.md ($0.002).`,
    "",
    `OpenAI-compatible chat: POST ${origin}/v1/chat/completions with the usual {"messages":[...]} body (model ${MODELS.text}, no streaming), same price and payment paths as /ai/chat (${catalogEndpoint(CHAT_TOOL_PATH).price}); model "llama-3.3-70b" or "gpt-oss-120b" routes to /ai/chat-large (${catalogEndpoint(CHAT_LARGE_TOOL_PATH).price}); POST ${origin}/v1/embeddings (one input string, BGE-M3, 1,024 dimensions) is the same front for /ai/embed (${catalogEndpoint(EMBED_TOOL_PATH).price}). POST ${origin}/v1/responses takes the OpenAI Responses shape (input, instructions, max_output_tokens) for the same models and prices. GET ${origin}/v1/models is free. Each of the three also answers GET with the same inputs in the query (prompt= or input=, plus system/instructions, model, max_tokens, temperature) for clients that cannot POST. Proven recipe with the official SDK: new OpenAI({ baseURL: "${origin}/v1", apiKey: "x402", fetch: wrapFetchWithPayment(fetch, client) }) with the @x402/fetch client from the example below; or set apiKey to a card-credit key (adt_…) from ${origin}/credits and no wrapper is needed.`,
    "",
    "Smaller answers: add only=<comma-separated top-level keys> to any tool (for example /btc-fees?only=fastestFee); unknown keys are ignored and no match returns the full result.",
    "",
    `Local MCP adapter: ${origin}/guides/local-mcp.md; download ${origin}/clients/reader/${READER_VERSION}/reader-mcp.mjs. Quotes only by default; explicit paid mode requires a bounded session allowance and per-call maxUsdc. No automatic retries.`,
    "",
    `Portable buyer skill: ${origin}/skills/spellzcode-x402-reader/SKILL.md. Read ${origin}/skills/index.json for installation context; publishing it does not install or authorize spending.`,
    "",
    `Read a specific HTML heading/container with optional section=<exact-id> on /extract, --section on the CLI, or section in local/remote MCP. Scope is explicit in result.section. URL fragments alone do not select. Missing/ambiguous targets fail before settlement. Cached proof: ${origin}/examples/extract/section-result.json.`,
    "",
    `Discover documentation URLs first: ${origin}/guides/sitemap.md. The current standalone client supports quote-sitemap and buy-sitemap with --contains, --max-urls and --offset; each explicit buy remains capped at $0.002.`,
    "",
    `Secondary Bitcoin fee-data entry: node reader-client.mjs quote-btc-fees, then an authorized buy-btc-fees --max-usdc 0.002. No URL or Bitcoin key. Local MCP uses btc_fees_quote/btc_fees_buy under the same process cap as reader/sitemap calls. This buys data in Base USDC, never sends Bitcoin. Guide: ${origin}/guides/bitcoin-fees.md.`,
    "",
    `Dependency audit buying guide: ${origin}/guides/dependency-audit.md (up to 10 pinned package versions, ${catalogEndpoint("/package-audit").price} USDC per successful request; dedicated capped client included).`,
    "",
    "## Buy a static page with the standalone Node CLI",
    "",
    `Download: ${origin}/clients/reader/${READER_VERSION}/reader-client.mjs`,
    `Verify just the CLI download: ${origin}/clients/reader/${READER_VERSION}/reader-client.mjs.sha256. Instructions: ${origin}/guides/web-reading.md. The complete SHA256SUMS list covers all artifacts and requires those files when checked in full.`,
    `Inspect real cached outputs first: ${origin}/examples/extract/manifest.json (demonstrations, not customer receipts).`,
    "Requires Node.js 20.19 or newer. No package installation or TypeScript required.",
    "```sh",
    "node reader-client.mjs quote https://example.com --format both",
    "node reader-client.mjs buy https://example.com --max-usdc 0.002 --format both",
    "```",
    "Quote needs no key and never signs. Buy requires an existing funded Base wallet via X402_PRIVATE_KEY and an explicit positive cap of at most 0.002 USDC. Both support --format text|markdown|both and --max-chars 500..100000. The client pins this service, recipient, native Base USDC and exact payment terms. At most one authorization per invocation; never automatically retry an unknown payment outcome. Keys remain on the buyer device.",
    "Static public HTML/plain text only; no JavaScript rendering, login or paywall access. Input limit 2 MiB, default output 20,000 characters with explicit truncation. Ordinary MCP discovery does not pay automatically.",
    "",
    "## Advanced TypeScript x402 client",
    "",
    `The example below pins Base, this service's PAY_TO recipient and Base USDC, and caps each payment at ${exampleSpendCap().price}, the ordinary per-call price, so it pays for every tool priced at ${exampleSpendCap().price} or less (/extract costs ${catalogEndpoint("/extract").price}). /package-audit costs ${catalogEndpoint("/package-audit").price}; this example intentionally refuses that higher price. It never sends trial=1.`,
    "",
    "Install with `npm install @x402/fetch @x402/evm viem` and `npm install --save-dev typescript tsx @types/node`. Save as `client.ts` and run `npx tsx client.ts`. Set `X402_PRIVATE_KEY` in a secret manager or process environment; never paste it into source or commit it.",
    "",
    "```typescript",
    clientExample,
    "```",
    "",
    "## Start here",
    "",
    // The tools paying agents pick first, in the same order as /discovery/resources.
    ...salesOrdered(ENDPOINTS).slice(0, 12).map((e) => `- GET ${origin}${e.path} (${e.price}): ${e.summary}`),
    "",
    "## Endpoints",
    "",
    ...byCategory().flatMap((g) => [`### ${g.name}`, "", ...salesOrdered(g.tools).flatMap((e) => [
      `#### GET ${e.path} — ${e.price}`,
      fullDescription(e as Endpoint),
      ...Object.entries(e.params).map(([k, p]) => `- \`${k}\` (${p.type}${p.required ? ", required" : ""}): ${p.description}`),
      `Example: ${origin}${e.path}?${exampleQuery(e)}`,
      "",
    ])]),
    "## Machine-readable",
    "",
    `- MCP server (streamable HTTP, same tools and prices): ${origin}/mcp`,
    `- Smaller MCP servers, one per section: ${Object.entries(MCP_BUNDLES).map(([slug, title]) => `${origin}/mcp/${slug} (${title}, ${mcpBundleTools(slug)!.length} tools)`).join("; ")}`,
    `- [OpenAPI 3.1](${origin}/openapi.json)`,
    `- [Reliability per tool, last 7 days](${origin}/status)`,
    `- [Service card](${origin}/)`,
    `- [x402 resource list](${origin}/.well-known/x402)`,
    ...EXTRA_LINKS.map((l) => `- [${l.label}](${origin}${l.href})`),
  ];
  return lines.join("\n");
}

export const robotsTxt = (origin: string) =>
  ["User-agent: *", "Allow: /", "Disallow: /*trial=1", "Content-Signal: ai-train=no, search=yes, ai-input=yes", "", `Sitemap: ${origin}/sitemap.xml`].join("\n");

/** Index only owned, free documentation and demonstrations, never payment URLs. */
export function sitemapXml(origin: string) {
  const paths = ["/", "/tools", ...ENDPOINTS.map((e) => `/tools/${toolSlug(e.path)}`), "/guides/web-reading", "/guides/bitcoin-fees", "/guides/dependency-audit", "/guides/sitemap", "/guides/local-mcp", "/skills/spellzcode-x402-reader/SKILL.md", "/examples/extract/"];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${esc(origin + path)}</loc></url>`).join("")}</urlset>`;
}
