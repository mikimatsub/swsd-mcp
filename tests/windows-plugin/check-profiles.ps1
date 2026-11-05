$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '../../plugins/swsd')
. (Join-Path $root 'scripts/Common.ps1')
$script:SwsdHome = Join-Path ([IO.Path]::GetTempPath()) ('swsd-profile-test-' + [guid]::NewGuid().ToString('N'))
$target = 'swsd-mcp/test/' + [guid]::NewGuid().ToString('N')
$script:SwsdCredentialTarget = $target
try {
    if ((Get-SwsdSettings).profile -ne 'agent') { throw 'Missing settings must default to Agent.' }
    New-Item -ItemType Directory -Path $script:SwsdHome | Out-Null
    '{"baseUrl":"https://apieu.samanage.com"}' | Set-Content (Join-Path $script:SwsdHome 'settings.json')
    if ((Get-SwsdSettings).profile -ne 'agent') { throw 'Legacy settings must default to Agent.' }
    $picker = @(Get-SwsdPickerProfiles)
    if ($picker.Count -lt 4) { throw 'Picker must expose at least four profiles.' }
    if ($picker.id -contains 'full') { throw 'Full must stay hidden from the picker.' }
    if ($picker.name -contains 'Full') { throw 'Full must not appear as a picker label.' }
    if ((Resolve-SwsdProfileId 'full') -ne 'operations') { throw 'Full must resolve to Operations.' }
    if ((Get-SwsdProfileDisplayName 'full') -ne 'Operations') { throw 'Full must display as Operations.' }
    if ((Get-SwsdProfileRow 'full').id -ne 'operations') { throw 'Full alias must load the Operations row.' }
    $credentialBefore = [SwsdDesktop.Credentials]::Read($target)
    foreach ($profile in @('triage','agent','knowledge','operations','full')) {
        Save-SwsdProfile -Profile $profile
        $saved = Get-SwsdSettings
        if ($saved.profile -ne $profile) { throw 'Profile was not persisted.' }
        if ($saved.baseUrl -ne 'https://apieu.samanage.com') { throw 'Profile change altered the region.' }
        if ([SwsdDesktop.Credentials]::Read($target) -ne $credentialBefore) { throw 'Profile change altered the credential.' }
    }
    $rejected = $false
    try { Save-SwsdProfile -Profile 'invalid' } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsupported profile was accepted.' }
    '{"baseUrl":"https://api.samanage.com","profile":"invalid"}' | Set-Content (Join-Path $script:SwsdHome 'settings.json')
    $rejected = $false
    try { Get-SwsdSettings | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Unsupported persisted profile was accepted.' }
    Write-Output 'PASS: picker hides Full alias; profiles persist; region and empty credential target preserved without credential writes; defaults and invalid values verified.'
} finally {
    $settingsPath = Join-Path $script:SwsdHome 'settings.json'
    if (Test-Path -LiteralPath $settingsPath) { Remove-Item -LiteralPath $settingsPath -Force }
    if (Test-Path -LiteralPath $script:SwsdHome) { Remove-Item -LiteralPath $script:SwsdHome }
}
