# Runs inside the plugin's STDIO process. Stdout is reserved for MCP messages.
$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'Common.ps1')
    $node = Get-SwsdNode
    $entry = Get-SwsdEntryPoint
    if (-not (Test-Path -LiteralPath $entry)) { throw 'SWSD tools are not installed. Ask: Set up SWSD on this computer.' }
    $token = [SwsdDesktop.Credentials]::Read($script:SwsdCredentialTarget)
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'SWSD JSON Web Token is not configured. Open SWSD Setup from the Windows Start menu.' }
    $settings = Get-SwsdSettings
    if ($settings.profileError) { throw $settings.profileError }
    $env:SWSD_TOKEN = $token
    $env:SWSD_BASE_URL = $settings.baseUrl
    $env:SWSD_TRANSPORT = 'stdio'
    $env:SWSD_PROFILE = $settings.profile
    Remove-Item Env:SWSD_TOOLS -ErrorAction SilentlyContinue
    if ($settings.profile -eq 'custom') { $env:SWSD_PROFILE_FILE = $settings.profileFile }
    else { Remove-Item Env:SWSD_PROFILE_FILE -ErrorAction SilentlyContinue }
    $env:SWSD_WRITE_MODE = 'live'
    Remove-Item Env:SWSD_ENABLE_EXTRAS -ErrorAction SilentlyContinue
    $token = $null
    & $node $entry
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('SWSD startup failed. Open SWSD Setup, install tools, save a JSON Web Token, and start a new chat. ' + $_.Exception.Message)
    exit 1
} finally {
    Remove-Item Env:SWSD_TOKEN -ErrorAction SilentlyContinue
}
