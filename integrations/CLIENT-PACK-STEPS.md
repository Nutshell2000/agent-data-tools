# Client pack: the steps

Two packages are built and nothing is published: the n8n node (`integrations/n8n`, npm name `n8n-nodes-agent-data-tools`) and the ClawHub skill with its bundle (`integrations/openclaw`). Each step below is marked **yours** (needs your account, your sign-in or your decision) or **mine** (I do it; where it pushes or publishes, only after you say go).

## Before anything goes out

| # | Who | Step |
|---|---|---|
| 0.1 | done 11 Nov | **Author e-mail decided: the support address stays.** n8n's linter refuses a package without an author e-mail, so `integrations/n8n/package.json` carries the service's public support address (the one already in `/openapi.json`). npm shows it on the package page. Tell me another address if you want one. |
| 0.2 | mine | **Release 1.129.0 must be live first.** The skill, the bundle and the n8n README point agents at `/mcp/compact`, which answers 404 today. |
| 0.3 | mine, after your go | Merge the branch `claude/client-pack` to `main`. |
| 0.4 | mine | Refresh the checks on the day: `npm test` and `npm run lint` in `integrations/n8n`; `node integrations/openclaw/check.cjs <fresh copy of /openapi.json>`. A price that changed on the service shows up here: then I update the README price list and the fixture first. |

## A. n8n node on npm

No new npm account is needed: the account that published `agent-data-tools` on 10 November owns this one too.

| # | Who | Step |
|---|---|---|
| A1 | yours | Sign in on this PC: `npm login` (browser, two-factor code), then `npm whoami` shows the account name. |
| A2 | yours | **First publish, 0.1.0**, from a checkout of `main`: |

```powershell
cd <checkout of main>\integrations\n8n
npm ci --ignore-scripts
npm test
$env:RELEASE_MODE = 'true'; npm publish; Remove-Item Env:RELEASE_MODE
```

`RELEASE_MODE` is what n8n's own release command sets; without it the package's `prepublishOnly` guard stops a plain `npm publish`. Do not run `npm run release` locally: it is the GitHub Actions path.

What happens after A2: `https://www.npmjs.com/package/n8n-nodes-agent-data-tools` exists at once, and anyone with a self-hosted n8n can install the node by that name under Settings > Community Nodes. It is an **unverified** community node: not installable on n8n Cloud and not in the nodes panel of other people's instances. This first version has no provenance statement, which is why the next three steps exist.

| # | Who | Step |
|---|---|---|
| A3 | yours | On npmjs.com: Packages > `n8n-nodes-agent-data-tools` > Settings > Trusted publishing > GitHub Actions. Organization or user `Nutshell2000`, Repository `agent-data-tools`, Workflow filename `publish-n8n-node.yml`, Environment name empty. Under Allowed actions make sure a direct `npm publish` is allowed. npm drops a new trusted publisher that is not used within 2 days, so tell me when it is saved. |
| A4 | mine, after your go | Set the version to 0.1.1, merge, and push the tag `n8n-node-0.1.1`. The workflow `.github/workflows/publish-n8n-node.yml` then lints, tests, builds and publishes 0.1.1 with a provenance statement. No secret is stored in the repository. |
| A5 | mine | Check it the way n8n does: `npx @n8n/scan-community-package n8n-nodes-agent-data-tools` must print that the package passed. |
| A6 | yours | **Submit for verification** at <https://creators.n8n.io/nodes>: sign up or log in (this is a new account, on n8n's creator portal) and submit the node by its npm name. The form is behind the sign-in, so I could not read its fields. n8n's documentation says a submission must: be published by GitHub Actions with provenance (A4), have no run-time dependencies, pass the scanner (A5), follow the UX guidelines, be MIT licensed, be in English, have a README, and have a public GitHub repository that matches the npm package. Reviews take up to four weeks and n8n writes by e-mail. |

Alternative to A2-A4 if you want no version without provenance: skip A2, create a granular npm access token (read and write, all packages, short expiry), store it as the repository secret `NPM_TOKEN` on GitHub, and I push the tag `n8n-node-0.1.0`. After that set the trusted publisher (A3) and delete the token and the secret.

## B. ClawHub (OpenClaw)

| # | Who | Step |
|---|---|---|
| B1 | mine | Install the CLI: `npm i -g clawhub` (needs Node 22.13 or newer). |
| B2 | yours | `clawhub login`. It prints a code and an address: open the address, sign in with GitHub, check that the code matches, press Authorize. Then `clawhub whoami` shows your handle. This is a sign-in with the existing GitHub account, not a new account. |
| B3 | yours, or mine after your go | **Publish the skill**, from a checkout of `main`: |

```powershell
cd <checkout of main>\integrations\openclaw
clawhub skill publish .\skill\agent-data-tools --slug agent-data-tools --name "Agent Data Tools" --categories research,integrations,finance --topics "web-search,x402,market-data,sanctions-screening,text-to-speech" --changelog "Initial release"
```

Add `--dry-run` to see what would be sent first. What happens after B3: ClawHub stores version 1.0.0 as pending and runs its automated security checks on it; when they pass, the skill is public in search and OpenClaw users install it with `openclaw skills install @<your handle>/agent-data-tools`. Everything published as a skill on ClawHub is licensed MIT-0. A later publish of changed content becomes the next patch version by itself; unchanged content is skipped.

| # | Who | Step |
|---|---|---|
| B4 | mine, then yours | **The bundle plugin, later.** It adds the compact MCP server and the same skill in one install. Before it goes out I test it in a real OpenClaw (`openclaw plugins install .\bundle`, then `openclaw plugins inspect agent-data-tools`), which I have not been able to do. Then: |

```powershell
clawhub package publish .\bundle --family bundle-plugin --bundle-format claude --name agent-data-tools --display-name "Agent Data Tools" --version 1.0.0 --wait
```

## After a price or tool change on the service

Mine: refresh `integrations/n8n/test/fixtures/tools.json`, update the README price list, run both check commands of step 0.4, publish a new patch version of the node (tag `n8n-node-<version>`) and republish the skill.
