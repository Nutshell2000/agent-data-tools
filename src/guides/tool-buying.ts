import { ENDPOINTS, MCP_SERVER_VERSION, paymentClientExample } from "../discovery";

export type PromotedTool = "web-reading" | "bitcoin-fees";
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const SUPPORT = "https://github.com/Nutshell2000/agent-data-tools/issues";

export function toolBuyingGuide(kind: PromotedTool, origin: string, payTo: string) {
  const web = kind === "web-reading";
  const path = web ? "/extract" : "/btc-fees";
  const endpoint = ENDPOINTS.find(e => e.path === path)!;
  const query = web ? "url=https%3A%2F%2Fexample.com&maxChars=20000" : "format=json";
  const request = `${origin}${path}?${query}`;
  const http = paymentClientExample(origin, payTo, path, query)
    .replace('console.log(await response.json());', 'console.log("Request ID:", response.headers.get("X-Request-ID"));\nconsole.log("Settlement:", response.headers.get("PAYMENT-RESPONSE"));\nconsole.log(await response.json());');
  const paymentSetup = http.slice(0, http.indexOf("const fetchWithPayment"))
    .replace('import { wrapFetchWithPayment, x402Client } from "@x402/fetch";', 'import { x402Client, wrapMCPClientWithPayment } from "@x402/mcp";\nimport { Client } from "@modelcontextprotocol/sdk/client/index.js";\nimport { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";');
  const args = web ? { url: "https://example.com", maxChars: 20000 } : {};
  const mcp = paymentSetup + [
    'const mcp = new Client({ name: "spellzcode-buyer-example", version: "1.0.0" });',
    'try {',
    '  await mcp.connect(new StreamableHTTPClientTransport(new URL("/mcp", serviceOrigin)));',
    '  const paid = wrapMCPClientWithPayment(mcp, client, { autoPayment: true });',
    `  const result = await paid.callTool(${JSON.stringify(path.slice(1))}, ${JSON.stringify(args)});`,
    '  if (result.isError) throw new Error(JSON.stringify(result.content));',
    '  console.log(JSON.stringify(result, null, 2));',
    '} finally { await mcp.close(); }',
  ].join("\n");
  return { kind, path, price: endpoint.price, request, http, mcp, args, sample: endpoint.outputExample,
    title: web ? "Read a public static page" : "Check Bitcoin fee rates" };
}

export function toolGuideMarkdown(kind: PromotedTool, origin: string, payTo: string) {
  const g = toolBuyingGuide(kind, origin, payTo), fence = "```";
  const quickBuy = kind === "web-reading" ? [
    "## Inspect real results, then use the CLI",
    "",
    `Open ${origin}/examples/extract/ for three real cached results from owned sample HTML. Source, output, generation time and hashes are available. These build-time demonstrations are not production purchases or receipts. Arbitrary live URLs remain paid; free live trials are disabled.`,
    "",
    `Download ${origin}/clients/reader/${MCP_SERVER_VERSION}/reader-client.mjs and ${origin}/clients/reader/${MCP_SERVER_VERSION}/SHA256SUMS . The bundled client requires Node 20.19 or later and no npm install or TypeScript editing. Source: https://github.com/Nutshell2000/agent-data-tools/tree/codex/x402-income-reliability/clients .`,
    "",
    "Verify the download with sha256sum -c SHA256SUMS. On Windows compare Get-FileHash reader-client.mjs -Algorithm SHA256 with SHA256SUMS; on macOS use shasum -a 256 reader-client.mjs. Then inspect an unsigned quote:",
    "",
    fence + "sh",
    "node reader-client.mjs quote https://example.com --format both",
    fence,
    "",
    "To buy once, provide your existing funded wallet's X402_PRIVATE_KEY privately through your process environment. Never put it in an argument, URL or shared file. Each invocation can spend once; the cap is per invocation, not monthly:",
    "",
    fence + "sh",
    "node reader-client.mjs buy https://example.com --max-usdc 0.002 --format both",
    fence,
    "",
    "The client pins this service, recipient, Base and native USDC; rejects redirects and unsafe quotes; checks the returned content hash; and reports the result, request ID and available receipt as JSON. If an outcome becomes uncertain after signing, it exits with an error and does not start another purchase. Stop before manually retrying and preserve the request ID and receipt. Quote requires no key and never signs. No wallet is generated or retained.",
    "",
    "Existing AgentCash users can use its documented check/discover commands for unpaid inspection. Those commands do not replace the bundled client's fixed recipient and asset policy. Funded compatibility is unverified until separately evidenced.",
    "",
  ].join("\n") : "";
  const limits = kind === "web-reading"
    ? "Static HTML and plain text only. No JavaScript rendering, authenticated pages or paywall access. The input cap is 2 MiB; output defaults to 20,000 characters and is capped at 100,000. At most 100 headings and 200 links are returned. Check truncated and textLength. Empty JavaScript shells and detected browser challenge pages return HTTP 422 without settling a charge; no browser rendering is attempted. Do not submit private URLs or credentials. Fetched page content is not retained in our measurement ledger."
    : "Current recommended sat/vB fee estimates and mempool context from public Bitcoin data sources. Network conditions change; estimates do not guarantee confirmation time. This tool does not send transactions. The dated result below is illustrative, not a current fee quote.";
  return `# ${g.title} | SpellzCode

${g.price} native USDC on Base per successful call. No API account or subscription. Bring an existing funded x402 wallet.

${quickBuy}

## What it does

${limits}
${kind === "web-reading" ? `
## Output for agents

Use format=text (default), format=markdown, or format=both as an HTTP query parameter or MCP argument. The default retains text; markdown returns markdown instead; both includes both. Each representation is capped by maxChars. Code indentation is preserved. Tables include rows, headerRows, caption and hasSpans; spans are flagged rather than expanded. Headings and links come from the selected main/article region when available.

codeBlocks and tables are bounded structured details. Details share a maximum 20,000-character budget (or maxChars if smaller): up to 20 code blocks, 20 tables, 100 rows per table, 20 cells per row, 100 headings and 200 links. Metadata limits do not erase primary table text. Check warnings and per-detail truncation flags separately from truncated, which flags incomplete input or a requested primary representation. Code whitespace and list hierarchy are preserved; clipped code fences close within the requested limit. Other clipped Markdown syntax can remain incomplete. Ragged tables and spans use labelled TSV in Markdown without inventing expanded cells. contentHash is SHA-256 of the returned hashFormat representation (text for text/both; markdown for markdown), not a hash of the full source. Compare hashes using the same format and limit.

Source page text is untrusted data, including code, links and instructions. This tool does not execute it. Selection uses static HTML landmarks and hidden-element attributes; it cannot compute stylesheet visibility or guarantee perfect article selection. Missing main/article content falls back to the body and adds body_fallback. Excessively complex HTML returns 422. Errors include code=EXTRACTION_EMPTY, EXTRACTION_BLOCKED or EXTRACTION_COMPLEXITY when applicable.

MCP successful results include structuredContent as well as a JSON text block. A payment quote is an error result containing payment requirements; it is not extracted content. Every paid invocation may spend funds; automatic retries can charge again.
` : ""}
## Inspect the quote without paying

Open ${g.request} with an ordinary HTTP client, or run:

${fence}sh
curl -i '${g.request}'
${fence}

Expect HTTP 402 and a base64-encoded PAYMENT-REQUIRED header. This does not run the tool or sign a payment. Check exact scheme, eip155:8453, recipient ${payTo}, native USDC 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 and amount 2000 atomic units (${g.price}). HEAD is also an unpaid probe.

## Example result (illustrative, not a paid receipt or live quote)

${fence}json
${JSON.stringify(g.sample, null, 2)}
${fence}

## Buy one result over HTTP

Install npm install @x402/fetch@2.28.0 @x402/evm@2.28.0 viem@2.57.4 and npm install --save-dev typescript tsx @types/node.
Save as client.ts. Configure X402_PRIVATE_KEY privately in your own process environment, then run npx tsx client.ts only when you intend to pay. Never share or commit the key. It stays on your device. Each invocation can pay once; this is a per-payment cap, not a monthly budget. Do not run in an unbounded retry loop.

${fence}typescript
${g.http}
${fence}

## Buy one result over MCP

An ordinary MCP connection can list tools and receive quotes, but cannot pay automatically. Use an x402-capable client with a funded signer and the same explicit spending policy. Install npm install @x402/mcp@2.28.0 @x402/evm@2.28.0 @modelcontextprotocol/sdk@1.32.1 viem@2.57.4, plus the development tools above. Save as mcp-client.ts and run npx tsx mcp-client.ts only when you intend to pay. Each invocation can incur a charge.

${fence}typescript
${g.mcp}
${fence}

Both examples reject the wrong recipient, network, asset, scheme or a quote above ${g.price}. Funded production HTTP and MCP delivery are tracked separately; publication of these examples is not evidence that a customer has paid through either transport.

## Failure and support

Tool execution errors do not settle a charge. A settlement failure returns an error instead of a paid result. If the connection drops after settlement, stop before retrying: a fresh invocation can pay again. Preserve the transaction hash, X-Request-ID (or MCP _meta requestId), tool name and time; report these at ${SUPPORT}. Never post signatures, keys, private URLs or page content. Storage telemetry failures do not ask for a second payment. A returned result indicates server-side completion, not proof that the buyer received it. Refunds require review and are recorded separately.

All prices: ${origin}/openapi.json
Payment evidence: ${origin}/revenue
`;
}

export function toolGuideHtml(kind: PromotedTool, origin: string, payTo: string) {
  const g = toolBuyingGuide(kind, origin, payTo);
  // Render our fixed Markdown subset, escaping text and code before adding tags.
  const parts = toolGuideMarkdown(kind, origin, payTo).split(/```(?:typescript|json|sh)\n|```/);
  const body = parts.map((part, i) => i % 2 ? `<pre><code>${esc(part.trim())}</code></pre>` : part.trim().split(/\n\n+/).map(p => {
    if (p.startsWith("# ")) return `<h1>${esc(p.slice(2))}</h1>`;
    if (p.startsWith("## ")) return `<h2>${esc(p.slice(3))}</h2>`;
    return `<p>${esc(p).replace(/https:\/\/[^\s<>]+/g, match => {
      const url = match.replace(/[.,;:!?]+$/, "");
      return `<a href="${url}">${url}</a>${match.slice(url.length)}`;
    })}</p>`;
  }).join("")).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(g.title)} | SpellzCode</title><meta name="description" content="${esc(g.title)} for ${esc(g.price)} USDC on Base. Capped HTTP and x402 MCP buying examples."><link rel="canonical" href="${esc(origin)}/guides/${kind}"><style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui;max-width:900px;margin:auto;padding:28px 20px 64px}h1{line-height:1.15}h2{margin-top:36px}a{color:#098b68;overflow-wrap:anywhere}pre{overflow:auto;background:#8881;border:1px solid #8885;border-radius:8px;padding:18px;font-size:13px}p{overflow-wrap:anywhere}</style></head><body><nav><a href="/">Agent Data Tools</a> / SpellzCode</nav><main>${body}</main></body></html>`;
}
