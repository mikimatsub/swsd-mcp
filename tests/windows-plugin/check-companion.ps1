$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../plugins/swsd/scripts/Common.ps1')
$script:SwsdHome=Join-Path ([IO.Path]::GetTempPath()) ('swsd-companion-test-'+[guid]::NewGuid().ToString('N'))
# Explicit parameters make URL generation a pure operation; no credential access.
$badValues=@('synthetic-secret','person@example.test','tenant-name','https://user:password@host.test','C:\Users\person\profiles\daily.json','SWSD_TOKEN=sentinel','1.2.3&token=sentinel')
foreach ($value in $badValues) {
    foreach ($kind in @('bug','feature')) {
        $url=New-SwsdIssueUrl -Kind $kind -AppVersion $value -ServerVersion $value -WindowsVersion $value -Profile $value
        $decoded=[Uri]::UnescapeDataString($url)
        foreach ($forbidden in @($badValues)+@('token=','tenant','@','C:\','SWSD_TOKEN','password','profileFile')) {
            if ($decoded.Contains($forbidden)) {throw 'Issue prefill contains sensitive input.'}
        }
        if ($url -notlike '*profile=custom') {throw 'Custom profile must use the literal custom.'}
        $uri=[Uri]$url
        if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'github.com' -or $uri.AbsolutePath -ne '/mikimatsub/swsd-mcp/issues/new') {throw 'Unexpected issue destination.'}
    }
}
foreach ($profile in @('triage','agent','knowledge','operations','full','custom')) {
    $url=New-SwsdIssueUrl -Kind bug -AppVersion '3.1.0' -ServerVersion '3.2.0' -WindowsVersion '10.0.26100.0' -Profile $profile
    $expected=if ($profile -eq 'full') {'operations'} else {$profile}
    if ($url -notlike "*template=bug_report.yml&app_version=3.1.0&server_version=3.2.0&windows_version=10.0.26100.0&profile=$expected") {throw 'Issue prefill fields changed.'}
}
if ((New-SwsdIssueUrl -Kind feature -AppVersion '3.1.0' -ServerVersion '3.2.0' -WindowsVersion '10.0.26100' -Profile custom) -notlike '*template=feature_request.yml*') {throw 'Wrong feature template.'}
foreach ($name in @('Manage-Swsd.ps1','Common.ps1')) {
    $source=Get-Content (Join-Path $PSScriptRoot "../../plugins/swsd/scripts/$name") -Raw
    if ($source -match ('secu'+'rely')) {throw 'Remove prohibited credential copy.'}
}
$notes=@(Get-SwsdReleaseNotes)
if (-not @($notes | Where-Object {$_.kind -eq 'version' -and $_.text -eq 'Unreleased'}).Count -or -not @($notes | Where-Object {$_.kind -eq 'section' -and $_.text -eq 'Added'}).Count) {throw 'Bundled Keep a Changelog rendering failed.'}
if ((Get-Content (Join-Path $PSScriptRoot '../../CHANGELOG.md') -Raw) -cne (Get-Content (Join-Path $PSScriptRoot '../../plugins/swsd/assets/CHANGELOG.md') -Raw)) {throw 'Bundled release notes must match CHANGELOG.md.'}
Write-Output 'PASS: allowlisted issue prefills exclude secrets and paths; credential copy; bundled offline changelog.'
