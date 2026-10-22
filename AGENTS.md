# Production operations

This repository serves the existing `agent-data-tools` Cloudflare Worker.

- Use a clean isolated checkout containing current `origin/main` for production. Preserve concurrent and uncommitted work in other checkouts.
- Deploy using `npm run deploy:production -- --expected-version <currently-deployed-worker-version-uuid>`. Use `--check-only` to inspect readiness without deploying. Read the current version with `wrangler deployments list` first.
- The guard requires clean-install CI for the exact source commit and refuses a changed production baseline. It is not an atomic Cloudflare lock. Coordinate a single production operator; other tools must not bypass it with a direct deploy or rollback from an older checkout.
- Keep previous immutable downloads and existing paid-order assets available. Private assets, credentials and operating evidence must stay outside public Git.
- Free calls are on by the owner's decision (Peter, 2026-10-19): 25 successful calls per caller, 2,000 a day in total, capacity-limited tools excluded (`src/lib/free-calls.ts`). Keep plain unpaid HTTP requests answering 402 and the approved price floor intact. Free calls are not revenue. Never count readiness checks, tests, free calls or anonymous traffic as customer demand.
- Bazaar seeding is allowed by the owner's decision (Peter, 2026-10-19; funded from his own Binance USDC on 2026-10-22) and only as `docs/bazaar-seeding.md` describes: Peter runs `scripts/seed-bazaar.mjs` himself (or `C:\MoneyWallet\Seed Bazaar listings.cmd`) with the buyer wallet listed in `OWNED_WALLETS`, so the settlements are self-payments, excluded from `/revenue` and never counted as demand. Each tool is paid at most once. No other self-payments, and no payments by agents.
- Verify live buying instructions, prices, free quotes and the receipt endpoint after deployment. Funded HTTP and MCP delivery require separate customer evidence.
