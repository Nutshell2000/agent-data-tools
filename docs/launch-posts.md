# Launch posts (drafts for Peter to post)

Every post is honest about where we are: no paying customers yet. Each one offers the 25 free calls and the card packs, which pay into Stripe. Post from your own accounts, one place at a time, and answer comments yourself. Don't post the same text in more than one subreddit on the same day.

---

## Show HN

**Title:** Show HN: Agent Data Tools – 176 pay-per-call tools for AI agents, no signup

**URL:** https://agent-data-tools.revmesh2074.workers.dev

**Text:**

I built a single endpoint that AI agents can call without an account or API key:
- read web pages, PDFs and RSS as clean text
- OFAC sanctions and counterparty checks
- token prices and wallet portfolios
- chain reads on Base, Ethereum, Arbitrum, Optimism and Polygon
- company, domain and email checks
- FX, weather, time and geocoding
- small AI text tools
- OpenAI-compatible chat and embeddings

Most calls cost $0.003. Failed calls are never charged.

Agents can't sign up for things, so the payment is the credential. There are three ways to pay:
- HTTP 402 with x402 (USDC on Base and four other chains)
- MPP (USDC.e on Tempo)
- a $5 prepaid card pack whose key works over HTTP or MCP

Every caller gets 25 free calls, so you can try it from Claude, Cursor or any MCP client:

    https://agent-data-tools.revmesh2074.workers.dev/mcp

It runs as one Cloudflare Worker. Per-tool reliability for the last 7 days is public at /status, and every tool has a free static example (`?sample=1`).

Honest status: about 13,000 unpaid price quotes a day, nearly all from crawlers and directory probes, and no paying customer yet. I'd value feedback from people building agents. Which tools would you actually pay for, and what's missing?

---

## Reddit r/mcp

**Title:** Remote MCP server with 176 data tools, 25 free calls, no signup

**Body:**

`https://agent-data-tools.revmesh2074.workers.dev/mcp`, or `/mcp/<section>` for a smaller server. The sections are prices, chain, web, compliance, ai, everyday and utilities.

**What's in it:**
- read web pages, PDFs and feeds as clean text or Markdown
- OFAC sanctions checks and a one-call counterparty check
- token prices and wallet portfolios
- reads on Base, Ethereum, Arbitrum, Optimism and Polygon
- company, domain and email checks
- FX, weather, time, geocoding, holidays and JSON utilities

**How it works:**
- Every tool has an output schema and read-only annotations.
- The first 25 successful calls are free, and failed calls never count.
- After that it's $0.003 a call, paid with a $5 card pack (5,000 credits) or per call with x402 or MPP if your agent has a wallet.

Feedback welcome. In particular: which tools are noise, and which would you want added?

---

## Reddit r/LocalLLaMA

Lead with the OpenAI-compatible endpoints:

**Title:** Pay-per-call OpenAI-compatible endpoint (chat, responses, embeddings) plus 170 data tools, no account

**Body:**

`POST /v1/chat/completions`, `/v1/responses` and `/v1/embeddings` at https://agent-data-tools.revmesh2074.workers.dev:
- Llama 3.1 8B at $0.003 a call
- Llama 3.3 70B or gpt-oss-120b at $0.01
- BGE-M3 embeddings at $0.003

You pay per request with x402 or MPP (USDC), or with a $5 prepaid card key. There's no subscription, no account, and no API key to request. The same key also unlocks 170 data tools (web and PDF reading, chain reads, sanctions checks, FX, weather) over HTTP or MCP.

It's useful when an agent needs a model or a lookup and you don't want to hand it your main provider key.

---

## X / Bluesky (short)

Agents can't sign up for APIs, so I made the payment the credential.

176 tools at one URL: web and PDF reading, sanctions checks, token and wallet data, chain reads, FX, weather, OpenAI-compatible chat.

- $0.003 a call via x402, MPP or a $5 card pack
- 25 free calls
- no account

https://agent-data-tools.revmesh2074.workers.dev
