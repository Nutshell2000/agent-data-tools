## Payments diagnosis: where paid attempts die, per route (16 Nov 2026, cloud session, branch cloud/20261116-payments-diagnosis)

### 1. `scripts/reconcile-bazaar.mjs` (new, read-only)

- One plain GET each of `/revenue`, `/metrics`, `/metrics/callers`, `/status` (or `--from-files <dir>` for saved bodies; `--save-inputs <dir>` keeps them). It never sends a payment header, never calls a tool, never reads the environment. `--revenue-token` / `--token-file` goes to `/revenue` only, over https only, and is never printed or saved. Other flags: `--days N`, `--json out.json`, `--all-routes`, `--settlements <file>`. The header of the script explains every column.
- Functions: `buildReport` (the arithmetic), `walletReport` (own and outside wallets), `ownWallets` (parses `OWNED_WALLETS` from src/lib/settlement-ledger.ts, `PREVIOUS_PAY_TO` from src/lib/payout-wallets.ts and `PAY_TO` / `TEMPO_PAY_TO` / `SOLANA_PAY_TO` from wrangler.jsonc; no address is typed in the script), `renderText`, `fetchReports`.
- Test: `scripts/reconcile-bazaar.test.mjs` (7 tests, run by `npm test`) on tests/fixtures/reconcile-bazaar (invented figures and addresses): per-route arithmetic, the ledger identity, a shorter window, missing bodies print n/a, own-wallet tagging, the 5-calls-on-2-days boundaries, the command end to end, and that live mode is four GETs with the token on `/revenue` only.

**Columns that are real counts** (read from a report body, or a difference of two such counts):

| column | source |
| --- | --- |
| attempts | `/revenue` funnel stage `attempt` (http + mcp) |
| 402:v2, 402:v1, 402:mpp | `/metrics` outcomes `v2_payment`, `v1_payment`, `mpp_payment`: payment-carrying requests answered 402, by protocol |
| verified, settled, completed, exec_failed | funnel stages of the same names (`verified` is recorded directly, not inferred) |
| lost | attempts - settled |
| refusal stages | funnel `refused_amount`, `refused_network`, `refused_format`, `facilitator_unavailable`, `verification_failed`, `settlement_failed` |
| outside, outside_usd | `/revenue` ledger `byEndpoint` (self-payments are left out by the ledger) |
| own/unledg | settled - outside; the total is checked against the ledger's `selfPayments` |
| /status lines | `paymentRefusals`, and `topFailures` ending in `[sent …]` (7 days, top six per tool) |
| calling software | `/metrics/callers` (`paid` and the three refused outcomes per software family) |

**Columns that print "n/a"**, and why:

- **Protocol of a served payment**: not recorded anywhere. Only attempts answered 402 carry the protocol.
- **outside / outside_usd / own with `--days` shorter than 30**: the ledger publishes one 30-day total.
- **Per-wallet rows (the own-wallet list and "outside wallets with 5 or more paid calls on 2 or more UTC days")**: no report route returns payer wallets, with or without `REVENUE_TOKEN` (the token adds `cardCredits` only; `ledgerSummary` publishes the counts `distinctExternalWallets`, `returningOnAnotherUtcDay`, `repeatPayerToolPairs`). The script computes both lists from per-payment rows the owner supplies: `--settlements <file>` or `settlements.json` beside the saved bodies, a JSON array of `{ payer, recordedAt, amountAtomic, path?, recipient?, selfPayment? }` (the Worker's `SettlementRecord` fields; an on-chain export of USDC transfers to the payout wallets fits, without `path`). Tested on fixtures only: **no real wallet list was produced in this session.**

**Real output, live report routes, fetched once on 16 Nov 2026 about 11:30 UTC** (bodies kept out of git, in /workspace/scratch/payments-diagnosis/live; no wallet address appears because the routes publish none):

```
Paid attempts per route, https://agent-data-tools.revmesh2074.workers.dev (from the saved bodies)
Window: 2026-10-18 to 2026-11-16 UTC (30 days of data).

route                    attempts  402:v2  402:v1  402:mpp  verified  settled  completed  exec_failed  lost  outside  outside_usd  own/unledg
/weather/forecast             171       5      15        0       151      151        151            0    20      145        0.292           6
    refusal stages: refused_format 15, verification_failed 5
    /status payment refused: 15 x "402 only xN version N <value> payments are accepted in X-PAYMENT; version N clients use PAYMENT-SIGNATUR"
    /status payment refused: 5 x "402 insufficient_funds: contract call failed: unable to call contract: execution reverted"
/weather                       88       3       0        0        85       75         75           10    13       68        0.152           7
    refusal stages: facilitator_unavailable 1, verification_failed 2
    /status paid call refused for its input: 1 x "400 send city (for example city=London) or lat and lon (for example lat=<name>&lon=<name>) [sent nothing]"
/time                          17       6       2        0         9        9          9            0     8        2         0.02           7
    refusal stages: refused_network 1, refused_format 3, facilitator_unavailable 2, verification_failed 2
/describe                      33       0       0        0        33       27         27            6     6       22         0.22           5
/extract                       27       0       0        0        27       21         21            6     6       14        0.028           7
/eth/gas                       16       0       6        0        10       10         10            0     6        1         0.01           9
    refusal stages: verification_failed 2
    record gaps: no verify outcome recorded 4
/pdf/text                      14       0       0        0        14        9          9            5     5        4         0.02           5
/contents                      13       4       1        0         9        8          8            0     5        2         0.02           6
    refusal stages: refused_network 1, refused_format 3, verification_failed 1, settlement_failed 1
    record gaps: refusal also counted on a verified payment 1
/ai/chat                       42       3       0        0        42       38         38            1     4       10        0.028          28
    refusal stages: refused_format 3, settlement_failed 3
    record gaps: refusal also counted on a verified payment 3
/btc-fees                      13       2       0        0        11        9          9            2     4        5         0.01           4
    refusal stages: facilitator_unavailable 1, verification_failed 1
/crypto/price                  10       1       0        0         9        6          6            3     4        3        0.006           3
    refusal stages: verification_failed 1
    /status payment refused: 1 x "402 insufficient_funds: contract call failed: unable to call contract: execution reverted"
/price/token                   17       2       1        0        14       13         13            1     4        2        0.012          11
… (routes with fewer lost attempts cut here; the full table is the script's output)
TOTAL (every route)          4341      53      29        0      4270     4190       4179           69   151     1027        7.001        3163
(666 more routes lost nothing: every paid attempt settled, 420 of them with outside settlements. --all-routes or --json lists them.)
Protocol of served payments: n/a (not recorded; the reports record the protocol only for attempts answered 402).
/status lines cover its own 7 days and the top six reasons per tool.

Totals
  attempts 4341 (of which MCP 0), verified 4270, settled 4190, completed 4179, execution_failed 69, lost 151
  refusal stages: refused_network 4, refused_format 41, facilitator_unavailable 4, verification_failed 29, settlement_failed 11
  answered 402 to a payment, by protocol: x402 v2 53, x402 v1 29, MPP 0
  /metrics paid calls at the tool's price, every wallet (own included): 4189 calls, $35.897
  settled 4190 = outside wallets 1027 ($7.001) + own wallets 3163 (self-payments, not income) + unaccounted 0
  outside wallets since 2026-10-18: 75 distinct, 25 paid on more than one UTC day, 60 wallet-and-tool pairs repeated on another day (counts only; the route publishes no addresses)

Calling software with a payment served or refused (/metrics/callers, software names only)
  software                 paid  402:v2  402:v1  402:mpp
  other                    2568      27      21        0
  browser                     0       8       6        0
  node                       54       8       0        0
  lumiere-paycheck-prober   491       6       0        0
  none                      216       3       0        0
  spellzcode-diagnostic       0       0       2        0
  go-http-client              0       1       0        0
  agent-data-tools-seed     734       0       0        0
  zero-sdk                   64       0       0        0
  mercator-gateway           30       0       0        0
  vet402-observatory-l1      13       0       0        0
  python-requests             4       0       0        0
  agents-trust-delivery       4       0       0        0
  alalanet-prober             3       0       0        0
  python-httpx                3       0       0        0
  axios                       3       0       0        0
  tenjin-cli                  1       0       0        0
  settledscout                1       0       0        0

Own wallets (self-payments, kept out of every outside figure)
  n/a (needs --settlements: no report route returns payer wallets, with or without the revenue token)
  count only: 3163 self-payments since 2026-10-18 (/revenue selfPayments)

Outside wallets with 5 or more paid calls on 2 or more distinct UTC days
  n/a (needs --settlements: no report route returns payer wallets, with or without the revenue token)
```

What the run shows:

- Of 4,341 paid attempts in 30 days, 3,163 settlements were the owner's own wallets (seeding) and 1,027 came from outside wallets, $7.001. `/metrics` `revenueUsdMicros` ($35.897) counts both, so it is not income.
- 151 attempts did not settle: 69 `execution_failed` (verified, then the tool refused: the lost sales), 29 `verification_failed` (mostly `insufficient_funds`), 41 `refused_format`, 11 `settlement_failed`, 4 `refused_network`, 4 `facilitator_unavailable`.
- `/weather/forecast` lost the most (20, all in the last 7 days): 15 are `X-PAYMENT` headers that did not hold an x402 v1 exact payment (the refusal text is "only x402 version 1 exact payments are accepted in X-PAYMENT; version 2 clients use PAYMENT-SIGNATURE", so most likely a v2 payload in the v1 header: inferred from the message, not seen in a log), 5 are wallets without funds. It is the largest single cause in the week and was outside this item.
- **Counting defect found (not fixed here):** a v2 payment whose settlement fails is answered 402, and the "signed v2 request answered 402" block in src/index.ts marks that answer `refused_*` as well (it skips only `verification_failed` and `facilitator_unavailable`). All 11 `settlement_failed` in the window are also counted as a refusal, so the `refused_*` stages (45 in all) overstate by 11. The script prints it per route as "refusal also counted on a verified payment". Fix: also skip when the trace has `settlement_failed` (or `verified`).
- `/hyperliquid/indicators` shows "settled, not completed 10" on 10 Nov; `/metrics` counts all of them as paid with a receipt, so they were delivered (the known gap: `completed` did not count v1 payments before 10 Nov 09:15 UTC).

### 2. `/price/token`: `address` is an alternative to `symbol` (also `/token/price`, `/price/crypto`)

What was wrong: the Bazaar listing said `required: ["symbol"]`, so a planner could not send an address alone; and the listing, OpenAPI and MCP `tool_details` each gave BOTH inputs an example value (symbol ETH, address cbBTC). A planner that fills every input from its example sent both, the tool reads the address first, and the buyer was charged for the price of cbBTC. Also `symbol=ETH&address=` (a form with the address left blank) was a 400.

- src/routes/prices.ts: `symbol` says "Send symbol or address, one of the two"; `address` says "sent instead of symbol (when both are sent, the address is priced)", names WETH on Base in words and has `example: ""` (the `/extract` `section` convention: no value to fill in). The handler treats an input sent empty as not sent. The doors share these params.
- src/lib/bazaar-extension.ts: `EITHER_INPUT` (three paths) makes `requiredInputs` return `[]` and adds `anyOf: [{required:["symbol"]},{required:["address"]}]` to the listing's input schema (one hunk above `requiredInputs`, one changed line in `bazaarExtensionFor`). The published example stays `symbol=ETH`. OpenAPI and MCP already marked neither required; MCP gets no `anyOf` (some clients refuse it at the top of a tool schema).
- A call with neither is unchanged: BTC with a note over HTTP (`EMPTY_CALL_DEFAULTS`), the 400 over MCP.
- Tests: tests/price-token-either-1116.test.cjs (new: listing, OpenAPI, MCP shape, either input alone, blank other input, both sent prices the address). Pins updated: tests/buyer-inputs.test.cjs (an `EITHER_INPUT` tool must be one-of, list no required input, and be in `EMPTY_CALL_DEFAULTS`) and tests/buyer-fixes-1111.test.cjs (a required input, or its alternatives).
- Decision the owner should know: a router that reads only `required` now plans `{}` for these three tools and gets BTC with the note (a 200), where it used to plan `symbol=ETH`. That is why `EITHER_INPUT` is allowed only for tools in `EMPTY_CALL_DEFAULTS`. The comment on `EMPTY_CALL_DEFAULTS` in src/tools.ts ("a listing still names the input") was not edited. The `address` input no longer carries a `pattern` in the listing (it was derived from the example).
- `/price/tokens` (symbols or addresses) has the same shape and was left alone.

### 3. Aliases on the five most-failed routes: none added, because the data shows no wrong names

Ranked by paid attempts that did not settle, `/status` window (10-16 Nov), from the funnel:

| route | lost | what the data shows | alias |
| --- | --- | --- | --- |
| /weather/forecast | 20 | `paymentRefusals`: 15 x v2 payload in X-PAYMENT, 5 x insufficient_funds. No input involved | none |
| /describe | 5 | `topFailures`: 422 site refused access (2), 422 page not found (2), 415 not an image (1). Outside sources | none |
| /pdf/text | 5 | 502/504/422 on the target file; "400 missing required query parameter: url" (3) carries no `[sent …]`, so those callers did not pay | none |
| /stock/quote | 2 | 422 unknown ticker (1), 502 data source timeout (1) | none |
| /weather | 1 | `400 send city … [sent nothing]` (1): nothing was sent, and the tool has answered an empty call for London since 1.109.3 | none |

Fifth place is a ten-way tie at 1: `/weather` is listed because it is the only one refused for its input; eight others are one `verification_failed` each (funds or payload) and `/extract` is one failure on the target page. The only `[sent …]` line in the whole live `/status` body is that `/weather` one. `/status` keeps six reasons per tool, so a seventh on `/pdf/text` (140 buyer errors, 23 explained) could not be seen. `INPUT_ALIASES` is unchanged.

### For the owner / release train

- `npm run check:mcp-contract` fails on this branch ("MCP contract changed: price_crypto"; the two other tools follow) because the input descriptions changed, and `update:mcp-contract` refuses to run until `server.json` is bumped. After `scripts/bump-version.mjs`, run `npm run update:mcp-contract`, then the check.
- The Bazaar takes the new `/price/token` schema with the tool's next settlement. On staging, confirm that a settled call still lists (the schema now carries `anyOf`); if a directory rejects it, remove the three paths from `EITHER_INPUT` and the listing is as before.
- To get the wallet list: export per-payment rows and pass `--settlements`. A token-gated export from the Worker (the `settlement:receipt:` records) would make this one command; it was not built because it changes what the Worker discloses.
- Not run here: the full `npm test` (the lead agent runs it), `smoke-examples.mjs --all-params` for the price tools (needs the live RPC).
