Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:SwsdPackageVersion = '2.3.1'
$script:SwsdClientVersion = '2.3.2'
$script:SwsdCredentialTarget = 'GAIConsultants/SWSD-MCP'
$script:SwsdHome = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'GAIConsultants\SWSD-MCP'
$script:SwsdProfiles = @(
    @{ id = 'triage'; name = 'Triage'; description = 'Review incidents and catalog items, view tasks and problems, and add incident comments.' },
    @{ id = 'agent'; name = 'Agent'; description = 'Everyday ticket handling, tasks, problems, time entries, attachments, and knowledge searches.' },
    @{ id = 'knowledge'; name = 'Knowledge'; description = 'Search, create, and update knowledge articles, with incident and catalog context.' },
    @{ id = 'operations'; name = 'Operations'; description = 'Agent tools plus changes, releases, assets, procurement, and risk records.' },
    @{ id = 'full'; name = 'Full'; description = 'All available tools. Your SolarWinds account permissions still apply.' }
)

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
        value.Comment = "SolarWinds Service Desk personal API token";
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
    $settings = @{ baseUrl = 'https://api.samanage.com'; profile = 'agent' }
    if (Test-Path -LiteralPath $path) {
        $saved = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ($saved.baseUrl -notin @('https://api.samanage.com', 'https://apieu.samanage.com')) {
            throw 'Invalid SWSD region in settings. Open SWSD setup and save the correct region.'
        }
        $settings.baseUrl = $saved.baseUrl
        if ($saved.PSObject.Properties['profile']) {
            if ($saved.profile -notin @('triage','agent','knowledge','operations','full')) {
                throw 'Invalid saved SWSD profile. Open SWSD setup and save a supported profile.'
            }
            $settings.profile = $saved.profile
        }
    }
    return $settings
}

function Save-SwsdSettings {
    param(
        [Parameter(Mandatory)][ValidateSet('https://api.samanage.com','https://apieu.samanage.com')][string]$BaseUrl,
        [Parameter(Mandatory)][ValidateSet('triage','agent','knowledge','operations','full')][string]$Profile
    )
    New-Item -ItemType Directory -Path $script:SwsdHome -Force | Out-Null
    $temporary = Join-Path $script:SwsdHome ('settings-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        @{ baseUrl = $BaseUrl; profile = $Profile } | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
        Move-Item -LiteralPath $temporary -Destination (Join-Path $script:SwsdHome 'settings.json') -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Save-SwsdProfile {
    param([Parameter(Mandatory)][ValidateSet('triage','agent','knowledge','operations','full')][string]$Profile)
    $settings = Get-SwsdSettings
    Save-SwsdSettings -BaseUrl $settings.baseUrl -Profile $Profile
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
    return Join-Path $script:SwsdHome "runtime\$script:SwsdPackageVersion\node_modules\swsd-mcp\dist\cli.js"
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
                if ($status -eq 401) { throw 'SolarWinds rejected this token (401). Generate or supply a valid personal API token.' }
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

function Install-SwsdTools {
    param([Parameter(Mandatory)][string]$SourceRoot)
    $node = Get-SwsdNode
    $npmCli = Join-Path (Split-Path $node) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmCli)) { throw 'npm is missing from this Node.js installation. Ask IT to repair Node.js.' }
    $runtime = Join-Path $script:SwsdHome "runtime\$script:SwsdPackageVersion"
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\package.json') -Destination $runtime -Force
    Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\package-lock.json') -Destination $runtime -Force
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $node
    $start.Arguments = '"' + $npmCli + '" ci --ignore-scripts --no-audit --no-fund'
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
    if (-not (Test-Path -LiteralPath (Get-SwsdEntryPoint))) { throw 'The SWSD server installation is incomplete.' }
    $clientDir = Join-Path $script:SwsdHome "client\$script:SwsdClientVersion"
    New-Item -ItemType Directory -Path $clientDir -Force | Out-Null
    foreach ($name in @('Common.ps1', 'Start-Swsd.ps1', 'Manage-Swsd.ps1')) {
        Copy-Item -LiteralPath (Join-Path $SourceRoot "scripts\$name") -Destination $clientDir -Force
    }
    # Keep the pinned installation recipe available for repair from the Start menu.
    $recipeDir = Join-Path $clientDir 'runtime'
    New-Item -ItemType Directory -Path $recipeDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\package.json'), (Join-Path $SourceRoot 'runtime\package-lock.json') -Destination $recipeDir -Force
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'SolarWinds Service Desk Setup.lnk'))
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = '-NoProfile -STA -WindowStyle Hidden -File "' + (Join-Path $clientDir 'Manage-Swsd.ps1') + '"'
    $shortcut.Description = 'Set up, test, replace, or remove your SWSD connection'
    $shortcut.Save()
}
