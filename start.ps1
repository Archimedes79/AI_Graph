# Start the editor from PowerShell, which is what the VS Code terminal runs.
#
# Run it as `.\start.ps1`. Bare `start` will not do: in PowerShell that is an
# alias for Start-Process, which answers with a prompt for `FilePath:` and
# never touches this project.
#
# The shared launcher installs on first use, rebuilds stale sources, restarts an
# existing editor on the same port, then opens http://127.0.0.1:8000.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host 'Node.js is not installed. Get it from https://nodejs.org (24 or newer), then run this again.'
  Write-Host ''
  exit 1
}

node scripts/start.mjs @args
exit $LASTEXITCODE
