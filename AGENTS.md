# Production operations

This repository serves the existing `agent-data-tools` Cloudflare Worker.

- Use a clean isolated checkout containing current `origin/main` for production. Preserve concurrent and uncommitted work in other checkouts.
- Deploy using `npm run deploy:production -- --expected-version <currently-deployed-worker-version-uuid>`. Use `--check-only` to inspect readiness without deploying. Read the current version with `wrangler deployments list` first.
- The guard requires clean-install CI for the exact source commit and refuses a changed production baseline. It is not an atomic Cloudflare lock. Coordinate a single production operator; other tools must not bypass it with a direct deploy or rollback from an older checkout.
- Keep previous immutable downloads and existing paid-order assets available. Private assets, credentials and operating evidence must stay outside public Git.
- Keep trials disabled and the approved price floor intact. Never seed purchases or count readiness checks, tests or anonymous traffic as customer demand.
- Verify live buying instructions, prices, free quotes and the receipt endpoint after deployment. Funded HTTP and MCP delivery require separate customer evidence.
