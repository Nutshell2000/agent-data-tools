# Loads a build of the web index (scripts/web-index/build.mjs <sites.json> <outDir>) into D1 web-docs (EU jurisdiction).
# Run from the repository root:  pwsh scripts/web-index/load.ps1 <outDir>
# pages.sql drops and recreates the tables, so a load replaces the index.
param([Parameter(Mandatory = $true)][string]$OutDir)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $OutDir 'pages.sql'))) { throw "missing pages.sql in $OutDir" }
npx wrangler d1 execute web-docs --remote --yes --file (Join-Path $OutDir 'pages.sql')
if ($LASTEXITCODE -ne 0) { throw 'd1 load failed' }
npx wrangler d1 execute web-docs --remote --command "SELECT COUNT(*) AS pages, COUNT(DISTINCT site) AS sites FROM pages"
