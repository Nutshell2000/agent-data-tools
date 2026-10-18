import { readerBuyingCss, readerBuyingHtml, type ReaderDemo } from "./guides/reader-buying";
import { AI_PATHS } from "./routes/ai-text";
import { ENDPOINTS, EXTRA_LINKS, GUIDANCE, SERVICE_ID, SERVICE_NAME, SERVICE_SUMMARY, SUPPORT_EMAIL, type Endpoint } from "./endpoints";
import { schemaFromExample } from "./lib/output-schema";

export * from "./endpoints";

/** Version of the MCP tool catalog (server.json and serverInfo); raised when tools are added or changed. */
export const MCP_SERVER_VERSION = "1.20.0";
/** Version of the downloadable reader client under /clients/reader/ (package.json version). */
export const READER_VERSION = "1.7.6";

// Always carries at least one parameter so "path?query" stays well-formed.
const exampleQuery = (e: Endpoint) =>
  Object.entries(e.params)
    .filter(([, p]) => p.required)
    .map(([k, p]) => `${k}=${encodeURIComponent(String(p.example))}`)
    .join("&") || "format=json";

const trialNote = (enabled: boolean) =>
  enabled
    ? "Free trial: add trial=1 to a GET request for a free call, up to 10 per caller per day and 1,000 total per day. This opt-in can be disabled by the service operator."
    : "Free trials are disabled. Requests with trial=1 receive the normal 402 payment challenge.";

export function serviceCard(origin: string, payTo: string, network: string) {
  return {
    name: SERVICE_NAME,
    description: SERVICE_SUMMARY,
    payment: { protocol: "x402", version: 2, scheme: "exact", network, asset: "USDC", payTo },
    endpoints: ENDPOINTS.map((e) => ({
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
export function mcpServerCard(origin: string) {
  return {
    serverInfo: { name: SERVICE_ID, title: SERVICE_NAME, version: MCP_SERVER_VERSION },
    description: SERVICE_SUMMARY,
    transport: { type: "streamable-http", endpoint: `${origin}/mcp` },
    capabilities: { tools: { listChanged: false } },
    authentication: { required: false },
    payment: { protocol: "x402", asset: "USDC", network: "base" },
    tools: ENDPOINTS.map((e) => ({ name: e.path.slice(1).replaceAll("/", "_"), description: e.summary, price: e.price, ...("outputSchema" in e ? { outputSchema: e.outputSchema } : {}) })),
  };
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

const exampleSpendCap = () => endpointSpendCap("/extract");

export function paymentClientExample(origin: string, payTo: string, path = "/extract", query = "url=https%3A%2F%2Fexample.com") {
  const cap = endpointSpendCap(path);
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
    `const maxUsdcAtomic = ${cap.atomic}n; // ${cap.price} USDC, the current ${path} price`,
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
  const entryPrice = exampleSpendCap().price;
  const packageAuditPrice = catalogEndpoint("/package-audit").price;
  return `Start with /guides/web-reading and the bundled Node CLI at /clients/reader/${READER_VERSION}/reader-client.mjs; quote needs no key and never signs, while buy requires an explicit cap. Cached examples: /examples/extract/manifest.json. The homepage and llms.txt also include a TypeScript x402 client example pinned to Base, this service's PAY_TO recipient and Base USDC. It caps each payment at the current /extract price (${entryPrice}); /package-audit costs ${packageAuditPrice} and is intentionally rejected by that example.`;
}

/** Human-readable front page for people arriving from a directory listing. */
export function homePage(origin: string, payTo: string, trialsEnabled = false, demo?: ReaderDemo) {
  const clientExample = paymentClientExample(origin, payTo);
  const rows = ENDPOINTS.map(
    (e) => `<tr><td class="path"><a href="#tool-${esc(e.path.slice(1).replaceAll("/", "_"))}"><code>${esc(e.path)}</code></a></td><td>${esc(e.summary)}</td><td class="price">${esc(e.price)}</td></tr>`,
  ).join("");
  const details = ENDPOINTS.map((e) => {
    const params = Object.entries(e.params)
      .map(([k, p]) => `<li><code>${esc(k)}</code>${p.required ? " (required)" : ""}: ${esc(p.description)}</li>`)
      .join("");
    const query = exampleQuery(e);
    // Keep the trial opt-in limited to human-facing homepage links; machine-readable
    // discovery examples should continue to trigger the normal 402 challenge.
    const example = `${origin}${e.path}?${query}${trialsEnabled ? "&trial=1" : ""}`;
    const exampleLabel = trialsEnabled ? "Try free once" : "Example";
    return `<section id="tool-${esc(e.path.slice(1).replaceAll("/", "_"))}"><h3><code>GET ${esc(e.path)}</code> <span class="price">${esc(e.price)}</span></h3><p>${esc((e as Endpoint).details ?? e.description)}</p><ul>${params}</ul><p class="ex">Example: <a href="${esc(example)}">${exampleLabel}</a> — <code>${esc(example)}</code></p></section>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ENDPOINTS.length} pay-per-call tools for AI agents, from $0.001 | SpellzCode</title>
<link rel="canonical" href="${esc(origin)}/">
<meta name="description" content="${esc(SERVICE_SUMMARY)}">
<style>
:root { --bg:#fbfaf7; --fg:#1d1b16; --muted:#6b665c; --line:#e3ded3; --accent:#0b6e4f; --code:#f1ede4; }
@media (prefers-color-scheme: dark) { :root { --bg:#15140f; --fg:#ece8dd; --muted:#a39d8f; --line:#2e2b23; --accent:#5fd0a5; --code:#221f18; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:860px; margin:0 auto; padding:40px 16px 64px; }
h1 { font-size:2rem; margin:0 0 8px; letter-spacing:-0.01em; }
h2 { font-size:1.15rem; margin:40px 0 12px; }
h3 { font-size:1rem; margin:0 0 6px; display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; }
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
input,select,button{font:inherit;padding:8px;max-width:100%}label{display:inline-block;margin:6px 10px 6px 0}#reader-url{display:block;width:100%;min-width:min(600px,75vw)}#reader-builder-error{color:#b24430}button{cursor:pointer}nav a{line-height:2}${readerBuyingCss}</style>
</head>
<body>
<main>
<h1>${esc(SERVICE_NAME)}</h1>
<p class="lead">${esc(SERVICE_SUMMARY)}</p>
${readerBuyingHtml(origin, READER_VERSION, ENDPOINTS.length, demo)}
<p><a href="/guides/web-reading">Full reader guide, three-page research workflow and failure handling</a> · <a href="/guides/sitemap">Discover documentation URLs from a sitemap for $0.002</a> · Secondary tool: <a href="/guides/bitcoin-fees">Bitcoin fees for $0.002</a></p>

<h2 id="tools" tabindex="-1">Tools and prices: all ${ENDPOINTS.length}</h2>
<div class="wrap"><table><tr><th>Endpoint</th><th>What it does</th><th>Price</th></tr>${rows}</table></div>

<h2>How paying works</h2>
<p>Call any endpoint. Without payment it answers <code>402 Payment Required</code> with a <code>PAYMENT-REQUIRED</code> header describing the price in USDC on Base (x402 v2, exact scheme). An x402 client signs the payment and retries with a <code>PAYMENT-SIGNATURE</code> header. Calls that fail are not charged.</p>
<p>${esc(trialNote(trialsEnabled))}</p>
<p class="note">Payments go to <code>${esc(payTo)}</code> on Base.</p>

<h2>Advanced TypeScript client</h2>
<p>Install with <code>npm install @x402/fetch @x402/evm viem</code> and <code>npm install --save-dev typescript tsx @types/node</code>. Save this as <code>client.ts</code> and run <code>npx tsx client.ts</code>. It reads the private key only from the environment, pins Base, this service's recipient and Base USDC, and caps spend at the <code>/extract</code> price. It does not request a free trial. <code>/package-audit</code> costs $0.20 and is rejected by this lower cap.</p>
<pre class="client-example"><code>${esc(clientExample)}</code></pre>

<h2>For agents and developers</h2>
<ul>
<li>MCP server (streamable HTTP): <code>${esc(origin)}/mcp</code></li>
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

export function openApi(origin: string, trialsEnabled = false) {
  const guidance = `${GUIDANCE} ${clientGuidance()} ${trialNote(trialsEnabled)}`;
  return {
    openapi: "3.1.0",
    info: {
      title: SERVICE_NAME,
      version: MCP_SERVER_VERSION,
      description: SERVICE_SUMMARY,
      contact: { name: "SpellzCode support", email: SUPPORT_EMAIL },
      "x-status": `${origin}/status`,
      "x-guidance": guidance,
    },
    externalDocs: { description: "Reader buying guide, real examples and capped CLI", url: `${origin}/guides/web-reading` },
    servers: [{ url: origin }],
    paths: Object.fromEntries(
      ENDPOINTS.map((e) => [
        e.path,
        {
          get: {
            operationId: e.path.slice(1).replaceAll("/", "_"),
            summary: e.summary,
            description: (e as Endpoint).details ?? e.description,
            ...(e.path === "/sitemap" ? { externalDocs: { description: "Discover documentation URLs before choosing pages to read", url: `${origin}/guides/sitemap` } } : {}),
            ...(e.path === "/extract" ? { externalDocs: { description: "Read a public documentation page for $0.002", url: `${origin}/guides/web-reading` } } : {}),
            ...(e.path === "/package-audit" ? { externalDocs: { description: "Dependency audit buying guide and capped client", url: `${origin}/guides/dependency-audit` } } : {}),
            tags: e.tags,
            // Shape required by x402scan's discovery spec. Amount is decimal USD.
            "x-payment-info": {
              price: { mode: "fixed", currency: "USD", amount: e.price.replace("$", "") },
              protocols: [{ x402: {} }],
            },
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
    ),
  };
}

// Left out of marketplace listings: these run on a limited daily allowance, which a
// subscription plan with a monthly quota could exhaust.
export const CAPACITY_LIMITED =new Set(["/summarize", "/screenshot", "/image", "/transcribe", "/describe", "/search", ...AI_PATHS]);

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
      Object.entries(doc.paths)
        .filter(([path]) => !CAPACITY_LIMITED.has(path))
        .map(([path, item]) => {
          const { "x-payment-info": _payment, responses, ...get } = item.get;
          const { "402": _unpaid, ...rest } = responses;
          return [path, { get: { ...get, responses: { ...rest, "404": { description: "Not found" } } } }];
        }),
    ),
  };
}

export function llmsTxt(origin: string, trialsEnabled: boolean, payTo: string) {
  const clientExample = paymentClientExample(origin, payTo);
  const lines = [
    `# ${SERVICE_NAME}`,
    "",
    `> ${SERVICE_SUMMARY}`,
    "",
    "All endpoints are GET, return JSON, and cost a fixed price per successful call. An unpaid request returns HTTP 402 with a PAYMENT-REQUIRED header (x402 v2, exact scheme, USDC on Base). Sign the payment and retry with the PAYMENT-SIGNATURE header. Failed calls (4xx/5xx) are not charged.",
    "",
    trialNote(trialsEnabled),
    "",
    `Start here: ${origin}/guides/web-reading.md (static web reading, capped HTTP and x402-capable MCP examples, $0.002 per call). Bitcoin fees: ${origin}/guides/bitcoin-fees.md ($0.002).`,
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
    `The example below pins Base, this service's PAY_TO recipient and Base USDC, and caps each payment at the current /extract price (${exampleSpendCap().price}). /package-audit costs ${catalogEndpoint("/package-audit").price}; this example intentionally refuses that higher price. It never sends trial=1.`,
    "",
    "Install with `npm install @x402/fetch @x402/evm viem` and `npm install --save-dev typescript tsx @types/node`. Save as `client.ts` and run `npx tsx client.ts`. Set `X402_PRIVATE_KEY` in a secret manager or process environment; never paste it into source or commit it.",
    "",
    "```typescript",
    clientExample,
    "```",
    "",
    "## Endpoints",
    "",
    ...ENDPOINTS.flatMap((e) => [
      `### GET ${e.path} — ${e.price}`,
      (e as Endpoint).details ?? e.description,
      ...Object.entries(e.params).map(([k, p]) => `- \`${k}\` (${p.type}${p.required ? ", required" : ""}): ${p.description}`),
      `Example: ${origin}${e.path}?${exampleQuery(e)}`,
      "",
    ]),
    "## Machine-readable",
    "",
    `- MCP server (streamable HTTP, same tools and prices): ${origin}/mcp`,
    `- [OpenAPI 3.1](${origin}/openapi.json)`,
    `- [Reliability per tool, last 7 days](${origin}/status)`,
    `- [Service card](${origin}/)`,
    `- [x402 resource list](${origin}/.well-known/x402)`,
    ...EXTRA_LINKS.map((l) => `- [${l.label}](${origin}${l.href})`),
  ];
  return lines.join("\n");
}

export const robotsTxt = (origin: string) =>
  ["User-agent: *", "Allow: /", "Content-Signal: ai-train=no, search=yes, ai-input=yes", "", `Sitemap: ${origin}/sitemap.xml`].join("\n");

/** Index only owned, free documentation and demonstrations, never payment URLs. */
export function sitemapXml(origin: string) {
  const paths = ["/", "/guides/web-reading", "/guides/bitcoin-fees", "/guides/dependency-audit", "/guides/sitemap", "/guides/local-mcp", "/skills/spellzcode-x402-reader/SKILL.md", "/examples/extract/"];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${esc(origin + path)}</loc></url>`).join("")}</urlset>`;
}
