# Sales baseline

Recorded 2026-10-18 19:07 UTC, right after release 1.23.0 (commit 413ae01) went live. Read-only figures from the live service; nothing was paid to produce them.

| Measure | Value | Source |
|---|---|---|
| Tools listed | 167 (Coinbase validator 167/167 ready) | /openapi.json, check:live |
| Settled payments since tracking began (2026-09-19) | 0 | /revenue |
| Distinct external paying wallets | 0 | /revenue |
| Calls served in the last 7 days (paid, marketplace or trial) | 43, 0 server errors | /status |
| Today's requests so far by outcome | challenged 6743, failed 41, marketplace 6, revenueUsdMicros 0, sample 1, trackedPaidCalls 0 | /metrics |
| Wallet history before tracking | 2 payments of 0.002 USDC (/btc-fees, 12 and 14 Oct 2026) | Base chain |

Directories at this point: x402scan lists 167 of 167 resources; MCP Registry v1.23.0 published by the tag workflow; 402 Index registration of the family tools in progress (10 per hour); RapidAPI Everyday Data API carries 134 tools; AgentCash discovery 1.7.5 passes every check.

Compare future readings with this table. Self-payments, tests and readiness checks are not demand.
## Reading the scorecard (added 2026-10-19)

Run these after each deploy and every Monday; add a dated row per reading below.

- `GET /revenue`: x402 settlements, external paying wallets and the funnel. With
  `Authorization: Bearer <REVENUE_TOKEN>` (Worker secret, `npx wrangler secret put REVENUE_TOKEN`) it also
  returns `cardCredits`: purchases, buyers, USD bought and spent, credit calls, purchases per day. Subtract
  any purchases the owner made to test.
- `GET /metrics/callers`: requests per day by calling software (`x402scan`, `python-requests`, `browser`,
  `rapidapi`, `none`…) and outcome. Use it to separate directory crawlers and validators from agents that
  get a 402 quote and leave. Only the software name is stored.
- `GET /metrics`: per tool per day by outcome (challenged, paid, credits, trial = free call, marketplace…).
- Free calls are not revenue; readiness checks, tests and the owner's own calls are not demand.

| Date | x402 settlements | Card purchases (USD) | Paying customers | Free calls used | Top 402 callers |
|---|---|---|---|---|---|
| 2026-10-18 | 0 | n/a (not measured) | 0 | n/a | n/a (not measured) |
