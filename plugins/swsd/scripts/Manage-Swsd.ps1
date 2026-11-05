param([switch]$CheckOnly, [switch]$ValidateUi, [switch]$ValidateWindow, [switch]$ValidateHandlers, [switch]$ValidateDpiChanges, [ValidateRange(1,15)][int]$WindowTestSeconds = 2)
$ErrorActionPreference = 'Stop'
if ($ValidateHandlers) {
    # Handler checks exercise credential flows without depending on a signed-in desktop.
    # Reject every target outside this invocation's isolated UI-test namespace.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
namespace SwsdDesktop {
  public static class Credentials {
    private static readonly Dictionary<string, string> values = new Dictionary<string, string>();
    private static void Check(string target) {
      if (!target.StartsWith("swsd-mcp/ui-test-", StringComparison.Ordinal))
        throw new InvalidOperationException("Non-test credential target is forbidden.");
    }
    public static bool Exists(string target) { Check(target); return values.ContainsKey(target); }
    public static int ReadCount;
    public static string Read(string target) { Check(target); ReadCount++; string value; return values.TryGetValue(target, out value) ? value : null; }
    public static void Save(string target, string secret) { Check(target); values[target] = secret; }
    public static void Remove(string target) { Check(target); values.Remove(target); }
  }
}
'@
}
. (Join-Path $PSScriptRoot 'Common.ps1')
if ($ValidateUi -or $ValidateWindow -or $ValidateHandlers) {
    # Exercise the real controls and save handler without touching a user's settings or credential.
    $script:SwsdHome = Join-Path ([IO.Path]::GetTempPath()) ('swsd-ui-test-' + [guid]::NewGuid().ToString('N'))
    $script:SwsdCredentialTarget = 'swsd-mcp/ui-test-' + [guid]::NewGuid().ToString('N')
}
$script:SwsdDiagnosticsLogPath = Join-Path $env:TEMP 'swsd-settings.log'
if ($ValidateUi -or $ValidateWindow -or $ValidateHandlers) {
    $script:SwsdDiagnosticsLogPath = Join-Path $script:SwsdHome 'swsd-settings.log'
}
if ($CheckOnly) {
    $s = Get-SwsdStatus
    [pscustomobject]@{
        nodeSupported   = $s.nodeSupported
        nodeVersion     = $s.nodeVersion
        toolsInstalled  = $s.toolsInstalled
        credentialSaved = $s.credentialSaved
        packageVersion  = $s.packageVersion
        profile         = $s.profile
        region          = $s.region
    } | ConvertTo-Json
    exit 0
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# DPI awareness before any window is created
try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SwsdDpiBootstrap {
    [DllImport("user32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("shcore.dll")] private static extern int SetProcessDpiAwareness(int awareness);
    [DllImport("user32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
    public static string Enable() {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return "user32!SetProcessDpiAwarenessContext (PerMonitorV2)"; }
        catch (EntryPointNotFoundException) {} catch (DllNotFoundException) {}
        try { if (SetProcessDpiAwareness(2) == 0) return "shcore!SetProcessDpiAwareness (PerMonitor)"; }
        catch (EntryPointNotFoundException) {} catch (DllNotFoundException) {}
        try { if (SetProcessDPIAware()) return "user32!SetProcessDPIAware (System)"; }
        catch (EntryPointNotFoundException) {} catch (DllNotFoundException) {}
        return "Unchanged (host already configured DPI awareness)";
    }
    public static string WindowAwareness(IntPtr window) {
        try {
            IntPtr context = GetWindowDpiAwarenessContext(window);
            if (AreDpiAwarenessContextsEqual(context, new IntPtr(-4))) return "PerMonitorV2";
            if (AreDpiAwarenessContextsEqual(context, new IntPtr(-3))) return "PerMonitor";
            if (AreDpiAwarenessContextsEqual(context, new IntPtr(-2))) return "System";
            return "Unaware";
        } catch (EntryPointNotFoundException) { return "Unavailable"; }
    }
}
'@
    $script:SwsdDpiAwarenessPath = [SwsdDpiBootstrap]::Enable()
} catch {}
[Windows.Forms.Application]::EnableVisualStyles()


# Display only authored messages. Raw exception text can contain request data or credentials.
function Format-SwsdFriendlyError([Exception]$Exception) {
    $msg = $Exception.GetBaseException().Message
    $friendly = 'The action could not be completed. Try again, or ask IT to check the SWSD setup.'
    $kind = 'error'
    switch -Regex ($msg) {
        'Node\.js.*required|Node\.js.*newer' { $friendly = 'Node.js is missing or unsupported. Ask IT to install the supported Node.js version shown below.'; $kind = 'warn'; break }
        '^Windows Package Manager is unavailable' { $friendly = 'Windows Package Manager is unavailable. Ask IT to install Node.js 24.22.1, then reopen setup.'; $kind = 'warn'; break }
        '^Node\.js installation timed out' { $friendly = 'Node.js installation timed out. Ask IT to check Windows Package Manager, then reopen setup.'; break }
        '^Node\.js installation failed' { $friendly = 'Node.js installation failed. Ask IT to install Node.js 24.22.1, then reopen setup.'; break }
        'npm is missing' { $friendly = 'npm is missing from this Node.js installation. Ask IT to repair Node.js.'; break }
        'timed out' { $friendly = 'Installation timed out. Check npm registry access and retry.'; break }
        'Tool installation failed|npm registry|registry\.npmjs' { $friendly = 'Tool installation failed. Ask IT to check access to registry.npmjs.org and npm proxy configuration.'; break }
        '\(401\)' { $friendly = 'SolarWinds rejected this token (401). Generate or supply a valid personal API token.'; break }
        '\(403\)' { $friendly = 'SolarWinds denied incident access (403). Ask your SWSD administrator to review your account permissions.'; break }
        'Connection failed|network|DNS|proxy' { $friendly = 'Connection failed. Check network access, proxy settings, and the selected SWSD region.'; break }
        '^No token is saved\.' { $friendly = 'No token is saved. Paste one into the masked field, then select Test and save token.'; $kind = 'warn'; break }
        '^Paste your personal SWSD token' { $friendly = 'Paste your personal SWSD token into the masked field first.'; $kind = 'warn'; break }
        'recipe does not match|version does not match|installation is incomplete' { $friendly = 'The tools need repair. Ask IT to sync the reviewed plugin package, then select Install / repair tools.'; break }
    }
    if ($Exception.GetBaseException() -is [ComponentModel.Win32Exception] -and $Exception.GetBaseException().NativeErrorCode -eq 1312) { $friendly = 'Windows Credential Manager is unavailable in this session. Open setup from your signed-in Windows desktop.' }
    if ($ValidateHandlers -and $msg -in @('mock install failure', 'synthetic handler crash')) { $friendly = $msg }
    return @{ Friendly = $friendly; Kind = $kind; Technical = ('Error type: ' + $Exception.GetBaseException().GetType().Name + '. ' + $friendly) }
}

# Last-resort safety net: never show the raw .NET "Unhandled exception" dialog.
$script:SwsdLayoutFailures = @()
[Windows.Forms.Application]::SetUnhandledExceptionMode([Windows.Forms.UnhandledExceptionMode]::CatchException)
[Windows.Forms.Application]::add_ThreadException({
    param($sender, $eventArgs) Invoke-SwsdSafe -Source 'ThreadException' {
    $message = (Format-SwsdFriendlyError $eventArgs.Exception).Friendly
    try { Add-Content -LiteralPath (Join-Path $env:TEMP 'swsd-settings.log') -Value ("{0:u} {1}" -f (Get-Date), $message) } catch {}
    try {
        if (Get-Command Set-SwsdStatus -ErrorAction SilentlyContinue) { Set-SwsdStatus -Kind error -Text "Something went wrong: $message" }
        foreach ($name in 'install','checkUpdates','nodeInstallButton','save','test','remove','saveProfile','showDetails','copyDiagnostics','region','tokenBox','profile') {
            $control = Get-Variable -Name $name -Scope Script -ValueOnly -ErrorAction SilentlyContinue
            if ($control -is [Windows.Forms.Control]) { $control.Enabled = $true }
        }
    } catch {}
} })

$script:SwsdHandlerErrors = @()
# Every event handler runs inside this: a failure shows a friendly in-window error and re-enables controls.
function Invoke-SwsdSafe {
    param([string]$Source = 'handler', [switch]$Quiet, [Parameter(Mandatory, Position = 0)][scriptblock]$Body)
    try { . $Body } catch {
        $message = (Format-SwsdFriendlyError $_.Exception).Friendly
        $script:SwsdHandlerErrors += "${Source}: $message"
        if ($ValidateWindow) {
            [Console]::Error.WriteLine(('{0}: {1} at {2}' -f $Source, $_.Exception.GetBaseException().GetType().Name, $_.ScriptStackTrace))
        }
        try { Add-Content -LiteralPath (Join-Path $env:TEMP 'swsd-settings.log') -Value ("{0:u} [{1}] {2}" -f (Get-Date), $Source, $message) } catch {}
        if ($Quiet) { return }
        try {
            if (Get-Command Set-SwsdStatus -ErrorAction SilentlyContinue) { Set-SwsdStatus -Kind error -Text "Something went wrong: $message" }
            foreach ($name in 'install','checkUpdates','nodeInstallButton','save','test','remove','saveProfile','showDetails','copyDiagnostics','region','tokenBox','profile') {
                $control = Get-Variable -Name $name -Scope Script -ValueOnly -ErrorAction SilentlyContinue
                if ($control -is [Windows.Forms.Control]) { $control.Enabled = $true }
            }
            $f = Get-Variable -Name form -Scope Script -ValueOnly -ErrorAction SilentlyContinue
            if ($f -is [Windows.Forms.Form]) { $f.UseWaitCursor = $false }
            if (Get-Command Update-SwsdDashboard -ErrorAction SilentlyContinue) { Update-SwsdDashboard }
            if ($ValidateWindow -and $Source -eq 'Tick' -and $f -is [Windows.Forms.Form]) { $f.Close() }
        } catch {}
    }
}
function Confirm-SwsdRemove {
    return [Windows.Forms.MessageBox]::Show('Remove this computer''s saved SWSD token? Fully quit ChatGPT afterwards to end running connections. This does not revoke the token in SolarWinds.', 'Remove saved token', 'YesNo', 'Question')
}

function Confirm-SwsdNodeInstall {
    return [Windows.Forms.MessageBox]::Show('Install Node.js 24.22.1 using Windows Package Manager? Windows may ask for administrator approval. Reopen setup after installation.', 'Install Node.js 24', 'YesNo', 'Question')
}

# PowerShell 5.1 does not opt its executable into Framework WinForms' DpiChanged
# handling. Handle WM_DPICHANGED ourselves, without changing powershell.exe.config.
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
namespace SwsdDesktop {
  public sealed class MonitorDpiEventArgs : EventArgs {
    public int DeviceDpiNew { get; private set; }
    public Rectangle SuggestedRectangle { get; private set; }
    public MonitorDpiEventArgs(int dpi, Rectangle bounds) { DeviceDpiNew = dpi; SuggestedRectangle = bounds; }
  }
  public class DpiForm : Form {
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetSystemMetricsForDpi(int index, uint dpi);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    private int windowDpi = 96;
    private Icon generatedIcon;
    // Control.DeviceDpi stays at system DPI when the Framework opt-in is absent.
    public new int DeviceDpi { get { return windowDpi; } }
    public int ScrollBarWidth {
      get {
        try { return GetSystemMetricsForDpi(2, (uint)windowDpi); } // SM_CXVSCROLL
        catch (EntryPointNotFoundException) { return (int)Math.Ceiling(SystemInformation.VerticalScrollBarWidth * windowDpi / (double)base.DeviceDpi); }
      }
    }
    public event EventHandler<MonitorDpiEventArgs> MonitorDpiChanged;
    public void UpdateIcon(string family, float scale) {
      int size = Math.Max(16, (int)Math.Round(64 * scale));
      using (Bitmap bitmap = new Bitmap(size, size)) {
        using (Graphics g = Graphics.FromImage(bitmap)) {
          g.ScaleTransform(size / 64f, size / 64f);
          g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
          g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
          g.Clear(Color.Transparent);
          Color accent = Color.FromArgb(0, 120, 212);
          if (!String.IsNullOrEmpty(family)) {
            using (Font font = new Font(family, 40, FontStyle.Regular, GraphicsUnit.Pixel))
            using (Brush brush = new SolidBrush(accent))
            using (StringFormat format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center }) {
              g.DrawString("\uE774", font, brush, new RectangleF(0, 0, 64, 64), format);
            }
          } else {
            using (Pen pen = new Pen(accent, 5)) { g.DrawEllipse(pen, 6, 6, 52, 52); g.DrawEllipse(pen, 20, 6, 24, 52); g.DrawLine(pen, 6, 32, 58, 32); }
          }
        }
        IntPtr handle = bitmap.GetHicon();
        try {
          using (Icon borrowed = Icon.FromHandle(handle)) {
            Icon previous = generatedIcon;
            generatedIcon = (Icon)borrowed.Clone();
            Icon = generatedIcon;
            if (previous != null) previous.Dispose();
          }
        } finally { DestroyIcon(handle); }
      }
    }
    protected override void Dispose(bool disposing) {
      base.Dispose(disposing);
      if (disposing && generatedIcon != null) { generatedIcon.Dispose(); generatedIcon = null; }
    }
    protected override void OnHandleCreated(EventArgs e) {
      base.OnHandleCreated(e);
      try { windowDpi = (int)GetDpiForWindow(Handle); }
      catch (EntryPointNotFoundException) { using (Graphics g = CreateGraphics()) { windowDpi = (int)g.DpiX; } }
    }
    protected override void WndProc(ref Message m) {
      if (m.Msg == 0x02E0) {
        windowDpi = (int)(m.WParam.ToInt64() & 0xffff);
        RECT r = (RECT)Marshal.PtrToStructure(m.LParam, typeof(RECT));
        var handler = MonitorDpiChanged;
        if (handler != null) handler(this, new MonitorDpiEventArgs(windowDpi, Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom)));
        m.Result = IntPtr.Zero;
        return; // One scaling owner: do not let Framework scale the same controls again.
      }
      base.WndProc(ref m);
    }
  }
}
'@

# Merged C# interop: existing Windows helpers + DWM/DPI pinvokes
if (-not ('SwsdDesktop.Windows' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace SwsdDesktop {
  public static class Windows {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, string lParam);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    public static bool IsBehindForeground(IntPtr window) {
      IntPtr foreground = GetForegroundWindow();
      if (foreground == IntPtr.Zero || foreground == window) return false;
      IntPtr previous = GetWindow(window, 3);
      for (int count = 0; previous != IntPtr.Zero && count < 1000; count++) {
        if (previous == foreground) return true;
        previous = GetWindow(previous, 3);
      }
      if (previous != IntPtr.Zero) throw new InvalidOperationException("Window stacking check did not converge.");
      return false;
    }
    [DllImport("dwmapi.dll", PreserveSig=true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
    public static void ApplyDarkMode(IntPtr hwnd, bool dark) {
      try { int val = dark ? 1 : 0; DwmSetWindowAttribute(hwnd, 20, ref val, 4); } catch {}
      try { int val = dark ? 1 : 0; DwmSetWindowAttribute(hwnd, 19, ref val, 4); } catch {}
    }
    public static void ApplyMicaBackdrop(IntPtr hwnd) {
      try { int val = 2; DwmSetWindowAttribute(hwnd, 38, ref val, 4); } catch {}
    }
    public static void ApplyRoundedCorners(IntPtr hwnd) {
      try { int val = 2; DwmSetWindowAttribute(hwnd, 33, ref val, 4); } catch {}
    }
  }
}
'@
}

if (-not ('SwsdDesktop.ThemedComboBox' -as [type])) {
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Windows.Forms;
namespace SwsdDesktop {
  // ComboBox whose frame and drop-down arrow follow the app theme instead of the light system colors.
  public class ThemedComboBox : ComboBox {
    public Color BorderColor = Color.Gray;
    public Color ArrowColor = Color.Black;
    public float PixelScale = 1;
    private int Px(int value) { return Math.Max(1, (int)Math.Round(value * PixelScale)); }
    protected override void WndProc(ref Message m) {
      base.WndProc(ref m);
      if (m.Msg == 0x000F || m.Msg == 0x0133) {
        using (Graphics g = Graphics.FromHwnd(Handle)) {
          Rectangle r = ClientRectangle;
          using (Pen back = new Pen(BackColor, Px(2))) { g.DrawRectangle(back, Px(1), Px(1), r.Width - Px(2), r.Height - Px(2)); }
          int arrowWidth = Math.Max(SystemInformation.VerticalScrollBarWidth, Font.Height + Px(4));
          Rectangle arrow = new Rectangle(r.Right - arrowWidth - Px(3), Px(1), arrowWidth + Px(2), r.Height - Px(2));
          using (SolidBrush b = new SolidBrush(BackColor)) { g.FillRectangle(b, arrow); }
          using (Pen inner = new Pen(BackColor)) { for (int i = 1; i <= Px(3); i++) g.DrawRectangle(inner, i, i, arrow.Left - i - 1, r.Height - 2 * i - 1); }
          int cx = arrow.Left + arrow.Width / 2, cy = arrow.Top + arrow.Height / 2;
          int w = Math.Max(3, arrowWidth / 4);
          using (Pen ap = new Pen(ArrowColor, Math.Max(1, arrowWidth / 12))) {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.DrawLines(ap, new Point[] { new Point(cx - w, cy - w / 2), new Point(cx, cy + w / 2), new Point(cx + w, cy - w / 2) });
          }
          g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.None;
          using (Pen border = new Pen(BorderColor, Px(1))) { g.DrawRectangle(border, 0, 0, r.Width - 1, r.Height - 1); }
        }
      }
    }
  }
}
"@
}

if (-not ('SwsdDesktop.ThemedProgressBar' -as [type])) {
    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Windows.Forms;
namespace SwsdDesktop {
  public class ThemedProgressBar : ProgressBar {
    private int phase;
    public ThemedProgressBar() {
      SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
    }
    public void Advance() { phase = (phase + 3) % 100; Invalidate(); }
    protected override void OnPaint(PaintEventArgs e) {
      e.Graphics.Clear(BackColor);
      int segment = Math.Max(1, Width / 4);
      int left = (Width + segment) * phase / 100 - segment;
      using (SolidBrush brush = new SolidBrush(ForeColor)) { e.Graphics.FillRectangle(brush, left, 0, segment, Height); }
    }
  }
}
'@
}

# Theme detection
$script:SwsdDarkMode = $false
try {
    $personalize = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction SilentlyContinue
    if ($personalize -and $personalize.PSObject.Properties['AppsUseLightTheme']) {
        $script:SwsdDarkMode = ([int]$personalize.AppsUseLightTheme -eq 0)
    }
} catch {}
# SWSD_THEME=dark|light overrides the system theme (used for screenshots and testing).
if ($env:SWSD_THEME -eq 'dark') { $script:SwsdDarkMode = $true } elseif ($env:SWSD_THEME -eq 'light') { $script:SwsdDarkMode = $false }

$script:SwsdAccentColor = [Drawing.Color]::FromArgb(0, 103, 192)
try {
    $dwm = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\DWM' -ErrorAction SilentlyContinue
    if ($dwm -and $dwm.PSObject.Properties['AccentColor']) {
        $abgr = [int]$dwm.AccentColor
        $a = [byte](($abgr -shr 24) -band 0xFF)
        $b = [byte](($abgr -shr 16) -band 0xFF)
        $g = [byte](($abgr -shr 8) -band 0xFF)
        $r = [byte]($abgr -band 0xFF)
        $script:SwsdAccentColor = [Drawing.Color]::FromArgb($a, $r, $g, $b)
    }
} catch {}

# Palette
if ($script:SwsdDarkMode) {
    $script:SwsdPalette = @{
        WindowBg     = [Drawing.Color]::FromArgb(32, 32, 32)
        CardBg       = [Drawing.Color]::FromArgb(44, 44, 44)
        TextPrimary   = [Drawing.Color]::White
        TextSecondary = [Drawing.Color]::FromArgb(200, 200, 200)
        Border       = [Drawing.Color]::FromArgb(70, 70, 70)
        InputBg      = [Drawing.Color]::FromArgb(50, 50, 50)
        InputBorder  = [Drawing.Color]::FromArgb(80, 80, 80)
        ButtonNeutralBg = [Drawing.Color]::FromArgb(60, 60, 60)
        ButtonNeutralFg = [Drawing.Color]::White
    DisabledBg   = [Drawing.Color]::FromArgb(45, 45, 45)
    DisabledFg   = [Drawing.Color]::FromArgb(125, 125, 125)
        StatusSuccessBg = [Drawing.Color]::FromArgb(16, 60, 30)
        StatusSuccessFg = [Drawing.Color]::FromArgb(108, 200, 138)
        StatusWarnBg    = [Drawing.Color]::FromArgb(70, 55, 10)
        StatusWarnFg    = [Drawing.Color]::FromArgb(230, 200, 80)
        StatusErrorBg   = [Drawing.Color]::FromArgb(70, 20, 20)
        StatusErrorFg   = [Drawing.Color]::FromArgb(240, 120, 120)
        StatusInfoBg    = [Drawing.Color]::FromArgb(20, 40, 70)
        StatusInfoFg    = [Drawing.Color]::FromArgb(120, 180, 240)
    }
} else {
    $script:SwsdPalette = @{
        WindowBg     = [Drawing.Color]::FromArgb(243, 243, 243)
        CardBg       = [Drawing.Color]::White
        TextPrimary   = [Drawing.Color]::FromArgb(26, 26, 26)
        TextSecondary = [Drawing.Color]::FromArgb(100, 100, 100)
        Border       = [Drawing.Color]::FromArgb(218, 218, 218)
        InputBg      = [Drawing.Color]::White
        InputBorder  = [Drawing.Color]::FromArgb(200, 200, 200)
        ButtonNeutralBg = [Drawing.Color]::White
        ButtonNeutralFg = [Drawing.Color]::FromArgb(26, 26, 26)
    DisabledBg   = [Drawing.Color]::FromArgb(243, 243, 243)
    DisabledFg   = [Drawing.Color]::FromArgb(160, 160, 160)
        StatusSuccessBg = [Drawing.Color]::FromArgb(220, 245, 228)
        StatusSuccessFg = [Drawing.Color]::FromArgb(16, 100, 40)
        StatusWarnBg    = [Drawing.Color]::FromArgb(255, 245, 210)
        StatusWarnFg    = [Drawing.Color]::FromArgb(132, 100, 0)
        StatusErrorBg   = [Drawing.Color]::FromArgb(253, 225, 225)
        StatusErrorFg   = [Drawing.Color]::FromArgb(180, 30, 30)
        StatusInfoBg    = [Drawing.Color]::FromArgb(220, 235, 252)
        StatusInfoFg    = [Drawing.Color]::FromArgb(10, 70, 150)
    }
}

# Icon font detection
$script:SwsdIconFont = $null
foreach ($candidate in @('Segoe Fluent Icons', 'Segoe MDL2 Assets')) {
    try {
        $testFont = New-Object Drawing.Font($candidate, 10)
        if ($testFont.Name -eq $candidate) { $script:SwsdIconFont = $candidate; $testFont.Dispose(); break }
        $testFont.Dispose()
    } catch {}
}

function Get-SwsdIconGlyph([string]$Name) {
    if (-not $script:SwsdIconFont) { return '' }
    switch ($Name) {
        'Node'      { return [char]0xE756 } # CommandPrompt
        'Tools'     { return [char]0xE90F } # Repair
        'Key'       { return [char]0xE8D7 } # Permissions
        'Region'    { return [char]0xE774 } # Globe
        'Profile'   { return [char]0xE77B }
        'Check'     { return [char]0xE73E }
        'Warning'   { return [char]0xE7BA }
        'Error'     { return [char]0xEA39 }
        'Info'      { return [char]0xE946 }
        'SolarWinds'{ return [char]0xE774 }
        default     { return '' }
    }
}

# SWSD_UI_SCALE testing hook: multiplies base font size and all logical px constants.
$script:SwsdUiScale = 1.0
if ($env:SWSD_UI_SCALE) {
    try { $script:SwsdUiScale = [double]$env:SWSD_UI_SCALE } catch { $script:SwsdUiScale = 1.0 }
    if ($script:SwsdUiScale -lt 0.5) { $script:SwsdUiScale = 1.0 }
    if ($script:SwsdUiScale -gt 4.0) { $script:SwsdUiScale = 4.0 }
}

$script:SwsdDeviceDpi = 96
function ScalePx([double]$LogicalPx) {
    return [int][Math]::Round($LogicalPx * $script:SwsdUiScale * $script:SwsdDeviceDpi / 96)
}

function ScaleFont([double]$PointSize) {
    # Pixel fonts avoid TextRenderer's system-DPI point conversion on another monitor.
    return [float]($PointSize * 96 / 72 * $script:SwsdUiScale * $script:SwsdDeviceDpi / 96)
}

# Layout constants (logical px at scale 1.0)
$script:SwsdCardPaddingH = 16
$script:SwsdCardPaddingV = 8
$script:SwsdCardGap = 8
$script:SwsdRowGap = 8
$script:SwsdRootPaddingH = 16
$script:SwsdRootPaddingV = 16
$script:SwsdButtonMinHeight = 32
$script:SwsdButtonPaddingH = 14
$script:SwsdButtonPaddingV = 4
$script:SwsdButtonGap = 8
$script:SwsdContentWidth = 560
$script:SwsdScreenMargin = 16

$form = New-Object SwsdDesktop.DpiForm
$form.Text = 'SolarWinds Service Desk Setup'
$form.StartPosition = 'Manual'
$launchArea = [Windows.Forms.Screen]::FromPoint([Windows.Forms.Cursor]::Position).WorkingArea
$form.Location = New-Object Drawing.Point(($launchArea.Left + 16), ($launchArea.Top + 16))
$form.FormBorderStyle = 'Sizable'
$form.MaximizeBox = $true
$form.MinimizeBox = $true
$form.AutoSize = $false
$form.AutoScaleMode = 'Dpi'
$form.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 10), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$form.BackColor = $script:SwsdPalette.WindowBg
$form.ForeColor = $script:SwsdPalette.TextPrimary
$form.UpdateIcon($script:SwsdIconFont, [float]$script:SwsdUiScale)
$form.ShowIcon = $true

# DWM attributes applied after handle creation
$form.Add_HandleCreated({ param($sender, $e) Invoke-SwsdSafe -Source 'HandleCreated' -Quiet {
    try {
        [SwsdDesktop.Windows]::ApplyDarkMode($form.Handle, $script:SwsdDarkMode)
        $osBuild = [Environment]::OSVersion.Version.Build
        if ($osBuild -ge 22621) { [SwsdDesktop.Windows]::ApplyMicaBackdrop($form.Handle) }
        if ($osBuild -ge 22000) { [SwsdDesktop.Windows]::ApplyRoundedCorners($form.Handle) }
    } catch {}
 }})

$script:SwsdPresentationCount = 0
$form.Add_Shown({ param($sender, $e) Invoke-SwsdSafe -Source 'Shown' {
    # Start with the token field focused (or nothing), never a drop-down showing its focus frame.
    try { if ($tokenBox.Enabled) { $form.ActiveControl = $tokenBox } else { $form.ActiveControl = $null } } catch {}
    # Present once after the dialog has a visible handle, even when its console is hidden.
    [void]$form.BeginInvoke([Action]{ Invoke-SwsdSafe -Source 'Present' {
        $script:SwsdPresentationCount++
        $form.WindowState = 'Normal'
        try {
            $form.TopMost = $true
            [void][SwsdDesktop.Windows]::ShowWindow($form.Handle, 9)
            $form.BringToFront()
            $form.Activate()
            [void][SwsdDesktop.Windows]::SetForegroundWindow($form.Handle)
        } finally {
            # Other applications can cover the settings window normally afterwards.
            $form.TopMost = $false
        }
    } })
    # Fade-in animation (skip during validation)
    if (-not $ValidateUi -and -not $ValidateWindow -and -not $ValidateHandlers) {
        $form.Opacity = 0
        $script:SwsdFadeTimer = New-Object Windows.Forms.Timer
        $script:SwsdFadeTimer.Interval = 15
        $script:SwsdFadeSteps = 0
        $script:SwsdFadeTimer.Add_Tick({ param($sender, $e) Invoke-SwsdSafe -Source 'Tick' {
            $script:SwsdFadeSteps++
            $form.Opacity = [Math]::Min(1.0, $script:SwsdFadeSteps / 10.0)
            if ($form.Opacity -ge 1.0) { $script:SwsdFadeTimer.Stop(); $script:SwsdFadeTimer.Dispose() }
         }})
        $script:SwsdFadeTimer.Start()
    }
 }})

# Root layout panel
$rootPanel = New-Object Windows.Forms.TableLayoutPanel
$rootPanel.Dock = 'Fill'
$rootPanel.Padding = New-Object Windows.Forms.Padding((ScalePx $script:SwsdRootPaddingH), (ScalePx $script:SwsdRootPaddingV), (ScalePx $script:SwsdRootPaddingH), (ScalePx $script:SwsdRootPaddingV))
$rootPanel.ColumnCount = 1
$rootPanel.RowCount = 6
[void]$rootPanel.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Percent', 100)))
[void]$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
[void]$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
[void]$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
[void]$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
[void]$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
[void]$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$rootPanel.AutoScroll = $false
$form.Controls.Add($rootPanel)

# Helper: compute contrasting foreground color based on luminance
function Get-SwsdContrastColor([Drawing.Color]$Bg) {
    $luminance = (0.299 * $Bg.R + 0.587 * $Bg.G + 0.114 * $Bg.B) / 255.0
    if ($luminance -gt 0.6) { return [Drawing.Color]::Black } else { return [Drawing.Color]::White }
}

# Helper: lighten or darken a color
function Adjust-SwsdColor([Drawing.Color]$Color, [int]$Amount) {
    $r = [Math]::Max(0, [Math]::Min(255, $Color.R + $Amount))
    $g = [Math]::Max(0, [Math]::Min(255, $Color.G + $Amount))
    $b = [Math]::Max(0, [Math]::Min(255, $Color.B + $Amount))
    return [Drawing.Color]::FromArgb($Color.A, $r, $g, $b)
}

# Helper: styled button
function New-SwsdButton([string]$Text, [bool]$Primary = $false) {
    $btn = New-Object Windows.Forms.Button
    $btn.Text = $Text
    $btn.FlatStyle = 'Flat'
    # Every button gets identical geometry: fixed DPI-scaled height, same margin/padding/border.
    $btn.FlatAppearance.BorderSize = 1
    $btn.AutoSize = $false
    $btn.UseVisualStyleBackColor = $false
    $btn.TextAlign = 'MiddleCenter'
    $btn.Padding = New-Object Windows.Forms.Padding(0)
    $btn.Margin = New-Object Windows.Forms.Padding(0, 0, (ScalePx $script:SwsdButtonGap), 0)
    $btn.Anchor = 'Top,Left'
    $btn.Cursor = [Windows.Forms.Cursors]::Hand
    $btn.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9.5), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $textWidth = [Windows.Forms.TextRenderer]::MeasureText($Text, $btn.Font).Width
    $btn.Size = New-Object Drawing.Size(($textWidth + 2 * (ScalePx $script:SwsdButtonPaddingH) + 2), (ScalePx $script:SwsdButtonMinHeight))
    # Intentional disabled look: owner-draw so WinForms' muddy system gray is never used.
    $btn.Add_Paint({
        param($sender, $e) Invoke-SwsdSafe -Source 'Paint' -Quiet {
        if ($sender.Enabled) { return }
        $rect = $sender.ClientRectangle
        $e.Graphics.Clear($script:SwsdPalette.DisabledBg)
        $pen = New-Object Drawing.Pen($script:SwsdPalette.Border)
        $e.Graphics.DrawRectangle($pen, 0, 0, $rect.Width - 1, $rect.Height - 1)
        $pen.Dispose()
        [Windows.Forms.TextRenderer]::DrawText($e.Graphics, $sender.Text, $sender.Font, $rect, $script:SwsdPalette.DisabledFg, [Windows.Forms.TextFormatFlags]'HorizontalCenter, VerticalCenter, SingleLine')
     }})
    if ($Primary) {
        $btn.BackColor = $script:SwsdAccentColor
        $btn.ForeColor = Get-SwsdContrastColor $script:SwsdAccentColor
        $btn.FlatAppearance.BorderColor = $script:SwsdAccentColor
        $btn.FlatAppearance.MouseOverBackColor = Adjust-SwsdColor $script:SwsdAccentColor 25
        $btn.FlatAppearance.MouseDownBackColor = Adjust-SwsdColor $script:SwsdAccentColor -20
    } else {
        $btn.BackColor = $script:SwsdPalette.ButtonNeutralBg
        $btn.ForeColor = $script:SwsdPalette.ButtonNeutralFg
        $btn.FlatAppearance.BorderColor = $script:SwsdPalette.Border
        $btn.FlatAppearance.MouseOverBackColor = Adjust-SwsdColor $script:SwsdPalette.ButtonNeutralBg 15
        $btn.FlatAppearance.MouseDownBackColor = Adjust-SwsdColor $script:SwsdPalette.ButtonNeutralBg -10
    }
    return $btn
}

# Helper: make every button in a row the same width (the widest) and height.
function Set-SwsdButtonRow([Windows.Forms.Button[]]$Buttons) {
    $width = ($Buttons | ForEach-Object { $_.Width } | Measure-Object -Maximum).Maximum
    foreach ($b in $Buttons) { $b.Size = New-Object Drawing.Size($width, (ScalePx $script:SwsdButtonMinHeight)) }
    $Buttons[-1].Margin = New-Object Windows.Forms.Padding(0)
}

# Helper: field label above an input.
function New-SwsdFieldLabel([string]$Text) {
    $l = New-Object Windows.Forms.Label
    $l.AutoSize = $true
    $l.Text = $Text
    $l.Font = New-Object Drawing.Font('Segoe UI Semibold', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $l.ForeColor = $script:SwsdPalette.TextPrimary
    return $l
}

# Helper: themed 1px border host so inputs never show the default light 3D border.
function New-SwsdInputHost([Windows.Forms.Control]$Control, [int]$Inset = 1) {
    $hostPanel = New-Object Windows.Forms.Panel
    $hostPanel.BackColor = $script:SwsdPalette.InputBg
    $hostPanel.Padding = New-Object Windows.Forms.Padding($Inset)
    $hostPanel.Height = $Control.PreferredSize.Height + 2 * $Inset
    $hostPanel.Add_Paint({
        param($sender, $e) Invoke-SwsdSafe -Source 'Paint' -Quiet {
        $pen = New-Object Drawing.Pen($script:SwsdPalette.InputBorder)
        $e.Graphics.DrawRectangle($pen, 0, 0, $sender.Width - 1, $sender.Height - 1)
        $pen.Dispose()
     }})
    $Control.Dock = 'Fill'
    $Control.Margin = New-Object Windows.Forms.Padding(0)
    $hostPanel.Controls.Add($Control)
    return ,$hostPanel
}

# Helper: create a card panel with title; stores inner layout in card.Tag
function New-SwsdCard([string]$Title, [string]$IconName) {
    $card = New-Object Windows.Forms.Panel
    $card.BackColor = $script:SwsdPalette.CardBg
    $card.Padding = New-Object Windows.Forms.Padding((ScalePx $script:SwsdCardPaddingH), (ScalePx $script:SwsdCardPaddingV), (ScalePx $script:SwsdCardPaddingH), (ScalePx $script:SwsdCardPaddingV))
    $card.Margin = New-Object Windows.Forms.Padding(0, 0, 0, (ScalePx $script:SwsdCardGap))
    $card.AutoSize = $true
    $card.AutoSizeMode = 'GrowAndShrink'
    $card.Anchor = 'Top,Left,Right'

    $innerLayout = New-Object Windows.Forms.TableLayoutPanel
    $innerLayout.Dock = 'Fill'
    $innerLayout.AutoSize = $true
    $innerLayout.ColumnCount = 1
    [void]$innerLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Percent', 100)))
    $innerLayout.RowCount = 0
    $card.Controls.Add($innerLayout)
    $card.Tag = $innerLayout

    if ($Title) {
        $titleRow = New-Object Windows.Forms.TableLayoutPanel
        $titleRow.AutoSize = $true
        $titleRow.Dock = 'Fill'
        $titleRow.ColumnCount = 2
        [void]$titleRow.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('AutoSize')))
        [void]$titleRow.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Percent', 100)))
        $titleRow.Margin = New-Object Windows.Forms.Padding(0, 0, 0, (ScalePx $script:SwsdRowGap))

        if ($IconName -and $script:SwsdIconFont) {
            $iconLabel = New-Object Windows.Forms.Label
            $iconLabel.AutoSize = $true
            $iconLabel.Font = New-Object Drawing.Font($script:SwsdIconFont, (ScaleFont 12), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
            $iconLabel.Text = Get-SwsdIconGlyph $IconName
            $iconLabel.ForeColor = $script:SwsdAccentColor
            $iconLabel.Margin = New-Object Windows.Forms.Padding(0, 0, (ScalePx 8), 0)
            $iconLabel.Anchor = 'Left'
            $titleRow.Controls.Add($iconLabel, 0, 0)
        }

        $sectionTitle = New-Object Windows.Forms.Label
        $sectionTitle.AutoSize = $true
        $sectionTitle.Text = $Title
        $sectionTitle.Font = New-Object Drawing.Font('Segoe UI Semibold', (ScaleFont 11), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
        $sectionTitle.ForeColor = $script:SwsdPalette.TextPrimary
        $sectionTitle.Anchor = 'Left'
        $col = if ($IconName -and $script:SwsdIconFont) { 1 } else { 0 }
        $titleRow.Controls.Add($sectionTitle, $col, 0)

        $innerLayout.Controls.Add($titleRow, 0, 0)
        $innerLayout.RowCount = $innerLayout.RowCount + 1
        [void]$innerLayout.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
    }
    return ,$card
}

# Helper: add row to inner layout
function Add-CardRow([Windows.Forms.Panel]$Card, [Windows.Forms.Control]$Control) {
    $layout = [Windows.Forms.TableLayoutPanel]$Card.Tag
    $rowIndex = $layout.RowCount
    $layout.RowCount = $layout.RowCount + 1
    [void]$layout.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
    if (-not ($Control -is [Windows.Forms.Button])) { $Control.Anchor = 'Top,Left,Right' }
    $Control.Margin = New-Object Windows.Forms.Padding(0, (ScalePx 2), 0, (ScalePx 2))
    $layout.Controls.Add($Control, 0, $rowIndex)
}

# Header band
$headerPanel = New-Object Windows.Forms.TableLayoutPanel
$headerPanel.Dock = 'Fill'
$headerPanel.AutoSize = $true
$headerPanel.ColumnCount = 2
$headerPanel.RowCount = 2
[void]$headerPanel.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('AutoSize')))
[void]$headerPanel.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Percent', 100)))
[void]$headerPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
[void]$headerPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$headerPanel.Margin = New-Object Windows.Forms.Padding(0, 0, 0, (ScalePx $script:SwsdCardGap))

$headerIcon = New-Object Windows.Forms.Label
$headerIcon.AutoSize = $true
$headerIconFont = if ($script:SwsdIconFont) { $script:SwsdIconFont } else { 'Segoe UI' }
$headerIcon.Font = New-Object Drawing.Font($headerIconFont, (ScaleFont 22), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$headerIcon.Text = Get-SwsdIconGlyph 'SolarWinds'
$headerIcon.ForeColor = $script:SwsdAccentColor
$headerIcon.Margin = New-Object Windows.Forms.Padding(0, 0, (ScalePx 10), 0)
$headerIcon.Anchor = 'Left'
$headerPanel.Controls.Add($headerIcon, 0, 0)
$headerPanel.SetRowSpan($headerIcon, 2)

$titleLabel = New-Object Windows.Forms.Label
$titleLabel.AutoSize = $true
$titleLabel.Text = 'SolarWinds Service Desk'
$titleLabel.Font = New-Object Drawing.Font('Segoe UI Semibold', (ScaleFont 16), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$titleLabel.ForeColor = $script:SwsdPalette.TextPrimary
$titleLabel.Anchor = 'Left,Bottom'
$headerPanel.Controls.Add($titleLabel, 1, 0)

$subtitleLabel = New-Object Windows.Forms.Label
$subtitleLabel.AutoSize = $true
$subtitleLabel.Text = 'Connect your own SolarWinds account. Your token stays in Windows Credential Manager on this computer.'
$subtitleLabel.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$subtitleLabel.ForeColor = $script:SwsdPalette.TextSecondary
$subtitleLabel.Anchor = 'Left,Top'
$subtitleLabel.MaximumSize = New-Object Drawing.Size((ScalePx $script:SwsdContentWidth), 0)
$headerPanel.Controls.Add($subtitleLabel, 1, 1)

$rootPanel.Controls.Add($headerPanel, 0, 0)

# Status dashboard: only credential presence is queried, never the saved token value.
$statusCard = New-SwsdCard 'Status' 'Info'
# Measure once, then lock every item to the same four columns on the 8px grid.
# Absolute TableLayoutPanel columns keep state text from moving neighboring fields.
$dashboardFont = New-Object Drawing.Font('Segoe UI', (ScaleFont 9.5), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$dashboardChipFont = New-Object Drawing.Font('Segoe UI', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$dashboardChipTexts = @('OK', 'Unsupported', 'Missing', 'Repair needed', 'Check access', 'Saved', 'Needed', 'Not checked', 'Checking', 'Offline', 'Current', 'Available', 'Ahead', 'Install first')
function Measure-SwsdGridText([string[]]$Texts, [Drawing.Font]$Font, [int]$PaddingPx) {
    $width = 0
    foreach ($text in $Texts) {
        $width = [Math]::Max($width, [Windows.Forms.TextRenderer]::MeasureText($text, $Font).Width)
    }
    $grid = ScalePx 8
    return [int]($grid * [Math]::Ceiling(($width + (ScalePx $PaddingPx)) / $grid))
}
function Update-SwsdDashboardMetrics([Drawing.Font]$ValueFont, [Drawing.Font]$ChipFont) {
$script:dashboardIconWidth = ScalePx 32
$script:dashboardLabelWidth = Measure-SwsdGridText @('Node.js', 'SWSD tools', 'Token', 'Region', 'Profile', 'Updates') $ValueFont 8
$script:dashboardValueWidth = [Math]::Max((ScalePx 144), (Measure-SwsdGridText (@('Not installed', 'Unavailable', ('swsd-mcp ' + $script:SwsdPackageVersion)) + @($script:SwsdProfiles | ForEach-Object { $_.name })) $ValueFont 8))
$script:dashboardChipWidth = Measure-SwsdGridText $dashboardChipTexts $ChipFont 16
# A chip is exactly one measured line plus 4 logical pixels above and below.
$script:dashboardChipHeight = [Windows.Forms.TextRenderer]::MeasureText('Ag', $ChipFont).Height + (2 * (ScalePx 4))
$script:dashboardItemHeight = $dashboardChipHeight
$script:dashboardRowHeight = $dashboardItemHeight + (ScalePx 8)
$script:dashboardItemWidth = $dashboardIconWidth + $dashboardLabelWidth + $dashboardValueWidth + $dashboardChipWidth
$script:dashboardColumnWidth = $dashboardItemWidth + (ScalePx 8)
}
Update-SwsdDashboardMetrics $dashboardFont $dashboardChipFont
$statusRowTable = New-Object Windows.Forms.TableLayoutPanel
$statusRowTable.AutoSize = $false
$statusRowTable.ColumnCount = 2
$statusRowTable.RowCount = 3
$statusRowTable.GrowStyle = 'FixedSize'
$statusRowTable.Padding = New-Object Windows.Forms.Padding(0)
# Retain the measured fixed grid while Add-CardRow temporarily anchors both sides.
# A narrower intermediate parent must not shrink it below its absolute columns.
$statusRowTable.MinimumSize = New-Object Drawing.Size((2 * $dashboardColumnWidth), (3 * $dashboardRowHeight))
$statusRowTable.Size = $statusRowTable.MinimumSize
for ($ci = 0; $ci -lt 2; $ci++) { [void]$statusRowTable.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Absolute', $dashboardColumnWidth))) }
for ($ri = 0; $ri -lt 3; $ri++) { [void]$statusRowTable.RowStyles.Add((New-Object Windows.Forms.RowStyle('Absolute', $dashboardRowHeight))) }

function New-StatusRow([string]$AccessibleName, [string]$IconGlyph, [string]$Label) {
    $rowPanel = New-Object Windows.Forms.TableLayoutPanel
    $rowPanel.AutoSize = $false
    $rowPanel.Anchor = 'Top,Left'
    $rowPanel.MinimumSize = New-Object Drawing.Size($dashboardItemWidth, $dashboardItemHeight)
    $rowPanel.Size = $rowPanel.MinimumSize
    $rowPanel.ColumnCount = 4
    foreach ($width in @($dashboardIconWidth, $dashboardLabelWidth, $dashboardValueWidth, $dashboardChipWidth)) {
        [void]$rowPanel.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Absolute', $width)))
    }
    $rowPanel.RowCount = 1
    $rowPanel.GrowStyle = 'FixedSize'
    [void]$rowPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('Absolute', $dashboardItemHeight)))
    $rowPanel.Padding = New-Object Windows.Forms.Padding(0)
    $rowPanel.AccessibleName = "Status $AccessibleName"

    $icon = New-Object Windows.Forms.Label
    $iconFont = if ($script:SwsdIconFont) { $script:SwsdIconFont } else { 'Segoe UI' }
    $icon.Font = New-Object Drawing.Font($iconFont, (ScaleFont 10), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $icon.Text = $IconGlyph
    $icon.ForeColor = $script:SwsdPalette.TextSecondary
    $icon.Padding = New-Object Windows.Forms.Padding(0, 0, (ScalePx 8), 0)
    $rowPanel.Controls.Add($icon, 0, 0)

    $lbl = New-Object Windows.Forms.Label
    $lbl.Text = $Label
    $lbl.Font = $dashboardFont
    $lbl.ForeColor = $script:SwsdPalette.TextPrimary
    $lbl.Padding = New-Object Windows.Forms.Padding(0, 0, (ScalePx 8), 0)
    $rowPanel.Controls.Add($lbl, 1, 0)

    $value = New-Object Windows.Forms.Label
    $value.Text = '-'
    $value.Font = $dashboardFont
    $value.ForeColor = $script:SwsdPalette.TextSecondary
    $value.Padding = New-Object Windows.Forms.Padding(0, 0, (ScalePx 8), 0)
    $value.AutoEllipsis = $true
    $rowPanel.Controls.Add($value, 2, 0)

    $chip = New-Object Windows.Forms.Label
    $chip.Font = $dashboardChipFont
    $chip.Padding = New-Object Windows.Forms.Padding((ScalePx 8), (ScalePx 4), (ScalePx 8), (ScalePx 4))
    $chip.Visible = $false
    $rowPanel.Controls.Add($chip, 3, 0)
    foreach ($control in @($icon, $lbl, $value, $chip)) {
        $control.AutoSize = $false
        $control.Dock = 'Fill'
        $control.Margin = New-Object Windows.Forms.Padding(0)
        $control.TextAlign = 'MiddleLeft'
    }
    $chip.TextAlign = 'MiddleCenter'

    return @{ Panel = $rowPanel; Icon = $icon; Label = $lbl; Value = $value; Chip = $chip }
}

$srNode = New-StatusRow 'Node.js' (Get-SwsdIconGlyph 'Node') 'Node.js'
$srTools = New-StatusRow 'SolarWinds Service Desk tools installed' (Get-SwsdIconGlyph 'Tools') 'SWSD tools'
$srToken = New-StatusRow 'Token saved' (Get-SwsdIconGlyph 'Key') 'Token'
$srRegion = New-StatusRow 'Region' (Get-SwsdIconGlyph 'Region') 'Region'
$srProfile = New-StatusRow 'Profile' (Get-SwsdIconGlyph 'Profile') 'Profile'
$srUpdate = New-StatusRow 'Updates' (Get-SwsdIconGlyph 'Info') 'Updates'
$script:SwsdLatestVersion = $null
$script:SwsdUpdateState = 'unchecked'
$statusRows = @($srNode, $srTools, $srToken, $srRegion, $srProfile, $srUpdate)
for ($si = 0; $si -lt $statusRows.Count; $si++) {
    $column = $si % 2
    # Split the 16px gutter evenly; both cells retain identical widths.
    $leftGap = if ($column -eq 0) { 0 } else { ScalePx 8 }
    $rightGap = if ($column -eq 0) { ScalePx 8 } else { 0 }
    $statusRows[$si].Panel.Margin = New-Object Windows.Forms.Padding($leftGap, 0, $rightGap, (ScalePx 8))
    $statusRowTable.Controls.Add($statusRows[$si].Panel, $column, [int][Math]::Floor($si / 2))
}
Add-CardRow $statusCard $statusRowTable
$statusRowTable.Anchor = 'Top,Left'
$statusRowTable.Margin = New-Object Windows.Forms.Padding(0)

$ctaChip = New-Object Windows.Forms.Label
$ctaChip.AutoSize = $true
$ctaChip.Font = New-Object Drawing.Font('Segoe UI Semibold', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$ctaChip.Text = 'Done - fully quit and restart ChatGPT, then start a new chat.'
$ctaChip.Padding = New-Object Windows.Forms.Padding((ScalePx 8), (ScalePx 4), (ScalePx 8), (ScalePx 4))
$ctaChip.BackColor = $script:SwsdPalette.StatusSuccessBg
$ctaChip.ForeColor = $script:SwsdPalette.StatusSuccessFg
$ctaChip.Visible = $false
$ctaChip.AccessibleName = 'Restart guidance'
Add-CardRow $statusCard $ctaChip

$progressText = New-Object Windows.Forms.Label
$progressText.AutoSize = $true
$progressText.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$progressText.ForeColor = $script:SwsdPalette.StatusInfoFg
$progressText.Text = 'Installing tools... this window stays available.'
$progressText.Visible = $false
$progressText.AccessibleName = 'Installation progress'
Add-CardRow $statusCard $progressText
$progressBar = New-Object SwsdDesktop.ThemedProgressBar
$progressBar.Style = 'Marquee'
$progressBar.MarqueeAnimationSpeed = 0
$progressBar.BackColor = $script:SwsdPalette.InputBg
$progressBar.ForeColor = $script:SwsdAccentColor
$progressBar.Height = ScalePx 6
$progressBar.Visible = $false
$progressBar.AccessibleName = 'Progress'
Add-CardRow $statusCard $progressBar

$showDetails = New-SwsdButton 'Show details'
$showDetails.AccessibleName = 'Show details'
$showDetails.Visible = $false
$copyDiagnostics = New-SwsdButton 'Copy diagnostics'
$copyDiagnostics.AccessibleName = 'Copy diagnostics'
$statusButtonRow = New-Object Windows.Forms.FlowLayoutPanel
$statusButtonRow.AutoSize = $true
$statusButtonRow.FlowDirection = 'LeftToRight'
$statusButtonRow.WrapContents = $false
Set-SwsdButtonRow @($copyDiagnostics, $showDetails)
$statusButtonRow.Controls.AddRange(@($copyDiagnostics, $showDetails))
Add-CardRow $statusCard $statusButtonRow
$copyDiagnostics.Add_Click({ param($sender, $e) Invoke-SwsdSafe -Source 'CopyDiagnosticsClick' {
    $dpi = $form.DeviceDpi
    $theme = if ($script:SwsdDarkMode) { 'dark' } else { 'light' }
    $report = Get-SwsdDiagnostics -LogPath $script:SwsdDiagnosticsLogPath -Dpi $dpi -Scale $script:SwsdUiScale -Theme $theme
    $report = $report.Replace('[Display]', ("[Display]`r`nDPI awareness API: {0}`r`nWindow awareness: {1}" -f $script:SwsdDpiAwarenessPath, [SwsdDpiBootstrap]::WindowAwareness($form.Handle)))
    Set-SwsdClipboard -Text $report
    Set-SwsdStatus -Kind success -Text 'Diagnostics copied. You can paste them into your support request.'
    if ($form.Visible) { Update-SwsdFormSize }
} })
$errorDetails = New-Object Windows.Forms.Label
$errorDetails.AutoSize = $true
$errorDetails.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$errorDetails.ForeColor = $script:SwsdPalette.TextSecondary
$errorDetails.AccessibleName = 'Error details'
$errorDetails.Visible = $false
Add-CardRow $statusCard $errorDetails
$script:SwsdDetailsExpanded = $false
$showDetails.Add_Click({ param($sender, $e) Invoke-SwsdSafe -Source 'DetailsClick' {
    $script:SwsdDetailsExpanded = -not $script:SwsdDetailsExpanded
    $errorDetails.Visible = $script:SwsdDetailsExpanded
    $showDetails.Text = if ($script:SwsdDetailsExpanded) { 'Hide details' } else { 'Show details' }
    Update-SwsdDashboard
    if ($form.Visible) { Update-SwsdFormSize }
} })
$rootPanel.Controls.Add($statusCard, 0, 1)

function Set-SwsdDashboardRow($Row, [string]$Value, [string]$Chip, [string]$Kind) {
    $Row.Value.Text = $Value
    $Row.Chip.Text = $Chip
    $Row.Chip.BackColor = $script:SwsdPalette[('Status' + $Kind + 'Bg')]
    $Row.Chip.ForeColor = $script:SwsdPalette[('Status' + $Kind + 'Fg')]
    $Row.Chip.Visible = $true
}
function Update-SwsdDashboard {
    $s = Get-SwsdStatus
    if ($s.nodeSupported) { Set-SwsdDashboardRow $srNode ('v' + $s.nodeVersion) 'OK' 'Success' }
    elseif ($s.nodeVersion) { Set-SwsdDashboardRow $srNode ('v' + $s.nodeVersion) 'Unsupported' 'Warn' }
    else { Set-SwsdDashboardRow $srNode 'Not installed' 'Missing' 'Error' }
    if ($s.toolsInstalled) { Set-SwsdDashboardRow $srTools ('swsd-mcp ' + $s.installedVersion) 'OK' 'Success' }
    elseif ($s.installedVersion) { Set-SwsdDashboardRow $srTools ('swsd-mcp ' + $s.installedVersion) 'Repair needed' 'Warn' }
    else { Set-SwsdDashboardRow $srTools 'Not installed' 'Missing' 'Warn' }
    if (-not $s.credentialAvailable) { Set-SwsdDashboardRow $srToken 'Unavailable' 'Check access' 'Error' }
    elseif ($s.credentialSaved) { Set-SwsdDashboardRow $srToken 'Yes' 'Saved' 'Success' }
    else { Set-SwsdDashboardRow $srToken 'No' 'Needed' 'Warn' }
    Set-SwsdDashboardRow $srRegion $s.region 'Saved' 'Info'
    $profileName = ($script:SwsdProfiles | Where-Object { $_.id -eq $s.profile }).name
    Set-SwsdDashboardRow $srProfile $profileName 'Saved' 'Info'
    $currentProfile.Text = 'Saved profile: ' + $profileName
    # Layout validation includes the helper even on a machine that already has supported Node.
    $nodeInstallButton.Visible = (-not $s.nodeSupported) -or $ValidateWindow
    $updateValue = if ($script:SwsdLatestVersion) { 'v' + $script:SwsdLatestVersion } else { '-' }
    switch ($script:SwsdUpdateState) {
        'checking' { Set-SwsdDashboardRow $srUpdate $updateValue 'Checking' 'Info' }
        'offline' { Set-SwsdDashboardRow $srUpdate '-' 'Offline' 'Warn' }
        'checked' {
            $comparison = Compare-SwsdVersion -Installed (Get-SwsdInstalledVersion) -Latest $script:SwsdLatestVersion
            switch ($comparison) {
                'current' { Set-SwsdDashboardRow $srUpdate $updateValue 'Current' 'Success' }
                'update' { Set-SwsdDashboardRow $srUpdate $updateValue 'Available' 'Warn' }
                'newer' { Set-SwsdDashboardRow $srUpdate $updateValue 'Ahead' 'Info' }
                default { Set-SwsdDashboardRow $srUpdate $updateValue 'Install first' 'Info' }
            }
        }
        default { Set-SwsdDashboardRow $srUpdate '-' 'Not checked' 'Info' }
    }
}

# Card 1: Install tools
$card1 = New-SwsdCard '1. Install tools' 'Tools'
$installDesc = New-Object Windows.Forms.Label
$installDesc.AutoSize = $true
$installDesc.Text = 'Requires Node.js 24.15 or newer within version 24.'
$installDesc.ForeColor = $script:SwsdPalette.TextSecondary
$installDesc.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$installDesc.MaximumSize = New-Object Drawing.Size((ScalePx $script:SwsdContentWidth), 0)
Add-CardRow $card1 $installDesc

$install = New-SwsdButton 'Install / repair tools' $true
$install.Anchor = 'Top,Left'
$checkUpdates = New-SwsdButton 'Check for updates'
$checkUpdates.AccessibleName = 'Check for updates'
$nodeInstallButton = New-SwsdButton 'Install Node.js 24'
$nodeInstallButton.AccessibleName = 'Install Node.js'
$installButtonRow = New-Object Windows.Forms.FlowLayoutPanel
$installButtonRow.AutoSize = $true
$installButtonRow.FlowDirection = 'LeftToRight'
$installButtonRow.WrapContents = $false
Set-SwsdButtonRow @($install, $checkUpdates, $nodeInstallButton)
$installButtonRow.Controls.AddRange(@($install, $checkUpdates, $nodeInstallButton))
Add-CardRow $card1 $installButtonRow
$rootPanel.Controls.Add($card1, 0, 2)

# Card 2: Region + token
$card2 = New-SwsdCard '2. Connect your account' 'Key'

$region = New-Object SwsdDesktop.ThemedComboBox
$region.BorderColor = $script:SwsdPalette.InputBorder; $region.ArrowColor = $script:SwsdPalette.TextSecondary
$region.DropDownStyle = 'DropDownList'
$region.FlatStyle = 'Flat'
$region.BackColor = $script:SwsdPalette.InputBg
$region.ForeColor = $script:SwsdPalette.TextPrimary
$region.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 10), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$region.Height = ScalePx 30
$region.DrawMode = 'OwnerDrawFixed'
$region.Add_DrawItem({
    param($sender, $e) Invoke-SwsdSafe -Source 'DrawItem' -Quiet {
    if ($e.Index -lt 0) { return }
    $bg = if (($e.State -band [Windows.Forms.DrawItemState]::Selected) -eq [Windows.Forms.DrawItemState]::Selected) {
        $script:SwsdAccentColor
    } else { $script:SwsdPalette.InputBg }
    $fg = if (($e.State -band [Windows.Forms.DrawItemState]::Selected) -eq [Windows.Forms.DrawItemState]::Selected) {
        Get-SwsdContrastColor $script:SwsdAccentColor
    } elseif (-not $sender.Enabled) { $script:SwsdPalette.TextSecondary } else { $script:SwsdPalette.TextPrimary }
    $e.Graphics.FillRectangle((New-Object Drawing.SolidBrush($bg)), $e.Bounds)
    $text = $sender.GetItemText($sender.Items[$e.Index])
    $e.Graphics.DrawString($text, $sender.Font, (New-Object Drawing.SolidBrush($fg)), $e.Bounds.X + (ScalePx 2), $e.Bounds.Y + (ScalePx 2))
 }})
[void]$region.Items.Add('US - api.samanage.com')
[void]$region.Items.Add('EU - apieu.samanage.com')
$region.SelectedIndex = 0
if ((Get-SwsdSettings).baseUrl -eq 'https://apieu.samanage.com') { $region.SelectedIndex = 1 }
Add-CardRow $card2 (New-SwsdFieldLabel 'Region')
Add-CardRow $card2 $region

$tokenBox = New-Object Windows.Forms.TextBox
$tokenBox.UseSystemPasswordChar = $true
$tokenBox.BackColor = $script:SwsdPalette.InputBg
$tokenBox.ForeColor = $script:SwsdPalette.TextPrimary
$tokenBox.BorderStyle = 'None'
$tokenBox.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 10), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$tokenBox.Height = ScalePx 30
$tokenBox.Add_EnabledChanged({ param($sender, $e) Invoke-SwsdSafe -Source 'EnabledChanged' {
    if (-not $tokenBox.Enabled) { $tokenBox.ForeColor = $script:SwsdPalette.TextSecondary }
    else { $tokenBox.ForeColor = $script:SwsdPalette.TextPrimary }
 }})
Add-CardRow $card2 (New-SwsdFieldLabel 'API token')
Add-CardRow $card2 (New-SwsdInputHost $tokenBox (ScalePx 6))
try { [void][SwsdDesktop.Windows]::SendMessage($tokenBox.Handle, 0x1501, [IntPtr]1, 'Paste your API token') } catch {}

$tokenHint = New-Object Windows.Forms.Label
$tokenHint.AutoSize = $true
$tokenHint.Text = 'Saved tokens are never displayed. Paste a new token only to add or replace it.'
$tokenHint.ForeColor = $script:SwsdPalette.TextSecondary
$tokenHint.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$tokenHint.MaximumSize = New-Object Drawing.Size((ScalePx $script:SwsdContentWidth), 0)
Add-CardRow $card2 $tokenHint

$buttonRow2 = New-Object Windows.Forms.FlowLayoutPanel
$buttonRow2.AutoSize = $true
$buttonRow2.WrapContents = $false
$buttonRow2.FlowDirection = 'LeftToRight'
$buttonRow2.Anchor = 'Top,Left,Right'
$buttonRow2.Margin = New-Object Windows.Forms.Padding(0, (ScalePx 6), 0, 0)

$save = New-SwsdButton 'Test and save token' $true
$buttonRow2.Controls.Add($save)

$test = New-SwsdButton 'Test saved connection'
$buttonRow2.Controls.Add($test)

$remove = New-SwsdButton 'Remove saved token'
$buttonRow2.Controls.Add($remove)

Set-SwsdButtonRow @($save, $test, $remove)
Add-CardRow $card2 $buttonRow2
$rootPanel.Controls.Add($card2, 0, 3)

# Card 3: Profile selection
$card3 = New-SwsdCard '3. Choose your tools' 'Profile'

$profileDesc = New-Object Windows.Forms.Label
$profileDesc.AutoSize = $true
$profileDesc.Text = 'You can change this later without re-entering a token.'
$profileDesc.ForeColor = $script:SwsdPalette.TextSecondary
$profileDesc.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$profileDesc.MaximumSize = New-Object Drawing.Size((ScalePx $script:SwsdContentWidth), 0)
Add-CardRow $card3 $profileDesc

$profile = New-Object SwsdDesktop.ThemedComboBox
$profile.BorderColor = $script:SwsdPalette.InputBorder; $profile.ArrowColor = $script:SwsdPalette.TextSecondary
$profile.DropDownStyle = 'DropDownList'
$profile.AccessibleName = 'SWSD profile'
$profile.FlatStyle = 'Flat'
$profile.BackColor = $script:SwsdPalette.InputBg
$profile.ForeColor = $script:SwsdPalette.TextPrimary
$profile.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 10), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$profile.Height = ScalePx 30
$profile.DrawMode = 'OwnerDrawFixed'
$profile.Add_DrawItem({
    param($sender, $e) Invoke-SwsdSafe -Source 'DrawItem' -Quiet {
    if ($e.Index -lt 0) { return }
    $bg = if (($e.State -band [Windows.Forms.DrawItemState]::Selected) -eq [Windows.Forms.DrawItemState]::Selected) {
        $script:SwsdAccentColor
    } else { $script:SwsdPalette.InputBg }
    $fg = if (($e.State -band [Windows.Forms.DrawItemState]::Selected) -eq [Windows.Forms.DrawItemState]::Selected) {
        Get-SwsdContrastColor $script:SwsdAccentColor
    } elseif (-not $sender.Enabled) { $script:SwsdPalette.TextSecondary } else { $script:SwsdPalette.TextPrimary }
    $e.Graphics.FillRectangle((New-Object Drawing.SolidBrush($bg)), $e.Bounds)
    $text = $sender.GetItemText($sender.Items[$e.Index])
    $e.Graphics.DrawString($text, $sender.Font, (New-Object Drawing.SolidBrush($fg)), $e.Bounds.X + (ScalePx 2), $e.Bounds.Y + (ScalePx 2))
 }})
foreach ($item in $script:SwsdProfiles) { [void]$profile.Items.Add($item.name) }
$savedProfile = (Get-SwsdSettings).profile
$profile.SelectedIndex = [Array]::IndexOf(@($script:SwsdProfiles | ForEach-Object { $_.id }), $savedProfile)
Add-CardRow $card3 (New-SwsdFieldLabel 'Profile')
Add-CardRow $card3 $profile

$profileDescription = New-Object Windows.Forms.Label
$profileDescription.AutoSize = $true
$profileDescription.MaximumSize = New-Object Drawing.Size((ScalePx $script:SwsdContentWidth), 0)
$profileDescription.Text = $script:SwsdProfiles[$profile.SelectedIndex].description
$profileDescription.ForeColor = $script:SwsdPalette.TextSecondary
$profileDescription.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
Add-CardRow $card3 $profileDescription
$profile.Add_SelectedIndexChanged({ param($sender, $e) Invoke-SwsdSafe -Source 'SelectedIndexChanged' { $profileDescription.Text = $script:SwsdProfiles[$profile.SelectedIndex].description  }})

$profileButtonRow = New-Object Windows.Forms.FlowLayoutPanel
$profileButtonRow.AutoSize = $true
$profileButtonRow.WrapContents = $false
$profileButtonRow.FlowDirection = 'LeftToRight'
$profileButtonRow.Anchor = 'Top,Left,Right'
$profileButtonRow.Margin = New-Object Windows.Forms.Padding(0, (ScalePx 6), 0, 0)

$saveProfile = New-SwsdButton 'Save profile' $true
$profileButtonRow.Controls.Add($saveProfile)

$currentProfile = New-Object Windows.Forms.Label
$currentProfile.AutoSize = $true
$currentProfile.Text = 'Saved profile: ' + $script:SwsdProfiles[$profile.SelectedIndex].name
$currentProfile.ForeColor = $script:SwsdPalette.TextSecondary
$currentProfile.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$currentProfile.Anchor = 'Left'
$currentProfile.Margin = New-Object Windows.Forms.Padding((ScalePx 12), 0, 0, 0)
$currentProfile.AutoSize = $false
$currentProfile.TextAlign = 'MiddleLeft'
$currentProfile.Size = New-Object Drawing.Size(([Windows.Forms.TextRenderer]::MeasureText('Saved profile: Administrator (all tools)', $currentProfile.Font).Width), (ScalePx $script:SwsdButtonMinHeight))
$profileButtonRow.Controls.Add($currentProfile)

Add-CardRow $card3 $profileButtonRow
$rootPanel.Controls.Add($card3, 0, 4)

# Status area with chip support
$statusPanel = New-Object Windows.Forms.Panel
$statusPanel.Dock = 'Fill'
$statusPanel.AutoSize = $true
$statusPanel.Padding = New-Object Windows.Forms.Padding((ScalePx 4), (ScalePx 8), (ScalePx 4), (ScalePx 4))
$statusPanel.Anchor = 'Top,Left,Right'

$status = New-Object Windows.Forms.Label
$status.AutoSize = $true
$status.MaximumSize = New-Object Drawing.Size((ScalePx $script:SwsdContentWidth), 0)
$status.Text = 'Start with Install / repair tools. Then test and save your token. After setup, start a new chat.'
$status.ForeColor = $script:SwsdPalette.TextSecondary
$status.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9.5), [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$statusPanel.Controls.Add($status)

$rootPanel.Controls.Add($statusPanel, 0, 5)

# Status chip helper
function Set-SwsdStatus {
    param(
        [ValidateSet('success','warn','error','info')][string]$Kind = 'info',
        [Parameter(Mandatory)][string]$Text
    )
    $colors = switch ($Kind) {
        'success' { @{ Bg = $script:SwsdPalette.StatusSuccessBg; Fg = $script:SwsdPalette.StatusSuccessFg; Icon = 'Check' } }
        'warn'    { @{ Bg = $script:SwsdPalette.StatusWarnBg; Fg = $script:SwsdPalette.StatusWarnFg; Icon = 'Warning' } }
        'error'   { @{ Bg = $script:SwsdPalette.StatusErrorBg; Fg = $script:SwsdPalette.StatusErrorFg; Icon = 'Error' } }
        'info'    { @{ Bg = $script:SwsdPalette.StatusInfoBg; Fg = $script:SwsdPalette.StatusInfoFg; Icon = 'Info' } }
    }
    $glyph = Get-SwsdIconGlyph $colors.Icon
    $prefix = if ($glyph) { "$glyph  " } else { '' }
    $status.Text = "$prefix$Text"
    $status.ForeColor = $colors.Fg
    $status.BackColor = $colors.Bg
    $status.Padding = New-Object Windows.Forms.Padding((ScalePx 10), (ScalePx 6), (ScalePx 10), (ScalePx 6))
}

# Reset status to plain style
function Reset-SwsdStatus {
    $status.BackColor = [Drawing.Color]::Transparent
    $status.Padding = New-Object Windows.Forms.Padding(0)
    $status.ForeColor = $script:SwsdPalette.TextSecondary
}

# Auto-size the form to fit content, clamped to working area
function Update-SwsdDashboardGrid([int]$AvailableWidth) {
    $columns = if (2 * $dashboardColumnWidth -le $AvailableWidth) { 2 } else { 1 }
    $rows = [int][Math]::Ceiling($statusRows.Count / $columns)
    $statusRowTable.SuspendLayout()
    try {
        $statusRowTable.Controls.Clear()
        $statusRowTable.ColumnStyles.Clear(); $statusRowTable.RowStyles.Clear()
        $statusRowTable.ColumnCount = $columns; $statusRowTable.RowCount = $rows
        for ($i = 0; $i -lt $columns; $i++) { [void]$statusRowTable.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Absolute', $dashboardColumnWidth))) }
        for ($i = 0; $i -lt $rows; $i++) { [void]$statusRowTable.RowStyles.Add((New-Object Windows.Forms.RowStyle('Absolute', $dashboardRowHeight))) }
        for ($i = 0; $i -lt $statusRows.Count; $i++) {
            $column = $i % $columns
            $leftGap = if ($column -eq 0) { 0 } else { ScalePx 8 }
            $rightGap = if ($column -eq 0) { ScalePx 8 } else { 0 }
            $statusRows[$i].Panel.Margin = New-Object Windows.Forms.Padding($leftGap, 0, $rightGap, (ScalePx 8))
            $statusRowTable.Controls.Add($statusRows[$i].Panel, $column, [int][Math]::Floor($i / $columns))
        }
        $gridSize = New-Object Drawing.Size(($columns * $dashboardColumnWidth), ($rows * $dashboardRowHeight))
        # TableLayout can restore a pre-measurement specified width on its next
        # parent layout, giving surplus pixels to the last Absolute column.
        $statusRowTable.MinimumSize = [Drawing.Size]::Empty
        $statusRowTable.MaximumSize = $gridSize
        $statusRowTable.MinimumSize = $gridSize
        $statusRowTable.Size = $gridSize
    } finally { $statusRowTable.ResumeLayout($true) }
}
function Update-SwsdFormSize([switch]$Center, [switch]$PreserveSize) {
    try {
        $scaledContentWidth = ScalePx $script:SwsdContentWidth
        $screen = [Windows.Forms.Screen]::FromControl($form).WorkingArea
        $dashboardInset = 2 * ((ScalePx $script:SwsdRootPaddingH) + (ScalePx $script:SwsdCardPaddingH) + (ScalePx $script:SwsdScreenMargin)) + ($form.Width - $form.ClientSize.Width) + $form.ScrollBarWidth
        Update-SwsdDashboardGrid ($screen.Width - $dashboardInset)

        # First pass: set wrapping widths generously so GetPreferredSize sees unwrapped text
        foreach ($lbl in @($subtitleLabel, $installDesc, $tokenHint, $profileDesc, $profileDescription, $status, $ctaChip, $progressText, $errorDetails)) {
            $lbl.MaximumSize = New-Object Drawing.Size(0, 0)
        }

        # Force layout recalculation
        $form.PerformLayout()
        $rootPanel.PerformLayout()

        # Get preferred size without width constraint to see natural content width
        $preferred = $rootPanel.GetPreferredSize([Drawing.Size]::Empty)

        # Use the larger of natural width and target content width
        $targetClientWidth = [Math]::Max($preferred.Width, $scaledContentWidth)
        # GetPreferredSize can under-report a fixed table inside an AutoSize card.
        # Include the actual dashboard plus every ancestor's padding/margins.
        $dashboardClientWidth = $statusRowTable.Width
        for ($parent = $statusRowTable; $parent -ne $form; $parent = $parent.Parent) {
            $dashboardClientWidth += $parent.Margin.Horizontal
            if ($parent -ne $statusRowTable) { $dashboardClientWidth += $parent.Padding.Horizontal }
        }
        $targetClientWidth = [Math]::Max($targetClientWidth, $dashboardClientWidth)

        # Now set wrapping widths based on target width
        $availableCardWidth = $targetClientWidth - (2 * (ScalePx $script:SwsdRootPaddingH)) - (2 * (ScalePx $script:SwsdCardPaddingH))
        if ($availableCardWidth -lt 100) { $availableCardWidth = $scaledContentWidth }
        $subtitleAvailable = $targetClientWidth - (2 * (ScalePx $script:SwsdRootPaddingH)) - (ScalePx 40)
        if ($subtitleAvailable -lt 100) { $subtitleAvailable = $availableCardWidth }
        $subtitleLabel.MaximumSize = New-Object Drawing.Size($subtitleAvailable, 0)
        foreach ($lbl in @($installDesc, $tokenHint, $profileDesc, $profileDescription, $status, $ctaChip, $progressText, $errorDetails)) {
            $lbl.MaximumSize = New-Object Drawing.Size($availableCardWidth, 0)
        }

        # Re-layout with wrapping applied
        $form.PerformLayout()
        $rootPanel.PerformLayout()
        $preferredWrapped = $rootPanel.GetPreferredSize([Drawing.Size]::Empty)

        $screen = [Windows.Forms.Screen]::FromControl($form).WorkingArea
        $margin = ScalePx $script:SwsdScreenMargin
        $maxWidth = $screen.Width - (2 * $margin)
        # Clamp the whole window (client content plus frame) only to the working area.
        $maxHeight = $screen.Height

        $frameWidth = $form.Width - $form.ClientSize.Width
        $frameHeight = $form.Height - $form.ClientSize.Height

        $finalClientWidth = [Math]::Max($targetClientWidth, $preferredWrapped.Width)
        $finalClientHeight = $preferredWrapped.Height

        $targetWidth = $finalClientWidth + $frameWidth
        $targetHeight = $finalClientHeight + $frameHeight

        if ($targetWidth -gt $maxWidth) { $targetWidth = $maxWidth }
        if ($targetHeight -gt $maxHeight) { $targetHeight = $maxHeight }

        # Reserve the scrollbar's actual pixel width so the fixed dashboard still fits.
        $needsScroll = $finalClientHeight -gt ($targetHeight - $frameHeight)
        if ($needsScroll) {
            $targetWidth = [Math]::Min($maxWidth, ($targetWidth + $form.ScrollBarWidth))
        }

        $form.MinimumSize = New-Object Drawing.Size($targetWidth, $targetHeight)
        if ($PreserveSize) {
            $targetWidth = [Math]::Min($maxWidth, [Math]::Max($targetWidth, $form.Width))
            $targetHeight = [Math]::Min($maxHeight, [Math]::Max($targetHeight, $form.Height))
        }
        $form.Size = New-Object Drawing.Size($targetWidth, $targetHeight)

        # Force layout after sizing
        $form.PerformLayout()
        $rootPanel.PerformLayout()

        $rootPanel.AutoScroll = $needsScroll

        $centerX = $screen.Left + [int](($screen.Width - $targetWidth) / 2)
        $centerY = $screen.Top + [int](($screen.Height - $targetHeight) / 2)
        if ($Center) { $form.Location = New-Object Drawing.Point($centerX, $centerY) }
        else {
            $form.Location = New-Object Drawing.Point(([Math]::Max($screen.Left, [Math]::Min($form.Left, $screen.Right - $form.Width))), ([Math]::Max($screen.Top, [Math]::Min($form.Top, $screen.Bottom - $form.Height))))
        }

        # Final pass: update wrapping widths based on actual client width
        Update-SwsdWrappingWidths

        # Re-layout one more time after wrapping width update
        $form.PerformLayout()
        $rootPanel.PerformLayout()
    } catch { throw }
}

# Update MaximumSize on wrapping labels when the card width changes
function Update-SwsdWrappingWidths {
    try {
        $rootClientWidth = $rootPanel.ClientSize.Width
        $availableCardWidth = $rootClientWidth - (2 * (ScalePx $script:SwsdRootPaddingH)) - (2 * (ScalePx $script:SwsdCardPaddingH))
        if ($availableCardWidth -lt 100) { $availableCardWidth = ScalePx $script:SwsdContentWidth }

        # Subtitle is in header panel, not a card; account for icon column width
        $headerContentWidth = $rootClientWidth - (2 * (ScalePx $script:SwsdRootPaddingH))
        $subtitleAvailable = $headerContentWidth - (ScalePx 40)
        if ($subtitleAvailable -lt 100) { $subtitleAvailable = $availableCardWidth }
        $subtitleLabel.MaximumSize = New-Object Drawing.Size($subtitleAvailable, 0)

        foreach ($lbl in @($installDesc, $tokenHint, $profileDesc, $profileDescription, $status, $ctaChip, $progressText, $errorDetails)) {
            $lbl.MaximumSize = New-Object Drawing.Size($availableCardWidth, 0)
        }
    } catch {}
}

# Capture immutable geometry at 96 DPI (including SWSD_UI_SCALE). Never multiply
# the last monitor's rounded sizes/fonts: 96 -> 120 -> 192 -> 96 must be lossless.
$script:SwsdDpiLayout = New-Object 'System.Collections.Generic.List[object]'
$script:SwsdDpiFonts = @()
$script:SwsdApplyingDpi = $false
$script:SwsdAppliedDpi = 0
function Save-SwsdDpiLayout([Windows.Forms.Control]$Control) {
    $script:SwsdDpiLayout.Add(@{
        Control = $Control; Font = $Control.Font; Size = $Control.Size
        Minimum = $Control.MinimumSize; Maximum = $Control.MaximumSize
        Padding = $Control.Padding; Margin = $Control.Margin
        Columns = $(if ($Control -is [Windows.Forms.TableLayoutPanel]) { @($Control.ColumnStyles | ForEach-Object { $_.Width }) } else { @() })
        Rows = $(if ($Control -is [Windows.Forms.TableLayoutPanel]) { @($Control.RowStyles | ForEach-Object { $_.Height }) } else { @() })
    })
    foreach ($child in $Control.Controls) { Save-SwsdDpiLayout $child }
}
Save-SwsdDpiLayout $form
$form.AutoScaleDimensions = $form.CurrentAutoScaleDimensions

function Update-SwsdDpiLayout([int]$Dpi) {
    if ($script:SwsdApplyingDpi -or $script:SwsdAppliedDpi -eq $Dpi) { return }
    $script:SwsdApplyingDpi = $true
    $script:SwsdDeviceDpi = $Dpi
    $factor = $Dpi / 96.0
    $oldFonts = $script:SwsdDpiFonts
    $script:SwsdDpiFonts = @()
    $statusHasPadding = $status.Padding.Horizontal -gt 0
    foreach ($entry in $script:SwsdDpiLayout) { $entry.Control.SuspendLayout() }
    try {
        foreach ($entry in $script:SwsdDpiLayout) {
            $control = $entry.Control
            $font = New-Object Drawing.Font($entry.Font.FontFamily, ([float]($entry.Font.Size * $factor)), $entry.Font.Style, [Drawing.GraphicsUnit]::Pixel)
            $script:SwsdDpiFonts += $font
            $control.Font = $font
            foreach ($property in @('Padding', 'Margin')) {
                $p = $entry[$property]
                $control.$property = New-Object Windows.Forms.Padding(([int][Math]::Round($p.Left * $factor)), ([int][Math]::Round($p.Top * $factor)), ([int][Math]::Round($p.Right * $factor)), ([int][Math]::Round($p.Bottom * $factor)))
            }
            if ($control -eq $form) { continue }
            $control.MinimumSize = [Drawing.Size]::Empty
            $control.MaximumSize = New-Object Drawing.Size(([int][Math]::Round($entry.Maximum.Width * $factor)), ([int][Math]::Round($entry.Maximum.Height * $factor)))
            $control.MinimumSize = New-Object Drawing.Size(([int][Math]::Round($entry.Minimum.Width * $factor)), ([int][Math]::Round($entry.Minimum.Height * $factor)))
            if (-not $control.AutoSize) { $control.Size = New-Object Drawing.Size(([int][Math]::Round($entry.Size.Width * $factor)), ([int][Math]::Round($entry.Size.Height * $factor))) }
            if ($control -is [Windows.Forms.TableLayoutPanel] -and $control -ne $statusRowTable) {
                for ($i = 0; $i -lt $control.ColumnStyles.Count; $i++) {
                    if ($control.ColumnStyles[$i].SizeType -eq 'Absolute') { $control.ColumnStyles[$i].Width = [int][Math]::Round($entry.Columns[$i] * $factor) }
                }
                for ($i = 0; $i -lt $control.RowStyles.Count; $i++) {
                    if ($control.RowStyles[$i].SizeType -eq 'Absolute') { $control.RowStyles[$i].Height = [int][Math]::Round($entry.Rows[$i] * $factor) }
                }
            }
        }
        # Font metrics are not linear at fractional DPI. Remeasure the fixed grid.
        Update-SwsdDashboardMetrics $srNode.Label.Font $srNode.Chip.Font
        foreach ($item in $statusRows) {
            $item.Panel.MinimumSize = New-Object Drawing.Size($dashboardItemWidth, $dashboardItemHeight)
            $item.Panel.Size = $item.Panel.MinimumSize
            $widths = @($dashboardIconWidth, $dashboardLabelWidth, $dashboardValueWidth, $dashboardChipWidth)
            for ($i = 0; $i -lt 4; $i++) { $item.Panel.ColumnStyles[$i].Width = $widths[$i] }
            $item.Panel.RowStyles[0].Height = $dashboardItemHeight
            $item.Chip.Padding = New-Object Windows.Forms.Padding((ScalePx 8), (ScalePx 4), (ScalePx 8), (ScalePx 4))
        }
        foreach ($row in @($installButtonRow, $buttonRow2, $profileButtonRow, $statusButtonRow)) {
            $buttons = @($row.Controls | Where-Object { $_ -is [Windows.Forms.Button] })
            foreach ($button in $buttons) {
                $button.FlatAppearance.BorderSize = [Math]::Max(1, (ScalePx 1))
                $button.Width = [Windows.Forms.TextRenderer]::MeasureText($button.Text, $button.Font).Width + (2 * (ScalePx $script:SwsdButtonPaddingH)) + (2 * $button.FlatAppearance.BorderSize)
            }
            Set-SwsdButtonRow $buttons
        }
        foreach ($combo in @($region, $profile)) {
            $combo.PixelScale = $script:SwsdUiScale * $factor
            $combo.ItemHeight = [Windows.Forms.TextRenderer]::MeasureText('Ag', $combo.Font).Height + (ScalePx 4)
        }
        $tokenBox.Parent.Height = $tokenBox.PreferredSize.Height + $tokenBox.Parent.Padding.Vertical
        $currentProfile.Size = New-Object Drawing.Size(([Windows.Forms.TextRenderer]::MeasureText('Saved profile: Administrator (all tools)', $currentProfile.Font).Width), (ScalePx $script:SwsdButtonMinHeight))
        if ($statusHasPadding) { $status.Padding = New-Object Windows.Forms.Padding((ScalePx 10), (ScalePx 6), (ScalePx 10), (ScalePx 6)) }
        $form.AutoScaleDimensions = $form.CurrentAutoScaleDimensions
        $form.UpdateIcon($script:SwsdIconFont, [float]($script:SwsdUiScale * $factor))
        $script:SwsdAppliedDpi = $Dpi
    } finally {
        for ($i = $script:SwsdDpiLayout.Count - 1; $i -ge 0; $i--) { $script:SwsdDpiLayout[$i].Control.ResumeLayout($true) }
        foreach ($font in $oldFonts) { $font.Dispose() }
        $script:SwsdApplyingDpi = $false
    }
}
$form.Add_Load({ param($sender, $e) Invoke-SwsdSafe -Source 'Load' { Update-SwsdDpiLayout $form.DeviceDpi; Update-SwsdFormSize -Center }})
$form.Add_Resize({ param($sender, $e) Invoke-SwsdSafe -Source 'Resize' -Quiet { if (-not $script:SwsdApplyingDpi) { Update-SwsdWrappingWidths } }})
$form.Add_MonitorDpiChanged({
    param($sender, $e) Invoke-SwsdSafe -Source 'DpiChanged' {
        # Release the previous monitor's minimum before applying a smaller rectangle.
        $form.MinimumSize = [Drawing.Size]::Empty
        $form.Bounds = $e.SuggestedRectangle
        Update-SwsdDpiLayout $e.DeviceDpiNew
        Update-SwsdFormSize -PreserveSize
    }
})

$script:SwsdInstallWorker = $null
$script:SwsdInstallTimer = New-Object Windows.Forms.Timer
$script:SwsdInstallTimer.Interval = 50

function Set-SwsdBusy([bool]$Busy) {
    foreach ($control in @($install, $checkUpdates, $nodeInstallButton, $save, $test, $remove, $saveProfile, $showDetails, $copyDiagnostics, $region, $tokenBox, $profile)) { $control.Enabled = -not $Busy }
    $progressBar.Visible = $Busy
    $progressText.Visible = $Busy
    $form.UseWaitCursor = $false
}
function Reset-SwsdAction {
    $script:SwsdDetailsExpanded = $false
    $ctaChip.Visible = $false
    $showDetails.Visible = $false
    $showDetails.Text = 'Show details'
    $errorDetails.Visible = $false
    $errorDetails.Text = ''
    Reset-SwsdStatus
}
function Show-SwsdError([Exception]$Exception) {
    $info = Format-SwsdFriendlyError $Exception
    Set-SwsdStatus -Kind $info.Kind -Text $info.Friendly
    $errorDetails.Text = $info.Technical
    $showDetails.Visible = $true
}
function Invoke-SetupAction([scriptblock]$Action) {
    if ($null -ne $script:SwsdInstallWorker) { return }
    Set-SwsdBusy $true
    Reset-SwsdAction
    $status.Text = 'Working... please wait.'
    $form.Refresh()
    try { & $Action } catch { Show-SwsdError $_.Exception } finally {
        Set-SwsdBusy $false
        Update-SwsdDashboard
        if ($form.Visible) { Update-SwsdFormSize }
    }
}
function Show-SwsdUpdateUnavailable {
    $script:SwsdLatestVersion = $null
    $script:SwsdUpdateState = 'offline'
    Set-SwsdStatus -Kind warn -Text 'Could not check for updates. Check your connection and npm installation, then try again.'
}
function Start-SwsdInstall {
    param([ValidateSet('Install', 'CheckUpdates', 'Node')][string]$Operation = 'Install')
    if ($null -ne $script:SwsdInstallWorker) { return }
    Reset-SwsdAction
    Set-SwsdBusy $true
    $progressText.Text = switch ($Operation) {
        'CheckUpdates' { 'Checking for updates... this window stays available.' }
        'Node' { 'Installing Node.js 24... this window stays available.' }
        default { 'Installing tools... this window stays available.' }
    }
    Set-SwsdStatus -Kind info -Text $progressText.Text
    if ($Operation -eq 'CheckUpdates') {
        $script:SwsdUpdateState = 'checking'
        Update-SwsdDashboard
    }
    $powershell = $null
    $runspace = $null
    $script:SwsdInstallPollCount = 0
    try {
        # The worker receives paths and optional test doubles, never controls or token values.
        $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
        $runspace.ApartmentState = 'STA'
        $runspace.ThreadOptions = 'ReuseThread'
        $runspace.Open()
        $powershell = [System.Management.Automation.PowerShell]::Create()
        $powershell.Runspace = $runspace
        $mockBody = $null
        $mockFails = $false
        $mockCalls = $null
        $mockResult = $null
        $operationFunction = switch ($Operation) {
            'CheckUpdates' { 'Get-SwsdLatestVersion' }
            'Node' { 'Install-SwsdNode' }
            default { 'Install-SwsdTools' }
        }
        if ($ValidateHandlers) {
            $mockBody = (Get-Item ("Function:" + $operationFunction)).ScriptBlock.ToString()
            $mockFails = if ($Operation -eq 'Node') { $script:SwsdMockNodeFails } else { $script:SwsdMockInstallFails }
            $mockCalls = $script:SwsdMockCalls
            $mockResult = $script:SwsdMockLatestVersion
        }
        [void]$powershell.AddScript({
            param($ScriptsRoot, $HomeOverride, $CredentialTarget, $MockBody, $MockFails, $MockCalls, $Operation, $OperationFunction, $MockResult)
            . (Join-Path $ScriptsRoot 'Common.ps1')
            # Common.ps1 initializes defaults; overrides must be applied after loading it.
            $script:SwsdHome = $HomeOverride
            $script:SwsdCredentialTarget = $CredentialTarget
            if ($MockBody) {
                $script:SwsdMockInstallFails = $MockFails
                $script:SwsdMockCalls = $MockCalls
                $script:SwsdMockLatestVersion = $MockResult
                Set-Item ("Function:" + $OperationFunction) ([scriptblock]::Create($MockBody))
            }
            if ($Operation -eq 'CheckUpdates') { return Get-SwsdLatestVersion }
            if ($Operation -eq 'Node') { Install-SwsdNode; return }
            $sourceRoot = Split-Path $ScriptsRoot
            if (Test-Path -LiteralPath (Join-Path $ScriptsRoot 'runtime\package.json')) { $sourceRoot = $ScriptsRoot }
            # Preserve repair from the installed Start menu client and its retained recipe.
            if ($sourceRoot -eq $ScriptsRoot) {
                $stage = Join-Path $script:SwsdHome 'repair-source'
                New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
                foreach ($name in @('Common.ps1','Manage-Swsd.ps1','Start-Swsd.ps1')) { Copy-Item -LiteralPath (Join-Path $ScriptsRoot $name) -Destination (Join-Path $stage 'scripts') -Force }
                New-Item -ItemType Directory -Path (Join-Path $stage 'runtime') -Force | Out-Null
                Copy-Item -LiteralPath (Join-Path $ScriptsRoot 'runtime\package.json'),(Join-Path $ScriptsRoot 'runtime\package-lock.json') -Destination (Join-Path $stage 'runtime') -Force
                $sourceRoot = $stage
            }
            Install-SwsdTools -SourceRoot $sourceRoot -Force
        }).AddArgument($PSScriptRoot).AddArgument($script:SwsdHome).AddArgument($script:SwsdCredentialTarget).AddArgument($mockBody).AddArgument($mockFails).AddArgument($mockCalls).AddArgument($Operation).AddArgument($operationFunction).AddArgument($mockResult)
        $handle = $powershell.BeginInvoke()
        # Script scope keeps the worker alive after the Click callback returns.
        $script:SwsdInstallWorker = @{ PowerShell = $powershell; Runspace = $runspace; Handle = $handle; Operation = $Operation }
        $script:SwsdInstallTimer.Start()
    } catch {
        if ($null -ne $powershell) { $powershell.Dispose() }
        if ($null -ne $runspace) { $runspace.Dispose() }
        $script:SwsdInstallWorker = $null
        Set-SwsdBusy $false
        if ($Operation -eq 'CheckUpdates') { Show-SwsdUpdateUnavailable }
        else { Show-SwsdError $_.Exception }
        Update-SwsdDashboard
    }
    if ($form.Visible) { Update-SwsdFormSize }
}
function Complete-SwsdInstall {
    $worker = $script:SwsdInstallWorker
    if ($null -eq $worker -or -not $worker.Handle.IsCompleted) { return }
    $script:SwsdInstallTimer.Stop()
    try {
        $result = @($worker.PowerShell.EndInvoke($worker.Handle))
        if ($worker.PowerShell.HadErrors) { throw $worker.PowerShell.Streams.Error[0].Exception }
        switch ($worker.Operation) {
            'CheckUpdates' {
                $script:SwsdLatestVersion = if ($result.Count -gt 0) { [string]$result[-1] } else { $null }
                if (-not $script:SwsdLatestVersion) {
                    Show-SwsdUpdateUnavailable
                } else {
                    $script:SwsdUpdateState = 'checked'
                    $installedVersion = Get-SwsdInstalledVersion
                    switch (Compare-SwsdVersion -Installed $installedVersion -Latest $script:SwsdLatestVersion) {
                        'current' { Set-SwsdStatus -Kind success -Text "swsd-mcp $installedVersion is up to date." }
                        'update' { Set-SwsdStatus -Kind warn -Text "swsd-mcp $($script:SwsdLatestVersion) is available (installed: $installedVersion). Ask IT to sync the reviewed plugin, then select Install / repair tools." }
                        'newer' { Set-SwsdStatus -Kind info -Text "Installed swsd-mcp $installedVersion is newer than the published version $($script:SwsdLatestVersion)." }
                        default { Set-SwsdStatus -Kind info -Text "Latest published swsd-mcp: $($script:SwsdLatestVersion). Install / repair tools to set up the reviewed version." }
                    }
                }
            }
            'Node' { Set-SwsdStatus -Kind success -Text 'Node.js installed. Reopen this window to continue setup.' }
            default {
                Set-SwsdStatus -Kind success -Text 'Tools installed. Test and save your token next. This window is also available from the Windows Start menu.'
                $ctaChip.Visible = $true
            }
        }
    } catch {
        if ($worker.Operation -eq 'CheckUpdates') { Show-SwsdUpdateUnavailable }
        else { Show-SwsdError $_.Exception }
    } finally {
        $worker.PowerShell.Dispose()
        $worker.Runspace.Dispose()
        $script:SwsdInstallWorker = $null
        Set-SwsdBusy $false
        Update-SwsdDashboard
        if ($form.Visible) { Update-SwsdFormSize }
    }
}
$script:SwsdInstallTimer.Add_Tick({ param($sender, $e) Invoke-SwsdSafe -Source 'InstallTick' {
    $script:SwsdInstallPollCount++
    $progressBar.Advance()
    Complete-SwsdInstall
} })
$form.Add_FormClosing({ param($sender, $e) Invoke-SwsdSafe -Source 'FormClosing' {
    # npm has its own bounded timeout. Keep ownership until it exits, avoiding an orphaned repair.
    if ($null -ne $script:SwsdInstallWorker) {
        $e.Cancel = $true
        Set-SwsdStatus -Kind info -Text 'The background action is still running. Please wait for it to finish before closing this window.'
    }
} })
$form.Add_FormClosed({ param($sender, $e) Invoke-SwsdSafe -Source 'FormClosed' { $script:SwsdInstallTimer.Dispose() } })
$install.Add_Click({ param($sender, $e) Invoke-SwsdSafe -Source 'InstallClick' { Start-SwsdInstall } })
$checkUpdates.Add_Click({ param($sender, $e) Invoke-SwsdSafe -Source 'UpdateClick' { Start-SwsdInstall -Operation CheckUpdates } })
$nodeInstallButton.Add_Click({ param($sender, $e) Invoke-SwsdSafe -Source 'NodeInstallClick' {
    if ($null -ne $script:SwsdInstallWorker) { return }
    if ((Get-SwsdStatus).nodeSupported) {
        Set-SwsdStatus -Kind info -Text 'A supported Node.js 24 version is already installed.'
        return
    }
    if ((Confirm-SwsdNodeInstall) -ne 'Yes') {
        Set-SwsdStatus -Kind info -Text 'Node.js installation cancelled.'
        return
    }
    Start-SwsdInstall -Operation Node
} })
$save.Add_Click({ param($sender, $e) Invoke-SwsdSafe -Source 'Click' { Invoke-SetupAction {
    $secret = $tokenBox.Text.Trim()
    $tokenBox.Clear()
    try {
        if ([string]::IsNullOrWhiteSpace($secret)) { throw 'Paste your personal SWSD token into the masked field first.' }
        $baseUrl = @('https://api.samanage.com','https://apieu.samanage.com')[$region.SelectedIndex]
        Test-SwsdToken -Token $secret -BaseUrl $baseUrl
        $oldSettings = Get-SwsdSettings
        Save-SwsdSettings -BaseUrl $baseUrl -Profile $oldSettings.profile
        try {
        [SwsdDesktop.Credentials]::Save($script:SwsdCredentialTarget, $secret)
        } catch {
            Save-SwsdSettings -BaseUrl $oldSettings.baseUrl -Profile $oldSettings.profile
            throw
        }
        Set-SwsdStatus -Kind success -Text 'Connection verified and token saved. Start a new chat. If an old connection remains, fully quit and reopen the desktop app.'
        $ctaChip.Visible = $true
    } finally { $secret = $null }
}  }})
$test.Add_Click({ param($sender, $e) Invoke-SwsdSafe -Source 'Click' { Invoke-SetupAction {
    $secret = [SwsdDesktop.Credentials]::Read($script:SwsdCredentialTarget)
    try {
        if ([string]::IsNullOrWhiteSpace($secret)) { throw 'No token is saved. Paste one into the masked field, then select Test and save token.' }
        Test-SwsdToken -Token $secret -BaseUrl (Get-SwsdSettings).baseUrl
        Set-SwsdStatus -Kind success -Text 'Saved connection verified. SolarWinds accepted the token and allowed the read-only check.'
    } finally { $secret = $null }
}  }})
$remove.Add_Click({ param($sender, $e) Invoke-SwsdSafe -Source 'Click' {
    $choice = Confirm-SwsdRemove
    if ($choice -eq 'Yes') { Invoke-SetupAction {
        [SwsdDesktop.Credentials]::Remove($script:SwsdCredentialTarget)
        $tokenBox.Clear()
        Set-SwsdStatus -Kind info -Text 'Saved token removed. Fully quit ChatGPT to stop running connections. Revoke the token in SolarWinds if needed.'
    } }
    Update-SwsdDashboard
 }})
$saveProfile.Add_Click({ param($sender, $e) Invoke-SwsdSafe -Source 'Click' { Invoke-SetupAction {
    $selection = $script:SwsdProfiles[$profile.SelectedIndex]
    Save-SwsdProfile -Profile $selection.id
    $currentProfile.Text = 'Saved profile: ' + $selection.name
    Set-SwsdStatus -Kind success -Text 'Profile saved. Fully quit and reopen the desktop app, then start a new chat to load this tool set. Your saved token is unchanged.'
}  }})
Update-SwsdDashboard

if ($ValidateWindow) {
    # Visible lifecycle probe: no token entry, installation, settings or credential actions.
    if ($env:SWSD_PREVIEW_ENABLED -ne '1') { foreach ($control in @($install,$checkUpdates,$nodeInstallButton,$region,$tokenBox,$save,$test,$remove,$profile,$saveProfile,$copyDiagnostics)) { $control.Enabled = $false } }
    $script:SwsdWindowResult = $null
    $script:SwsdWindowResults = New-Object 'System.Collections.Generic.List[object]'
    $script:SwsdDpiSteps = New-Object 'System.Collections.Generic.Queue[object]'
    $script:SwsdDpiStep = 'initial'
    if ($ValidateDpiChanges) {
        # Exercise the actual message path as well as moves to existing monitors.
        # Neither operation changes display configuration or uses user data.
        Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class SwsdDpiProbe {
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll", EntryPoint="SendMessageW")]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr dpi, ref RECT rectangle);
    public static void Send(IntPtr window, int dpi, Rectangle bounds) {
        RECT r = new RECT { Left = bounds.Left, Top = bounds.Top, Right = bounds.Right, Bottom = bounds.Bottom };
        SendMessage(window, 0x02E0, new IntPtr(dpi | (dpi << 16)), ref r);
    }
}
'@
        foreach ($screen in [Windows.Forms.Screen]::AllScreens) { $script:SwsdDpiSteps.Enqueue(@{ Screen = $screen; Name = ('monitor ' + $screen.DeviceName) }) }
        $script:SwsdDpiSteps.Enqueue(@{ Screen = [Windows.Forms.Screen]::PrimaryScreen; Name = 'primary return' })
        foreach ($dpi in @(96,120,144,168,192,168,144,120,96)) { $script:SwsdDpiSteps.Enqueue(@{ Dpi = $dpi; Name = "WM_DPICHANGED $dpi" }) }
    }
    $probe = New-Object Windows.Forms.Timer
    $probe.Interval = 200
    $probe.Add_Tick({ param($sender, $e) Invoke-SwsdSafe -Source 'Tick' {
        $probe.Stop()
        try {
        $script:SwsdLayoutFailures = @()
        $script:SwsdLayoutNotes = @()
        if ($script:SwsdHandlerErrors.Count -gt 0) { $script:SwsdLayoutFailures += $script:SwsdHandlerErrors }
        if ([SwsdDpiBootstrap]::WindowAwareness($form.Handle) -ne 'PerMonitorV2' -and $script:SwsdDpiAwarenessPath -like '*PerMonitorV2*') { $script:SwsdLayoutFailures += 'Window did not inherit PerMonitorV2 awareness.' }
        if ($script:SwsdDeviceDpi -ne $form.DeviceDpi) { $script:SwsdLayoutFailures += 'Layout DPI differs from window DPI.' }
        if ($region.ItemHeight -lt [Windows.Forms.TextRenderer]::MeasureText('Ag', $region.Font).Height + (ScalePx 4)) { $script:SwsdLayoutFailures += 'Region dropdown text is clipped.' }
        if ($profile.ItemHeight -lt [Windows.Forms.TextRenderer]::MeasureText('Ag', $profile.Font).Height + (ScalePx 4)) { $script:SwsdLayoutFailures += 'Profile dropdown text is clipped.' }

        # Button rows must be pixel-identical: same Top and Height for every button (tolerance 0),
        # and equal widths inside a row of action buttons.
        foreach ($row in @($installButtonRow, $buttonRow2, $profileButtonRow, $statusButtonRow)) {
            $rowButtons = @($row.Controls | Where-Object { $_ -is [Windows.Forms.Button] -and $_.Visible })
            if ($rowButtons.Count -lt 1) { continue }
            $tops = @($rowButtons | ForEach-Object { $_.Top } | Sort-Object -Unique)
            $heights = @($rowButtons | ForEach-Object { $_.Height } | Sort-Object -Unique)
            $widths = @($rowButtons | ForEach-Object { $_.Width } | Sort-Object -Unique)
            if ($tops.Count -ne 1) { $script:SwsdLayoutFailures += "Button row tops differ: $($tops -join ',')" }
            if ($heights.Count -ne 1) { $script:SwsdLayoutFailures += "Button row heights differ: $($heights -join ',')" }
            if ($widths.Count -ne 1) { $script:SwsdLayoutFailures += "Button row widths differ: $($widths -join ',')" }
        }
        $allHeights = @(@($install, $checkUpdates, $nodeInstallButton, $save, $test, $remove, $saveProfile, $showDetails, $copyDiagnostics) | ForEach-Object { $_.Height } | Sort-Object -Unique)
        if ($allHeights.Count -ne 1) { $script:SwsdLayoutFailures += "Button heights differ across cards: $($allHeights -join ',')" }

        $formClientScreen = $form.RectangleToScreen($form.ClientRectangle)
        $workingArea = [Windows.Forms.Screen]::FromControl($form).WorkingArea

        # Dashboard geometry is exact at every scale (zero pixel tolerance).
        $chipWidths = @($statusRows | ForEach-Object { $_.Chip.Width } | Sort-Object -Unique)
        $chipHeights = @($statusRows | ForEach-Object { $_.Chip.Height } | Sort-Object -Unique)
        $itemHeights = @($statusRows | ForEach-Object { $_.Panel.Height } | Sort-Object -Unique)
        if ($chipWidths.Count -ne 1) { $script:SwsdLayoutFailures += "Dashboard chip widths differ: $($chipWidths -join ',')" }
        if ($chipHeights.Count -ne 1) { $script:SwsdLayoutFailures += "Dashboard chip heights differ: $($chipHeights -join ',')" }
        if ($itemHeights.Count -ne 1) { $script:SwsdLayoutFailures += "Dashboard item heights differ: $($itemHeights -join ',')" }
        $columnWidths = @($statusRowTable.GetColumnWidths() | Sort-Object -Unique)
        $rowHeights = @($statusRowTable.GetRowHeights() | Sort-Object -Unique)
        if ($columnWidths.Count -ne 1) { $script:SwsdLayoutFailures += 'Dashboard grid columns differ in width.' }
        if ($rowHeights.Count -ne 1) { $script:SwsdLayoutFailures += 'Dashboard grid rows differ in height.' }
        for ($ci = 0; $ci -lt $statusRowTable.ColumnCount; $ci++) {
            $items = @($statusRows | Where-Object { $statusRowTable.GetColumn($_.Panel) -eq $ci })
            foreach ($field in @('Icon', 'Label', 'Value', 'Chip')) {
                # Compare in a shared coordinate space, not relative to separate item panels.
                $lefts = @($items | ForEach-Object { $_[$field].RectangleToScreen($_[$field].ClientRectangle).Left } | Sort-Object -Unique)
                if ($lefts.Count -ne 1) { $script:SwsdLayoutFailures += "Dashboard column $ci $field lefts differ: $($lefts -join ',')" }
            }
        }
        for ($ri = 0; $ri -lt $statusRowTable.RowCount; $ri++) {
            $items = @($statusRows | Where-Object { $statusRowTable.GetRow($_.Panel) -eq $ri })
            foreach ($field in @('Panel', 'Icon', 'Label', 'Value', 'Chip')) {
                $tops = @($items | ForEach-Object { $_[$field].RectangleToScreen($_[$field].ClientRectangle).Top } | Sort-Object -Unique)
                if ($tops.Count -ne 1) { $script:SwsdLayoutFailures += "Dashboard row $ri $field tops differ: $($tops -join ',')" }
            }
        }
        if (-not $statusRowTable.Parent.ClientRectangle.Contains($statusRowTable.Bounds)) {
            $script:SwsdLayoutFailures += 'Dashboard grid exceeds its card client rectangle.'
        }
        foreach ($item in $statusRows) {
            # Check the fixed cell even when the form legitimately needs scrolling.
            $column = $statusRowTable.GetColumn($item.Panel)
            $row = $statusRowTable.GetRow($item.Panel)
            $cell = New-Object Drawing.Rectangle(($column * $dashboardColumnWidth), ($row * $dashboardRowHeight), $dashboardColumnWidth, $dashboardRowHeight)
            if (-not $cell.Contains($item.Panel.Bounds) -or -not $statusRowTable.ClientRectangle.Contains($item.Panel.Bounds)) {
                $script:SwsdLayoutFailures += "$($item.Panel.AccessibleName) exceeds its dashboard cell."
            }
            $chipLineHeight = [Windows.Forms.TextRenderer]::MeasureText('Ag', $item.Chip.Font).Height
            if ($item.Chip.Height -ne ($chipLineHeight + (2 * (ScalePx 4)))) {
                $script:SwsdLayoutFailures += "$($item.Panel.AccessibleName) chip height must be one text line plus 4px padding per side."
            }
            if ($item.Chip.Right -ne $item.Panel.ClientSize.Width) { $script:SwsdLayoutFailures += "$($item.Panel.AccessibleName) chip is not at the cell's right edge." }
            if ($item.Chip.TextAlign -ne [Drawing.ContentAlignment]::MiddleCenter) { $script:SwsdLayoutFailures += "$($item.Panel.AccessibleName) chip text is not centered." }
            foreach ($text in $dashboardChipTexts) {
                $textSize = [Windows.Forms.TextRenderer]::MeasureText($text, $item.Chip.Font)
                if ($textSize.Width + $item.Chip.Padding.Horizontal -gt $item.Chip.Width -or
                    $textSize.Height + $item.Chip.Padding.Vertical -gt $item.Chip.Height) {
                    $script:SwsdLayoutFailures += "$($item.Panel.AccessibleName) chip cannot fit '$text'."
                }
            }
        }
        if ($script:SwsdUiScale * $script:SwsdDeviceDpi / 96 -eq 1) {
            if ($form.Height -gt 1032) { $script:SwsdLayoutFailures += "Scale 1 form height ($($form.Height)) exceeds 1032px." }
            # A clamped window must not conceal excess content behind scrolling at 1080p.
            if ($workingArea.Height -ge 1032 -and ($rootPanel.AutoScroll -or $rootPanel.VerticalScroll.Visible -or $rootPanel.HorizontalScroll.Visible)) {
                $script:SwsdLayoutFailures += 'Scale 1 requires scrolling on a 1080p working area.'
            }
        }

        # Determine if scrolling is acceptable (working area too small for content)
        $scaledContentWidth = ScalePx $script:SwsdContentWidth
        $constraintSize = New-Object Drawing.Size($scaledContentWidth, 0)
        $preferred = $rootPanel.GetPreferredSize($constraintSize)
        $script:SwsdScrollAcceptable = ($rootPanel.AutoScroll -and $preferred.Height -gt $workingArea.Height)

        function Test-ControlBounds([Windows.Forms.Control]$Ctrl, [string]$Path) {
            if (-not $Ctrl.Visible) { return }
            $bounds = $Ctrl.RectangleToScreen($Ctrl.ClientRectangle)
            if ($bounds.Width -le 0 -or $bounds.Height -le 0) { return }

            if (-not $script:SwsdScrollAcceptable) {
                if (-not $formClientScreen.Contains($bounds)) {
                    $script:SwsdLayoutFailures += "$Path outside form client rect"
                }
                $parent = $Ctrl.Parent
                if ($parent -ne $null) {
                    $parentScreen = $parent.RectangleToScreen($parent.ClientRectangle)
                    if (-not $parentScreen.Contains($bounds)) {
                        $script:SwsdLayoutFailures += "$Path outside parent client rect"
                    }
                }
            }

            if ($Ctrl -is [Windows.Forms.Button]) {
                if (-not $Ctrl.AutoEllipsis) {
                    $pref = $Ctrl.GetPreferredSize([Drawing.Size]::Empty)
                    if ($pref.Width -gt $Ctrl.Width) {
                        $script:SwsdLayoutFailures += "$Path text truncated (PreferredWidth=$($pref.Width) > Width=$($Ctrl.Width))"
                    }
                }
            } elseif ($Ctrl -is [Windows.Forms.Label]) {
                if (-not $Ctrl.AutoEllipsis) {
                    # For wrapping labels (MaximumSize.Width > 0), check that actual width matches MaximumSize
                    # For non-wrapping labels, check PreferredSize fits
                    if ($Ctrl.MaximumSize.Width -gt 0 -and $Ctrl.AutoSize) {
                        # Wrapping label: ensure container isn't narrower than MaximumSize
                        if ($Ctrl.Width -lt $Ctrl.MaximumSize.Width -and $Ctrl.Width -lt 50) {
                            $script:SwsdLayoutFailures += "$Path wrapping label too narrow (Width=$($Ctrl.Width) < MaxWidth=$($Ctrl.MaximumSize.Width))"
                        }
                    } else {
                        $pref = $Ctrl.GetPreferredSize([Drawing.Size]::Empty)
                        if ($pref.Width -gt $Ctrl.Width) {
                            $script:SwsdLayoutFailures += "$Path text truncated (PreferredWidth=$($pref.Width) > Width=$($Ctrl.Width))"
                        }
                    }
                }
            }
        }

        function Enumerate-Controls([Windows.Forms.Control]$Parent, [string]$Prefix) {
            foreach ($child in $Parent.Controls) {
                $name = if ($child.AccessibleName) { $child.AccessibleName } elseif ($child.Name) { $child.Name } else { $child.GetType().Name }
                $path = if ($Prefix) { "$Prefix/$name" } else { $name }
                Test-ControlBounds $child $path
                if ($child.HasChildren) { Enumerate-Controls $child $path }
            }
        }

        Enumerate-Controls $form ''

        # Check sibling overlaps within each container
        function Test-SiblingOverlaps([Windows.Forms.Control]$Parent, [string]$Prefix) {
            $visibleChildren = @()
            foreach ($child in $Parent.Controls) {
                if ($child.Visible -and $child.Width -gt 0 -and $child.Height -gt 0) {
                    $visibleChildren += $child
                }
            }
            for ($i = 0; $i -lt $visibleChildren.Count; $i++) {
                for ($j = $i + 1; $j -lt $visibleChildren.Count; $j++) {
                    $a = $visibleChildren[$i].RectangleToScreen($visibleChildren[$i].ClientRectangle)
                    $b = $visibleChildren[$j].RectangleToScreen($visibleChildren[$j].ClientRectangle)
                    if ($a.IntersectsWith($b)) {
                        $nameA = if ($visibleChildren[$i].AccessibleName) { $visibleChildren[$i].AccessibleName } else { $visibleChildren[$i].GetType().Name }
                        $nameB = if ($visibleChildren[$j].AccessibleName) { $visibleChildren[$j].AccessibleName } else { $visibleChildren[$j].GetType().Name }
                        $script:SwsdLayoutFailures += "${Prefix}: ${nameA} overlaps ${nameB}"
                    }
                }
            }
            foreach ($child in $Parent.Controls) {
                if ($child.HasChildren) {
                    $name = if ($child.AccessibleName) { $child.AccessibleName } elseif ($child.Name) { $child.Name } else { $child.GetType().Name }
                    $path = if ($Prefix) { "$Prefix/$name" } else { $name }
                    Test-SiblingOverlaps $child $path
                }
            }
        }

        Test-SiblingOverlaps $form ''

        # Vertical scroll check
        if ($rootPanel.VerticalScroll.Visible) {
            $scaledContentWidth = ScalePx $script:SwsdContentWidth
            $constraintSize = New-Object Drawing.Size($scaledContentWidth, 0)
            $preferred = $rootPanel.GetPreferredSize($constraintSize)
            if ($preferred.Height -le $workingArea.Height) {
                $script:SwsdLayoutFailures += "Root panel shows vertical scroll but preferred height ($($preferred.Height)) fits working area ($($workingArea.Height))"
            } else {
                $script:SwsdLayoutNotes += "Vertical scroll shown because preferred height ($($preferred.Height)) exceeds working area ($($workingArea.Height))"
            }
        }

        # The frame must fit too; unused screen margins must not force scrolling.
        $preferredClient = $rootPanel.GetPreferredSize((New-Object Drawing.Size($rootPanel.ClientSize.Width, 0)))
        $requiredFormHeight = [Math]::Min(($preferredClient.Height + $form.Height - $form.ClientSize.Height), $workingArea.Height)
        if ($form.Height -lt $requiredFormHeight) {
            $script:SwsdLayoutFailures += "Form height ($($form.Height)) is below the content-plus-frame height ($requiredFormHeight)."
        }

        # Window fits working area check
        $formScreen = $form.RectangleToScreen($form.ClientRectangle)
        if (-not $workingArea.Contains($formScreen)) {
            $script:SwsdLayoutFailures += "Window extends outside working area"
        }

        $script:SwsdWindowResult = @{
            dpiStep = $script:SwsdDpiStep
            dpiAwarenessPath = $script:SwsdDpiAwarenessPath
            windowDpiAwareness = [SwsdDpiBootstrap]::WindowAwareness($form.Handle)
            deviceDpi = $form.DeviceDpi
            dashboardWidth = $statusRowTable.Width
            dashboardMinimumWidth = $statusRowTable.MinimumSize.Width
            dashboardColumnWidth = $dashboardColumnWidth
            dashboardColumnWidths = @($statusRowTable.GetColumnWidths())
            dashboardParentWidth = $statusRowTable.Parent.ClientSize.Width
            dashboardColumns = $statusRowTable.ColumnCount
            visible = $form.Visible
            foreground = ([SwsdDesktop.Windows]::GetForegroundWindow() -eq $form.Handle)
            foregroundAvailable = ([SwsdDesktop.Windows]::GetForegroundWindow() -ne [IntPtr]::Zero)
            behindForeground = [SwsdDesktop.Windows]::IsBehindForeground($form.Handle)
            alwaysOnTop = $form.TopMost
            presentationCount = $script:SwsdPresentationCount
            consoleVisible = [SwsdDesktop.Windows]::IsWindowVisible([SwsdDesktop.Windows]::GetConsoleWindow())
            tokenEntryEnabled = $tokenBox.Enabled
            workingAreaWidth = $workingArea.Width
            workingAreaHeight = $workingArea.Height
            formWidth = $form.Width
            clientWidth = $form.ClientSize.Width
            preferredClientHeight = $rootPanel.GetPreferredSize((New-Object Drawing.Size($rootPanel.ClientSize.Width, 0))).Height
            frameHeight = $form.Height - $form.ClientSize.Height
            formHeight = $form.Height
            clientHeight = $form.ClientSize.Height
            dashboardChipWidth = $srNode.Chip.Width
            dashboardChipHeight = $srNode.Chip.Height
            layoutFailures = $script:SwsdLayoutFailures
            layoutNotes = $script:SwsdLayoutNotes
        }
        } catch {
            $script:SwsdWindowResult = @{ error = $_.Exception.Message }
        }
        $script:SwsdWindowResults.Add($script:SwsdWindowResult)
        if ($script:SwsdDpiSteps.Count -gt 0) {
            $step = $script:SwsdDpiSteps.Dequeue()
            $script:SwsdDpiStep = $step.Name
            if ($step.ContainsKey('Screen')) {
                $area = $step.Screen.WorkingArea
                $form.MinimumSize = [Drawing.Size]::Empty
                $form.Bounds = New-Object Drawing.Rectangle(($area.Left + 16), ($area.Top + 16), ([Math]::Min($form.Width, $area.Width - 32)), ([Math]::Min($form.Height, $area.Height - 32)))
                Update-SwsdDpiLayout $form.DeviceDpi
                Update-SwsdFormSize
            } else {
                $ratio = $step.Dpi / [double]$form.DeviceDpi
                $suggested = New-Object Drawing.Rectangle($form.Left, $form.Top, ([int][Math]::Round($form.Width * $ratio)), ([int][Math]::Round($form.Height * $ratio)))
                [SwsdDpiProbe]::Send($form.Handle, $step.Dpi, $suggested)
            }
            $probe.Start()
        } else { $close.Stop(); $close.Interval = $WindowTestSeconds * 1000; $close.Start() }
     }})
    $close = New-Object Windows.Forms.Timer
    $close.Interval = 30000 # Watchdog: a failed transition must not leave a test window open.
    $close.Add_Tick({ param($sender, $e) Invoke-SwsdSafe -Source 'Tick' { $close.Stop(); $form.Close()  }})
    $form.Add_Shown({ param($sender, $e) Invoke-SwsdSafe -Source 'Shown' { $probe.Start(); $close.Start() }})
    try {
        [void]$form.ShowDialog()
        $script:SwsdWindowResults.ToArray() | ConvertTo-Json -Depth 5
        if ($script:SwsdDpiSteps.Count -gt 0 -or $script:SwsdWindowResults.Count -eq 0) { throw 'Window validation did not complete before its watchdog elapsed.' }
        foreach ($result in $script:SwsdWindowResults) {
        $script:SwsdWindowResult = $result
        if ($result.ContainsKey('error')) { throw ('Window probe failed: ' + $result.error) }
        if (-not $script:SwsdWindowResult -or -not $script:SwsdWindowResult.visible -or
            -not $script:SwsdWindowResult.foregroundAvailable -or $script:SwsdWindowResult.behindForeground -or
            $script:SwsdWindowResult.alwaysOnTop -or
            $script:SwsdPresentationCount -ne 1 -or $script:SwsdWindowResult.consoleVisible -or
            ($script:SwsdWindowResult.tokenEntryEnabled -and $env:SWSD_PREVIEW_ENABLED -ne '1')) { throw 'Setup window presentation check failed.' }
        if ($script:SwsdWindowResult.layoutFailures -and $script:SwsdWindowResult.layoutFailures.Count -gt 0) {
            $failureList = ($script:SwsdWindowResult.layoutFailures -join '; ')
            throw "Layout validation failed: $failureList"
        }
        }
    } finally {
        $probe.Dispose(); $close.Dispose()
        $tokenBox.Clear(); $form.Dispose()
    }
    exit 0
} elseif ($ValidateHandlers) {
    Set-StrictMode -Version Latest
    $script:SwsdMockCalls = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
    $script:SwsdMockInstallFails = $false
    $script:SwsdMockNodeFails = $false
    $script:SwsdMockLatestVersion = $script:SwsdPackageVersion
    $script:SwsdMockNodeSupported = $false
    $script:SwsdMockNodeConfirm = 'Yes'
    $script:SwsdRealGetStatus = (Get-Item Function:Get-SwsdStatus).ScriptBlock
    function script:Get-SwsdStatus {
        $s = & $script:SwsdRealGetStatus
        $s.nodeSupported = $script:SwsdMockNodeSupported
        return $s
    }
    function script:Get-SwsdLatestVersion {
        $script:SwsdMockCalls.Enqueue('update-check')
        Start-Sleep -Milliseconds 350
        if ($script:SwsdMockInstallFails) { throw 'synthetic update worker failure' }
        return $script:SwsdMockLatestVersion
    }
    function script:Install-SwsdNode {
        $script:SwsdMockCalls.Enqueue('node-install')
        Start-Sleep -Milliseconds 350
        if ($script:SwsdMockInstallFails) { throw 'Node.js installation failed.' }
    }
    function script:Confirm-SwsdNodeInstall {
        $script:SwsdMockCalls.Enqueue('node-confirm')
        return $script:SwsdMockNodeConfirm
    }
    function script:Install-SwsdTools {
        param($SourceRoot, [switch]$Force)
        if (-not $Force) { throw 'UI repair must force installation.' }
        $script:SwsdMockCalls.Enqueue('install')
        Start-Sleep -Milliseconds 350
        if ($script:SwsdMockInstallFails) { throw 'mock install failure' }
        # Synthetic install payload, confined to the UI test home; no npm or real shortcuts.
        $entry = Get-SwsdEntryPoint
        New-Item -ItemType Directory -Path (Split-Path $entry) -Force | Out-Null
        Set-Content -LiteralPath $entry -Value '// synthetic UI test entry point'
        @{ version = $script:SwsdPackageVersion } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path (Split-Path $entry)) 'package.json')
    }
    function script:Test-SwsdToken { param($Token, $BaseUrl) $script:SwsdMockCalls.Enqueue('test') }
    function script:Confirm-SwsdRemove { return 'Yes' }
    $script:SwsdClipboardText = $null
    function script:Set-SwsdClipboard {
        param([string]$Text)
        $script:SwsdMockCalls.Enqueue('clipboard')
        $script:SwsdClipboardText = $Text
    }
    $onClick = [Windows.Forms.Button].GetMethod('OnClick', [Reflection.BindingFlags]'Instance,NonPublic')
    $buttons = @($install, $checkUpdates, $nodeInstallButton, $save, $test, $remove, $saveProfile, $showDetails, $copyDiagnostics)
    function Assert-SwsdClick([Windows.Forms.Button]$Button, [string]$Expect) {
        $script:SwsdHandlerErrors = @()
        $Button.Enabled = $true
        $onClick.Invoke($Button, @([EventArgs]::Empty))
        if ($Button -eq $install -or $Button -eq $checkUpdates -or ($Button -eq $nodeInstallButton -and $script:SwsdMockNodeConfirm -eq 'Yes' -and -not $script:SwsdMockNodeSupported)) {
            if ($null -eq $script:SwsdInstallWorker) { throw 'Install click did not start a background worker.' }
            if ($Button -eq $checkUpdates -and $srUpdate.Chip.Text -ne 'Checking') { throw 'Update check did not show progress in the dashboard.' }
            foreach ($b in $buttons) { if ($b.Enabled) { throw 'Action button remained enabled during installation.' } }
            if (-not $script:SwsdInstallTimer.Enabled) { throw 'Install polling timer did not start.' }
            $firstWorker = $script:SwsdInstallWorker
            $onClick.Invoke($Button, @([EventArgs]::Empty))
            if ($script:SwsdInstallWorker -ne $firstWorker) { throw 'A second install started while one was running.' }
            $closing = New-Object Windows.Forms.FormClosingEventArgs([Windows.Forms.CloseReason]::UserClosing, $false)
            $form.GetType().GetMethod('OnFormClosing', [Reflection.BindingFlags]'Instance,NonPublic').Invoke($form, @($closing.PSObject.BaseObject))
            if (-not $closing.Cancel) { throw 'Closing the form would abandon the active install.' }
            $deadline = [DateTime]::UtcNow.AddSeconds(15)
            while ($null -ne $script:SwsdInstallWorker -and [DateTime]::UtcNow -lt $deadline) {
                # Pump the same WinForms timer used by the visible app; no synchronous shortcut.
                [Windows.Forms.Application]::DoEvents()
                Start-Sleep -Milliseconds 20
            }
            if ($null -ne $script:SwsdInstallWorker) { throw 'Background install did not finish within the validation timeout.' }
            if ($script:SwsdInstallTimer.Enabled) { throw 'Install polling timer stayed active after completion.' }
            if ($script:SwsdInstallPollCount -lt 2) { throw 'UI timer did not remain responsive during installation.' }
        }
        if ($script:SwsdHandlerErrors.Count) { throw "Unhandled exception in '$($Button.Text)': $($script:SwsdHandlerErrors -join '; ')" }
        if ($status.Text -notlike "*$Expect*") { throw "'$($Button.Text)' status was '$($status.Text)', expected '*$Expect*'." }
        foreach ($b in $buttons) { if (-not $b.Enabled) { throw "'$($b.Text)' stayed disabled after '$($Button.Text)'." } }
        if ($form.UseWaitCursor) { throw "Wait cursor stuck after '$($Button.Text)'." }
    }
    try {
        Assert-SwsdClick $checkUpdates 'Latest published swsd-mcp'
        if ($srUpdate.Chip.Text -ne 'Install first') { throw 'Fresh install update result was incorrect.' }
        Assert-SwsdClick $install 'Tools installed'
        if ($srTools.Chip.Text -ne 'OK' -or $srTools.Value.Text -ne ('swsd-mcp ' + $script:SwsdPackageVersion)) { throw 'Dashboard did not refresh the installed version.' }
        if ($srUpdate.Chip.Text -ne 'Current') { throw 'Update result did not refresh after installation.' }
        Assert-SwsdClick $checkUpdates 'is up to date'
        if ($srUpdate.Chip.Text -ne 'Current') { throw 'Current update result missing from dashboard.' }
        $script:SwsdMockLatestVersion = '99.0.0'
        Assert-SwsdClick $checkUpdates 'is available'
        if ($srUpdate.Chip.Text -ne 'Available' -or $srUpdate.Value.Text -ne 'v99.0.0') { throw 'Available update result missing from dashboard.' }
        $script:SwsdMockLatestVersion = '0.0.1'
        Assert-SwsdClick $checkUpdates 'is newer than'
        if ($srUpdate.Chip.Text -ne 'Ahead') { throw 'Newer installed version missing from dashboard.' }
        $script:SwsdMockLatestVersion = $null
        Assert-SwsdClick $checkUpdates 'Could not check for updates'
        if ($srUpdate.Chip.Text -ne 'Offline' -or $script:SwsdLatestVersion) { throw 'Offline check retained a stale successful result.' }
        $script:SwsdMockInstallFails = $true
        Assert-SwsdClick $checkUpdates 'Could not check for updates'
        if ($srUpdate.Chip.Text -ne 'Offline') { throw 'Worker failure left the update dashboard checking.' }
        $script:SwsdMockInstallFails = $false
        $script:SwsdMockLatestVersion = $script:SwsdPackageVersion
        Assert-SwsdClick $checkUpdates 'is up to date'
        $nodeCallsBefore = @($script:SwsdMockCalls.ToArray() | Where-Object { $_ -eq 'node-install' }).Count
        $script:SwsdMockNodeConfirm = 'No'
        Assert-SwsdClick $nodeInstallButton 'cancelled'
        if (@($script:SwsdMockCalls.ToArray() | Where-Object { $_ -eq 'node-install' }).Count -ne $nodeCallsBefore) { throw 'Cancelled Node installation still ran.' }
        $script:SwsdMockNodeConfirm = 'Yes'
        Assert-SwsdClick $nodeInstallButton 'Node.js installed'
        $script:SwsdMockNodeFails = $true
        Assert-SwsdClick $nodeInstallButton 'Node.js installation failed'
        $script:SwsdMockNodeFails = $false
        Assert-SwsdClick $nodeInstallButton 'Node.js installed'
        $script:SwsdMockNodeSupported = $true
        $nodeCallsBefore = $script:SwsdMockCalls.Count
        Assert-SwsdClick $nodeInstallButton 'already installed'
        if ($script:SwsdMockCalls.Count -ne $nodeCallsBefore) { throw 'Supported Node should not prompt or install.' }
        $diagnosticToken = ('synthetic' + [guid]::NewGuid().ToString('N'))
        $tokenBox.Text = $diagnosticToken
        Assert-SwsdClick $save 'token saved'
        if ($tokenBox.Text) { throw 'Token field was not cleared after save.' }
        if ($srToken.Value.Text -ne 'Yes') { throw 'Dashboard did not show saved token presence.' }
        # Use the real report builder and an isolated log, but never the real clipboard.
        @('safe log line', ('Authorization: Bearer ' + $diagnosticToken), $diagnosticToken,
            ('fragment ' + $diagnosticToken.Substring(7, 8))) | Set-Content -LiteralPath $script:SwsdDiagnosticsLogPath -Encoding UTF8
        $readsBefore = [SwsdDesktop.Credentials]::ReadCount
        Assert-SwsdClick $copyDiagnostics 'Diagnostics copied'
        if ([SwsdDesktop.Credentials]::ReadCount -ne $readsBefore) { throw 'Diagnostics read the credential secret.' }
        if (-not $script:SwsdClipboardText -or $script:SwsdClipboardText -notmatch 'Credential PRESENT: yes') { throw 'Clipboard report must show credential presence.' }
        foreach ($section in @('[Application]', '[Windows]', '[PowerShell]', '[Node.js]', '[Tools]', '[Connection]', '[Display]', '[Recent log (last 20 lines; redacted)]')) {
            if (-not $script:SwsdClipboardText.Contains($section)) { throw 'Clipboard report is missing a required section.' }
        }
        for ($i = 0; $i -le $diagnosticToken.Length - 8; $i++) {
            if ($script:SwsdClipboardText.Contains($diagnosticToken.Substring($i, 8))) { throw 'Clipboard report leaked a synthetic token fragment.' }
        }
        if (-not $script:SwsdClipboardText.Contains('safe log line') -or -not $script:SwsdClipboardText.Contains('[REDACTED]')) { throw 'Clipboard report omitted the redacted log.' }
        Assert-SwsdClick $test 'Saved connection verified'
        Assert-SwsdClick $saveProfile 'Profile saved'
        Assert-SwsdClick $remove 'Saved token removed'
        if ($srToken.Value.Text -ne 'No') { throw 'Dashboard did not refresh after removing the token.' }
        Assert-SwsdClick $test 'No token is saved'
        Assert-SwsdClick $save 'Paste your personal SWSD token'
        $script:SwsdMockInstallFails = $true
        Assert-SwsdClick $install 'mock install failure'
        Assert-SwsdClick $showDetails 'mock install failure'
        if ($showDetails.Text -ne 'Hide details') { throw 'Error details button did not toggle.' }
        Assert-SwsdClick $showDetails 'mock install failure'
        if ($showDetails.Text -ne 'Show details') { throw 'Error details button did not close details.' }
        $script:SwsdMockInstallFails = $false
        Assert-SwsdClick $install 'Tools installed'
        $unsafeError = Format-SwsdFriendlyError ([Exception]::new('synthetic-secret-must-never-be-displayed'))
        if ($unsafeError.Friendly -like '*synthetic-secret*' -or $unsafeError.Technical -like '*synthetic-secret*') { throw 'Error formatting exposed arbitrary exception text.' }
        # A handler that escapes every inner catch must still surface as a friendly in-window error.
        $script:SwsdHandlerErrors = @()
        foreach ($b in $buttons) { $b.Enabled = $false }
        Invoke-SwsdSafe -Source 'probe' { throw 'synthetic handler crash' }
        if ($status.Text -notlike '*Something went wrong: synthetic handler crash*') { throw 'Safe wrapper did not show a friendly error.' }
        foreach ($b in $buttons) { if (-not $b.Enabled) { throw 'Safe wrapper did not re-enable controls.' } }
        if ($script:SwsdMockCalls.ToArray() -notcontains 'install' -or $script:SwsdMockCalls.ToArray() -notcontains 'test') { throw 'Mocks were not used.' }
        foreach ($call in @('update-check', 'node-confirm', 'node-install', 'clipboard')) {
            if ($script:SwsdMockCalls.ToArray() -notcontains $call) { throw "Mock '$call' was not used." }
        }
        Write-Output 'PASS: diagnostics copied via mock with presence-only credential check and no token fragments; update current/available/newer/offline/retry and confirmed/cancelled/failed Node helper; every button clicked under StrictMode; background install awaited via responsive timer; failure/retry, duplicate install and close guards, dashboard refresh, friendly errors, controls re-enabled, no unhandled exceptions.'
    } finally {
        $script:SwsdInstallTimer.Stop()
        $script:SwsdInstallTimer.Dispose()
        if ($null -ne $script:SwsdInstallWorker) {
            $script:SwsdInstallWorker.PowerShell.Stop()
            $script:SwsdInstallWorker.PowerShell.Dispose()
            $script:SwsdInstallWorker.Runspace.Dispose()
            $script:SwsdInstallWorker = $null
        }
        try { [SwsdDesktop.Credentials]::Remove($script:SwsdCredentialTarget) } catch {}
        $settingsPath = Join-Path $script:SwsdHome 'settings.json'
        if (Test-Path -LiteralPath $settingsPath) { Remove-Item -LiteralPath $settingsPath -Force }
        $resolved = [IO.Path]::GetFullPath($script:SwsdHome)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($resolved) -notmatch '^swsd-ui-test-[a-f0-9]{32}$') { throw 'Unsafe UI test cleanup path.' }
        $repair = Join-Path $script:SwsdHome 'repair-source'
        if (Test-Path -LiteralPath $repair) { Remove-Item -LiteralPath $repair -Recurse -Force }
        if (Test-Path -LiteralPath $script:SwsdHome) { Remove-Item -LiteralPath $script:SwsdHome -Recurse -Force }
    }
} elseif ($ValidateUi) {
    try {
        if (-not $tokenBox.UseSystemPasswordChar) { throw 'Token field must be masked.' }
        if ($profile.Items.Count -ne 5) { throw 'Five profile choices are required.' }
        if ($profile.SelectedItem -ne 'Agent') { throw 'New installations must default to Agent.' }
        foreach ($expectedName in @('Status Node.js','Status Tools installed','Status Token saved','Status Region','Status Profile','Status Updates')) {
            if (@($statusRows | Where-Object { $_.Panel.AccessibleName -eq $expectedName }).Count -ne 1) { throw "Status row '$expectedName' is missing." }
        }
        if ($copyDiagnostics.AccessibleName -ne 'Copy diagnostics' -or -not $statusButtonRow.Controls.Contains($copyDiagnostics) -or $statusButtonRow.WrapContents) { throw 'Copy diagnostics button or non-wrapping row is missing.' }
        if ($copyDiagnostics.Height -ne $showDetails.Height -or $copyDiagnostics.Width -ne $showDetails.Width) { throw 'Status action buttons must have equal dimensions.' }
        if ($progressBar.AccessibleName -ne 'Progress') { throw 'Progress bar AccessibleName must be Progress.' }
        if ($srProfile.Chip.Text -ne 'Saved' -or $srToken.Value.Text -notin @('No', 'Unavailable')) { throw 'Dashboard initial state is incorrect.' }
        $onClick = $saveProfile.GetType().GetMethod('OnClick', [Reflection.BindingFlags]'Instance,NonPublic')
        foreach ($index in 0..4) {
            $profile.SelectedIndex = $index
            $onClick.Invoke($saveProfile, @([EventArgs]::Empty))
            if ((Get-SwsdSettings).profile -ne $script:SwsdProfiles[$index].id) { throw 'Profile button failed to persist selection.' }
            if ($profileDescription.Text -ne $script:SwsdProfiles[$index].description) { throw 'Profile description did not update.' }
            if ($srProfile.Value.Text -ne $script:SwsdProfiles[$index].name) { throw 'Dashboard profile did not update.' }
            if ($status.Text -notlike '*Profile saved.*') { throw 'Profile save did not display success and restart guidance.' }
        }
        Write-Output 'PASS: masked entry, Agent default, all five dropdown choices, actual Save profile event, persistence, descriptions, restart guidance, dashboard rows and profile refresh.'
    } finally {
        # Only delete the two explicitly named files created by this UI test.
        $settingsPath = Join-Path $script:SwsdHome 'settings.json'
        if (Test-Path -LiteralPath $settingsPath) { Remove-Item -LiteralPath $settingsPath -Force }
        if (Test-Path -LiteralPath $script:SwsdHome) { Remove-Item -LiteralPath $script:SwsdHome }
    }
} else {
    [void]$form.ShowDialog()
}
$tokenBox.Clear()
$form.Dispose()
