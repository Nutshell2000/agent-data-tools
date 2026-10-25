@AGENTS.md

## Where things stand (2026-10-18)

- Production runs 1.23.0 (167 tools, commit 413ae01), deployed 2026-10-18 ~19:00 UTC by the local
  Claude Code session through the guard. check:live 167/167, AgentCash discovery 1.7.5 all checks true,
  x402scan lists 167/167, tag v1.23.0 published to the MCP Registry. Baseline: docs/sales-baseline.md.
- Deploys need Cloudflare access, which only Peter's PC has: prepare PRs and a runbook here, and the
  local session deploys with `npm run deploy:production -- --expected-version <live uuid>`.
- Sales plan: flagship tools /check/counterparty and /extract/rendered, free ?sample=1 previews,
  readable 402 bodies, MCP bundles at /mcp/<section>. Directory copy: docs/listings.md.
- OFAC mirror release `ofac-latest` is published by .github/workflows/ofac-mirror.yml.
- Ownership proof is live (PR #84, deployed 2026-10-18): Coinbase Wallet ERC-1271 signature in
  OWNERSHIP_PROOFS, verified on Base by `npm run check:ownership` in CI. AgentCash discovery reports
  trustTier ownership_verified; x402scan re-registered 167/167.
- Pending on Peter: directory submissions, revoking the Cloudflare token pasted in chat.
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
- Secrets (Peter sets them with `npx wrangler secret put <NAME>`; never in chat or Git):

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
- Waiting on Peter: should the 26 tools still at $0.002 (`/extract`, AI text, fx, weather…) move to
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
  any of this was deployed (Peter confirmed it was not him); watch `wrangler tail` for the next one.
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
  check) unless Peter decides otherwise.
- Decisions that stay with Peter (not code): Bazaar seeding (one self-settled call per tool through the CDP
  facilitator; the ledger marks self-payments, Peter's rule currently forbids it), app-directory submissions
  (`docs/app-directory-submission.md`), and whether the 19 Oct browser payment attempts on `/eth/gas` were
  his own tests.

## Per-call MPP on the tools: evm on Base ON (1.36.0), Tempo ON (1.37.0)

- `src/lib/mpp-evm.ts` (on by default, `MPP_EVM` in `wrangler.jsonc`): each tool's 402 also offers `WWW-Authenticate: Payment`
  evm/charge, an EIP-3009 USDC authorization on our x402 network to PAY_TO, verified and settled through the same facilitator
  as x402 (settle only after the tool succeeded, Bazaar extension sent with the settlement, receipt in the ledger). It exists
  so MPPScan lists the 175 tools without a first settled payment, at no cost. Staging proof after every release:
  `node scripts/pay-test.mjs <staging>/time?zone=UTC --mpp-evm`. After deploying, re-register the origin at mppscan.com/register.
- Tempo proof on staging (Moderato testnet, faucet pathUSD via `tempo_fundAddress`): `node scripts/pay-test.mjs <staging>/time?zone=UTC --tempo`
  settled on 2026-10-20 (tx 0xb3c18072…). Staging has `TEMPO_NETWORK=testnet` and a test-only `TEMPO_PAY_TO`; production stays off.
- `src/lib/mpp-tempo.ts`: a second challenge, tempo/charge (USDC.e on Tempo mainnet, pull mode, public RPC rpc.tempo.xyz),
  broadcast only after the tool succeeded. ON since 1.37.0: `TEMPO_PAY_TO` = PAY_TO in `wrangler.jsonc`, Peter's decision of
  2026-10-20 (option A, docs/mpp-per-call.md). Empty switches it off. MPP buyers (AgentCash, Poncho, MPP credits) pay on Tempo,
  so this is the method that serves them; watch `wrangler tail` for `mpp tempo` lines and the Tempo RPC (`facilitator_unavailable`).
- Credit packs `/credits/buy/*` answer GET only, and their Stripe challenge names a recipient (the MPPScan warnings).

## Discovery files (1.36.1)

- `/discovery/resources` (src/lib/discovery-index.ts) is our own Bazaar-shaped index of every tool with exact USDC terms per network, paged (`limit` up to 500, `offset`); `/.well-known/x402.json` aliases `/.well-known/x402`. Directories that crawl sellers directly read these; the Coinbase Bazaar still needs a first settled payment per tool.
- Directory PRs opened 2026-10-20: tempoxyz/mpp#1095 (mpp.dev services, 38 routes, evm/charge) and Pazificateur69/gold-402#1. Circle Agent Marketplace form (forms.gle/7YFzvdmMcn1JH5tF6) is Peter's to send (indemnification clause).

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

## First-payment readiness (2026-10-20, Peter: no self-funded seeding yet, no Solana)

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
  (unpaid GETs only; keep survey.json out of Git), fill docs/bazaar-quality-post.md, Peter publishes.
- Not built, on purpose: GDELT news and Stooq quote tools (both timed out from Cloudflare on 20 Oct; an
  unreliable upstream is a lost first payment). Web search stays parked until Peter picks a paid key.

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
lists them and the sitemap carries them all. The tool URLs themselves stay 402 (not indexable). Google: Peter
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

Tests: tests/outage-resilience.test.cjs, tests/report-outage.test.cjs. The lasting fix is the Workers Paid plan ($5 a month), which raises the Durable Object limits. That is Peter's decision.

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

## New tools (1.44.0, 179 tools; Peter approved on 2026-10-20)

- **`/sec/filings`** (src/routes/gov-data.ts): SEC EDGAR filings by ticker or CIK, optionally one form type.
  - The data is public information under sec.gov's privacy notice.
  - SEC's fair-access policy requires a User-Agent naming a contact; ours names the public support address. Keep requests under 10 a second.
  - The 800 KB ticker map is cached for a day at the edge, and submissions for 10 minutes.
  - Before relying on it, check from staging that SEC does not block Cloudflare's egress IPs.
- **`/airport/status`** (gov-data.ts): FAA's live National Airspace System status (US federal work) for one IATA code, or for the whole country.
  - The XML is parsed with small regexes, because Workers have no DOMParser.
  - Cached 60 s.
- **`/hyperliquid/market`** (src/routes/hyperliquid.ts): perpetuals price, hourly funding rate and its APR, open interest and 24 h volume, for one coin or the top 20.
  - The terms of Hyperliquid's public info API say nothing about resale; Peter approved it anyway.
  - Snapshots are kept 15 s as plain module data (never a shared promise), because of the 1,200-weight-a-minute limit per IP.
- **Demand:** competitors with the same data had 29 (EDGAR), 23 (FAA) and 56/48 (Hyperliquid) paying bots on the Bazaar.
- **Rejected on their terms:** Chainlink feeds (ToS §3 forbids resale), Polymarket (no market data distributors) and DefiLlama (non-commercial). The Treasury yield curve is too slow (18 s).
- **After deploying:** register the three paths with 402 Index (`scripts/register-402index.mjs`), re-run `npx agentcash register`, and add them to the Ultravioleta registry.

## Base Builder Code (PR #203)

- Every x402 v2 route, `/buy/*` purchase, MCP payment and MPP evm settlement declares the `builder-code` extension (ERC-8021) with app code `bc_09e30bdm` (`BUILDER_APP_CODE` in src/lib/bazaar-extension.ts). The facilitator appends the CBOR suffix plus the `8021…8021` marker to the settlement calldata. This was proven on Base Sepolia on 2026-10-21: txs 0xf75a6618… (v2) and 0x192f6f1b… (MCP) both end with `a161616b62635f303965333062646d…80218021`. x402 v1 has no extensions and carries no code.
- Why: the Base Builder Grants (up to $5,000, "x402 implementations") require Builder Codes. The application draft is `C:\MoneyWallet\x402-launch\base-grant-application.md`; Peter submits it.

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
  carry two phrases ("Crypto price and token price"), within 32 characters. The Bazaar takes a new name only with the tool's next settlement: Peter runs
  `C:\MoneyWallet\Refresh Bazaar names.cmd` (it computes the renamed and unlisted tools itself via
  `business/agentic/tools/bazaar-rename-diff.mjs`).
- **Related tools (1.47.15):** every GET tool quote or answer carries three `Link: …; rel="related"` headers
  (`src/lib/related.ts`: same section first, then `salesOrdered`); the readable 402 body has a `related` list. Tool
  output bodies are unchanged. `TOOL_SEO` covers 109 tools; copy may only restate the tool's own description.
- **Networks (1.47.13):** quotes list Base, Polygon, Arbitrum and Solana (SOLANA_PAY_TO = Peter's Phantom wallet, whose
  USDC account exists). Monad and World Chain were dropped (never paid). Dexter's verifier still refuses to pay us with
  "could not settle on a chain this route accepts" and never sends a payment; it says the fault is on its side.

## Web search ON (1.49.0, 22 Oct 2026, Peter: "I approve")

- `/search` ($0.01, src/routes/search.ts) is live: one Brave Search API request per paid call, key in the secret `SEARCH_API_KEY`
  (production and staging, set 22 Oct; never in Git or chat). 182 tools.
- Terms basis (api-dashboard.search.brave.com/terms-of-service, 1 Sep 2026): §3(a) licenses showing Search Results to the end users
  of a Customer Application; §4(c) wants those end users bound by the §3(b) duties, so the description and every answer carry
  `terms` (immediate use only, no storing, no resale, no model training); §3(b)(i) allows only transient storage, so nothing
  about results is cached or logged. §3(b)(xii) ("redistribute, resell") is the clause Peter accepted the risk on; the worst
  case is Brave closing the API account on 10 days' notice. Nobody contacts Brave on Peter's behalf.
- Spend: Brave bills $5 per 1,000 from prepaid credits with free credits each month; `SEARCH_DAILY_CAP=120` (wrangler.jsonc)
  keeps a month under about $18. Over the cap, or when the credits are gone, the tool answers 503 uncharged. `/search` is
  capacity-limited (no free calls) and first in `SALES_FIRST` after the payee checks; the Bazaar lists it after Peter's next
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
  ours is $0.01 since 22 Oct. Price is Peter's call; the daily report now lists the most-used resources.
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
  Listing is Peter's FluxA account; why: one FluxA buyer wallet paid 1,165 FluxA-listed sellers in 7 days (base-bots analysis).
- FluxA lists us as one catch-all endpoint `/` at $0.01, so only tools priced at most $0.01 pass its proxy unpaid; dearer
  tools (/package-audit, /trade-insight, /mev-simulator, the $0.02-0.03 risk checks) answer the normal 402, which FluxA's
  proxy returns to its buyer uncharged (tests/payment-delivery-runtime.test.cjs).

## Price move to $0.01 (22 Oct 2026, Peter)

- Peter decided on 22 Oct to raise the common price from $0.003 to $0.01: every buyer bot traced pays $0.01 or more (buyer 0xec2a…6d034: 150 calls at $0.01 to one seller; bot C $0.03; bot A $0.01-0.05), and Bazaar search position ignores price.
- `PRICE` (src/family.ts), `AI_PRICE` (src/routes/ai-text.ts), `ORDINARY_PRICE` and every explicit `"$0.003"` entry are now `$0.01`. Unchanged: the $0.002 entry tools (/extract, /btc-fees, /sitemap, /package, /base-gas, /base-allowance), the $0.005 and higher tools, and **/base-tx at $0.003**, which the published capped chain client (clients/chain, docs/chain-checks.md) promises.
- tests/fixtures/price-freeze.json was regenerated at the new prices (freeze again until 8 Nov). Copy that quotes call counts uses $0.01 ($5 = 5,000 credits, about 500 calls).
- The Bazaar shows each tool's last settled price until it sells again: Peter's `Refresh Bazaar names.cmd` can re-pay the repriced listings once (about $1.60). Run `scripts/update-402index-prices.mjs --dry` then for real after the deploy (the release train does not).

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
  guessing why a tool fails: Workers Logs need a token with log read access that only Peter can create.
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
  funwords.eu apex answered 429/1027 until 00:00 UTC. One release a day until Workers Paid (Peter's decision).
- Fourth batch (same release): `SCHEMELESS_URL` in src/tools.ts `normalizedInput` prepends https:// to any `url` input without a scheme; `coinKey()`/`intervalKey()` in hyperliquid.ts (names, pair suffixes, k-prefixed markets); `secCompanyMatch()` in gov-data.ts (ticker, then title); `quakeFeed()` in public-data.ts (largest USGS feed at or below the requested magnitude, then filter); markdown tables and task lists in `markdownToHtml`; `/text/extract` blanks dates, hex, URLs and e-mails before reading phones and numbers; `slugify` falls back to Unicode letters.
- Inference and media first (24 Oct, market income by seller: dTelecom STT/TTS $36k, KORUS $22k, Venice and BlockRun
  inference; one-call utilities earn cents): `SALES_FIRST` opens with /ai/chat, /ai/chat-large, /ai/embed, /transcribe,
  /ai/speech, /image, /describe, /search, /news; `PICK_BY_TASK` (credit-routes.ts), the MCP summary and the OpenAPI
  `GUIDANCE` (endpoints.ts) lead with them too. Names: "LLM chat completions, inference", "LLM inference, large model",
  "Speech to text, transcribe audio", "Image generation, generate image". tests/discovery-index and discovery-order pin
  the new head.
- Spend caps: `takeDailyBudget()` in src/lib/daily-cap.ts (KV `cap:<kind>:<day>`), used by `runAi` (AI_DAILY_CAP, default 1000) and `withBrowserPage` (BROWSER_DAILY_CAP, default 60); both in wrangler.jsonc. Peter (24 Oct): Workers Paid only after $5 earned; remind him at $10 external income (the daily report prints it).
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
- **Every tool is at most $0.01 (Peter, 25 Oct).** Measured from /revenue byEndpoint against catalog prices: the sweeper
  0xec2a…d034 pays every listed tool at or below $0.01 and none above (253/254 vs 0/21 at $0.02). The 32 dearer tools
  (all packs, the risk checks, media, /package-audit) are $0.01. `scripts/freeze-prices.mjs "<decision>"` regenerates
  tests/fixtures/price-freeze.json (now all 302 paths) and appends the decision to its note. FluxA's catch-all passes
  every tool now. After a price release: `update-402index-prices.mjs --dry` then real; Bazaar shows new prices after the
  next settlement per tool (Refresh).
- **$1 credit pack (25 Oct):** `CREDIT_PACKS` gained `{ usdCents: 100, credits: 1_000, url: "" }`; `WEB_PACKS` (packs with a
  Stripe link) drives browsers, 402/MCP hints and top-ups, `CREDIT_PACKS` drives MPP (`/credits/buy/1` works now). Peter's
  step: create the $1.00 payment link (metadata adt_credits=1000, success URL /credits/claim?session_id={CHECKOUT_SESSION_ID})
  and paste its URL; then the hints switch to $1 by themselves (first WEB_PACKS entry). Per-call card payments are
  impossible (Stripe $0.50 minimum); do not add a stripe method to tool 402s (Tempo must stay the first challenge, and a
  challenge amount other than the tool price confuses validators).
- The release train's chaining script and notes live in `%LOCALAPPDATA%\agent-data-tools\release\train\` (the session
  scratchpad was wiped at the day change on 25 Oct and took the queued 1.68.0 train with it).

