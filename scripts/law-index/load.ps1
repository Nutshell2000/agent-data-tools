# Loads a build of the EU law index (scripts/law-index/build.mjs <outDir>) into D1 and Vectorize. Run from the repository
# root:  pwsh scripts/law-index/load.ps1 <outDir> [-Database eu-law-v2] [-Index eu-law-v2]
# passages-1.sql drops and recreates both D1 tables, so a reload replaces the passages (the other files only insert);
# Vectorize upserts by id (ids are stable: <act>:<a|r><number>:<part>), so stale vectors remain only for passages that
# disappeared. Since 18 Nov 2026 the index lives in eu-law-v2 (EU jurisdiction); eu-law holds the 47-act build of 14 Nov.
param([Parameter(Mandatory = $true)][string]$OutDir, [string]$Database = 'eu-law-v2', [string]$Index = 'eu-law-v2')
$ErrorActionPreference = 'Stop'
$files = Get-ChildItem $OutDir -Filter 'passages-*.sql' | Sort-Object { [int]($_.BaseName -replace '\D', '') }
if (-not $files) { throw "no passages-*.sql in $OutDir" }
if (-not (Test-Path (Join-Path $OutDir 'vectors.ndjson'))) { throw "missing vectors.ndjson in $OutDir" }
foreach ($f in $files) {
  "loading $($f.Name)"
  npx wrangler d1 execute $Database --remote --yes --file $f.FullName
  if ($LASTEXITCODE -ne 0) { throw "d1 load failed at $($f.Name)" }
}
npx wrangler vectorize upsert $Index --file (Join-Path $OutDir 'vectors.ndjson') --batch-size 500
if ($LASTEXITCODE -ne 0) { throw 'vectorize load failed' }
npx wrangler d1 execute $Database --remote --command "SELECT lang, COUNT(*) AS passages, COUNT(DISTINCT short) AS acts FROM passages GROUP BY lang"
