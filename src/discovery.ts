export const SERVICE_NAME = "Agent Data Tools";
export const SERVICE_SUMMARY =
  "Pay-per-call tools for AI agents: web page text extraction and summaries, screenshots, image generation, speech-to-text, image description, domain and email-auth intelligence, and live Base token and wallet lookups. No account or API key; pay per request in USDC on Base via x402.";

interface Param {
  type: "string" | "integer";
  description: string;
  required?: boolean;
  example: string | number;
}

export interface Endpoint {
  path: string;
  price: string;
  summary: string;
  /** Shown in x402 directories. Must stay under 500 characters. */
  description: string;
  tags: string[];
  params: Record<string, Param>;
  outputExample: Record<string, unknown>;
}

export const ENDPOINTS: Endpoint[] = [
  {
    path: "/extract",
    price: "$0.002",
    summary: "Web page to clean text",
    description:
      "Fetch any public web page and get clean readable text for LLM input: title, meta description, language, canonical URL, H1-H3 headings, main body text with navigation, scripts and boilerplate removed, and the page's outbound links. Use for web scraping, article reading, research and RAG ingestion.",
    tags: ["web", "scraping", "extract", "text", "rag"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of the page to fetch", required: true, example: "https://example.com" },
      maxChars: { type: "integer", description: "Maximum characters of body text to return (500-100000, default 20000)", example: 20000 },
    },
    outputExample: {
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      title: "Example Domain",
      description: null,
      lang: "en",
      headings: [],
      text: "This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.",
      textLength: 156,
      truncated: false,
      links: [],
    },
  },
  {
    path: "/domain",
    price: "$0.005",
    summary: "Domain DNS, registration age and email authentication",
    description:
      "Domain intelligence in one call: DNS records (A, AAAA, CNAME, MX, NS, TXT, CAA), DNSSEC status, registrar, registration and expiry dates with domain age in days (RDAP/WHOIS), and email authentication (SPF and DMARC records and policies, whether the domain accepts mail). Use for lead qualification, phishing and trust checks, and deliverability audits.",
    tags: ["domain", "dns", "whois", "email", "security"],
    params: {
      name: { type: "string", description: "Domain name, e.g. cloudflare.com", required: true, example: "cloudflare.com" },
    },
    outputExample: {
      domain: "cloudflare.com",
      exists: true,
      dns: {
        a: ["104.16.132.229", "104.16.133.229"],
        mx: [{ priority: 5, host: "mxa-canary.global.inbound.cf-emailsecurity.net" }],
        ns: ["ns3.cloudflare.com", "ns4.cloudflare.com"],
        dnssecValidated: true,
      },
      email: { acceptsMail: true, spfPolicy: "-all", dmarcPolicy: "reject" },
      registration: {
        registrableDomain: "cloudflare.com",
        registrar: "Cloudflare, Inc.",
        registeredAt: "2009-02-17T22:07:54Z",
        expiresAt: "2033-02-17T22:07:54Z",
        ageDays: 6441,
        dnssecSigned: true,
      },
    },
  },
  {
    path: "/token",
    price: "$0.01",
    summary: "Base ERC-20 token facts and risk flags",
    description:
      "Live on-chain facts for any ERC-20 token on Base: name, symbol, decimals, total supply, owner address and whether ownership is renounced, paused state, proxy detection (EIP-1967 and minimal proxy) with implementation and admin addresses, and bytecode heuristics for mint, pause, blacklist and fee-setter functions. Use for token due diligence and rug-pull or honeypot screening before a swap.",
    tags: ["base", "token", "erc20", "security", "onchain"],
    params: {
      address: { type: "string", description: "Token contract address on Base (0x...)", required: true, example: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    },
    outputExample: {
      chain: "base",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
      totalSupplyFormatted: "4333612020.876957",
      owner: "0x3ABd6f64A422225E61E435baE41db12096106df7",
      ownershipRenounced: false,
      paused: false,
      proxy: {
        isProxy: true,
        kind: "zeppelinos-legacy",
        implementation: "0x2ce6311ddae708829bc0784c967b7d77d19fd779",
        admin: "0x4fc7850364958d97b4d3f5a08f79db2493f8ca44",
      },
      capabilities: { mint: false, burn: false, pause: false, blacklist: false, feeSetter: false },
    },
  },
  {
    path: "/wallet",
    price: "$0.005",
    summary: "Base wallet balances snapshot",
    description:
      "Live snapshot of any address on Base: ETH balance, balances of major tokens (USDC, WETH, cbBTC, DAI, USDbC, cbETH, AERO, EURC) plus up to 20 extra token addresses you pass, transaction count, and whether the address is an EOA, a smart contract or an EIP-7702 delegated account. Use for portfolio checks, counterparty screening and payment verification.",
    tags: ["base", "wallet", "balance", "portfolio", "onchain"],
    params: {
      address: { type: "string", description: "Wallet or contract address on Base (0x...)", required: true, example: "0x4200000000000000000000000000000000000006" },
      tokens: { type: "string", description: "Optional comma-separated extra ERC-20 addresses to check (max 20)", example: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" },
    },
    outputExample: {
      chain: "base",
      address: "0x4200000000000000000000000000000000000006",
      type: "contract",
      eth: { wei: "286016330790748434767802", formatted: "286016.330790748434767802" },
      transactionCount: 0,
      tokens: [
        { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, balance: "167551481", balanceFormatted: "167.551481" },
      ],
    },
  },
  {
    path: "/summarize",
    price: "$0.01",
    summary: "Summarize a web page",
    description:
      "Give a URL, get a short summary of the page plus three to six key points, ready to drop into an agent's context. Fetches the page, strips navigation and boilerplate, and summarizes the main text with an LLM. Use for research, news triage, link previews and deciding whether a page is worth reading in full.",
    tags: ["summary", "web", "llm", "research", "text"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of the page to summarize", required: true, example: "https://en.wikipedia.org/wiki/HTTP_402" },
    },
    outputExample: {
      url: "https://en.wikipedia.org/wiki/List_of_HTTP_status_codes",
      title: "List of HTTP status codes - Wikipedia",
      lang: "en",
      summary: "The page lists HTTP response status codes and what each one means, grouped into five classes.",
      keyPoints: ["1xx codes are informational", "402 Payment Required is reserved for future use"],
      sourceChars: 12000,
      sourceTruncated: true,
    },
  },
  {
    path: "/screenshot",
    price: "$0.02",
    summary: "Screenshot of a web page",
    description:
      "Render any public web page in a real headless Chrome browser, with JavaScript executed, and get a JPEG screenshot (1280 px wide, base64) plus the final URL, HTTP status and page title. Set fullPage=true to capture up to 4000 px of page height. Use for visual checks, page previews, monitoring and feeding pages to vision models.",
    tags: ["screenshot", "browser", "render", "web", "image"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of the page to capture", required: true, example: "https://example.com" },
      fullPage: { type: "string", description: "Set to true to capture the full page height (max 4000 px) instead of the 1280x800 viewport", example: "true" },
    },
    outputExample: {
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      title: "Example Domain",
      width: 1280,
      height: 800,
      contentType: "image/jpeg",
      imageBase64: "/9j/4AAQSkZJRgABAQAAAQABAAD...",
    },
  },
  {
    path: "/image",
    price: "$0.02",
    summary: "Generate an image from a text prompt",
    description:
      "Text-to-image generation with FLUX.1 schnell. Send a prompt, get a 1024x1024 JPEG back as base64 in a few seconds. Use for illustrations, thumbnails, mockups, avatars and social media images. Optional steps parameter (1-8, default 4) trades speed for detail.",
    tags: ["image", "generation", "flux", "ai", "art"],
    params: {
      prompt: { type: "string", description: "What the image should show (3-800 characters)", required: true, example: "a lighthouse on a cliff at sunset, watercolor" },
      steps: { type: "integer", description: "Diffusion steps, 1-8 (default 4)", example: 4 },
    },
    outputExample: {
      prompt: "a lighthouse on a cliff at sunset, watercolor",
      steps: 4,
      model: "@cf/black-forest-labs/flux-1-schnell",
      contentType: "image/jpeg",
      imageBase64: "/9j/4AAQSkZJRgABAQAAAQABAAD...",
    },
  },
  {
    path: "/transcribe",
    price: "$0.02",
    summary: "Speech to text for an audio file",
    description:
      "Transcribe speech from an audio file at a public URL using Whisper large-v3-turbo. Returns the transcript text, detected language, duration and word count. Accepts common formats such as MP3, WAV, M4A and OGG up to 5 MB. Use for voice notes, podcast clips, meeting snippets and voice messages.",
    tags: ["audio", "transcription", "whisper", "speech", "ai"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of an audio file (max 5 MB)", required: true, example: "https://commons.wikimedia.org/wiki/Special:FilePath/En-us-hello.ogg" },
    },
    outputExample: {
      url: "https://commons.wikimedia.org/wiki/Special:FilePath/En-us-hello.ogg",
      text: "Hello!",
      language: "en",
      durationSeconds: 0.487625,
      wordCount: 1,
      model: "@cf/openai/whisper-large-v3-turbo",
    },
  },
  {
    path: "/describe",
    price: "$0.01",
    summary: "Describe or question an image",
    description:
      "Vision model for an image at a public URL: get a detailed description including any visible text, or pass a question to ask something specific about the image. Accepts PNG, JPEG, WebP and GIF up to 3 MB. Use for alt text, OCR-style reading of screenshots, chart reading and content checks.",
    tags: ["vision", "image", "ocr", "caption", "ai"],
    params: {
      url: { type: "string", description: "Absolute http(s) URL of a PNG, JPEG, WebP or GIF image (max 3 MB)", required: true, example: "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png" },
      question: { type: "string", description: "Optional question about the image (max 300 characters); default is a detailed description", example: "What colors are the dice?" },
    },
    outputExample: {
      url: "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png",
      question: "What colors are the dice?",
      description: "The dice are blue, red, green, and yellow.",
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
    },
  },
  {
    path: "/btc-fees",
    price: "$0.002",
    summary: "Bitcoin fee rates and mempool status",
    description:
      "Current Bitcoin network fee rates in sat/vB for next-block, half-hour, one-hour and economy confirmation, the estimated cost in sats of a typical payment, mempool size and total pending fees, and the latest block height. Use before sending a Bitcoin transaction or to decide whether to wait for lower fees.",
    tags: ["bitcoin", "fees", "mempool", "btc", "onchain"],
    params: {},
    outputExample: {
      network: "bitcoin",
      unit: "sat/vB",
      fees: { nextBlock: 4, halfHour: 3, hour: 1, economy: 1, minimum: 1 },
      typicalPaymentSats: { nextBlock: 564, hour: 141 },
      mempool: { transactions: 83832, vsize: 42066150, totalFeesBtc: 0.1093664 },
      blockHeight: 970000,
    },
  },
  {
    path: "/btc-address",
    price: "$0.003",
    summary: "Bitcoin address balance and activity",
    description:
      "Balance and activity of any Bitcoin mainnet address (legacy, P2SH or bech32): confirmed balance in sats and BTC, unconfirmed pending amount, total received and sent, and transaction counts. Use for payment verification, checking whether a deposit arrived, and wallet monitoring.",
    tags: ["bitcoin", "address", "balance", "btc", "onchain"],
    params: {
      address: { type: "string", description: "Bitcoin mainnet address (1..., 3... or bc1...)", required: true, example: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" },
    },
    outputExample: {
      network: "bitcoin",
      address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      balanceSats: 392247777,
      balanceBtc: 3.92247777,
      pendingSats: 0,
      totalReceivedBtc: 16.79253616,
      totalSentBtc: 12.87005839,
      transactions: 1138,
      pendingTransactions: 0,
    },
  },
  {
    path: "/ln-invoice",
    price: "$0.001",
    summary: "Decode a Lightning invoice",
    description:
      "Decode a BOLT11 Lightning Network invoice without paying it: network, amount in sats and BTC, description, payment hash, creation time, expiry time and whether it has already expired. Use to check what an invoice asks for before an agent pays it.",
    tags: ["lightning", "bitcoin", "invoice", "bolt11", "decode"],
    params: {
      invoice: {
        type: "string",
        description: "BOLT11 invoice string starting with ln (lnbc... for mainnet)",
        required: true,
        example:
          "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh",
      },
    },
    outputExample: {
      network: "bitcoin",
      amountSats: 250000,
      amountBtc: 0.0025,
      description: "1 cup coffee",
      paymentHash: "0001020304050607080900010203040506070809000102030405060708090102",
      createdAt: "2017-06-01T10:57:38.000Z",
      expiresAt: "2017-06-01T10:58:38.000Z",
      expired: true,
      expirySeconds: 60,
    },
  },
];

// Always carries at least one parameter so "path?query" stays well-formed.
const exampleQuery = (e: Endpoint) =>
  Object.entries(e.params)
    .filter(([, p]) => p.required)
    .map(([k, p]) => `${k}=${encodeURIComponent(String(p.example))}`)
    .join("&") || "format=json";

export const TRIAL_NOTE =
  "Free trial: add trial=1 to any GET request for a free call, up to 3 per caller per day while the daily trial pool lasts. Without it, unpaid requests get the 402 challenge.";

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
    serverInfo: { name: "agent-data-tools", title: SERVICE_NAME, version: "1.0.0" },
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
<li><a href="/.well-known/x402">x402 resource list</a></li>
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
      "x-guidance":
        "All operations are GET with query parameters and return JSON. Web: /extract reads a page as clean text, /summarize returns a short summary with key points, /screenshot returns a JPEG of the rendered page. AI: /image generates an image from a prompt, /transcribe turns an audio file URL into text, /describe describes or answers a question about an image URL. Images come back as base64 in the imageBase64 field. Data: /domain covers DNS, registration age and email authentication, /token gives facts and risk flags for an ERC-20 token on Base, /wallet gives the balances of an address on Base. Each call costs a fixed price in USDC on Base via x402; failed calls (4xx/5xx) are not charged. AI and screenshot endpoints return 503 when the daily capacity is used up. Bitcoin: /btc-fees gives current fee rates, /btc-address gives an address balance, /ln-invoice decodes a Lightning invoice. " +
        TRIAL_NOTE,
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
  ];
  return lines.join("\n");
}

export const robotsTxt = (origin: string) =>
  ["User-agent: *", "Allow: /", "Content-Signal: ai-train=no, search=yes, ai-input=yes", "", `Sitemap: ${origin}/llms.txt`].join("\n");
