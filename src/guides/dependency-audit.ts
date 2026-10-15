import { ENDPOINTS, paymentClientExample } from "../discovery";

const PACKAGES = "npm:express@4.21.2,pypi:requests@2.32.3";
const escape = (text: string) => text.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export function auditBuyingGuide(origin: string, payTo: string) {
  const endpoint = ENDPOINTS.find(e => e.path === "/package-audit")!;
  const query = new URLSearchParams({ packages: PACKAGES }).toString();
  const request = `${origin}/package-audit?${query}`;
  const client = paymentClientExample(origin, payTo, "/package-audit", query);
  return { price: endpoint.price, request, client };
}

export function auditGuideMarkdown(origin: string, payTo: string): string {
  const { price, request, client } = auditBuyingGuide(origin, payTo);
  const fence = "```";
  return `# SpellzCode dependency audit

Check pinned dependencies before an agent installs them. One request checks up to 10 public package identifiers for ${price} USDC on Base.

## What you receive

- Package and exact-version existence checks.
- Known advisory identifiers, affected/fixed ranges where available, and source retrieval timestamps.
- Dated FIRST EPSS estimates for CVE aliases, with missing or incomplete coverage identified.

This is a bounded automated report. It does not inspect your source code or prove that a dependency is safe. Upstream failures and omitted advisory details are reported as unknown or partial.

## 1. Choose public package versions

Use ecosystem:name@exact-version, separated by commas. Scoped npm packages use npm:@scope/name@version. Maximum 10 packages per request. Replace the illustrative versions below with your own. Omit private package names, credentials and source code.

Example: ${PACKAGES}

## 2. Inspect payment terms for free

An ordinary GET of the example URL returns HTTP 402 and the PAYMENT-REQUIRED header. It does not pay or run the audit.

${request}

The payment is native USDC on Base (eip155:8453), to ${payTo}. No API account is required. Failed calls are not charged.

## 3. Make one paid request with your own x402 client

The client below is dedicated to /package-audit. It pins the network, token and recipient and rejects quotes above ${price}. It makes one API request per invocation. Run it only when you intend to pay; repeated invocations can each incur a charge. Your private key stays in your own process environment and is never sent to this API.

Install: npm install @x402/fetch @x402/evm viem
Development tools: npm install --save-dev typescript tsx @types/node
Save as client.ts, configure X402_PRIVATE_KEY privately in your environment, then run npx tsx client.ts.


${fence}typescript
${client}
${fence}

## Read the result

Review each package verdict and versionAdvisories, including affected/fixed ranges. Check lookupFailed, versionAdvisoryLookupIncomplete, per-advisory detailStatus and epssLookup coverage before relying on the report. Missing evidence is unknown, not zero risk. The example does not automatically install packages or change a project.

OpenAPI: ${origin}/openapi.json
All tools: ${origin}/llms.txt
Payment evidence totals: ${origin}/revenue
`;
}

export function auditGuideHtml(origin: string, payTo: string): string {
  const { price, request, client } = auditBuyingGuide(origin, payTo);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dependency audit for AI agents | SpellzCode</title><meta name="description" content="Check up to 10 pinned dependencies for known advisories, affected ranges and dated EPSS evidence. One x402 request, ${escape(price)} USDC on Base.">
<link rel="canonical" href="${escape(origin)}/guides/dependency-audit"><style>
:root{color-scheme:light dark}body{font:16px/1.6 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:32px 20px 64px}h1{font-size:2.25rem;line-height:1.15;max-width:700px}h2{margin-top:36px}a{color:#087b59}code{overflow-wrap:anywhere}pre{overflow:auto;padding:20px;background:#80808014;border:1px solid #80808040;border-radius:8px;font-size:13px;line-height:1.6}.price{font-size:1.15rem}.request{display:block;overflow-wrap:anywhere;padding:16px;border:1px solid #80808040;border-radius:8px}.note{color:#666}li{margin:8px 0}@media(prefers-color-scheme:dark){a{color:#5fd0a5}.note{color:#a39d8f}}</style></head><body><main>
<p><a href="/">Agent Data Tools</a> / SpellzCode</p><h1>Check dependencies before your agent installs them</h1>
<p class="price">Up to 10 packages in one request. <strong>${escape(price)} USDC on Base.</strong> No API account required.</p>
<ul><li>Check whether a package and pinned version exist.</li><li>Get known advisory IDs and affected/fixed ranges where available.</li><li>Inspect dated EPSS evidence and explicit gaps in source coverage.</li></ul>
<p class="note">A bounded automated report. It does not inspect your source code or prove a dependency is safe.</p>
<h2>1. Choose your public package versions</h2><p>Use <code>ecosystem:name@exact-version</code>, separated by commas, for up to 10 packages. Scoped npm names are supported. Omit private package names, source code and credentials.</p>
<p>Illustrative versions to replace: <code>${escape(PACKAGES)}</code></p>
<h2>2. Inspect the quote for free</h2><p>This example returns the HTTP 402 payment terms. Opening it does not pay or run an audit.</p>
<a class="request" href="${escape(request)}">Inspect the payment terms</a>
<p>Native USDC on Base, paid to <code>${escape(payTo)}</code>. Failed calls are not charged.</p>
<h2>3. Send one paid request</h2><p>This dedicated client rejects a wrong chain, token, recipient or quote above ${escape(price)}. It makes one request per invocation. Run it only when you intend to pay; repeated runs can each incur a charge.</p>
<p>Install <code>npm install @x402/fetch @x402/evm viem</code> and <code>npm install --save-dev typescript tsx @types/node</code>. Save the example as <code>client.ts</code>, configure <code>X402_PRIVATE_KEY</code> privately in your own environment, then run <code>npx tsx client.ts</code>. Your private key is never sent to this API.</p>
<pre class="audit-client"><code>${escape(client)}</code></pre>
<h2>Read the evidence before acting</h2><p>Check each package verdict, affected/fixed ranges, retrieval timestamps, failed lookups and incomplete advisory/EPSS coverage. Unavailable evidence is unknown, not zero risk. This client does not install packages or edit your project.</p>
<p><a href="/guides/dependency-audit.md">Markdown guide for agents</a> Â· <a href="/openapi.json">OpenAPI</a> Â· <a href="/llms.txt">All tools</a></p>
</main></body></html>`;
}
