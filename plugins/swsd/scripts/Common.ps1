Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:SwsdPackageVersion = '3.2.0'
$script:SwsdClientVersion = '3.1.0'
$script:SwsdCredentialTarget = 'swsd-mcp/api-token'
$script:SwsdHome = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'swsd-mcp'
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

function Get-SwsdInstalledVersion {
    $packageJson = Join-Path $script:SwsdHome "runtime\$script:SwsdPackageVersion\node_modules\swsd-mcp\package.json"
    if (-not (Test-Path -LiteralPath $packageJson)) { return $null }
    try {
        $pkg = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json
        return $pkg.version
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
        $start.Arguments = '"' + $npmCli + '" view swsd-mcp version'
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
            try { $process.Kill($true) } catch {
                if (-not $process.HasExited) { & taskkill.exe /T /F /PID $process.Id > $null 2>&1 }
            }
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
            $toolsInstalled = ($installedVersion -eq $script:SwsdPackageVersion)
        } catch { $toolsInstalled = $false }
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
    $entryPoint = Get-SwsdEntryPoint
    $installedVersion = Get-SwsdInstalledVersion
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
    $shortcut = $shell.CreateShortcut((Join-Path $ShortcutDirectory 'SolarWinds Service Desk Setup.lnk'))
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $shortcut.Arguments = '-NoProfile -STA -WindowStyle Hidden -File "' + (Join-Path $clientDir 'Manage-Swsd.ps1') + '"'
    $shortcut.Description = 'Set up, test, replace, or remove your SWSD connection'
    $shortcut.Save()
}
