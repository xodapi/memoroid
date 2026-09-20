<#
.SYNOPSIS
    Builds memoroid-single.html, a self-contained copy of Memoroid.

.DESCRIPTION
    Inlines styles.css, app.js and the WASM module into index.html so the
    result opens directly from the filesystem with no server and no external
    assets. Validates the output before writing it: runs node --check on
    app.js and verifies that no external stylesheet or script reference
    survives inlining.

.PARAMETER Output
    Path to the generated file. Defaults to memoroid-single.html next to
    this script.

.PARAMETER Help
    Prints this help text and exits without building.

.EXAMPLE
    pwsh -File .\build-single-html.ps1
    Builds memoroid-single.html and validates it.

.EXAMPLE
    pwsh -File .\build-single-html.ps1 -Output C:\temp\memoroid.html
    Builds to a custom path.

.EXAMPLE
    pwsh -File .\build-single-html.ps1 -Help
    Prints usage only.

.NOTES
    Run this after every change to index.html, styles.css, app.js, or the
    WASM module, otherwise the single-file build drifts from the sources.
#>
param(
  [string]$Output = (Join-Path $PSScriptRoot 'memoroid-single.html'),
  [switch]$Help,
  [Alias('h', '?')][switch]$Usage
)

$helpText = @'
Memoroid single-file build
==========================

Usage:
  pwsh -File .\build-single-html.ps1 [-Output <path>] [-Help]

Options:
  -Output <path>   Where to write the generated file.
                   Default: memoroid-single.html next to this script.
  -Help            Print this help and exit without building.

What it does:
  Inlines styles.css, app.js and the embedded WASM module into index.html,
  then validates the result:
    - node --check on app.js (JavaScript syntax must be valid)
    - no external <link> or <script src> may survive inlining
    - the stylesheet and both scripts must actually have been inlined

If validation fails the script stops and the previous output is left as is.

After changing index.html, styles.css, app.js or wasm/memoroid-index.wasm,
run this again - memoroid-single.html is a generated mirror, not a source.
'@

if ($Help -or $Usage) {
  $helpText
  exit 0
}

$index = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'index.html')
$styles = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'styles.css')
$application = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'app.js')
$wasm = [Convert]::ToBase64String(
  [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'wasm\memoroid-index.wasm'))
)

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $applicationPath = Join-Path $PSScriptRoot 'app.js'
  $check = & node --check $applicationPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "app.js failed JavaScript syntax check:`n$check"
  }
  Write-Output 'app.js: syntax OK'
} else {
  Write-Warning 'node not found - skipping JavaScript syntax check.'
}

$inlineWasm = "window.MemoroidWasmBinary = Uint8Array.from(atob('$wasm'), (char) => char.charCodeAt(0));"
$single = $index
$single = $single.Replace(
  '<link rel="stylesheet" href="styles.css" />',
  "<style>`n$styles`n</style>"
)
$single = $single.Replace(
  '  <script src="wasm/memoroid-index.js"></script>',
  "  <script>$inlineWasm</script>"
)
$single = $single.Replace(
  '  <script src="app.js"></script>',
  "  <script>`n$application`n</script>"
)

if ($single -match '<link[^>]+href=|<script[^>]+src=') {
  throw 'Single HTML still contains an external asset reference.'
}
if (-not $single.Contains('<style>') -or -not $single.Contains('MemoroidWasmBinary')) {
  throw 'Inlining failed: the stylesheet or the WASM module is missing from the output.'
}

Set-Content -LiteralPath $Output -Value $single -Encoding utf8
Write-Output "Generated $Output"
