import { ENDPOINTS, EXTRA_LINKS, GUIDANCE, SERVICE_ID, SERVICE_NAME, SERVICE_SUMMARY, TRIALS_ENABLED, type Endpoint } from "./endpoints";

export * from "./endpoints";

// Always carries at least one parameter so "path?query" stays well-formed.
const exampleQuery = (e: Endpoint) =>
  Object.entries(e.params)
    .filter(([, p]) => p.required)
    .map(([k, p]) => `${k}=${encodeURIComponent(String(p.example))}`)
    .join("&") || "format=json";

// Empty when trials are off, so the pages never advertise something that isn't there.
export const TRIAL_NOTE = TRIALS_ENABLED
  ? "Free trial: add trial=1 to any GET request for a free call, up to 3 per caller per day while the daily trial pool lasts. Without it, unpaid requests get the 402 challenge."
  : "";

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
    docs: { openapi: `${origin}/openapi.json`, llms: `${origin}/llms.txt`, mcp: `${origin}/mcp` },
  };
}

/** Advertises the MCP endpoint to clients that look for a server card. */
export function mcpServerCard(origin: string) {
  return {
    serverInfo: { name: SERVICE_ID, title: SERVICE_NAME, version: "1.0.0" },
    description: SERVICE_SUMMARY,
    transport: { type: "streamable-http", endpoint: `${origin}/mcp` },
    capabilities: { tools: { listChanged: false } },
    authentication: { required: false },
    payment: { protocol: "x402", asset: "USDC", network: "base" },
    tools: ENDPOINTS.map((e) => ({ name: e.path.slice(1), description: e.summary, price: e.price })),
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

/** Human-readable front page for people arriving from a directory listing. */
export function homePage(origin: string, payTo: string) {
  const rows = ENDPOINTS.map(
    (e) => `<tr><td class="path"><code>${esc(e.path)}</code></td><td>${esc(e.summary)}</td><td class="price">${esc(e.price)}</td></tr>`,
  ).join("");
  const details = ENDPOINTS.map((e) => {
    const params = Object.entries(e.params)
      .map(([k, p]) => `<li><code>${esc(k)}</code>${p.required ? " (required)" : ""}: ${esc(p.description)}</li>`)
      .join("");
    const example = `${origin}${e.path}?${exampleQuery(e)}`;
    return `<section><h3><code>GET ${esc(e.path)}</code> <span class="price">${esc(e.price)}</span></h3><p>${esc(e.description)}</p><ul>${params}</ul><p class="ex">Example: <a href="${esc(example)}">${esc(example)}</a></p></section>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(SERVICE_NAME)}</title>
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
</style>
</head>
<body>
<main>
<h1>${esc(SERVICE_NAME)}</h1>
<p class="lead">${esc(SERVICE_SUMMARY)}</p>

<h2>Tools and prices</h2>
<div class="wrap"><table><tr><th>Endpoint</th><th>What it does</th><th>Price</th></tr>${rows}</table></div>

<h2>How paying works</h2>
<p>Call any endpoint. Without payment it answers <code>402 Payment Required</code> with a <code>PAYMENT-REQUIRED</code> header describing the price in USDC on Base (x402 v2, exact scheme). An x402 client signs the payment and retries with a <code>PAYMENT-SIGNATURE</code> header. Calls that fail are not charged.</p>
<p>${esc(TRIAL_NOTE)}</p>
<p class="note">Payments go to <code>${esc(payTo)}</code> on Base.</p>

<h2>For agents and developers</h2>
<ul>
<li>MCP server (streamable HTTP): <code>${esc(origin)}/mcp</code></li>
<li><a href="/openapi.json">OpenAPI 3.1 description</a></li>
<li><a href="/llms.txt">llms.txt</a></li>
<li><a href="/.well-known/x402">x402 resource list</a></li>${EXTRA_LINKS.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join("")}
</ul>

<h2>Endpoint details</h2>
${details}
</main>
</body>
</html>`;
}

export function openApi(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: SERVICE_NAME,
      version: "1.0.0",
      description: SERVICE_SUMMARY,
      "x-guidance": GUIDANCE + TRIAL_NOTE,
    },
    servers: [{ url: origin }],
    paths: Object.fromEntries(
      ENDPOINTS.map((e) => [
        e.path,
        {
          get: {
            operationId: e.path.slice(1),
            summary: e.summary,
            description: e.description,
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
              schema: { type: p.type },
              example: p.example,
            })),
            responses: {
              "200": {
                description: "Result",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: Object.fromEntries(
                        Object.entries(e.outputExample).map(([k, v]) => [
                          k,
                          { type: v === null ? ["string", "null"] : Array.isArray(v) ? "array" : typeof v },
                        ]),
                      ),
                    },
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

export function llmsTxt(origin: string) {
  const lines = [
    `# ${SERVICE_NAME}`,
    "",
    `> ${SERVICE_SUMMARY}`,
    "",
    "All endpoints are GET, return JSON, and cost a fixed price per successful call. An unpaid request returns HTTP 402 with a PAYMENT-REQUIRED header (x402 v2, exact scheme, USDC on Base). Sign the payment and retry with the PAYMENT-SIGNATURE header. Failed calls (4xx/5xx) are not charged.",
    "",
    TRIAL_NOTE,
    "",
    "## Endpoints",
    "",
    ...ENDPOINTS.flatMap((e) => [
      `### GET ${e.path} — ${e.price}`,
      e.description,
      ...Object.entries(e.params).map(([k, p]) => `- \`${k}\` (${p.type}${p.required ? ", required" : ""}): ${p.description}`),
      `Example: ${origin}${e.path}?${exampleQuery(e)}`,
      "",
    ]),
    "## Machine-readable",
    "",
    `- MCP server (streamable HTTP, same tools and prices): ${origin}/mcp`,
    `- [OpenAPI 3.1](${origin}/openapi.json)`,
    `- [Service card](${origin}/)`,
    `- [x402 resource list](${origin}/.well-known/x402)`,
    ...EXTRA_LINKS.map((l) => `- [${l.label}](${origin}${l.href})`),
  ];
  return lines.join("\n");
}

export const robotsTxt = (origin: string) =>
  ["User-agent: *", "Allow: /", "Content-Signal: ai-train=no, search=yes, ai-input=yes", "", `Sitemap: ${origin}/llms.txt`].join("\n");
