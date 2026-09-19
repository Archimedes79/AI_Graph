# Stop the editor from PowerShell. Use .\stop.ps1; bare `stop` is not this script.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js is not installed. Get it from https://nodejs.org (24 or newer), then run this again.'
  exit 1
}

node scripts/stop.mjs @args
exit $LASTEXITCODE