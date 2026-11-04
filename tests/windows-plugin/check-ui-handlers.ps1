# Clicks every settings-window button through reflection (no window shown) with mocked install and
# token checks under StrictMode; fails on any unhandled handler exception.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\..\plugins\swsd\scripts\Manage-Swsd.ps1'
$output = & powershell.exe -NoProfile -NonInteractive -STA -File $script -ValidateHandlers 2>&1
$output | ForEach-Object { Write-Output $_ }
if ($LASTEXITCODE -ne 0 -or -not ($output -match '^PASS:')) { throw 'UI handler check failed.' }