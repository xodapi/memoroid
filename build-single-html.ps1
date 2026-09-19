param(
  [string]$Output = (Join-Path $PSScriptRoot 'memoroid-single.html')
)

$index = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'index.html')
$styles = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'styles.css')
$application = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'app.js')
$wasm = [Convert]::ToBase64String(
  [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'wasm\memoroid-index.wasm'))
)

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

Set-Content -LiteralPath $Output -Value $single -Encoding utf8
Write-Output "Generated $Output"
