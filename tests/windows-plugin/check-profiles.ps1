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
    Save-SwsdSettings -BaseUrl 'https://apieu.samanage.com' -Profile agent -Theme system
    $schema=Get-Content (Join-Path $PSScriptRoot '../../schemas/swsd-profile.schema.json') -Raw | ConvertFrom-Json
    if ($schema.additionalProperties -ne $false -or $schema.properties.version.const -ne 1 -or $schema.properties.tools.maxItems -ne 512 -or $schema.properties.name.maxLength -ne 80) {throw 'Profile validation must be reviewed when the authoritative schema changes.'}
    $fixture=[pscustomobject]@{name='Daily follow-up'; version=1; description='Incidents and comments'; tools=@('swsd_list_my_incidents','swsd_get_incident')}
    $saved=Save-SwsdCustomProfile $fixture
    if ([IO.Path]::GetDirectoryName($saved.path) -ne (Join-Path $script:SwsdHome 'profiles')) {throw 'Custom profile escaped its directory.'}
    $loaded=Read-SwsdProfileFile $saved.path
    if (($loaded | ConvertTo-Json -Compress) -cne ((ConvertTo-SwsdValidatedProfile $fixture) | ConvertTo-Json -Compress)) {throw 'Profile round trip changed data.'}
    $export=Join-Path $script:SwsdHome 'export.json'
    Export-SwsdCustomProfile $saved.path $export
    foreach ($path in @($saved.path,$export)) {
        $bytes=[IO.File]::ReadAllBytes($path)
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {throw 'Saved and exported profiles must omit the UTF-8 BOM for Node JSON.parse.'}
    }
    $imported=Import-SwsdCustomProfile $export
    if (($imported.profile | ConvertTo-Json -Compress) -cne ($loaded | ConvertTo-Json -Compress)) {throw 'Export/import changed schema data.'}
    if (@($loaded.PSObject.Properties.Name | Where-Object {$_ -notin @($schema.properties.PSObject.Properties.Name)}).Count) {throw 'Saved profile has extra fields.'}
    Save-SwsdSettings -BaseUrl 'https://apieu.samanage.com' -Profile custom -ProfileFile $saved.path
    if ((Get-SwsdSettings).profile -ne 'custom' -or (Get-SwsdSettings).profileFile -ne $saved.path) {throw 'Custom selection did not save an absolute profile path.'}
    Save-SwsdSettings -BaseUrl 'https://apieu.samanage.com' -Profile custom -Theme dark
    if ((Get-SwsdSettings).profileFile -ne $saved.path) {throw 'Appearance save discarded the custom profile path.'}
    if (@(Get-SwsdPickerProfiles | Where-Object {$_.name -eq $fixture.name}).Count -ne 1) {throw 'Saved custom profile missing from picker.'}
    $fixture.name='Renamed follow-up'
    $renamed=Save-SwsdCustomProfile $fixture -PreviousPath $saved.path
    if ((Test-Path -LiteralPath $saved.path) -or (Get-SwsdSettings).profileFile -ne $renamed.path) {throw 'Rename left an old file or stale active setting.'}
    $fixture.tools=@('swsd_get_incident','unknown_tool')
    $unknown=Save-SwsdCustomProfile $fixture
    if ($unknown.skipped -cnotcontains 'unknown_tool' -or $unknown.notice -notlike '*unknown_tool*' -or $unknown.profile.tools.Count -ne 1) {throw 'Unknown tools were not skipped with a notice.'}
    $fixture | ConvertTo-Json | Set-Content -LiteralPath $export -Encoding UTF8
    if ((Import-SwsdCustomProfile $export).notice -notlike '*unknown_tool*') {throw 'Import omitted the unknown-tool notice.'}
    $invalid=@(
        '{"name":"Valid","version":1,"tools":[],"extra":true}',
        '{"Name":"Valid","version":1,"tools":[]}',
        '{"name":"../escape","version":1,"tools":[]}',
        '{"name":"","version":1,"tools":[]}',
        '{"name":"Valid","version":"1","tools":[]}',
        '{"name":"Valid","version":true,"tools":[]}',
        '{"name":"Valid","version":[1],"tools":[]}',
        '{"name":"Valid","version":2,"tools":[]}',
        '{"name":"Valid","version":1,"tools":"swsd_get_incident"}',
        '{"name":"Valid","version":1,"tools":[null]}',
        '{"name":"Valid","version":1,"tools":[""]}',
        '{"name":"Valid","version":1,"tools":[],"description":null}',
        (@{name=('a'*81);version=1;tools=@()} | ConvertTo-Json),
        (@{name='Valid';version=1;tools=@('a'*129)} | ConvertTo-Json),
        (@{name='Valid';version=1;tools=@('swsd_get_incident')*513} | ConvertTo-Json),
        (@{name='Valid';version=1;tools=@();description=('a'*2049)} | ConvertTo-Json)
    )
    foreach ($json in $invalid) {
        $json | Set-Content -LiteralPath $export -Encoding UTF8
        $rejected=$false
        try {Import-SwsdCustomProfile $export | Out-Null} catch {if ($_.Exception.Message -notlike 'Profile JSON:*') {throw}; $rejected=$true}
        if (-not $rejected) {throw 'Schema-invalid profile was accepted.'}
    }
    $boundary=Save-SwsdCustomProfile ([pscustomobject]@{name=('a'*80); version=1; tools=@('swsd_get_incident')*512;description=('b'*2048)})
    if ($boundary.profile.tools.Count -ne 512) {throw 'Schema boundary was rejected.'}
    Remove-SwsdCustomProfile $renamed.path
    if ((Get-SwsdSettings).profile -ne 'agent') {throw 'Delete did not select a working built-in profile.'}
    Save-SwsdSettings -BaseUrl 'https://api.samanage.com' -Profile agent
    if ((Get-SwsdSettings).profileFile) {throw 'Built-in profile retained profileFile.'}
    '{"baseUrl":"https://api.samanage.com","profile":"custom","profileFile":"missing.json"}' | Set-Content -LiteralPath (Join-Path $script:SwsdHome 'settings.json')
    $damaged=Get-SwsdSettings
    if (-not $damaged.profileError -or $damaged.profile -ne 'agent') {throw 'Invalid custom file must give a friendly fallback instead of crashing setup.'}
    Write-Output 'PASS: hidden Full alias; built-in/custom persistence; schema-exact save/load/export/import and limits; unknown-tool notices; rename/delete; damaged-file fallback; region and credential preservation.'
    & (Join-Path $PSScriptRoot 'check-launcher.ps1')
} finally {
    $settingsPath = Join-Path $script:SwsdHome 'settings.json'
    if (Test-Path -LiteralPath $settingsPath) { Remove-Item -LiteralPath $settingsPath -Force }
    $resolved=[IO.Path]::GetFullPath($script:SwsdHome)
    $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^swsd-profile-test-[a-f0-9]{32}$') {throw 'Unsafe profile-test cleanup path.'}
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
