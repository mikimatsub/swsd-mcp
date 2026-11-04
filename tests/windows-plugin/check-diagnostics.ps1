$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '../../plugins/swsd')
. (Join-Path $root 'scripts/Common.ps1')
$target = 'swsd-mcp/test/' + [guid]::NewGuid().ToString('N')
$testHome = Join-Path ([IO.Path]::GetTempPath()) ('swsd-diagnostics-test-' + [guid]::NewGuid().ToString('N'))
$script:SwsdHome = $testHome
$script:SwsdCredentialTarget = $target
$logPath = Join-Path $testHome 'swsd-settings.log'
# Synthetic value only: never read a saved credential, including this test's value.
$syntheticToken = 'Q7xM2vR9aB4kL8pN6zC3dF5hJ1sT0wY2'
$saved = $false
function Assert-NoDiagnosticToken([string]$Report) {
    if ($Report.Contains($syntheticToken)) { throw 'Diagnostics leaked the synthetic token.' }
    # Every longer matching substring contains an eight-character matching window.
    for ($i = 0; $i -le $syntheticToken.Length - 8; $i++) {
        if ($Report.Contains($syntheticToken.Substring($i, 8))) { throw 'Diagnostics leaked a synthetic token fragment.' }
    }
}
function Assert-DiagnosticReport([string]$Report) {
    Assert-NoDiagnosticToken $Report
    foreach ($section in @('[Application]', '[Windows]', '[PowerShell]', '[Node.js]', '[Tools]', '[Connection]', '[Display]', '[Recent log (last 20 lines; redacted)]')) {
        if (-not $Report.Contains($section)) { throw 'Diagnostics omitted a required section.' }
    }
    foreach ($expected in @("App version: $script:SwsdClientVersion", "Package version: $script:SwsdPackageVersion",
        "Version: $($PSVersionTable.PSVersion)", 'Profile: agent', 'Region base URL: https://api.samanage.com',
        'Installed: no', 'DPI: 144', 'Display scale: 150%', 'UI scale: 150%', 'Theme: dark', 'safe row 1', 'safe row 15', '[REDACTED]')) {
        if (-not $Report.Contains($expected)) { throw 'Diagnostics omitted an expected value.' }
    }
    if ($Report.Contains('old row')) { throw 'Diagnostics included more than the last 20 log lines.' }
    $tail = ($Report -split '\[Recent log \(last 20 lines; redacted\)\]\r?\n', 2)[1] -split '\r?\n'
    if ($tail.Count -ne 20) { throw 'Diagnostics must include exactly the last 20 available log lines.' }
    if ($Report -notmatch '(?m)^Build: \d+(\.\d+)?\r?$') { throw 'Windows build is missing.' }
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $expectedPath = if ($node) { $node.Source } else { 'Not found' }
    if (-not $Report.Contains("Path: $expectedPath")) { throw 'Node path is missing.' }
}
try {
    New-Item -ItemType Directory -Path $testHome | Out-Null
    $log = @((1..6 | ForEach-Object { "old row $_" })) + @((1..15 | ForEach-Object { "safe row $_" })) + @(
        ('Authorization: Bearer ' + $syntheticToken)
        ('{"token":"' + $syntheticToken + '"}')
        $syntheticToken
        ('https://example.invalid/?key=' + $syntheticToken)
        ('fragment ' + $syntheticToken.Substring(7, 8))
    )
    $log | Set-Content -LiteralPath $logPath -Encoding UTF8
    # These assertions still run when this session cannot access Credential Manager.
    $report = Get-SwsdDiagnostics -LogPath $logPath -Dpi 144 -Scale 1.5 -Theme dark
    Assert-DiagnosticReport $report
    Write-Output 'PASS: diagnostics sections, values, 20-line tail and synthetic token/fragment redaction without UI or clipboard access.'
    if ([SwsdDesktop.Credentials]::Exists($target)) { throw 'Test credential target must start empty.' }
    if ($report -notmatch 'Credential PRESENT: no') { throw 'Missing credential was not reported absent.' }
    [SwsdDesktop.Credentials]::Save($target, $syntheticToken)
    $saved = $true
    if (-not [SwsdDesktop.Credentials]::Exists($target)) { throw 'Test credential was not saved.' }
    $report = Get-SwsdDiagnostics -LogPath $logPath -Dpi 144 -Scale 1.5 -Theme dark
    Assert-DiagnosticReport $report
    if ($report -notmatch 'Credential PRESENT: yes') { throw 'Saved credential was not reported present.' }
    Remove-Item -LiteralPath $logPath
    $report = Get-SwsdDiagnostics -LogPath $logPath
    Assert-NoDiagnosticToken $report
    if (-not $report.Contains('No log file found.')) { throw 'Missing log did not produce a useful diagnostic.' }
    Set-Content -LiteralPath $logPath -Value '' -NoNewline
    $report = Get-SwsdDiagnostics -LogPath $logPath
    Assert-NoDiagnosticToken $report
    if (-not $report.Contains('Log file is empty.')) { throw 'Empty log did not produce a useful diagnostic.' }
    [SwsdDesktop.Credentials]::Remove($target)
    $saved = $false
    if ([SwsdDesktop.Credentials]::Exists($target)) { throw 'Test credential was not removed.' }
    if ((Get-SwsdDiagnostics -LogPath $logPath) -notmatch 'Credential PRESENT: no') { throw 'Removed credential was still reported present.' }
    Write-Output 'PASS: real isolated credential presence, no token fragments in reports, missing/empty logs and credential cleanup.'
} finally {
    try {
        if ($saved) { [SwsdDesktop.Credentials]::Remove($target) }
    } finally {
        # Only remove the explicitly named fixture and its empty test directory.
        if (Test-Path -LiteralPath $logPath) { Remove-Item -LiteralPath $logPath -Force }
        if (Test-Path -LiteralPath $testHome) { Remove-Item -LiteralPath $testHome }
    }
}
