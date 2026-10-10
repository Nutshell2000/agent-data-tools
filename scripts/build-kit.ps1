# Builds the x402 Seller Kit zip that the store sells.
#
#   pwsh -File scripts/build-kit.ps1
#
# The kit's template shares its generic files with this project, so they are
# copied from src/ at build time and can't drift. Output: public/_files/x402-seller-kit.zip
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$kit = Join-Path $root 'products\x402-seller-kit'
$stage = Join-Path $root '.build\x402-seller-kit'
$zip = Join-Path $root 'public\_files\x402-seller-kit.zip'

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $stage 'template') | Out-Null

# Guides and licence.
Copy-Item -Path (Join-Path $kit '*.md'), (Join-Path $kit 'LICENSE.txt') -Destination $stage

# Files written for the template.
Copy-Item -Path (Join-Path $kit 'template-files\*') -Destination (Join-Path $stage 'template') -Recurse -Force

# Generic files shared with this project.
$shared = 'src\discovery.ts', 'src\mcp.ts', 'src\lib\payments.ts', 'src\lib\facilitator.ts', 'src\lib\fetch.ts',
          'src\routes\extract.ts', 'src\routes\domain.ts', 'tsconfig.json', '.github\workflows\publish-mcp.yml'
foreach ($f in $shared) {
  $dest = Join-Path $stage "template\$f"
  New-Item -ItemType Directory -Force (Split-Path -Parent $dest) | Out-Null
  Copy-Item -LiteralPath (Join-Path $root $f) -Destination $dest
}

New-Item -ItemType Directory -Force (Split-Path -Parent $zip) | Out-Null
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip
$files = (Get-ChildItem -LiteralPath $stage -Recurse -File -Force).Count
"Built $zip ($files files, $([math]::Round((Get-Item -LiteralPath $zip).Length / 1KB)) KB)"
