@AGENTS.md

## Where things stand (2026-10-18)

- Production runs 1.23.0 (167 tools, commit 413ae01), deployed 2026-10-18 ~19:00 UTC by the local
  Claude Code session through the guard. check:live 167/167, AgentCash discovery 1.7.5 all checks true,
  x402scan lists 167/167, tag v1.23.0 published to the MCP Registry. Baseline: docs/sales-baseline.md.
- Deploys need Cloudflare access, which only the owner's PC has: prepare PRs and a runbook here, and the
  local session deploys with `npm run deploy:production -- --expected-version <live uuid>`.
- Sales plan: flagship tools /check/counterparty and /extract/rendered, free ?sample=1 previews,
  readable 402 bodies, MCP bundles at /mcp/<section>. Directory copy: docs/listings.md.
- OFAC mirror release `ofac-latest` is published by .github/workflows/ofac-mirror.yml.
- Ownership proof is live (PR #84, deployed 2026-10-18): Coinbase Wallet ERC-1271 signature in
  OWNERSHIP_PROOFS, verified on Base by `npm run check:ownership` in CI. AgentCash discovery reports
  trustTier ownership_verified; x402scan re-registered 167/167.
- Pending on the owner: directory submissions, revoking the Cloudflare token pasted in chat.
- After a tool change: bump server.json and MCP_SERVER_VERSION, run `npm run update:mcp-contract`
  last (after any description edit), then `npm test` and `npm run check:mcp-contract`.

## Sales and payments work of 2026-10-19 (PRs #114–#125)

Deploy these together after they merge, then follow "After deploying" below.

- Measurement:
  - `/metrics/callers` → `{ http, mcpConnections }`: requests by calling software (User-Agent family)
    and outcome, plus MCP connections by client app and mode (open, key or account). Only software
    names are stored.
  - `/revenue` adds `cardCredits` (purchases, topUps, buyers, USD bought and spent) only with
    `Authorization: Bearer <REVENUE_TOKEN>`.
  - Weekly table: docs/sales-baseline.md.
- Card credits:
  - Top-up links (`client_reference_id=topup_<sha256 of key>`) add credits to an existing key. They
    appear in out-of-credits responses, `/credits/balance` and the new-key page.
  - MPP top-up: send the existing key in `X-API-Key`.
  - One-time low-balance warning below 200 credits.
  - `POST /credits/rotate` replaces a leaked key.
  - `/credits` offers no pack while `STRIPE_READ_KEY` is unset.
- Free calls:
  - A keyless `/mcp/account` sign-in no longer refills them.
  - Open `/mcp` tells cloud-app users (shared addresses) to use `/mcp/account` for their own.
- Secrets (the owner sets them with `npx wrangler secret put <NAME>`; never in chat or Git):

  | Secret | Status | What it controls |
  |---|---|---|
  | `STRIPE_READ_KEY` | Required | Card claims; without it no pack is offered |
  | `REVENUE_TOKEN` | Optional | Private card-sales figures on `/revenue` |
  | `STRIPE_MPP_KEY` | Optional | Agents buy packs themselves over MPP |
- After deploying:
  1. `check:live` and `node scripts/check-agent-discovery.mjs <discovery dist>`.
  2. `curl <origin>/credits` shows `cardReady: true` and 3 packs.
  3. `curl <origin>/metrics/callers` returns both keys.
  4. Fill in the first scorecard row in docs/sales-baseline.md.
- Waiting on the owner: should the 26 tools still at $0.002 (`/extract`, AI text, fx, weather…) move to
  $0.003? Keep `/extract` at $0.002 as the entry price if so.

## Payment visibility and the staging proof (1.35.0, 2026-10-19)

Audit result of 19 Oct: the paywall, facilitator round-trip, card credits and MCP all work, but no buyer
client has called since 14 Oct; the traffic is directory crawlers. The only paying bots read the Coinbase
Bazaar, which lists a tool only after its first settled payment (2 of 175 are listed). What changed:

- Every refused or failed payment is logged (`wrangler tail`) with its reason and marked in the funnel:
  `refused_amount`, `refused_network`, `refused_format`, `facilitator_unavailable`, plus the existing
  `verification_failed` / `settlement_failed`. `/metrics/callers` counts refused v2 attempts as `v2_payment`
  (v1 as `v1_payment`). Read these on Monday before judging conversion: an attempt that dies in `refused_*`
  is our bug or a stale directory price, not a buyer who changed their mind. The v1 path accepts the
  variations real clients send (version as a string, network as a CAIP-2 id, value as a number at or above
  the quote). On 19 Oct a real, unidentified browser-based v1 buyer failed four times on `/eth/gas` before
  any of this was deployed (the owner confirmed it was not their own test); watch `wrangler tail` for the next one.
- The published client example (homepage, llms.txt, OpenAPI x-guidance) caps payments at `ORDINARY_PRICE`
  ($0.01 since 22 Oct, `src/discovery.ts`), so an agent that copies it can pay for every ordinary tool. Keep that
  constant equal to the catalog's common price.
- Paused `/buy/*` paths answer 503 before the paywall and the counters.
- **Staging on Base Sepolia**: `wrangler.staging.jsonc` deploys `agent-data-tools-staging` with the keyless
  testnet facilitator and faucet USDC (`.test-wallet.json`, git-ignored; address from
  `node scripts/pay-test.mjs address`; refill at https://faucet.circle.com). After every release, deploy it
  and prove all three payment paths; none of this touches mainnet or counts as income:

  ```sh
  npx wrangler deploy -c wrangler.staging.jsonc
  node scripts/pay-test.mjs https://agent-data-tools-staging.revmesh2074.workers.dev/btc-fees
  node scripts/pay-test.mjs https://agent-data-tools-staging.revmesh2074.workers.dev/btc-fees --v1
  node scripts/pay-test.mjs https://agent-data-tools-staging.revmesh2074.workers.dev --mcp btc_fees
  ```

  Each prints `settle:` with `success: true` and a transaction; `curl <staging>/revenue` then shows the
  settlements. The script refuses any mainnet network.
- **After any price change** (and after adding tools): run `node scripts/update-402index-prices.mjs --dry`
  then without `--dry` (token in `.402index-token`, git-ignored; copy it from `C:\MoneyWallet\x402-api`),
  `node scripts/register-402index.mjs` for new paths (10 per hour), and re-register the server on x402scan
  so its cached copy and prices match. Directories that still show an old price cause `refused_amount`
  attempts from v1 clients. Prices are frozen at the current catalog until 8 Nov 2026 (the x402 stop-rule
  check) unless the owner decides otherwise.
- Decisions that stay with the owner (not code): Bazaar seeding (one self-settled call per tool through the CDP
  facilitator; the ledger marks self-payments, the owner's rule currently forbids it), app-directory submissions
  (`docs/app-directory-submission.md`), and whether the 19 Oct browser payment attempts on `/eth/gas` were
  the owner's own tests.

## Per-call MPP on the tools: evm on Base ON (1.36.0), Tempo ON (1.37.0)

- `src/lib/mpp-evm.ts` (on by default, `MPP_EVM` in `wrangler.jsonc`): each tool's 402 also offers `WWW-Authenticate: Payment`
  evm/charge, an EIP-3009 USDC authorization on our x402 network to PAY_TO, verified and settled through the same facilitator
  as x402 (settle only after the tool succeeded, Bazaar extension sent with the settlement, receipt in the ledger). It exists
  so MPPScan lists the 175 tools without a first settled payment, at no cost. Staging proof after every release:
  `node scripts/pay-test.mjs <staging>/time?zone=UTC --mpp-evm`. After deploying, re-register the origin at mppscan.com/register.
- Tempo proof on staging (Moderato testnet, faucet pathUSD via `tempo_fundAddress`): `node scripts/pay-test.mjs <staging>/time?zone=UTC --tempo`
  settled on 2026-10-20 (tx 0xb3c18072…). Staging has `TEMPO_NETWORK=testnet` and a test-only `TEMPO_PAY_TO`; production stays off.
- `src/lib/mpp-tempo.ts`: a second challenge, tempo/charge (USDC.e on Tempo mainnet, pull mode, public RPC rpc.tempo.xyz),
  broadcast only after the tool succeeded. ON since 1.37.0: `TEMPO_PAY_TO` = PAY_TO in `wrangler.jsonc`, the owner's decision of
  2026-10-20 (option A, docs/mpp-per-call.md). Empty switches it off. MPP buyers (AgentCash, Poncho, MPP credits) pay on Tempo,
  so this is the method that serves them; watch `wrangler tail` for `mpp tempo` lines and the Tempo RPC (`facilitator_unavailable`).
- Credit packs `/credits/buy/*` answer GET only, and their Stripe challenge names a recipient (the MPPScan warnings).

## Discovery files (1.36.1)

- `/discovery/resources` (src/lib/discovery-index.ts) is our own Bazaar-shaped index of every tool with exact USDC terms per network, paged (`limit` up to 500, `offset`); `/.well-known/x402.json` aliases `/.well-known/x402`. Directories that crawl sellers directly read these; the Coinbase Bazaar still needs a first settled payment per tool.
- Directory PRs opened 2026-10-20: tempoxyz/mpp#1095 (mpp.dev services, 38 routes, evm/charge) and Pazificateur69/gold-402#1. Circle Agent Marketplace form (forms.gle/7YFzvdmMcn1JH5tF6) is the owner's to send (indemnification clause).

## Discovery order and page size (21 Oct 2026)

- `/discovery/resources` and `/.well-known/x402` list tools in `salesOrdered()` order (src/lib/discovery-index.ts):
  - `SALES_FIRST` comes first: payee and risk checks, prices, chain reads, and the data tools with competitor demand on the Bazaar.
  - Then the rest of the catalog in its own order, with toys last.
- Without `limit`, the first page holds the whole catalog (`DISCOVERY_PAGE_LIMIT`, 500). It used to be 100 of 179, so /sec/filings, /airport/status, /hyperliquid/market, the utilities and AI never reached a crawler that reads only page 1.
- Why: the paying bot of 21 Oct reached us through our Bazaar listings and picked /check/counterparty (then 98th) by task from these files.

## OpenAI-compatible chat (1.38.0)

- `POST /v1/chat/completions` and `GET /v1/models` (src/lib/openai-chat.ts) are a front for `/ai/chat`: the body is mapped to the tool's query and forwarded through the same middleware (`app.fetch`), so x402 v1/v2, MPP evm/tempo, card credits and free calls apply unchanged at the /ai/chat price. An unpaid or empty-body POST returns the /ai/chat 402 quote (validators expect 402, never 400); invalid input with a payment header is refused 400 before anything is forwarded. Not an MCP tool, not in /discovery/resources, not in the RapidAPI document. Staging proof: `node scripts/pay-test.mjs <staging>/v1/chat/completions --post-json '{"messages":[{"role":"user","content":"Say hi"}]}'`.

## The `only` result filter (1.38.2)

- Every tool accepts `only=<comma-separated top-level keys>` over HTTP and MCP (src/lib/fields.ts, applied in index.ts and mcp.ts); unknown keys are ignored and no match returns the full result. The ten tools without inputs of their own declare it in ENDPOINTS (endpoints.ts, after the array), so every paid route has an input schema for AgentCash and MPPScan. `exampleParams()` never uses it. Do not add a tool parameter named `only`; `fields` is taken by /ai/extract-json.

## Larger chat models (1.39.0)

- `/ai/chat-large` ($0.01, src/routes/ai-text.ts LARGE_CHAT_MODELS): Llama 3.3 70B (default) or gpt-oss-120b (Apache 2.0) on Workers AI, same free daily allowance (503 uncharged when used up). `/v1/chat/completions` routes by the OpenAI `model` string: names with 70b, llama-3.3, gpt-oss or 120b go to /ai/chat-large, everything else to /ai/chat; its x-payment-info is therefore dynamic ($0.003 to $0.01). 176 tools.

## OpenAI-compatible embeddings (1.39.1)

- `POST /v1/embeddings` (src/lib/openai-embeddings.ts) is the same kind of front as the chat one, for `/ai/embed` ($0.003, BGE-M3, 1,024 dimensions): one input string per request because one payment pays for one call; arrays with more than one item are refused 400 before anything is forwarded. Unpaid or empty POSTs get the /ai/embed 402; GET is 405.

## GET on the OpenAI fronts (1.40.0)

- Zero.xyz indexed every route, including the three POST-only /v1 fronts, as GET, so agents it routes would have hit 405. The fronts now also take GET (and HEAD) with the same inputs in the query (`chatBodyFromQuery`, `embedBodyFromQuery`, `responsesBodyFromQuery`; `requestBody()` in src/lib/openai-chat.ts picks query or JSON by method) and declare a `get` operation in OpenAPI beside the `post` (`openApiGetVariant`). A bare GET is quoted like a bare POST; a paid GET without inputs is refused 400 before anything is forwarded. `scripts/register-402index.mjs` now sees priced GET operations on the /v1 paths, so they can be registered there too.

## Chain logs, RPC fallbacks and outside-source retries (1.41.0)

- `<chain>/logs` scans newest-first in windows of 10, 40, 160… blocks (`recentLogs` in src/routes/chain-reads.ts) and stops at 100 logs: the Base USDC example went from a 16.5 s timeout to about 130 ms. `truncated` is also true when the scan stopped early.
- Tenderly's public gateway is the last RPC fallback on all five chains and QuickNode's public endpoint on Polygon (src/lib/rpc.ts); BlastAPI has shut down on Polygon and drpc's free plan refuses log scans there. Measure them from Cloudflare after a deploy before reordering.
- `getJson` (src/family.ts) retries a 429 or 503 once after a short wait, honouring `Retry-After` up to 2 s, inside the same timeout. Tests: tests/upstream-resilience.test.cjs.
- `npm run smoke:examples` forwards outbound requests through Node's fetch without the hop-by-hop headers workerd sets (`content-length`, `host`, `connection`, `cf-*`); with them every POST failed with `UND_ERR_INVALID_ARG` and all chain reads looked dead. `SMOKE_DEBUG=1` logs outbound failures. 158/158 examples pass on the PC (2026-10-20).

## OpenAI Responses API shape (1.39.2)

- `POST /v1/responses` (src/lib/openai-responses.ts) maps the Responses body (input string or role/content items, instructions, max_output_tokens) onto the chat-completions body and runs through `completeChat()` in src/lib/openai-chat.ts, so the model routing, prices, quote and refusal rules are the chat front's; the answer is one completed message in `output` plus `output_text`.

## First-payment readiness (2026-10-20, the owner: no self-funded seeding yet, no Solana)

Why there are no payments: paying bots shop the Coinbase Bazaar, which lists a tool only after a settled CDP
payment and drops it after 30 days without one (we have at most `/btc-fees`). Tanod's 9 Oct snapshot: chain reads
are the top paid category, onesource's identical reads at $0.001–0.005 draw 400–700 one-call payers each.
Until earnings fund seeding (PR #133), every organic first payment must convert and list cleanly:

- Settlements name the tool without the caller's query (`withoutQuery` in src/lib/facilitator.ts), so a first
  payment on `/eth/balance?address=…` lists `/eth/balance`. Quotes keep the exact URL: `clients/chain/core.mjs`
  checks it. The MPP evm path already did this (src/lib/mpp-evm.ts).
- `npm run smoke:examples` runs every paid tool on exactly its published example (`exampleParams`, the Bazaar
  `input`) through the Worker with the paywall off. Run it on the PC (this cloud container cannot reach the
  upstreams) before each deploy; every failure is a first payment lost. AI and rendering tools: check on staging.
- PC session, next deploy (main ≥ PR #161, 1.40.0): `npm run smoke:examples` first and fix any failing example;
  run the full seed order on staging (docs/bazaar-seeding.md, faucet USDC) as the paid proof; then deploy through
  the guard and re-register x402scan. Production seeding waits for earnings (`--budget <earned USD>`).
- Data post that sells `/x402/check`: `node scripts/bazaar-quality-report.mjs --sample 300 --json survey.json`
  (unpaid GETs only; keep survey.json out of Git), fill docs/bazaar-quality-post.md, the owner publishes.
- Not built, on purpose: GDELT news and Stooq quote tools (both timed out from Cloudflare on 20 Oct; an
  unreliable upstream is a lost first payment). Web search stays parked until the owner picks a paid key.

## Deploy checklist for the 20 Oct conversion work (PRs #161–#174)

Production is 1.40.0 and lacks these. After `npm run smoke:examples` and the guard deploy, verify:

```sh
O=https://agent-data-tools.revmesh2074.workers.dev
# Browser visitors get the tool page (402, PAYMENT-REQUIRED still set), not the "@x402/paywall" note:
curl -s -H 'Accept: text/html' -H 'User-Agent: Mozilla/5.0 Chrome/130' -D - "$O/weather" | grep -iE '^HTTP|payment-required|Run it free'
# The bare-link trial uses the example inputs and returns data:
curl -s -H 'Accept: text/html' -H 'User-Agent: Mozilla/5.0 Chrome/130' "$O/weather" | grep -o 'href="/weather?[^"]*trial=1"'
# JSON clients unchanged:
curl -s -H 'Accept: application/json' "$O/weather" | head -c 200
# Homepage shows Get started first:
curl -s -H 'Accept: text/html' "$O/" | grep -c 'Get started'
# A browser free trial renders as a page with the free calls left (PR #173):
curl -s -H 'Accept: text/html' -H 'User-Agent: Mozilla/5.0 Chrome/130' "$O/time?zone=UTC&trial=1" | grep -o 'free calls left'
# Indexable tool pages (PR #174): 200, in the sitemap, then tell IndexNow engines about them:
curl -s -o /dev/null -w '%{http_code}\n' "$O/tools/check-counterparty"
curl -s "$O/sitemap.xml" | grep -o '<loc>' | wc -l   # about 186
node scripts/indexnow.mjs
```

Search pages: every tool has `/tools/<slug>` (src/lib/tool-pages.ts; slug = path with `/` as `-`), a 200 page with
canonical URL, schema.org WebAPI data, inputs, curl, example result and the free-trial/card buttons; `/tools`
lists them and the sitemap carries them all. The tool URLs themselves stay 402 (not indexable). Google: the owner
adds the origin in Search Console as a URL-prefix property with HTML-tag verification and gives a session the
token (it is public; it goes in the homepage head), then submits `/sitemap.xml` there.

Then re-register x402scan/MPPScan (`npx agentcash register $O`) and post the Show HN from docs/launch-posts.md:
people it sends now land on a page that converts (free trial, card from $5) instead of a dead end.

## Free-call exhaustion in the funnel (1.41.x)

- /revenue funnel counts `free_exhausted`: a caller who asked for a free call (HTTP `trial=1` or MCP) after using all 25, or after the daily total ran out, and was given the payment request instead. It is the buying moment; compare it with card purchases and settlements before changing the free allowance.

## Durable Objects write budget (2026-10-20)

- The account is on the Workers free plan: Durable Objects allow 100,000 rows written a day (reset 00:00 UTC). On 20 Oct per-request counters (`bump`, `bumpMcpClient` and per-request funnel rows for crawler quotes) used it up by ~15:30 UTC; after that every write failed, so free calls answered 500 and card-credit and Tempo calls could not be served. Counters and the counted-only funnel stages (`COUNTED_ONLY` in src/lib/funnel.ts: visit, quote, free_call, free_exhausted, credits_call) are now added up in memory in the Metrics object and written by an alarm at most every 30 s (`flush` in src/metrics.ts); reads add the unwritten counts in memory (`listMerged`) and never write, because a failed write resets the object and fails every request in flight. Settlements, credits, free-call allowances, OAuth and MPP replay state still write immediately. If free calls cannot be counted, the caller gets the normal 402. After a "Exceeded allowed rows written" error the object stops trying buffered writes until 00:00 UTC (`writesBlockedUntil`, module level so it outlives the object reset); counts stay in memory meanwhile. Do not add per-request writes for unpaid traffic.

- Durable Object requests are capped too (100,000 a day on the free plan; 55,600 by 16:20 UTC on 20 Oct). Unpaid counter updates (`queueMetricBump` for non-paid outcomes, counted-only funnel stages, MCP connections) are collected per isolate and sent in one `ingest` call at most every 10 s or 500 items (src/lib/metrics-batch.ts); paid outcomes and payment-stage funnel events still go at once. Report routes call `sendBatchNow` first. Usage per day: Cloudflare dashboard → Durable Objects (requests, rows written, duration).

- **Counters must not wait for the alarm alone (21 Oct).** An idle Metrics object is evicted with its memory, and the alarm then wakes a new, empty instance. So no paid call was ever counted in production /metrics: bot C's $0.03 is in /revenue but not in /metrics. Staging lost every count for 21 Oct.
  - A paid bump now writes at once.
  - Any update writes at once when the object's last write is 30 s old or more, so a quiet object writes its first update straight away and a busy one at most once per 30 s. The alarm only covers the tail of a busy spell.
  - Each isolate sends its own unpaid batch 10 s after the first item, inside `waitUntil`, so a batch no longer waits for a later request in the same isolate (src/lib/metrics-batch.ts). It is still one Metrics call per batch. A generation guard and `wake` stop a second send.
  - `/metrics` sends `X-Metrics-State` (instance start, lastFlushAt, pendingSince, alarmSet, writesBlockedUntil, lastWriteError). Read it before trusting the counts.
  - Proven on staging:
    - A paid row survived an instance change (13:41:53 → 13:45:04).
    - A lone quote with nothing after it was counted, and read back from a new instance (14:31).
  - `/revenue` stays the money record; these are traffic counters.

## People on the buying pages (page_view, referral)

- A browser GET (`isBrowser`) that returns 200 on `/`, `/tools`, `/tools/<slug>`, `/credits` or `/credits/claim` counts `page_view` at that path, and `referral` at `/from/<family>` (google, bing, duckduckgo, chatgpt, claude, perplexity, github, reddit, hackernews, glama, mcpso, x402scan, zero, yandex, other, internal, direct; `referrerFamily` in src/lib/funnel.ts). Only the family name is kept. Both are counted-only and batched. Read them in the /revenue funnel: page views, then free trials (`free_call`), `free_exhausted`, card purchases.

## "Try it with your own inputs" (browser pages)

- `tryForm()` (src/lib/try-form.ts) puts a plain GET form, with no script, on `/tools/<slug>`, on the 402 page a browser gets, and on the free-trial result page ("Run it again with other inputs"). It covers only tools in the free calls.
  - Fields are the required inputs plus the published example's inputs, at most 6, never `only`.
  - Fields are prefilled with what the visitor sent, or else the example. The form submits to the tool URL with `trial=1`.
- A browser trial that the tool refuses with a 4xx gets `browserTrialErrorPage`: the tool's error message, "nothing was charged and this did not use a free call", and the form with what the visitor typed. Code still gets the JSON error.
- Before this, a visitor could only run the canned example (London, one fixed wallet).
- Tests: tests/browser-402.test.cjs.

## Published examples must not point at our own origin (1.44.1)

- `/sitemap`'s example was our own `/examples/sitemap/source.xml`. It returns 200 to a browser, but a request from inside Cloudflare (a Worker fetching it, as the tool does) got 404. So every first try of the published example failed in production (/status: 0 of 2), even though `npm run smoke:examples` passed on the PC.
- The example is now `https://www.sitemaps.org/sitemap.xml` (8.6 KB, 84 URLs, the protocol's own site), proven on staging with a paid testnet call on 2026-10-21.
- `/x402/check` fetching our own dynamic tool URL does work from Cloudflare; only the static asset path failed.
- Prove any new example that fetches a URL on staging (`scripts/pay-test.mjs`), not only with the local smoke run.

## Search copy on tool pages

- `TOOL_SEO` (src/lib/tool-seo.ts) gives 34 likely-searched tools (14 added on 21 Oct: email, company, weather, screenshot, domain, domain-report, sec/filings, hyperliquid/market, airport/status, eth/balance, eth/gas, geocode, extract/rendered, url/meta) a search-phrased title and h1, a "When to use it" list and a FAQ (also published as schema.org FAQPage). The page adds the "How do I pay?" answer itself from its free-call flag. Copy may only restate what the tool's description and limits say. `/tools/<slug>` no longer offers "Run it free" on capacity-limited tools (AI, rendering, transcription, search), which are outside the free calls. Tests: tests/browser-402.test.cjs.

## Buyer-client compatibility and discovery conformance (cloud audit, 2026-10-20)

- Audit on staging with an unfunded throwaway key. Each client got as far as a funds refusal:
  - `@x402/fetch` 2.28 (and AgentKit, which wraps it), `x402-fetch` and `x402-axios` 1.2: all four routes.
  - mppx 0.13 tempo/charge.
  - mppx evm needs `currencies:[evm.assets.base.USDC], networks:[8453]` from the buyer, because the challenge cannot carry the EIP-712 token name and version.
- **Tempo challenge first.** AgentCash's client bundles mppx 0.8, which reads only the first `Payment` challenge and pays only on Tempo. With evm first, its buyers were refused for an "unsupported token". The OpenAPI `protocols` list Tempo first too. Keep this order.
- **MPP evm anti-replay claim.** If the Durable Object cannot write (daily write budget), the call now answers an uncharged 503 with `Retry-After`. It used to be an unhandled 500 before verify.
- **`x-payment-info` carries both shapes.** AgentCash and x402scan read `price` and `protocols`. MPP discovery (mppx and mpp.dev) reads `offers[]`, one per MPP method, with the amount in base units and `null` for the dynamic chat fronts. The builder is `paymentInfo()` in src/lib/payment-info.ts.
- **Bazaar keeps the first 5 tags.** `listingTags()` (src/lib/bazaar-extension.ts) puts the specific tags first. Bazaar inputs carry `examples` and, for 0x address and hash inputs, a `pattern`.
- **The v1 body lists `queryParams`.** Without them, a v1 first payment would list the tool with no inputs.
- **OpenAPI 200 schemas.** `completeResponses()` gives every 200 response a schema; the `/v1` GET variants reuse the POST response.
- Validators, all clean: AgentCash discovery check per route, x402scan probe, `@x402/extensions` 2.28 and `mppx discover validate`. x402scan skips the three `/credits/buy/*` packs because they take MPP only; that is expected.
- **The `/v1` fronts quote under their own name** (`asFrontQuote` in src/lib/openai-chat.ts).
  - The x402 v2 `resource` (URL without the query, plus the front's description) and the v1 body's `resource` name `/v1/chat/completions`, `/v1/responses` or `/v1/embeddings`, never `/ai/chat?prompt=…`. A settled front is therefore listed under its OpenAI path.
  - The payment terms and the Bazaar extension stay the tool's. `@x402/core` matches a payment on its accepted terms, never on the resource, and it refuses echoed extensions that differ from what the route advertises (`extension_echo_mismatch`), so the extension must not be rewritten.
  - `X-Tool` on the quote names the tool, and so the price, that the request maps to.
  - Proven with a real `@x402/fetch` client in tests/openai-chat.test.cjs.

## Buyer ergonomics (1.42.0)

- **Inputs that need nothing, or what agents type:**
  - `/time` defaults to UTC when no zone is given; a bare GET is the smallest paid end-to-end test.
  - `/weather` takes `city`: a built-in table of about 50 major cities, then Wikidata's best match. The published example is `city=London`, which makes no Wikidata call.
  - `/price/token` takes `symbol`, and `/price/tokens` takes `symbols`. The per-network ticker table `TICKERS` in src/routes/prices.ts was checked against `symbol()` on 2026-10-20. ETH and BTC map to WETH and cbBTC/WBTC.
- **POST to a tool with a flat JSON body** is the GET with those fields in the query. It is forwarded before tracing and metrics, and an empty or unreadable body still gets the quote. The `/v1` fronts and MCP are unaffected.
- **Copy:**
  - `/extract` opens with "Fetch any public web page URL…".
  - Chain reads name the JSON-RPC method and the tokens.
  - `/sanctions/check` opens as a wallet screen before paying, and returns `verdict`: `block` on a listed address, `review` on a name match, `pass` otherwise.
  - The repo's description limit is 450 characters (tests/listing-quality.test.cjs).

## Open registries (2026-10-20, cloud session)

- **Ultravioleta DAO Bazaar:** 100 tools registered on 2026-10-20 through the keyless `POST https://facilitator.ultravioletadao.xyz/discovery/register`. All returned 201.
  - Order: chain reads, then prices, compliance, web and everyday data. AI tools and toys were left out.
  - Its catalog feeds Dexter's crawler. The register script is in the cloud scratchpad. Re-run it after price changes (about 5 a minute, 100 per host).
- **Dexter (x402gle / OpenDexter):** `npx @dexterai/opendexter audition <origin> --json` answered 500 ("Catalog flush could not persist 3 resource writes") on 2026-10-20. Retry it.
  - Auditioning a single tool URL makes Dexter pay for a test call from its own wallet. That settles through CDP and lists the tool on the Bazaar. Log it as a listing proof, never as revenue or demand.

## When the Durable Object is down (2026-10-20)

On 20 Oct the account's Durable Object quota ran out by about 18:00 UTC, and every call to the object threw until 00:00 UTC (`/status`, `/metrics/callers` and `/revenue` answered 500). Each payment path now fails safe:

| Path | While the object is down |
|---|---|
| x402 v2 and v1 | Pay and serve as usual; only the ledger receipt is lost, logged for reconciliation |
| MPP evm | Uncharged 503 before verify |
| MPP tempo | Uncharged 503 before the tool runs (`alreadySettled` returns null) |
| Card-credit calls | Uncharged 503 over HTTP; an error result over MCP (`spendCredits` caught) |
| MPP credit packs | The store is checked before Stripe is called. If the write still fails after the charge, the buyer gets a 503 telling them to repeat the request with the same credential. mppx's Stripe idempotency key (challenge and token) prevents a second charge, and the grant is idempotent on the PaymentIntent. The reference is logged |

The report routes (`/status`, `/revenue`, `/metrics`, `/metrics/callers`) answer a 503 with `Retry-After: 600` that says the tools and x402 payments keep working (`fromMetrics` in src/index.ts), not a bare 500.

Tests: tests/outage-resilience.test.cjs, tests/report-outage.test.cjs. The lasting fix is the Workers Paid plan ($5 a month), which raises the Durable Object limits. That is the owner's decision.

## Correctness under concurrency and odd inputs (cloud edge audit, 2026-10-20)

- **viem clients are per request** (`requestClient` in src/lib/rpc.ts, keyed on the request's trace). Module-level clients shared viem's block-number cache and multicall batches across requests. workerd cancels promises that cross requests, so concurrent chain calls hung: 3 of 6 concurrent `/wallet` calls returned 500 "Worker's code had hung" before the fix, and none after. Never cache a viem client at module level.
- **Address inputs are normalized in the TOOLS wrapper** (`normalizedInput` in src/tools.ts). Inputs named address, addresses, token, tokens, owner, spender, wallet, contract or pool, holding 40 hex characters with or without `0x`, become `0x` plus lowercase. Upper-case or mis-checksummed addresses used to give misleading 502s and 422s, and a listed address sent without `0x` read "pass" on `/sanctions/check`. That tool now refuses a malformed `0x` address.
- **Upstream timeouts and unreachable sources** that a tool does not catch answer an uncharged 502 over HTTP and MCP (`isUpstreamFailure`), not a 500. `/trade-insight` keeps its inner 4xx errors.
- Tests: tests/correctness.test.cjs.

## How agents pick and call tools (1.43.0, cloud agent-eye and edge audits)

- **MCP examples.** Each tool description's "Example: …" is the published example call (`exampleParams`). It no longer pairs alternatives that override each other: weather showed city with lat/lon, and price_token showed symbol with address. It never shows `only=`.
- **MCP inputs.** String inputs whose example is a flag or a number (fullPage, plus, sortKeys) also accept JSON booleans and numbers. `flag()` (src/family.ts) reads true, 1, yes and on in any case.
- **Inputs fixed:**
  - `/date/add` declares years, weeks, hours and minutes. MCP had dropped them, so callers were charged for an unchanged date.
  - `/date/info` no longer requires `date`.
  - `/holidays` takes UK, USA and English country names.
- **Chains and tokens.**
  - `chain` accepts ethereum, arbitrum, optimism, matic and chain ids (`CHAIN_ALIASES`, `allowedValue`), including in the pre-paywall enum check.
  - `<chain>/token-balance`, `token-info` and `token-transfers` take tickers. `src/lib/tickers.ts` is shared with the price tools and now has a Polygon row plus SOL (uSOL), XRP (cbXRP) and BNB/POL on Ethereum, all checked on-chain.
- **Inputs agents send under other names** are read when the real input is missing (`INPUT_ALIASES` in src/tools.ts): wallet for address, tx for hash, latitude for lat, tz for zone, q for name, and so on. Short inputs are trimmed, and numbers accept thousands separators.
- **Copy.**
  - Base-only tools (token, wallet, wallet_audit) say so and name their cross-chain siblings.
  - `/summarize` points PDFs to pdf_text.
  - token-transfers states how much time `blocks` covers on each chain.
  - MCP instructions include a pick-by-task map and the `/mcp/<section>` servers. The signed-in instructions must not mention crypto (tests/oauth).

## New tools (1.44.0, 179 tools; the owner approved on 2026-10-20)

- **`/sec/filings`** (src/routes/gov-data.ts): SEC EDGAR filings by ticker or CIK, optionally one form type.
  - The data is public information under sec.gov's privacy notice.
  - SEC's fair-access policy requires a User-Agent naming a contact; ours names the public support address. Keep requests under 10 a second.
  - The 800 KB ticker map is cached for a day at the edge, and submissions for 10 minutes.
  - Before relying on it, check from staging that SEC does not block Cloudflare's egress IPs.
- **`/airport/status`** (gov-data.ts): FAA's live National Airspace System status (US federal work) for one IATA code, or for the whole country.
  - The XML is parsed with small regexes, because Workers have no DOMParser.
  - Cached 60 s.
- **`/hyperliquid/market`** (src/routes/hyperliquid.ts): perpetuals price, hourly funding rate and its APR, open interest and 24 h volume, for one coin or the top 20.
  - The terms of Hyperliquid's public info API say nothing about resale; the owner approved it anyway.
  - Snapshots are kept 15 s as plain module data (never a shared promise), because of the 1,200-weight-a-minute limit per IP.
- **Demand:** competitors with the same data had 29 (EDGAR), 23 (FAA) and 56/48 (Hyperliquid) paying bots on the Bazaar.
- **Rejected on their terms:** Chainlink feeds (ToS §3 forbids resale), Polymarket (no market data distributors) and DefiLlama (non-commercial). The Treasury yield curve is too slow (18 s).
- **After deploying:** register the three paths with 402 Index (`scripts/register-402index.mjs`), re-run `npx agentcash register`, and add them to the Ultravioleta registry.

## Base Builder Code (PR #203)

- Every x402 v2 route, `/buy/*` purchase, MCP payment and MPP evm settlement declares the `builder-code` extension (ERC-8021) with app code `bc_09e30bdm` (`BUILDER_APP_CODE` in src/lib/bazaar-extension.ts). The facilitator appends the CBOR suffix plus the `8021…8021` marker to the settlement calldata. This was proven on Base Sepolia on 2026-10-21: txs 0xf75a6618… (v2) and 0x192f6f1b… (MCP) both end with `a161616b62635f303965333062646d…80218021`. x402 v1 has no extensions and carries no code.
- Why: the Base Builder Grants (up to $5,000, "x402 implementations") require Builder Codes. The application draft is `C:\MoneyWallet\x402-launch\base-grant-application.md`; the owner submits it.

## Release train, reliability layer and listing names (1.47.12–1.47.15, 22 Oct 2026)

- **One command releases:** `pwsh scripts/release.ps1 -Version x.y.z -MessageFile notes.md [-ProofPath /tool?x=y] [-Dry] [-Resume]`
  on a feature branch. It bumps every pin (`scripts/bump-version.mjs`, tested), runs the checks, opens the PR, waits for CI,
  squash-merges, waits for main CI, deploys staging and proves v2/v1/MCP/MPP-evm payments with `pay-test.mjs`, deploys
  production through the guard, runs `check:live`, tags `vX.Y.Z` (MCP Registry republish), IndexNow, and registers with
  each directory at most once per UTC day (stamp file under `%LOCALAPPDATA%\agent-data-tools\release`). Every step is
  logged there as JSON; `-Resume` continues a partial run. It checks out branches in its worktree, so develop in another
  worktree (`C:\MoneyWallet\x402-dev`, node_modules junction to x402-canonical) while it runs.
- **Reliability (1.47.14):** `fetchPublic` retries a target 429/5xx or network error once inside its 8 s budget (a
  Retry-After over 2 s means no retry) and can cache 2xx bodies in `caches.default` (`cacheSeconds`: /url/meta,
  /sitemap, /pdf/text bytes 10 min; never probes or /extract). `/btc-price` falls back to Coinbase spot and keeps a 30 s
  snapshot. PDF.js failures are 422/502, never 500. Chain transports retry once; token-transfers scans in growing
  windows. The hosted browser launch retries once. `scripts/reliability-line.mjs` prints the /status line and exits 1
  when a tool with 5+ calls is under 90%.
- **Listing names (1.47.8–1.47.9):** the Coinbase Bazaar search ranks on 30-day payers and calls, then on whether the
  name contains every query word; price has no effect (measured over 321 results). `listingName(summary)` is the text
  before the colon, so summaries start with the exact task phrase ("Scrape website page to Markdown", "DNS lookup,
  WHOIS, domain lookup", "Payee screening"). Measured on 22 Oct: the search matches the phrase as written, not its
  words in any order ("Crypto token price" was found for "token price" and absent for "crypto price"), so a name may
  carry two phrases ("Crypto price and token price"), within 32 characters. The Bazaar takes a new name only with the tool's next settlement: the owner runs
  `C:\MoneyWallet\Refresh Bazaar names.cmd` (it computes the renamed and unlisted tools itself via
  `business/agentic/tools/bazaar-rename-diff.mjs`).
- **Related tools (1.47.15):** every GET tool quote or answer carries three `Link: …; rel="related"` headers
  (`src/lib/related.ts`: same section first, then `salesOrdered`); the readable 402 body has a `related` list. Tool
  output bodies are unchanged. `TOOL_SEO` covers 109 tools; copy may only restate the tool's own description.
- **Networks (1.47.13):** quotes list Base, Polygon, Arbitrum and Solana (SOLANA_PAY_TO = the owner's Phantom wallet, whose
  USDC account exists). Monad and World Chain were dropped (never paid). Dexter's verifier still refuses to pay us with
  "could not settle on a chain this route accepts" and never sends a payment; it says the fault is on its side.

## Web search ON (1.49.0, 22 Oct 2026, the owner: "I approve")

- `/search` ($0.01, src/routes/search.ts) is live: one Brave Search API request per paid call, key in the secret `SEARCH_API_KEY`
  (production and staging, set 22 Oct; never in Git or chat). 182 tools.
- Terms basis (api-dashboard.search.brave.com/terms-of-service, 1 Sep 2026): §3(a) licenses showing Search Results to the end users
  of a Customer Application; §4(c) wants those end users bound by the §3(b) duties, so the description and every answer carry
  `terms` (immediate use only, no storing, no resale, no model training); §3(b)(i) allows only transient storage, so nothing
  about results is cached or logged. §3(b)(xii) ("redistribute, resell") is the clause the owner accepted the risk on; the worst
  case is Brave closing the API account on 10 days' notice. Nobody contacts Brave on the owner's behalf.
- Spend: Brave bills $5 per 1,000 from prepaid credits with free credits each month; `SEARCH_DAILY_CAP=120` (wrangler.jsonc)
  keeps a month under about $18. Over the cap, or when the credits are gone, the tool answers 503 uncharged. `/search` is
  capacity-limited (no free calls) and first in `SALES_FIRST` after the payee checks; the Bazaar lists it after the owner's next
  Refresh click (seed-bazaar.mjs no longer skips it).
- `scripts/check-live-readiness.mjs`: a 429 from the CDP validator pauses both workers and each tool gets up to five tries
  with Retry-After or doubling waits from 10 s (two 177/181 runs on 22 Oct were throttling, not outages).

## News and World Bank economics (1.50.0, 22 Oct 2026; 187 tools)

- `/news` (src/routes/search.ts): the Brave News endpoint under the same key, daily cap and end-user terms as `/search`;
  `freshness` day/week/month. Capacity-limited, fifth in `SALES_FIRST`. Bazaar demand: "news headlines" (#1 had 13 payers)
  and "latest news", no listing of ours before.
- `/econ/gdp`, `/econ/inflation`, `/econ/population`, `/econ/unemployment` (src/routes/econ.ts) read a committed World Bank
  snapshot, `src/data/world-bank.generated.ts` (388 KB, 217 economies, 9 indicators, 10 years), built by
  `node scripts/fetch-world-bank.mjs` (rerun monthly; the file carries its date and every answer names "World Bank Open
  Data (CC BY 4.0), snapshot <date>"). Why a snapshot: the live API answered 7-20 s for cold country/indicator pairs and
  even timed out on a bulk query, while the data changes yearly. Country input is an ISO2/ISO3 code or an English name
  (`ALIASES` covers the usual differences from World Bank names); unknown country or no data is 404, uncharged. No
  network, so `smoke:examples` and the families test run them for real. Names carry the search phrases ("GDP by country,
  World Bank data", "Inflation rate by country", "Population by country", "Unemployment rate by country").

## LLM names and proof patience (1.50.1, 22 Oct 2026)

- Bazaar search for "chat completions" (8 results, #1 with 5 payers) did not find "LLM chat completion" (singular), so
  `/ai/chat` is "LLM chat completions" and `/ai/embed` is "Embeddings, OpenAI compatible" ("embeddings" 19 results, we were
  #9; "openai compatible" 7 results, absent). Both need one settlement (Refresh click) to show on the Bazaar.
- The busiest single resource on Base is blockrun.ai's chat completions at $0.002 (83k calls, 288 payers in 30 days);
  ours is $0.01 since 22 Oct. Price is the owner's call; the daily report now lists the most-used resources.
- release.ps1 staging proofs try up to four times (8, 30, 60 s) because the testnet facilitator's relayer wallet gets
  stuck ("nonce lower than the current nonce", "replacement transaction underpriced").

## What orders Bazaar search ties, and the CI dispatch (1.50.4, 22 Oct 2026)

- Measured over 206 adjacent result pairs with equal 30-day payers in 62 task searches (business/agentic/base-bots/tie-breaks.mjs):
  price, calls, lastUpdated, lastCalledAt, name length and description length are all coin flips (45-50%); the name holding
  the query phrase wins 56%, the description start 56%, a tag word 55%. So inside a payer tier the order is text
  relevance (probably semantic), and the controllable lever stays the exact phrase in the name, then tags and the first
  80 characters of the description. Payers decide between tiers.
- mcp-contract.yml takes `workflow_dispatch`; release.ps1 starts it on main when no push run appeared for the merge commit
  within 3 minutes (GitHub started none for 1.50.3's merge c01b1cd; it was unblocked by pushing the commit to a scratch
  branch `ci/<sha>`, which the guard accepts because it filters by commit, not branch).

## Calculators and converters (1.51.0, 23 Oct 2026; 198 tools)

- Why more listings: on 22-23 Oct an outside buyer (0xec2a…d034, $103 across 456 sellers a week) paid one call to every
  Bazaar-listed tool of ours, 166 calls / $1.57, and it revisits sellers (one with 62 listings got 554 calls in 9 days).
  Every listing is therefore a payer and about $0.01 a visit, and the Bazaar ranks on payers.
- `src/routes/calc.ts`, all local, no data source or account: `/qr` (qrcode-generator 2.0.4, MIT; UTF-8 is passed as
  bytes because the library's own encoder keeps Latin-1 only), `/calc/loan`, `/calc/compound-interest`, `/calc/age`,
  `/calc/bmi` (WHO adult categories, "not a diagnosis"), `/calc/tip`, `/text/lorem` (seeded), `/text/morse`,
  `/text/caesar`, `/xml/to-json` (saxes, DOCTYPE refused so no external entity is ever resolved), `/json/schema`.
  1.51.4: `/calc/loan`'s term defaults to 30 years. The published example (`exampleParams`) carries only required
  inputs, so the listing payment of 23 Oct got "years is required" (400) and the tool stayed off the Bazaar. The
  families test now runs every local tool on exactly its published example, not on all its parameter examples.
  Each name is the searched phrase where the Bazaar #1 had 1-6 payers on 22 Oct. Not built: password strength (a
  password in a GET query would land in request logs). Renamed: `/validate/luhn` "Credit card validation (Luhn)",
  `/color` "Color converter, hex to RGB". Bundle gzip 2.38 MB of 3 MB.

## FluxA AgentMarket (1.51.2, 23 Oct 2026)

- FluxA's proxy (proxy-monetize.fluxapay.xyz/api/<slug>/…) takes the buyer's x402 payment, settles it to the payout wallet
  set in FluxA's Studio through FluxA's facilitator, and forwards the call with the static header X-FluxA-Proxy-Secret.
  `marketplaceOf()` (src/lib/marketplace.ts) skips our paywall when it equals the Worker secret FLUXA_PROXY_SECRET (copy in
  %LOCALAPPDATA%\agent-data-tools\fluxa-proxy-secret.txt, never in Git or chat). GET and non-capacity tools only, like RapidAPI.
  Listing is the owner's FluxA account; why: one FluxA buyer wallet paid 1,165 FluxA-listed sellers in 7 days (base-bots analysis).
- FluxA lists us as one catch-all endpoint `/` at $0.01, so only tools priced at most $0.01 pass its proxy unpaid; dearer
  tools (/package-audit, /trade-insight, /mev-simulator, the $0.02-0.03 risk checks) answer the normal 402, which FluxA's
  proxy returns to its buyer uncharged (tests/payment-delivery-runtime.test.cjs).

## Price move to $0.01 (22 Oct 2026, the owner)

- The owner decided on 22 Oct to raise the common price from $0.003 to $0.01: every buyer bot traced pays $0.01 or more (buyer 0xec2a…6d034: 150 calls at $0.01 to one seller; bot C $0.03; bot A $0.01-0.05), and Bazaar search position ignores price.
- `PRICE` (src/family.ts), `AI_PRICE` (src/routes/ai-text.ts), `ORDINARY_PRICE` and every explicit `"$0.003"` entry are now `$0.01`. Unchanged: the $0.002 entry tools (/extract, /btc-fees, /sitemap, /package, /base-gas, /base-allowance), the $0.005 and higher tools, and **/base-tx at $0.003**, which the published capped chain client (clients/chain, docs/chain-checks.md) promises.
- tests/fixtures/price-freeze.json was regenerated at the new prices (freeze again until 8 Nov). Copy that quotes call counts uses $0.01 ($5 = 5,000 credits, about 500 calls).
- The Bazaar shows each tool's last settled price until it sells again: the owner's `Refresh Bazaar names.cmd` can re-pay the repriced listings once (about $1.60). Run `scripts/update-402index-prices.mjs --dry` then for real after the deploy (the release train does not).

## Contract reads on five networks (1.52.0, 23 Oct 2026; 237 tools)

- Why: the single Bazaar resources with the most payers on 23 Oct are onesource.io's one-call chain reads (100-370
  payers each); we sold 11 reads per network and lacked these. Every listing is also one more payer and about $0.01 per
  visit of the sweeper buyer 0xec2a…d034, which pays one call to every Bazaar-listed tool of a seller.
- `contractEntries()` in src/routes/chain-reads.ts adds, per network: `nft-owner`, `nft-balance`, `nft-metadata`
  (tokenURI plus the JSON from data:, https or ipfs:// via ipfs.io through `fetchFile`; strings over 1,000 characters
  shortened), `storage` (eth_getStorageAt), `proxy` (EIP-1967 implementation/beacon/admin, EIP-1822, OpenZeppelin legacy,
  EIP-1167), `call` (eth_call, calldata up to 8 KB), `estimate-gas` and `allowance` (not on Base, which keeps
  `/base-allowance` at $0.002 for the published chain client). Reverts are 422, missing contracts 404, both uncharged.
- Examples are live on every network (checked 23 Oct): Uniswap V3 position manager token #1 for the NFT reads, USDC for
  storage, proxy (OpenZeppelin legacy slots) and call (totalSupply), Permit2 as the allowance spender.
- Release train: a `smoke:examples` step (`--retry`, about a minute) runs every tool's published example before the PR;
  `-SkipSmoke` only when an outside source is down and the release does not touch it. `SMOKE_SHOW=700` prints answers.

## Hyperliquid market data and block-number names (1.53.0, 23 Oct 2026; 241 tools)

- `/hyperliquid/orderbook` (l2Book: levels, mid, spread in bps, depth), `/hyperliquid/candles` (candleSnapshot, 1m-1w,
  up to 500 bars), `/hyperliquid/funding-history` (fundingHistory, up to 500 hours, average and APR) and
  `/hyperliquid/prices` (allMids, perpetuals only; spot "@n" and outcome "#n" keys are dropped), same public info API and
  approval as `/hyperliquid/market`. Coins resolve to Hyperliquid's own spelling (kPEPE) through the shared 15 s
  metaAndAssetCtxs snapshot. Why: order books (207 payers) and candles (193) are the most-paid derivatives data after
  funding on the Bazaar (23 Oct). Tests: tests/hyperliquid.test.cjs (mocked fetch).
- `<chain>/block` is "<chain> block number and block details" (block-number listings had 55-354 payers); needs one
  settlement each (Refresh) to show the new name. `/news` also carries the `crypto-news` tag.

## Technical indicators, converters and validators (1.54.0, 24 Oct 2026; 247 tools)

- `/hyperliquid/indicators` ($0.01): RSI 14 (Wilder), MACD 12/26/9, SMA 20/50/200, EMA 12/26/50 (SMA-seeded), Bollinger
  20/2 with %B and bandwidth, ATR 14 (Wilder) and annualised close-to-close volatility, on up to 250 closed Hyperliquid
  candles (the forming bar is dropped), plus plain readings ("RSI overbought", "price above SMA 200"). Fewer than 30
  closed bars is an uncharged 404. The math helpers are exported and tested (StockCharts RSI example 70.53). One tool on
  purpose: separate RSI/MACD/EMA listings would be the same computation listed several times.
- `src/routes/lookups.ts`: `/yaml/to-json` and `/json/to-yaml` (yaml 2.9.1, ISC; alias expansion capped, duplicate keys
  refused; imported lazily because yaml's Node build `require`s "process", which broke the scripts that bundle the
  catalog for Node as ESM), `/phone/validate` (libphonenumber-js 1.13.15 /max, MIT; offline, line type included),
  `/vin` (NHTSA vPIC DecodeVinValues, US federal data; local check digit) and `/robots` (robots.txt verdict by RFC 9309
  as Google applies it; 4xx robots.txt allows all). Demand probe: `business/agentic/base-bots/demand-probe.mjs "<phrase>"…`.
- Worker bundle after 1.54.0: 2.50 MB gzip of the free plan's 3 MB (libphonenumber metadata is ~120 KB of it).
## IP lookup, distances, fear and greed, EVM utilities and gas history (1.55.0, 24 Oct 2026; 258 tools)

- Picked by `business/agentic/base-bots/demand-probe.mjs` (summed 30-day payers over the top 20 Bazaar results, no listing of
  ours): ip lookup 49, distance between 43, fear and greed 64, decode calldata 38, signature verify 35, gas history 45,
  address checksum 23; keccak256 41 and function selector 39 went to a rename of `/keccak`, which already returned both.
- `/ip/lookup` (src/routes/geo-ip.ts): RDAP via rdap.org, holder, range, type, registration country, abuse e-mail;
  private and reserved addresses 400. Registration country only, never called geolocation. `/geo/distance`: haversine.
- `/crypto/fear-greed` (src/routes/fear-greed.ts): alternative.me allows commercial use with attribution next to each
  display, so every answer carries `source` and `attribution`; fetches at least 31 days so the 30-day change is known.
- `/evm/decode-calldata`, `/evm/verify-signature` (EIP-191; the example is signed with the public Hardhat test key #0),
  `/evm/checksum` (src/routes/evm-tools.ts). The checksum tool needs the input's case, so `TOOLS` marks its input with
  `keepCase` and `normalizedInput` skips lowercasing for it (`RAW_INPUT_PATHS` in src/tools.ts). The wrapper line
  `const result = await handler(env, normalizedInput(input));` must stay verbatim: tests/output-contract.test.cjs patches it.
- `<chain>/gas-history` on all five networks (eth_feeHistory: base fee per block, gas used ratio, 10/50/90th percentile
  priority fees).

## Solana reads and BIC check (1.56.0, 24 Oct 2026; 262 tools)

- `/solana/balance`, `/solana/token`, `/solana/tx` (src/routes/solana.ts): keyless JSON-RPC, Solana Foundation mainnet
  endpoint first (publicnode only for getBalance; it 403s token methods). Lamports above 2^53 are kept exact by quoting
  big integers before JSON.parse. Known tokens sort first because exchange wallets hold thousands of spam mints.
  `getTokenLargestAccounts` is rate-limited per method on the public node, so holders are opt-in (default 0) and become
  `null` when refused. After deploying, check the three with a free trial from production: if Cloudflare's shared IPs
  get 403/429 from the public node, pause them in PAUSED_FAMILY_TOOLS rather than leave a failing first payment listed.
- `/bic/validate` (src/routes/bic.ts): ISO 9362 structure and a real country (Intl.DisplayNames; XK allowed; EU/UN/ZZ
  refused), head office, test and passive flags. Structure only, never claims the bank exists.
- Ruled out on 24 Oct: Datamuse (customer-facing apps must contact them; key needed from Feb 2027), YouTube transcripts and
  Reddit search (platform terms), GitHub repo data (60 requests an hour per shared IP), EU VIES (unreachable from the PC;
  test from Cloudflare before building).

## Website and DNS checks (1.57.0, 24 Oct 2026; 268 tools)

- src/routes/web-checks.ts: `/url/redirects` (hop-by-hop chain, loop detection; a redirect to a private address is
  reported and never requested), `/url/uptime` (up/down, status, ms, size, optional text check; failures are "down",
  not errors), `/dns/lookup` (Cloudflare DoH, 13 record types, rcode and DNSSEC AD), `/dns/propagation` (Cloudflare,
  Google, AdGuard, AliDNS, DNSPod JSON DoH; majority and agreement), `/seo/audit` (server HTML up to 1 MB: title/meta
  lengths, canonical, robots, H1/H2, images without alt (a bare `alt` is valid), lang, viewport, OG/Twitter, JSON-LD,
  links, words, issues and score), `/text/keyword-density` (text or a page URL; stop words removed).
- Demand (24 Oct probe, summed payers over the top 20): uptime check 51, redirect checker 41, seo audit 41, dns
  propagation 38, dns records 35, keyword density 60. Quad9 and OpenDNS refused JSON DoH from the PC; not used.

## Business days, statistics, expressions, zodiac; Solana paused (1.58.0, 24 Oct 2026; 269 tools)

- src/routes/math-date.ts: `/date/business-days` (weekends plus /holidays rules for US, GB, SE, DE, FR, NO, DK, FI; `add=N`
  for a date N business days away; without `to` it counts to the end of the start month so the published example works),
  `/math/stats` (population and sample spread, quartiles, p90/95/99), `/math/evaluate` (recursive-descent parser, never
  eval; -2^2 = -4, 2^-1 = 0.5; names are looked up with Object.hasOwn so constructor/toString are refused), `/date/zodiac`.
  `/date/info` is "Week number and date facts" (it already returned the ISO week).
- Solana reads are in PAUSED_FAMILY_TOOLS: api.mainnet-beta.solana.com returns 403 to Workers (checked from production,
  1.56.0), publicnode wants a token for token methods, drpc/ankr/onfinality need keys. Test any new upstream from
  Cloudflare (a staging deploy) before building on it; a PC check is not enough.
- Lookup tables keyed by user input must use Object.hasOwn, not `in` or bare indexing: `/hyperliquid/candles` and
  `/hyperliquid/indicators` accepted `interval=constructor` until 1.58.0.

## Barcodes, palettes and tables (1.59.0, 24 Oct 2026; 273 tools)

- src/routes/generators.ts: `/barcode` (Code 128 with set C for digit runs and the mod-103 check, or EAN-13 with its check
  digit; SVG and data URL), `/color/palette` (HSL harmonies and six shades), `/csv/to-markdown` (GitHub table, numeric
  columns right-aligned, pipes escaped), `/html/table-to-json` (htmlparser2; th rows become keys, colspan repeated,
  duplicate headers suffixed). The Code 128 table equals JsBarcode 3.11.6's BARS symbol for symbol (compared 24 Oct;
  their package was only read as data). Demand: barcode 36, color palette 37, markdown table 35, html table 33.

## Tool packs (1.60.0, 24 Oct 2026)

- src/routes/packs.ts: one paid call runs several of our tools on one input (`call()` runs the same in-process handler as
  the single tool; `runSections()` runs them in parallel). A failing section is listed in `failed` and the rest answer;
  only if every section fails is the call refused (502, uncharged). Packs and prices (always below the tools bought
  one by one): `/pack/crypto-market` $0.03 (fear & greed, top 10 Hyperliquid perps, indicators for up to 3 coins,
  BTC fees), `/pack/token-analysis` $0.03 (token info, Uniswap price, proxy, Base honeypot and contract risk),
  `/pack/email-deliverability` $0.02 (MX, SPF, DMARC, DKIM at 9 common selectors, MTA-STS, TLS-RPT, BIMI, score/grade,
  optional address check), `/pack/website-audit` $0.03 (uptime, redirects incl. http->https, SEO, security headers,
  robots, domain DNS/registration), `/pack/ip-intelligence` $0.02 (type, RDAP, PTR), `/pack/wallet-profile` $0.03
  (5-chain balances, contract check, nonces, Base USDC transfers, sanctions).
- Demand (24 Oct probe, summed payers over the top 20): crypto market overview 50, token analysis 42 (#1 has 22),
  email deliverability 36, security audit 36, ip intelligence 24, website audit 23, wallet profile 14. Packs sit right
  after the data tools in SALES_FIRST (discovery order) and in the matching MCP bundles.
- src/routes/toolboxes.ts: `/pack/hash-toolbox` (MD5 and CRC-32 implemented here and tested on RFC vectors, SHA via Web
  Crypto, Keccak, SRI strings), `/pack/encoding-toolbox` (Base64/url, hex, URL, HTML, ROT13, code points, Punycode, and
  auto-decoding of encoded input), `/pack/json-toolbox` (validate with position, format, minify, schema, stats, YAML),
  $0.02 each. Why: the search "developer tools" summed 195 payers, led by toolbox endpoints (hash 35, JSON 28, encoding 21).


## More packs (1.61.0, 24 Oct 2026)

- src/routes/packs-more.ts: `/pack/tx-explain` $0.02 (tx + receipt via the chain client, calldata decoded with the common
  signatures, now including EIP-3009 transferWithAuthorization/receiveWithAuthorization used by x402 settlements, every
  Transfer/Approval/ApprovalForAll decoded with symbols and plain-English lines), `/pack/nft-analysis` $0.02 (owner,
  metadata, owner's holdings, collection proxy), `/pack/location-brief` $0.02 (geocode, MET Norway weather via the core
  `weather()`, sun times, country facts; Wikidata gives country names, mapped to ISO codes with Intl.DisplayNames; no
  local time because nothing keyless maps coordinates to a time zone), `/pack/text-analysis` $0.02 (stats, keywords,
  extracted contacts and links, prompt-injection scan).
- `keywordDensity` strips URLs and e-mail addresses before counting ("https" and "com" topped the lists).
- `/domain-report` carries a `trust-score` tag (search "trust score" summed 42 payers; the tool already gives a verdict).


## ID and string toolboxes; case and time names (1.62.0, 24 Oct 2026)

- src/routes/toolboxes2.ts: `/pack/id-toolbox` $0.02 (UUID v4, UUID v7 per RFC 9562, ULID in Crockford base32, NanoID,
  unbiased base62/hex strings from crypto.getRandomValues; decodes the time in a ULID or UUID v7) and
  `/pack/string-toolbox` $0.02 (11 case styles with XMLHttpRequest-style splitting, slug without accents, reversed,
  collapsed whitespace, counts). Demand: id generator 262 (one listing has 232), case converter 41, string utilities 21.
- Renames: `/case` "Case converter: camelCase, snake_case, kebab-case and more" (we were #5), `/time` "Timezone converter,
  current time" (time converter 40, we were #11); tags case-converter, time-converter, id-generator on /uuid.
- 1.61.0 shipped with only its version bump (the chaining script's patch was re-encoded by a PowerShell pipe and every hunk
  failed unchecked); its four packs went out in 1.62.0. Write patches with `git diff --output` and check `git apply`'s exit.


## Reverse geocoding, coin research pack, currency converter name (1.63.0, 24 Oct 2026)

- src/routes/geo-more.ts: `/geocode/reverse` (Wikidata Query Service `wikibase:around` over items with a population, CC0;
  2 s cold, 0.2 s warm; cached a day per point rounded to ~100 m; nearest place plus the largest non-administrative
  place, since municipalities and counties carry bigger population figures than the city itself) and
  `/pack/coin-research` $0.03 (market, 3-day funding, order-book depth, 4h and 1d indicators, Fear & Greed).
  Check `/geocode/reverse` from production after release: WDQS is shared and may throttle Cloudflare egress.
- `/fx` is "Currency converter, forex rates" (currency converter 27, we were #4).
- smoke-examples.mjs drops content-encoding/content-length from proxied answers: Node's fetch already decompressed the
  body, and workerd failed with "Gzip decompression failed" on query.wikidata.org.


## OpenAPI summary, MCP inspector, API health pack (1.64.0, 24 Oct 2026)

- src/routes/agent-infra.ts: `/openapi/summary` (OpenAPI 3 or Swagger 2, JSON or YAML via the lazy yaml import, up to
  2 MB: servers, auth schemes, operations by method, paid (402 or x-payment-info) and deprecated counts, 150 operations),
  `/mcp/inspect` (streamable HTTP: initialize, notifications/initialized, tools/prompts/resources list with the session
  id; SSE or JSON answers; 401/403 reported as authRequired with the challenge; never calls a tool) and
  `/pack/api-health` $0.02 (three latency samples, redirects, security headers, x402 terms, /openapi.json). Redirects
  are not followed; targets pass parseTarget. The pack runs /x402/check and /openapi/summary through a module-local
  lookup because packs.ts importing this module would be circular.
- `/x402/check` is "x402 endpoint check" (the search "x402 endpoint" summed 37 payers; we were absent).
- Demand: openapi 47, api health 38, mcp server check 35.


## Image metadata, language detection, user agents and favicons (1.65.0, 24 Oct 2026)

- src/routes/media-text.ts: `/image/metadata` (JPEG/PNG/GIF/WebP size; for JPEG the EXIF IFD0, Exif and GPS IFDs read by our
  own parser `parseTiff`: camera, lens, date taken, exposure, ISO, focal length, orientation, GPS; up to 15 MB),
  `/text/language` (franc-min 6.2.0, MIT, 82 languages, ISO 639-3/639-1 and English name, `und` below about 10
  characters), `/useragent/parse` (local rules: browser, OS, device, and named crawlers incl. GPTBot, ClaudeBot,
  PerplexityBot and HTTP libraries), `/url/favicon` (link icons, manifest, /favicon.ico, best icon: SVG then size, never
  mask icons).
- Demand (24 Oct probe, summed payers over the top 20): detect language 57, exif 55, favicon 38, image metadata 31, user
  agent parser 28. Renames: `/email` "Email validation, verification", `/hash` "SHA256 hash, hash text (SHA-256)".


## Tech stack and four more packs (1.66.0, 24 Oct 2026)

- src/routes/packs-intel.ts: `/tech/stack` (our own ~110 fingerprints in `TECH_RULES`: headers, generator meta, cookie
  names, script hosts; brand names in copy must not match, so rules use script hosts, not bare words),
  `/pack/evm-toolbox` $0.02 (`evmToolbox()` classifies the input: address, signature, calldata, bytes32, hex number,
  decimal or integer amount, text), `/pack/seo-toolkit` $0.02, `/pack/gas-tracker` $0.02 (no inputs, so it is in the
  no-input list of tests/fields.test.cjs), `/pack/domain-intel` $0.03 ("Company enrichment, domain intel"; mail provider
  from MX hosts via `mailProvider`). Tools packs.ts cannot reach (feeds, media-text, this module) run through `local()`.
- Demand (24 Oct probe): developer utilities 173, seo analysis 37, multichain gas 34, gas tracker 29, company research
  30, tech stack 28, seo toolkit 24, lead enrichment 21, domain intelligence 17. `/pack/crypto-market` has the
  market-sentiment tag (39) instead of a second, overlapping sentiment pack.


## PDF speed, failure reasons, proof patience (1.67.0, 24 Oct 2026)

- `readPdf` (src/routes/pdf.ts) reads only the requested pages with `doc.getPage(p).getTextContent()`, joining items as
  unpdf does (str plus a newline on hasEOL). unpdf's `extractText` reads every page in parallel: IRS Pub 17 (142 pages)
  took 6.6 s CPU for one page, now 0.4 s. Default `pages` is 20.
- Failure reasons: request-metrics.ts queues `#err <path> <status> <message>` (src/lib/failure-reason.ts strips URLs,
  e-mails, domains, hex, quoted values and digits) for failed/errored JSON answers; metrics.ts counts them in
  `errors:<day>` (capped at 200 keys, rest "other"); `/status` shows `topFailures` (top 3 over 7 days). Read it before
  guessing why a tool fails: Workers Logs need a token with log read access that only the owner can create.
- release.ps1 proofs wait 8, 30, 60, 120, 240 s for the testnet relayer.

## Answer quality pass, no new tools (1.67.0, 24 Oct 2026)

- Method: run every pack's published example (`SMOKE_SHOW=4000 node scripts/smoke-examples.mjs /pack/`) and look for
  `failed` sections and nulls, then run tools on real-world inputs. Fixes:
  - `/pack/api-health` finds the OpenAPI document via `specCandidates()` (path prefixes, then root places), in parallel.
  - `nameFromTitle()` gives domain-intel a company name when og:site_name is missing.
  - Content-type gates removed where the bytes are checked anyway: `/pdf/text` (%PDF), `/image/metadata` (`imageInfo`),
    `/describe` (`sniffImage`). Do not gate files on the server's content type when the parser can tell.
  - `/geocode/reverse` label languages `LABEL_LANGUAGES`; a bare Q-id is never a name.
  - `targetRefusal()` in src/lib/fetch.ts: 401/403/451 read "the site refused automated access", 404/410 "not found".


## Inputs as agents send them; names for searched phrases (1.68.0, 24 Oct 2026, no new tools)

- Method: a scratch script ran one tool's handler in Node on several real-world inputs. Fixes:
  - `normalizeZone()` (src/routes/time.ts): `CITY_ZONES` table, spaces to underscores, "UTC+2" to Etc/GMT-2 (sign
    inverted), minutes to an offset zone ("-05:30"), canonical spelling from `resolvedOptions().timeZone`; `at` takes
    Unix seconds or milliseconds; `INPUT_ALIASES` maps time/timestamp/datetime/when to `at`.
  - `domainInput()` (src/routes/domain.ts): URL, port, path and Unicode (via `new URL().hostname`, punycode); `HOSTNAME`
    accepts xn-- top-level labels.
  - `discoverFeed()` (src/routes/feeds.ts): `<link rel=alternate type=application/rss+xml|atom+xml>` from a page; `/feed`
    follows it once. `PAGE_BYTES` is 1 MB (YouTube's head is at 770-780 KB); `parseMeta` falls back to meta name=title.
  - `/btc-address` lower-cases an all-upper bech32 address.
- Renames: candles "Crypto candles, OHLCV", prices "All crypto prices, Hyperliquid", indicators "Technical indicators,
  RSI, MACD", `<chain>/call` "<Chain> eth call, contract call". Most of the analyzer's "absent from 18 searches" list
  were tools whose names already carry the phrase but are not Bazaar-listed yet (Refresh click), not name problems.
- Release cadence: one a day, queued for 00:10 UTC (Worker requests hit the 100k cap at 13:00 UTC on 24 Oct from
  release-triggered crawls).

## ENS everywhere, unit and currency names, relative dates (1.68.0, 24 Oct 2026, no new tools)

- `withEnsResolved()` in src/tools.ts resolves `*.eth` in any ADDRESS_INPUTS value (comma lists too) through `ensLookup`
  before `normalizedInput`; skipped for /ens itself. A 404 from ENS becomes a 400. The wrapper line
  `const result = await handler(env, normalizedInput(input));` stays verbatim for tests/output-contract.
- `unitKey()` (src/routes/utils.ts): `UNIT_ALIASES` (full names, symbols, kph, cups…), then a singular of a plural,
  but only when the form as sent is unknown ("ms" is never "m"). Object.hasOwn on every table.
- `CURRENCY_ALIASES`/`currencyCode()` in src/routes/rates.ts; `parseDate()` in src/lib/relative-date.ts (today, now,
  tomorrow, yesterday; used by utils.ts dates and public-data.ts); `countryCode()`/`countryName()` in
  src/lib/country-code.ts (Intl region names plus UK/USA/Holland… aliases; checked before Intl, which maps UK to
  itself), shared by /holidays and packs-more.
- `/company` with a domain searches its label and prefers the candidate whose P856 host is that domain.
- `/weather` qualifiers: a non-country qualifier asks Wikidata with the whole phrase first; a country qualifier keeps
  the table (tests/discovery-conformance pins "london, UK" to zero Wikidata calls).
- Third batch (same release): `/hash` and `/case` normalise the style name through a wrapped Input before `pick`;
  `CRON_MACROS`; `num()` strips a leading currency sign; `NAMED_COLOURS` (148 CSS keywords) and alpha hex in
  `parseColour` (exported); `/jwt/decode` strips "Bearer"; `/json/validate` unwraps a ```json fence; `/url/parse`
  assumes https for a scheme-less host (`assumedScheme: true`); `/mime` reverse-looks-up a type; `/package` defaults
  to npm and treats "latest" as no version.
- 24 Oct, 13:00 UTC: the free plan's 100k Worker requests/day ran out (167k by 14:30); every route, staging and the
  funwords.eu apex answered 429/1027 until 00:00 UTC. One release a day until Workers Paid (the owner's decision).
- Fourth batch (same release): `SCHEMELESS_URL` in src/tools.ts `normalizedInput` prepends https:// to any `url` input without a scheme; `coinKey()`/`intervalKey()` in hyperliquid.ts (names, pair suffixes, k-prefixed markets); `secCompanyMatch()` in gov-data.ts (ticker, then title); `quakeFeed()` in public-data.ts (largest USGS feed at or below the requested magnitude, then filter); markdown tables and task lists in `markdownToHtml`; `/text/extract` blanks dates, hex, URLs and e-mails before reading phones and numbers; `slugify` falls back to Unicode letters.
- Inference and media first (24 Oct, market income by seller: dTelecom STT/TTS $36k, KORUS $22k, Venice and BlockRun
  inference; one-call utilities earn cents): `SALES_FIRST` opens with /ai/chat, /ai/chat-large, /ai/embed, /transcribe,
  /ai/speech, /image, /describe, /search, /news; `PICK_BY_TASK` (credit-routes.ts), the MCP summary and the OpenAPI
  `GUIDANCE` (endpoints.ts) lead with them too. Names: "LLM chat completions, inference", "LLM inference, large model",
  "Speech to text, transcribe audio", "Image generation, generate image". tests/discovery-index and discovery-order pin
  the new head.
- Spend caps: `takeDailyBudget()` in src/lib/daily-cap.ts (KV `cap:<kind>:<day>`), used by `runAi` (AI_DAILY_CAP, default 1000) and `withBrowserPage` (BROWSER_DAILY_CAP, default 60); both in wrangler.jsonc. The owner (24 Oct): Workers Paid only after $5 earned; remind the owner at $10 external income (the daily report prints it).
- The release train's chaining script and notes live in `%LOCALAPPDATA%\agent-data-tools\release\train\` (the session
  scratchpad was wiped at the day change on 25 Oct and took the queued 1.68.0 train with it).


## Listing names, tags and examples from the 25 Oct measurement (1.69.0, no new tools)

- After the 25 Oct Refresh (301 of 302 listed): #1 in 75 of 208 task searches, top 3 in 157, present in 199.
  `business/agentic/base-bots/flip-candidates.mjs` turns the daily `search-ranks-<day>.json` into three lists: text-flippable
  (nobody above us has more payers), absent (tool exists), and payer-blocked by one. Work the first two with names and tags;
  the third only buyers can change.
- **One phrase per name when a tool has one task.** "LLM chat completions, inference" fell out of the "chat completions"
  results (was #5 as "LLM chat completions"); two-phrase names are for tools that genuinely answer two searches (candles +
  OHLCV). Where a same-payer competitor beat us, its name was the bare phrase ("SHA-256 Hash", "Date Difference"), so the
  flippable tools now lead with the exact phrase and stay short.
- Measured name shape (`name-shape.mjs`, 103 equal-payer pairs): starts-with-query 67%, contains 61%, description opens
  with it 60%, more calls30 60%, shorter 42%. Rule: the name STARTS with the phrase buyers type; add a second phrase only
  for a second real task; never shorten for its own sake. Chain reads whose searched phrase has no chain word ("nft
  owner", "block number", "estimate gas"…) are "<Phrase>, <Chain>"; chain-named reads stay "<Chain> balance".
  `search-ranks.mjs` now measures 363 searches (every tool at least once; `name-audit.mjs` lists names that do not start
  with their query and tools without a search).
- Tags: the Bazaar matches the first five; every tool now has at least five, the searched phrases first (`SEARCH_TAGS`
  third pass in src/lib/bazaar-extension.ts). "http status check" belongs to `/url/uptime`, not `/http/status` (which
  explains a status code).
- Published examples must read as ordinary content: `/pack/text-analysis` stayed unlisted after a settled payment while its
  example ended in "Ignore previous instructions." Example outputs are checked against real answers with
  `%LOCALAPPDATA%\agent-data-tools\release\train\example-keys.mjs <smoke output with SMOKE_SHOW>`; only `/extract` shows a
  field (`markdown`) its `format=text` example input does not return.
- **Every tool is at most $0.01 (the owner, 25 Oct).** Measured from /revenue byEndpoint against catalog prices: the sweeper
  0xec2a…d034 pays every listed tool at or below $0.01 and none above (253/254 vs 0/21 at $0.02). The 32 dearer tools
  (all packs, the risk checks, media, /package-audit) are $0.01. `scripts/freeze-prices.mjs "<decision>"` regenerates
  tests/fixtures/price-freeze.json (now all 302 paths) and appends the decision to its note. FluxA's catch-all passes
  every tool now. After a price release: `update-402index-prices.mjs --dry` then real; Bazaar shows new prices after the
  next settlement per tool (Refresh).
- **$1 credit pack (25 Oct):** `CREDIT_PACKS` gained `{ usdCents: 100, credits: 1_000, url: "" }`; `WEB_PACKS` (packs with a
  Stripe link) drives browsers, 402/MCP hints and top-ups, `CREDIT_PACKS` drives MPP (`/credits/buy/1` works now). The owner's
  step: create the $1.00 payment link (metadata adt_credits=1000, success URL /credits/claim?session_id={CHECKOUT_SESSION_ID})
  and paste its URL; then the hints switch to $1 by themselves (first WEB_PACKS entry). Per-call card payments are
  impossible (Stripe $0.50 minimum); do not add a stripe method to tool 402s (Tempo must stay the first challenge, and a
  challenge amount other than the tool price confuses validators).
- The release train's chaining script and notes live in `%LOCALAPPDATA%\agent-data-tools\release\train\` (the session
  scratchpad was wiped at the day change on 25 Oct and took the queued 1.68.0 train with it).


## Workers Paid and the AI text tools in the free calls (1.70.0, 25 Oct 2026)

- The owner bought Workers Paid ($5/month) on 25 Oct ~11:30 UTC: no 100k requests/day cap, Paid Durable Object limits, CPU
  limit 30 s per request instead of 10 ms (no `cpu_ms` in wrangler.jsonc), Workers AI and Browser Rendering billed per
  use (AI_DAILY_CAP and BROWSER_DAILY_CAP stay). Releases may run at any hour; one directory registration a day stays.
- `CAPACITY_LIMITED` (src/lib/capacity.ts) no longer holds the AI text paths, so /ai/chat and the other text models are in
  the 25 free calls, on the FluxA/RapidAPI proxies and in the marketplace OpenAPI. Tests that needed a "not free" tool use
  /image (pages) and `search` (on /mcp/account, which omits /image).
- `/regex/test` unpaused (303 tools): a nested-quantifier/backreference guard in the handler (src/routes/utils.ts) refuses
  the catastrophic shapes; the 30 s CPU limit bounds the rest. Paused tools left: Solana reads, /base/gas and /base/tx
  twins, and the sources without commercial terms (air-quality, uv, elevation, crypto/price, iss, hackernews/top).


## Packs as the upsell (1.71.0, 25 Oct 2026, no new tools)

- `PACK_OF` (src/lib/related.ts) maps about 90 tools to the pack that runs them; `relatedTools()` puts that pack first, so the
  Link header, the 402 body's `related` list and the tool page offer it. All tools and packs are $0.01, so a pack is the
  better buy for any bot that wanted one of its tools. Keep the map in step when a pack gains or loses a section.
- 25 Oct pack probe: #1 for wallet analysis, ip intelligence, nft analysis, encoding tools, seo toolkit, gas tracker, api
  health, text analysis, location data, string utilities, id generator; payer-blocked for token analysis (23p), crypto
  market overview (5-9p), json tools (32p), developer tools (Cult OS 32p). Packs got their first sweep payers only after
  the one-cent price (1.69.0); expect them to climb on payers, not names.


## Research packs (1.72.0, 25 Oct 2026; 306 tools)

- src/routes/packs-research.ts: `/pack/web-research` (Brave /search, then `extract()` on the top 1-5 pages in parallel),
  `/pack/news-sentiment` (Brave /news, then /ai/sentiment per headline through `runSections`), `/pack/url-safety`
  (/url/redirects, `domainReport()` on the final host, /http/security-headers, plus `urlSignals()`: heuristic signals only,
  never a blocklist claim). Web research and news sentiment are in `CAPACITY_LIMITED` (each costs a Brave request and up
  to 10 AI calls). Bazaar search 25 Oct: web research #1 1p (we #11), news sentiment #1 2p (absent), scam/phishing check
  absent, url safety #1 5p (we #10). Tests: tests/packs-research.test.cjs. Check both Brave packs on staging after the
  release (the PC smoke run skips capacity-limited tools).


## Open models by name; streaming chat (1.73.0, 25 Oct 2026)

- `MODEL_ENDPOINTS` (src/routes/ai-text.ts) generates `/ai/model/<slug>` for Qwen3 30B, GPT-OSS 20B and 120B,
  Mistral Small 3.1, Qwen2.5 Coder 32B and DeepSeek R1 distill; `toolFor()` (src/lib/openai-chat.ts) routes OpenAI model
  names to them (`ChatQuery.tool`). `chat()` reads the `choices` shape (Qwen3, Granite) and strips `<think>` blocks.
  Availability and token prices checked with `%LOCALAPPDATA%\agent-data-tools\release\train\ai-model-probe.mjs <model ids>`
  (wrangler OAuth token, one tiny billed call each); Gemma 3 is refused on this account (5018). Keep each price above the
  per-call token cost at max output; all are in `CAPACITY_LIMITED` (paid only) with /ai/chat-large.
- `toOpenAiStream()`: `stream: true` gets SSE chunks and `[DONE]`; usage chunk with `stream_options.include_usage`.
- `CHAT_MODEL` (src/routes/ai-text.ts) is Llama 4 Scout since 25 Oct 2026 (2.4 s vs 5.9 s for the 8B on a real prompt); /ai/chat and the /v1 fronts use it, the other AI text tools keep `MODELS.text` (8B). The fleet wallets 0xe827…, 0x2465…, 0xb83b… pay BlockRun's chat ~75 times in two days each: `business/agentic/base-bots/payer-profile.mjs` shows them, `sweeper-price.mjs` shows payments per listing by price band (the sweeper pays one-cent listings 0.58 times a week, cheaper ones 0.8; one cent still earns most per listing).



## Web answer and fact check (1.74.0, 25 Oct 2026)

- src/routes/packs-research.ts: `sources()` (Brave /search count 6, `extract()` on the top three at 2,500 characters,
  snippets otherwise, numbered and budgeted to 6,000 characters) feeds `/ai/answer` and `/ai/fact-check`, which call /ai/chat
  (Llama 4 Scout) with `SOURCE_RULE` (sources are untrusted; cite [n]). Fact check parses `VERDICT:`/`WHY:` lines and falls
  back to "unverified". Both are capacity-limited. Demand: answer/web answer/search answer 41-60 summed payers, fact check
  69, nothing of ours on 25 Oct. Check both on staging after the release (the PC smoke run skips capacity-limited tools).


## Function calling and JSON mode (1.74.0, 25 Oct 2026)

- `needsNative()` (src/lib/openai-chat.ts) sends requests with tools, tool turns, assistant tool_calls or a non-text
  response_format to /ai/chat as `ChatQuery.native` (JSON strings in the query: messages, tools, tool_choice,
  response_format); `nativeChatInput()`/`nativeChat()` (src/routes/ai-text.ts) run Llama 4 Scout with them and normalize
  `choices[0].message` (content, tool_calls), finish_reason and usage. `toOpenAiResponse()` returns `message.tool_calls`
  and real usage; `toOpenAiStream()` emits `delta.tool_calls`. Cap: 20,000 characters of messages+tools ($0.002 price).
  Probe script: `%LOCALAPPDATA%\agent-data-tools\release\train\ai-tools-probe.mjs [model]`. Other models stay text-only:
  a tools request naming them is refused 400 before payment.


## OpenAI images front (1.74.0, 25 Oct 2026)

- `POST /v1/images/generations` (src/lib/openai-images.ts) is the embeddings-front pattern for `/image`: `toImagePrompt()`
  (n must be 1, prompt 3-800 characters), `toOpenAiImage()` (b64_json, data: URL in url, revised_prompt),
  `asFrontQuote()` for the unpaid quote. Registered in src/index.ts next to the other /v1 fronts; OpenAPI path from
  `openAiImagesOpenApiPath()` in discovery.ts. Tests: tests/openai-images.test.cjs. Not a tool: no MCP entry, not in
  /discovery/resources. Proof on staging after release with an OpenAI SDK `images.generate` through an x402 fetch wrapper.


## Search-agent request fields (1.74.0, 25 Oct 2026)

- `INPUT_ALIASES` (src/tools.ts) maps query/question/search → q, numResults/num_results/limit/n → count, urls → url (first
  item), statement → claim. `ALIAS_OF` is the reverse map; the POST-body flattener in src/index.ts keeps a body field when
  it is an alias of one of the tool's inputs. Tests: tests/tool-quality.test.cjs (aliases), tests/browser-402.test.cjs
  (an Exa-style POST body to /search is quoted as the aliased GET).


## Anthropic Messages front (1.74.0, 25 Oct 2026)

- `POST /v1/messages` (src/lib/anthropic-messages.ts): `toChatBody()` maps Messages → chat-completions (tool_use →
  assistant tool_calls, tool_result → tool messages, input_schema → parameters, tool_choice any → required), then the
  shared `completeChat()`; `toMessagesAnswer()`/`toMessagesStream()` shape the answer and the SSE events. Claude model
  names are refused 400 when a payment is attached (never served, never silently swapped). Tests:
  tests/anthropic-messages.test.cjs. Proof on staging after release with the Anthropic SDK (baseURL = origin) through an
  x402 fetch wrapper.


## /v1 fronts as Bazaar listings (1.74.0, 25 Oct 2026)

- `scripts/seed-bazaar.mjs --fronts` (also `--only /v1/chat/completions,…`): the `FRONTS` table pays each OpenAI/Anthropic
  front once at its tool's price (POST for /v1/messages, GET variants otherwise) so the Bazaar lists it under its /v1 path;
  already-listed fronts are skipped. The Refresh click (business/agentic/tools/seed-bazaar-listings.ps1 -Auto) runs it after
  the tools when the main copy of the script knows `--fronts`, and its dry run no longer asks for YES when there is nothing
  to pay. Why: BlockRun's /api/v1/chat/completions is the busiest single listing on Base (86,852 calls, 297 payers);
  `business/agentic/base-bots/front-listings.mjs` shows ours and the busiest /v1 listings.


## PII detection, moderation and /v1/moderations (1.74.0, 25 Oct 2026)

- src/routes/safety.ts: `/text/pii` ($0.01; `piiScan`: earlier patterns win overlaps, cards need Luhn, IBANs mod-97 via
  `ibanCheck`, phones need 8-15 digits and a separator or +, dates are not phones; hits are always masked) and
  `/ai/moderation` ($0.002; `GUARD_MODEL` @cf/meta/llama-guard-3-8b, `guardVerdict` reads "safe" / "unsafe\nS9,S1",
  anything else is an uncharged 502). Demand (25 Oct probe): pii detection 41, pii redaction 39, content moderation 30.
- src/lib/openai-moderations.ts: `/v1/moderations` front, same pattern as /v1/images/generations (forward through
  `app.fetch`, `asFrontQuote`, one input per request). `FROM_GUARD` maps Llama Guard codes onto OpenAI category names;
  unmapped codes (S6 advice, S7 privacy, S8 IP, S13 elections, S14 code abuse) only show in `llama_guard_categories`.
- tests/families.test.cjs allows $0.002-$0.01 for `/ai/model/<slug>` and `/ai/moderation` (per-model prices).

## Faster releases (1.74.0, 25 Oct 2026)

- `release.ps1 -SkipTests`: the train (train-delta.ps1) passes it when the branch's script has the switch, because it ran `npm test`
  on the same tree already and CI runs it on the PR. `smoke:examples` runs after `pr-create` while CI works; `-Dry` runs it
  before stopping. Queue several finished changes as ONE release (one Base..Tip patch) instead of one release each: every
  release costs about 25 minutes of CI, staging proofs, deploy and live checks.



## Get contents, rerank and whale alert (1.75.0, 25 Oct 2026)

- src/routes/retrieval.ts: `/contents` (`contents()`: up to 5 URLs through `extract()` in parallel, `statuses` per URL,
  502 uncharged when none reads) and `/ai/rerank` (`RERANK_MODEL` @cf/baai/bge-reranker-base, `rerank()` takes the AI runner
  as a parameter so tests need no Workers AI). `listInput()` reads a JSON array, lines, or a comma list.
- src/lib/cohere-rerank.ts: `/v1/rerank` front (same pattern as /v1/moderations; model name ignored).
- src/routes/whale.ts: `/whale/transfers`. `PACE` per network (seconds per block, getLogs window, most blocks per call):
  Base USDC carries ~270 transfers a block, so Base covers 3 minutes, Ethereum up to 15. A failing later window keeps what
  was read (`complete: false`); the first failing window is a 502.
- index.ts POST flattener: arrays whose items hold a comma or line break are passed as JSON (`listInput` splits them back).
- Not built on 25 Oct: OCR on Llama 4 Scout vision (two test calls timed out after 72 and 143 s; /describe uses the same
  path, check its /status before relying on it), Llama 3.2 Vision (needs a licence acceptance on the account: the owner's
  decision), token counting (small demand: 31 payers).
- src/routes/memory.ts: agent memory on KV `TRIALS` under `mem:<sha256(agent-memory:ns)>:<key>`; `DEMO_NS` is read-only (set and
  delete answer `saved/deleted: false, demo: true`) so published examples always answer. KV reads elsewhere may lag a write by
  up to 60 s (stated in every description). Privacy page (src/lib/legal.ts) names it; keep the two in step.


## $1 pack, ChatGPT plugin server and API recommender (1.76.0, 25 Oct 2026)

- $1 Stripe link (fZufZhdSGgq3bFU5MNbII06) leads `WEB_PACKS`. The Stripe account has Adaptive Pricing on: `verifyCheckout` reads
  `currency_conversion` (source_currency usd) so buyers paying in local currency get their credits.
- `/mcp/chatgpt`: signed-in server for the ChatGPT plugin listing (business/agentic/chatgpt-plugin holds the package). No
  prices, payment methods, checkout links or request ids reach ChatGPT (plugin rules: no selling credits inside the app, no
  links to checkout). `/.well-known/openai-apps-challenge` serves the domain token from `OPENAI_APPS_CHALLENGE` or KV key
  `openai-apps-challenge` (`npx wrangler kv key put --binding TRIALS --remote openai-apps-challenge <token>`).
- `/recommend` ($0.002): which of our tools to call for a task (src/routes/recommend.ts; lexical with stemming and synonyms,
  then bge-reranker-base over the top 15). It recommends our own tools only.


## Search-API request shape (1.77.0, 25 Oct 2026)

- src/lib/search-api.ts: `/v1/search`, `/v1/contents`, `/v1/answer` take the neural-search SDK bodies and forward one GET to
  /search, /contents or /ai/answer through the middleware (same pattern as the other /v1 fronts). `contents.text` on a search
  reads the top 5 pages after the paid call. Brave's end-user terms travel in `terms`.
- Measured 25 Oct, do not lower prices for the "fleet" wallets (0xe827, 0x2465, 0xb83b): 72% of their calls go to listings at
  $0.002 or less across ~100 sellers at ~7 calls each per two days, so matching them would earn about $0.02/day while cutting the
  sweeper's $0.01 payments by 80%. Agent402's router reads us as routerDispatchEligible on Base since 25 Oct.

## x402scan registration and the default Bazaar order (1.82.1, 26 Oct 2026)

- `npx agentcash register` timed out at 30 s on every release from 23 to 26 Oct (x402scan probes 570+ tools in about 3 min), so AgentCash search never indexed the catalog. release.ps1 uses `%LOCALAPPDATA%\agent-data-tools\agentcash-long` (a copy of agentcash 0.17.1 with `DEFAULT_USER_FETCH_TIMEOUT = 9e5` in chunk-RAS5DZPQ.js) when present. Rebuild it after an agentcash upgrade.
- The CDP Bazaar default list (`/platform/v2/x402/discovery/resources`) is bands by 30-day payers plus calls, each band sorted by last settlement. Metadata (output schema, name) only separates the bottom band. Names and tags cannot lift a listing; distinct outside payers settling x402 through CDP can. Card credits, free calls, Tempo and FluxA never reach those counters.



## Payment refusals on /status, /ip/geolocate free (1.84.2, 31 Oct 2026)

- `/status` lists `paymentRefusals` per tool: `requestMetricsMiddleware` queues the reason of every 402 answered to a request carrying a payment (`refusalReason` in src/lib/failure-reason.ts), and `Metrics.status` keeps 402 reasons apart from `topFailures`. Read it before guessing why a buyer did not complete. Our messages must not put caller-chosen values on it: `refusalReason` strips the ones we echo today, so extend it when adding a refusal message that echoes input.
- The log line `Route "GET /…" has an invalid bazaar extension: Schema validation failed: JSON Schema compilation is unavailable` is the deliberate Ajv stub (src/lib/ajv-unavailable.ts). Live quotes carry the full extension (compared on 31 Oct for /evm/verify-signature, /evm/checksum, /time). Ignore it.
- `/ip/geolocate` is free-call eligible; `NEEDS_REMOTE_DATA` in scripts/smoke-examples.mjs skips it locally because the shards exist only in remote KV.



## Price test until 14 Nov 2026 (1.84.3, owner's go-ahead 31 Oct) - ENDED EARLY 5 Nov 2026

- **Ended 5 Nov 2026 (owner: "revert now"):** in five days no pack sold at $0.03 and `/dex/new-pools` never sold at $0.05, while one-cent tools kept selling to returning buyers. `PACK_PRICE` is gone; all 24 packs and `/dex/new-pools` are $0.01 again, the copy says every tool costs at most one cent, and the freeze fixture carries the decision. The rest of this section is history.

- `PACK_PRICE` ($0.03, src/family.ts) on all 24 packs and $0.05 on `/dex/new-pools`; everything else is unchanged. This overrides the 25 Oct "every tool at most $0.01" rule for these tools only, so comments elsewhere that say so are history. FluxA's one-cent catch-all no longer passes these tools: they answer the normal 402. The Bazaar shows each listing's last settled price until it settles again.
- To revert: set `PACK_PRICE` and the `/dex/new-pools` price back, restore the copy in src/discovery.ts ("Most tools cost"), the test pins (families, chain-more, discovery-client, packs-intel, packs-research) and run `scripts/freeze-prices.mjs`, then `update-402index-prices.mjs`.



## Card path copy and measurement (1.84.4, 31 Oct 2026)

- `CARD_JOBS` in src/lib/credit-routes.ts drives the /credits opening ("What $1 buys"); tests/credit-jobs.test.cjs pins its credit costs to catalog prices, so a price change fails there. `callsAt()` (src/lib/credits.ts) counts calls at a tool's own price for hints.
- `free_exhausted_by` counts exhaustion at `/caller/<software family>` over HTTP only; read it before calling `free_exhausted` a buying moment (31 Oct samples: machine traffic). Family names have `_` mapped to `-` because funnel paths reject underscores.
- Search Console, 31 Oct: 1 page indexed, 195 "Discovered, not indexed", 0 "Crawled, not indexed", sitemap read 29 Oct with 575 pages; 0 clicks and 39 impressions in 28 days. Google has not crawled the pages, so this is crawl priority, not a verdict on their content.



## Website audit and Aura-2 speech (1.101.0, 7 Nov 2026)

- `/audit/website` (src/routes/site-audit.ts): one `withBrowserPage` load; `PERF_READ` and `AXE_RUN` are evaluated in the page as strings; `AXE_SOURCE` (src/data/axe-source.generated.ts, rebuild with `node scripts/build-axe-source.mjs` after upgrading the axe-core devDependency) is evaluated first through CDP, so a page's CSP cannot block it. Security headers come from `auditHeaders` (checks.ts, now exported) in parallel. Scores: accessibility 100 minus 15/8/3/1 per violated rule by impact; performance from LCP, CLS, TTFB, weight, requests, DOM size. Prove it on staging after every release that touches lib/browser.ts.
- `/ai/speech`: Deepgram Aura-2 (`@cf/deepgram/aura-2-en`, `-es`), $0.030 per 1,000 characters, so `SPEECH_MAX` 300 keeps a call under its $0.01 price. A longer limit needs a higher price (owner's decision). `audioToBase64` takes a stream, bytes, a buffer or `{ audio }`.
- Both are in `CAPACITY_LIMITED`. BROWSER_DAILY_CAP is 200 (about 15 s of browser time a call; Workers Paid includes 10 browser hours a month).



## Failures that were ours (1.101.1, 7 Nov 2026, no new tools)

- A JSON 500 with `error: "Internal Server Error"` on /status is @x402/hono's own `internalErrorResponse` (our onError says "internal error"). The paywall wrapper in src/index.ts retries once on a fresh gateway when the library fails before the tool ran (`gatewayFailed`, `ran` flag), then answers 503 `PAYWALL_UNAVAILABLE` with Retry-After. MCP's `paymentState` retries `startPayments` once. Tests: tests/gateway-startup.test.cjs.
- Body reads after `fetchPublic` share its timeout signal: wrap them in `bodyWithin()` (src/lib/fetch.ts) so a slow target is a 504 TARGET_UNAVAILABLE, not our 502. Done for `fetchFile` and the cache path; other callers read bodies themselves.
- ARIN (rdap.arin.net, whois.arin.net) answers Cloudflare egress with 525. `/ip/lookup` falls back to RIPEstat's whois (`fromWhois` in src/routes/geo-ip.ts). Test an upstream from Cloudflare with a free trial of `/url/uptime?url=<upstream>` before building on it.
- Zero.xyz writes its own `whatItDoes`/`whenToPreferThis` once per capability and does not regenerate them when our description changes (7 Nov: /weather's record still says lat/lon only and "prefer alternatives for city lookup"); its search ranks on that text. Our descriptions reach the record's `description` field only.




## Entry paths for Zero.xyz intents; US Treasury data (1.102.0, 7 Nov 2026; 635 tools)

- Zero.xyz writes `whatItDoes` once per URL (first crawl) and never regenerates it, and its 66 demand intents (`api.zero.xyz/v1/intents/<slug>`, members ranked by Zero-routed calls) held us in 1 of 66 while we sell the tool for about 25. A new URL gets a fresh write (/stock/quote was #2 for "stock price" the day after release). `src/routes/entry-paths.ts` therefore adds one task-named door per intent (19), each running the canonical tool's handler (`ENTRY_OF` maps door to canonical) at the canonical's live price; the canonical path keeps its Bazaar payers and history. Rules: a door's summary starts with the buyer's task words and its description's first sentence is the task; a capacity-limited canonical's door is in `CAPACITY_LIMITED`; an acquisition-priced canonical's door is in `ACQUISITION_PATHS`; `CATEGORY_RULES` names each door so it lands in its canonical's category (tests/entry-paths.test.cjs checks all three). One door per intent; do not add a second door for the same tool. Core tools (/weather, /domain, /fx, /screenshot) have their inputs and examples repeated in entry-paths.ts because endpoints.ts cannot be imported there (families -> entry-paths -> endpoints would be a cycle).
- Check on 10 Nov which doors joined their intent (`business/agentic/base-bots/zero-ranks.mjs` and the intents map in the 7 Nov leverage report); /stock/quote is the control case. Zero registration: the train registers once per UTC day, so a second release the same day needs `register-after-*.ps1` by hand.
- `src/routes/treasury.ts`: `/econ/national-debt` and `/econ/treasury-rates` from `api.fiscaldata.treasury.gov` (keyless, public domain; `debt_to_penny` daily, `avg_interest_rates` monthly, 16 rows a month). The Treasury API never answers Cloudflare's egress (every URL a silent 9 s timeout from production on 7 Nov 2026; 300 ms from the PC; same class as the Treasury yield-curve CSV), so the tools read a KV snapshot: `scripts/fetch-treasury.mjs <outDir>` writes a wrangler bulk-put file and `%LOCALAPPDATA%\agent-data-tools\release\train\upload-treasury.ps1` puts `treasury:debt` and `treasury:rates` into TRIALS on staging and production (the ip-geolocate pattern). Answers carry `snapshotAt`; no snapshot is an uncharged 503 `TREASURY_UNAVAILABLE`. Refresh daily from the PC (the owner decides which scheduled job carries it); `NEEDS_REMOTE_DATA` skips both in the local smoke run. FRED needs an API key and an account, so it was not used.




## Entry paths, round 2; release tooling on the real disk (1.103.0, 7 Nov 2026; 639 tools)

- Four more doors in `src/routes/entry-paths.ts`: `/image/generate` (/image), `/scrape` (/extract), `/page/host` (/page/publish), `/llm/chat` (/ai/chat), picked by Zero.xyz's largest intents (image generation 98+87 searching agents in 90 days, web scraping 79, static hosting 46, LLM chat). Measured three hours after 1.102.0: the first doors ranked at once (USDC yield #1, summarize #1, national debt #3, company lookup #3, screenshot #4, weather #5), so the mechanism is proven; judge each door by Zero-routed calls and intent membership (`business/agentic/base-bots/kpi.mjs`, daily).
- The release train now lives on the real disk: `C:\MoneyWallet\business\agentic\release\train\train-delta.ps1` (patches, notes-<version>.md, claude-<version>.md and logs next to it). `%LOCALAPPDATA%\agent-data-tools\release\train` exists only inside the Claude session sandbox overlay: the real OS and Task Scheduler do not see it (7 Nov 2026). Anything a scheduled task runs lives under C:\MoneyWallet. Runbook: `C:\MoneyWallet\business\agentic\OPERATIONS.md`.


## PAY_TO is the desk's income wallet (1.104.0, 7 Nov 2026)
- Every EVM payment goes to 0x6293ded2684f1a76e26becef87c137d691fbf800, a plain key held by Eyconomics on the owner's PC (`%LOCALAPPDATA%\Programs\Eyconomics\app\secrets\income_key.dpapi`); Eyconomics sweeps it to Coinbase and invests it. The Coinbase Wallet 0x2074…77f5 received everything before that (history on x402scan/Bazaar is under the old address). Never change PAY_TO without the owner; the ownership proof in `src/discovery.ts` must be re-signed by whoever holds the new key (Eyconomics' `eth.sign_hash(priv, eth.personal_hash(origin))`).
- Since 1.104.1 (owner, 8 Nov 2026) `TEMPO_PAY_TO` is the same desk wallet, so MPP tempo payments land there too. Eyconomics' income scan and sweep cover Base, Polygon and Arbitrum only; Tempo USDC.e stays in the wallet until that is added. Solana still pays her Phantom wallet.

## Short-name entry paths (1.105.0, 9 Nov 2026; 655 tools)

- Zero.xyz retrieves about 50 candidates per search by similarity, so a long multi-phrase name misses short queries (/token/price #1 for "token price lookup", absent for "token price"; the winners are named "Token Price"). Round 4 in `src/routes/entry-paths.ts` adds 14 doors named with the bare phrase: /price/crypto, /web/search, /balance/wallet, /weather/today, /ofac/check, /whois/lookup, /dns/records, /sec/edgar, /language/detect, /whales, /json/validator, /holidays/public, /pdf/extract, /uniswap/liquidity. Rule now: at most two doors per tool, each with a different name phrase (tests/entry-paths.test.cjs). `POST api.zero.xyz/v1/search` takes `limit` up to 50; use it when measuring, the default shows 15.


## Inputs as buyers and routers send them (1.106.0, 10 Nov 2026, no new tools)

- Read `execution_failed` per tool in the /revenue funnel (`business/agentic/base-bots/paid-failures.mjs`): a verified payment that ends in a 400 is a lost sale and, for a router, a failed health sample. On 10 Nov /weather had lost 9 of 19 paid attempts and /llm/chat 3 of 4.
- **Routers plan from the listing schema.** Mercator's search API shows its plan per endpoint (`suggestedPlanNode.input`) and its own health record (`providerHealth`: sampleSize, successRate, state, scoreMultiplier 0.5 when degraded): `business/agentic/base-bots/mercator-ranks.mjs --show`. A tool with no required input was planned as `"input": {}`. `ONE_OF_INPUT_PATHS` (src/lib/bazaar-extension.ts) makes the LISTING name the published example's input as required for the tools that take one of several inputs; MCP and OpenAPI keep every input optional. tests/buyer-inputs.test.cjs calls every tool without a required input with no input and fails when the set is not exactly the ones that answer 400, so a new one-of tool must be added there. The Bazaar (and so Mercator) takes the new schema with the tool's next settlement.
- **Aliases** (`INPUT_ALIASES` in src/tools.ts) are read only when the tool asks for an input the caller did not send, and never when the alias is one of the tool's own inputs (`declaredInputFor`). `messagePart()` turns an OpenAI `messages` array into prompt and system for the prompt tools without a messages input. The POST flattener (src/index.ts) forwards arrays and objects of known or aliased fields as JSON text.
- A 400 from a tool carries `inputs` and `example`. /status `topFailures` ends with `[sent a,b]` for refused paid calls: the input NAMES only (`sentInputNames` in src/lib/request-metrics.ts). Read it to find the next missing alias.
- Measurement trap: PAY_TO moved to 0x6293 on 7 Nov; scripts that still filter on 0x2074 only see nothing after that (payments-to-us.mjs and full-history.mjs were fixed on 10 Nov; the KPI had read $0.86 for a week that earned $1.32). Use `lib.mjs` `oursAll`.


## Doors for the flows that bring new payers (1.107.0, 10 Nov 2026; 659 tools)

- **Where new wallets come from** (`business/agentic/base-bots/new-wallets.mjs`, `starter-demand.mjs`): about twenty fresh wallets a day-pair paid us once at the acquisition price on /weather/forecast, each also paying one or two other sellers once. Market-wide the "current weather" leader gained 266 payers in three days. `bazaar-search.mjs "<query>"…` prints the live Bazaar search with payers and prices; `bazaar-search-compact.mjs` our position and the top three.
- **What a distinct payer is worth** (`band-map.mjs`, `band-calls.mjs`, 9 Nov snapshot): our listings with 3+ payers sit at #5,700-7,500 ordered by last settlement (newest first), with 2 payers near #14,000, with 1 near #19,450. The explorer bots buy from about #1,000-8,000. So the lever for the median is a third distinct payer per listing, and task-named doors in a flow of new wallets are how a listing gets one.
- Round 5 doors in `src/routes/entry-paths.ts`: /web/fetch, /email/auth, /tech/detect, /crypto/news (`cryptoNewsInput`: default topic and the past day, so an empty call answers), and /weather/current, named "Current weather" (it was /weather/today for one day; src/index.ts redirects the old path with a 308). Agent402's router (`agent402-route-ranks.mjs`) scores the URL slug most, so a door's path should hold the task words too. A Brave-backed door joins `CAPACITY_LIMITED` and `DIRECTORY_EXCLUDED`. The Bazaar lists a door only after its first settlement.
- Staging delivery check of the 60 most-bought tools: copy `business/agentic/base-bots/delivery-check-staging.mjs` into x402-w11 (funded test wallet) and pass the paths; results in `base-bots/data/delivery-<day>.txt`.


## GitHub repository data (1.108.0, 10 Nov 2026; 662 tools)

- `src/routes/github.ts`: `/github/repo` (facts, language shares, latest release: three reads, the last two best effort), `/github/search` (repository search; 30 searches a minute with a token) and `/github/releases`. Owner's decision: repository data only. GitHub's terms restrict selling users' personal information, so never add profile, e-mail, avatar, contributor or stargazer fields (tests/github.test.cjs feeds GitHub's real owner and author objects and asserts none of it is returned).
- Secret `GITHUB_TOKEN` (production and staging; a fine-grained token with no permissions, public repositories read-only; the owner creates it and it has an expiry date). Keyless reads from Cloudflare were refused 1 time in 3 on 10 Nov, so do not sell these without the secret. A 401 (expired token) logs a warning and reads without it; a used-up limit is a 503 `GITHUB_BUSY`, uncharged. Answers are cached five minutes at the edge.
- Acquisition-priced (`ACQUISITION_PATHS`). `repoName()` takes owner/name, any github.com URL, an SSH remote, or a bare name with `owner`.


## Live answers on tool pages; where our own customers can come from (1.109.0, 10 Nov 2026)

- Measured 10 Nov (`business/agentic/base-bots/human-funnel.mjs`, `mcp-funnel.mjs`, Search Console): the top of the card funnel is empty. 0 search clicks in 28 days; browser page views are 97% referrer-less fetchers; /credits had 64 views and /credits/claim 0 in 14 days (no checkout ever completed); MCP "free_exhausted" comes from directory probes repeating the same tools daily. The pages themselves convert fine in form (free run, card from $1).
- Google indexes 1 of 608 pages on workers.dev and shows the same pages on `tools.funwords.eu` (self-canonical mirror since 31 Oct: 359 impressions in its first week, position about 24, no clicks yet). The permanent public domain is the owner's decision.
- `src/lib/live-pages.ts`: `isLivePage` (a list plus `/<network>/gas` and `/<network>/block`, never a `CAPACITY_LIMITED` tool) and `liveAnswer()` (the tool's published example, cached 15 minutes in `caches.default`, 3.5 s budget, never throws). `toolDocPage(e, origin, freeCalls, live)` renders "Live result" with the read time. Add a tool to `LIVE_EXACT` only when its example has a changing answer people search for.


## The public home of the human pages (1.109.1, 10 Nov 2026)

- Owner, 10 Nov 2026: "we keep tools.funwords.eu for now we buy a dedicated one later". `PUBLIC_SITE_ORIGIN` (wrangler.jsonc, production only) names it; `withPublicCanonical()` (src/lib/public-site.ts) rewrites only the canonical and og:url tags of 200 HTML pages served from another host. When the dedicated domain arrives: add it as a route, set `PUBLIC_SITE_ORIGIN` to it, and answer the old public host's human pages with a 301 to the new one (not built yet). Search Console: property sc-domain:funwords.eu, filter page contains tools.funwords.eu; judge by clicks there, weekly.


## Weather default (1.109.3, 10 Nov 2026)

- `/status` `[sent nothing]` on a refused paid /weather call settled the open question from 1.106.0: empty calls are real. `weather()` answers a call with no place for `DEFAULT_CITY` (London) with a `note`; descriptions state the default. Apply the same only where a tool has an honest, documented default and `/status` shows `[sent nothing]` on paid calls; otherwise keep the tool in `ONE_OF_INPUT_PATHS`.


## Keeping the paying wallet: USDC prepaid balance, free finder, catalog skill (1.110.0, 10 Nov 2026)

- Measured 10 Nov (`business/agentic/base-bots/wallet-share.mjs`): the 35 outside wallets that paid us in 7 days spent $276.84 on x402 calls and $1.39 of it with us (0.5%). They buy the same jobs elsewhere, do not pick on price, and a wallet that paid us was a stranger on its next call. Plan: `C:\MoneyWallet\business\tool-selling-growth-plan-2026-11-10.md`. The owner approved all six decisions the same day.
- **USDC prepaid balance** (`src/lib/usdc-credits.ts`, owner's decision): `GET /credits/usdc/1`, `/5`, `/20` are x402 routes (v2, exact, every network in `paymentOptions`) that return an `adt_` key from the card ledger (`USDC_PACKS` in `src/lib/credits.ts`: the card packs up to $20, same credits and bonus). `X-API-Key` or `Authorization: Bearer` with an existing key tops it up. The x402 library runs the handler before it settles, so the handler grants nothing: credits are written only after the library returns a successful `PAYMENT-RESPONSE`, with the settlement transaction as the session id (idempotent). An unknown key and an unavailable credit store are refused before any payment is verified. If the ledger cannot be written after a settlement, the grant is parked in KV (`credit-unsaved:<key hash>:<session>`) and `applyUnsavedCredits` applies it at the next `/credits/balance`; the log line is `CREDITS_UNSAVED`. Inside a route handler Hono ignores a returned Response once `c.res` is set, so the handler replaces `c.res` (clear it first). Pack sales are in `/revenue` `byEndpoint` under their own paths (`PATHS` in settlement-ledger.ts) and mark the funnel stage `credits_bought`. Not offered over x402 v1 or MPP (the card packs' MPP route `/credits/buy/*` is unchanged). The Bazaar lists a pack after its first settlement; nobody seeds them.
- Where buyers are told: `prepay` in every tool's 402 body (`usdcPrepayLine`), `/credits` (JSON `usdc` and the page), the MCP instructions, llms.txt, the OpenAPI guidance, and OpenAPI paths with `x-payment-info`.
- **Free tool finder** `GET /find?need=<plain words>` (`src/index.ts`; `recommend()` with no reranker, so no model cost; also `q`, `task`, `query`, `count`). Not a tool, not in ENDPOINTS or MCP. The 404 answer and the OpenAPI guidance point at it. `/recommend` stays the paid version.
- **MCP answers** carry `_meta.relatedTools` (names of up to three related tools this server offers; `relatedTools()`), and the pick-by-task guide names the packs.
- **Catalog skill** (`src/guides/catalog-skill.ts`): served at `/skills/agent-data-tools/SKILL.md` and `/.well-known/agent-skills/agent-data-tools/SKILL.md`; `/.well-known/agent-skills/index.json` follows Agent Skills discovery 0.2.0 with the SHA-256 of the bytes served. The repository copy `skills/agent-data-tools/SKILL.md` is written by `node scripts/build-catalog-skill.mjs` and tests/catalog-skill.test.cjs fails when it differs or names a path or input that is not live: rerun the script after editing the skill or renaming an input. No per-tool prices in the skill (they change).
- **Claude Code plugin**: `.claude-plugin/plugin.json` (inline `mcpServers` to `/mcp`; the repository root is the plugin, so `skills/` is its skills folder) and `.claude-plugin/marketplace.json`. Users: `claude plugin marketplace add Nutshell2000/agent-data-tools`, then `claude plugin install agent-data-tools@agent-data-tools`. Never add a root `.mcp.json`, `commands/`, `agents/` or `hooks/` folder by accident: the plugin would load it.


## The finder and the phrase as written (1.110.1, 10 Nov 2026)

- `lexicalScore(query, doc, written)` in src/routes/recommend.ts: `written` is the request in the caller's own word order (`asWritten`), and a name that starts with it, a name that holds it, or a tag that holds it adds 8, 6 or 5 before the division by the word count. Without it "text to speech" and "speech to text" scored the same and `/find` answered /transcribe for a text-to-speech job. Each canonical tool's `also` field carries the names and tags of the entry paths that run it, so the phrase a door was named for finds its tool (the finder never names a door).
- Check the finder after adding a tool or a door with a list of real job phrases (the list in tests/recommend.test.cjs, and `business/agentic/base-bots/buyer-next.mjs`, which matches what our buyers pay other sellers for against `/find`). That report's matches are suggestions from words: it paired "audit bundle" with /package-audit. A wallet-aware "next tool" needs a hand-made job-to-tool table, not that map.



## Lost paid calls, signature calls, long speech, job names in the finder (1.111.0, 11 Nov 2026; 663 tools)

- **VIES is asked again** (`viesCheck` in src/routes/registries.ts): in the week before, 19 of 28 `/vat/validate` calls ended "VIES answered MS_MAX_CONCURRENT_REQ" (a member state allows few simultaneous checks). Up to three tries (0.5 s, 1.3 s) inside about 12 s, only for busy signals, 429/5xx and timeouts; a clear answer is kept in `caches.default` for an hour with its own `checkedAt`.
- **The IP tools answer for the caller** (`ipOrCaller`, `CALLER_IP_INPUT` in src/routes/geo-ip.ts): `/status` showed paid `/ip/lookup` calls refused with "ip is required". The HTTP route (src/index.ts) hands a tool the request's `cf-connecting-ip` under the reserved input name `@caller-ip`, which is never read from the query; an answer for it carries a `note`. MCP and the packs do not set it (over MCP the caller is the assistant's host), so `ip` is still needed there. Both tools are in `ONE_OF_INPUT_PATHS`, so listings keep naming `ip` and routers plan a real lookup. Do not use the header for any other input.
- **Contract calls from a function signature** (`callFromSignature` in src/routes/chain-reads.ts, every `<network>/call`): `data=balanceOf(address)&args=0x…` is encoded with viem; result types from `returns (…)` in the signature, the `returns` input or `STANDARD_RETURNS` (the ERC-20/721 getters) decode the answer into `decoded`; without them the raw result stands with a `decodeNote`. `INPUT_ALIASES` reads function, signature, method and calldata as `data`, arguments and params as `args`. Checked live on Base and Polygon from the PC on 11 Nov.
- **`/text-to-speech`** ($0.08, src/routes/ai-text.ts): up to `SPEECH_LONG_MAX` 2,000 characters. `speechParts()` cuts at sentence ends into parts of at most `SPEECH_PART_MAX` 450 characters (Aura-2 needs about half the audio's length to speak a part, so the longest part sets the wait: three 630-character parts took 21 s on staging), the parts are spoken in parallel and `joinMp3()` joins them (later ID3 tags dropped; the staging file was 4,347 clean frames, 104 s). `OPENAI_VOICES` maps OpenAI's voice names to Aura-2 voices on both speech tools, because the top speech seller in Mercator's catalog is OpenAI's /v1/audio/speech and its clients send alloy, nova and so on. Not built: an OpenAI-shaped `POST /v1/audio/speech` front that returns the audio bytes. A failed part fails the call, uncharged. Cost $0.030 per 1,000 characters, so $0.06 at full length; the price is the owner's to change. Why: Mercator's gateway paid other sellers $37 in a week for speech at $0.02 to $0.10 a call while `/ai/speech` refuses anything over 300 characters. In `CAPACITY_LIMITED` and `GENERATIVE_MEDIA`. Prove it on staging after every release that touches it (the PC smoke run skips AI tools): one call under 450 characters and one near 2,000, and walk the joined MP3's frames (no bytes between frames).
- **Finder** (src/routes/recommend.ts): `JOBS` maps job names to tools (+10 on top of 1.110.1's `written` scoring, the longest phrase wins; the reranker cannot push that tool off the top). Add a phrase when `business/agentic/base-bots/buyer-next.mjs` shows a job landing on the wrong tool; tests/recommend.test.cjs checks every path exists.
- **`/status`** has `byDay` (served, serverErrors, successRate per UTC day), `medianDailySuccessRate` and `daysAt99`: the 7 Nov incident alone made the week read 54%.



## Audio over MCP, larger pages, the speech tool's name (1.111.1, 11 Nov 2026)

- `toContent()` (src/mcp.ts) returns `audioBase64` as an MCP `audio` content block, like `imageBase64` as an `image` block, and `runTool` leaves both out of `structuredContent`. Before this the speech tools put the whole file into the text block: about 55 KB of base64 for `/ai/speech` and up to 800 KB for `/text-to-speech`, read by the model as text. Any new tool that returns a file must use one of these two field names or get its own block here.
- `MAX_ELEMENTS` (src/lib/page-content.ts) is 60,000. The old 20,000 dated from the free plan (10 ms of CPU); `/status` showed five "HTML complexity limit exceeded" refusals in a week. Measured on the PC: 59,000 elements (845 KB) in 0.35 s; Wikipedia's longest articles hold about 15,700. The 128-level depth limit and the 2 MB input cap are unchanged. The fixture `many` in tests/fixtures/extract-pages.cjs holds 60,001 elements.
- `/text-to-speech`'s listing name is the bare phrase "Text to speech". Register a NEW path with Zero.xyz only when its name is final: Zero writes the record once from the first crawl.



## A documented default for a call with no input at all (1.111.2, 11 Nov 2026)

- `EMPTY_CALL_DEFAULTS` (src/tools.ts): `/price/token`, `/token/price` and `/price/crypto` answer an HTTP call that carried no tool input at all for BTC, with a `note`. The HTTP route (src/index.ts) sets the reserved input `NO_INPUT` ("@no-input") only when the query string holds nothing but control parameters (`CONTROL_PARAMS`: only, trial, sample, api_key…) or empty values; the wrapper then swaps the default in and adds the note. A request with any other parameter, even a misspelled one, is handled exactly as before (the 10 Nov lesson: a silent default is worse than a refusal). MCP never sets the flag. The tools stay in `ONE_OF_INPUT_PATHS`, so listings still name the input and a router plans a real one; the input's description states the default (tests/buyer-fixes-1111.test.cjs checks all of this for every entry).
- Add a tool here only when the default is what a buyer would expect with nothing said (the reference asset for a price, London for weather is handled in the tool itself) and `/status` or a marketplace shows empty paid calls. A lookup of a specific thing (an address, a domain, a company) has no honest default.
- Where the evidence came from: vAPI Network (vapinetwork.ai). Its Earn quests bring about 100 new wallets a day; its marketplace "vAPI Call" mirrors the Coinbase Bazaar, shows a mirrored listing only when its Bazaar record was updated in the last 24 hours, and its console pays from an empty form. Free search API: `api.vapinetwork.ai/api/call/discovery?q=…&kinds=api`; our position per task: `business/agentic/base-bots/vapi-ranks.mjs`; the cohort's purchases: `vapi-cohort.mjs`.
- The Coinbase Bazaar's default list is scored down to about #5,790 and then starts again with freshly paid listings; the scored part is 96% listings older than about 30 days (`business/agentic/base-bots/bazaar-tier-watch.mjs`, prediction and check dates in its header). A new URL starts outside it, so do not move or rename paths.


## The Claude Code plugin lives in claude-plugin/ (1.111.3, 10 Nov 2026)

- The plugin directory (claude.ai/directory/manage, Submit new, Plugin bundle) validates the whole plugin folder. The repository root as the plugin failed with 3 blocking issues and 69 policy holds, all from the service's own files. The plugin is now `claude-plugin/`: `.claude-plugin/plugin.json`, `.claude-plugin/icon.png` (512 px) and `skills/agent-data-tools/SKILL.md`. Nothing else may be added there: tests/catalog-skill.test.cjs lists the folder's files exactly.
- `scripts/build-catalog-skill.mjs` writes the skill to `skills/agent-data-tools/` (for `npx skills add`) and to `claude-plugin/skills/agent-data-tools/`; a plugin cannot read outside its folder. `.claude-plugin/marketplace.json` at the root points at `./claude-plugin`.
- In the directory form use repository `Nutshell2000/agent-data-tools` with plugin path `claude-plugin` and the default branch. A branch name with a slash must go in the branch field, not in a /tree/ link. The form's Compliance step agrees to the directory terms on behalf of the owner's organization: the owner ticks it.
- Bump `version` in plugin.json when the skill or the server URL changes; the directory tracks the default branch.


## Payout wallets declared for trust checkers (1.111.4, 11 Nov 2026)

- `src/lib/payout-wallets.ts`: `payoutWallets(env)` (current `PAY_TO`, `TEMPO_PAY_TO`, `SOLANA_PAY_TO` and `PREVIOUS_PAY_TO`) and `paycheckDeclaration(env)`, served at `/.well-known/paycheck.json`. Why: the 7 Nov change of `PAY_TO` (1.104.0) was undeclared, and Lumière PayCheck (lumierepaycheck.org; it re-reads the file every six hours) capped every tool at grade C, "pay only small amounts"; Keptvow and Hagglyai flagged a wallet mismatch because 620 of 672 Bazaar listings still showed the old wallet.
- **When `PAY_TO` changes again:** add the old address to `PREVIOUS_PAY_TO` in the same release, and re-settle the Bazaar listings soon after (a listing keeps the wallet and price of its last settlement). A wallet missing from the file is treated as a hijack and blocked.
- Check after a change: `https://lumierepaycheck.org/v1/score?url=<origin>/weather` and `https://keptvow.com/v1/wallets/<PAY_TO>`.
- The `tests` block holds known-answer checks a checker may run with its own paid call; only tools whose answer never changes belong there.

## Round 6 entry paths, written for a full re-settle (1.111.4, 11 Nov 2026; 671 tools)

- Eight doors in `src/routes/entry-paths.ts`: `/bitcoin/price` and `/bitcoin/fees` (core tools, so their inputs and examples are repeated in `CORE_BTC_PRICE` and `CORE_BTC_FEES`), `/gas/price` (gas-tracker pack), `/company/enrichment` (domain-intel pack), `/tx/decode` (tx-explain pack), `/url/unshorten` (redirects), `/exif` (image metadata), `/market/sentiment` (crypto-market pack). Picked from `base-bots/name-plan.mjs` and `flip-candidates.mjs` on 10 Nov (#1 in 228 of 388 Bazaar searches; 44 where nobody above us has more payers; 4 where the tool exists and is absent). Not built: a "smart money" door for `/token/buyers` (it shows net DEX flow of the last hour, not labelled wallets), and a card-number door for `/validate/luhn` (dropped).
- Timing rule: add doors and change names BEFORE a full re-settle, never after. A settlement is when a name, its tags, its input schema, its price and the payout wallet reach the Bazaar, and a new URL starts its listing age (about 30 days outside the scored tier) from its first payment.
- Before a paid run over every listing, prove every tool on its published example: `npm run smoke:examples` (local, 608), then `business/agentic/base-bots/delivery-check-staging.mjs` on the tools the local run skips (capacity-limited, `/ai/*` and their doors, and the five that read KV data): 55 of 55 on 10 Nov.

## Three sweeps over every tool (1.111.4, 11 Nov 2026)

- The scripts are in `C:\MoneyWallet\business\agentic\release\train\`; each takes the worktree as its first argument and `""` as the path filter. Run all three before any paid run over every listing, and after a batch of new tools.
  - `sweep-fuzz.cjs <repo> "" out.json`: 26 hostile values on every input of every tool with the network cut (34,000 calls, two minutes). A tool must refuse with a 4xx, reach the network or answer; anything else is a 500 a buyer would see. Found: `date=constructor` and `date=__proto__` crashed `/date/add`, `/date/info`, `/sun` and `/moon` (`DAY_WORDS` in src/lib/relative-date.ts was indexed without `Object.hasOwn`), and `model=constructor` crashed `/ai/chat-large`. The 1.58.0 rule stands: a table keyed by caller input is read with `Object.hasOwn`.
  - `sweep-shape.cjs <repo> "" out.json`: every tool on its published example, live, compared field by field with the example its listing shows, and listing the answers that are null or empty where the listing shows data. It skips capacity-limited and AI tools (staging proves those).
  - `sweep-quotes.mjs`: every live 402 quote, which is what a settlement writes into a listing (wallet, amount, name length, tags, schema, example).
- `/company` (`bestCompany` in src/routes/company.ts): among the items that match a name, the one named exactly what was asked comes first, then the one with the most company facts (`companySignals`), then search order. Wikidata holds three "Spotify" items; the first is the service with a CEO and nothing else.
- `EX_BUSY` (src/routes/chain-reads.ts): the example address of `<network>/token-transfers`, `/wallet/transactions` and `/wallet/related`. Uniswap's v4 pool manager where the network has one, otherwise the busiest USDC pool of 11 Nov (`probe-busy.cjs <repo> all` in the train folder finds candidates and tests them through the tool). `EX_LOGS` names the wrapped native token for the event-log example where USDC is quiet (Mantle, Ink, zkSync, Celo). A personal wallet as an example returns an empty answer; if the example sweep shows one empty again, pick a new address the same way. Exchange hot wallets known from memory returned nothing.
- `FILL_TAGS` (src/lib/bazaar-extension.ts) brings 20 tools to five listing tags; tests/sweep-fixes-1114.test.cjs requires five on every tool, and that an example answer repeats its example's url, address, domain, symbol and count. `/summarize` is the one exception: Wikipedia redirects its example URL and the answer shows the final one.


## The ChatGPT plugin server is free; MCP annotations (1.111.5, 10 Nov 2026)

- OpenAI rejected the plugin on 5 Nov 2026: commerce, annotations that did not match behaviour, restricted data. Its rules (developers.openai.com/plugins/plugin-guidelines): only physical goods may be sold; no digital services or credits "directly or indirectly (for example, through freemium upsells)"; trial plugins are not accepted; `readOnlyHint`, `destructiveHint` and `openWorldHint` must be explicit on every tool and match what it does. Owner, 10 Nov: "Yes, free version". This overrides the 1.76.0 note that credits are bought on our site: on `/mcp/chatgpt` nothing is sold at all.
- `src/lib/chatgpt-tools.ts` is the whole policy: `CHATGPT_TOOLS` (86 paths, the header comment gives each rule a tool was left out by), `CHATGPT_CALLS_PER_DAY` 50 and `CHATGPT_CALLS_TOTAL_PER_DAY` 5,000, and `CHATGPT_WORDING` / `chatgptText()`: the catalog's descriptions are written for paying agents, so "uncharged", "before a swap or payment" and names of tools the server does not offer are replaced for ChatGPT only. tests/chatgpt-mcp.test.cjs fails when a replaced text is no longer in the catalog, when any ChatGPT text holds such wording, and when a listed tool breaks a rule (capacity-limited, entry path, a write, a restricted input name). Add a tool there only if it costs nothing per call and passes that test; never a `CAPACITY_LIMITED` tool, because the allowance is free.
- `useDailyCall` (src/lib/credit-routes.ts) and `takeDailyCall`/`refundDailyCall` (src/lib/free-calls.ts, Metrics object, keys `daily:caller:<hash>` and `daily:total`, each one record holding its day). It does not depend on `TRIALS_ENABLED`. A used-up day marks the funnel stage `free_exhausted`, so that stage now also counts ChatGPT users at their daily limit: they cannot buy, so do not read them as buying moments.
- `fromChatGpt(redirect_uri)` (src/lib/oauth.ts) decides the sign-in page: one Continue button, no key field, and a posted key is ignored. Every other client keeps the key sign-in.
- Annotations (`annotationsFor` in src/mcp-contract.ts): `WRITE_TOOLS` holds the four tools that change something (memory set/delete: destructive, closed-world, idempotent; page publish/host: destructive, open-world). `LOCAL_PATHS`, the memory reads and `/time` are closed-world. A new tool that writes anywhere must be added to `WRITE_TOOLS`, and to `DIRECTORY_EXCLUDED` if what it writes cannot be taken back.
- `/mcp/account` leaves out every entry path (`ENTRY_OF`): doors are second names for outside search engines, and a directory reviewer or a signed-in user's assistant should see each tool once. A new door therefore never needs a `DIRECTORY_EXCLUDED` entry; a new canonical tool that must stay off the directory servers still does.
- The plugin package is `C:\MoneyWallet\business\agentic\chatgpt-plugin` (plugin.json, mcp.json, the ZIP). A resubmission needs a higher manifest version, the new ZIP uploaded to the same plugin at platform.openai.com/plugins, Rescan, five positive and three negative test cases that use listed tools, and a demo recording. The owner submits.
- The Claude plugin manifest carries `termsOfServiceUrl`, `supportUrl` and `documentationUrl`: the plugin directory's Listing details step otherwise fills Support and Documentation from README links. A draft submission (Source validated on main, Data handling answered: reads and stores personal data, no other services, retention longer than 30 days, not for under-18s) was left for the owner at claude.ai/directory/manage on 10 Nov; the Compliance step and Submit are hers.



## CVE lookup; doors for timezone convert, current time and perp funding (1.112.0, 10 Nov 2026)

- **Where the picks came from: Mercator's own call counts.** Mercator's search API returns `providerHealth.sampleSize` per endpoint: the calls its router sent there in 30 days. `business/agentic/base-bots/mercator-demand.mjs` sweeps about 180 job phrases and writes `data/mercator-demand-<day>.json` (`mercator-demand-read.mjs` prints it); `mercator-jobs.mjs "<phrase>"…` shows the top five and ours for a job; `buyer-sellers.mjs <wallet> <days>` lists every seller a buyer paid with the matching listing; `bazaar-word-demand.mjs <word>…` sums 30-day calls and payers of Bazaar listings whose path or name holds a word. Measured 10 Nov: Mercator's reviewed providers got about 76,000 calls (Exa search alone 36,800) and all Bazaar-imported sellers together about 7,700, of which we got 23 (/news 21, /extract 2). The imported volume sits in a few jobs: GitHub user lookups 3,123 (not ours to sell: the owner's repository-only decision), URL fetch about 800, page to Markdown about 520, CVE lookup 177, then FRED, sports odds and social data we do not sell.
- **How Mercator scores** (same sweep): score = 0.95 x relevance + 0.05 x 1/(1 + price/$0.01), times the health multiplier. Relevance for an imported listing comes from its path words, first five tags, description and example, and tops out near 0.40; reviewed providers score 0.5-0.8. One cent against $0.002 is 0.017 of score, more than the usual gap between neighbours in the imported band. Its catalog of us was still the 6 Nov import on 10 Nov (609 endpoints, the whole service named after one listing, "News headlines, latest news"); nothing we ship reaches it before its next import. Sellers that give each tool family its own hostname appear there as separate, task-named services: worth doing when the owner buys the domain, not before (a new URL starts its Bazaar history over).
- **`/cve`** (src/routes/cve.ts, $0.01, the catalog's ordinary price): one CVE by ID from the CVE Program's record API (cveawg.mitre.org) with CISA's enrichment container read out of the same record (CVSS where the assigner gave none, SSVC, the Known Exploited Vulnerabilities entry and its date), plus FIRST's EPSS probability (best effort: `epss` is null when FIRST is slow). `cveId()` reads an ID in any case, without the prefix or inside a cve.org or nvd.nist.gov link; `INPUT_ALIASES` reads id, cve_id, cveId and q as `cve`. `affectedView()` keeps only affected products and versions: records also list product lines that were checked and found unaffected, and old records hold "n/a" placeholders. Both sources answer Cloudflare's egress (checked through a production trial of /url/uptime). NVD's API is not used: 5 requests per 30 s per address without a key. `knownExploited.listed: false` means the record carries no CISA KEV entry, which is how CISA publishes the list into CVE records; it is not a claim that nobody exploits it.
- **Round 7 doors** (src/routes/entry-paths.ts): `/timezone/convert` and `/time/now` run `/time` (`CORE_TIME`), `/perp/funding` runs `/hyperliquid/market` and shares its acquisition price. They sit before round 5 in the list, and the four new paths get their category from `CATEGORY_OF_PATH` (src/discovery.ts, read before `CATEGORY_RULES`): add a new tool or door there instead of growing a rule's pattern, so two releases prepared at the same time do not edit the same line. All three answer a call with no input. `/extract` already has its two doors (/scrape, /web/fetch), so there is no "markdown" door although Mercator's page-to-Markdown winners are named for it; decide that only if the two-door rule is lifted.
- Not built, with the reason: an SSL certificate check (Workers cannot read a peer certificate; a hand-written TLS 1.2 handshake would miss TLS 1.3-only hosts), FRED series (needs a key and an account), sports odds, social and people data (terms and personal data).
- After the release: the owner's Refresh click lists the four new paths on the Bazaar (about $0.03); register them with Zero only now that the names are final.


## OpenAI-shaped speech; the npm client as the way into AI clients (1.113.0, 10 Nov 2026)

- `POST /v1/audio/speech` (src/lib/openai-speech.ts) is the images-front pattern with two differences: it routes by input length (`SPEECH_SHORT_LIMIT` 300 → `/ai/speech`, up to `SPEECH_INPUT_LIMIT` 2,000 → `/text-to-speech`; tests/openai-speech.test.cjs keeps both equal to the tools' own limits) and it answers with the audio bytes, not JSON. Its OpenAPI price is dynamic (the two tools' prices). An unpaid empty probe is quoted at the short tool's price. Not a tool: no MCP entry, not in /discovery/resources. Prove it on staging after a release that touches it: `node scripts/pay-test.mjs <staging>/v1/audio/speech --post-json '{"input":"Hello there.","voice":"nova"}'` and check the body starts with ID3 or an MPEG frame. The Bazaar lists it after its first settlement (`seed-bazaar.mjs --fronts`).
- npm client `agent-data-tools` 1.1.0 (clients/agent-data-tools): `setup <client>`, `mcp` (stdio proxy in mcp-stdio.mjs: POST only, no GET stream, no re-initialize on an expired session), `key`, `credits`. Key sources in order: `--key`, `AGENT_DATA_TOOLS_KEY`, `~/.agent-data-tools/config.json`, `ADT_API_KEY`. tests/npm-client-mcp.test.cjs runs it against a local fake server. Publishing is the owner's click (`C:\MoneyWallet\Publish npm client.cmd`); the repository copy is ahead of npm until she does.
- Why the client: every seller that earns owns the buyer's client; a prepaid key in the user's own client makes them our customer rather than a router's (plan of 10 Nov, workstream C).


## Reference defaults for /fx and /price/tokens; trust checkers and vAPI Call as they really work (1.114.0, 10 Nov 2026)

- `EMPTY_CALL_DEFAULTS` (src/tools.ts) gained `/fx` and `/fx/rates` (1 USD as the base) and `/price/tokens` (BTC and ETH). The 1.111.2 rules are unchanged: only an HTTP call with no input at all, a `note` on the answer, the default stated in the input's description, never over MCP. A local sweep the same evening (every tool called with nothing, network cut): 556 of 675 tools refuse an empty call, 49 of them at $0.002. That is correct for lookups of a specific thing and stays so; decide tool by tool from `/status` `[sent nothing]`.
- **Lumière PayCheck** (lumierepaycheck.org; it probes every Bazaar endpoint every 30 minutes and buyers' agents read its verdict). Read `GET /v1/sellers/<our host>` (verdict counts) and `GET /v1/score?url=<endpoint>` (reasons; 5 free checks per endpoint per caller per day). On 10 Nov it showed 33 of our 652 endpoints as "avoid" (F, "unexplained payout-wallet change") and the rest capped at C, although `paycheck.json` had been live for two hours: declarations are re-read every six hours. `POST /v1/declaration {"url":"<origin>/time"}` makes it read the file at once (free, no account) and the wallet change then reads "confirmed as the seller's own rotation". Do that right after any release that changes `PAY_TO`, `PREVIOUS_PAY_TO` or the tests.
  - The next cap is "no paid test has confirmed delivery" (C, at most 74). `POST /v1/dispute {"url":"<endpoint>"}` queues a free paid re-test: one request per endpoint per day, at most 10 paid re-tests per seller per day and $1 a week to one payout wallet; `GET /v1/dispute?url=` shows whether it ran. Ten were requested on 10 Nov (the most-bought tools). Their tester's payments are tests, never customers.
  - `KNOWN_ANSWER_TESTS` (src/lib/payout-wallets.ts): eleven tools, all in `LOCAL_PATHS`, each on its published example. tests/empty-defaults-1114.test.cjs runs every entry against the tool with the network cut and requires the query to equal the published example. Add a tool here only if it is pure computation: a test that fails for a reason outside the tool lowers the grade.
- **vAPI Call** (docs.vapinetwork.ai): its catalogue was 1,522 monitored listings on 10 Nov (`/api/call/discovery?kinds=api&includeUnverified=true`, cursor-paged), every one with at least one health check, and none of ours. Our listings appear only in its search results, always with health "unknown" and `checks7d: 0`, and only while their Bazaar record is under 24 hours old. Groups sort in a fixed order: vAPI's own, "Added APIs" (self-listed), Verified Providers, External. A mirrored listing cannot be rechecked on request (409). Self-listing is open to anyone whose endpoints pass its automated probe and pay a wallet the lister signs with; verification is a review with three paid calls per endpoint and puts the listing in default search. That needs an account and a signature by the income wallet: the owner's decision (her steps file, 10 Nov 22:45). Checked by hand against its eleven listing rules: ours pass, with one expected warning (the JSON body is the x402 v1 shape, the header v2). Its console's browser preflight for `payment-signature` is allowed.
- Keptvow (keptvow.com/v1/wallets/<PAY_TO>) repeats two flags about the 7 Nov wallet change: listings that still named the old wallet, and SealKeeper's "owner hasn't confirmed". A reply there must be signed by the payout wallet (`POST /v1/wallets/<wallet>/reply`); SealKeeper wants an owner claim. Both are the owner's.
- A buyer that picks through the paid "x402 Service Finder" (finder.kagurazaka.dev, $0.005 a question; relevance, distinct payers in 30 days, its own uptime check, price, and a `min_payers` filter) pays the listing it picks ten times in a row: `business/agentic/base-bots/buyer-sellers.mjs <wallet> <days>` shows it for wallet 0x4c29….
- Ruled out as causes of lost sales on 10 Nov: quote speed (ours answer in 150-190 ms, five competitors in 195-420 ms), CORS, and how we answer HEAD, POST and OPTIONS (the same as sellers a monitor calls healthy).
- The funnel stage `completed` did not count x402 v1 payments before 1.106.0 (10 Nov, about 09:15 UTC). A day before that with `settled` above `completed` and no `execution_failed` is that counter, not a lost delivery.


## The npm client is live and named in our own pages (1.115.0, 10 Nov 2026)

- npm package `agent-data-tools` 1.1.0 was published by the owner on 10 Nov 2026 (account spellzzz11; npm requires two-factor authentication to publish). `mcpInstallLinks().npx` is the command the homepage shows; llms.txt and the README carry it too. Check from a clean folder after a publish: `npx -y agent-data-tools@<version> setup cursor --print` and an `initialize` line piped into `npx -y agent-data-tools@<version> mcp`.
- npm removes a `bin` path written as `./cli.mjs` at publish (the command would be missing); `npm pkg fix` writes the accepted form. Always read the first lines of `npm publish --dry-run` for a `warn`.
- Not done yet: a `packages` entry (registryType npm, stdio, argument `mcp`) in server.json for the MCP Registry. It needs a published npm version that carries `mcpName` (1.1.1, prepared in business\agentic\npm-client; the owner publishes), because the registry checks the package before it accepts the entry. Add it only after `npm view agent-data-tools@1.1.1 mcpName` answers.


## Free calls over HTTP cut to 3; PDF reading out of the HTTP trial and at $0.002 (1.116.0, 10 Nov 2026)

- Owner's decisions, 10 Nov 2026. Why: in 15 days 14,352 free HTTP calls (11,047 on /pdf/text from browser-type callers arriving from many addresses) and 24,304 `free_exhausted` answers led to 77 /credits views and no purchase; the wallets that pay never use free calls.
- `FREE_HTTP_CALLS_PER_CALLER` 3 (HTTP `trial=1`), `FREE_CALLS_PER_CALLER` 25 (MCP: directories test without paying), one shared counter per caller (`takeFreeCall(..., limit)`). `HTTP_FREE_EXCLUDED` (/pdf/text, /pdf/extract) and `httpFree(path)` in src/lib/capacity.ts decide every "Run it free" button, trial hint and guide line; use `httpFree`, not `!CAPACITY_LIMITED.has`, for anything about the HTTP trial. A caller cannot be singled out (only a hash of the address is known), so a tool leaves the trial, not a person.
- /pdf/text is $0.002. After the release: `node scripts/update-402index-prices.mjs --dry` then for real; the Bazaar shows $0.005 until the tool's next settlement.
- Judge it on 17 Nov with the same three public reports (/metrics for /pdf/text paid and challenged, /metrics/callers browser family, the /revenue funnel `credits_bought` and /credits page views): paid PDF calls or credit purchases mean it worked; if the calls simply stop, nothing was lost.



## arXiv search, commodity prices, round 8 doors; the stock quote's day change (1.117.0, 10 Nov 2026)

- **`/stock/quote` bug, fixed.** `stockQuote()` (src/routes/stocks.ts) read `chartPreviousClose` from a 5-day chart: that is the close before the whole window, so `previousClose`, `change` and `changePercent` were a five-session move sold as the day's (AAPL 10 Nov: +5.0% shown, -0.62% true). The previous close is now the daily bar before the latest one; with a single bar Yahoo's value is the true previous close. Found by reading the live numbers of the new commodity tool, not by a test: when a tool returns a change, a rank or a total, compare one live answer with an independent source before shipping.
- **`/arxiv/search`** (src/routes/arxiv.ts): arXiv's public Atom API, read with small regular expressions (`parseArxiv`). `arxivId()` reads a bare ID, a version, an old-style ID or an arxiv.org link; anything with a space is a search. `arxivQuery()` joins words with AND, keeps a quoted phrase, and drops single letters and arXiv's own operator words so a caller cannot write query syntax. arXiv asks for at most one request every three seconds and for the acknowledgement in `attribution`; answers are cached 15 minutes at the edge. A busy arXiv is an uncharged 503 `ARXIV_BUSY`.
- **`/commodity/price`** (stocks.ts): `COMMODITIES` maps 17 names to Yahoo front-month futures tickers with the contract's quoting unit; `commodityKey()` reads names, XAU/XAG, tickers and spacing, with `Object.hasOwn`. Same source, terms and risk as the stock tools. Grains and softs are quoted in US cents: the `unit` field says so.
- **Round 8 doors** (src/routes/entry-paths.ts, before round 7 in the list): `/page/markdown` (`markdownInput`: Markdown unless the caller names a format; its example is a real answer for an IANA page, since its example URL is the first payment a listing gets), `/cve/lookup`, `/wiki/summary`, `/market/trending`, `/market/ohlcv`. `/extract` may have three doors, every other tool two (tests/entry-paths.test.cjs). A door of a tool with no input belongs in the no-input list of tests/fields.test.cjs.
- **Where demand numbers come from now:** `business/agentic/base-bots/zero-intents-all.mjs` lists Zero's intents by searching agents (image generation 98, web search 77, web scraping 72, text to speech 62, video 55, weather 52, crypto price 46, send email 44); `bazaar-top.mjs payers30|calls30` the Bazaar's top listings. Note when reading them: a listing's payers can be its own client's users (BlockRun's prediction-market listings) or explorers buying by rank (a Korean price list with 48 payers and 57 calls), which is not demand for the topic.
- Not built, with the reason: Kalshi markets (the public API has no search or volume order; the payer evidence is one seller's own client), a DEX pool search (GeckoTerminal answers Cloudflare's egress with 429), an economic calendar (no free source checked yet), job search over our own job index (needs a secret and the owner's word on the index's read budget), GitHub user lookups and FRED series (owner's decisions: personal data, an API key).
- After the release: the owner's Refresh click lists the seven new paths (about $0.05); register with Zero only now that the names are final.


## A prepaid key can pay less than the public price (1.118.0, 10 Nov 2026)

- Corrects 1.116.0: /pdf/text was $0.002 for everyone for about an hour; the owner meant the low price only for the heavy free user ("I meant only that low price for our regular buyer to entice it into buying"). Public price $0.005 again.
- `KEY_PRICES` / `keyPrice(path, price)` in src/lib/credits.ts: what a prepaid key is charged where that is below the tool's price (today only /pdf/text and its entry path, $0.002). Applied at the two places a key is charged (`chargeCredits` in src/index.ts, `creditCharger` in src/mcp.ts). `keyPriceLine` puts the offer in the 402 body (`withKey`) and `keyOffer` on the browser 402 page. tests/credit-jobs.test.cjs: a key price must be below the public price and the tool must exist; `CARD_JOBS` counts with the key price.
- Why by payment method: a person cannot be told apart, but wallets and routers pay per call (they do not choose on price), while a web user buys a key. Adding a tool to `KEY_PRICES` is a price decision: the owner's.
- After the release: `scripts/update-402index-prices.mjs` (the $0.002 of 1.116.0 may have been copied there). Check on 17 Nov with /metrics for /pdf/text (`credits` outcomes) and the funnel's `credits_bought`.
- Release numbers are shared by several sessions: before writing notes-<v>.md, claude-<v>.md or queue-<v>.ps1 in release\train, check that no file for that version exists (two sessions overwrote each other's 1.118.0 and 1.119.0 files on 10 Nov).



## GitHub account lookup, repository data only (1.119.0, 11 Nov 2026)

- Owner, 11 Nov 2026, to "Build a GitHub account lookup that returns repository data only?": "Yes, repo data only". `/github/user` (`accountRepos` in src/routes/github.ts) answers "what has this account built" from `/users/<login>/repos` (the 100 most recently pushed, owner type only) and reads exactly two fields of the account record, `type` and `public_repos`. Never add name, bio, e-mail, company, location, avatar, blog, social links, follower counts or account dates: GitHub's terms restrict selling users' personal information, and tests/github.test.cjs fails if any of those values appears.
- Forks are left out unless `forks=true`. Counts and languages cover the repositories read, and the answer says so in `note`; an account with more than 100 repositories can hold an older, more starred one outside that window.
- Acquisition-priced with the other GitHub tools; category through `CATEGORY_OF_PATH`. Needs `GITHUB_TOKEN` like the others.
- Two sessions wrote release files under the same version number twice on 10 Nov and overwrote each other. Before writing any notes-, claude- or queue- file in business\agentic\release\train, list the folder for that version number.


## The npm package in the MCP Registry (1.120.0, 10 Nov 2026)

- server.json `packages[0]`: registryType npm, identifier `agent-data-tools`, version 1.1.1, transport stdio, packageArguments `mcp`, optional secret env `AGENT_DATA_TOOLS_KEY` (schema 2025-12-11 read from static.modelcontextprotocol.io). The registry verifies that the npm version's package.json has `mcpName` equal to the server name. After the tag, read the "Publish to MCP Registry" workflow run: a refused publish is only a warning there. Check `https://registry.modelcontextprotocol.io/v0/servers?search=agent-data-tools` for `packages`.
- When the npm client gets a new version: publish to npm first (owner), then change `packages[0].version`. Keep top-level `version` above `packages` in the file (bump-version.mjs replaces the first "version").
- The task guides (`toolBlock` in src/guides/task-guides.ts) and the tool page print the prepaid price for any tool in `KEY_PRICES`, so a new key price shows there without further copy.


## The 402 body is x402 v2 (1.121.0, 10 Nov 2026)

- `readable402` (src/lib/readable-402.ts) now writes the decoded v2 challenge into the body of every tool's unpaid 402 (version 2, accepts, resource, extensions incl. Bazaar), with `hint`, `related` and `prepay`. This replaces the 19 Oct design (a v1 PaymentRequired in the body beside the v2 header). `wantsV1Body()` decides the exception: `x402=1` in the query (a control parameter, so it never counts as tool input) or the setting `QUOTE_BODY=v1`. The v1 payment path itself (src/lib/x402-v1.ts: X-PAYMENT, verify, settle after success, X-PAYMENT-RESPONSE) is unchanged, and its own refusals still answer with v1 bodies.
- Why: vAPI Call (self-listing live since 10 Nov, account = the owner's Phantom wallet, listing "Agent Data Tools", 20 endpoints, "Verification requested") graded every endpoint with `offer_version_mismatch` and read no input description from the challenge. Its wizard takes endpoint URLs one at a time (our 1.6 MB /openapi.json was read as a plain 200 page, and the origin gave only 20 operations), so the challenge is its only source for inputs.
- After this is live: in the owner's Chrome session run the wizard's "Check endpoint" on one tool (Discover step only) and confirm the two findings are gone. A listing stores what its probe saw when it was published; if My APIs still shows "Request schema: Not declared", the listing has to be revised or re-added there (her wallet session and `C:\MoneyWallet\Sign vAPI payout message.cmd`).
- If a buyer turns out to need the v1 body (watch `/metrics/callers` `v1_payment` and the daily payer list for a wallet that stops), set `QUOTE_BODY=v1` and redeploy; do not revert the code.
- The payout signer's check: vAPI's nonce is 106 characters; the confirmation accepts yes in any case.



## Truth audit of existing tools (1.122.0, 11 Nov 2026)

- Method that found seven real faults in one evening (the stock quote's five-day "day change" in 1.117.0, then these six): run a tool's published example (`SMOKE_SHOW=1500 node scripts/smoke-examples.mjs /path`) and compare the answer with an independent source, the real site or the arithmetic, by hand. Shape and fuzz sweeps cannot see a plausible wrong number. Captures: `business/agentic/base-bots/data/truth-audit-2026-11-10*.txt`. Checked and right: prices, FX, funding APR, loan and compound interest, Black-Scholes, holidays, ISO weeks, ages, zodiac, distances, statistics, cron, IBAN, security headers, redirects, DNS propagation, e-mail authentication.
- `/moon` (src/routes/public-data.ts): `lunarPhaseTime(k)` is Meeus's chapter 49 (k whole = new moon, k + 0.5 = full), UTC = dynamical time minus about 69 s; `moonPhase()` finds the lunation the moment is in and measures the phase between the true events. tests/moon.test.cjs holds nine published new and full moons.
- World Bank snapshot: `scripts/fetch-world-bank.mjs` throws when an indicator's median country has under five years (the 22 Oct fetch got one year of `SL.UEM.TOTL.ZS` per country and nobody noticed for three weeks); tests/world-bank-depth.test.cjs checks every indicator. Rerun the script monthly as before.
- `/pack/gas-tracker`: `nativeUsd` prices ETH and POL; POL comes from `/price/token` on Ethereum, best effort.
- `rdapLookup` (src/routes/domain.ts) asks Verisign or PIR directly (`DIRECT_RDAP`) when rdap.org answers anything but 200 or 404; `/agent-readiness` reads the first `Sitemap:` line of robots.txt when the usual paths have none; `/package-audit` passes `includeWeeklyDownloads: true` (the 50-subrequest limit it avoided was the free plan's).
- Still to audit the same way: the AI, search and browser tools (paid staging calls), the per-network chain reads against an explorer, `/sun` at high latitudes, the packs' derived scores, `/seo/audit`'s internal-link count on sites that span subdomains (www.wikipedia.org reads 0 internal, 380 external).



## CVE and time doors at the acquisition price (1.123.0, 11 Nov 2026)

- Owner, 11 Nov 2026: "Cut them" to the question "Cut the three new $0.01 time and CVE listings to $0.002 like their leaders?". `/cve`, `/cve/lookup`, `/timezone/convert` and `/time/now` are in `ACQUISITION_PATHS`; `/time` stays $0.01 because only its doors were put to her, so tests/entry-paths.test.cjs names those two doors as the one place a door's price differs from its tool's. Review with the other acquisition prices on 20 Nov. After the release: `update-402index-prices.mjs`, and the Bazaar shows the new price only after each listing's next settlement.



## Delegated wallets, SEO link counts and the second accuracy audit (1.124.0, 11 Nov 2026, no new tools)

- `codeKind(code)` (src/routes/chain-reads.ts, exported) is the one place that turns the code at an address into "contract or wallet": no code is a wallet, exactly 0xef0100 plus 20 bytes is a wallet with an EIP-7702 delegation (`isContract: false`, `delegatedTo`), anything else is a contract, and an EIP-1167 clone names its implementation. Use it for any new contract-or-wallet answer; `code !== "0x"` alone is wrong since Pectra (found on the example wallet of `/pack/wallet-profile`, which read `isContract: true`). The risk tools (wallet.ts, wallet-audit.ts, counterparty.ts, x402-check.ts) had their own `eoa-delegated` type already. Tests: tests/code-kind.test.cjs.
- `/seo/audit` counts a link as internal when its host, without a leading "www.", equals the page's or is a subdomain of it (`seoAudit` in src/routes/web-checks.ts). No public-suffix list: a page on a subdomain does not count its sibling subdomains.
- `/gov/federal-register` takes `sort` (newest, the default, or relevance).
- **Coinbase curation, as its page states it on 11 Nov 2026** (docs.cdp.coinbase.com/x402/seller/get-discovered): live mainnet payments; availability of at least 99% over 30 days as the platform measures it, and "above 99.5% receive priority placement"; passing the health probe (consecutive failures down-rank, then drop from the featured tier; restored automatically); agent-ready metadata (complete input schema, a description saying when to use it, per-call pricing, networks, documented error responses); passing validation. Listing is "editorial, based on service quality, category coverage, and ecosystem fit". The page names NO request form, address or channel: meeting the requirements "qualifies an endpoint for review". Ranking: 30-day buyer reach, volume and recency, recomputed every six hours; shared tunnelling domains are weighted below dedicated ones and "results are capped per domain"; descriptions over 500 characters or placeholder text score zero.
- `TOOL_ERROR_REFS` and `TOOL_ERROR_COMPONENTS` (src/discovery.ts) document 400, 404, 422, 502 and 503 once and reference them from every tool's OpenAPI operation; the body is what `app.onError` in src/index.ts writes. A new status a tool can answer belongs there. tests/discovery-conformance.test.cjs resolves every reference and keeps the document under 2 MB (1.8 MB now; our own `/openapi/summary` reads at most 2 MB).
- Second audit pass, 11 Nov: about 150 tools' published examples read against independent sources (capture in `business/agentic/base-bots/data/truth-audit-2026-11-11.txt`). One wrong answer (above), one empty example (zkSync `EX_BUSY`), one misleading count (SEO links), two unrounded floats. Still not audited this way: AI, search and browser tools (they need paid staging calls), and the chain reads of the smaller networks beyond their token tools.



## Gemini CLI extension manifest (1.125.0, 11 Nov 2026)

- `gemini-extension.json` must stay at the absolute root of the repository: Gemini CLI's gallery (geminicli.com) lists a public repository that has it there and carries the GitHub topic `gemini-cli-extension` (added after this release; no submission, daily crawl). It names the MCP server with `httpUrl` (streamable HTTP; a plain `url` is read as SSE). Keep it to name, version, description and mcpServers: an install clones the whole repository, and anything else in the manifest (commands, context files, settings) would run or load on the user's machine. tests/gemini-extension.test.cjs checks both. Bump its `version` only when the server URL or description changes.
- Measured the same day (`C:\MoneyWallet\business\research-2026-11-11\framework-integrations.md`): a listing alone brings few installs (two pay-per-call tools that entered the Vercel AI SDK and LangChain tool tables in late October show about 40 downloads a week), and the large catalogues sort by stars or downloads. Dead queues, do not open pull requests there: Coinbase AgentKit, GOAT, Virtuals GAME, awesome-x402, Cline and Kilo marketplaces, the Docker MCP catalogue (ours, #6899, is unreviewed).


## One credit with a key for the tools that only compute (1.126.0, 11 Nov 2026)

- Owner, 11 Nov 2026: "Yes, all three" to three decisions put to her that day, one of them "A key price of 1 credit ($0.001) for pure lookups and converters". `src/lib/key-prices.ts` is now where every caller reads a key price: `keyPrice` (what a key is charged; src/index.ts `chargeCredits`, src/mcp.ts `creditCharger`), `keyPriceFor` (undefined when a key pays the public price), `keyOfferNumbers` and `keyPriceLine` (the copy on the 402 body, the browser 402 page, tool pages, task guides). The rule: a tool named in `KEY_PRICES` (lib/credits.ts) pays that; otherwise a tool in `LOCAL_PATHS` (families.ts) pays `LOCAL_KEY_PRICE`; an entry path pays what its tool pays; a key price that is not below the public price is no offer.
- lib/credits.ts must not import the catalog (families.ts reaches it through lib/env.ts and metrics.ts), which is why this is its own module. Nothing the catalog imports may import key-prices.ts either.
- A new tool that only computes gets the one-credit key price by joining `LOCAL_PATHS`; that set also decides MCP's closed-world annotation and the known-answer tests, so add a tool there only if it truly has no outside source and no model. A key price for any other tool is a price decision: the owner's, in `KEY_PRICES`.
- Public prices, listings, the price-freeze fixture and x402/MPP quotes are unchanged. Judge it with the 17 Nov read already planned for the PDF key price: `/metrics` `credits` outcomes per tool and the funnel's `credits_bought`.
- The same answer added /news and /pack/news-sentiment at $0.03 to the 19 Nov price test and moved /audit/website's test price to $0.10 (list: `C:\MoneyWallet\business\tool-selling-your-steps-2026-11-10.md`). Nothing of that is in this release.

## Monthly plan, built and switched off (1.126.0, 11 Nov 2026)

- Owner, 11 Nov 2026, answering three questions: "$9 a month for 15,000 credits and $19 a month for 40,000 credits, with unused credits kept"; no new free allowance (a key needs no account, so a free allowance per key could be farmed like the free calls she cut on 10 Nov); and she creates the Stripe objects herself from written values ("You prepare, I click"). Her steps: `C:\MoneyWallet\business\tool-selling-your-steps-2026-11-10.md`, section "Monthly plan".
- `CREDIT_PLANS` (price, credits, payment link) and `PLAN_PORTAL_URL` (Stripe's customer portal login link) in src/lib/credits.ts. `WEB_PLANS` is empty until the portal link and at least one plan link are filled in, and every plan surface (creditsInfo `monthlyPlans`, the /credits section, the terms bullet, `monthlyPlans` on /credits/balance) is built from it. To switch the plan on: paste the three links, run tests/credit-plans.test.cjs (it checks their shape), release. Prices and credits of a plan are the owner's.
- How it works: a payment link in subscription mode with metadata `adt_credits` equal to the plan's credits and the usual success URL. `verifyCheckout` returns `plan: { subscriptionId, invoiceId }` for it; `issueCredits` grants the first month under the checkout session id, records the subscription on the account (`plans`, a list: a second checkout into the same key is kept beside the first) and writes `credit:invoice:<first invoice>` so the first renewal read does not grant it again. `grantPlanInvoices` adds the plan's credits once per paid invoice (`credit:invoice:<id>`, plus a session record so a renewal counts as a top-up in `creditSummary`). `rotateKey` moves the plans with the account.
- There is no webhook (nothing in Stripe has to be configured to call us). `syncPlans` in src/lib/credit-routes.ts reads `GET /v1/invoices?subscription=…&status=paid` with STRIPE_READ_KEY: when a call finds the key short (then one retry of the spend; at most one read per `PLAN_RETRY_MS`), when the last read is older than `PLAN_SYNC_MS` (12 h) on a served call, and on /credits/balance. A failed read grants nothing, is stamped so it is not repeated on every call, and never fails the call. So a renewal reaches the key within twelve hours of use, or at once when the key runs short. If the restricted key lacks Invoices read access the log says so and renewals are not granted: check that first when a subscriber reports missing credits.
- Limits to keep in mind: a renewal grants the credits of the plan the key was bought with, so the customer portal must not allow switching plans; an invoice refunded or disputed later is not taken back (as with packs); a zero invoice grants nothing; MCP's ChatGPT server and the x402/MPP paths never see any of this.
- Not built: a webhook, proration, a yearly plan, plans over MPP or USDC.


## "Nothing found" is 422, the rewrite tool, and what routers count against us (1.127.0, 11 Nov 2026, no new tools)

- **A tool never answers 404 over HTTP.** `toolErrorAnswer()` (src/lib/tool-errors.ts, used by `app.onError`) turns a tool's `HttpError(404)` into 422 with `code: "NOT_FOUND"` (the tool's own code if it has one). Keep throwing `HttpError(404, …)` inside tools: packs, MCP and `withEnsResolved` read that status. Unknown paths, `/tools/<slug>`, credit packs and MCP bundles keep their 404. Do not write "404" in a tool's description (tests/tool-errors.test.cjs fails); say 422.
- **Why, in Mercator's words** (mercator.sh/docs, 11 Nov 2026): "Non-402 errors, including 404, downrank services; caller-input 400 and 422 do not unless the endpoint has stopped succeeding, and other input-dependent 4xx cannot alone quarantine them." Thirty-day provider failures apply multipliers of 0.75 (degraded) or 0.5 (severely degraded); quarantine needs at least 50% failures and reopens after 24 hours. A valid unsigned 402 is a successful probe. So for Mercator a 5xx of ours (502 source failed, 503 busy) does count: prefer a 422 with a clear message over a 502 when the caller's input, not the source, is the reason.
- **`/ai/rewrite`** runs on `CHAT_MODEL` with `rewritePrompt(style)`; the text travels between `<text>` tags (tags in the caller's text and in the answer are dropped). The other 8B tools (summarize, classify, keywords, outline, extract-json) still use `DATA_RULE` and passed the staging audit; if one of them is found answering or refusing its input instead of processing it, give it the same tagged form. Probe a prompt before shipping it: a copy of `release\train\ai-model-probe.mjs` with the system and user text, four or five inputs including an injected instruction and a bare request.
- **Published examples for the chat tools must be questions the model answers correctly from general knowledge.** It does not know x402. Read the real answer on staging (`x402-w11\truth-audit.local.mjs <paths>` prints each paid answer; `delivery-check` only compares shapes).
- **Other routers, read 11 Nov:** the paid "x402 Service Finder" (finder.kagurazaka.dev) scores 0.3 relevance + 0.3 distinct payers + 0.25 uptime (its own monitor, every six hours) + 0.15 price, drops any seller that does not answer 402 when it calls, and its buyer 0x4c29 pays each pick ten to twenty times (989 payments to 100 sellers in three days, $7.15). OpenRouter lists model inference only (text, image, speech, transcription, embeddings, rerank), pays providers by invoice or top-up and routes on uptime and speed; it has no place for data tools.


## Company financial statements (1.128.0, 11 Nov 2026; 686 tools)
- `/sec/financials` ($0.02, owner's price: "Yes, at $0.02"; src/routes/sec-financials.ts) and its doors `/stock/fundamentals` and `/income-statement` (src/routes/entry-paths.ts, same price): income statement, balance sheet, cash flow and ratios for the newest 1-10 fiscal years or quarters, from SEC's XBRL company-facts file (one 4-8 MB request per call, kept six hours at the edge, parsed in about 40-150 ms). Why: financialdatasets.ai sold statements to 26 Bazaar payers at $0.02-0.035 a call on 11 Nov; we sold none (`C:\MoneyWallet\business\tool-selling-new-angles-2026-11-11.md`).
- How the file is read (`financials()`, exported and tested on a trimmed copy of Apple's file, tests/fixtures/sec-companyfacts-aapl.json): fiscal years from the annual periods of revenue, net income or operating cash flow, named by the year they end in (an end in the first week of January counts to the year before); each line tries its XBRL concepts in order per period (`INCOME`, `BALANCE`, `CASH_FLOW`); a later filing for the same period wins (restatements). A quarter is the reported three-month value, otherwise year-to-date minus the year-to-date before it (10-Qs report cash flow only year to date; 10-Ks have no fourth quarter); per-share figures and share counts are never differenced and stay null there. `HELPERS` + `derive()` fill total liabilities (liabilities and equity minus equity incl. noncontrolling interest) and SG&A (selling plus G&A) when a company did not tag them; `concepts` says which tag each line came from, or how it was derived.
- Checked live on 11 Nov against 37 companies (tech, retail with January years, banks, insurers, REITs, Berkshire, Alibaba, Taiwan Semiconductor): Apple FY2023-FY2025 revenue equals its reported figures, liabilities plus equity equals assets within the noncontrolling interest. IFRS filers (most 20-F companies, e.g. TSM) are refused as not found (HttpError 404 in the tool, 422 NOT_FOUND over HTTP since 1.127.0) naming IFRS; annual-only filers likewise for period=quarterly. Banks and insurers have no gross profit or current assets in their filings: those lines are null, not zero. ExxonMobil's ticker now maps to "ExxonMobil Holdings Corporation", whose file had no annual statements on 11 Nov (not found).
- In `ONE_OF_INPUT_PATHS` (ticker or cik), category through `CATEGORY_OF_PATH`, finder `JOBS` (income statement, balance sheet, fundamentals, company facts…), `period` aliases frequency/timeframe. After the release: the owner's Refresh click lists the three paths on the Bazaar, then a registration pass (402 Index, Zero, Agent402) now that the names are final.



## The monthly plan is on sale (1.129.0, 11 Nov 2026)

- Owner, 11 Nov 2026, on the Stripe setup: "you do it all or prefix so I can just do a click". Created that day in her Stripe account (acct ending m8Sc): payment links plink_1UaY2EDhGrPcm8Sc0Ng5cNSZ ($9, 15,000 credits) and plink_1UaY2NDhGrPcm8ScJrv9YvFo ($19, 40,000 credits), and the default customer portal link. The dashboard's create form has no metadata field: `adt_credits` was set afterwards through the API (the same was done by hand for the $1 link in October). Stripe's amount field uses a decimal comma in her locale ("9.00" becomes 900).
- OPEN, hers: Read on Invoices for the restricted key behind STRIPE_READ_KEY (two keys are named "agent-data-tools claims"; which one the Worker holds could not be told from the dashboard, so both). Check it before telling anyone renewals work: a subscriber's second month is the first real test.
- To take the plan off sale: empty `PLAN_PORTAL_URL` (every plan surface disappears; existing subscribers keep being topped up), and deactivate the two payment links in Stripe. To change a price or the credits: a new Stripe price and link plus the `CREDIT_PLANS` row, and it is the owner's decision; existing subscribers keep the credits recorded on their key.
- Judge it by `/revenue` card credits (with REVENUE_TOKEN): purchases, top-ups (a renewal counts as one), and by /credits page views. No subscriber is expected without visitors: Search Console showed 1 click in 28 days on 11 Nov.

## The compact MCP server: three tools for the whole catalog (1.129.0, 11 Nov 2026)

- Owner, 11 Nov 2026: "Yes, build it". `/mcp/compact` (also `/mcp/k/<key>/compact`) lists three tools, `find_tool`, `tool_details` and `call_tool` (`registerCompactTools` in src/mcp.ts; the names and the reach filter are in src/mcp-contract.ts). Why: `/mcp` lists 452 tools, 568,570 bytes of definitions (measured 11 Nov), and `/mcp/chain` 366; an assistant that connects carries all of it before its first call. The compact list is under 6 KB. No assistant user had bought a key by 11 Nov.
- `call_tool` runs the same per-tool call the ordinary servers register (`trackedFor`), after checking the arguments against the tool's own input shape (`shapeOf`). So free calls, a key's credits, x402 payment requests, refunds, the funnel and `/metrics` are unchanged, and a call is counted and priced as the tool it runs. A wrong name or a bad argument is refused before anything is charged and does not use a free call.
- `find_tool` is the free finder (`recommend()` without the reranker, so no model cost); its picks carry `price`, `priceWithKey` where a key pays less, `inFreeCalls`, `requiredInputs` and `exampleArguments`.
- What it cannot reach (`compactReach` in src/mcp-contract.ts): the four tools that write (that is what lets `call_tool` be annotated read-only).
- **Tools above $0.10 a call** (`COMPACT_PRICE_CEILING`; none on 11 Nov, the first will be the $1 /audit/contract and the price ladder's $0.25 step). Owner, 11 Nov 2026, asked whether to keep a hard ceiling or let dearer tools run when the price is named: "do what is best for the whole operation in general". Decided by the session: on `/mcp/compact` such a tool is found and described like any other (`needsMaxPrice` in find_tool and tool_details) and `call_tool` runs it only when the call passes `max_price` at or above what this caller pays (`compactPricePermits`; a key's lower price counts); otherwise the call is refused, uncharged, and the refusal carries the price and the call to repeat. Why not a hard ceiling: the default assistant address would hide the dearest tools, which are the ones being built to sell. Why not no check at all: a model picks the tool by name, and one call must not empty a $1 key by accident.
- **`/mcp/compact-capped`** (`COMPACT_CAPPED_BUNDLE`): the same three tools with no `max_price` and no tool above the ceiling. It exists for hosts that count spend from a cost declared per tool name: Hermes books the top of a declared range for every call, so its package must connect an address where no call can cost more. Do not advertise it elsewhere. tests/hermes-plugin.test.cjs holds the package's declared top cost equal to the ceiling.
- The signed-in route `/mcp/account/compact` exists through the ordinary `/mcp/account/:bundle` route (with the signed-in server's tool filter) but is not advertised and has no test of its own; the Claude and ChatGPT directory listings keep their reviewed tool lists.
- Tests: tests/mcp-compact.test.cjs (Miniflare and the real MCP SDK client: the list, the finder, a free call, refusals that cost nothing, a payment request without the tool running, a key spending one credit, `/mcp` unchanged, the price rule on its own, and the capped twin's list). No catalog tool is above the ceiling yet, so the refusal itself is tested through `compactPricePermits`, not through a live tool: when the first dear tool lands, add one call without and one with `max_price` to that test.
- Judge it by `/metrics/callers` `mcpConnections` and by `/metrics` rows of tools called through it (they are counted under the tool's own path, so there is no separate "compact" row: compare key purchases and `credits` outcomes before and after).

## Hermes Agent plugin package (1.129.0, 11 Nov 2026)

- `integrations/hermes/` is a portable Agent Plugins v1 package (plugin.json, mcp.json, skills/, README.md, config.yaml) that Hermes Agent's plugin catalog pins by commit (NousResearch/hermes-agent, `plugin-catalog/agent-data-tools.yaml`, one file per plugin, human-reviewed; rules at hermes-agent.nousresearch.com/docs/developer-guide/plugins/catalog-submission). Owner's approval: listing pull requests from our GitHub account (10 Nov 2026) and "Yes, start" (11 Nov 2026).
- It connects the capped compact address, `/mcp/compact-capped` (never `/mcp/compact`: there a call that names `max_price` can cost more than the package declares). plugin.json and mcp.json are GENERATED: `src/lib/hermes-plugin.ts` + `node scripts/build-hermes-plugin.mjs`; tests/hermes-plugin.test.cjs fails when they are stale or when the skill or README says something the service does not do.
- Declared costs: `find_tool` 0, `tool_details` 0, `call_tool` 1 to 100 credits, limit 1,000 credits a chat. Hermes books the TOP of a range for every call (tools/mcp_tool_costs.py, read 11 Nov 2026), so it asks after ten `call_tool` calls whatever they cost; the README says so. Both ends of the range are constants (`LOCAL_KEY_PRICE`, `COMPACT_PRICE_CEILING`), not today's prices, so an ordinary price change does not make the package stale or break that test. Changing either constant does: rerun the script, bump `HERMES_PLUGIN_VERSION`, and after the release open a pin-bump pull request on the catalog entry (their rule 4: every new sha is a new reviewed PR).
- mcp.json has NO Authorization header: Hermes refuses to start a remote server whose header holds an unset `${VAR}` (tools/mcp_tool_config.py `_require_rendered_remote`), which would make a key mandatory before the first free call. A key holder adds a same-name `mcp_servers` entry to their own config.yaml (the package's `config.yaml` shows it), and Hermes keeps the package's declared costs. Catalog floor `requires_hermes: ">=0.22.3"` because older releases reject unknown server keys.
- The catalog's rule 13 wants network calls, spending, credentials and stored data disclosed in the README and in the PR: the README's Disclosure section mirrors /privacy. Change both together.
- The catalog entry and the pull-request text are drafted in `C:\MoneyWallet\business\agentic\hermes-catalog\`.


## /news and the two research packs at $0.03 (1.130.0, 11 Nov 2026)

- Owner, 11 Nov 2026: "Yes, start now" to "Start $0.03 on the three Mercator-bought tools now instead of 19 Nov?". `MERCATOR_TEST_PRICE` (src/routes/search.ts) prices `/news`, `/pack/news-sentiment` and `/pack/web-research`; the doors `/news/search` and `/crypto/news` follow `/news`. The other five tools of the 19 Nov list (`C:\MoneyWallet\business\tool-selling-your-steps-2026-11-10.md`) are unchanged and still wait for that date.
- Evidence it rests on (7-11 Nov): Mercator's gateway 0x72c5…159b made 47 payments to us in five days, almost all on these three at $0.01, which was 42% of outside income. Its search held them at ranks 5, 6 and 12 with its own 30-day counts 24, 22 and 18 (`business/agentic/base-bots/mercator-ranks.mjs --show`), so it does not pick them by rank. Its score is 0.95 x relevance + 0.05 x 1/(1 + price/$0.01): $0.03 costs 0.0125 of score, and only after its next import (its copy of us was still the 6 Nov one).
- NOT known when this shipped: whether Mercator's client pays a quote above the price its copy holds. Only a lower quote had been seen (/weather at $0.002 against a stored $0.01).
- **How to judge, daily:** `node business/agentic/base-bots/payments-to-us.mjs --days 2` (payments by 0x72c5 at $0.03) and `/metrics` `paid` per tool. **Revert rule:** a tool Mercator has not called for two full days after the release goes back to `"$0.01"` (the tool's closing line; run `scripts/freeze-prices.mjs` with the reason, then `update-402index-prices.mjs`). If all three stop, revert all three in one release and write the result into the 19 Nov list, because it answers the question for /audit/website and the other router-bought tools too.
- The Bazaar shows $0.03 for a listing after its next settlement; Mercator's own next purchase does that. The two doors keep showing $0.01 there until someone pays them (the owner's optional click, `C:\MoneyWallet\Refresh Bazaar listings 1.130.0.cmd`).
- After the release: `update-402index-prices.mjs` from a checkout at current main.- **Price ladder approved (owner, 11 Nov 2026: "Yes, the ladder" to "Approve the price ladder $0.03 -> $0.10 -> $0.25 on the three Mercator-bought tools?").** It covers `/news`, `/pack/news-sentiment` and `/pack/web-research` (their doors follow) and nothing else. A step is one release that changes `MERCATOR_TEST_PRICE` (or, if the three diverge, each tool's closing price) and reruns `scripts/freeze-prices.mjs` with the step named. Conditions for each step: the previous price has been live two full days, and Mercator's gateway (0x72c5…159b) paid that tool at the previous price on both days (`payments-to-us.mjs --days 2`, `/metrics` `paid`). A tool it stopped calling does not step up; it goes back to $0.01 by the revert rule. Do not skip a step and do not go above $0.25 without her. Evidence for the top of the ladder: Mercator paid HubVibe $0.25 x 6 and $0.10 x 9 in two days (9-11 Nov) for Brave web search, a seller it ranks 3-4 at relevance 0.25-0.29, with its own 30-day counts 78 and 70. Earliest dates if 1.130.0 goes live on 11 Nov: $0.10 on 13 Nov, $0.25 on 15 Nov.


## Smart contract audit at $1.00 a call (1.131.0, 11 Nov 2026)

- Owner, 11 Nov 2026: "Come up with a tool we can sell for 1$ a call and above and get customers for it". The price is $1.00, the bottom of the range she named and the price the one comparable seller charges; any other price is her decision.
- Why this tool (base-bots, 9-11 Nov sample; scripts in the session scratchpad were `dollar-band.mjs` and `dollar-listings.mjs`): money at $1 or more a call on Base is almost all credit purchases (dTelecom, Apify, CheapTokens), goods (domains, phone numbers, gift cards) and one closed five-wallet cluster. The one per-call job that wallets paying many sellers buy at $1 is `leftclaw.services/api/audit` ("Smart Contract Audit", $1.00): 153 calls and 9 payers in 30 days, in two days $11 from one wallet of its own, $3 from the finder buyer 0x4c29 and $1 from SettledScout 0xa1d1. It answers with a job id and a report about an hour later. Mercator had routed no audit call (sampleSize 0 for every audit listing). So the proven demand is small: do not promise more than a few dollars a week from the listing alone.
- `/audit/contract` and its door `/contract/audit` (src/routes/contract-audit.ts): source from Sourcify (`sourcify()` in chain-more.ts, now exported) or the caller; `staticChecks` (about twenty patterns; Solidity only); `chainFacts` (owner, EIP-1967 admin and implementation, Safe or timelock or single key); three reviewers in `REVIEWERS` (two gpt-oss-120b with different briefs, one Llama 3.3 70B only when the whole project fits its context); `readReview` keeps a finding only if the function it names exists; `mergeDrafts`; `secondLook` re-asks about findings only one reviewer reported, with the function, its modifiers and the functions it calls; `finalSummary` is written from the surviving findings. Cost a call: about $0.01-0.04 of Workers AI. Each reviewer call takes one unit of `AI_DAILY_CAP`.
- Three rules that came from real contracts, keep them: a role using its own power (mint, pause, block) is `centralization` and at most medium, and the static check's severity wins there because it reads caps; a setup function behind a one-time guard is low and titled "At deployment only"; a serious claim that names no function gets low confidence and cannot set the verdict alone.
- Timing is the model's, not ours: the same 100,000-character input took 27 s and 99 s on the same day. A reviewer is cut off at 85 s, and once one usable review is in the others get `REVIEW_GRACE_MS` (20 s). A source under `SHORT_SOURCE` (12,000 characters) is reviewed at low reasoning effort (5-20 s). The quote's `maxTimeoutSeconds` is 300.
- Long POST fields (src/lib/long-input.ts, `LONG_INPUT_FIELDS`): for the listed paths a string field of 1,500 characters or more is held in the isolate and the forwarded URL carries `@sha256:<hex>`. Add a path there before giving any other tool a whole-document input; do not raise the limit for tools whose quotes must keep the caller's exact text in the URL.
- The published example is the pasted-source one (`source` leads `PARAMS`; `exampleParams` takes the first input with an example): a listing payment or a first call on the example needs no outside service.
- Paid only (`CAPACITY_LIMITED`), so `npm run smoke:examples` skips it: prove it on staging after a release with `node scripts/pay-test.mjs <staging>/audit/contract --post-json '{"source":"…"}'` (1 test USDC a call), and read the answer by hand. `node scripts/audit-contract-dev.mjs <file.sol | chainId:0xaddress>` runs the whole pipeline from this PC against the real models (token in `CF_AI_TOKEN`, a few cents a run).
- Not in it: Etherscan (needs a key and an account), Blockscout (answers 403 to automated clients), bytecode-only review, other chains than Sourcify's five we have nodes for. An unverified address is refused uncharged with "send the code in `source` instead".
- OPEN, hers: `C:\MoneyWallet\List contract audit on Bazaar.cmd` pays the tool once from the seeding wallet ($1.00, into her own income wallet; the fee is $0.001) so the Coinbase Bazaar, and through it the finder, Mercator and vAPI, list it. The door `/contract/audit` needs a second dollar in the seeding wallet and can wait.
- Judge it by outside payments of exactly 1,000,000 atomic USDC (`payments-to-us.mjs --days 7`), first by whether 0x4c29 and 0xa1d1 pay it after the Bazaar listing. Review on 25 Nov 2026: no outside sale by then means the listing does not reach its buyers, not that the price is wrong.



## Contract audit: the key-holder read was broken from Cloudflare (1.131.1, 11 Nov 2026)

- Found by the paid staging call of 1.131.0, not by the tests: `/audit/contract?address=…` answered `access.onChain: "not available"`. Cause: two hand-typed EIP-1967 slot constants in src/routes/contract-audit.ts were wrong (the admin slot had 65 hex digits; BlastAPI, nodies, publicnode and mainnet.base.org answer "Invalid params", Tenderly accepts it). On the PC the read succeeded through Tenderly, the last fallback, so `scripts/audit-contract-dev.mjs` and the local checks looked fine. LESSON: a chain read that works on the PC proves nothing about Cloudflare when the fallback list differs in strictness; read the outbound answers once (a local Worker with an `outboundService` that logs each request shows which node answered what) and never type a 32-byte constant: take it from `PROXY_SLOTS` or compute it, with a test.
- `/contract-risk` had carried the same wrong implementation slot since October: it read an empty slot and never reported a proxy. Fixed in the same release. The proxy tools (`<network>/proxy`, `PROXY_SLOTS` in chain-reads.ts) were always right.
- `chainFacts` now reads the EIP-1967, EIP-1822 and older OpenZeppelin (zos) implementation slots and both admin slots, each with its own catch, and logs `contract-audit chain facts <network> <address>: <reason>` when the whole read fails (visible in `wrangler tail`).
- AFTER IT IS LIVE: one paid staging call by address (`/audit/contract?address=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&chain=base`, 1 test USDC) must show `access.owner`, `access.proxyAdmin` and `access.onChain: "read at audit time"`.




## Our own packages connect the compact server; the client pack is in the repository (1.132.0, 11 Nov 2026)

- `mcpInstallLinks(origin)` (src/discovery.ts): `url` is `/mcp/compact` and drives the Cursor and VS Code links and the Claude Code command; `full` is `/mcp`; `claudeAi` stays `/mcp/account`. The README's three buttons are hard-coded copies of those links (base64 and URL-encoded configs): change them together. The Claude plugin (`claude-plugin/.claude-plugin/plugin.json`) and `gemini-extension.json` name the same address (tests/gemini-extension.test.cjs keeps the two equal); bump both versions when the address changes. `server.json` `remotes` still names `/mcp`: registries list the full server.
- npm client (clients/agent-data-tools, repository copy 1.2.0): `serverPath(full)` and `stdio(full)` in cli.mjs; `--full` on `setup` and `mcp` picks `/mcp`. npm still carries 1.1.1, which connects `/mcp`, and `server.json` `packages[0].version` must stay at the published version until the owner publishes 1.2.0 (the registry checks the package).
- `integrations/n8n` (package `n8n-nodes-agent-data-tools`) is its own npm package with its own lockfile, tests (`npm test` inside the folder) and n8n lint; the Worker's `npm test` and tsconfig do not read it. `.github/workflows/publish-n8n-node.yml` runs only on a tag `n8n-node-<version>` whose version equals the package's; the first version is published by the owner's click (`C:\MoneyWallet\Publish n8n node.cmd`), later ones by that tag once she has saved the trusted publisher on npmjs.com.
- `integrations/openclaw`: `node integrations/openclaw/check.cjs <saved openapi.json>` checks the skill against the live API description; the bundle's SKILL.md must stay byte-identical to the skill's (LF endings, `.gitattributes`).
- Not in the repository on purpose: the storefront test (two Workers, branch claude/storefronts, judged 18 Nov) and the gateway prototype (branch claude/gateway-proto, test network only, the owner decides).



## The recent window on /status (1.133.0, 11 Nov 2026)

- `/status` carries `recent` (newest `RECENT_DAYS` = 3 UTC days, today included) on the totals and on every tool, beside the unchanged 7-day fields. Why: the 7 Nov incident kept the week at 57% and most tools at 20-40% while every later day was above 98%. Never drop or reweight the 7-day figures: both are shown so a reader can judge for itself.



## The compact server's price rule, proven on a real dear tool (1.134.0, 11 Nov 2026)

- `/audit/contract` ($1.00, 1.131.0) is the first tool above `COMPACT_PRICE_CEILING`. Checked on production on 11 Nov before this release: on `/mcp/compact` find_tool and tool_details mark it `needsMaxPrice: "$1.00"`; `call_tool` without `max_price`, or with "$0.50", is refused uncharged; with "$1.00" and no key it answers the tool's own payment request; `/mcp/compact-capped` has no such tool. tests/mcp-compact.test.cjs now pins all of that (it never runs the audit: three large-model calls and up to 90 s).
- The refusal carries `price` and `next` only. It used to carry `repeatWith` with the caller's whole arguments; do not bring that back, a contract's source can be tens of kilobytes.
- When the price ladder moves /news and the two packs above $0.10, they need `max_price` on `/mcp/compact` and leave `/mcp/compact-capped` (and so the Hermes package) by themselves. The Hermes package (1.0.1) therefore names none of them: tests/hermes-plugin.test.cjs refuses `news`, `pack_news_sentiment`, `pack_web_research` and `crypto_news` in its skill and README. Add a tool to that list when it is put on a ladder that ends above the ceiling, and never name a tool there whose price is about to pass it: the catalogue pins one commit and a pinned skill cannot be corrected without a new reviewed pull request.
- After this release the catalogue entry needs the new pin and `version: "1.0.1"` (texts in `C:\MoneyWallet\business\agentic\hermes-catalog\`): amend NousResearch/hermes-agent#153406 if it is still open, otherwise open a pin-bump pull request.


## Orthogonal seller access (1.135.0, 11 Nov 2026)

- Owner, 11 Nov 2026: "Yes, Orthogonal" (an exception to the no-new-accounts rule for one Orthogonal seller organization). Orthogonal (orthogonal.com) is a key-and-balance gateway: its buyers prepay, it bills them at the seller's listed price per call and pays the seller organization through Stripe. Mercator imports its catalogue as reviewed (`orth-*` services, relevance about 0.74 against about 0.40 for Bazaar imports).
- `orthogonalSecret()` and `marketplaceOf(..., orthogonal)` in src/lib/marketplace.ts: a call carrying the Worker secret `ORTHOGONAL_PROXY_SECRET` (comma-separated list allowed, 16+ characters each) skips the paywall like RapidAPI and FluxA, for every price (Orthogonal billed its buyer already). Its dashboard decides how the credential is sent, so `X-Orthogonal-Proxy-Secret`, `X-API-Key` and `Authorization: Bearer` are all read; our own `adt_` keys and `Authorization: Payment` are never taken for it. GET and non-capacity-limited tools only (the shared gate in src/index.ts). Counted as outcome `marketplace`, caller family `orthogonal`, never as x402 revenue. Off until the secret is set.
- SET on production 11 Nov 2026 (before the release; unused until it ships). The value is in `C:\MoneyWallet\private\orthogonal-proxy-secret.txt` (outside every repository; %LOCALAPPDATA% is a sandbox overlay). The owner pastes the same value as the credential in Orthogonal's dashboard ("Add credential securely"). Never in Git or chat.
- Tests: tests/marketplace-secret.test.cjs (header precedence, own keys refused) and tests/payment-delivery-runtime.test.cjs (all three placements serve `/uuid` unpaid; a wrong value and the FluxA header still get the 402).



## The $0.03 step on the news tools is taken back; how a price reaches Mercator (1.136.0, 11 Nov 2026)

- `MERCATOR_TEST_PRICE` (src/routes/search.ts) is `$0.01` again for /news, its doors /news/search and /crypto/news, /pack/news-sentiment and /pack/web-research. The fixture, tests/families.test.cjs `PRICE_TEST` and tests/packs-research.test.cjs follow.
- **Evidence** (a live `wrangler tail`, 11 Nov 13:54-13:59 UTC, two hours after 1.130.0): `mercator-gateway/0.2` sent `GET /pack/news-sentiment?q=…` with an `idempotency-key` header four times (two calls, each asked twice two seconds apart), was quoted $0.03 and sent no payment. `/metrics/callers` for that day: challenged 6 / paid 6 before the step, challenged 10 / paid 6 after. Mercator's search API (`mercator.sh/v1/services/search`) shows `estimatedPrice: { amount: "0.01", dynamic: false }` for all three tools: its gateway pays the price in its own catalogue or nothing.
- **So a price step never reaches Mercator through our quote.** Its catalogue takes a price at an import of the Coinbase Bazaar, and the Bazaar shows a listing's last SETTLED price; while Mercator pays $0.01 the listing shows $0.01. A higher price there needs a reviewed listing with its own price (the provider review asked for on 10 and 11 Nov, or the Orthogonal listing, which Mercator reads as reviewed) or an import that falls in a window where our quote and the listing both show the new price, during which Mercator buys nothing. The 1.130.0 ladder ($0.10 on 13 Nov, $0.25 after) cannot be run by date: do not step again until one of those two is true, and put it to the owner first.
- How to see a refused quote the same hour, without waiting two days: `npx wrangler tail agent-data-tools --format json` filtered on the caller's user agent (requests with no payment header that repeat within seconds), and the caller's `challenged` against `paid` in `/metrics/callers`.
- After the release: `node scripts/update-402index-prices.mjs` from a checkout at current main. The Bazaar listings still show $0.01 (the owner's optional $0.03 refresh was not needed).



## Review keys (1.137.0, 11 Nov 2026)

- `src/lib/review-keys.ts`: a key is a review key when `hashCreditKey(key)` is in the secret `REVIEW_KEY_HASHES` (comma-separated lowercase hex; production and staging, set 11 Nov 2026). `/credits/balance` answers `{ reviewKey: true, callsPerDay, maxPrice, note }`; `chargeCredits` (HTTP) and `creditCharger` (MCP) run the tool without touching the credit ledger, count one call of the day in the Metrics object under `daily:caller:review:<hash>` (the all-callers counter is shared with the ChatGPT server's 5,000 a day), give back failed calls, and refuse uncharged above `REVIEW_MAX_PRICE` ($0.10: 402) or past `REVIEW_CALLS_PER_DAY` (150: 429). HTTP answers carry `X-Credits-Charged: 0` and `X-Review-Calls-Left`. Tests: tests/review-keys.test.cjs.
- Why: n8n's verification video must show the credential test passing and the common actions; the owner set no spending until 18 Nov 2026 and asked for a better fix than buying a pack. The same key serves any marketplace reviewer who needs to try paid tools (n8n's manual review, the Claude and ChatGPT directories).
- The key itself is only in `C:\MoneyWallet\private\n8n-demo-key.txt` (its hash in `review-key-hashes.txt` there). Never print it, commit it or paste it into chat; in a recording it goes into a masked password field. To end a key, remove its hash from the secret (`npx wrangler secret put REVIEW_KEY_HASHES`). Review-key calls are not customers: never count them in income, payers or demand.


## Truth audit of the tools whose jobs have buyers (1.137.0, 11 Nov 2026)

- Why these tools: `business/tool-demand-per-tool-2026-11-11.md`. Of 388 Bazaar task searches, 314 have under 30 calls a month across all sellers; 59 of our tools sit on a job with real demand. An audit ran 227 realistic inputs through them locally and compared the answers with independent sources (`base-bots/data/truth-audit-2026-11-11-demand.txt`). Regression cases: tests/truth-audit-1138.test.cjs (named before the merge into 1.137.0).
- Fixed: `decodeEntity`/`decodeEntities` in src/routes/utils.ts (hex, decimal and named references, case-sensitive; `htmlToText` and `keywordDensity` use them); `hostOf` in packs-intel.ts takes an e-mail address; `domainInfo` follows one SPF `redirect=`; `/hyperliquid/prices` reads coins through `coinKey` and kPEPE-style markets; the HTTP status table holds the IANA registry; `detectTech` skips "GitHub Pages" on GitHub's own pages (meta tags or session cookies); `resolveSymbol` writes one-letter US share classes with a dash (BRK.B -> BRK-B; VOLV-B.ST unchanged); /country reads UK and USA as names; `<chain>/block` takes 0x hex and thousands separators; MIME table extended and `INPUT_ALIASES.file` reads ext/extension; /geocode puts settlements first (`SETTLEMENT_TYPES`) and never returns a bare Q-id when a label exists (`placeLabel`); /transcribe accepts binary/octet-stream.
- Left open from the audit (not fixed, judged smaller or needing an outside decision): /keywords/ideas suggestions follow the server's location rather than `country`; /price/token takes only the ticker table, not CoinGecko ids; /price/tokens has no home-chain fallback for LINK and UNI on Base; /geocode/reverse `largest` can name a non-place; /ai/chat `usage` is an estimate; /pack/token-analysis's volume for USDC is one pool's.
- `<chain>/gas-history` is "<Chain> gas history, fee history" and its description starts "Fee history". Reason: the Bazaar search and the paid Service Finder (two listings per seller per job) put it above `/base-gas`, which has the payers. The Bazaar takes the name at the listing's next settlement.




## Swedish company register (1.138.0, 11 Nov 2026)

- Owner, 11 Nov 2026: "Agent tool first" (after the research on a credit-check product for Sweden, `C:\MoneyWallet\business\KREDITUPPLYSNING-RESEARCH-2026-11-11.md`), then "do everything we can now". Price $0.01, the owner's answer of 11 Nov 2026 ("$0.01 per call"). `/se/company` (src/routes/se-company.ts) answers register facts about Swedish legal persons by organisationsnummer, VAT number or name.
- **Legal line, keep it:** kreditupplysningslagen 2-3 §§ make any paid report "till ledning för bedömning av någon annans kreditvärdighet" a credit report needing an IMY permit, companies included. So the tool computes and implies nothing about creditworthiness: no score, grade, traffic light, "safe to invoice" or risk wording, and every answer says "Register facts only. This is not a credit report, credit score or rating." tests/se-company.test.cjs fails on such words in the copy. Sole traders are identified by a personnummer and are not in the data at all (the build skips `PERSON-IDORG` rows and SCB `PeOrgNr` 19/20…); c/o lines (often a private person's name) are dropped. `orgnrOf()` refuses a personnummer before any read.
- **Data path:** Bolagsverket's two bulk files (bolagsverket_bulkfil.zip 252 MB, UTF-8, `;`-separated, quotes escaped as `\"`; scb_bulkfil.zip 71 MB, Latin-1, tab-separated) are free and need no key or account. The server closes long transfers part way and sends about 37 KB/s to the owner's PC, so the PC never downloads them: `.github/workflows/se-company-mirror.yml` does, on Tuesdays and on push, resuming until the size matches. `scripts/build-se-company-index.mjs` writes `se-companies-<date>-<run>.bin` and `se-names-<date>-<run>.bin` (509 gzip shards each, back to back) and `manifest.json` with every shard's [offset, length]; the release is `se-register`, and the two previous builds' files are kept so an isolate holding the older manifest still reads. The Worker reads the manifest (an hour per isolate) and one shard per call with a Range request, cached a week in `caches.default` under the build's file name. A 200 instead of 206 is refused (it would be the whole 150 MB file). One file per kind because 1,018 per-shard assets hit GitHub's limit of about 500 uploads an hour (the first run, 11 Nov). The two half-filled releases of that run (`se-company-data`, `se-company-names`) could not be deleted (GitHub answered 502); delete them when it works.
- Shards: `shardOf(orgnr)` = first nine digits mod 509; the name index has each registered company under each of the first four words of up to three names, keyed by the word's first three letters (`nameShardOf`). Both functions exist in the build script and the route and the test holds them equal; change both together. First full build (9 Nov data): 2,228,337 legal persons, 1,040,765 sole-trader rows skipped, 281,919 in SCB's register only (municipalities, non-trading associations, foundations).
- `NEEDS_REMOTE_DATA` in scripts/smoke-examples.mjs skips it locally. Prove it after the release with a free HTTP trial on production (`/se/company?orgnr=556703-7485&trial=1` and `?name=spotify&trial=1`) and one paid staging call: a Worker's fetch must keep the Range header through GitHub's redirect.
- Not in it, on purpose: annual-report figures (the iXBRL files are a separate weekly folder; a later step if the lookup sells), board members (not in the free data; Bolagsverket's paid API), anything about persons.



## SpellzCode company pages (1.139.0, 11 Nov 2026)

- Agent Data Tools is the product, SpellzCode the maker. `/about`, `/changelog` and `/.well-known/security.txt` live in src/lib/legal.ts; `COMPANY_FOOTER` is the footer line of the tool pages, guides and browser 402 page. tests/company-pages.test.cjs fails if a personal name, a personnummer-shaped number or "the owner" appears on /about or /changelog.
- Seller details (legal form, organisation number, address) are added to /about only on the owner's word once the firm is registered.
- `node scripts/build-changelog.mjs` rewrites src/data/changelog.generated.ts from the release commits on origin/main; run it before a release so the newest versions appear.
- The routing layer never moves (plan: C:\MoneyWallet\business\spellzcode-professionalisation-plan-2026-11-11.md): the workers.dev origin, PAY_TO and the other payout wallets, tool paths and names, the io.github.Nutshell2000 registry names, the repo path and the Worker name. Never put "SpellzCode" into a tool name; `SERVICE_NAME` stays "Agent Data Tools".



## Trust and evidence tools (1.140.0, 11 Nov 2026)

- src/routes/trust.ts. Why: the 11 Nov research (reports/Agentic payments market for SpellzCode.md) found trust the thinnest layer of agent payments and the one niche SpellzCode can lead without a licence: on stablecoin rails there are no chargebacks, so buyers need checks before paying and receipts after. /check/payee and /check/x402-seller already screen the payee; these add what they do not answer.
- `/x402/payout-check`: `payoutVerdict(live, listing, declaration)`. The Bazaar listing is found with the discovery search queried by the resource URL (it returns the exact resource first, checked 11 Nov 2026) and matched on `bare()` URL. `declaredWallets()` reads `payTo` (Lumiere's format, ours), `wallets` or `payouts`, strings or {address}. A declared rotation needs BOTH the live and the listed wallet in the file.
- `/x402/seller-record`: `inflows()` scans USDC Transfer logs filtered by the payee topic in windows of `SCAN_WINDOW` 40,000 blocks, newest first; publicnode answers up to 50,000 blocks for one address and topic, tenderly 1,000, nodies 50, mainnet.base.org rate-limits (probed from the PC 11 Nov 2026). Prove it from staging after release: Cloudflare egress may meet other limits. A later window that fails keeps what was read with `complete: false`. It counts every USDC transfer in, x402 or not.
- `/x402/receipt`: `canonicalJson()` (sorted keys) of the receipt core and its SHA-256; `receiptId` = `rcpt_` + 16 hex of SHA-256(chain|hash|logIndex). `method` is `eip3009-authorization` when the USDC contract emitted AuthorizationUsed in the same transaction (the x402 exact scheme). Example: Mercator's $0.01 payment of 11 Nov 2026, tx 0x778c8c1b…b933.
- Rules: never add a credit score, a person's name or anything that rates a person (IMY permit, AI Act high-risk from 2 Dec 2027); describe wallets, listings and transactions only. Nothing here may hold, move or sign funds.



## Estates out of /se/company (1.141.0, 11 Nov 2026)

- SCB's register holds about 2,000 dödsbon (SCB legal form 91, organisationsnummer starting 10). Each is named after the deceased person ("NILSSONS DÖDSBO, SVEN OLOF …") with an address that is often a relative's home. That is personal data, so the tool never shows one. Owner, 11 Nov 2026: "Yes, fix it".
- `isEstate()` exists in both `src/routes/se-company.ts` and `scripts/build-se-company-index.mjs`, and tests/se-company.test.cjs holds the two equal.
  - The build drops estates and counts them in the manifest's `skippedEstates`.
  - The Worker refuses an estate's number with an uncharged 404 and skips estates in name search, which also covers copies built before the build skipped them.
- If any other legal form turns out to carry a private person's name, add it the same way in both files.



## Truth-audit fixes, second batch (1.142.0, 11 Nov 2026, no new tools)

- `/keywords/ideas` filters suggestions that only add the requester's location (`addsForeignPlace`, `seedNamesPlace` in
  src/lib/place-names.ts). The engines localise by the caller's IP whatever `country` says, and in production the caller
  is a Cloudflare data centre. The gazetteer is the scheduled-service airport cities in src/data/airports.generated.ts
  plus Intl country names; `ORDINARY` and `ORDINARY_COUNTRY` keep city or country names that are ordinary words (nice,
  mobile, page, jordan, turkey…). Add a word there when a real keyword shows up in `removedAsLocation`. Districts that
  are not airport cities (Södertälje, Florissant-Malagnou) still pass. `AMAZON_MARKETS` maps a country to its Amazon
  completion host and marketplace id; India's host failed on 11 Nov and is left out.
- Tickers (src/lib/tickers.ts): add a token only after `symbol()` and `decimals()` match on-chain AND its Uniswap price
  is within about 2% of an independent spot price; a thin pool can price a listed token far off (SNX was 8% high).
  `NOT_ERC20` names coins that have no ERC-20 on our networks; the refusal points them to /hyperliquid/prices.
  Tickers resolve on the first network in SLUGS order that knows them, so adding a token to Ethereum's table moves
  ticker-only calls for it to Ethereum (ARB was kept off Ethereum for that reason).
- `/price/tokens` groups tickers by network when no chain is named; the top-level chain, ethUsd and block are the
  default network's when any token is priced there, otherwise the first network read.
- `/geocode/reverse`: `SETTLEMENT_CLASSES` (src/routes/geo-more.ts) decides "largest". Never use FILTER NOT EXISTS in
  this query: Paris took over 25 s with it; the OPTIONAL plus a filter in `shapePlaces` costs nothing. PowerShell's
  `-replace` is case-insensitive: replacing a placeholder like RAD in a SPARQL template also rewrote "radius" (use
  `-creplace`).
- `/ai/chat` prompt calls go through `nativeChat`, which returns the model's usage; `usageEstimated: true` marks the
  character estimate when the model reports none.
- `isQuoteAsset` (src/routes/token-report.ts): DexScreener lists a token's pairs only where it is the base token, so
  market figures for USDC, WETH and the like are labelled `representative: false` and raise no liquidity flags.

## Block times are read from the chain (1.143.0, 11 Nov 2026)

- Base moved from 2 s to 0.2 s blocks around 5 Nov 2026. Never convert days or minutes into a block count with a fixed
  number: `src/lib/block-time.ts` has `recentBlockSeconds(client, slug, latest)` (two headers 20,000 blocks apart,
  kept ten minutes per network as a plain number) and `blockAtTime(client, head, unixTime, { secs, tolerance, samples })`
  (interpolation over real headers, bisection after two reads on the same side, so it holds across a change of block
  time; share `samples` between targets). `NOMINAL_BLOCK_SECONDS` is the fallback only, measured 11 Nov 2026.
- Users: /x402/seller-record (window start, `hoursCovered`, `requestedFromBlock` and `coverageNote` when partial),
  /wallet/balance-history (one block per day by time, `blockTime` per point), /whale/transfers, /dex/new-pools ages,
  /dex/trending minutes. Copy that states "N blocks is about M minutes" comes from the same measurement
  (`BLOCK_WINDOW` in src/routes/chain-reads.ts); re-measure before trusting it.
- publicnode answers address-filtered eth_getLogs up to 50,000 blocks ("exceed maximum block range: 50000"); Tenderly
  1,000 for filtered and at least 500 for topic-only Swap scans. `scanInflows` (src/routes/trust.ts) keeps only the
  unbroken newest part of a scan, so counts and coverage always describe the same blocks.
- Still thin on Base, stated in honest time: /wallet/related and /wallet/transactions (2,000 blocks = 7 minutes). They
  scan in fixed 1,000-block windows on the topic-only log nodes, so ten times the span is ten times the calls: decide
  with a staging proof, not by copy.
- The paused seller kit page (GET/HEAD /buy/x402-seller-kit) answers 410 (it answered 503, which trust graders read as an outage: Lumière F, uptime 0). Direct order creation keeps 503: `HttpError` allows no 410.
- `BLOCK_SCALE` (src/routes/chain-reads.ts): Base's growing-window log scans (token transfers, /token/buyers, /dex/new-pools) take ten times the blocks, windows capped at `LOG_WINDOW_MAX` 50,000. Wallet scans with fixed 1,000-block windows are not scaled (ten times the calls).



## Swedish company name search (1.144.0, 11 Nov 2026)

- `nameWords` (src/routes/se-company.ts and scripts/build-se-company-index.mjs, kept equal by tests/se-company.test.cjs) folds ø, æ, ß, đ, ł, þ and joins a run of single-letter words into one word ("H & M" is "hm", "A/S" is "as"). Change both files together: the name index is built with the build script's copy, and a change reaches searches only after the mirror workflow has rebuilt the index (it runs on push of the builder to main, or `gh workflow run se-company-mirror.yml --ref <branch>`). Publishing a rebuilt index before the Worker release is safe: the Worker reads index entries by position and ignores extra items.
- Name-search order: exact name, then `TRADING_FORMS` (AB, HB, KB, bank, insurer, SE…, and the SCB number codes for them), then other Bolagsverket forms, then SCB-only entries (municipalities, foreign legal persons), then names that start with the first word, then fewer words.
- Index entries are `[name, orgnr, form, city]` since this build; `city` (optional input) narrows a search by the start of the postal city with `nameWords` normalisation. An index without the city item lets every name through the city filter instead of dropping all matches.
- Quality check for this tool: run its handler in Node against the live release (a copy of `se-company-live.local.cjs` from the session scratchpad into scripts/, deleted afterwards) on real names: initials, municipalities, banks, deregistered and bankrupt companies. The PC reads GitHub at about 37 KB/s, so the first call of a cold shard can time out locally; Cloudflare does not.



## Norwegian and Finnish company registers (1.145.0, 11 Nov 2026)

- Owner, 11 Nov 2026: "$0.01 per call" for `/no/company` and `/fi/company` (src/routes/nordic-company.ts), the siblings of `/se/company`. Same legal line: register facts only, no score, rating, grade or "safe to" wording; tests/nordic-company.test.cjs fails on such words.
- Norway: `data.brreg.no/enhetsregisteret/api` (NLOD 2.0, keyless; attribution in `source`). `noOrgnrOf` reads 9 digits, NO…MVA and spacing, with the mod-11 check. `PERSON_FORMS` (ENK) is refused on lookup and dropped from searches; `telefon`/`mobil` are never read into an answer; the `/roller` endpoint (board members, people) must never be called (the test checks the URLs). A deleted unit answers 410 with its record: status "deleted". Search reads one page of 100 (Brreg orders by relevance).
- Finland: `avoindata.prh.fi/opendata-ytj-api/v3/companies` (CC BY 4.0, keyless; PRH asks that services built on it do not use its logos or look like PRH). `fiIdOf` reads 1234567-8, 12345678, FI12345678 and the old six-digit body. The API leaves out private traders; `FI_PERSON_FORMS` guards anyway. A name search answers about 70 companies per page in business-ID order, so `fiSearch` also asks "<name> Oyj" and "<name> Oy" in parallel (three requests per search) and merges by business ID; ended companies are left out of searches. Code lists: `/v3/description?code=YRMU|REK|KONK|SANE…&lang=en`.
- `rankNames`: exact name (legal-form words ignored), then every query word whole, then `NO_TRADING` / `FI_TRADING` forms, then names starting with the first word, then shorter names.
- Not built: France (recherche-entreprises.api.gouv.fr, Licence Ouverte 2.0, open but rate-limited; users reported 429s in April 2026; test from Cloudflare and measure demand first), Denmark (CVR needs an account), the UK (Companies House needs a key).
- Check after release: one paid staging call each from a worktree with a funded test wallet (x402-w11): `/no/company?orgnr=923609016`, `/fi/company?name=kone` (KONE Oyj first).

## Log reads under rate limits (1.146.0, 12 Nov 2026)

- From Cloudflare's egress the free log nodes rate-limit by the call: Base publicnode answers in tens of milliseconds or
  holds a refused call 3.0 s ("Rate limit exceeded"), Tenderly refused everything on 12 Nov, Nodies hung. `logTransport()`
  (src/lib/rpc.ts) gives publicnode 1.5 s tries with three quick retries and every other public node one try of at most
  4 s; viem retries a timeout like an error (tests/log-speed-1146.test.cjs runs a real client against a stalling node).
  Do not raise publicnode's timeout back to seconds: a healthy answer takes under 0.1 s.
- Measure nodes only from Cloudflare (a throwaway Worker, then `wrangler delete`): the PC is never rate-limited and saw
  publicnode answer every call.
- `SPARSE_FIRST_WINDOW` (500 blocks) for scans of sparse logs (token-transfers, new pools); busy contracts keep the
  10-block start.
- /x402/seller-record has a 25 s scan budget (`SCAN_BUDGET_MS`); a cut-short read answers `complete: false`,
  `hoursCovered` and a `coverageNote` asking for fewer days.
- The durable fix is a keyed Base RPC in `BASE_RPC_URL` (a provider account: the owner's decision).



## Swedish annual-report figures mirror (1.147.0, 12 Nov 2026)

- **What it is:** `scripts/se-financials/*.mjs` plus `.github/workflows/se-financials-mirror.yml`. It reads Bolagsverket's weekly iXBRL bulk zips (listing: `vardefulla-datamangder.bolagsverket.se/arsredovisningar-bulkfiler`, S3-style).
  - There are 1,469 files and 127 GB since 2020. The first build read 2024 onward (879 files).
  - Each weekly zip holds one zip per company, named `<orgnr>_<fiscal year end>.zip`, with one or two xhtml documents.
- **What it publishes:** release `se-financials`, with the same shard layout as `se-register` (`shardOf` = first nine digits mod 509) and the manifest `row`. Each record is `{fw, cur, latest, y:[[start, end, ...figures, fromReport]]}`, newest year first, up to six years.
- **Rules:**
  - Only the facts in `FIELDS` are read, so no personal data. tests/se-financials.test.cjs feeds signatory and auditor names and checks they never reach the output.
  - Dimensional contexts are ignored.
  - `agreed()` keeps the most frequent value. On a tie between values a factor 1,000 apart it keeps the larger, because filers drop `scale` on one occurrence.
  - No computed ratios or credit wording; the test enforces this. "Soliditet" passes through only as reported.
- **Runs:**
  - Tuesdays 06:17 UTC, a push to main that touches the pipeline, or dispatch (`full=true` rebuilds from `from_year`).
  - A run processes only files missing from the previous manifest's `processed` list, which holds only files whose extract job uploaded its results. An upload failure (11 Nov, during the GitHub outage) is retried on the next run.
- **Coverage, 11 Nov:**
  - 529,188 companies: K2 503,069 and K3 26,119.
  - Listed companies' ESEF reports are not in the bulk; Ericsson is absent from every 2026 week.
- **No tool reads it yet.** `/se/company/financials` exists only as a local draft and waits for the owner's decision and price.



## Finder price test (1.148.0, 12 Nov 2026)

- `FINDER_TEST_PATHS` (src/endpoints.ts): /robots and /commodity/price at `FINDER_TEST_PRICE` $0.001, the owner's decision of 12 Nov 2026 ("Yes, test those two"), review 26 Nov. It is checked before `ACQUISITION_PATHS`.
- Why: the x402 Service Finder scores 0.30 relevance + 0.30 payers + 0.25 uptime + 0.15 price (price part = cheapest candidate / own price), fitted to its paid answers with a median error of 0.0003 (`business/agentic/base-bots/finder-price-sim.mjs`, which re-scores stored answers at any price). At $0.001 both become its #1 pick; they were #3 at $0.01. Its listings under 5 payers carry NOT_MONITORED (uptime part 0.70), so payers decide two of its four parts.
- At $0.001 a sale nets nothing once CDP's 1,000 free settlements a month are used (the reason `ACQUISITION_PRICE` is $0.002). Never put a tool Mercator buys here: it pays only its stored price.
- Revert: empty the set and run `scripts/freeze-prices.mjs`, then `update-402index-prices.mjs`.



## French company register; company tools in the finder (1.149.0, 12 Nov 2026)

- /fr/company (src/routes/fr-company.ts; $0.01, the owner's answer of 12 Nov 2026: "$0.01 per call"): echerche-entreprises.api.gouv.fr/search (Licence Ouverte 2.0; about 7 requests a second per address; a 429 after getJson's one retry is an uncharged 503). sirenOf reads SIREN, SIRET and FR VAT (key = (12 + 3 x (SIREN mod 97)) mod 97, checked) with the Luhn check. Every request carries st_entrepreneur_individuel=false; legal category 1xxx and statut_diffusion other than "O" are never shown. Never read dirigeants (people), inances or coordinates into an answer: tests/fr-company.test.cjs feeds them and asserts none come out. The search sends the town inside q (it matches addresses) and filters on the head office's town; ank() puts GE/ETI first, then exact name, whole words, size, starts-with. The API also matches establishment signs and addresses, so a match must hold every query word in its own name unless none does.
- Finder JOBS (src/routes/recommend.ts) and TOOL_SEO (src/lib/tool-seo.ts) cover all four registers. "verify a supplier in Norway" still lands on the wrong tools: a bare country word was left out of JOBS on purpose ("norway weather").

## Our own hosts through SELF (1.150.0, 12 Nov 2026)

- A Worker cannot fetch its own public hostname over the network. Any tool that reads a caller-named URL must try
  `selfFetch(env, url, accept)` (src/lib/self-fetch.ts) before `fetchPublic` when the URL may be one of ours; it returns
  null for other hosts. Done for /agent-readiness and the trust and x402 checks. Not yet: /extract, /url/meta, /seo/audit,
  /sitemap, /robots and the website packs (they still fail on our own pages); add it there when one of them is asked
  about our own site.


## VIES: GET and POST alternate (1.151.0, 12 Nov 2026)

- France's VIES service refuses most GET checks with MS_MAX_CONCURRENT_REQ, while the POST endpoint
  `/check-vat-number` queues for a slot (about 10 s) and answers. `viesCheck` alternates the two inside 20 s; keep GET
  first. If a member state stays busy after this, the next step is a national register fallback (France: SIREN via
  recherche-entreprises, the /fr/company source), labelled as not a VIES answer.
- Yahoo's chart API has two hosts (`CHART_HOSTS` in src/routes/stocks.ts); `chartBody()` tries the second on a 502.

## Business verification by name on /vat/validate (1.152.0, 12 Nov 2026)

- `src/routes/company-verify.ts`: `verifyCompanyByName(name, country)` searches the FR, SE, NO and FI registers (the
  register tools' own search functions; `SEARCHERS` table) and answers `found`, `exactMatch`, `bestMatch`, `matches`,
  `registersSearched`, `complete`. /vat/validate calls it when `vat` is absent and `name` (aliases entity_name,
  company, legal_name, business_name) is given. It is loaded with `await import()` because the register modules import
  registries.ts. `found: false` is a charged answer, like VIES's `valid: false`. A failed register is listed and makes
  `complete: false`; all failed is a 502. Add a register here when a new country register tool ships.
- Datacircle (datacircle.dev) benchmarks providers per job and country and publishes rankings. Its results for us
  come by mail to spellz111122@gmail.com. Reading them is fine; answering is outreach (the owner's).



## /describe takes a page URL (1.155.0, 14 Nov 2026, no new tools)

- `describeImage()` (src/routes/ai.ts): bytes that are a web page instead of an image are read through `pagePreviewImage()` (og:image, then twitter:image, via `parseMeta` from feeds.ts), one extra guarded fetch. The answer adds `imageUrl` and `note` only in that case. Why: a returning buyer's paid calls on 14 Nov sent page URLs and got 415. Read `/status` `topFailures` of a tool a real buyer uses before anything else: a refused paid call is a lost sale that costs nothing to see.
- Same day's audit (business\tool-sales-audit-2026-11-14.md): new wallets that buy ~50 `/weather/forecast` calls in one burst come from vAPI Network; the finder buyer's first run after `/hyperliquid/indicators` went to $0.05 did not pick us (one run, rotation not excluded; review date stays 26 Nov).



## Model pricing by provider (1.156.0, 14 Nov 2026)

- Round 9 doors in `src/routes/entry-paths.ts`: `/gpt/pricing` and `/claude/pricing` run `/llm/prices` with `providerInput("openai" | "anthropic")`. Evidence: Mercator's gateway paid modelprices.xyz 84 times in seven days ($0.01 a call) for per-provider pricing paths; `business/agentic/base-bots/mercator-jobs.mjs "gpt pricing" "claude api pricing"` showed us absent. To find the next such job: `buyer-today.mjs <Mercator wallet> 2` lists the sellers it paid, then look each one up in the Bazaar snapshot by `pay_to` and ask `mercator-jobs.mjs` for the job its busiest path names. `/llm/prices` now has its two doors.



## One coin, named (1.157.0, 14 Nov 2026)

- Round 10 doors: `/solana/price` and `/ethereum/price` run `/crypto/price` with `coinInput("solana" | "ethereum")`. Evidence: the agent 0xe629 buys the first Bazaar search result for its job (`buyer-sellers.mjs <wallet> 3` beside `bazaar-search-compact.mjs "<job>"`): ours where we are first, another seller's where we are absent. To find the next door, run those two scripts for every wallet that paid us on two or more days. `/crypto/price` now has its two doors.
- `/credits` gives both free-call numbers (`FREE_HTTP_CALLS_PER_CALLER` and `FREE_CALLS_PER_CALLER`); keep any sentence a browser visitor reads on the HTTP number.



## Stablecoin charts (1.158.0, 14 Nov 2026)

- `/stablecoin/charts` (src/routes/stablecoin-charts.ts): DefiLlama's stablecoins API (`/stablecoinchains` for the chain list, `/stablecoincharts/<Chain>` or `/all` for the series), all pegs added up in dollars (`sumUsd`), `chainKey()` aliases read with Object.hasOwn. Ordinary price; a lower one is the owner's call. Why: it was the largest job our one returning independent agent bought elsewhere. Judge it by that agent's purchases and by the Bazaar search for "stablecoin charts" after the first settlement.



## npm client wallet mode (1.159.0, 14 Nov 2026)

- `clients/agent-data-tools/wallet-pay.mjs`: `walletPayer()` (lazy @x402/core, @x402/evm, viem), `spendGuard()` (per-call and daily limits, Base USDC only, refund on a failed call), `paymentRequiredOf()`. `mcp-stdio.mjs` `forward()` pays a tools/call whose result is an x402 payment request and resends it with `_meta["x402/payment"]`. Wallet mode is on only without a prepaid key. Staging proof: set `AGENT_DATA_TOOLS_ORIGIN` to staging, `AGENT_DATA_TOOLS_TESTNET=1` and the test wallet's key, pipe initialize + tools/call into `node clients/agent-data-tools/cli.mjs mcp [--full]`, and read the `x402/payment-response` in the result's `_meta`. The publish folder is `C:\MoneyWallet\business\agentic\npm-client` (copy the client files there after a change; the owner publishes). Mention wallet mode on the homepage, llms.txt and the catalog skill only after `npm view agent-data-tools version` answers 1.3.0.



## AI SDK entry point, guide and install document (1.160.0, 14 Nov 2026)

- `clients/agent-data-tools/ai-sdk.mjs` (`agentDataTools`) and `/guides/ai-sdk` (src/guides/ai-sdk.ts). To test the entry point as a user gets it: `npm pack clients/agent-data-tools`, install the tarball beside `ai` in an empty folder (a folder install is a symlink and cannot find `ai`), and run generateText with `MockLanguageModelV3` from `ai/test`. Keep the guide's code equal to what was run.
- `llms-install.md` is what the Cline marketplace hands its agent; keep it in step with the MCP paths and the client's environment variables. `docs/assets/logo-400.png` is the icon it asks for.
- When the npm client changes: publish first (owner), then `packages[0].version` in server.json, then copy on the homepage.



## Three more PDF guides (1.161.0, 14 Nov 2026)

- TASK_GUIDES gained three PDF pages marked secondary: true; GUIDE_FOR_TOOL skips secondary guides so each tool page keeps its guide link (without the flag the last guide that names a tool wins).


## The capped PDF try (1.161.0, 14 Nov 2026): ON since the owner's "Yes, switch it on"

- `PDF_TRY` unset = PDF reading is paid only, as the owner decided on 10 Nov 2026. `PDF_TRY=on` (set in wrangler.jsonc production vars on her word of 14 Nov 2026) lets a browser run /pdf/text and /pdf/extract free inside its 3 HTTP free calls, 2 pages and 6,000 characters a read, 150 reads a day in total (`PDF_TRY_DAILY_CAP`). Code: src/lib/pdf-try.ts (`pdfTryFor`, `takePdfTry`, `pdfTryRequests`), the reserved input `PDF_TRY_INPUT` in src/routes/pdf.ts, two lines in the paywall wrapper of src/index.ts. Do not widen it to non-browser callers or raise the page limit without her word: the 10 Nov free rider used 400-1,300 full reads a day.




## Stored logs are sampled at 1% (1.162.0, 14 Nov 2026)

- `"observability": { "enabled": true, "head_sampling_rate": 0.01 }` in both wrangler files. At 100% the service stored about 19 log events a request (701 library warnings per cold start), about 238 million a month against 20 million included. Never set it back to 1 without removing those warnings first. Measure with `npx wrangler tail agent-data-tools --format json` for a minute and count `logs` per event. The live setting can be read and changed without a deploy: `GET/PATCH /accounts/<id>/workers/scripts/<name>/settings` (multipart field `settings`), but a deploy applies whatever wrangler.jsonc says.
- CPU, same sample: median 5 ms a request, cold starts 60-225 ms (2.7% of requests, 34% of CPU); the first quote in a new isolate builds all 701 route configurations. A per-path lazy build or a cached quote would cut that; not done (it is the payment path).



## Unpaid quotes from the edge cache (1.163.0, 14 Nov 2026)

- `src/lib/quote-cache.ts` (`quoteCacheKey`, `readQuote`, `writeQuote`), used in the paywall wrapper of src/index.ts just before the gateway. Key = release version + payment settings (`quoteFingerprint`) + exact URL; TTL 30 minutes; MPP challenges are always made after the cache. When a new setting changes what a quote says, add it to `quoteFingerprint`. When a new way to pay or to identify a caller arrives by header or query, add it to the lists in `quoteCacheKey` so such requests never get a key.
- Cost facts behind it (14 Nov 2026 live sample): median request 5 ms CPU, cold first quote 60-225 ms, a warm quote is mostly the MPP challenges (mppx), which the cache cannot hold. A gateway per paid path is worse (10-30 ms each on first use): do not retry it.



## Focused product pages and VAT check pages (1.164.0, 14 Nov 2026)

- Owner, 14 Nov 2026: sell focused products by monthly plan, found through search; several products. Audit and research: `C:\MoneyWallet\business\tool-sales-fresh-audit-2026-11-14.md`.
- Search Console on 14 Nov 2026: 0 search clicks in 28 days on workers.dev, 1 on tools.funwords.eu. The funnel's `referral /from/google` counts a referrer header that fetchers send; it is NOT search traffic. Read Search Console before quoting visitors.
- `src/lib/product-pages.ts`: `PRODUCTS` (`/pdf-to-text-api`, `/web-page-to-markdown-api`, `/company-check-api`), `productPage()`, `productOffers()` (plans first, then packs, counted at `keyPrice`), `PRODUCT_FOR_TOOL`. A new product is one entry; its copy may only restate the tools' descriptions; its slug must end in `-api`. The page names no payment protocol above its "For AI agents" section (tested): these visitors pay by card.
- `src/lib/vat-pages.ts`: `/vat-number-check` and one page per VIES country (`VAT_COUNTRIES`, which tests keep equal to `VIES_COUNTRIES`). Each page keeps facts that differ per country and the working check; do not add templated pages without their own data.
- By the research, company and VAT checks are the lead product (business buyers); the PDF page's views were fetchers, not demand.
- `TaskGuide.code` holds a complete script for a language page; `{origin}` is replaced.
- Entry-path tool pages (`ENTRY_OF`) are canonical to their tool's page and out of the sitemap. `/credits` shows the monthly plan before the packs.
- Not built, the owner's decisions: file upload for PDF (personal documents would be processed: privacy text first), OCR, a bank-statement product, a free key by e-mail, a domain of our own, a higher sanctions price, removing the $1 pack.



## Discovery index once per isolate; challenges are single-use (1.165.0, 14 Nov 2026)

- `/discovery/resources` (src/index.ts `discoveryPages`): one JSON string per origin, limit, offset and `quoteFingerprint` per isolate, at most 24 keys. Anything that changes the index without a deploy must be part of `quoteFingerprint` (src/lib/quote-cache.ts).
- **Never cache an MPP challenge.** mppx uses the hash of the evm challenge as the EIP-3009 nonce and binds a Tempo payment to the challenge id, so a challenge pays once; a cached one would have every second buyer refused as a replay. Tried and reverted on 14 Nov (tests/mpp-evm.test.cjs caught it). The quote cache therefore stores the x402 quote only and makes both challenges fresh on a hit.



## Document toolkit: files sent in a POST, office files to text, fields out of a document, free keys built and off (1.166.0, 14 Nov 2026; 702 tools)

- `src/lib/file-input.ts`: `FILE_INPUT_PATHS` (/pdf/text, /pdf/extract, 10 MB) and `sentFile()` find a file in a POST body (raw bytes, a multipart `file` part, or base64 / a data: URL in JSON under file, data, content, base64 or pdf). The POST middleware in src/index.ts holds the bytes (`holdFile`, reference `@file:<sha256 of the bytes>`), forwards the GET with `file=<reference>` and releases them afterwards: the lib/long-input.ts pattern for bytes, so the quote and the paid retry of one file name the same resource URL. The route hands the tool that query value under the reserved input `@file` (`FILE_REF_INPUT`), only for paths in `FILE_INPUT_PATHS`; `file` is not a declared input, so listings, MCP and the OpenAPI document are unchanged. A reference nobody holds (a GET built by hand) is a 400; a file that is not a PDF is a 415; over 10 MB is a 413 before anything is read. MCP cannot send a file.
- Why: research of 14 Nov (`C:\MoneyWallet\reports\Focused API product for 10k monthly.md`): the one seller found earning without promotion sells inside Make, n8n and Power Automate, where a step hands over a file, not a link. The owner approved that direction the same day ("go on the report").
- To let another tool take a file: add its path and size limit to `FILE_INPUT_PATHS` and read `q(FILE_REF_INPUT)` with `heldFile()` in its handler. Tests: tests/file-input.test.cjs (Miniflare's fetch does not take Node's FormData; the multipart body there is written by hand).
- n8n node (integrations/n8n, 0.3.0): Document > Convert to Text, Extract Fields, Extract Text From PDF. `sendFile` (resources/document.ts) turns the declared GET into a POST with the binary field's bytes when File Source is a file.
- **`/document/text`** (src/routes/document.ts, $0.005): docx, xlsx, pptx read with `src/lib/zip.ts` (central directory + `DecompressionStream("deflate-raw")`; every part is read up to a limit, so an archive that expands to gigabytes is refused; no ZIP64, no encryption) and saxes; a PDF goes through `readPdf`. The kind of file is read from its bytes, never from a name or content type. Old .doc/.xls/.ppt are a 415 that says to save as the new format. Excel returns cached values (dates as day numbers; the answer's `note` says so), at most 20 sheets x 2,000 rows x 50 columns. Example file: calibre's demo.docx; if that host ever refuses Cloudflare, pick another and prove it on staging.
- **`/document/extract`** ($0.03): `readDocument` as text, at most `EXTRACT_CHARS` 24,000 characters, then `extractFields()` (src/routes/ai-text.ts, shared with /ai/extract-json) on `CHAT_MODEL`. Not in `CAPACITY_LIMITED`: one cheap model call, bounded by AI_DAILY_CAP, and covered by a free key on purpose (it is the hook). The published example is a real answer (local run against Workers AI, 14 Nov). A text-layer invoice returned all eleven stated fields, Bankgiro and OCR number included, and null for the absent IBAN. Scanned files have no text and fail uncharged: OCR is not built.
- **Prices are delegated** (the owner, 14 Nov 2026: "you decide prices"): set them, write the reason in the notes and in `scripts/freeze-prices.mjs "<decision>"`, tell her; do not ask first. Do not reprice a tool Mercator buys without reading why its stored price matters (1.136.0).
- **Free keys by e-mail** (src/lib/free-keys.ts; the owner: "Yes, 100 a month"): `/keys/free` (form), POST (one message with a link), `/keys/free/confirm` (shows the key). `Account.free` in src/lib/credits.ts holds `perMonth`, `month`, `used`; `spendCredits(..., freeMonth)` uses a free call first when the caller passes the month, which `chargeCredits` and `creditCharger` do only for tools outside `CAPACITY_LIMITED`; a failed call gives it back (`refundCredits(..., 0, true)`). One key per address hash (`credit:free:<hash>`; Gmail dots and +tags normalised); not a session record, so /revenue card figures do not count it. Funnel stages `free_key_issued`, `free_key_call`. OFF: needs `FREE_KEYS=on`, a `send_email` binding named EMAIL (Cloudflare Email Service, sender domain onboarded) and `FREE_KEY_FROM`. Switch on only after a real sign-up is proven on staging. The privacy page already names what is kept.
- **Listings for automation tools** (integrations/): n8n node 0.3.0 (npm holds 0.2.0 from 13 Nov; publish by pushing the tag n8n-node-0.3.0 on a main commit that holds it: .github/workflows/publish-n8n-node.yml, trusted publishing, no code from the owner), Power Automate connector definition and Make app blocks as drafts with `REPLACE-WITH-PUBLIC-DOMAIN`; Make refuses services without their own domain. Evidence and reasoning: `C:\MoneyWallet\reports\Focused API product for 10k monthly.md`.
- **OCR** (src/routes/document.ts): `readDocument(bytes, format, maxChars, ocr?)` takes the reader as a parameter (`visionOcr(env)`, MODELS.vision), so tests need no model. An image (PNG, JPEG, WebP; 3 MB) goes to it directly. A PDF whose `readPdf` fails with "no text layer" is treated as a scan: `pdfPageImages()` lifts out the JPEGs a scanner stored (streams with the DCTDecode filter, 15 KB to 3 MB each), at most `OCR_MAX_PAGES` 3, read in parallel. Scans stored as CCITT or JBIG2 are refused with that reason. PDF.js takes over the buffer it is given, so `readPdf` gets a copy when OCR may follow (without the copy the page images were gone: found on the first live try). Answers carry `ocr: true` and a note. Proven locally against Workers AI on 14 Nov with a rendered Swedish invoice as JPEG, PNG and scanned PDF (all twelve fields right, 10-26 s); real, skewed or handwritten scans have NOT been tried: do that before promising accuracy. `wrangler dev` rebuilds in a loop after a source edit here (the generated validators file changes on every build); restart it instead of waiting.
- **Second n8n package** `integrations/n8n-documents` (`n8n-nodes-document-extract` 0.1.0, node "Document Extract", credential `documentExtractApi`): documents only, because n8n verifies packages that integrate one service and refuses multi-API proxies (verification guidelines read 14 Nov). Publishing workflow `publish-n8n-document-node.yml` on tags `n8n-document-node-<version>`. A new npm package cannot use trusted publishing before it exists: the owner publishes a first placeholder version and sets the trusted publisher once, as was done for the first package (its 0.0.0-stage). Verification is submitted at creators.n8n.io (creator account: the owner's).
- **train-delta.ps1** now accepts a previous release whose merge title ends "(x.y.z)" as well as one that starts "x.y.z:" (1.165.0 merged with the first form and the next train waited for a title that never came). Start notes titles with "x.y.z: ".



## Company register pages; upload on the PDF page (1.167.0, 14 Nov 2026)

- `src/lib/register-pages.ts`: `/company-register` and one page per register we read (`REGISTER_COUNTRIES`: Sweden, Norway, Finland, France). Every rule a page states (check digit, VAT formula) is tested against the page's example in tests/register-pages.test.cjs; add a country only with its lookup tool and a rule the test can check.
- `Product.upload` (lib/product-pages.ts) puts an upload form and curl example on a product page; the form posts multipart field `file` to `<tool>?trial=1` (the POST forwarder of lib/file-input.ts keeps the query string, so the capped browser try applies). The privacy page's "Uploaded PDF files" item must stay true to lib/file-input.ts: memory only, no store, cache or log.



## Indicators back to one cent (1.168.0, 14 Nov 2026)

- `INDICATORS_PRICE` (src/routes/hyperliquid.ts) is `$0.01` again. Evidence: 73 outside sales at $0.01 on 10-12 Nov, none in the day at $0.05; the finder buyer (0x4c29, daily ~02:05 UTC) left us out of its 14 Nov run and Mercator pays only its stored $0.01. The owner delegated prices on 14 Nov 2026 ("you decide prices"); the 26 Nov review is void.
- Lesson for any price step on a tool that real buyers use: Mercator refuses any quote above its stored price (see the 1.136.0 note), so a step up loses that buyer at once; read `/metrics/callers` challenged vs paid within an hour instead of waiting days.
- After the release: `node scripts/update-402index-prices.mjs --dry`, then for real.



## Product pages for the document toolkit (1.169.0, 14 Nov 2026)

- `PRODUCTS` (src/lib/product-pages.ts) gained `invoice-data-extraction-api` (tool /document/extract) and `document-to-text-api` (tool /document/text). Their code samples come from the tools' published examples, so the extraction page shows the calibre demo file, not an invoice: give those entries the upload form and an invoice sample once the `upload` option of 1.167.0 is on main. `guides` is empty on both: write task guides (TASK_GUIDES, with `secondary: true` where a tool already has one) and list their slugs.
- State of the document product on 14 Nov, 09:45: tools live in 1.166.0 (staging proof of /document/text paid; /document/extract and OCR proven only on a local run against Workers AI, never by a paid production call); n8n-nodes-agent-data-tools 0.3.0 published through the tag workflow; n8n-nodes-document-extract not published; free keys off; Make and Power Automate drafts wait for the domain.

