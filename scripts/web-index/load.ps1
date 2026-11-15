# Loads a build of the web index (scripts/web-index/build.mjs <sites.json> <outDir>) into D1 web-docs (EU jurisdiction).
# Run from the repository root:  pwsh scripts/web-index/load.ps1 <outDir> [-Fresh]
# -Fresh runs schema.sql first (drops and recreates the tables); without it the site files are added to what is there.
param([Parameter(Mandatory = $true)][string]$OutDir, [switch]$Fresh)
$ErrorActionPreference = 'Stop'
if ($Fresh) { npx wrangler d1 execute web-docs --remote --yes --file (Join-Path $OutDir 'schema.sql'); if ($LASTEXITCODE -ne 0) { throw 'schema failed' } }
foreach ($f in Get-ChildItem $OutDir -Filter 'site-*.sql' | Sort-Object Name) {
  if ($f.Length -lt 10) { continue }
  npx wrangler d1 execute web-docs --remote --yes --file $f.FullName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "load failed at $($f.Name)" }
  Write-Host "loaded $($f.Name)"
}
npx wrangler d1 execute web-docs --remote --command "SELECT COUNT(*) AS pages, COUNT(DISTINCT site) AS sites FROM pages"
