# Start the editor from PowerShell, which is what the VS Code terminal runs.
#
# Run it as `.\start.ps1`. Bare `start` will not do: in PowerShell that is an
# alias for Start-Process, which answers with a prompt for `FilePath:` and
# never touches this project.
#
# Installs on first use, builds the page when it is missing, then serves it on
# http://127.0.0.1:8000 and opens a browser.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host 'Node.js is not installed. Get it from https://nodejs.org (24 or newer), then run this again.'
  Write-Host ''
  exit 1
}

if (-not (Test-Path 'node_modules')) {
  Write-Host 'Installing dependencies...'
  npm ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path 'editor/dist/index.html')) {
  Write-Host 'Building the editor...'
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

npm start -- @args
