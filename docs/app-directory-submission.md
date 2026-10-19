# Claude and ChatGPT directory submission kit

Paste-ready answers for the two app directories. Peter submits (the Claude directory needs a paid Claude
plan at claude.ai/directory/manage; ChatGPT apps need OpenAI business or individual verification).
Update docs/listings.md when submitted. Facts only: no usage, customer or uptime claims beyond /status.

## Connection

- Server URL: `https://agent-data-tools.revmesh2074.workers.dev/mcp/account`
- Transport: Streamable HTTP
- Authentication: OAuth 2.1 with dynamic client registration and PKCE (S256); metadata at
  `/.well-known/oauth-protected-resource/mcp/account` and `/.well-known/oauth-authorization-server`
- Sign-in page: paste a prepaid credit key, or "Continue with free calls" (no account, no key)
- Privacy: `/privacy` · Terms: `/terms` · Support: `/support` (email in the page)
- Icon: `/logo.png` (512×512) · Preview image: `/og.png`

## Name and descriptions

- Name: Agent Data Tools
- One line: Live data lookups for AI assistants: token prices, sanctions checks, chain data, web and PDF reading.
- Description: Agent Data Tools gives your assistant read access to live public data: token prices and wallet
  values from on-chain pools, OFAC sanctions screening and a one-call counterparty check, blockchain reads on
  Base, Ethereum, Arbitrum, Optimism and Polygon, company and domain lookups, and clean text from web pages,
  JavaScript apps, PDFs and RSS feeds. Every signed-in person gets 25 free calls; after that, prepaid credits
  bought on our website pay per call (most calls $0.003). Failed calls are never charged. Nothing is bought,
  sent or changed on the user's behalf: the tools only read data.
- Category: Data / Research (secondary: Finance)

## How payment works (for the reviewer's policy questions)

- No purchase happens inside the assistant. Credits are bought on our own website (`/credits`, Stripe), and
  the user signs in with the resulting key. Directory users can use 25 free calls without paying.
- Tools never move funds, sign transactions or place orders. They read public data and return JSON.
- Each successful call spends credits from the signed-in user's own prepaid balance; failed calls refund
  automatically. That is why tools are annotated readOnlyHint=false (a call can spend credits) while
  destructiveHint=false and openWorldHint=true. If the reviewer prefers readOnlyHint=true for data tools
  that only spend prepaid credits, it is a one-line change in `src/mcp-contract.ts`.

## Reviewer test instructions

1. Add the connector with the URL above and sign in with "Continue with free calls".
2. Try the example prompts below. Each uses one or two of the 25 free calls.
3. AI, rendering, screenshot, transcription and search tools are excluded from free calls and answer with a
   clear message. To test those, use the reviewer key provided in the submission form (Peter: buy a $5
   pack, paste the key into the form's private notes, and record it as an owner purchase, not revenue).

## Example prompts (each works with free calls)

1. "Is the address 0x098B716B8Aaf21512996dC57EB0615e2383E2f96 on the OFAC sanctions list?" → sanctions_check
2. "Before I pay 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on Base, check the counterparty." → check_counterparty
3. "What is the current USD price of WETH on Base?" → price_token
4. "Read https://example.com/ and summarize the main points." → extract
5. "What are the latest 5 posts on https://github.blog/feed/?" → feed
6. "What's the ETH balance of vitalik.eth on Ethereum?" → ens + eth_balance

## Tool list

`GET /.well-known/mcp/server-card.json` lists every tool with its title, price and output schema; the MCP
`tools/list` on the server URL returns the same tools with titles and annotations.
