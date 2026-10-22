// /demo: a short product walkthrough (a screen recording of the live site) with the narration as text, so the
// grant form, directories and people get one stable demo link on our own domain without a video account.
export function demoPage(origin: string, toolCount: number): string {
  const step = (title: string, body: string) => `<li><strong>${title}</strong> ${body}</li>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo · Agent Data Tools</title>
<meta name="description" content="A two-minute walkthrough of Agent Data Tools: ${toolCount} pay-per-call tools for AI agents, paid in USDC on Base via x402, with 25 free calls.">
<link rel="canonical" href="${origin}/demo">
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#5f6368;--line:#e3e5e8;--accent:#0b57d0}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#e8eaed;--muted:#a3a8ae;--line:#2c3036;--accent:#8ab4f8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 48px}h1{font-size:1.6rem;margin:0 0 8px}.lead{color:var(--muted);margin:0 0 20px}
img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px}ol{padding-left:22px}li{margin:10px 0}a{color:var(--accent)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
</style></head><body><main>
<h1>Agent Data Tools: product demo</h1>
<p class="lead">${toolCount} pay-per-call data tools for AI agents. No accounts or API keys: an agent pays each request in USDC on Base via x402 (or MPP), and every caller gets 25 free calls.</p>
<img src="/demo.gif" alt="Screen recording: the homepage, the tool list, a free payee screening check, a tool's payment page and a live Base gas reading" width="1568" height="726">
<h2>What the recording shows</h2>
<ol>
${step("The homepage.", "One endpoint for agents: add it to Claude, Cursor or any MCP client, buy card credits, or pay per call with an x402 wallet.")}
${step("The tool list.", `All ${toolCount} tools with their prices: onchain reads on five chains, token prices, sanctions and payee checks, web and PDF text, SEC filings, weather, time and utilities. Most calls cost $0.01.`)}
${step("A free check on real data.", "“Screen a payee before paying” runs on an Ethereum address: OFAC sanctions, account type, holdings and a pass, review or block verdict.")}
${step("The payment page.", "Opened without payment, a tool URL answers HTTP 402 Payment Required with its price in USDC on Base, our wallet and our Base Builder Code (bc_09e30bdm). An x402 client signs the payment and repeats the request.")}
${step("A live answer.", "A free trial call returns current gas prices read from Base. Paid calls settle through Coinbase's facilitator straight to our wallet; failed calls are never charged.")}
</ol>
<p>Try it yourself: <a href="/tools">all tools</a>, <a href="/tools/check-counterparty">screen a payee</a>, or the MCP server at <code>${origin}/mcp</code>.</p>
</main></body></html>`;
}
