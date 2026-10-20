# Draft post: what x402 listings get wrong (for dev.to and Peter's channels)

**Status:** draft.
- Fill each `{…}` from `node scripts/bazaar-quality-report.mjs --sample 300 --json survey.json`, run on the PC.
- Peter publishes it. Keep the claims to what the survey measured.
- Never name or shame individual sellers.

---

## Title

We scored {sampled} x402 sellers' payment quotes: {perfect}% pass every listing check

## Body

Coinbase's Bazaar lists {listedResources} paid endpoints from {listedHosts} sellers. Most of them earn nothing: in Tanod Labs' 9 October snapshot, half had at most one payer.

Buying agents only see what a seller's 402 answer tells them. So we asked every sampled seller for a price, without paying, and scored the answer the way a buyer would read it.

What we found, across {answered402} sellers that answered with a 402:

- **{noSchema}%** publish no output schema. An agent can't tell what it would get back for its money.
- **{noWhen}%** have a description that never says *when* to use the endpoint, and that is what agents match on.
- **{belowMin}%** quote an amount below the Coinbase facilitator minimum of 0.001 USDC. Those payments can't settle at all.
- **{noBazaar}%** omit the Bazaar discovery metadata, which is what describes their inputs to a searching agent.
- **{notPaywalled}** of the sampled listings no longer answer 402 at all.

**How we measured.**
- One unpaid GET per seller, one resource per host, sampled evenly across the listing on {surveyedAt}.
- Nothing was signed or paid.
- The checks are the open ones in our `/x402/check` tool: https resource URL, atomic amount, facilitator minimum, description, "use when" guidance, Bazaar metadata, output example and output schema.

**Check your own listing.**
- Call `/x402/check?url=<your endpoint>` on https://agent-data-tools.revmesh2074.workers.dev. It costs $0.003, never signs, and is also available as the `x402_check` MCP tool.
- The first 25 calls over MCP are free.

---

## Notes for Peter

- Post on dev.to with the tags `ai`, `agents`, `web3` and `api`.
- Cross-post to the x402 Discord or Telegram only if their rules allow self-promotion.
- The survey file `survey.json` stays private, outside Git: it contains other sellers' URLs.
