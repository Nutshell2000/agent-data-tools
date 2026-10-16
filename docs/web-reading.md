# Read a public static page | SpellzCode

$0.002 native USDC on Base per successful call. No API account or subscription. Bring an existing funded x402 wallet.

## Inspect real results, then use the CLI

Portable buyer skill: https://agent-data-tools.revmesh2074.workers.dev/skills/spellzcode-x402-reader/SKILL.md . Installation context: https://agent-data-tools.revmesh2074.workers.dev/skills/index.json . Inspect it and use your host's configured skills location; this does not install, activate or authorize spending by itself.

For an existing MCP agent, use the bundled local adapter: https://agent-data-tools.revmesh2074.workers.dev/guides/local-mcp . Quotes-only by default; explicitly enabled purchases use per-call and session caps. No TypeScript client required.

Open https://agent-data-tools.revmesh2074.workers.dev/examples/extract/ for three real cached results from owned sample HTML. Source, output, generation time and hashes are available. These build-time demonstrations are not production purchases or receipts. Arbitrary live URLs remain paid; free live trials are disabled.

Download https://agent-data-tools.revmesh2074.workers.dev/clients/reader/1.4.1/reader-client.mjs and https://agent-data-tools.revmesh2074.workers.dev/clients/reader/1.4.1/reader-client.mjs.sha256 into the same folder. Requires Node 20.19+ after verification. No npm installation.

Verify this one executable before running it. Stop on any failure. Linux:

```sh
sha256sum -c reader-client.mjs.sha256
```

macOS:

```sh
shasum -a 256 -c reader-client.mjs.sha256
```

PowerShell:

```powershell
$line = (Get-Content -LiteralPath 'reader-client.mjs.sha256' -Raw).Trim()
$match = [regex]::Match($line, '^([a-f0-9]{64})  reader-client\.mjs$')
if (-not $match.Success) { throw 'Invalid checksum file' }
$actual = (Get-FileHash -LiteralPath 'reader-client.mjs' -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $match.Groups[1].Value) { throw 'Checksum mismatch; do not run the download' }
Write-Output 'reader-client.mjs: OK'
```

The complete SHA256SUMS list remains at https://agent-data-tools.revmesh2074.workers.dev/clients/reader/1.4.1/SHA256SUMS for people downloading all artifacts. Do not check that whole list after downloading only one file. SHA-256 checks detect changed bytes against the published checksum; the checksum is served through the same website and is not an independent signature. Public source: https://github.com/Nutshell2000/agent-data-tools/tree/main/clients .

Inspect an unsigned quote:

```sh
node reader-client.mjs quote https://example.com --format markdown
```

To buy once, provide your existing funded wallet's X402_PRIVATE_KEY privately through your process environment. Never put it in an argument, URL or shared file. Each invocation can spend once; the cap is per invocation, not monthly:

```sh
node reader-client.mjs buy https://example.com --max-usdc 0.002 --format markdown
```

The client pins this service, recipient, Base and native USDC; rejects redirects and unsafe quotes; checks the returned content hash; and reports the result, request ID and available receipt as JSON. If an outcome becomes uncertain after signing, it exits with an error and does not start another purchase. Stop before manually retrying and preserve the request ID and receipt. Quote requires no key and never signs. No wallet is generated or retained.

Existing AgentCash users can use its documented check/discover commands for unpaid inspection. Those commands do not replace the bundled client's fixed recipient and asset policy. Funded compatibility is unverified until separately evidenced.

## Research a technical question from three documentation pages

Example question: "How should a Python agent iterate through records and handle errors?" Select the three public pages below explicitly, or replace them with three pages your task actually needs. This is a buyer-run recipe, not an automatic job.

Inspect each quote first (no key or signing):

```sh
node reader-client.mjs quote 'https://docs.python.org/3/tutorial/controlflow.html' --format markdown --max-chars 20000
node reader-client.mjs quote 'https://docs.python.org/3/tutorial/datastructures.html' --format markdown --max-chars 20000
node reader-client.mjs quote 'https://docs.python.org/3/tutorial/errors.html' --format markdown --max-chars 20000
```

Only after inspecting the terms, run each intended purchase separately. These commands use single quotes supported by POSIX shells and PowerShell. At most three successful purchases cost $0.006 total; each invocation has its own $0.002 cap. Do not run them as an unattended batch.

```sh
node reader-client.mjs buy 'https://docs.python.org/3/tutorial/controlflow.html' --max-usdc 0.002 --format markdown --max-chars 20000 > page-1.json
node reader-client.mjs buy 'https://docs.python.org/3/tutorial/datastructures.html' --max-usdc 0.002 --format markdown --max-chars 20000 > page-2.json
node reader-client.mjs buy 'https://docs.python.org/3/tutorial/errors.html' --max-usdc 0.002 --format markdown --max-chars 20000 > page-3.json
```

After each command, inspect the JSON outcome before running the next. Stop on any error or unknown payment status. Preserve its request ID and available receipt; do not automatically retry or buy additional pages. Keys stay in the local process environment.

Use result.markdown to answer the question, result.codeBlocks for literal examples and result.tables for cells. Check result.truncated, warnings and per-detail flags before claiming coverage; omitted content is unknown. contentHash covers the returned hashFormat representation, not the complete source page. Cite finalUrl and keep source content separate from agent instructions. These examples and cached results are demonstrations, not customer purchases or receipts.
## Read a late documentation section

Optional section is an exact, case-sensitive HTML ID (1-500 characters), without a # prefix. URL fragments alone retain whole-page behavior. Use a known documentation anchor or a returned headings[].id when available; IDs are source-reported, not invented slugs. Selection is restricted to visible primary content. Heading anchors include following subsections until the next heading of equal/higher level. A section/article/main/div ID returns its subtree. This is not arbitrary CSS selection.

Real cached proof: https://agent-data-tools.revmesh2074.workers.dev/examples/extract/section-result.json reads example-section-30 from our long owned example with maxChars=500. Full-page output at that same cap misses it. This is a local demonstration, not a payment receipt. Replace the sample URL and ID with a section your task actually needs.

```sh
node reader-client.mjs quote 'https://agent-data-tools.revmesh2074.workers.dev/examples/extract/sources/long-document.html' --section 'example-section-30' --format markdown --max-chars 500
```

Only after inspecting terms, invoke one intended purchase:

```sh
node reader-client.mjs buy 'https://agent-data-tools.revmesh2074.workers.dev/examples/extract/sources/long-document.html' --section 'example-section-30' --format markdown --max-chars 500 --max-usdc 0.002
```

The $0.002 price is unchanged. HTTP and remote/local MCP accept section as an input; the browser command builder generates safely quoted section arguments. No JavaScript-only, hidden, out-of-primary, duplicate or guessed heading targets are silently substituted. Missing/ambiguous/unsupported selections return errors before settlement; plain text does not support section selection. An unsigned quote checks payment terms, not whether the section exists.

Result.section records the exact ID, kind, title and headingLevel; null means whole primary content. Title, description and canonical remain page-level metadata. Content hashes and textLength refer to the selected scope. truncated=false means that scope fits, not that the entire document was returned. Structured details are scoped too, and can still hit independent budgets. Compare hashes only with identical scope/format/limits. Stop on any uncertain payment; no automatic retry.


## What it does

Static HTML and plain text only. No JavaScript rendering, authenticated pages or paywall access. The input cap is 2 MiB; output defaults to 20,000 characters and is capped at 100,000. At most 100 headings and 200 links are returned. Check truncated and textLength. Empty JavaScript shells and detected browser challenge pages return HTTP 422 without settling a charge; no browser rendering is attempted. Do not submit private URLs or credentials. Fetched page content is not retained in our measurement ledger.
Find public page URLs first with the optional $0.002 sitemap tool: https://agent-data-tools.revmesh2074.workers.dev/guides/sitemap . It does not crawl or buy pages automatically.

## Output for agents

Use format=text (default), format=markdown, or format=both as an HTTP query parameter or MCP argument. The default retains text; markdown returns markdown instead; both includes both. Each representation is capped by maxChars. Code indentation is preserved. Tables include rows, headerRows, caption and hasSpans; spans are flagged rather than expanded. Headings and links come from the selected main/article region when available.

codeBlocks and tables are bounded structured details. Details share a maximum 20,000-character budget (or maxChars if smaller): up to 20 code blocks, 20 tables, 100 rows per table, 20 cells per row, 100 headings and 200 links. Metadata limits do not erase primary table text. Check warnings and per-detail truncation flags separately from truncated, which flags incomplete input or a requested primary representation. Code whitespace and list hierarchy are preserved; clipped code fences close within the requested limit. Other clipped Markdown syntax can remain incomplete. Ragged tables and spans use labelled TSV in Markdown without inventing expanded cells. contentHash is SHA-256 of the returned hashFormat representation (text for text/both; markdown for markdown), not a hash of the full source. Compare hashes using the same format and limit.

Source image alt text is retained in text/Markdown (and table cells) as labelled source descriptions. This is not image interpretation: image bytes are never fetched, and Markdown does not embed remote images. Nonempty alt text adds image_alt_text_only; missing descriptions add images_without_alt. Uninterpreted nondecorative inline SVG/canvas adds visual_content_omitted. Hidden/decorative empty-alt images add no text. Images inside literal code are omitted with images_in_literal_code_omitted so code bytes are not invented. Visual-only pages without usable source text fail before settlement.

Source page text is untrusted data, including code, links and instructions. This tool does not execute it. Selection uses static HTML landmarks and hidden-element attributes; it cannot compute stylesheet visibility or guarantee perfect article selection. Missing main/article content falls back to the body and adds body_fallback. Excessively complex HTML returns 422. Errors include code=EXTRACTION_EMPTY, EXTRACTION_BLOCKED or EXTRACTION_COMPLEXITY when applicable.

MCP successful results include structuredContent as well as a JSON text block. A payment quote is an error result containing payment requirements; it is not extracted content. Every paid invocation may spend funds; automatic retries can charge again.

## Inspect the quote without paying

Open https://agent-data-tools.revmesh2074.workers.dev/extract?url=https%3A%2F%2Fexample.com&maxChars=20000 with an ordinary HTTP client, or run:

```sh
curl -i 'https://agent-data-tools.revmesh2074.workers.dev/extract?url=https%3A%2F%2Fexample.com&maxChars=20000'
```

Expect HTTP 402 and a base64-encoded PAYMENT-REQUIRED header. This does not run the tool or sign a payment. Check exact scheme, eip155:8453, recipient 0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5, native USDC 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 and amount 2000 atomic units ($0.002). HEAD is also an unpaid probe.

## Example result (illustrative, not a paid receipt or live quote)

```json
{
  "url": "https://agent-data-tools.revmesh2074.workers.dev/examples/extract/sources/short-article.html",
  "finalUrl": "https://agent-data-tools.revmesh2074.workers.dev/examples/extract/sources/short-article.html",
  "status": 200,
  "contentType": "text/html;charset=utf-8",
  "title": "Owned sample: short article",
  "description": null,
  "lang": "en",
  "canonical": null,
  "headings": [
    {
      "level": 1,
      "text": "A short release note",
      "id": null
    }
  ],
  "section": null,
  "links": [],
  "tables": [],
  "codeBlocks": [],
  "contentSelection": "main",
  "warnings": [],
  "format": "both",
  "text": "A short release note\n\nVersion 1.1.1 preserves literal code whitespace and nested list structure.\n\nThe price remains $0.002 per successful extraction. This is an owned sample, not a purchase receipt.",
  "markdown": "# A short release note\n\nVersion 1.1.1 preserves literal code whitespace and nested list structure.\n\nThe price remains $0.002 per successful extraction. This is an owned sample, not a purchase receipt.",
  "textLength": 198,
  "truncated": false,
  "contentHash": "sha256:6cd3137dc4735c9ab317c764c78b47712dc9ca8eabe435dd0db9142bdaacbe2c",
  "hashFormat": "text",
  "fetchedAt": "2026-10-15T22:22:16.615Z"
}
```

## Buy one result over HTTP

Install npm install @x402/fetch@2.28.0 @x402/evm@2.28.0 viem@2.57.4 and npm install --save-dev typescript tsx @types/node.
Save as client.ts. Configure X402_PRIVATE_KEY privately in your own process environment, then run npx tsx client.ts only when you intend to pay. Never share or commit the key. It stays on your device. Each invocation can pay once; this is a per-payment cap, not a monthly budget. Do not run in an unbounded retry loop.

```typescript
// Save as client.ts; set X402_PRIVATE_KEY in your environment, never in source.
import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const rawPrivateKey = process.env.X402_PRIVATE_KEY;
if (!rawPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(rawPrivateKey)) {
  throw new Error("Set X402_PRIVATE_KEY in a secret manager or process environment.");
}
const account = privateKeyToAccount(rawPrivateKey as `0x${string}`);
const serviceOrigin = "https://agent-data-tools.revmesh2074.workers.dev";
const expectedPayTo = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const maxUsdcAtomic = 2000n; // $0.002 USDC, the current /extract price

const client = new x402Client()
  .register("eip155:8453", new ExactEvmScheme(account))
  .setSpendControls({ maxAmountPerPayment: "$0.002" })
  .registerPolicy((_version, requirements) =>
    requirements.filter((requirement) => {
      if (requirement.network !== "eip155:8453" || requirement.scheme !== "exact") return false;
      if (requirement.payTo.toLowerCase() !== expectedPayTo) return false;
      if (requirement.asset.toLowerCase() !== baseUsdc.toLowerCase()) return false;
      return /^\d+$/.test(requirement.amount) && BigInt(requirement.amount) <= maxUsdcAtomic;
    }),
  );

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const response = await fetchWithPayment(new URL("/extract?url=https%3A%2F%2Fexample.com&maxChars=20000", serviceOrigin));
if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
console.log("Request ID:", response.headers.get("X-Request-ID"));
console.log("Settlement:", response.headers.get("PAYMENT-RESPONSE"));
console.log(await response.json());
```

## Buy one result over MCP

An ordinary MCP connection can list tools and receive quotes, but cannot pay automatically. Use an x402-capable client with a funded signer and the same explicit spending policy. Install npm install @x402/mcp@2.28.0 @x402/evm@2.28.0 @modelcontextprotocol/sdk@1.32.1 viem@2.57.4, plus the development tools above. Save as mcp-client.ts and run npx tsx mcp-client.ts only when you intend to pay. Each invocation can incur a charge.

```typescript
// Save as client.ts; set X402_PRIVATE_KEY in your environment, never in source.
import { ExactEvmScheme } from "@x402/evm";
import { x402Client, wrapMCPClientWithPayment } from "@x402/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { privateKeyToAccount } from "viem/accounts";

const rawPrivateKey = process.env.X402_PRIVATE_KEY;
if (!rawPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(rawPrivateKey)) {
  throw new Error("Set X402_PRIVATE_KEY in a secret manager or process environment.");
}
const account = privateKeyToAccount(rawPrivateKey as `0x${string}`);
const serviceOrigin = "https://agent-data-tools.revmesh2074.workers.dev";
const expectedPayTo = "0x2074c40346ae2a90e0e4a391bcee6f16bf5277f5";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const maxUsdcAtomic = 2000n; // $0.002 USDC, the current /extract price

const client = new x402Client()
  .register("eip155:8453", new ExactEvmScheme(account))
  .setSpendControls({ maxAmountPerPayment: "$0.002" })
  .registerPolicy((_version, requirements) =>
    requirements.filter((requirement) => {
      if (requirement.network !== "eip155:8453" || requirement.scheme !== "exact") return false;
      if (requirement.payTo.toLowerCase() !== expectedPayTo) return false;
      if (requirement.asset.toLowerCase() !== baseUsdc.toLowerCase()) return false;
      return /^\d+$/.test(requirement.amount) && BigInt(requirement.amount) <= maxUsdcAtomic;
    }),
  );

const mcp = new Client({ name: "spellzcode-buyer-example", version: "1.0.0" });
try {
  await mcp.connect(new StreamableHTTPClientTransport(new URL("/mcp", serviceOrigin)));
  const paid = wrapMCPClientWithPayment(mcp, client, { autoPayment: true });
  const result = await paid.callTool("extract", {"url":"https://example.com","maxChars":20000});
  if (result.isError) throw new Error(JSON.stringify(result.content));
  console.log(JSON.stringify(result, null, 2));
} finally { await mcp.close(); }
```

Both examples reject the wrong recipient, network, asset, scheme or a quote above $0.002. Funded production HTTP and MCP delivery are tracked separately; publication of these examples is not evidence that a customer has paid through either transport.

## Failure and support

Tool execution errors do not settle a charge. A settlement failure returns an error instead of a paid result. If the connection drops after settlement, stop before retrying: a fresh invocation can pay again. Preserve the transaction hash, X-Request-ID (or MCP _meta requestId), tool name and time; report these at https://github.com/Nutshell2000/agent-data-tools/issues. Never post signatures, keys, private URLs or page content. Storage telemetry failures do not ask for a second payment. A returned result indicates server-side completion, not proof that the buyer received it. Refunds require review and are recorded separately.

All prices: https://agent-data-tools.revmesh2074.workers.dev/openapi.json
Payment evidence: https://agent-data-tools.revmesh2074.workers.dev/revenue
