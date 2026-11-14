// /guides/ai-sdk: how the npm package gives these tools to the Vercel AI SDK, and how an MCP client pays from a wallet.
// Written 14 Nov 2026 with npm package agent-data-tools 1.3.0; the code below was run against ai 7.0.173.

export function aiSdkMarkdown(origin: string) {
  return `# Use Agent Data Tools with the Vercel AI SDK

The npm package \`agent-data-tools\` turns any of the tools on this service into AI SDK tools. Name the few tools a task needs; the model calls them and gets each tool's JSON answer.

## Install

\`\`\`sh
npm install ai agent-data-tools
\`\`\`

## Give tools to a model

\`\`\`js
import { generateText, isStepCount } from 'ai';
import { agentDataTools } from 'agent-data-tools/ai-sdk';

const { text } = await generateText({
  model: 'anthropic/claude-haiku-5.5',
  tools: await agentDataTools(['pdf_text', 'extract', 'weather']),
  stopWhen: isStepCount(5),
  prompt: 'Read https://bitcoin.org/bitcoin.pdf and tell me in three sentences what problem it solves.',
});

console.log(text);
\`\`\`

\`agentDataTools(names, options)\` reads each tool's description and input schema from ${origin}/openapi.json. Names are the tool names (\`pdf_text\`, \`weather\`, \`price_token\`) or paths (\`/pdf/text\`). The full list with prices is at ${origin}/tools.

## Paying

Without any setup the first successful calls are free. After that a call that is not paid returns its price and a link to the model as the tool result, so a generation does not fail.

Prepaid key, by card from $1 at ${origin}/credits:

\`\`\`js
const tools = await agentDataTools(['pdf_text'], { apiKey: process.env.ADT_API_KEY });
\`\`\`

USDC per call from your own wallet over x402, with no account:

\`\`\`js
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.WALLET_KEY) });
const tools = await agentDataTools(['pdf_text'], { fetch: wrapFetchWithPayment(fetch, client) });
\`\`\`

Failed calls are never charged. Most tools cost $0.01 a call or less.

## The same tools in an MCP client, paid from a wallet

For Claude Desktop, Cursor, Cline and other MCP clients the package is also a local MCP server. Set \`AGENT_DATA_TOOLS_WALLET_KEY\` to the private key of a wallet that holds USDC on Base and each call after the free ones is paid from it:

\`\`\`json
{
  "mcpServers": {
    "agent-data-tools": {
      "command": "npx",
      "args": ["-y", "agent-data-tools", "mcp"],
      "env": { "AGENT_DATA_TOOLS_WALLET_KEY": "0x..." }
    }
  }
}
\`\`\`

It pays at most $0.10 a call and $1 a day unless \`AGENT_DATA_TOOLS_MAX_USD\` and \`AGENT_DATA_TOOLS_DAILY_USD\` say otherwise. The key is read from the environment only, signs nothing but the exact USDC amount the service quoted, and is never written or sent. Use a wallet that holds only what you are willing to spend. Without the variable the server uses the free calls or a prepaid key (\`AGENT_DATA_TOOLS_KEY\`).

Package: https://www.npmjs.com/package/agent-data-tools
`;
}

export function aiSdkHtml(origin: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/https:\/\/[^\s<>]+/g, (match) => { const url = match.replace(/[.,;]+$/, ""); return `<a href="${url}">${url}</a>${match.slice(url.length)}`; });
  const body = aiSdkMarkdown(origin).split(/```(?:json|sh|js)\n|```/).map((part, i) => (i % 2
    ? `<pre><code>${esc(part.trim())}</code></pre>`
    : part.trim().split(/\n\n+/).map((p) => (p.startsWith("# ") ? `<h1>${esc(p.slice(2))}</h1>` : p.startsWith("## ") ? `<h2>${esc(p.slice(3))}</h2>` : p ? `<p>${inline(p)}</p>` : "")).join(""))).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vercel AI SDK tools: PDF, web pages, search, prices | Agent Data Tools</title><meta name="description" content="Give a model PDF reading, web page text, search, prices and several hundred other tools through the Vercel AI SDK with one npm package. Free calls to start, then a prepaid key or USDC per call."><link rel="canonical" href="${esc(origin)}/guides/ai-sdk"><style>:root{color-scheme:light dark}body{font:16px/1.55 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}pre{overflow:auto;padding:.8rem;border:1px solid #8884;border-radius:6px}code{font:14px/1.45 ui-monospace,monospace}h2{margin-top:2rem}</style></head><body><main>${body}<p><a href="/">Agent Data Tools</a> · <a href="/tools">All tools and prices</a> · <a href="/guides">Guides</a> · <a href="/credits">Card credits</a></p></main></body></html>`;
}
