Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:SwsdPackageVersion = '3.2.0'
$script:SwsdClientVersion = '3.1.0'
$script:SwsdCredentialTarget = 'swsd-mcp/api-token'
$script:SwsdHome = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'swsd-mcp'

# Data-driven profile catalog. picker=$true rows appear in Home/Tools pickers.
# Hidden aliases (picker=$false) keep older saved settings working; aliasOf maps
# them onto a visible profile (full -> operations while Full merges into Operations).
$script:SwsdProfiles = @(
    @{ id = 'triage'; name = 'Triage'; description = 'Review incidents and catalog items, view tasks and problems, and add incident comments.'; picker = $true },
    @{ id = 'agent'; name = 'Agent'; description = 'Everyday ticket handling, tasks, problems, time entries, attachments, and knowledge searches.'; picker = $true },
    @{ id = 'knowledge'; name = 'Knowledge'; description = 'Search, create, and update knowledge articles, with incident and catalog context.'; picker = $true },
    @{ id = 'operations'; name = 'Operations'; description = 'All available tools. Your SolarWinds account permissions still apply.'; picker = $true },
    @{ id = 'full'; name = 'Full'; description = 'Hidden alias for Operations while older installs still store profile=full.'; picker = $false; aliasOf = 'operations' }
)

function Get-SwsdPickerProfiles {
    return @($script:SwsdProfiles | Where-Object { $_.picker }) + @(Get-SwsdCustomProfiles)
}

function Get-SwsdAssetRoot {
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'assets/tool-catalog.json')) { return Join-Path $PSScriptRoot 'assets' }
    return Join-Path (Split-Path $PSScriptRoot) 'assets'
}

function Read-SwsdProfileFile([string]$Path) {
    try {
        if (-not [IO.Path]::IsPathRooted($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'missing' }
        if ((Get-Item -LiteralPath $Path).Length -gt 256KB) { throw 'too large' }
        $value = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
        return ConvertTo-SwsdValidatedProfile $value
    } catch {
        if ($_.Exception.Message -like 'Profile JSON:*') { throw }
        throw 'Profile JSON: Choose an existing, valid JSON profile file.'
    }
}

function ConvertTo-SwsdValidatedProfile($Value) {
    # Mirrors schemas/swsd-profile.schema.json (draft 2020-12), including exact key case.
    if ($null -eq $Value -or $Value -isnot [pscustomobject]) { throw 'Profile JSON: Expected an object with name, version, and tools.' }
    $keys = @($Value.PSObject.Properties.Name)
    foreach ($key in $keys) {
        if (@('name','version','tools','description') -cnotcontains $key) { throw 'Profile JSON: Only name, version, tools, and optional description are allowed.' }
    }
    foreach ($key in @('name','version','tools')) {
        if ($keys -cnotcontains $key) { throw "Profile JSON: The $key field is required." }
    }
    if ($Value.name -isnot [string] -or $Value.name.Length -gt 80 -or $Value.name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9 _.-]*$') {
        throw 'Profile JSON: Use a name of 1 to 80 letters, numbers, spaces, underscores, dots, or hyphens, starting with a letter or number.'
    }
    if (($Value.version -isnot [int] -and $Value.version -isnot [long] -and $Value.version -isnot [double] -and $Value.version -isnot [decimal]) -or $Value.version -ne 1) { throw 'Profile JSON: version must be the number 1.' }
    if ($Value.tools -isnot [array] -or $Value.tools.Count -gt 512) { throw 'Profile JSON: tools must be an array with at most 512 names.' }
    foreach ($tool in $Value.tools) {
        if ($tool -isnot [string] -or $tool.Length -eq 0 -or [regex]::Matches($tool, '[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]').Count -gt 128) { throw 'Profile JSON: Each tool must be a string of 1 to 128 characters.' }
    }
    $result = [ordered]@{ name=$Value.name; version=1; tools=@($Value.tools) }
    if ($keys -ccontains 'description') {
        if ($Value.description -isnot [string] -or [regex]::Matches($Value.description, '[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]').Count -gt 2048) { throw 'Profile JSON: description must be a string of at most 2048 characters.' }
        $result.description=$Value.description
    }
    return [pscustomobject]$result
}

function Get-SwsdCustomProfiles {
    $directory = Join-Path $script:SwsdHome 'profiles'
    if (-not (Test-Path -LiteralPath $directory)) { return @() }
    return @(Get-ChildItem -LiteralPath $directory -Filter '*.json' -File | ForEach-Object {
        try {
            $value = Read-SwsdProfileFile $_.FullName
            # Built-in names are reserved, including the hidden legacy alias.
            if ($value.name -notin @($script:SwsdProfiles.name)) {
                @{ id=('custom:' + $_.BaseName); name=$value.name; description=$(if ($value.PSObject.Properties['description']) {$value.description} else {'Your selected tools'}); profileFile=$_.FullName; tools=@($value.tools); picker=$true }
            }
        } catch { # A damaged custom file must not prevent opening setup.
        }
    } | Sort-Object { $_.name })
}

function Save-SwsdCustomProfile {
    param([Parameter(Mandatory)]$Value, [string]$PreviousPath)
    $profile = ConvertTo-SwsdValidatedProfile $Value
    if ($profile.name -in @($script:SwsdProfiles.name)) { throw 'Profile JSON: Choose a name different from the built-in profiles.' }
    $catalog = Get-Content -LiteralPath (Join-Path (Get-SwsdAssetRoot) 'tool-catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $unknown = @($profile.tools | Where-Object { @($catalog.name) -cnotcontains $_ } | Select-Object -Unique)
    $profile.tools = @($profile.tools | Where-Object { @($catalog.name) -ccontains $_ })
    $directory = Join-Path $script:SwsdHome 'profiles'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $safe = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($profile.name.ToLowerInvariant()))).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
    $path = Join-Path $directory ($safe + '.json')
    if ($PreviousPath -and $PreviousPath -ne $path -and (Test-Path -LiteralPath $path)) { throw 'Profile JSON: A profile with that name already exists. Choose another name.' }
    $temporary = Join-Path $directory ([guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $settings=Get-SwsdSettings
        if ($profile.tools.Count -eq 0 -and $settings.profile -eq 'custom' -and $settings.profileFile -eq $path) {throw 'Profile JSON: Select at least one known tool for your active custom profile.'}
        # Node's JSON.parse does not accept a UTF-8 BOM (PS 5.1's UTF8 encoding).
        [IO.File]::WriteAllText($temporary, ($profile | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $path -Force
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
    if ($PreviousPath -and $PreviousPath -ne $path) {
        $settings = Get-SwsdSettings
        if ($settings.profile -eq 'custom' -and $settings.profileFile -eq $PreviousPath) { Save-SwsdSettings -BaseUrl $settings.baseUrl -Profile custom -ProfileFile $path }
        Remove-SwsdCustomProfile -Path $PreviousPath
    }
    return @{ path=$path; profile=$profile; skipped=$unknown; notice=$(if ($unknown.Count) {'Unknown tools skipped: ' + ($unknown -join ', ')} else {''}) }
}

function Import-SwsdCustomProfile([string]$Path) { return Save-SwsdCustomProfile -Value (Read-SwsdProfileFile $Path) }
function Export-SwsdCustomProfile([string]$Path, [string]$Destination) {
    $value = Read-SwsdProfileFile $Path
    [IO.File]::WriteAllText($Destination, ($value | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
}
function Remove-SwsdCustomProfile([string]$Path) {
    $directory = [IO.Path]::GetFullPath((Join-Path $script:SwsdHome 'profiles'))
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path)) -ne $directory -or [IO.Path]::GetExtension($Path) -ne '.json') { throw 'Profile JSON: Choose a saved custom profile.' }
    $settings = Get-SwsdSettings
    if ($settings.profile -eq 'custom' -and $settings.profileFile -eq $Path) { Save-SwsdSettings -BaseUrl $settings.baseUrl -Profile agent }
    Remove-Item -LiteralPath $Path -Force
}

function Resolve-SwsdProfileId([string]$Id) {
    $row = $script:SwsdProfiles | Where-Object { $_.id -eq $Id } | Select-Object -First 1
    if (-not $row) { return $Id }
    if ($row -is [hashtable]) {
        if ($row.ContainsKey('aliasOf') -and $row['aliasOf']) { return [string]$row['aliasOf'] }
        return $Id
    }
    $prop = $row.PSObject.Properties['aliasOf']
    if ($prop -and $prop.Value) { return [string]$prop.Value }
    return $Id
}

function Get-SwsdProfileRow([string]$Id) {
    if ($Id -eq 'custom' -or $Id.StartsWith('custom:')) {
        $path = if ($Id -eq 'custom') {(Get-SwsdSettings).profileFile} else {''}
        $row=Get-SwsdCustomProfiles | Where-Object { $_.id -eq $Id -or ($path -and $_.profileFile -eq $path) } | Select-Object -First 1
        if ($row) {return $row}
        if ($path) {
            $value=Read-SwsdProfileFile $path
            return @{id='custom'; name=$(if ($value.name -eq 'full') {'Operations'} else {$value.name}); description=$(if ($value.PSObject.Properties['description']) {$value.description} else {'Your selected tools'}); profileFile=$path; tools=@($value.tools)}
        }
        return $null
    }
    $resolved = Resolve-SwsdProfileId $Id
    return $script:SwsdProfiles | Where-Object { $_.id -eq $resolved } | Select-Object -First 1
}

function Get-SwsdProfileDisplayName([string]$Id) {
    $row = Get-SwsdProfileRow $Id
    if ($row) { return [string]$row.name }
    return (Get-Culture).TextInfo.ToTitleCase($Id)
}
# Credential values never travel through command arguments, stdout, or configuration files.
if (-not ('SwsdDesktop.Credentials' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace SwsdDesktop {
  public static class Credentials {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct Credential {
      public uint Flags, Type;
      public string TargetName, Comment;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
      public uint CredentialBlobSize;
      public IntPtr CredentialBlob;
      public uint Persist, AttributeCount;
      public IntPtr Attributes;
      public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool ReadNative(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool WriteNative(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool DeleteNative(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr pointer);
    // Presence-only dashboard probe. Never dereference CredentialBlob or materialize a secret.
    // CredEnumerateW returns a prefix-filtered array; check the exact target and generic type.
    [DllImport("advapi32.dll", EntryPoint="CredEnumerateW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool EnumerateNative(string filter, uint flags, out uint count, out IntPtr credentials);
    public static bool Exists(string target) {
      uint count;
      IntPtr pointers;
      if (!EnumerateNative(target + "*", 0, out count, out pointers)) {
        int error = Marshal.GetLastWin32Error();
        if (error == 1168) return false;
        throw new Win32Exception(error);
      }
      try {
        for (int i = 0; i < count; i++) {
          IntPtr pointer = Marshal.ReadIntPtr(pointers, i * IntPtr.Size);
          Credential metadata = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
          if (metadata.Type == 1 && String.Equals(metadata.TargetName, target, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
      } finally { CredFree(pointers); }
    }
    public static string Read(string target) {
      IntPtr pointer;
      if (!ReadNative(target, 1, 0, out pointer)) {
        int error = Marshal.GetLastWin32Error();
        if (error == 1168) return null;
        throw new Win32Exception(error);
      }
      try {
        Credential value = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
        return Marshal.PtrToStringUni(value.CredentialBlob, (int)value.CredentialBlobSize / 2);
      } finally { CredFree(pointer); }
    }
    public static void Save(string target, string secret) {
      if (String.IsNullOrWhiteSpace(secret) || secret.Length * 2 > 2560)
        throw new ArgumentException("Token is empty or exceeds Windows Credential Manager's supported size.");
      IntPtr blob = Marshal.StringToCoTaskMemUni(secret);
      try {
        Credential value = new Credential();
        value.Type = 1; value.TargetName = target;
        value.UserName = Environment.UserName;
        value.Comment = "SWSD JSON Web Token";
        value.CredentialBlob = blob; value.CredentialBlobSize = (uint)secret.Length * 2;
        value.Persist = 2;
        if (!WriteNative(ref value, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
      } finally { Marshal.ZeroFreeCoTaskMemUnicode(blob); }
    }
    public static void Remove(string target) {
      if (!DeleteNative(target, 1, 0)) {
        int error = Marshal.GetLastWin32Error();
        if (error != 1168) throw new Win32Exception(error);
      }
    }
  }
}
'@
}

function Get-SwsdSettings {
    $path = Join-Path $script:SwsdHome 'settings.json'
    $settings = @{ baseUrl = 'https://api.samanage.com'; profile = 'agent'; profileFile = $null; profileError = $null; theme = 'system' }
    if (Test-Path -LiteralPath $path) {
        $saved = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ($saved.baseUrl -notin @('https://api.samanage.com', 'https://apieu.samanage.com')) {
            throw 'Invalid SWSD region in settings. Open SWSD setup and save the correct region.'
        }
        $settings.baseUrl = $saved.baseUrl
        if ($saved.PSObject.Properties['profile']) {
            if ($saved.profile -notin @('triage','agent','knowledge','operations','full','custom')) {
                throw 'Invalid saved SWSD profile. Open SWSD setup and save a supported profile.'
            }
            $settings.profile = $saved.profile
            if ($saved.profile -eq 'custom') {
                try {
                    if (-not $saved.PSObject.Properties['profileFile']) { throw 'missing' }
                    $null = Read-SwsdProfileFile $saved.profileFile
                    $settings.profileFile = [IO.Path]::GetFullPath($saved.profileFile)
                } catch {
                    $settings.profile = 'agent'
                    $settings.profileError = 'Your custom profile could not be opened. Choose or import a valid profile on Tools, then select it again.'
                }
            }
        }
        if ($saved.PSObject.Properties['theme'] -and $saved.theme -in @('system','light','dark')) { $settings.theme = $saved.theme }
    }
    return $settings
}

function Save-SwsdSettings {
    param(
        [Parameter(Mandatory)][ValidateSet('https://api.samanage.com','https://apieu.samanage.com')][string]$BaseUrl,
        [Parameter(Mandatory)][ValidateSet('triage','agent','knowledge','operations','full','custom')][string]$Profile,
        [string]$ProfileFile,
        [ValidateSet('system','light','dark')][string]$Theme
    )
    New-Item -ItemType Directory -Path $script:SwsdHome -Force | Out-Null
    $temporary = Join-Path $script:SwsdHome ('settings-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        if (-not $Theme) { $Theme = (Get-SwsdSettings).theme }
        $value = @{ baseUrl = $BaseUrl; profile = $Profile; theme = $Theme }
        if ($Profile -eq 'custom') {
            if (-not $ProfileFile) { $ProfileFile = (Get-SwsdSettings).profileFile }
            $null = Read-SwsdProfileFile $ProfileFile
            $value.profileFile = [IO.Path]::GetFullPath($ProfileFile)
        }
        $value | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
        Move-Item -LiteralPath $temporary -Destination (Join-Path $script:SwsdHome 'settings.json') -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Save-SwsdProfile {
    param([Parameter(Mandatory)][ValidateSet('triage','agent','knowledge','operations','full','custom')][string]$Profile, [string]$ProfileFile)
    $settings = Get-SwsdSettings
    if ($Profile -eq 'custom') {
        $value=Read-SwsdProfileFile $ProfileFile
        $catalog=Get-Content -LiteralPath (Join-Path (Get-SwsdAssetRoot) 'tool-catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not @($value.tools | Where-Object {@($catalog.name) -ccontains $_}).Count) {throw 'Profile JSON: Select at least one known tool before using this profile.'}
    }
    Save-SwsdSettings -BaseUrl $settings.baseUrl -Profile $Profile -ProfileFile $ProfileFile
}

function Get-SwsdNode {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Node.js 24.15 or newer within version 24 is required. Ask IT to install Node.js 24, then reopen this window.' }
    $version = [version]((& $node.Source --version).Trim().TrimStart('v'))
    if ($version.Major -ne 24 -or $version -lt [version]'24.15.0') {
        throw 'This SWSD release requires Node.js 24.15 or newer within version 24. Ask IT to install the supported version.'
    }
    return $node.Source
}

function Get-SwsdEntryPoint {
    $version = Get-SwsdActiveVersion
    return Join-Path $script:SwsdHome "runtime\$version\node_modules\swsd-mcp\dist\cli.js"
}

function Get-SwsdActiveVersion {
    $path = Join-Path $script:SwsdHome 'runtime\active.txt'
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $value = (Get-Content -LiteralPath $path -Raw).Trim()
        if ($value -match '^\d+\.\d+\.\d+$') { return $value }
    }
    return $script:SwsdPackageVersion
}

function Set-SwsdActiveVersion([string]$Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Tool installation failed: The requested version is invalid.' }
    $runtime = Join-Path $script:SwsdHome "runtime\$Version"
    $pkg = Get-Content -LiteralPath (Join-Path $runtime 'node_modules\swsd-mcp\package.json') -Raw | ConvertFrom-Json
    if ($pkg.version -ne $Version -or -not (Test-Path -LiteralPath (Join-Path $runtime 'node_modules\swsd-mcp\dist\cli.js') -PathType Leaf)) { throw 'The SWSD server installation is incomplete.' }
    $temporary = Join-Path $script:SwsdHome ('runtime\active-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        Set-Content -LiteralPath $temporary -Value $Version -Encoding ASCII
        $active=Join-Path $script:SwsdHome 'runtime\active.txt'
        if (Test-Path -LiteralPath $active -PathType Leaf) { [IO.File]::Replace($temporary,$active,(Join-Path $script:SwsdHome 'runtime\previous.txt')) }
        else { [IO.File]::Move($temporary,$active) }
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Test-SwsdToken {
    param([Parameter(Mandatory)][string]$Token, [Parameter(Mandatory)][string]$BaseUrl)
    if ($BaseUrl -notin @('https://api.samanage.com', 'https://apieu.samanage.com')) { throw 'Unsupported API region.' }
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    try {
        $client.DefaultRequestHeaders.Add('X-Samanage-Authorization', "Bearer $Token")
        $client.DefaultRequestHeaders.Add('Accept', 'application/vnd.samanage.v2.1+json')
        $response = $client.GetAsync("$BaseUrl/incidents.json?per_page=1").GetAwaiter().GetResult()
        try {
            if (-not $response.IsSuccessStatusCode) {
                $status = [int]$response.StatusCode
                if ($status -eq 401) { throw 'SolarWinds rejected this token (401). Supply a valid JSON Web Token.' }
                if ($status -eq 403) { throw 'SolarWinds denied incident access (403). Ask your SWSD administrator to review your account permissions.' }
                throw "SolarWinds returned HTTP $status. Check the region and service availability."
            }
        } finally { $response.Dispose() }
    } catch {
        # Never surface request headers, response bodies, or arbitrary exception text.
        if ($_.Exception.Message -match '^SolarWinds ') { throw $_.Exception.Message }
        throw 'Connection failed. Check network access, proxy settings, and the selected SWSD region.'
    } finally { $client.Dispose(); $handler.Dispose() }
}

function Get-SwsdVerifiedIdentity {
    param([Parameter(Mandatory)][string]$Token, [Parameter(Mandatory)][string]$BaseUrl)
    # Called only after Test-SwsdToken succeeds. This is display metadata, never proof
    # of authentication. Endpoint/claims/shape match src/tools/utility/getMe.ts and
    # src/swsd/{jwt.ts,mappers/me.ts}. Site is optional; no organization is invented.
    if ($BaseUrl -notin @('https://api.samanage.com','https://apieu.samanage.com')) { return $null }
    $client=$null; $handler=$null; $response=$null
    try {
        $parts=$Token.Split('.')
        if ($parts.Count -ne 3) { return $null }
        $payload=$parts[1].Replace('-','+').Replace('_','/')
        $payload=$payload.PadRight($payload.Length + ((4-$payload.Length%4)%4),'=')
        $claims=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
        $userId=$null
        foreach ($field in @('user_id','user_ic')) {
            if ($claims.PSObject.Properties[$field] -and [string]$claims.$field -match '^\d+$') { $userId=[string]$claims.$field; break }
        }
        if (-not $userId) { return $null }
        Add-Type -AssemblyName System.Net.Http
        $handler=New-Object Net.Http.HttpClientHandler; $handler.AllowAutoRedirect=$false
        $client=New-Object Net.Http.HttpClient($handler); $client.Timeout=[TimeSpan]::FromSeconds(5)
        $client.DefaultRequestHeaders.Add('X-Samanage-Authorization',"Bearer $Token")
        $client.DefaultRequestHeaders.Add('Accept','application/vnd.samanage.v2.1+json')
        $response=$client.GetAsync("$BaseUrl/users/$userId.json").GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { return $null }
        $user=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        if ($user.PSObject.Properties['name'] -and $user.name -is [string] -and $user.name) {
            $display=$user.name
            if ($user.PSObject.Properties['site'] -and $user.site -and $user.site.PSObject.Properties['name'] -and $user.site.name -is [string] -and $user.site.name) { $display+=' · ' + $user.site.name }
            return $display
        }
    } catch { return $null }
    finally { if ($response) {$response.Dispose()}; if ($client) {$client.Dispose()}; if ($handler) {$handler.Dispose()} }
    return $null
}

function Get-SwsdInstalledVersion {
    $version = Get-SwsdActiveVersion
    $packageJson = Join-Path $script:SwsdHome "runtime\$version\node_modules\swsd-mcp\package.json"
    if (-not (Test-Path -LiteralPath $packageJson)) { return $null }
    try {
        $pkg = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json
        if ($pkg.version -eq $version) { return $pkg.version }
        return $null
    } catch { return $null }
}

function Get-SwsdLatestVersion {
    param([ValidateRange(1, 60)][int]$TimeoutSeconds = 10)
    $process = $null
    try {
        $node = Get-SwsdNode
        $npmCli = $env:SWSD_NPM
        if (-not $npmCli) { $npmCli = Join-Path (Split-Path $node) 'node_modules\npm\bin\npm-cli.js' }
        if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { return $null }
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = $node
        $start.Arguments = '"' + $npmCli + '" view swsd-mcp version --registry=https://registry.npmjs.org'
        $start.EnvironmentVariables.Remove('SWSD_TOKEN')
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $start
        [void]$process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            # Framework's Process has only Kill(). npm is launched directly as this
            # owned Node child, so no taskkill process-tree fallback is necessary.
            $process.Kill()
            $process.WaitForExit()
            return $null
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
        [void]$stderrTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { return $null }
        if ($stdout -match '^\d+\.\d+\.\d+$') { return $Matches[0] }
        return $null
    } catch { return $null } finally {
        if ($process) { try { $process.Dispose() } catch {} }
    }
}

function Compare-SwsdVersion {
    param([string]$Installed, [string]$Latest)
    if ([string]::IsNullOrWhiteSpace($Installed) -or [string]::IsNullOrWhiteSpace($Latest)) { return 'unknown' }
    try {
        $iv = [version]$Installed
        $lv = [version]$Latest
        if ($iv -eq $lv) { return 'current' }
        if ($iv -lt $lv) { return 'update' }
        return 'newer'
    } catch { return 'unknown' }
}

function Get-SwsdNodeInstallCommand {
    # Reviewed Node 24 pin: the unversioned LTS package now selects unsupported Node 26.
    return 'winget install --id OpenJS.NodeJS.LTS --version 24.22.1 --exact --silent --accept-package-agreements --accept-source-agreements'
}

function Get-SwsdWinget {
    # Explicit overrides never fall back to a real executable (including missing test doubles).
    if ($env:SWSD_WINGET) {
        if (Test-Path -LiteralPath $env:SWSD_WINGET -PathType Leaf) { return $env:SWSD_WINGET }
        return $null
    }
    $command = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Install-SwsdNode {
    param([ValidateRange(1, 600)][int]$TimeoutSeconds = 300)
    $winget = Get-SwsdWinget
    if (-not $winget) { throw 'Windows Package Manager is unavailable. Ask IT to install Node.js 24.22.1, then reopen setup.' }
    $process = $null
    try {
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = $winget
        $start.Arguments = (Get-SwsdNodeInstallCommand) -replace '^winget\s+', ''
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.EnvironmentVariables.Remove('SWSD_TOKEN')
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $start
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill()
            throw 'Node.js installation timed out. Ask IT to check Windows Package Manager, then reopen setup.'
        }
        [void]$stdout.GetAwaiter().GetResult()
        [void]$stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'Node.js installation failed. Ask IT to install Node.js 24.22.1, then reopen setup.' }
    } finally {
        if ($process) { $process.Dispose() }
    }
}

function Get-SwsdStatus {
    $nodePath = $null
    $nodeVersion = $null
    $nodeSupported = $false
    try {
        $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($nodeCmd) {
            $nodePath = $nodeCmd.Source
            $nodeVersion = (& $nodeCmd.Source --version).Trim().TrimStart('v')
            $parsed = [version]$nodeVersion
            if ($parsed.Major -eq 24 -and $parsed -ge [version]'24.15.0') {
                $nodeSupported = $true
            }
        }
    } catch {}
    $entryPoint = Get-SwsdEntryPoint
    $toolsInstalled = Test-Path -LiteralPath $entryPoint -PathType Leaf
    $installedVersion = $null
    if ($toolsInstalled) {
        try {
            $manifestPath = Join-Path (Split-Path (Split-Path $entryPoint)) 'package.json'
            $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            $installedVersion = [string]$manifest.version
            $toolsInstalled = ($installedVersion -eq (Get-SwsdActiveVersion))
        } catch { $toolsInstalled = $false }
    }
    if (-not $installedVersion) {
        # An older or newer runtime may be installed side by side; report it as needing repair, not missing.
        try {
            $other = Get-ChildItem -LiteralPath (Join-Path $script:SwsdHome 'runtime') -Directory -ErrorAction Stop |
                Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node_modules\swsd-mcp\dist\cli.js') -PathType Leaf } |
                Select-Object -First 1
            if ($other) {
                $otherPkg = Get-Content -LiteralPath (Join-Path $other.FullName 'node_modules\swsd-mcp\package.json') -Raw | ConvertFrom-Json
                if ([string]$otherPkg.version -match '^\d+\.\d+\.\d+$') { $installedVersion = [string]$otherPkg.version }
            }
        } catch {}
    }
    $credentialSaved = $false
    $credentialAvailable = $true
    try { $credentialSaved = [SwsdDesktop.Credentials]::Exists($script:SwsdCredentialTarget) }
    catch { $credentialAvailable = $false }
    $settings = Get-SwsdSettings
    $regionLabel = if ($settings.baseUrl -eq 'https://apieu.samanage.com') { 'EU' } else { 'US' }
    return [pscustomobject]@{
        nodePath        = $nodePath
        nodeSupported   = $nodeSupported
        nodeVersion     = $nodeVersion
        toolsInstalled  = $toolsInstalled
        credentialSaved = $credentialSaved
        credentialAvailable = $credentialAvailable
        packageVersion  = $script:SwsdPackageVersion
        installedVersion = $installedVersion
        profile         = $settings.profile
        region          = $regionLabel
        baseUrl         = $settings.baseUrl
    }
}

function Protect-SwsdDiagnosticText {
    param([AllowEmptyString()][string]$Text)
    # No saved secret is needed for redaction. Drop sensitive fields (including
    # short/spaced values), then conservatively redact ALL long non-space runs.
    # This catches bare tokens, JWTs, URLs and partial tokens, at the cost of
    # hiding some ordinary long words in the log. Never retain token suffixes.
    $redacted = $Text -replace '(?i)\b(?:authorization|bearer|[\w-]*token|api[_ -]?key|secret|password)\b[^\r\n]*', '[REDACTED]'
    return ($redacted -replace '\S{8,}', '[REDACTED]')
}

function Get-SwsdDiagnostics {
    param(
        [string]$LogPath = (Join-Path $env:TEMP 'swsd-settings.log'),
        [ValidateRange(0, 1536)][double]$Dpi = 0,
        [ValidateRange(0, 16)][double]$Scale = 0,
        [ValidateSet('light', 'dark', 'unknown')][string]$Theme = 'unknown'
    )
    # Get-SwsdStatus uses Credentials.Exists only; never Read, tokenBox, or SWSD_TOKEN.
    # Display measurements are supplied by the caller; this function needs no UI.
    $s = Get-SwsdStatus
    $windowsVersion = [Environment]::OSVersion.Version.ToString()
    $windowsBuild = [string][Environment]::OSVersion.Version.Build
    try {
        $os = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
        $windowsBuild = '{0}.{1}' -f [int]$os.CurrentBuildNumber, [int]$os.UBR
        if ($os.DisplayVersion -match '^\d{2}H[12]$') { $windowsVersion += ' (' + $os.DisplayVersion + ')' }
    } catch {} # Preserve the OS API fallback, never arbitrary exception text.
    $nodePath = if ($s.nodePath) { [string]$s.nodePath -replace '[\x00-\x1f]', '?' } else { 'Not found' }
    $nodeVersion = if ($s.nodeVersion -match '^\d+\.\d+\.\d+$') { $s.nodeVersion } else { 'Unavailable' }
    $toolsVersion = if ($s.installedVersion -match '^\d+\.\d+\.\d+$') { $s.installedVersion } else { 'Not installed / unavailable' }
    $toolsInstalled = if ($s.toolsInstalled) { 'yes' } else { 'no' }
    $credential = if (-not $s.credentialAvailable) { 'unavailable' } elseif ($s.credentialSaved) { 'yes' } else { 'no' }
    $dpiText = if ($Dpi -gt 0) { $Dpi.ToString('0.##', [Globalization.CultureInfo]::InvariantCulture) } else { 'Unavailable (no window supplied)' }
    $displayScaleText = if ($Dpi -gt 0) { ($Dpi / 96 * 100).ToString('0.##', [Globalization.CultureInfo]::InvariantCulture) + '%' } else { 'Unavailable (no window supplied)' }
    $scaleText = if ($Scale -gt 0) { ($Scale * 100).ToString('0.##', [Globalization.CultureInfo]::InvariantCulture) + '%' } else { 'Unavailable (no window supplied)' }
    $logLines = @('No log file found.')
    try {
        if (Test-Path -LiteralPath $LogPath -PathType Leaf) {
            $logLines = @(Get-Content -LiteralPath $LogPath -Tail 20 -Encoding UTF8 | ForEach-Object { Protect-SwsdDiagnosticText $_ })
            if ($logLines.Count -eq 0) { $logLines = @('Log file is empty.') }
        }
    } catch { $logLines = @('Log file unavailable.') }
    return (@(
        'SWSD settings diagnostics'
        ''
        '[Application]'
        "App version: $script:SwsdClientVersion"
        "Package version: $script:SwsdPackageVersion"
        ''
        '[Windows]'
        "Version: $windowsVersion"
        "Build: $windowsBuild"
        ''
        '[PowerShell]'
        "Version: $($PSVersionTable.PSVersion)"
        ''
        '[Node.js]'
        "Path: $nodePath"
        "Version: $nodeVersion"
        ''
        '[Tools]'
        "Installed: $toolsInstalled"
        "Version: $toolsVersion"
        ''
        '[Connection]'
        "Profile: $($s.profile)"
        "Region base URL: $($s.baseUrl)"
        "Credential PRESENT: $credential"
        ''
        '[Display]'
        "DPI: $dpiText"
        "Display scale: $displayScaleText"
        "UI scale: $scaleText"
        "Theme: $Theme"
        ''
        '[Recent log (last 20 lines; redacted)]'
    ) + $logLines) -join [Environment]::NewLine
}

function Set-SwsdClipboard {
    param([Parameter(Mandatory)][string]$Text)
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.Clipboard]::SetText($Text, [Windows.Forms.TextDataFormat]::UnicodeText)
}

function New-SwsdIssueUrl {
    param(
        [ValidateSet('bug','feature')][string]$Kind = 'bug',
        [string]$AppVersion = $script:SwsdClientVersion,
        [string]$ServerVersion = (Get-SwsdInstalledVersion),
        [string]$WindowsVersion = ([Environment]::OSVersion.Version.ToString()),
        [string]$Profile = (Get-SwsdSettings).profile
    )
    # Allowlist values as well as fields: no caller-supplied free text, settings
    # object, credential, base URL, or custom profile path can enter a report URL.
    if ($AppVersion -notmatch '^\d+\.\d+\.\d+$') { $AppVersion = 'unknown' }
    if ($ServerVersion -notmatch '^\d+\.\d+\.\d+$') { $ServerVersion = 'unknown' }
    if ($WindowsVersion -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { $WindowsVersion = 'unknown' }
    if ($Profile -eq 'full') { $Profile='operations' }
    if ($Profile -notin @('triage','agent','knowledge','operations')) { $Profile='custom' }
    $template = if ($Kind -eq 'bug') {'bug_report.yml'} else {'feature_request.yml'}
    $values = [ordered]@{template=$template; app_version=$AppVersion; server_version=$ServerVersion; windows_version=$WindowsVersion; profile=$Profile}
    return 'https://github.com/mikimatsub/swsd-mcp/issues/new?' + ((@($values.Keys | ForEach-Object { $_ + '=' + [Uri]::EscapeDataString($values[$_]) })) -join '&')
}

function Get-SwsdReleaseNotes([string]$AssetRoot = (Get-SwsdAssetRoot)) {
    # Bundled content only: opening What's new never depends on a network request.
    $path = Join-Path $AssetRoot 'CHANGELOG.md'
    if (-not (Test-Path -LiteralPath $path)) { return @(@{kind='text'; text='Release notes are unavailable. Repair SWSD tools to restore them.'}) }
    $result = @()
    foreach ($line in (Get-Content -LiteralPath $path -Encoding UTF8)) {
        if ($line -match '^## \[([^\]]+)\](.*)$') { $result += @{kind='version'; text=($Matches[1] + $Matches[2])} }
        elseif ($line -match '^### (Added|Changed|Deprecated|Removed|Fixed|Security)$') { $result += @{kind='section'; text=$Matches[1]} }
        elseif ($line -match '^\s*[-*+] (.+)$') { $result += @{kind='item'; text=$Matches[1]} }
        elseif ($result.Count -gt 0 -and $line -match '^\s{2,}(\S.*)$') { $result[-1].text += ' ' + $Matches[1] }
    }
    return $result
}

function Invoke-SwsdNpm {
    param([string]$Arguments, [string]$WorkingDirectory)
    $node = Get-SwsdNode
    $npmCli = $env:SWSD_NPM
    if (-not $npmCli) { $npmCli = Join-Path (Split-Path $node) 'node_modules\npm\bin\npm-cli.js' }
    if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { throw 'npm is missing from this Node.js installation.' }
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$node
    $start.Arguments='"' + $npmCli + '" ' + $Arguments + ' --registry=https://registry.npmjs.org'
    $start.WorkingDirectory=$WorkingDirectory
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    $start.EnvironmentVariables.Remove('SWSD_TOKEN')
    $process = New-Object Diagnostics.Process
    $process.StartInfo=$start
    try {
        [void]$process.Start()
        $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(240000)) { throw 'Tool installation timed out. Your previous tools remain available. Retry after npm finishes.' }
        $output=$stdout.GetAwaiter().GetResult(); [void]$stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'Tool installation failed. Check access to the npm registry and retry. Your previous tools remain available.' }
        return $output.Trim()
    } finally { $process.Dispose() }
}

function Update-SwsdRuntime {
    $latest = Get-SwsdLatestVersion
    if (-not $latest -or $latest -notmatch '^\d+\.\d+\.\d+$') { throw 'Tool installation failed: Could not check the latest published version. Try again.' }
    $runtimeRoot = Join-Path $script:SwsdHome 'runtime'
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $integrity = Invoke-SwsdNpm -Arguments ("view swsd-mcp@$latest dist.integrity") -WorkingDirectory $runtimeRoot
    if ($integrity -notmatch '^sha512-[A-Za-z0-9+/]+={0,2}$') { throw 'Tool installation failed: The npm registry did not supply valid package integrity. Try again later.' }
    $runtime = Join-Path $runtimeRoot $latest
    if (Test-Path -LiteralPath $runtime) {
        if ((Get-SwsdActiveVersion) -eq $latest -and (Get-SwsdInstalledVersion) -eq $latest -and (Test-Path -LiteralPath (Get-SwsdEntryPoint) -PathType Leaf)) { return }
        throw 'Tool installation failed: That version already has an incomplete or inactive installation. Your current tools remain available.'
    }
    # Install in isolation, then rename into the exact version directory. No
    # existing runtime is deleted or overwritten, including on validation failure.
    $stage = Join-Path $runtimeRoot ('install-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    $recipe=@{name='swsd-local-runtime'; private=$true; dependencies=@{'swsd-mcp'=$latest}} | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $stage 'package.json'), $recipe, (New-Object Text.UTF8Encoding($false)))
    # Resolve and inspect every source before npm downloads package tarballs.
    $null = Invoke-SwsdNpm -Arguments 'install --package-lock-only --ignore-scripts --strict-peer-deps --no-audit --no-fund' -WorkingDirectory $stage
    try {
        Add-Type -AssemblyName System.Web.Extensions
        $parser = New-Object Web.Script.Serialization.JavaScriptSerializer
        $lock = $parser.DeserializeObject((Get-Content -LiteralPath (Join-Path $stage 'package-lock.json') -Raw))
        $installed = $lock['packages']['node_modules/swsd-mcp']
        if ($lock['packages']['']['dependencies']['swsd-mcp'] -ne $latest -or $installed['version'] -ne $latest -or $installed['integrity'] -cne $integrity) { throw 'invalid package' }
        foreach ($key in $lock['packages'].Keys) {
            $item=$lock['packages'][$key]
            if ($key -and (-not $item['resolved'] -or $item['resolved'] -cnotmatch '^https://registry\.npmjs\.org/' -or -not $item['integrity'])) { throw 'invalid source' }
        }
    } catch { throw 'Tool installation failed: The downloaded tools did not pass version and integrity checks. Your previous tools remain available.' }
    $lockHash=(Get-FileHash -LiteralPath (Join-Path $stage 'package-lock.json') -Algorithm SHA256).Hash
    $null = Invoke-SwsdNpm -Arguments 'ci --ignore-scripts --strict-peer-deps --no-audit --no-fund' -WorkingDirectory $stage
    try {
        $pkg = Get-Content -LiteralPath (Join-Path $stage 'node_modules\swsd-mcp\package.json') -Raw | ConvertFrom-Json
        if ($pkg.version -ne $latest -or $lockHash -ne (Get-FileHash -LiteralPath (Join-Path $stage 'package-lock.json') -Algorithm SHA256).Hash -or
            -not (Test-Path -LiteralPath (Join-Path $stage 'node_modules\swsd-mcp\dist\cli.js') -PathType Leaf)) { throw 'invalid installation' }
    } catch { throw 'Tool installation failed: The installed tools did not pass version and integrity checks. Your previous tools remain available.' }
    try {
        Move-Item -LiteralPath $stage -Destination $runtime
        Set-SwsdActiveVersion $latest
    } catch {
        # A failed pointer replacement must also leave a fresh retry possible.
        if ((Get-SwsdActiveVersion) -ne $latest -and (Test-Path -LiteralPath $runtime) -and -not (Test-Path -LiteralPath $stage)) {
            try { Move-Item -LiteralPath $runtime -Destination $stage } catch {}
        }
        throw 'Tool installation failed: The new tools could not be activated. Your previous tools remain available. Try again.'
    }
}

function Install-SwsdTools {
    param(
        [Parameter(Mandatory)][string]$SourceRoot,
        [string]$ShortcutDirectory = ([Environment]::GetFolderPath('Programs')),
        [switch]$Force
    )
    $node = Get-SwsdNode
    $npmCli = Join-Path (Split-Path $node) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmCli)) { throw 'npm is missing from this Node.js installation. Ask IT to repair Node.js.' }
    # Reject a stale or mismatched recipe before changing the existing installation.
    $recipe = Get-Content -LiteralPath (Join-Path $SourceRoot 'runtime\package.json') -Raw | ConvertFrom-Json
    # Windows PowerShell 5.1's ConvertFrom-Json cannot read npm's empty root key.
    Add-Type -AssemblyName System.Web.Extensions
    $parser = New-Object Web.Script.Serialization.JavaScriptSerializer
    $lock = $parser.DeserializeObject((Get-Content -LiteralPath (Join-Path $SourceRoot 'runtime\package-lock.json') -Raw))
    if ($recipe.dependencies.'swsd-mcp' -ne $script:SwsdPackageVersion -or
        $lock['packages']['']['dependencies']['swsd-mcp'] -ne $script:SwsdPackageVersion -or
        $lock['packages']['node_modules/swsd-mcp']['version'] -ne $script:SwsdPackageVersion) {
        throw 'The SWSD runtime recipe does not match this setup version. Ask IT to sync the reviewed plugin package.'
    }
    $runtime = Join-Path $script:SwsdHome "runtime\$script:SwsdPackageVersion"
    $entryPoint = Join-Path $runtime 'node_modules\swsd-mcp\dist\cli.js'
    $installedVersion = $null
    try { $installedVersion = (Get-Content -LiteralPath (Join-Path $runtime 'node_modules\swsd-mcp\package.json') -Raw | ConvertFrom-Json).version } catch {}
    $skipNpmInstall = (-not $Force) -and
        ($installedVersion -eq $script:SwsdPackageVersion) -and
        (Test-Path -LiteralPath $entryPoint -PathType Leaf)
    if ($skipNpmInstall) {
        try {
            $installedLock = Join-Path $runtime 'package-lock.json'
            $bundledLock = Join-Path $SourceRoot 'runtime\package-lock.json'
            $skipNpmInstall = (Test-Path -LiteralPath $installedLock -PathType Leaf) -and
                ((Get-FileHash -LiteralPath $installedLock -Algorithm SHA256).Hash -eq
                 (Get-FileHash -LiteralPath $bundledLock -Algorithm SHA256).Hash)
        } catch { $skipNpmInstall = $false }
    }
    if (-not $skipNpmInstall) {
        New-Item -ItemType Directory -Path $runtime -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\package.json') -Destination $runtime -Force
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\package-lock.json') -Destination $runtime -Force
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = $node
        $start.Arguments = '"' + $npmCli + '" ci --ignore-scripts --strict-peer-deps --no-audit --no-fund'
        $start.WorkingDirectory = $runtime
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.EnvironmentVariables.Remove('SWSD_TOKEN')
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $start
        try {
            [void]$process.Start()
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
            if (-not $process.WaitForExit(240000)) { $process.Kill(); throw 'Tool installation timed out. Check npm registry access and retry.' }
            [void]$stdout.GetAwaiter().GetResult()
            [void]$stderr.GetAwaiter().GetResult()
            if ($process.ExitCode -ne 0) { throw 'Tool installation failed. Ask IT to check access to registry.npmjs.org and npm proxy configuration.' }
        } finally { $process.Dispose() }
        if (-not (Test-Path -LiteralPath $entryPoint)) { throw 'The SWSD server installation is incomplete.' }
        $installed = Get-Content -LiteralPath (Join-Path $runtime 'node_modules\swsd-mcp\package.json') -Raw | ConvertFrom-Json
        if ($installed.version -ne $script:SwsdPackageVersion) { throw 'The installed SWSD server version does not match this setup version.' }
    }
    Set-SwsdActiveVersion $script:SwsdPackageVersion
    $clientDir = Join-Path $script:SwsdHome "client\$script:SwsdClientVersion"
    New-Item -ItemType Directory -Path $clientDir -Force | Out-Null
    foreach ($name in @('Common.ps1', 'Start-Swsd.ps1', 'Manage-Swsd.ps1')) {
        Copy-Item -LiteralPath (Join-Path $SourceRoot "scripts\$name") -Destination $clientDir -Force
    }
    # Ship the WPF catalog and help figures alongside the unchanged client/recipe.
    if (Test-Path -LiteralPath (Join-Path $SourceRoot 'assets')) {
        Copy-Item -LiteralPath (Join-Path $SourceRoot 'assets') -Destination $clientDir -Recurse -Force
    }
    # Keep the pinned installation recipe available for repair from the Start menu.
    $recipeDir = Join-Path $clientDir 'runtime'
    New-Item -ItemType Directory -Path $recipeDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\package.json'), (Join-Path $SourceRoot 'runtime\package-lock.json') -Destination $recipeDir -Force
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $ShortcutDirectory 'SWSD Setup.lnk'))
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = '-NoProfile -STA -WindowStyle Hidden -File "' + (Join-Path $clientDir 'Manage-Swsd.ps1') + '"'
    $shortcut.Description = 'Set up, test, replace, or remove your SWSD connection'
    $shortcut.Save()
}
