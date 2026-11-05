$ErrorActionPreference='Stop'
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('swsd-launcher-test-'+[guid]::NewGuid().ToString('N'))
$originalProfileFile=$env:SWSD_PROFILE_FILE; $originalTools=$env:SWSD_TOOLS
try {
    New-Item -ItemType Directory -Path $temporary | Out-Null
    . (Join-Path $PSScriptRoot '../../plugins/swsd/scripts/Common.ps1')
    $script:SwsdHome=$temporary
    $common=(Resolve-Path (Join-Path $PSScriptRoot '../../plugins/swsd/scripts/Common.ps1')).Path.Replace("'","''")
    @"
Add-Type -TypeDefinition @'
namespace SwsdDesktop {
  public static class Credentials {
    public static string Read(string target) { return "synthetic-launcher-credential"; }
  }
}
'@
"@ | Set-Content -LiteralPath (Join-Path $temporary 'Common.ps1') -Encoding UTF8
    Add-Content -LiteralPath (Join-Path $temporary 'Common.ps1') -Value (". '$common'" + [Environment]::NewLine + '$script:SwsdHome=$PSScriptRoot') -Encoding UTF8
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../../plugins/swsd/scripts/Start-Swsd.ps1') -Destination $temporary
    $recipe=Get-Content (Join-Path $PSScriptRoot '../../plugins/swsd/runtime/package.json') -Raw | ConvertFrom-Json
    $runtime=Join-Path $temporary ('runtime/'+$recipe.dependencies.'swsd-mcp'+'/node_modules/swsd-mcp')
    New-Item -ItemType Directory -Path (Join-Path $runtime 'dist') -Force | Out-Null
    @{version=$recipe.dependencies.'swsd-mcp'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'package.json')
    @'
const custom = process.env.SWSD_PROFILE === 'custom'
  ? JSON.parse(require('node:fs').readFileSync(process.env.SWSD_PROFILE_FILE, 'utf8')) : null;
console.log(JSON.stringify({profile:process.env.SWSD_PROFILE, file:process.env.SWSD_PROFILE_FILE || null, tools:process.env.SWSD_TOOLS || null, name:custom?.name}));
'@ | Set-Content -LiteralPath (Join-Path $runtime 'dist/cli.js') -Encoding ASCII
    $profilePath=(Save-SwsdCustomProfile ([pscustomobject]@{name='Launcher test';version=1;tools=@('swsd_get_incident')})).path
    foreach ($profile in @('custom','triage','agent','knowledge','operations','full')) {
        $settings=@{baseUrl='https://api.samanage.com'; profile=$profile}
        if ($profile -eq 'custom') {$settings.profileFile=$profilePath}
        $settings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $temporary 'settings.json')
        $env:SWSD_PROFILE_FILE='stale-profile-file'; $env:SWSD_TOOLS='stale-tool-override'
        $output=& powershell.exe -NoProfile -NonInteractive -File (Join-Path $temporary 'Start-Swsd.ps1') 2>&1
        if ($LASTEXITCODE -ne 0) {throw ('Launcher failed: '+$output)}
        $actual=$output | ConvertFrom-Json
        if ($actual.profile -ne $profile -or $actual.tools) {throw 'Launcher did not configure profile or clear SWSD_TOOLS.'}
        if (($profile -eq 'custom' -and $actual.file -ne $profilePath) -or ($profile -ne 'custom' -and $actual.file)) {throw 'Launcher retained or omitted SWSD_PROFILE_FILE.'}
        if ($profile -eq 'custom' -and $actual.name -ne 'Launcher test') {throw 'Node could not parse the saved profile.'}
        if (($output -join '') -match 'synthetic-launcher-credential') {throw 'Launcher leaked its credential.'}
    }
    Write-Output 'PASS: actual launcher sets custom profile/file and clears stale overrides for all built-in profiles; temporary home and fake credential reader only.'
} finally {
    $env:SWSD_PROFILE_FILE=$originalProfileFile; $env:SWSD_TOOLS=$originalTools
    $resolved=[IO.Path]::GetFullPath($temporary)
    $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
    if (-not $resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^swsd-launcher-test-[a-f0-9]{32}$') {throw 'Unsafe launcher-test cleanup path.'}
    if (Test-Path -LiteralPath $resolved) {Remove-Item -LiteralPath $resolved -Recurse -Force}
}
