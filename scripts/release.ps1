<#
.SYNOPSIS
  Headless release train for the agent-data-tools Worker: bump pins, test, PR, CI, merge, staging proofs, guarded
  production deploy, live checks, tag (MCP Registry republish), IndexNow, and once-a-day directory registrations.

.DESCRIPTION
  Run on a branch that already holds the change, from the worktree root:
    pwsh scripts/release.ps1 -Version 1.48.0 -MessageFile notes.md [-ProofPath /weather?city=London] [-Dry] [-Resume]
  -MessageFile is the commit message and PR body (first line = title); it must end with the Co-Authored-By trailer.
  -Dry stops after the local checks. -Resume re-reads the newest run log for this version and skips the steps it
  already completed, so a partial run can continue (an existing PR or tag is detected either way).
  Every step is logged to $DataDir\runs\v<Version>-<utc>.json; wallet keys never appear anywhere.
  Payments on staging use the faucet test wallet; nothing here pays on mainnet or registers more than once a day.
#>
param(
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$MessageFile,
  # Staging proofs default to a $0.002 tool: the faucet-funded test wallet pays every proof (4 per release), and at $0.01 it ran
  # dry after a day of releases (22 Oct 2026). Pass -ProofPath to prove a changed tool's own route.
  [string]$ProofPath = '/btc-fees',
  [string]$StagingOrigin = 'https://agent-data-tools-staging.revmesh2074.workers.dev',
  [string]$Origin = 'https://agent-data-tools.revmesh2074.workers.dev',
  [string]$DiscoveryDist = 'C:\Users\peter\AppData\Local\npm-cache\_npx\6af1a5211e496a90\node_modules\@agentcash\discovery\dist\index.js',
  [string]$DataDir = "$env:LOCALAPPDATA\agent-data-tools\release",
  [switch]$Dry,
  [switch]$Resume,
  [switch]$SkipSmoke
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must be x.y.z" }
if (-not (Test-Path $MessageFile)) { throw "MessageFile not found: $MessageFile" }
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo
New-Item -ItemType Directory -Force (Join-Path $DataDir 'runs') | Out-Null

# ---- run log and step runner ---------------------------------------------------------------------------------------
$runFile = Join-Path $DataDir "runs\v$Version-$((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')).json"
$state = [ordered]@{ version = $Version; startedAt = (Get-Date).ToUniversalTime().ToString('o'); steps = @() }
$done = @{}
if ($Resume) {
  $prev = Get-ChildItem (Join-Path $DataDir 'runs') -Filter "v$Version-*.json" | Sort-Object Name | Select-Object -Last 1
  if ($prev) { foreach ($s in (Get-Content $prev.FullName -Raw | ConvertFrom-Json).steps) { if ($s.ok) { $done[$s.name] = $true } }; Write-Host "Resuming from $($prev.Name); done: $($done.Keys -join ', ')" }
  else { Write-Host "No earlier run log for $Version under $DataDir\runs; starting from the first step (every step is safe to repeat)." -ForegroundColor Yellow }
}
function Save { $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $runFile }
function Step([string]$Name, [scriptblock]$Run, [string]$Expect = '', [switch]$Optional) {
  if ($done[$Name]) {
    # Carried into this run's log too, so a resume of a resume still knows what is done.
    $state.steps += [ordered]@{ name = $Name; startedAt = (Get-Date).ToUniversalTime().ToString('o'); ms = 0; exitCode = 0; ok = $true; tail = '(done in a previous run)' }; Save
    Write-Host "[skip] $Name (done in a previous run)" -ForegroundColor DarkGray; return $null
  }
  Write-Host "`n==> $Name" -ForegroundColor Cyan
  $t = Get-Date; $global:LASTEXITCODE = 0
  $out = (& $Run 2>&1 | ForEach-Object { "$_" }) -join "`n"
  $code = $LASTEXITCODE
  $ok = ($code -eq 0) -and ($Expect -eq '' -or $out -match $Expect)
  $state.steps += [ordered]@{ name = $Name; startedAt = $t.ToUniversalTime().ToString('o'); ms = [int]((Get-Date) - $t).TotalMilliseconds; exitCode = $code; ok = $ok; tail = ($out -split "`n" | Select-Object -Last 12) -join "`n" }
  Save
  if (-not $ok) {
    if ($Optional) { Write-Host "[warn] $Name failed (exit $code); continuing" -ForegroundColor Yellow; Write-Host $out; return $out }
    Write-Host $out; throw "step failed: $Name (exit $code$(if ($Expect) { ", expected /$Expect/" }))"
  }
  Write-Host (($out -split "`n" | Select-Object -Last 3) -join "`n")
  return $out
}
function RevertGenerated { git diff --ignore-cr-at-eol --quiet -- src/lib/output-validators.generated.ts; if ($LASTEXITCODE -eq 0) { git checkout -- src/lib/output-validators.generated.ts } }
function WaitFor([string]$What, [scriptblock]$Done, [int]$CapMinutes = 20) {
  $until = (Get-Date).AddMinutes($CapMinutes)
  while ((Get-Date) -lt $until) { $r = & $Done; if ($r -eq 'ok') { return }; if ($r -eq 'fail') { throw "$What failed" }; Start-Sleep 20 }
  throw "${What}: still pending after $CapMinutes minutes"
}

# ---- 0. preconditions ---------------------------------------------------------------------------------------------
Step 'auth' { gh auth status 2>&1 | Select-Object -First 2; npx wrangler whoami 2>&1 | Select-String 'logged in|Account' | Select-Object -First 1 } 'Logged in|logged in'
# The staging proofs pay from .test-wallet.json in THIS worktree. pay-test.mjs would otherwise create a fresh, unfunded
# wallet here and every proof would fail with insufficient_balance; copy the funded one in, and tell pay-test to refuse
# a missing file rather than invent one.
$WalletSource = 'C:\MoneyWallet\x402-canonical\.test-wallet.json'
Step 'wallet' {
  if (-not (Test-Path '.test-wallet.json')) {
    if (-not (Test-Path $WalletSource)) { throw "no .test-wallet.json here and none at $WalletSource" }
    Copy-Item $WalletSource '.test-wallet.json'; "copied the funded test wallet from $WalletSource"
  } else { 'test wallet present' }
  $env:PAY_TEST_REQUIRE_WALLET = '1'
  "wallet address: $(node scripts/pay-test.mjs address)"
}
# The branch under release. A resumed run may start on a detached checkout (the train detaches onto main after the
# merge), so the branch is remembered in the run log and read back from it.
$branch = "$(git branch --show-current)".Trim()
if ($Resume -and -not $branch -and $prev) { $branch = "$((Get-Content $prev.FullName -Raw | ConvertFrom-Json).branch)".Trim() }
if (-not $branch -or $branch -eq 'main') { throw "run on a feature branch, not '$branch'" }
$state.branch = $branch; Save

# ---- 1. sync with main, bump, local checks --------------------------------------------------------------------------
# A release that merged while this branch was cut moved the same pin lines (version, tool count, contract baseline), so
# the PR would not merge. Set our pins to main's first, so the pin lines are identical and the merge is clean, then merge
# and re-bump below. Taking whole pin files from main is not safe: on 22 Oct 2026 that dropped this branch's edits to
# src/discovery.ts (category rules for new tools) because the file also carries MCP_SERVER_VERSION. Only the generated
# contract baseline may be taken from main, because update:mcp-contract rebuilds it. Any other conflict stops the run.
$Regenerated = @('scripts/mcp-contract-baseline.json')
Step 'sync-main' {
  git fetch -q origin
  $mainVersion = ([regex]'"version":\s*"(\d+\.\d+\.\d+)"').Match("$(git show origin/main:server.json)").Groups[1].Value
  $mainCount = ([regex]'assert\.equal\(ENDPOINTS\.length,(\d+)\)').Match("$(git show origin/main:tests/families.test.cjs)").Groups[1].Value
  if (-not $mainVersion -or -not $mainCount) { throw "could not read main's version/count pins" }
  node scripts/bump-version.mjs $mainVersion --count $mainCount 2>&1 | Out-String | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0) { throw "could not set the pins to main's $mainVersion / $mainCount" }
  if ("$(git status --porcelain)".Trim()) { git commit -q -am "Pins set to main's $mainVersion / $mainCount tools for the merge (release.ps1)" }
  git merge --no-edit origin/main 2>&1 | Out-String | Select-Object -Last 1
  $conflicts = @(git diff --name-only --diff-filter=U)
  if ($conflicts) {
    $other = $conflicts | Where-Object { $_ -notin $Regenerated }
    if ($other) { git merge --abort; throw "conflicts with origin/main: $($other -join ', ')" }
    foreach ($f in $conflicts) { git checkout --theirs -- $f; git add $f }
    git commit -q -m "Merge origin/main (generated baseline taken from main; rebuilt by release.ps1)"
    "merged origin/main; regenerated files taken from main: $($conflicts -join ', ')"
  } else { "merged origin/main ($mainVersion / $mainCount tools) cleanly" }
  $global:LASTEXITCODE = 0
}
Step 'bump' { node scripts/bump-version.mjs $Version }
# Idempotent: a restarted run finds the baseline already at this version, and the update script refuses a same-version
# update, so check first and update only when the baseline differs.
# A rerun after a source change (a fixed example, 1.54.0) finds the baseline already at this version but stale; the updater
# refuses a same-version update, so start again from main's baseline (the only file the train may take from main).
Step 'update:mcp-contract' {
  npm run check:mcp-contract 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $global:LASTEXITCODE = 0; "contract baseline already matches $Version"; return }
  $out = (npm run update:mcp-contract 2>&1 | ForEach-Object { "$_" }) -join "`n"
  if ($LASTEXITCODE -ne 0 -and $out -match 'must increase beyond baseline') { git checkout origin/main -- scripts/mcp-contract-baseline.json; npm run update:mcp-contract } else { $out }
} 'contract baseline'
# The full suite starts many Miniflare workers; a file-level flake (every test green, the file red) happens about once
# in ten runs, so one rerun is allowed. A real failure fails twice.
Step 'test' { $first = (npm test 2>&1 | ForEach-Object { "$_" }); if ($LASTEXITCODE -eq 0) { $first } else { Write-Host '[retry] npm test failed once; running again' -ForegroundColor Yellow; npm test } } 'fail 0'
Step 'check:mcp-contract' { npm run check:mcp-contract } 'matches version'
Step 'tsc' { npx tsc --noEmit -p . }
# Every paid tool on exactly its published example, live upstreams, paywall off (about a minute). The Bazaar listing payment
# and a buyer's first call use that example, so a failing one is a listing lost (/calc/loan in 1.51.0). -SkipSmoke only when
# an outside source is down and the release does not touch that tool.
if (-not $SkipSmoke) { Step 'smoke:examples' { node scripts/smoke-examples.mjs --retry } ' 0 fail;' } else { Write-Host '[skip] smoke:examples (-SkipSmoke)' -ForegroundColor Yellow }
RevertGenerated
if ($Dry) { Write-Host "`nDry run complete: pins bumped and checks green; nothing committed." -ForegroundColor Green; exit 0 }

# ---- 2. PR, CI, merge ----------------------------------------------------------------------------------------------
$title = (Get-Content $MessageFile -TotalCount 1).Trim()
$existing = gh pr list --head $branch --state all --json number,state,mergeCommit 2>$null | ConvertFrom-Json
$pr = $existing | Where-Object { $_.state -eq 'OPEN' } | Select-Object -First 1
$merged = $existing | Where-Object { $_.state -eq 'MERGED' } | Select-Object -First 1
if (-not $merged) {
  if (-not $pr) {
    Step 'commit+push' { git add -A; if (git status --porcelain) { git commit -q -F $MessageFile }; git push -q -u origin $branch; 'pushed' } 'pushed'
    $created = Step 'pr-create' { gh pr create --base main --head $branch --title $title --body-file $MessageFile } 'pull/\d+'
    $pr = [pscustomobject]@{ number = [int]([regex]::Match($created, 'pull/(\d+)').Groups[1].Value) }
  }
  Write-Host "PR #$($pr.number)"
  WaitFor "PR #$($pr.number) checks" {
    $checks = gh pr checks $pr.number --json name,bucket 2>$null | ConvertFrom-Json
    if (-not $checks) { return 'wait' }
    if ($checks | Where-Object { $_.bucket -in 'fail', 'cancel' }) { return 'fail' }
    if ($checks | Where-Object { $_.bucket -eq 'pending' }) { return 'wait' }
    'ok'
  }
  Step 'merge' { gh pr merge $pr.number --squash; 'merged' } 'merged'
}
Step 'checkout-main' { git fetch -q origin; git checkout -q --detach origin/main; git rev-parse HEAD }
$sha = (git rev-parse HEAD).Trim()
# The deploy guard (scripts/deploy-production.mjs) wants a completed, successful run of mcp-contract.yml for this exact
# commit, so wait for that workflow by name: on 22 Oct 2026 a resumed run passed this wait on another workflow's run and
# the guard then refused ("No successful clean-install CI run for this exact commit").
# GitHub sometimes starts no push run for a merge commit (1.50.3 on 22 Oct waited 20 minutes for nothing); after three
# minutes without a run, start the workflow on main by hand once (workflow_dispatch runs on main's head, this commit).
$ciWaitStart = Get-Date; $script:ciDispatched = $false
WaitFor "main CI (mcp-contract.yml) for $($sha.Substring(0,7))" {
  $runs = gh run list --repo Nutshell2000/agent-data-tools --workflow mcp-contract.yml --commit $sha --json status,conclusion 2>$null | ConvertFrom-Json
  if (-not $runs) {
    if (-not $script:ciDispatched -and ((Get-Date) - $ciWaitStart).TotalMinutes -ge 3) {
      Write-Host "[retry] no CI run for $($sha.Substring(0,7)) after 3 minutes; starting mcp-contract.yml on main" -ForegroundColor Yellow
      gh workflow run mcp-contract.yml --repo Nutshell2000/agent-data-tools --ref main 2>&1 | Out-Null
      $script:ciDispatched = $true
    }
    return 'wait'
  }
  if ($runs | Where-Object { $_.status -eq 'completed' -and $_.conclusion -eq 'success' }) { return 'ok' }
  if ($runs | Where-Object { $_.status -eq 'completed' -and $_.conclusion -ne 'success' }) { return 'fail' }
  'wait'
}

# ---- 3. staging proofs ---------------------------------------------------------------------------------------------
$settled = '"success":true|settle:\s+(?!none|no )\S'
# The testnet facilitator sometimes answers one proof with a transient refusal (insufficient_balance while the wallet
# holds funds): a proof gets one retry after a short wait; two refusals abort before production.
function Proof([string]$Name, [string[]]$ProofArgs) {
  # Not `$Args`: inside the step's scriptblock that name is PowerShell's own automatic variable (empty), which ran the
  # proofs without arguments on the 1.48.1 release.
  $script:proofArgs = $ProofArgs
  # The testnet facilitator's relayer wallet gets stuck now and then ("nonce lower than the current nonce",
  # "replacement transaction underpriced" on 22 Oct 2026, both its side); give it up to four tries over about two minutes.
  Step $Name {
    $waits = @(8, 30, 60)
    for ($try = 0; ; $try++) {
      $out = (node scripts/pay-test.mjs @script:proofArgs 2>&1 | ForEach-Object { "$_" })
      if (($out -join "`n") -match $settled -or $try -ge $waits.Count) { $out; break }
      Write-Host "[retry] $Name did not settle; retrying in $($waits[$try]) s" -ForegroundColor Yellow; Write-Host (($out | Select-Object -Last 3) -join "`n")
      Start-Sleep $waits[$try]
    }
  } $settled
}
Step 'staging-deploy' { npx wrangler deploy -c wrangler.staging.jsonc } 'Current Version ID'
RevertGenerated
Proof 'proof-v2' @("$StagingOrigin$ProofPath")
Proof 'proof-v1' @("$StagingOrigin$ProofPath", '--v1')
Proof 'proof-mcp' @($StagingOrigin, '--mcp', 'btc_fees')
Proof 'proof-mpp-evm' @("$StagingOrigin/btc-fees", '--mpp-evm')

# ---- 4. production -------------------------------------------------------------------------------------------------
$liveVersion = (Invoke-RestMethod "$Origin/.well-known/mcp/server-card.json" -TimeoutSec 60).serverInfo.version
if ($liveVersion -eq $Version) { Write-Host "production already runs $Version" -ForegroundColor DarkGray }
else {
  $list = (npx wrangler deployments list --name agent-data-tools 2>&1 | Out-String)
  $uuid = ([regex]::Matches($list, '\(100%\)\s+([0-9a-f-]{36})') | Select-Object -Last 1).Groups[1].Value
  if (-not $uuid) { throw "could not read the live deployment uuid" }
  # The guard reads GitHub's run list, which can lag the CI wait above by a minute; give it three tries.
  $deploy = Step 'deploy-production' {
    for ($try = 1; ; $try++) {
      $out = (npm run deploy:production -- --expected-version $uuid 2>&1 | ForEach-Object { "$_" })
      if (($out -join "`n") -notmatch 'No successful clean-install CI run' -or $try -ge 3) { $out; break }
      Write-Host "[retry] the guard does not see the CI run yet; retrying in 60 s" -ForegroundColor Yellow; Start-Sleep 60
    }
  } '"ok":true'
  RevertGenerated
  $state.productionVersion = ([regex]::Match($deploy, 'Current Version ID:\s*([0-9a-f-]{36})')).Groups[1].Value; Save
  Write-Host "production version $($state.productionVersion)"
}

# ---- 5. live checks, tag, index ------------------------------------------------------------------------------------
# Right after a deploy a few probes can hit a cold isolate and read an empty body (12 of 181 on the 1.48.4 run; all passed
# 90 s later). One retry after 30 s; a second miss fails the run.
Step 'check:live' { $first = (npm run check:live 2>&1 | ForEach-Object { "$_" }); if (($first -join "`n") -match '(\d+)/\1 ready') { $first } else { Write-Host '[retry] check:live not all ready; retrying in 30 s' -ForegroundColor Yellow; Write-Host (($first | Select-String 'FAIL|ready') -join "`n"); Start-Sleep 30; npm run check:live } } '(\d+)/\1 ready'
RevertGenerated
if (Test-Path $DiscoveryDist) { Step 'agentcash-discovery-check' { node scripts/check-agent-discovery.mjs $DiscoveryDist } '"readable402":true' -Optional } else { Write-Host "[skip] discovery check: $DiscoveryDist not found" }
if (-not (git ls-remote --tags origin "refs/tags/v$Version")) { Step 'tag' { git tag "v$Version" origin/main; git push -q origin "v$Version"; 'tagged' } 'tagged' } else { Write-Host "tag v$Version exists" }
Step 'indexnow' { node scripts/indexnow.mjs } 'HTTP 200' -Optional
$state.reliability = Step 'reliability' { node scripts/reliability-line.mjs $Origin } -Optional; Save

# ---- 6. directory registrations, once per UTC day -------------------------------------------------------------------
$stampFile = Join-Path $DataDir 'registrations.json'
$stamps = if (Test-Path $stampFile) { Get-Content $stampFile -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
$today = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
function Once([string]$Registry, [scriptblock]$Run, [string]$Expect = '') {
  if ($stamps[$Registry] -eq $today) { Write-Host "[skip] $Registry registered today" -ForegroundColor DarkGray; return }
  $out = Step "register-$Registry" $Run $Expect -Optional
  if ($out -ne $null -and ($Expect -eq '' -or $out -match $Expect)) { $stamps[$Registry] = $today; $stamps | ConvertTo-Json | Set-Content -Encoding utf8 $stampFile }
}
Once 'x402scan' { npx --yes agentcash register $Origin } '"success":\s*true'
Once 'agent402' { (Invoke-RestMethod -Method Post 'https://agent402.tools/api/index/register' -ContentType 'application/json' -Body (@{ origin = $Origin } | ConvertTo-Json) -TimeoutSec 120 | ConvertTo-Json -Compress -Depth 2) } '"listed":\s*true'
Once 'zero' { node scripts/register-zero.mjs $Origin } '-> 20\d'
Once '402index' { $dry = node scripts/register-402index.mjs --dry 2>&1 | Out-String; $dry; if ($dry -match '(\d+) to register' -and [int]$Matches[1] -gt 0) { Start-Process node -ArgumentList 'scripts/register-402index.mjs' -WorkingDirectory $Repo -WindowStyle Hidden; "started background registration of $($Matches[1]) paths" } } 'to register'

$state.finishedAt = (Get-Date).ToUniversalTime().ToString('o'); Save
Write-Host "`nRelease $Version complete. Log: $runFile" -ForegroundColor Green
