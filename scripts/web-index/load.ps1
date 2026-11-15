# Loads a build of the web index (scripts/web-index/build.mjs <sites.json> <outDir>) into D1 web-docs (EU jurisdiction).
# Run from the repository root:  pwsh scripts/web-index/load.ps1 <outDir> [-Fresh]
# -Fresh runs schema.sql first (drops and recreates the tables). Page rows are inserted with OR IGNORE, so a page found
# by two passes or two site sections is kept once; the FTS5 table is then filled from the pages table in chunks of 5,000
# rows (the build's own pages_fts lines are skipped, since they would index a duplicate twice).
param([Parameter(Mandatory = $true)][string]$OutDir, [switch]$Fresh)
$ErrorActionPreference = 'Stop'
$tmp = Join-Path $OutDir '_load.sql'
if ($Fresh) { npx wrangler d1 execute web-docs --remote --yes --file (Join-Path $OutDir 'schema.sql'); if ($LASTEXITCODE -ne 0) { throw 'schema failed' } }
foreach ($f in Get-ChildItem $OutDir -Filter 'site-*.sql' | Sort-Object Name) {
  if ($f.Length -lt 10) { continue }
  $lines = [IO.File]::ReadAllLines($f.FullName) | Where-Object { $_.StartsWith('INSERT INTO pages VALUES') } | ForEach-Object { 'INSERT OR IGNORE INTO pages VALUES' + $_.Substring(24) }
  [IO.File]::WriteAllLines($tmp, [string[]]$lines)
  npx wrangler d1 execute web-docs --remote --yes --file $tmp | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "load failed at $($f.Name)" }
  Write-Host "loaded $($f.Name) ($($lines.Count) pages)"
}
Remove-Item $tmp -ErrorAction SilentlyContinue
$max = [int](((npx wrangler d1 execute web-docs --remote --json --command "SELECT MAX(rowid) AS m FROM pages" | Out-String) -replace '(?s)^[^\[]*', '' | ConvertFrom-Json)[0].results[0].m)
npx wrangler d1 execute web-docs --remote --yes --command "DELETE FROM pages_fts" | Out-Null
for ($a = 0; $a -le $max; $a += 5000) {
  npx wrangler d1 execute web-docs --remote --yes --command "INSERT INTO pages_fts SELECT id, title, headings, description, text FROM pages WHERE rowid > $a AND rowid <= $($a + 5000)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "fts fill failed at rowid $a" }
}
npx wrangler d1 execute web-docs --remote --command "SELECT (SELECT COUNT(*) FROM pages) AS pages, (SELECT COUNT(*) FROM pages_fts) AS fts, (SELECT COUNT(DISTINCT source) FROM pages) AS sources"
