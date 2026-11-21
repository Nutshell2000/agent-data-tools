@AGENTS.md

# Working in this repository

This file is short on purpose. The operating notes for this service (release history, measurements, decisions and the
reasons behind them) are kept outside this public repository, in the operator's private notes and runbook. Before you
change a file, read the sections of those notes that concern it; write what the next person needs to know there, not
here. Nothing about buyers, income, wallets' owners, people or pending decisions belongs in this repository.

## Rules that hold for every change

- **Listings state only what the code does.** A tool's name, description, tags and published example may claim only the
  inputs, limits, sources and output fields its handler really has. An entry path (`src/routes/entry-paths.ts`) is written
  from its canonical tool's description, never from a search phrase alone. The published example is a real answer's shape.
- **After a tool, price or description change:** bump the pins with `node scripts/bump-version.mjs <version>`, run
  `npm run update:mcp-contract` last, then `npm test` and `npm run check:mcp-contract`.
- **Prices are the owner's decision.** Do not change a price, a path or an answer's shape of a tool that sells without it.
- **Never cache or reuse an MPP challenge:** a challenge pays once. The Tempo challenge stays first in `WWW-Authenticate`.
- **The quote front** (`src/front`, Worker `agent-data-tools`) holds the secrets and the public hosts; the full app is
  `agent-data-tools-core`. Never deploy `wrangler.jsonc` under the front's name. Deploy the front only when `src/front`
  changes. A paid tool whose path starts with a prefix in the front's `NEVER` list must be added to `TOOLS_UNDER_NEVER`.
- **A 402 quote's headers stay under 16 KB** (the default limit of common HTTP clients).
- **Unpaid probes must get a 402.** A path that is listed anywhere must not answer 5xx or 404 to an unpaid GET: routers
  count that against the whole service. Retire a path with a redirect to its successor where one exists.
- **Tables keyed by caller input are read with `Object.hasOwn`**, never with `in` or bare indexing.
- **Never keep a viem client at module level;** clients are per request.
- **No per-request Durable Object or KV writes for unpaid traffic.**
- **Test a new upstream from Cloudflare** (a staging deploy), not only from a local machine: several public sources
  refuse Cloudflare's egress.
- **The line `const result = await handler(env, normalizedInput(input));` in `src/tools.ts` stays verbatim;** a test
  patches it.
- **No personal names, private addresses, local paths or internal notes in tracked files.** Checks that guard against
  names read salted hashes from a file outside the repository (`ADT_PRIVATE_WORD_HASHES`); neither the words nor their
  hashes are tracked (`tests/company-pages.test.cjs`, `scripts/build-changelog.mjs`).

## Releasing

One release at a time, by one operator. `scripts/release.ps1` runs the whole release (bump, checks, pull request, CI,
merge, staging payment proofs, guarded production deploy, live check, quote warm-up, tag). Prefer one release that
carries several finished changes over several releases: every deploy of the core retires the quotes the front holds,
and `scripts/warm-quotes.mjs` has to refill them.
