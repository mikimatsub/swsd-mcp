# Runs inside the plugin's STDIO process. Stdout is reserved for MCP messages.
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'Common.ps1')
    $node = Get-SwsdNode
    $entry = Get-SwsdEntryPoint
    if (-not (Test-Path -LiteralPath $entry)) { throw 'SWSD tools are not installed. Ask: Set up SolarWinds Service Desk on this computer.' }
    $token = [SwsdDesktop.Credentials]::Read($script:SwsdCredentialTarget)
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'SWSD token is not configured. Open SolarWinds Service Desk Setup from the Windows Start menu.' }
    $settings = Get-SwsdSettings
    $env:SWSD_TOKEN = $token
    $env:SWSD_BASE_URL = $settings.baseUrl
    $env:SWSD_TRANSPORT = 'stdio'
    $env:SWSD_PROFILE = $settings.profile
    $env:SWSD_WRITE_MODE = 'live'
    Remove-Item Env:SWSD_ENABLE_EXTRAS -ErrorAction SilentlyContinue
    $token = $null
    & $node $entry
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('SWSD startup failed. Open SolarWinds Service Desk Setup, install tools, save a token, and start a new chat. ' + $_.Exception.Message)
    exit 1
} finally {
    Remove-Item Env:SWSD_TOKEN -ErrorAction SilentlyContinue
}
