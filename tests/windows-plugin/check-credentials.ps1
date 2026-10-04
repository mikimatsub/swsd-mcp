$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '../../plugins/swsd')
. (Join-Path $root 'scripts/Common.ps1')
$target = 'GAIConsultants/SWSD-MCP-test-' + [guid]::NewGuid().ToString('N')
try {
    if ($null -ne [SwsdDesktop.Credentials]::Read($target)) { throw 'Test target must start empty.' }
    [SwsdDesktop.Credentials]::Save($target, 'test-only-not-a-real-token')
    if ([SwsdDesktop.Credentials]::Read($target) -ne 'test-only-not-a-real-token') { throw 'Credential round trip failed.' }
    [SwsdDesktop.Credentials]::Save($target, 'replacement-test-only')
    if ([SwsdDesktop.Credentials]::Read($target) -ne 'replacement-test-only') { throw 'Credential replacement failed.' }
    [SwsdDesktop.Credentials]::Remove($target)
    if ($null -ne [SwsdDesktop.Credentials]::Read($target)) { throw 'Credential removal failed.' }
    [SwsdDesktop.Credentials]::Remove($target)
    $rejected = $false
    try { [SwsdDesktop.Credentials]::Save($target, '') } catch { $rejected = $true }
    if (-not $rejected) { throw 'Empty credential was accepted.' }
    $rejected = $false
    try { Test-SwsdToken -Token 'test-only' -BaseUrl 'https://example.com' } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unapproved token destination was accepted.' }
    Write-Output 'PASS: credential create/read/replace/delete, missing target, empty token, and destination allowlist.'
} finally { [SwsdDesktop.Credentials]::Remove($target) }
