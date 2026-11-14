# Loads a build of the EU law index (scripts/law-index/build.mjs <outDir>) into D1 (eu-law, EU jurisdiction) and
# Vectorize (eu-law). Run from the repository root:  pwsh scripts/law-index/load.ps1 <outDir>
# passages.sql drops and recreates both D1 tables, so a reload replaces the passages; Vectorize upserts by id
# (ids are stable: <act>:<a|r><number>:<part>), so stale vectors remain only for passages that disappeared.
param([Parameter(Mandatory = $true)][string]$OutDir)
$ErrorActionPreference = 'Stop'
foreach ($f in 'passages.sql', 'vectors.ndjson') { if (-not (Test-Path (Join-Path $OutDir $f))) { throw "missing $f in $OutDir" } }
npx wrangler d1 execute eu-law --remote --yes --file (Join-Path $OutDir 'passages.sql')
if ($LASTEXITCODE -ne 0) { throw 'd1 load failed' }
npx wrangler vectorize upsert eu-law --file (Join-Path $OutDir 'vectors.ndjson') --batch-size 500
if ($LASTEXITCODE -ne 0) { throw 'vectorize load failed' }
npx wrangler d1 execute eu-law --remote --command "SELECT COUNT(*) AS passages, COUNT(DISTINCT short) AS acts FROM passages"
