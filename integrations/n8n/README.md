# n8n-nodes-agent-data-tools

An [n8n](https://n8n.io) community node for [Agent Data Tools](https://agent-data-tools.revmesh2074.workers.dev): web search, page text, news, GitHub, CVE, company, crypto, speech and sanctions tools behind one prepaid API key, paid per call. The node has a ready-made operation for the jobs used most and a "Call any tool" operation that reaches the rest of the catalog (about 680 tools).

- No subscription: a call costs a fixed price, from $0.002. Failed calls are not charged.
- One credential for everything: a prepaid key bought by card, from $1.
- "Find a tool" is free and works without a key.

## Installation

Self-hosted n8n: **Settings > Community Nodes > Install**, enter `n8n-nodes-agent-data-tools`, confirm. The node then appears in the nodes panel as **Agent Data Tools**. See the n8n guide to [installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

Unverified community nodes cannot be installed on n8n Cloud. This node becomes available there once n8n has verified it.

## Credentials

The node uses one credential, **Agent Data Tools API**, with one field: the API key.

1. Open <https://agent-data-tools.revmesh2074.workers.dev/credits> and buy a credit pack by card (Stripe). The page shows your key, which starts with `adt_`, as soon as the payment is confirmed.
2. In n8n, create an **Agent Data Tools API** credential and paste the key.

The key is sent in the `Authorization` header of each request and never in a URL. n8n tests a new credential by reading the key's balance, which is free. If a key leaks, replace it: the credits page explains how to rotate a key and keep the balance.

## What it costs

| Pack | Credits |
|---|---|
| $1 | 1,000 |
| $5 | 5,000 |
| $20 | 22,000 |
| $100 | 125,000 |

1 credit is $0.001, so a $0.01 call spends 10 credits and a $0.002 call spends 2. Credits do not expire. Only successful calls are charged: a refused input, a missing result or an error on the service costs nothing. Each answer carries the header `X-Credits-Remaining`, and <https://agent-data-tools.revmesh2074.workers.dev/credits/balance> shows the balance of a key.

Free in this node:

- **Find a tool** (no key needed).
- **Return Sample Only**, an option of every paid operation: it returns the tool's static documented example instead of a live result, which is useful while building a workflow.

## Operations

| Resource | Operation | What you get | Tool | Price per call |
|---|---|---|---|---|
| Tool | Find | The tools that do a job you describe in plain words, with path, inputs and price | `/find` | Free |
| Tool | Call | Any tool of the catalog by its path, with your own JSON parameters | any | The price of that tool |
| Web | Search | Web results with title, URL, snippet and date; optional page text, highlights and summaries | `/search` | $0.01 |
| Web | Read Page | A public page as clean Markdown or text | `/extract` | $0.002 |
| Web | Read Page with **Render JavaScript** | The same for pages built with JavaScript, loaded in a real browser | `/extract/rendered` | $0.01 |
| Web | Audit Website | Accessibility (WCAG 2.1 A/AA), page speed, on-page SEO and security headers, with a score | `/audit/website` | $0.01 |
| News | Search | Current news articles on a topic | `/news` | $0.01 |
| News | Get Sentiment | Headlines on a topic, each scored positive or negative, and the balance | `/pack/news-sentiment` | $0.01 |
| GitHub Repository | Get | Stars, forks, issues, languages, license, dates and latest release of a public repository | `/github/repo` | $0.002 |
| Vulnerability | Get | A CVE: severity, known exploitation (CISA KEV), EPSS, affected products and fixes | `/cve` | $0.002 |
| Speech | Generate | Up to 300 characters as an MP3, in English or Spanish | `/ai/speech` | $0.01 |
| Speech | Generate with **Long Text** | Up to 2,000 characters as one MP3 | `/text-to-speech` | $0.08 |
| Crypto | Get Price | USD spot price of a token from its deepest Uniswap v3 pool | `/price/token` | $0.002 |
| Crypto | Get Indicators | RSI, MACD, moving averages, Bollinger bands and ATR for a Hyperliquid perpetual | `/hyperliquid/indicators` | $0.01 |
| Company | Get | Company profile from Wikidata: website, country, industries, CEO, tickers, LEI | `/company` | $0.01 |
| Company | Get SEC Filings | Latest SEC EDGAR filings of a US-listed company, with links | `/sec/filings` | $0.002 |
| Screening | Check Sanctions | OFAC SDN screening of a crypto address or a name | `/sanctions/check` | $0.009 |
| Screening | Check Payee | OFAC match, account type and optional domain age for an address you are about to pay | `/check/payee` | $0.005 |

These are the service's public prices on 11 November 2026. The service can change a price; what a call costs today is in the tool's listing at <https://agent-data-tools.revmesh2074.workers.dev/tools>, in <https://agent-data-tools.revmesh2074.workers.dev/openapi.json> and in every answer of **Find a tool**. The screening tools are a screening aid, not legal advice. The indicators are not investment advice.

Every paid operation has an **Options** list with the tool's optional inputs, plus **Fields to Keep** (return only the named top-level keys of the answer) and **Return Sample Only**.

### Find a tool, then call it

1. Add the node, keep **Tool > Find**, and describe the job, for example `current gas price on Base`. The answer lists matching tools:

   ```json
   {
     "picks": [
       { "tool": "/base-gas", "price": "$0.002", "requiredInputs": [], "call": { "method": "GET", "url": "https://agent-data-tools.revmesh2074.workers.dev/base-gas" } }
     ],
     "free": true
   }
   ```

2. Add a second node with **Tool > Call**, set **Tool Path** to the `tool` value (`/base-gas`) and **Parameters** to a JSON object with the inputs, for example `{ "city": "London" }` for `/weather`.

**Tool Path** only accepts a path on the service, such as `/weather` or `/price/token`. Full URLs are refused, so the key cannot be sent anywhere else.

### Speech

**Speech > Generate** puts the MP3 into the binary field named in **Put Audio in Binary Field** (`data` by default), ready for a Write Binary File, e-mail or chat node. Empty that field to keep the audio as base64 text in the JSON instead.

### Use as an AI Agent tool

The node can be attached to an n8n AI Agent as a tool. An agent that should pick among all tools on its own can instead use n8n's MCP Client Tool node with the service's compact MCP server, `https://agent-data-tools.revmesh2074.workers.dev/mcp/compact`, sending the same key as `Authorization: Bearer <key>`. It offers three tools (`find_tool`, `tool_details`, `call_tool`) in place of one per tool. The full server, one MCP tool per catalog tool, is `https://agent-data-tools.revmesh2074.workers.dev/mcp`.

## Good to know

- Without a credential a paid operation is answered with HTTP 402 and a message that says where to buy a key. Nothing is charged.
- A 400 answer names the inputs the tool takes and shows an example call. A 404 from a tool means there is no data for that input. Neither is charged.
- Web and news search results come from the Brave Search API and are for immediate use: its terms do not allow storing them, reselling them or training models on them.
- Text returned from web pages, PDFs and search results is outside content. If you pass it to an AI model, treat it as data, not as instructions.
- Terms: <https://agent-data-tools.revmesh2074.workers.dev/terms>. Privacy: <https://agent-data-tools.revmesh2074.workers.dev/privacy>.

## Compatibility

Built and linted with `@n8n/node-cli` 0.56.2 against `n8n-workflow` 2.47. The node is declarative (it only describes HTTP requests), has no run-time dependencies and reads no environment variables or files.

## Development

```sh
npm ci --ignore-scripts
npm run lint     # n8n's node linter, strict mode
npm test         # builds, then checks every operation against the service's real tool inputs
npm pack --dry-run
```

`npm run test:engine` runs every operation through n8n's own request engine with the network intercepted; the header of `test/engine-dry-run.cjs` says how to set it up. `test/fixtures/tools.json` is a snapshot of the tools' inputs and prices from the public OpenAPI document; refresh it with `node test/snapshot-tools.cjs <openapi.json> test/fixtures/tools.json` when the service changes.

Releases are published by the GitHub Actions workflow `publish-n8n-node.yml` with an npm provenance statement, never from a local machine.

## Support

Questions and problems: <https://github.com/Nutshell2000/agent-data-tools/issues>. Never post an API key there.

## License

[MIT](LICENSE)
