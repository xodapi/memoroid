param(
  [string]$WasmInput = (Join-Path $PSScriptRoot 'memoroid-index.wasm'),
  [string]$LoaderOutput = (Join-Path $PSScriptRoot 'memoroid-index.js')
)
$bytes = [IO.File]::ReadAllBytes($WasmInput)
$base64 = [Convert]::ToBase64String($bytes)
$content = "/* Generated from index.rs. Keeps the optional WASM path usable from file://. */`nwindow.MemoroidWasmBinary = Uint8Array.from(atob('$base64'), (char) => char.charCodeAt(0));`n"
Set-Content -LiteralPath $LoaderOutput -Value $content -Encoding utf8
Write-Output "Generated $LoaderOutput ($($bytes.Length) bytes)"
