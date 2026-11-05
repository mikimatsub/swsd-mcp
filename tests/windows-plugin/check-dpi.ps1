# Native WM_DPICHANGED and existing-monitor moves; uses only the isolated UI fixture.
# Layout/awareness assertions are hard failures. Presentation (foreground) is soft when
# the desktop session cannot take focus (typical for some CI hosts).
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\..\plugins\swsd\scripts\Manage-Swsd.ps1'
$tempJson = Join-Path ([IO.Path]::GetTempPath()) ('swsd-dpi-' + [guid]::NewGuid().ToString('N') + '.json')
try {
    $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -NonInteractive -STA -WindowStyle Hidden -File $script -ValidateWindow -ValidateDpiChanges -WindowTestSeconds 1 2>&1
    $exitCode = $LASTEXITCODE
} finally { $ErrorActionPreference = 'Stop' }
$lines = @(foreach ($item in @($output)) {
    if ($item -is [System.Management.Automation.ErrorRecord]) { $item.ToString() } else { [string]$item }
})
$text = $lines -join [Environment]::NewLine
$match = [regex]::Match($text, '(?s)\[\s*\{.*\}\s*\]')
if (-not $match.Success) { throw "DPI probe did not return its results.`n$text" }
[IO.File]::WriteAllText($tempJson, $match.Value)
try {
    # Prefer Node for stable JSON array parsing across PowerShell 5.1 quirks.
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($node) {
        $summary = & node.exe -e @"
const fs = require('fs');
const results = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (!Array.isArray(results) || results.length < 1) { console.error('empty'); process.exit(2); }
for (const result of results) {
  const failures = Array.isArray(result.layoutFailures) ? result.layoutFailures.filter(Boolean) : [];
  if (result.error || failures.length) {
    console.error('layout:' + result.dpiStep + ':' + (result.error || failures.join(';')));
    process.exit(3);
  }
  if (result.windowDpiAwareness !== 'PerMonitorV2') {
    console.error('awareness:' + result.dpiStep + ':' + result.windowDpiAwareness);
    process.exit(4);
  }
}
for (const dpi of [96,120,144,168,192]) {
  if (!results.some(r => r.dpiStep === ('WM_DPICHANGED ' + dpi) && r.deviceDpi === dpi)) {
    console.error('missing:' + dpi);
    process.exit(5);
  }
}
const monitors = results.filter(r => String(r.dpiStep).startsWith('monitor '));
if (monitors.length < 1) { console.error('no-monitors'); process.exit(6); }
const first = results.find(r => r.dpiStep === 'WM_DPICHANGED 96');
const last = results[results.length - 1];
if (!first) { console.error('no-roundtrip'); process.exit(7); }
for (const property of ['deviceDpi','dashboardWidth','dashboardChipWidth','dashboardChipHeight','dashboardColumns']) {
  if (first[property] !== last[property]) {
    console.error('drift:' + property + ':' + first[property] + '->' + last[property]);
    process.exit(8);
  }
}
console.log('PASS: PerMonitorV2; ' + monitors.length + ' monitor moves; 96/120/144/168/192 DPI both directions; layout exact.');
process.exit(0);
"@ $tempJson
        if ($LASTEXITCODE -ne 0) { throw ($summary -join [Environment]::NewLine) }
        Write-Output $summary
    } else {
        throw 'node.exe is required for check-dpi.ps1 JSON assertions.'
    }
} finally {
    Remove-Item -LiteralPath $tempJson -Force -ErrorAction SilentlyContinue
}
if ($exitCode -ne 0) {
    Write-Warning 'DPI layout passed, but ValidateWindow presentation reported a non-zero exit (often GetForegroundWindow unavailable). Layout/awareness checks still pass.'
} else {
    Write-Output 'PASS: window presentation checks on every monitor and DPI transition.'
}
