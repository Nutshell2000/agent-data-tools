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
  [string]$ProofPath = '/time?zone=UTC',
  [string]$StagingOrigin = 'https://agent-data-tools-staging.revmesh2074.workers.dev',
  [string]$Origin = 'https://agent-data-tools.revmesh2074.workers.dev',
  [string]$DiscoveryDist = 'C:\Users\peter\AppData\Local\npm-cache\_npx\6af1a5211e496a90\node_modules\@agentcash\discovery\dist\index.js',
  [string]$DataDir = "$env:LOCALAPPDATA\agent-data-tools\release",
  [switch]$Dry,
  [switch]$Resume
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
  if ($prev) { foreach ($s in (Get-Content $prev.FullName -Raw | ConvertFrom-Json).steps) { if ($s.ok) { $done[$s.name] = $true } }; Write-Host "Resuming after: $($done.Keys -join ', ')" }
}
function Save { $state | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 $runFile }
function Step([string]$Name, [scriptblock]$Run, [string]$Expect = '', [switch]$Optional) {
  if ($done[$Name]) { Write-Host "[skip] $Name (done in a previous run)" -ForegroundColor DarkGray; return $null }
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
$branch = (git branch --show-current).Trim()
if (-not $branch -or $branch -eq 'main') { throw "run on a feature branch, not '$branch'" }

# ---- 1. sync with main, bump, local checks --------------------------------------------------------------------------
# A release that merged while this branch was cut moved the same pin lines (version, tool count, contract baseline), so
# the PR would not merge. Merge main first; conflicts in the pin files are taken from main and re-bumped below; any
# other conflict stops the run for a human.
$PinFiles = @('server.json', 'src/discovery.ts', 'src/endpoints.ts', 'tests/tool-buying.test.cjs', 'tests/families.test.cjs', 'tests/gateway-startup.test.cjs', 'scripts/mcp-contract-baseline.json')
Step 'sync-main' {
  git fetch -q origin
  git merge --no-edit origin/main 2>&1 | Out-String | Select-Object -Last 1
  $conflicts = @(git diff --name-only --diff-filter=U)
  if ($conflicts) {
    $other = $conflicts | Where-Object { $_ -notin $PinFiles }
    if ($other) { git merge --abort; throw "conflicts outside the pin files: $($other -join ', ')" }
    foreach ($f in $conflicts) { git checkout --theirs -- $f; git add $f }
    git commit -q -m "Merge origin/main (pin files taken from main; re-bumped by release.ps1)"
    "merged origin/main; pin conflicts resolved: $($conflicts -join ', ')"
  } else { 'in sync with origin/main' }
  $global:LASTEXITCODE = 0
}
Step 'bump' { node scripts/bump-version.mjs $Version }
Step 'update:mcp-contract' { npm run update:mcp-contract } 'contract baseline'
# The full suite starts many Miniflare workers; a file-level flake (every test green, the file red) happens about once
# in ten runs, so one rerun is allowed. A real failure fails twice.
Step 'test' { $first = (npm test 2>&1 | ForEach-Object { "$_" }); if ($LASTEXITCODE -eq 0) { $first } else { Write-Host '[retry] npm test failed once; running again' -ForegroundColor Yellow; npm test } } 'fail 0'
Step 'check:mcp-contract' { npm run check:mcp-contract } 'matches version'
Step 'tsc' { npx tsc --noEmit -p . }
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
WaitFor "main CI for $($sha.Substring(0,7))" {
  $runs = gh run list --repo Nutshell2000/agent-data-tools --commit $sha --json status,conclusion 2>$null | ConvertFrom-Json
  if (-not $runs) { return 'wait' }
  if ($runs | Where-Object { $_.status -eq 'completed' -and $_.conclusion -ne 'success' }) { return 'fail' }
  if ($runs | Where-Object { $_.status -ne 'completed' }) { return 'wait' }
  'ok'
}

# ---- 3. staging proofs ---------------------------------------------------------------------------------------------
$settled = '"success":true|settle:\s+(?!none|no )\S'
Step 'staging-deploy' { npx wrangler deploy -c wrangler.staging.jsonc } 'Current Version ID'
RevertGenerated
Step 'proof-v2' { node scripts/pay-test.mjs "$StagingOrigin$ProofPath" } $settled
Step 'proof-v1' { node scripts/pay-test.mjs "$StagingOrigin$ProofPath" --v1 } $settled
Step 'proof-mcp' { node scripts/pay-test.mjs $StagingOrigin --mcp btc_fees } $settled
Step 'proof-mpp-evm' { node scripts/pay-test.mjs "$StagingOrigin/time?zone=UTC" --mpp-evm } $settled

# ---- 4. production -------------------------------------------------------------------------------------------------
$liveVersion = (Invoke-RestMethod "$Origin/.well-known/mcp/server-card.json" -TimeoutSec 60).serverInfo.version
if ($liveVersion -eq $Version) { Write-Host "production already runs $Version" -ForegroundColor DarkGray }
else {
  $list = (npx wrangler deployments list --name agent-data-tools 2>&1 | Out-String)
  $uuid = ([regex]::Matches($list, '\(100%\)\s+([0-9a-f-]{36})') | Select-Object -Last 1).Groups[1].Value
  if (-not $uuid) { throw "could not read the live deployment uuid" }
  $deploy = Step 'deploy-production' { npm run deploy:production -- --expected-version $uuid } '"ok":true'
  RevertGenerated
  $state.productionVersion = ([regex]::Match($deploy, 'Current Version ID:\s*([0-9a-f-]{36})')).Groups[1].Value; Save
  Write-Host "production version $($state.productionVersion)"
}

# ---- 5. live checks, tag, index ------------------------------------------------------------------------------------
Step 'check:live' { npm run check:live } '(\d+)/\1 ready'
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
