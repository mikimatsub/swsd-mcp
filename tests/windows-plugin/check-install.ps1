$ErrorActionPreference = 'Stop'
# Make any accidental credential access fail; this check uses no native credentials.
Add-Type -TypeDefinition @'
namespace SwsdDesktop {
  public static class Credentials {
    public static string Read(string target) { throw new System.InvalidOperationException("Credential reads are forbidden in this test."); }
    public static void Save(string target, string secret) { throw new System.InvalidOperationException("Credential writes are forbidden in this test."); }
    public static void Remove(string target) { throw new System.InvalidOperationException("Credential deletes are forbidden in this test."); }
  }
}
'@
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../plugins/swsd')).Path
. (Join-Path $root 'scripts/Common.ps1')
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('swsd-install-test-' + [guid]::NewGuid().ToString('N'))
$script:SwsdHome = Join-Path $temporary 'home'
$shortcuts = Join-Path $temporary 'shortcuts'
try {
    New-Item -ItemType Directory -Path $shortcuts -Force | Out-Null
    $manifest = Get-Content -LiteralPath (Join-Path $root '.codex-plugin/plugin.json') -Raw | ConvertFrom-Json
    $mcp = Get-Content -LiteralPath (Join-Path $root '.mcp.json') -Raw | ConvertFrom-Json
    if ($manifest.version -ne $script:SwsdClientVersion) { throw 'Plugin and client versions differ.' }
    if ($mcp.mcpServers.swsd.args[-1] -notlike "*client/$script:SwsdClientVersion/Start-Swsd.ps1*") { throw 'MCP manifest points to a different client version.' }

    # Reject an old recipe before creating any runtime/client files.
    $stale = Join-Path $temporary 'stale-source'
    New-Item -ItemType Directory -Path (Join-Path $stale 'runtime') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $root 'runtime/package-lock.json') -Destination (Join-Path $stale 'runtime')
    '{"dependencies":{"swsd-mcp":"0.0.0-test-only"}}' | Set-Content -LiteralPath (Join-Path $stale 'runtime/package.json')
    $rejected = $false
    try { Install-SwsdTools -SourceRoot $stale -ShortcutDirectory $shortcuts } catch {
        if ($_.Exception.Message -notlike 'The SWSD runtime recipe does not match*') { throw }
        $rejected = $true
    }
    if (-not $rejected -or (Test-Path -LiteralPath $script:SwsdHome)) { throw 'A stale recipe was not rejected before installation.' }

    Install-SwsdTools -SourceRoot $root -ShortcutDirectory $shortcuts
    $client = Join-Path $script:SwsdHome "client/$script:SwsdClientVersion"
    $package = Get-Content -LiteralPath (Join-Path $script:SwsdHome "runtime/$script:SwsdPackageVersion/node_modules/swsd-mcp/package.json") -Raw | ConvertFrom-Json
    if ($package.version -ne $script:SwsdPackageVersion -or -not (Test-Path -LiteralPath (Get-SwsdEntryPoint))) { throw 'Pinned server was not installed.' }
    foreach ($name in @('Common.ps1','Manage-Swsd.ps1','Start-Swsd.ps1')) {
        if ((Get-FileHash -LiteralPath (Join-Path $root "scripts/$name")).Hash -ne (Get-FileHash -LiteralPath (Join-Path $client $name)).Hash) { throw "Installed $name differs from source." }
    }
    foreach ($name in @('package.json','package-lock.json')) {
        if ((Get-FileHash -LiteralPath (Join-Path $root "runtime/$name")).Hash -ne (Get-FileHash -LiteralPath (Join-Path $client "runtime/$name")).Hash) { throw "Repair recipe $name differs from source." }
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $shortcuts 'SolarWinds Service Desk Setup.lnk'))
    if ($shortcut.TargetPath -ne (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe')) { throw 'Shortcut targets the wrong executable.' }
    if ($shortcut.Arguments -ne ('-NoProfile -STA -WindowStyle Hidden -File "' + (Join-Path $client 'Manage-Swsd.ps1') + '"')) { throw 'Shortcut targets the wrong setup script.' }
    if ($shortcut.Arguments -match 'ExecutionPolicy') { throw 'Shortcut must not override script execution policy.' }

    # Reinstall from the same retained recipe used by Start menu repair.
    $repair = Join-Path $temporary 'repair-source'
    New-Item -ItemType Directory -Path (Join-Path $repair 'scripts') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $repair 'runtime') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $client 'Common.ps1'), (Join-Path $client 'Manage-Swsd.ps1'), (Join-Path $client 'Start-Swsd.ps1') -Destination (Join-Path $repair 'scripts')
    Copy-Item -LiteralPath (Join-Path $client 'runtime/package.json'), (Join-Path $client 'runtime/package-lock.json') -Destination (Join-Path $repair 'runtime')
    Save-SwsdSettings -BaseUrl 'https://apieu.samanage.com' -Profile 'knowledge'
    $settingsHash = (Get-FileHash -LiteralPath (Join-Path $script:SwsdHome 'settings.json')).Hash
    Install-SwsdTools -SourceRoot $repair -ShortcutDirectory $shortcuts
    if ((Get-FileHash -LiteralPath (Join-Path $script:SwsdHome 'settings.json')).Hash -ne $settingsHash) { throw 'Repair changed saved settings.' }
    Write-Output "PASS: isolated install and repair preserve settings, install server $script:SwsdPackageVersion and client $script:SwsdClientVersion, retain exact repair files and create the expected shortcut without credential access or policy overrides."
} finally {
    $resolved = [IO.Path]::GetFullPath($temporary)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notmatch '^swsd-install-test-[a-f0-9]{32}$') { throw 'Unsafe temporary cleanup path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
