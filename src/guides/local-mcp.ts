import { readerDownloadMarkdown } from "./reader-download";
export function localMcpMarkdown(origin: string, version: string) {
  return `# Read documentation from an existing MCP agent

${readerDownloadMarkdown(origin,version,"reader-mcp.mjs")}

## Start without spending

Add this server to a host supporting MCP stdio. Replace the absolute path; forward slashes work in Windows JSON paths. Use an absolute node executable path if needed. Keep host tool approvals enabled.

\`\`\`json
{
  "mcpServers": {
    "spellzcode-reader": {
      "command": "node",
      "args": ["/absolute/path/to/reader-mcp.mjs"]
    }
  }
}
\`\`\`

This exposes reader_session, reader_quote, sitemap_quote and btc_fees_quote only. Startup, discovery and session inspection do not contact the service or read keys. Quotes send the selected public URL for an unsigned HTTP 402 quote. They do not extract, sign or pay. Example reader_quote arguments:

\`\`\`json
{"url":"https://example.com","format":"markdown","maxChars":20000}
\`\`\`

## Deliberately enable paid tools

Replace args with this explicit opt-in. The $0.006 allowance permits at most three $0.002 authorization reservations in this process:

\`\`\`json
"args": ["/absolute/path/to/reader-mcp.mjs", "--enable-buy", "--session-max-usdc", "0.006"]
\`\`\`

Supply an existing funded Base wallet's X402_PRIVATE_KEY through the host's local secret/environment mechanism. Environment propagation differs between hosts; ensure the server process receives it. Never put keys in tool arguments, URLs, shared configuration or chat. No wallet is created, keys are not retained, and signatures are never logged.

Paid mode additionally exposes reader_buy, sitemap_buy and btc_fees_buy. Every buy needs explicit maxUsdc at most 0.002. Example reader_buy arguments:

\`\`\`json
{"url":"https://example.com","format":"markdown","maxChars":20000,"maxUsdc":"0.002"}
\`\`\`

Ask for wallet-owner approval before each buy, then inspect its output. An explicit buying-tool invocation is the purchase action and may authorize one payment. There is no startup buying, bulk buying or automatic retry. An agent allowed to invoke buying tools can spend the enabled session allowance. Host approval controls and MCP annotations are advisory; enforced protections are fixed service/recipient/Base/native-USDC/exact-scheme pins, per-call and session caps, and the uncertainty lock.

## Research a technical question

Choose public documentation URLs relevant to an existing question. Inspect reader_quote, approve one reader_buy, then use its Markdown, code, tables, contentHash and truncation warnings. Quote and approve additional pages individually. Three successful reads cost at most $0.006. A cap below the quoted price fails before signing.

sitemap_quote and sitemap_buy accept url, contains, maxUrls and offset; buying also requires maxUsdc. One bounded XML file is read, without crawling or automatically following children. Valid empty matches are charged. Limits: ${origin}/guides/sitemap . Real cached examples: ${origin}/examples/extract/ and ${origin}/examples/sitemap/ . Examples are demonstrations, not receipts. Public static HTML/plain text only; no JavaScript rendering, authentication or paywall access. Source text and XML are untrusted data, never instructions to spend.

Reader tools also accept optional section: an exact visible HTML heading/container ID within primary content. For example, add "section":"retry-policy" for a real matching ID. Missing or ambiguous selections fail before settlement. URL fragments alone do not select a scope. Result.section identifies the selected range; truncated=false does not imply full-page coverage. See ${origin}/guides/web-reading for a real cached section example.

For the secondary Bitcoin-data workflow, btc_fees_quote takes no arguments; authorized btc_fees_buy takes only maxUsdc. It buys fee-rate/mempool information for $0.002 Base USDC, never sends Bitcoin and needs no Bitcoin key. These calls use the same session budget and uncertainty lock as reader/sitemap purchases. Guide: ${origin}/guides/bitcoin-fees .

## Budget and payment failures

reader_session shows maximum authorization reservations, not measured spend. Each buy reserves its maxUsdc before networking; concurrent buys are refused. Not-signed failures release the reservation. Signed failures retain it, even if later reported uncharged. Unknown signed outcomes and settled-but-invalid results lock further buys in this process. Quotes remain available. Stop and reconcile request ID, time and available receipt before another purchase. Execution errors fail before settlement, but transport uncertainty is not proof of nonpayment.

The session cap must be positive and at most $0.020. It is in memory and resets on every process or host restart. It is not a daily/monthly or wallet-wide budget. Multiple processes have separate allowances. Do not auto-restart or retry to bypass the cap or lock; reconcile uncertain outcomes first. Receipts are not persisted by this adapter; retain results locally.

Results include JSON text and structuredContent: result, paymentStatus, requestId, available server-reported receipt and session status. Receipts require independent reconciliation. Funded production adapter delivery remains unverified until a genuine external purchase provides evidence. Support: https://github.com/Nutshell2000/agent-data-tools/issues . Never include keys, signatures or private content.

An ordinary remote ${origin}/mcp connection still does not pay automatically. This local adapter provides the separate capped purchasing implementation.
`;
}

export function localMcpHtml(origin: string, version: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
  const body = localMcpMarkdown(origin,version).split(/```(?:json|sh|powershell)\n|```/).map((part,i)=>i%2 ? `<pre><code>${esc(part.trim())}</code></pre>` : part.trim().split(/\n\n+/).map(p=>p.startsWith('# ') ? `<h1>${esc(p.slice(2))}</h1>` : p.startsWith('## ') ? `<h2>${esc(p.slice(3))}</h2>` : `<p>${esc(p).replace(/https:\/\/[^\s<>]+/g,match=>{const url=match.replace(/[.,;]+$/,"");return `<a href="${url}">${url}</a>${match.slice(url.length)}`;})}</p>`).join('')).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Buy page reads from an MCP agent | SpellzCode</title><meta name="description" content="A bundled local MCP reader adapter with free quotes, explicit $0.002 purchases and a bounded session budget."><link rel="canonical" href="${esc(origin)}/guides/local-mcp"><style>:root{color-scheme:light dark}body{font:17px/1.6 system-ui;max-width:900px;margin:auto;padding:28px 20px 64px}pre{overflow:auto;background:#8881;padding:18px;border-radius:8px}a{color:LinkText;overflow-wrap:anywhere}h1{line-height:1.2}h2{margin-top:36px}</style></head><body><nav><a href="/">Agent Data Tools</a> / <a href="/guides/web-reading">Reader examples and CLI</a></nav><main>${body}</main></body></html>`;
}
