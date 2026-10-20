# Directory pull requests: follow-ups for the local session

Pull requests to other repositories can only be edited from Peter's GitHub login (the cloud session cannot
fork or push there). Run these from Peter's PC.

## tempoxyz/mpp#1095 (mpp.dev services)

**Done 2026-10-20 (PC session):** template applied with `gh pr edit` (tool count 176) and the tempo patch pushed to Nutshell2000/mpp `agent-data-tools` (commit 6fc8191), after checking that live 402s offer `method="tempo"`. Nothing left to do unless the maintainers ask.

Status 2026-10-20: CI ran on the fork without a result shown; the github-actions bot asks to "Complete the
service pull request template in your PR description before review", so review has not started.

1. Fill in the template: `gh pr edit 1095 -R tempoxyz/mpp --body-file docs/directory-prs/mpp-1095-body.md`
2. Add the tempo method (production takes tempo/charge since 1.37.0; 127 of the directory's services list
   `TEMPO_PAYMENT`, and MPP buyers such as AgentCash pay on Tempo, so evm-only hides us from most of them):

   ```sh
   gh pr checkout 1095 -R tempoxyz/mpp   # inside a clone of tempoxyz/mpp
   git am /path/to/agent-data-tools/docs/directory-prs/mpp-1095-tempo.patch
   git push
   ```

   The patch changes one line: `payments: [TEMPO_PAYMENT, { method: "evm", currency: usdc(8453).address, decimals: 6 }]`.
   Our live Tempo currency (`src/lib/networks.ts` TEMPO_STABLECOIN, chain 4217) equals their `USDCe`.

## Others (no action needed on 2026-10-20)

- punkpeye/awesome-remote-mcp-servers#2339: check "Check Submission" passed, labels endpoint-ok and
  has-connector, waiting on maintainers.
- xpaysh/awesome-x402#1829 and Pazificateur69/gold-402#1: no review yet, no failing checks.
