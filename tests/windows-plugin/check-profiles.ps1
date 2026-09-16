$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '../../plugins/swsd')
. (Join-Path $root 'scripts/Common.ps1')
$script:SwsdHome = Join-Path ([IO.Path]::GetTempPath()) ('swsd-profile-test-' + [guid]::NewGuid().ToString('N'))
$target = 'GAIConsultants/SWSD-MCP-test-' + [guid]::NewGuid().ToString('N')
$script:SwsdCredentialTarget = $target
try {
    if ((Get-SwsdSettings).profile -ne 'agent') { throw 'Missing settings must default to Agent.' }
    New-Item -ItemType Directory -Path $script:SwsdHome | Out-Null
    '{"baseUrl":"https://apieu.samanage.com"}' | Set-Content (Join-Path $script:SwsdHome 'settings.json')
    if ((Get-SwsdSettings).profile -ne 'agent') { throw 'Legacy settings must default to Agent.' }
    [SwsdDesktop.Credentials]::Save($target, 'profile-test-only')
    foreach ($profile in @('triage','agent','knowledge','operations','full')) {
        Save-SwsdProfile -Profile $profile
        $saved = Get-SwsdSettings
        if ($saved.profile -ne $profile) { throw 'Profile was not persisted.' }
        if ($saved.baseUrl -ne 'https://apieu.samanage.com') { throw 'Profile change altered the region.' }
        if ([SwsdDesktop.Credentials]::Read($target) -ne 'profile-test-only') { throw 'Profile change altered the credential.' }
    }
    $rejected = $false
    try { Save-SwsdProfile -Profile 'invalid' } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsupported profile was accepted.' }
    '{"baseUrl":"https://api.samanage.com","profile":"invalid"}' | Set-Content (Join-Path $script:SwsdHome 'settings.json')
    $rejected = $false
    try { Get-SwsdSettings | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsupported persisted profile was accepted.' }
    Write-Output 'PASS: all profiles persist; region and credential preserved; defaults and invalid values verified.'
} finally {
    [SwsdDesktop.Credentials]::Remove($target)
    $settingsPath = Join-Path $script:SwsdHome 'settings.json'
    if (Test-Path -LiteralPath $settingsPath) { Remove-Item -LiteralPath $settingsPath -Force }
    if (Test-Path -LiteralPath $script:SwsdHome) { Remove-Item -LiteralPath $script:SwsdHome }
}
