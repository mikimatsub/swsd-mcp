$ErrorActionPreference = 'Stop'
# Any credential call is a test failure. No network client or real installer is used.
Add-Type -TypeDefinition @'
namespace SwsdDesktop {
  public static class Credentials {
    public static bool Exists(string target) { throw new System.InvalidOperationException("Credential access is forbidden."); }
    public static string Read(string target) { throw new System.InvalidOperationException("Credential access is forbidden."); }
    public static void Save(string target, string secret) { throw new System.InvalidOperationException("Credential access is forbidden."); }
    public static void Remove(string target) { throw new System.InvalidOperationException("Credential access is forbidden."); }
  }
}
'@
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../plugins/swsd')).Path
. (Join-Path $root 'scripts/Common.ps1')
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('swsd-update-test-' + [guid]::NewGuid().ToString('N'))
$script:SwsdHome = Join-Path $temporary 'home'
$mockBin = Join-Path $temporary 'mock bin'
$slowNpmPidPath = Join-Path $mockBin 'npm-pid.txt'
$oldNpm = $env:SWSD_NPM
$oldWinget = $env:SWSD_WINGET
# Point at missing doubles immediately; a setup failure must never fall back to real tools.
$env:SWSD_NPM = Join-Path $mockBin 'npm-cli.js'
$env:SWSD_WINGET = Join-Path $mockBin 'winget.cmd'
function Assert-Fails([scriptblock]$Action, [string]$Message) {
    $failed = $false
    try { & $Action } catch {
        if ($_.Exception.Message -notlike "*$Message*") { throw }
        $failed = $true
    }
    if (-not $failed) { throw "Expected failure: $Message" }
}
try {
    New-Item -ItemType Directory -Path $mockBin -Force | Out-Null
    New-Item -ItemType Directory -Path $script:SwsdHome -Force | Out-Null
    foreach ($case in @(
        @('3.1.1','3.1.1','current'), @('3.1.1','3.2.0','update'),
        @('3.2.0','3.1.1','newer'), @('3.9.0','3.10.0','update'),
        @('','3.1.1','unknown'), @('3.1.1','','unknown'), @('invalid','3.1.1','unknown')
    )) {
        if ((Compare-SwsdVersion -Installed $case[0] -Latest $case[1]) -ne $case[2]) { throw 'Version comparison failed.' }
    }
    if ($null -ne (Get-SwsdInstalledVersion)) { throw 'Missing runtime should have no installed version.' }
    $runtimeDir = Join-Path $script:SwsdHome "runtime\$script:SwsdPackageVersion\node_modules\swsd-mcp"
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $manifest = Join-Path $runtimeDir 'package.json'
    '{invalid-json' | Set-Content -LiteralPath $manifest
    if ($null -ne (Get-SwsdInstalledVersion)) { throw 'Malformed manifest should have no installed version.' }
    @{ version = $script:SwsdPackageVersion } | ConvertTo-Json | Set-Content -LiteralPath $manifest
    if ((Get-SwsdInstalledVersion) -ne $script:SwsdPackageVersion) { throw 'Installed version did not match the manifest.' }

    # JavaScript doubles run through Get-SwsdNode and cover npm-cli.js paths with spaces.
    $mockNpm = $env:SWSD_NPM
    @'
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'npm-args.txt'), process.argv.slice(2).join(' '));
console.log('3.2.0');
'@ | Set-Content -LiteralPath $mockNpm -Encoding ASCII
    if ((Get-SwsdLatestVersion) -ne '3.2.0') { throw 'Mock npm lookup failed.' }
    if ((Get-Content -LiteralPath (Join-Path $mockBin 'npm-args.txt') -Raw).Trim() -ne 'view swsd-mcp version') { throw 'Wrong npm lookup arguments.' }
    foreach ($output in @('invalid', '3.2.0-rc.1', '3.2.0 garbage')) {
        "console.log('$output');" | Set-Content -LiteralPath $mockNpm -Encoding ASCII
        if ($null -ne (Get-SwsdLatestVersion)) { throw 'Invalid registry response was accepted.' }
    }
    @("console.error('synthetic-error');", 'process.exitCode = 1;') | Set-Content -LiteralPath $mockNpm -Encoding ASCII
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    if ($null -ne (Get-SwsdLatestVersion)) { throw 'Offline npm must return null.' }
    if ($stopwatch.ElapsedMilliseconds -gt 5000) { throw 'Offline npm did not return promptly.' }
    $env:SWSD_NPM = Join-Path $mockBin 'missing-npm-cli.js'
    if ($null -ne (Get-SwsdLatestVersion)) { throw 'Missing npm must return null without fallback.' }

    # Command construction must be pure: even a present winget double must never be queried.
    $mockWinget = $env:SWSD_WINGET
    @'
@echo off
> "%~dp0winget-args.txt" echo %*
exit /b 0
'@ | Set-Content -LiteralPath $mockWinget -Encoding ASCII
    $expectedArguments = 'install --id OpenJS.NodeJS.LTS --version 24.22.1 --exact --silent --accept-package-agreements --accept-source-agreements'
    if ((Get-SwsdNodeInstallCommand) -ne "winget $expectedArguments") { throw 'Node helper must pin exactly 24.22.1.' }
    $wingetLog = Join-Path $mockBin 'winget-args.txt'
    if (Test-Path -LiteralPath $wingetLog) { throw 'Command construction launched winget.' }
    Install-SwsdNode
    if ((Get-Content -LiteralPath $wingetLog -Raw).Trim() -ne $expectedArguments) { throw 'Node install did not pass the exact pinned arguments.' }
    @('@echo off', 'echo synthetic-error 1>&2', 'exit /b 1') | Set-Content -LiteralPath $mockWinget -Encoding ASCII
    Assert-Fails { Install-SwsdNode } 'Node.js installation failed'
    $env:SWSD_WINGET = Join-Path $mockBin 'missing-winget.cmd'
    Assert-Fails { Install-SwsdNode } 'Windows Package Manager is unavailable'

    # Record the real Node child's PID so an immediate launch failure cannot pass as a timeout.
    @'
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'npm-pid.txt'), String(process.pid));
setTimeout(() => {}, 30000);
'@ | Set-Content -LiteralPath $mockNpm -Encoding ASCII
    $env:SWSD_NPM = $mockNpm
    $stopwatch.Restart()
    if ($null -ne (Get-SwsdLatestVersion -TimeoutSeconds 1)) { throw 'Timed-out lookup must return null.' }
    if ($stopwatch.ElapsedMilliseconds -gt 5000) { throw 'Lookup timeout did not bound the wait.' }
    if ($stopwatch.ElapsedMilliseconds -lt 1000) { throw 'Lookup returned before the timeout.' }
    $slowNpmProcessId = [int](Get-Content -LiteralPath $slowNpmPidPath -Raw)
    if (Get-Process -Id $slowNpmProcessId -ErrorAction SilentlyContinue) { throw 'Timed-out npm child is still running.' }

    # Winget still launches a native tool; use a sleeping double without any network access.
    $slowTool = Join-Path $mockBin 'slow-tool.exe'
    Add-Type -OutputAssembly $slowTool -OutputType ConsoleApplication -TypeDefinition @'
public static class SlowTool {
  public static void Main(string[] args) { System.Threading.Thread.Sleep(30000); }
}
'@
    $env:SWSD_WINGET = $slowTool
    $stopwatch.Restart()
    Assert-Fails { Install-SwsdNode -TimeoutSeconds 1 } 'Node.js installation timed out'
    if ($stopwatch.ElapsedMilliseconds -gt 5000) { throw 'Node timeout did not bound the wait.' }

    # Invoke the actual installer: matching installs must skip npm but still refresh all client files.
    $script:MockNode = Join-Path $mockBin 'node.cmd'
    @'
@echo off
> "%~dp0install-called.txt" echo called
exit /b 1
'@ | Set-Content -LiteralPath $script:MockNode -Encoding ASCII
    function Get-SwsdNode { return $script:MockNode }
    $npmCli = Join-Path $mockBin 'node_modules\npm\bin\npm-cli.js'
    New-Item -ItemType Directory -Path (Split-Path $npmCli) -Force | Out-Null
    '// synthetic npm placeholder; never executed' | Set-Content -LiteralPath $npmCli
    $shortcuts = Join-Path $temporary 'shortcuts'
    New-Item -ItemType Directory -Path $shortcuts -Force | Out-Null
    $entryPoint = Get-SwsdEntryPoint
    New-Item -ItemType Directory -Path (Split-Path $entryPoint) -Force | Out-Null
    '// synthetic entry point' | Set-Content -LiteralPath $entryPoint
    Copy-Item -LiteralPath (Join-Path $root 'runtime/package-lock.json') -Destination (Join-Path $script:SwsdHome "runtime\$script:SwsdPackageVersion\package-lock.json")
    Save-SwsdSettings -BaseUrl 'https://apieu.samanage.com' -Profile 'knowledge'
    $settingsPath = Join-Path $script:SwsdHome 'settings.json'
    $settingsBefore = Get-Content -LiteralPath $settingsPath -Raw
    Install-SwsdTools -SourceRoot $root -ShortcutDirectory $shortcuts
    $installLog = Join-Path $mockBin 'install-called.txt'
    if (Test-Path -LiteralPath $installLog) { throw 'Matching version redundantly ran npm.' }
    $client = Join-Path $script:SwsdHome "client\$script:SwsdClientVersion"
    foreach ($name in @('Common.ps1','Manage-Swsd.ps1','Start-Swsd.ps1')) {
        if ((Get-Content -LiteralPath (Join-Path $client $name) -Raw) -cne (Get-Content -LiteralPath (Join-Path $root "scripts\$name") -Raw)) { throw 'Skipped install did not refresh client scripts.' }
    }
    foreach ($name in @('package.json','package-lock.json')) {
        if ((Get-Content -LiteralPath (Join-Path $client "runtime\$name") -Raw) -cne (Get-Content -LiteralPath (Join-Path $root "runtime\$name") -Raw)) { throw 'Skipped install did not retain the exact recipe.' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $shortcuts 'SolarWinds Service Desk Setup.lnk'))) { throw 'Skipped install did not refresh its shortcut.' }
    if ((Get-Content -LiteralPath $settingsPath -Raw) -cne $settingsBefore) { throw 'Skipped install modified settings.' }
    Assert-Fails { Install-SwsdTools -SourceRoot $root -ShortcutDirectory $shortcuts -Force } 'Tool installation failed'
    if (-not (Test-Path -LiteralPath $installLog)) { throw 'Forced repair did not invoke mocked npm.' }
    Remove-Item -LiteralPath $installLog, $entryPoint -Force
    Assert-Fails { Install-SwsdTools -SourceRoot $root -ShortcutDirectory $shortcuts } 'Tool installation failed'
    if (-not (Test-Path -LiteralPath $installLog)) { throw 'Missing entry point wrongly skipped npm.' }
    Remove-Item -LiteralPath $installLog -Force
    '// synthetic entry point' | Set-Content -LiteralPath $entryPoint
    '{"version":"0.0.1"}' | Set-Content -LiteralPath $manifest
    Assert-Fails { Install-SwsdTools -SourceRoot $root -ShortcutDirectory $shortcuts } 'Tool installation failed'
    if (-not (Test-Path -LiteralPath $installLog)) { throw 'Version mismatch wrongly skipped npm.' }
    Write-Output 'PASS: installed/version comparisons; mocked npm success/offline/invalid/missing/timeout; exact pinned winget success/failure/missing/timeout; actual skip/force/incomplete/mismatch installer paths; client/recipe/shortcut refresh and settings preservation; no internet or real installs.'
} finally {
    $env:SWSD_NPM = $oldNpm
    $env:SWSD_WINGET = $oldWinget
    if (Test-Path -LiteralPath $slowNpmPidPath) {
        Get-Process -Id ([int](Get-Content -LiteralPath $slowNpmPidPath -Raw)) -ErrorAction SilentlyContinue | Stop-Process -Force
    }
    $resolved = [IO.Path]::GetFullPath($temporary)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notmatch '^swsd-update-test-[a-f0-9]{32}$') { throw 'Unsafe temporary cleanup path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
