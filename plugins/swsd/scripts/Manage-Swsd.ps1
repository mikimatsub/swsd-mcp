param([switch]$CheckOnly, [switch]$ValidateUi, [switch]$ValidateWindow, [switch]$ValidateHandlers, [switch]$ValidateDpiChanges, [ValidateRange(1,15)][int]$WindowTestSeconds = 2, [ValidateSet('ready','appearance','firstrun','jwt-help','error','tools','tool-detail','profile-builder','custom-selected','import-error','whats-new')][string]$PreviewState = 'ready', [string]$ScreenshotPath, [string]$PreviewTheme)
$ErrorActionPreference = 'Stop'
if ($PreviewState -eq 'appearance' -and -not $ValidateWindow) {throw 'Appearance dropdown preview requires the isolated ValidateWindow mode.'}
if ($PreviewTheme -and -not ($ValidateUi -or $ValidateWindow -or $ValidateHandlers -or $ValidateDpiChanges)) {throw 'PreviewTheme requires an isolated UI validation mode.'}
if ($ValidateUi -or $ValidateWindow -or $ValidateHandlers -or $ValidateDpiChanges) {
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
    public static bool FailSave;
    public static void Save(string target, string secret) { Check(target); if (FailSave) throw new InvalidOperationException("Synthetic credential write failure."); values[target] = secret; }
    public static void Remove(string target) { Check(target); values.Remove(target); }
  }
}
'@
}
. (Join-Path $PSScriptRoot 'Common.ps1')
if ($ValidateUi -or $ValidateWindow -or $ValidateHandlers -or $ValidateDpiChanges) {
    # Exercise the real controls and save handler without touching a user's settings or credential.
    $script:SwsdHome = Join-Path ([IO.Path]::GetTempPath()) ('swsd-ui-test-' + [guid]::NewGuid().ToString('N'))
    $script:SwsdCredentialTarget = 'swsd-mcp/ui-test-' + [guid]::NewGuid().ToString('N')
}
$script:SwsdDiagnosticsLogPath = Join-Path $env:TEMP 'swsd-settings.log'
if ($ValidateUi -or $ValidateWindow -or $ValidateHandlers -or $ValidateDpiChanges) {
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
if ($ScreenshotPath -and -not $ValidateWindow) { throw 'ScreenshotPath requires the isolated ValidateWindow mode.' }
if ($ValidateDpiChanges -and -not $ValidateWindow) { $ValidateWindow=$true }
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
    [DllImport("dwmapi.dll", PreserveSig=true)]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int attrValue, int attrSize);
    public static int ReadWindowAttribute(IntPtr hwnd, int attr) {
      try { int value; return DwmGetWindowAttribute(hwnd, attr, out value, 4) == 0 ? value : -1; }
      catch { return -1; }
    }
    public static void ApplyDarkMode(IntPtr hwnd, bool dark) {
      try { int val = dark ? 1 : 0; DwmSetWindowAttribute(hwnd, 20, ref val, 4); } catch {}
      try { int val = dark ? 1 : 0; DwmSetWindowAttribute(hwnd, 19, ref val, 4); } catch {}
    }
    [StructLayout(LayoutKind.Sequential)] private struct MARGINS { public int Left, Right, Top, Bottom; }
    [DllImport("dwmapi.dll")] private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);
    public static bool ApplyMicaBackdrop(IntPtr hwnd) {
      try {
        int val = 2;
        if (DwmSetWindowAttribute(hwnd, 38, ref val, 4) != 0) return false;
        MARGINS margins = new MARGINS { Left=-1, Right=-1, Top=-1, Bottom=-1 };
        return DwmExtendFrameIntoClientArea(hwnd, ref margins) == 0;
      } catch { return false; }
    }
    public static void ApplyRoundedCorners(IntPtr hwnd) {
      try { int val = 2; DwmSetWindowAttribute(hwnd, 33, ref val, 4); } catch {}
    }
    public static void ClearBackdrop(IntPtr hwnd) {
      try { int val = 1; DwmSetWindowAttribute(hwnd, 38, ref val, 4); } catch {}
      try { MARGINS margins = new MARGINS(); DwmExtendFrameIntoClientArea(hwnd, ref margins); } catch {}
    }
  }
}
'@
}

# Windows PowerShell targets an older Framework. Opt in before loading WPF or creating an HWND.
# https://support.microsoft.com/en-us/servicing/dotnetframework/2017/01/per-monitor-dpi-aware-applications-render-incorrectly-if-the-target-framework-version-is-earlier-tha
[AppContext]::SetSwitch('Switch.System.Windows.DoNotScaleForDpiChanges', $false)
[AppContext]::SetSwitch('Switch.System.Windows.DoNotUsePresentationDpiCapabilityTier2OrGreater', $false)
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Open SWSD setup in an STA PowerShell session.' }
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Add-Type -ReferencedAssemblies PresentationFramework, PresentationCore, WindowsBase, System.Xaml -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
namespace SwsdDesktop {
  public sealed class MonitorArea {
    public string Name;
    public int Left, Top, Width, Height;
  }
  public sealed class WpfDpi {
    public int DeviceDpi = 96;
    private HwndSource source;
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] private struct MONITORINFO {
      public int Size; public RECT Monitor, Work; public uint Flags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string Device;
    }
    private delegate bool MonitorCallback(IntPtr monitor, IntPtr dc, IntPtr rect, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorCallback callback, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", EntryPoint="SendMessageW")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr dpi, ref RECT rect);
    public WpfDpi(IntPtr window) {
      try { DeviceDpi = (int)GetDpiForWindow(window); } catch (EntryPointNotFoundException) {}
      source = HwndSource.FromHwnd(window);
      source.AddHook(Hook);
    }
    private IntPtr Hook(IntPtr window, int message, IntPtr wParam, IntPtr lParam, ref bool handled) {
      if (message == 0x02E0) DeviceDpi = (int)(wParam.ToInt64() & 0xffff);
      // WPF handles WM_DPICHANGED, transforms the visuals and applies suggested bounds.
      // Never multiply previously rounded font sizes or dimensions.
      return IntPtr.Zero;
    }
    private static MonitorArea Area(IntPtr monitor) {
      MONITORINFO info = new MONITORINFO(); info.Size = Marshal.SizeOf(info);
      if (!GetMonitorInfo(monitor, ref info)) throw new InvalidOperationException("Monitor information unavailable.");
      return new MonitorArea { Name=info.Device, Left=info.Work.Left, Top=info.Work.Top, Width=info.Work.Right-info.Work.Left, Height=info.Work.Bottom-info.Work.Top };
    }
    public static MonitorArea[] Monitors() {
      var list = new List<MonitorArea>();
      MonitorCallback callback = delegate(IntPtr monitor, IntPtr dc, IntPtr rect, IntPtr data) { list.Add(Area(monitor)); return true; };
      EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero);
      return list.ToArray();
    }
    public static MonitorArea WorkingArea(IntPtr window) { return Area(MonitorFromWindow(window, 2)); }
    public static void Move(IntPtr window, MonitorArea area, int width, int height) {
      SetWindowPos(window, IntPtr.Zero, area.Left+16, area.Top+16, Math.Min(width, area.Width-32), Math.Min(height, area.Height-32), 0x14);
    }
    public static void SendDpi(IntPtr window, int dpi) {
      RECT bounds; GetWindowRect(window, out bounds);
      SendMessage(window, 0x02E0, new IntPtr(dpi | (dpi << 16)), ref bounds);
    }
    public static void Capture(FrameworkElement root, string path) { Capture(root, path, null); }
    public static void Capture(FrameworkElement root, string path, FrameworkElement popup) {
      root.UpdateLayout();
      var target = new RenderTargetBitmap((int)Math.Ceiling(root.ActualWidth), (int)Math.Ceiling(root.ActualHeight), 96, 96, PixelFormats.Pbgra32);
      target.Render(root);
      // WPF popups have their own visual/HWND and are absent from Render(root).
      // Compose only this app's popup; never capture the desktop framebuffer.
      if (popup != null) {
        popup.UpdateLayout();
        var overlay = new RenderTargetBitmap((int)Math.Ceiling(popup.ActualWidth), (int)Math.Ceiling(popup.ActualHeight), 96, 96, PixelFormats.Pbgra32);
        overlay.Render(popup);
        Point origin = root.PointToScreen(new Point()), position = popup.PointToScreen(new Point());
        var dpi = VisualTreeHelper.GetDpi(root);
        double x = (position.X-origin.X)/dpi.DpiScaleX, y = (position.Y-origin.Y)/dpi.DpiScaleY;
        double left = Math.Min(0, x), top = Math.Min(0, y);
        double width = Math.Max(root.ActualWidth, x+popup.ActualWidth)-left;
        double height = Math.Max(root.ActualHeight, y+popup.ActualHeight)-top;
        var visual = new DrawingVisual();
        using (var drawing = visual.RenderOpen()) {
          drawing.DrawImage(target, new Rect(-left, -top, root.ActualWidth, root.ActualHeight));
          drawing.DrawImage(overlay, new Rect(x-left, y-top, popup.ActualWidth, popup.ActualHeight));
        }
        target = new RenderTargetBitmap((int)Math.Ceiling(width), (int)Math.Ceiling(height), 96, 96, PixelFormats.Pbgra32);
        target.Render(visual);
      }
      var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(target));
      using (var stream = File.Create(path)) encoder.Save(stream);
    }
  }
}
'@

$script:SwsdAssetRoot = Join-Path (Split-Path $PSScriptRoot) 'assets'
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'assets/tool-catalog.json')) { $script:SwsdAssetRoot = Join-Path $PSScriptRoot 'assets' }
$script:SwsdCatalog = Get-Content -LiteralPath (Join-Path $script:SwsdAssetRoot 'tool-catalog.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$script:SwsdHandlerErrors = @()
$script:SwsdInstallWorker = $null
$script:SwsdLatestVersion = $null
$script:SwsdUpdateState = 'unchecked'
$script:SwsdVerified = $false
$script:SwsdIdentity = $null
$script:SwsdTokenError = $false
$script:SwsdSyncing = $true
$script:SwsdHelpOpen = $false
$script:SwsdArea = ''
$script:SwsdAreaOrder = @('Incidents','Problems','Changes','Releases','Comments & tasks','Knowledge','Service catalog','Assets & CMDB','Contracts & vendors','Directory','Utilities')
$script:SwsdSelectedTool = 'swsd_list_my_incidents'
$script:SwsdExpandedAreas = @{}
$script:SwsdPresentationCount = 0
$script:SwsdDeviceDpi = 96
$script:SwsdDpi = $null
$script:SwsdHandle = [IntPtr]::Zero
$script:SwsdMicaEnabled = $false
$script:SwsdUiScale = 1.0
if ($env:SWSD_UI_SCALE) {
    $scaleValue = 1.0
    if ([double]::TryParse($env:SWSD_UI_SCALE, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$scaleValue) -and $scaleValue -ge 0.75 -and $scaleValue -le 3) { $script:SwsdUiScale = $scaleValue }
}

# Vector paths follow the supplied A3 artwork, including the half-circle Appearance icon.
$script:SwsdIcons = @{
    shield='M12,3 L19,6 19,11.5 Q19,17 12,21 Q5,17 5,11.5 L5,6 Z'
    node='M12,3 L20,7.5 20,16.5 12,21 4,16.5 4,7.5 Z M12,8 L12,16'
    tools='M5,7 L19,7 Q21,7 21,9 L21,18 Q21,20 19,20 L5,20 Q3,20 3,18 L3,9 Q3,7 5,7 M9,7 L9,5 Q9,4 10.5,4 L13.5,4 Q15,4 15,5 L15,7 M3,12 L21,12'
    key='M12,15 A4,4 0 1 1 4,15 A4,4 0 1 1 12,15 M11,12 L20,3 M16,7 L18.5,9.5 M14,9 L16,11'
    globe='M20.5,12 A8.5,8.5 0 1 1 3.5,12 A8.5,8.5 0 1 1 20.5,12 M3.5,12 L20.5,12 M12,3.5 C16,7 16,17 12,20.5 C8,17 8,7 12,3.5'
    prof='M15.5,8.5 A3.5,3.5 0 1 1 8.5,8.5 A3.5,3.5 0 1 1 15.5,8.5 M5,20 C6,13 18,13 19,20'
    upd='M20,12 A8,8 0 1 1 17.6,6.3 M20,4 L20,8.5 15.5,8.5'
    diag='M3,12 L7,12 9,7 13,17 15,12 21,12'
    wrench='M14.5,6.5 Q14,12.5 19.5,11.5 L12,19 Q10.5,20.5 9,19 Q7.5,17.5 9,16 Z'
    theme='M20.5,12 A8.5,8.5 0 1 1 3.5,12 A8.5,8.5 0 1 1 20.5,12 M12,3.5 L12,20.5 M12,3.5 A8.5,8.5 0 0 0 12,20.5 Z'
}
function ConvertTo-SwsdXml([string]$Text) { return [Security.SecurityElement]::Escape($Text) }
function New-SwsdIconXaml([string]$Name) {
    $path = $script:SwsdIcons[$Name]
    $fill = if ($Name -eq 'theme') { '{DynamicResource Accent}' } else { 'Transparent' }
    return "<Border Style=`"{StaticResource IconBox}`"><Viewbox Width=`"18`" Height=`"18`"><Path Width=`"24`" Height=`"24`" Data=`"$path`" Stroke=`"{DynamicResource AccentForeground}`" StrokeThickness=`"1.7`" Fill=`"$fill`" StrokeLineJoin=`"Round`"/></Viewbox></Border>"
}
function New-SwsdRowXaml([string]$Id, [string]$Icon, [string]$Title, [string]$Description, [string]$Controls) {
    $iconXaml = New-SwsdIconXaml $Icon
    $titleXml = ConvertTo-SwsdXml $Title
    $descriptionXml = ConvertTo-SwsdXml $Description
    return @"
<Border Name="${Id}Row" Style="{StaticResource SettingRow}"><Grid>
<Grid.ColumnDefinitions><ColumnDefinition Width="32"/><ColumnDefinition Width="16"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
$iconXaml
<StackPanel Grid.Column="2" VerticalAlignment="Center" Margin="0,0,12,0"><StackPanel Orientation="Horizontal"><TextBlock Text="$titleXml" FontSize="14"/><Button Name="${Id}Help" Content="?" Style="{StaticResource HelpButton}" Visibility="Collapsed" Margin="6,0,0,0" AutomationProperties.Name="JSON Web Token help"/></StackPanel><TextBlock Name="${Id}Description" Text="$descriptionXml" Style="{StaticResource Description}" TextWrapping="Wrap"/></StackPanel>
<StackPanel Grid.Column="3" Orientation="Horizontal" VerticalAlignment="Center">$Controls</StackPanel>
</Grid></Border>
"@
}
$regionXaml = New-SwsdRowXaml 'region' 'globe' 'Region' 'Where your SWSD data is hosted' '<ComboBox Name="region" Width="200" AutomationProperties.Name="SWSD region"><ComboBoxItem Content="United States"/><ComboBoxItem Content="Europe"/></ComboBox>'
$tokenXaml = New-SwsdRowXaml 'token' 'key' 'JSON Web Token' 'Select Test to verify' '<Grid Width="230"><PasswordBox Name="tokenBox" AutomationProperties.Name="JSON Web Token"/><TextBlock Name="tokenPlaceholder" Text="Paste token" Foreground="{DynamicResource Muted}" HorizontalAlignment="Left" VerticalAlignment="Center" Margin="12,0,0,0" IsHitTestVisible="False"/><TextBlock Name="tokenVerified" Text="✓" Foreground="{DynamicResource SuccessForeground}" FontWeight="SemiBold" FontSize="16" HorizontalAlignment="Right" VerticalAlignment="Center" Margin="0,0,12,0" Visibility="Collapsed" IsHitTestVisible="False" AutomationProperties.Name="Verified connection"/></Grid><Button Name="test" Content="Test" Width="64" Margin="8,0,0,0"/>'
$profileXaml = New-SwsdRowXaml 'profile' 'prof' 'Profile' '' '<ComboBox Name="profile" Width="200" AutomationProperties.Name="Tool profile"/>'
$updateXaml = New-SwsdRowXaml 'updates' 'upd' 'Updates' 'Check for a newer version of SWSD tools' '<Button Name="releaseNotes" Content="What&#x2019;s new" Style="{StaticResource LinkButton}" Margin="0,0,12,0"/><Button Name="checkUpdates" Content="Check now" Width="110"/>'
$diagnosticsXaml = New-SwsdRowXaml 'diagnostics' 'diag' 'Diagnostics' 'Copy a redacted report for support. Tokens are never included.' '<Button Name="copyDiagnostics" Content="Copy report" Width="110" AutomationProperties.Name="Copy diagnostics"/>'
$repairXaml = New-SwsdRowXaml 'repair' 'wrench' 'Repair tools' 'Fix a damaged or incomplete installation.' '<Button Name="install" Content="Repair" Width="110"/>'
$appearanceItems = foreach ($entry in $script:SwsdThemes.GetEnumerator()) {
    if ($entry.Key -eq 'dracula') {'<ComboBoxItem Tag="__separator" IsEnabled="False" Focusable="False" IsHitTestVisible="False"><ComboBoxItem.Template><ControlTemplate TargetType="ComboBoxItem"><Border Height="1" Background="{DynamicResource Divider}" Margin="8,6"/></ControlTemplate></ComboBoxItem.Template></ComboBoxItem>'}
    '<ComboBoxItem Content="'+(ConvertTo-SwsdXml $entry.Value.name)+'" Tag="'+$entry.Key+'"/>'
}
$appearanceXaml = New-SwsdRowXaml 'appearance' 'theme' 'Appearance' 'Follows Windows' ('<ComboBox Name="appearance" Width="230" AutomationProperties.Name="Appearance">'+($appearanceItems -join '')+'</ComboBox>')
$dashboardXaml = ''
$rowNames = @('Node','Tools','Token','Region','Profile','Update')
$rowLabels = @('Node.js','SWSD tools','JSON Web Token','Region','Profile','Updates')
$rowIcons = @('node','tools','key','globe','prof','upd')
for ($i = 0; $i -lt 6; $i++) {
    $id = $rowNames[$i]; $label = $rowLabels[$i]; $icon = New-SwsdIconXaml $rowIcons[$i]
    $dashboardXaml += @"
<Border Name="${id}Cell" BorderBrush="{DynamicResource Divider}" BorderThickness="0,1,1,0" Padding="18,14"><Grid>
<Grid.ColumnDefinitions><ColumnDefinition Width="32"/><ColumnDefinition Width="12"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
$icon
<StackPanel Grid.Column="2" VerticalAlignment="Center"><TextBlock Text="$label" FontSize="12" Foreground="{DynamicResource Muted}"/><TextBlock Name="${id}Value" FontSize="13.5" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/></StackPanel>
<Border Name="${id}Chip" Grid.Column="3" Style="{StaticResource Chip}" Margin="8,0,0,0"><TextBlock Name="${id}ChipText" FontSize="11.5" FontWeight="SemiBold"/></Border>
</Grid></Border>
"@
}
$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:shell="clr-namespace:System.Windows.Shell;assembly=PresentationFramework"
 Title="SWSD for AI apps" Width="1000" Height="1000" MinWidth="760" MinHeight="600" WindowStartupLocation="CenterScreen" Background="{DynamicResource Canvas}" FontFamily="Segoe UI" FontSize="13" Foreground="{DynamicResource Text}" UseLayoutRounding="True" SnapsToDevicePixels="True" TextOptions.TextFormattingMode="Display">
<shell:WindowChrome.WindowChrome><shell:WindowChrome CaptionHeight="44" ResizeBorderThickness="6" GlassFrameThickness="0" UseAeroCaptionButtons="False"/></shell:WindowChrome.WindowChrome>
<Window.Resources>
 <SolidColorBrush x:Key="Canvas" Color="#f3f3f4"/><SolidColorBrush x:Key="Text" Color="#1a1a1e"/><SolidColorBrush x:Key="Muted" Color="#5c5f66"/>
 <Style x:Key="Description" TargetType="TextBlock"><Setter Property="FontSize" Value="12.5"/><Setter Property="Foreground" Value="{DynamicResource Muted}"/><Setter Property="Margin" Value="0,2,0,0"/></Style>
 <Style x:Key="CardStyle" TargetType="Border"><Setter Property="Background" Value="{DynamicResource Card}"/><Setter Property="BorderBrush" Value="{DynamicResource Border}"/><Setter Property="BorderThickness" Value="1"/><Setter Property="CornerRadius" Value="8"/><Setter Property="Effect"><Setter.Value><DropShadowEffect BlurRadius="14" ShadowDepth="3" Opacity="0.09"/></Setter.Value></Setter></Style>
 <Style x:Key="Section" TargetType="TextBlock"><Setter Property="FontSize" Value="14"/><Setter Property="FontWeight" Value="SemiBold"/><Setter Property="Margin" Value="2,20,0,8"/></Style>
 <Style x:Key="SettingRow" TargetType="Border"><Setter Property="MinHeight" Value="64"/><Setter Property="Padding" Value="18,13"/><Setter Property="BorderBrush" Value="{DynamicResource Divider}"/><Setter Property="BorderThickness" Value="0,0,0,1"/></Style>
 <Style x:Key="IconBox" TargetType="Border"><Setter Property="Width" Value="32"/><Setter Property="Height" Value="32"/><Setter Property="CornerRadius" Value="7"/><Setter Property="Background" Value="{DynamicResource Selected}"/><Setter Property="VerticalAlignment" Value="Center"/></Style>
 <Style x:Key="Chip" TargetType="Border"><Setter Property="Height" Value="22"/><Setter Property="Padding" Value="8,2"/><Setter Property="CornerRadius" Value="11"/><Setter Property="VerticalAlignment" Value="Center"/></Style>
 <Style TargetType="Button"><Setter Property="Height" Value="32"/><Setter Property="Padding" Value="14,0"/><Setter Property="Foreground" Value="{DynamicResource Text}"/><Setter Property="Background" Value="{DynamicResource Control}"/><Setter Property="BorderBrush" Value="{DynamicResource ControlBorder}"/><Setter Property="BorderThickness" Value="1"/><Setter Property="VerticalContentAlignment" Value="Center"/><Setter Property="HorizontalContentAlignment" Value="Center"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button"><Border Name="ButtonFrame" CornerRadius="5" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" Padding="{TemplateBinding Padding}"><ContentPresenter HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalAlignment="Center"/></Border><ControlTemplate.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="ButtonFrame" Property="BorderBrush" Value="{DynamicResource AccentForeground}"/></Trigger><Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="ButtonFrame" Property="BorderBrush" Value="{DynamicResource AccentForeground}"/><Setter TargetName="ButtonFrame" Property="BorderThickness" Value="2"/></Trigger><Trigger Property="IsEnabled" Value="False"><Setter TargetName="ButtonFrame" Property="Opacity" Value="0.5"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
 <Style x:Key="PrimaryButton" TargetType="Button" BasedOn="{StaticResource {x:Type Button}}"><Setter Property="Background" Value="{DynamicResource Accent}"/><Setter Property="Foreground" Value="{DynamicResource AccentText}"/><Setter Property="BorderThickness" Value="0"/></Style>
 <Style x:Key="LinkButton" TargetType="Button" BasedOn="{StaticResource {x:Type Button}}"><Setter Property="Background" Value="Transparent"/><Setter Property="Foreground" Value="{DynamicResource AccentForeground}"/><Setter Property="BorderThickness" Value="0"/><Setter Property="Padding" Value="0"/></Style>
 <Style x:Key="HelpButton" TargetType="Button" BasedOn="{StaticResource {x:Type Button}}"><Setter Property="Width" Value="18"/><Setter Property="Height" Value="18"/><Setter Property="Padding" Value="0"/><Setter Property="FontSize" Value="11"/><Setter Property="Foreground" Value="{DynamicResource Muted}"/></Style>
 <Style x:Key="NavButton" TargetType="RadioButton"><Setter Property="Height" Value="26"/><Setter Property="Padding" Value="14,0"/><Setter Property="Foreground" Value="{DynamicResource Muted}"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="RadioButton"><Border Name="NavFrame" CornerRadius="5" Background="Transparent" Padding="{TemplateBinding Padding}"><Grid><ContentPresenter VerticalAlignment="Center"/><Border Name="Underline" Width="14" Height="2" VerticalAlignment="Bottom" Background="{DynamicResource AccentForeground}" Visibility="Collapsed"/></Grid></Border><ControlTemplate.Triggers><Trigger Property="IsChecked" Value="True"><Setter TargetName="NavFrame" Property="Background" Value="{DynamicResource Selected}"/><Setter Property="Foreground" Value="{DynamicResource SelectedText}"/><Setter TargetName="Underline" Property="Visibility" Value="Visible"/></Trigger><Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="NavFrame" Property="BorderBrush" Value="{DynamicResource AccentForeground}"/><Setter TargetName="NavFrame" Property="BorderThickness" Value="1"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
 <Style TargetType="ComboBoxItem"><Setter Property="Padding" Value="10,7"/><Setter Property="Foreground" Value="{DynamicResource Text}"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="ComboBoxItem"><Border Name="ItemFrame" Padding="{TemplateBinding Padding}" Background="Transparent"><ContentPresenter/></Border><ControlTemplate.Triggers><Trigger Property="IsHighlighted" Value="True"><Setter TargetName="ItemFrame" Property="Background" Value="{DynamicResource Selected}"/><Setter Property="Foreground" Value="{DynamicResource SelectedText}"/></Trigger><Trigger Property="IsSelected" Value="True"><Setter TargetName="ItemFrame" Property="Background" Value="{DynamicResource Selected}"/><Setter Property="Foreground" Value="{DynamicResource SelectedText}"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
 <Style TargetType="ComboBox"><Setter Property="Height" Value="32"/><Setter Property="Foreground" Value="{DynamicResource Text}"/><Setter Property="Background" Value="{DynamicResource Control}"/><Setter Property="BorderBrush" Value="{DynamicResource ControlBorder}"/><Setter Property="ScrollViewer.VerticalScrollBarVisibility" Value="Auto"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="ComboBox"><Grid><ToggleButton Focusable="False" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" IsChecked="{Binding IsDropDownOpen, RelativeSource={RelativeSource TemplatedParent}, Mode=TwoWay}"><ToggleButton.Template><ControlTemplate TargetType="ToggleButton"><Border CornerRadius="5" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1,1,1,1"><Path Data="M0,0 L4,4 8,0" Stroke="{DynamicResource Muted}" StrokeThickness="1" Width="8" Height="4" HorizontalAlignment="Right" Margin="0,0,12,0"/></Border></ControlTemplate></ToggleButton.Template></ToggleButton><ContentPresenter Content="{TemplateBinding SelectionBoxItem}" ContentTemplate="{TemplateBinding SelectionBoxItemTemplate}" Margin="12,0,30,0" VerticalAlignment="Center" IsHitTestVisible="False"/><Popup Name="PART_Popup" Placement="Bottom" IsOpen="{TemplateBinding IsDropDownOpen}" AllowsTransparency="True" Focusable="False"><Border Background="{DynamicResource Flyout}" BorderBrush="{DynamicResource ControlBorder}" BorderThickness="1" CornerRadius="5" MinWidth="{TemplateBinding ActualWidth}" Padding="2"><ScrollViewer MaxHeight="300"><ItemsPresenter KeyboardNavigation.DirectionalNavigation="Contained"/></ScrollViewer></Border></Popup></Grid><ControlTemplate.Triggers><Trigger Property="IsKeyboardFocusWithin" Value="True"><Setter Property="BorderBrush" Value="{DynamicResource AccentForeground}"/></Trigger><Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.5"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
 <Style TargetType="PasswordBox"><Setter Property="CaretBrush" Value="{DynamicResource Text}"/><Setter Property="SelectionBrush" Value="{DynamicResource Accent}"/><Setter Property="SelectionTextBrush" Value="{DynamicResource AccentText}"/><Setter Property="SelectionOpacity" Value="1"/><Setter Property="Height" Value="32"/><Setter Property="Padding" Value="11,5"/><Setter Property="Foreground" Value="{DynamicResource Text}"/><Setter Property="Background" Value="{DynamicResource Control}"/><Setter Property="BorderBrush" Value="{DynamicResource ControlBorder}"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="PasswordBox"><Border Name="PasswordFrame" CornerRadius="5" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1"><ScrollViewer Name="PART_ContentHost" SnapsToDevicePixels="{TemplateBinding SnapsToDevicePixels}"/></Border><ControlTemplate.Triggers><Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="PasswordFrame" Property="BorderBrush" Value="{DynamicResource AccentForeground}"/><Setter TargetName="PasswordFrame" Property="BorderThickness" Value="1,1,1,2"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
 <Style TargetType="TextBox"><Setter Property="Padding" Value="12,7"/><Setter Property="Foreground" Value="{DynamicResource Text}"/><Setter Property="Background" Value="{DynamicResource Control}"/><Setter Property="BorderBrush" Value="{DynamicResource ControlBorder}"/><Setter Property="CaretBrush" Value="{DynamicResource Text}"/><Setter Property="SelectionBrush" Value="{DynamicResource Accent}"/><Setter Property="SelectionTextBrush" Value="{DynamicResource AccentText}"/><Setter Property="SelectionOpacity" Value="1"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="TextBox"><Border Name="TextFrame" CornerRadius="5" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="1"><ScrollViewer Name="PART_ContentHost" SnapsToDevicePixels="{TemplateBinding SnapsToDevicePixels}"/></Border><ControlTemplate.Triggers><Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="TextFrame" Property="BorderBrush" Value="{DynamicResource AccentForeground}"/><Setter TargetName="TextFrame" Property="BorderThickness" Value="1,1,1,2"/></Trigger><Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.5"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
 <Style TargetType="CheckBox"><Setter Property="Foreground" Value="{DynamicResource Text}"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="CheckBox"><Grid><Grid.ColumnDefinitions><ColumnDefinition Width="16"/><ColumnDefinition Width="8"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions><Border Name="CheckFrame" Width="15" Height="15" CornerRadius="3" Background="{DynamicResource Control}" BorderBrush="{DynamicResource ControlBorder}" BorderThickness="1" VerticalAlignment="Center"/><Path Name="CheckMark" Data="M0,4 L3,7 L9,0" Stroke="{DynamicResource AccentText}" StrokeThickness="1.6" Width="9" Height="7" VerticalAlignment="Center" HorizontalAlignment="Center" Visibility="Collapsed"/><ContentPresenter Grid.Column="2" VerticalAlignment="Center"/></Grid><ControlTemplate.Triggers><Trigger Property="IsChecked" Value="True"><Setter TargetName="CheckFrame" Property="Background" Value="{DynamicResource Accent}"/><Setter TargetName="CheckFrame" Property="BorderBrush" Value="{DynamicResource AccentForeground}"/><Setter TargetName="CheckMark" Property="Visibility" Value="Visible"/></Trigger><Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="CheckFrame" Property="BorderBrush" Value="{DynamicResource AccentForeground}"/><Setter TargetName="CheckFrame" Property="BorderThickness" Value="2"/></Trigger><Trigger Property="IsEnabled" Value="False"><Setter Property="Opacity" Value="0.5"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>

 <Style TargetType="ToolTip"><Setter Property="Foreground" Value="{DynamicResource Text}"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="ToolTip"><Border Background="{DynamicResource Flyout}" BorderBrush="{DynamicResource ControlBorder}" BorderThickness="1" CornerRadius="5" Padding="10,7"><ContentPresenter/></Border></ControlTemplate></Setter.Value></Setter></Style>
 <Style x:Key="ScrollPage" TargetType="RepeatButton"><Setter Property="Focusable" Value="False"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="RepeatButton"><Border Background="Transparent"/></ControlTemplate></Setter.Value></Setter></Style>
 <Style x:Key="ScrollThumb" TargetType="Thumb"><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Thumb"><Border Name="ThumbFrame" Background="{DynamicResource Muted}" CornerRadius="3" Margin="3"/><ControlTemplate.Triggers><Trigger Property="IsMouseOver" Value="True"><Setter TargetName="ThumbFrame" Property="Background" Value="{DynamicResource AccentForeground}"/></Trigger><Trigger Property="IsDragging" Value="True"><Setter TargetName="ThumbFrame" Property="Background" Value="{DynamicResource AccentForeground}"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
 <Style TargetType="ScrollBar"><Setter Property="Width" Value="12"/><Setter Property="MinHeight" Value="24"/><Setter Property="Background" Value="Transparent"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="ScrollBar"><Border Background="{TemplateBinding Background}"><Track Name="PART_Track" IsDirectionReversed="True" Orientation="{TemplateBinding Orientation}"><Track.DecreaseRepeatButton><RepeatButton Name="BeforeThumb" Style="{StaticResource ScrollPage}" Command="ScrollBar.PageUpCommand"/></Track.DecreaseRepeatButton><Track.Thumb><Thumb Style="{StaticResource ScrollThumb}"/></Track.Thumb><Track.IncreaseRepeatButton><RepeatButton Name="AfterThumb" Style="{StaticResource ScrollPage}" Command="ScrollBar.PageDownCommand"/></Track.IncreaseRepeatButton></Track></Border><ControlTemplate.Triggers><Trigger Property="Orientation" Value="Horizontal"><Setter Property="Width" Value="Auto"/><Setter Property="Height" Value="12"/><Setter Property="MinHeight" Value="0"/><Setter Property="MinWidth" Value="24"/><Setter TargetName="PART_Track" Property="IsDirectionReversed" Value="False"/><Setter TargetName="BeforeThumb" Property="Command" Value="ScrollBar.PageLeftCommand"/><Setter TargetName="AfterThumb" Property="Command" Value="ScrollBar.PageRightCommand"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
 <Style TargetType="Expander"><Setter Property="Foreground" Value="{DynamicResource Text}"/><Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Expander"><StackPanel><ToggleButton Name="HeaderSite" IsChecked="{Binding IsExpanded, RelativeSource={RelativeSource TemplatedParent}, Mode=TwoWay}" Foreground="{TemplateBinding Foreground}"><ToggleButton.Template><ControlTemplate TargetType="ToggleButton"><Border Name="HeaderFrame" Padding="4,10" Background="Transparent" CornerRadius="5"><Grid><Grid.ColumnDefinitions><ColumnDefinition Width="20"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions><Path Name="Arrow" Data="M0,0 L4,4 8,0" Stroke="{DynamicResource Muted}" StrokeThickness="1.5" Width="8" Height="4" VerticalAlignment="Center" RenderTransformOrigin="0.5,0.5"><Path.RenderTransform><RotateTransform Angle="-90"/></Path.RenderTransform></Path><ContentPresenter Grid.Column="1" Content="{Binding Header, RelativeSource={RelativeSource AncestorType=Expander}}"/></Grid></Border><ControlTemplate.Triggers><Trigger Property="IsChecked" Value="True"><Setter TargetName="Arrow" Property="RenderTransform"><Setter.Value><RotateTransform Angle="0"/></Setter.Value></Setter></Trigger><Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="HeaderFrame" Property="BorderBrush" Value="{DynamicResource AccentForeground}"/><Setter TargetName="HeaderFrame" Property="BorderThickness" Value="1"/></Trigger></ControlTemplate.Triggers></ControlTemplate></ToggleButton.Template></ToggleButton><ContentPresenter Name="ExpandSite" Visibility="Collapsed" Margin="{TemplateBinding Padding}"/></StackPanel><ControlTemplate.Triggers><Trigger Property="IsExpanded" Value="True"><Setter TargetName="ExpandSite" Property="Visibility" Value="Visible"/></Trigger></ControlTemplate.Triggers></ControlTemplate></Setter.Value></Setter></Style>
</Window.Resources>
<Grid Name="appRoot" Background="{DynamicResource Canvas}">
 <Grid.RowDefinitions><RowDefinition Height="44"/><RowDefinition Height="*"/></Grid.RowDefinitions>
 <Grid Name="titlebar" Margin="18,0,8,0"><Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
  <Border Width="20" Height="20" CornerRadius="5" Background="{DynamicResource Accent}"><Viewbox Width="13" Height="13"><Path Width="24" Height="24" Data="$($script:SwsdIcons.shield)" Stroke="{DynamicResource AccentText}" StrokeThickness="1.7"/></Viewbox></Border>
  <TextBlock Grid.Column="1" Text="SWSD for AI apps" VerticalAlignment="Center" FontSize="12.5" Margin="10,0,10,0"/>
  <Border Grid.Column="2" BorderBrush="{DynamicResource Border}" BorderThickness="1" CornerRadius="10" Padding="7,1" VerticalAlignment="Center"><TextBlock Name="versionPill" FontSize="11" Foreground="{DynamicResource Muted}"/></Border>
  <Border Grid.Column="3" Background="{DynamicResource Control}" BorderBrush="{DynamicResource Border}" BorderThickness="1" CornerRadius="8" Padding="3" VerticalAlignment="Center" Margin="24,0,0,0" shell:WindowChrome.IsHitTestVisibleInChrome="True"><StackPanel Orientation="Horizontal"><RadioButton Name="homeNav" Content="Home" Style="{StaticResource NavButton}" IsChecked="True" GroupName="Navigation"/><RadioButton Name="toolsNav" Style="{StaticResource NavButton}" GroupName="Navigation"><StackPanel Orientation="Horizontal"><TextBlock Text="Tools"/><TextBlock Name="toolsCount" Foreground="{DynamicResource Muted}" Margin="4,0,0,0"/></StackPanel></RadioButton></StackPanel></Border>
  <StackPanel Grid.Column="5" Orientation="Horizontal" VerticalAlignment="Center" shell:WindowChrome.IsHitTestVisibleInChrome="True"><Button Name="minimize" Content="—" Width="42" Style="{StaticResource LinkButton}" Foreground="{DynamicResource Muted}" AutomationProperties.Name="Minimize"/><Button Name="maximize" Content="□" Width="42" Style="{StaticResource LinkButton}" Foreground="{DynamicResource Muted}" AutomationProperties.Name="Maximize"/><Button Name="closeWindow" Content="×" Width="42" Style="{StaticResource LinkButton}" Foreground="{DynamicResource Muted}" AutomationProperties.Name="Close"/></StackPanel>
 </Grid>
 <ScrollViewer Name="pageScroll" Grid.Row="1" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Disabled" Padding="24,0,24,8">
 <Grid Name="page" MaxWidth="820" HorizontalAlignment="Stretch" VerticalAlignment="Top">
 <StackPanel>
  <StackPanel Orientation="Horizontal" Margin="0,10,0,16"><TextBlock Name="pageTitle" Text="Overview" FontSize="28" FontWeight="SemiBold"/><TextBlock Name="pageSubtitle" Text="Connect your AI apps to SWSD" Foreground="{DynamicResource Muted}" Margin="12,0,0,4" VerticalAlignment="Bottom"/></StackPanel>
   <Border Name="toast" CornerRadius="6" Padding="14,10" Margin="0,0,0,12" Visibility="Collapsed"><TextBlock Name="status" TextWrapping="Wrap" FontWeight="Medium"/></Border>
  <StackPanel Name="homePage">
   <Border Name="dashboard" Style="{StaticResource CardStyle}"><StackPanel>
    <Grid Height="96" Margin="22,0"><Grid.ColumnDefinitions><ColumnDefinition Width="60"/><ColumnDefinition Width="18"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions><Grid Width="60" Height="60"><Ellipse Stroke="{DynamicResource Divider}" StrokeThickness="5" Margin="4"/><Path Name="healthArc" Stroke="{DynamicResource Success}" StrokeThickness="5" StrokeStartLineCap="Round" StrokeEndLineCap="Round"/><TextBlock Name="healthCount" FontSize="14" FontWeight="SemiBold" HorizontalAlignment="Center" VerticalAlignment="Center"/></Grid><StackPanel Grid.Column="2" VerticalAlignment="Center"><TextBlock Name="healthTitle" FontSize="18" FontWeight="SemiBold"/><TextBlock Name="healthDescription" Style="{StaticResource Description}"/></StackPanel></Grid>
    <UniformGrid Name="statusGrid" Columns="3">$dashboardXaml</UniformGrid>
   </StackPanel></Border>
   <Border Name="setup" Style="{StaticResource CardStyle}"><StackPanel><ProgressBar Name="setupProgress" Height="3" Margin="20,16,20,0" Maximum="3" Foreground="{DynamicResource AccentForeground}" Background="{DynamicResource Divider}"/><UniformGrid Columns="3">
    <StackPanel Margin="20,18"><Border Name="step1Circle" Style="{StaticResource Chip}" Width="24" Height="24" HorizontalAlignment="Left"><TextBlock Name="step1Number" Text="1" HorizontalAlignment="Center"/></Border><TextBlock Text="Install tools" FontSize="14" FontWeight="SemiBold" Margin="0,12,0,3"/><TextBlock Name="step1Description" Style="{StaticResource Description}" TextWrapping="Wrap" MinHeight="36"/><Button Name="setupInstall" Content="Install tools" HorizontalAlignment="Left" Margin="0,12,0,0" Style="{StaticResource PrimaryButton}"/></StackPanel>
    <StackPanel Margin="20,18"><Border Name="step2Circle" TextElement.Foreground="{DynamicResource AccentChipText}" Style="{StaticResource Chip}" Width="24" Height="24" HorizontalAlignment="Left"><TextBlock Text="2" HorizontalAlignment="Center"/></Border><TextBlock Text="Connect account" FontSize="14" FontWeight="SemiBold" Margin="0,12,0,3"/><TextBlock Text="Choose your region and paste your JSON Web Token." Style="{StaticResource Description}" TextWrapping="Wrap" MinHeight="36"/><TextBlock Name="step2State" Text="●  In progress" FontSize="11.5" Foreground="{DynamicResource AccentForeground}" Margin="0,16,0,0"/></StackPanel>
    <StackPanel Margin="20,18"><Border Style="{StaticResource Chip}" Width="24" Height="24" BorderThickness="1" BorderBrush="{DynamicResource ControlBorder}" HorizontalAlignment="Left"><TextBlock Text="3" HorizontalAlignment="Center"/></Border><TextBlock Text="Choose profile" FontSize="14" FontWeight="SemiBold" Margin="0,12,0,3"/><TextBlock Text="Choose what your AI apps are allowed to do." Style="{StaticResource Description}" TextWrapping="Wrap" MinHeight="36"/><TextBlock Text="Up next" FontSize="11.5" Foreground="{DynamicResource Muted}" Margin="0,16,0,0"/></StackPanel>
   </UniformGrid></StackPanel></Border>
   <TextBlock Name="accountHeading" Text="Account" Style="{StaticResource Section}"/>
   <Border Style="{StaticResource CardStyle}"><StackPanel>$regionXaml $tokenXaml $profileXaml</StackPanel></Border>
   <Border Name="helpSpacer" Height="400" Visibility="Collapsed"/>
   <Grid Margin="2,20,0,8"><TextBlock Text="Maintenance" FontSize="14" FontWeight="SemiBold" VerticalAlignment="Center"/><StackPanel Orientation="Horizontal" HorizontalAlignment="Right"><Button Name="reportBug" Content="Report a bug" Style="{StaticResource LinkButton}" Height="24"/><Button Name="requestFeature" Content="Request a feature" Style="{StaticResource LinkButton}" Height="24" Margin="16,0,0,0"/></StackPanel></Grid>
   <Border Style="{StaticResource CardStyle}"><StackPanel>$updateXaml $diagnosticsXaml $repairXaml $appearanceXaml</StackPanel></Border>
   <StackPanel Name="credentialActions" Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,4,0,-12"><Button Name="remove" Content="Remove saved JSON Web Token" Style="{StaticResource LinkButton}" Height="24" FontSize="11.5"/></StackPanel>
   <StackPanel Name="actionDetails" Margin="0,8,0,0"><ProgressBar Name="progressBar" Height="3" IsIndeterminate="True" Foreground="{DynamicResource AccentForeground}" Visibility="Collapsed" AutomationProperties.Name="Progress"/><StackPanel Orientation="Horizontal"><Button Name="showDetails" Content="Show details" Style="{StaticResource LinkButton}" Visibility="Collapsed"/><Button Name="nodeInstallButton" Content="Install Node.js" Style="{StaticResource LinkButton}" Visibility="Collapsed" Margin="12,0,0,0"/></StackPanel><TextBlock Name="errorDetails" TextWrapping="Wrap" Style="{StaticResource Description}" Visibility="Collapsed"/></StackPanel>
   <Grid Margin="2,12,2,0"><Button Name="findToken" Content="Where do I find my token? ↗" Style="{StaticResource LinkButton}" HorizontalAlignment="Right" Height="20" FontSize="12"/></Grid>
  </StackPanel>
  <StackPanel Name="toolsPage" Visibility="Collapsed">
   <Grid><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="12"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions><Grid><TextBox Name="search" Height="36" Padding="36,7,60,7" AutomationProperties.Name="Search tools"/><TextBlock Text="⌕" FontSize="20" Foreground="{DynamicResource Muted}" Margin="12,0,0,2" VerticalAlignment="Center" IsHitTestVisible="False"/><TextBlock Name="searchPlaceholder" Text="Search tools" Foreground="{DynamicResource Muted}" Margin="36,0,0,0" VerticalAlignment="Center" IsHitTestVisible="False"/><TextBlock Text="Ctrl+F" FontSize="11" Margin="0,0,12,0" HorizontalAlignment="Right" VerticalAlignment="Center" Foreground="{DynamicResource Muted}" IsHitTestVisible="False"/></Grid><ComboBox Name="toolsProfile" Grid.Column="2" Height="36" AutomationProperties.Name="Tools profile"/></Grid>
   <Border Style="{StaticResource CardStyle}" Margin="0,12,0,0" Padding="16">
    <Expander Name="profileBuilder" Header="Custom profiles" Foreground="{DynamicResource Text}">
     <StackPanel Margin="0,12,0,0">
      <TextBlock Text="Choose the tools available to your AI apps, then save your profile." Style="{StaticResource Description}" TextWrapping="Wrap"/>
      <Grid Margin="0,10,0,8"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="12"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions><StackPanel><TextBlock Text="Name" Style="{StaticResource Description}"/><TextBox Name="customName" MaxLength="80" Height="34" AutomationProperties.Name="Custom profile name"/></StackPanel><StackPanel Grid.Column="2"><TextBlock Text="Description (optional)" Style="{StaticResource Description}"/><TextBox Name="customDescription" MaxLength="2048" Height="34" AutomationProperties.Name="Custom profile description"/></StackPanel></Grid>
      <WrapPanel Margin="0,0,0,10"><Button Name="newCustom" Content="New"/><Button Name="saveCustom" Content="Save profile" Style="{StaticResource PrimaryButton}" Margin="8,0,0,0"/><Button Name="renameCustom" Content="Rename" Margin="8,0,0,0"/><Button Name="deleteCustom" Content="Delete" Margin="8,0,0,0"/><Button Name="exportCustom" Content="Export JSON" Margin="8,0,0,0"/><Button Name="importCustom" Content="Import JSON" Margin="8,0,0,0"/></WrapPanel>
      <TextBlock Name="customCount" Style="{StaticResource Description}" Margin="0,0,0,8"/>
      <ScrollViewer Height="270" VerticalScrollBarVisibility="Auto"><StackPanel Name="customTools"/></ScrollViewer>
     </StackPanel>
    </Expander>
   </Border>
   <WrapPanel Name="areaFilters" Margin="0,12,0,0"/>
   <WrapPanel Name="toolLegend" Margin="0,12,0,0"/>
   <StackPanel Name="toolGroups"/>
   <Border Name="toolDetail" Style="{StaticResource CardStyle}" Margin="0,10,0,0" Padding="16"><Grid><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="18"/><ColumnDefinition Width="320"/></Grid.ColumnDefinitions><StackPanel><TextBlock Name="detailTitle" FontSize="16" FontWeight="SemiBold"/><TextBlock Name="detailId" FontFamily="Consolas" FontSize="11" Foreground="{DynamicResource Muted}" Margin="0,6,0,8"/><StackPanel Orientation="Horizontal"><ContentControl Name="detailBadge" Margin="0,0,8,0"/><TextBlock Name="detailProfiles" Style="{StaticResource Description}" TextWrapping="Wrap"/></StackPanel><TextBlock Name="detailDescription" Style="{StaticResource Description}" TextWrapping="Wrap" Margin="0,12,0,0"/><Border Name="deleteNotice" Background="{DynamicResource ErrorBackground}" CornerRadius="6" Padding="12,10" Margin="0,12,0,0" Visibility="Collapsed"><TextBlock Text="Destructive. Available in Operations. Preview the record first, then confirm its ID before deleting." Foreground="{DynamicResource ErrorText}" FontSize="12.5" TextWrapping="Wrap"/></Border></StackPanel><StackPanel Grid.Column="2"><TextBlock Text="Example prompt" FontWeight="SemiBold" FontSize="12"/><Border Background="{DynamicResource IconBackground}" CornerRadius="6" Padding="12,10" Margin="0,6,0,10"><TextBlock Name="examplePrompt" FontSize="12.5" TextWrapping="Wrap"/></Border><Button Name="copyPrompt" Content="Copy prompt" Style="{StaticResource PrimaryButton}"/><Button Name="switchProfile" Content="Switch to Operations" Margin="0,8,0,0" Visibility="Collapsed"/></StackPanel></Grid></Border>
   <Expander Name="otherTools" IsExpanded="False" Foreground="{DynamicResource Muted}" Margin="0,14,0,0" Padding="12"><StackPanel Name="lockedTools"/></Expander>
  </StackPanel>
  <StackPanel Name="whatsNewPage" Visibility="Collapsed"><Grid Margin="0,0,0,12"><Button Name="closeWhatsNew" Content="Back to Home" HorizontalAlignment="Right"/></Grid><Border Style="{StaticResource CardStyle}" Padding="22"><StackPanel Name="releaseNoteContent"/></Border></StackPanel>
 </StackPanel>
 <Border Name="jwtFlyout" Style="{StaticResource CardStyle}" Background="{DynamicResource Flyout}" Padding="16,14" Margin="20,218,78,0" VerticalAlignment="Top" Visibility="Collapsed" Panel.ZIndex="10" AutomationProperties.Name="Get your JSON Web Token in SWSD"><StackPanel>
  <Grid><TextBlock Text="Get your JSON Web Token in SWSD" FontSize="13.5" FontWeight="SemiBold"/><Button Name="closeHelp" Content="×" Style="{StaticResource HelpButton}" HorizontalAlignment="Right" AutomationProperties.Name="Close JSON Web Token help"/></Grid>
  <TextBlock Text="Only SWSD administrators can generate tokens. Tokens keep working if the user’s email or password changes." Style="{StaticResource Description}" TextWrapping="Wrap" Margin="0,6,0,8"/>
  <TextBlock TextWrapping="Wrap" FontSize="12.5" Foreground="{DynamicResource Muted}" LineHeight="19" Margin="18,0,0,10">1. Go to <Bold>Setup → Users &amp; Groups → Users</Bold> and open your <Bold>User detail</Bold> page (not your User Profile Card). You can search your name.<LineBreak/>2. If you don’t see a JSON Web Token, choose <Bold>Actions → Generate JSON Web Token</Bold> (admin rights required).<LineBreak/>3. Under <Bold>JSON Web Token</Bold>, choose <Bold>Copy</Bold> (or <Bold>Show Token</Bold>, then Copy).</TextBlock>
  <Grid Margin="0,4,0,0"><Grid.ColumnDefinitions><ColumnDefinition Width="1.55*"/><ColumnDefinition Width="14"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions><Border CornerRadius="8" BorderThickness="1" BorderBrush="{DynamicResource Border}" Background="{DynamicResource Card}"><StackPanel><Image Name="jwtProfileImage" Height="300" Stretch="Uniform" VerticalAlignment="Top"/><Border Background="{DynamicResource Control}" Padding="8,6"><TextBlock Text="1 · User detail · JSON Web Token" FontSize="11" Foreground="{DynamicResource Muted}" TextWrapping="Wrap"/></Border></StackPanel></Border><Border Grid.Column="2" CornerRadius="8" BorderThickness="1" BorderBrush="{DynamicResource Border}" Background="{DynamicResource Card}"><StackPanel><Image Name="jwtActionsImage" Height="300" Stretch="Uniform" VerticalAlignment="Top"/><Border Background="{DynamicResource Control}" Padding="8,6"><TextBlock Text="2 · Actions → Generate (only if none shown)" FontSize="11" Foreground="{DynamicResource Muted}" TextWrapping="Wrap"/></Border></StackPanel></Border></Grid>
 </StackPanel></Border>
 </Grid></ScrollViewer>
</Grid>
</Window>
"@
$xml = [xml]$xaml
$reader = New-Object Xml.XmlNodeReader $xml
try { $script:form = [Windows.Markup.XamlReader]::Load($reader) } finally { $reader.Close() }
foreach ($element in $xml.SelectNodes('//*[@Name]')) { Set-Variable -Name $element.Name -Value $form.FindName($element.Name) -Scope Script }
$versionPill.Text = $script:SwsdPackageVersion
$toolsCount.Text = [string]$script:SwsdCatalog.Count
$tokenHelp.Visibility = 'Visible'
$appRoot.LayoutTransform = New-Object Windows.Media.ScaleTransform($script:SwsdUiScale, $script:SwsdUiScale)
function Get-SwsdSelectedProfileIndex($Settings) {
    for ($i=0; $i -lt $script:SwsdPickerProfiles.Count; $i++) {
        $p=$script:SwsdPickerProfiles[$i]
        if (($Settings.profile -eq 'custom' -and $p.id.StartsWith('custom:') -and $p.profileFile -eq $Settings.profileFile) -or $p.id -eq (Resolve-SwsdProfileId $Settings.profile)) { return $i }
    }
    return 1
}
function Update-SwsdProfilePickers {
    $wasSyncing=$script:SwsdSyncing; $script:SwsdSyncing=$true
    try {
        $script:SwsdPickerProfiles = @(Get-SwsdPickerProfiles | ForEach-Object { [pscustomobject]$_ })
        $current=Get-SwsdSettings
        if ($current.profile -eq 'custom' -and -not @($script:SwsdPickerProfiles | Where-Object {$_.PSObject.Properties['profileFile'] -and $_.profileFile -eq $current.profileFile}).Count) {
            $script:SwsdPickerProfiles += [pscustomobject](Get-SwsdProfileRow custom)
        }
        # Share display strings: WPF's template cannot bind PSObject note properties.
        $script:SwsdPickerNames=@($script:SwsdPickerProfiles | ForEach-Object {[string]$_.name})
        $profile.ItemsSource=$script:SwsdPickerNames; $toolsProfile.ItemsSource=$script:SwsdPickerNames
        $profile.SelectedIndex=Get-SwsdSelectedProfileIndex (Get-SwsdSettings)
        $toolsProfile.SelectedIndex=$profile.SelectedIndex
    } finally { $script:SwsdSyncing=$wasSyncing }
}
Update-SwsdProfilePickers
$savedSettings = Get-SwsdSettings
$region.SelectedIndex = if ($savedSettings.baseUrl -eq 'https://apieu.samanage.com') { 1 } else { 0 }
$profile.SelectedIndex = Get-SwsdSelectedProfileIndex $savedSettings
$toolsProfile.SelectedIndex = $profile.SelectedIndex
function Set-SwsdAppearanceSelection([string]$Id) {
    $Id=Resolve-SwsdThemeId $Id
    $appearance.SelectedItem=@($appearance.Items | Where-Object {$_ -is [Windows.Controls.ComboBoxItem] -and $_.Tag -eq $Id})[0]
}
Set-SwsdAppearanceSelection $savedSettings.theme
foreach ($pair in @(@($jwtProfileImage,'jwt-help-profile-crop.png'),@($jwtActionsImage,'jwt-help-actions-crop.png'))) {
    $bitmap = New-Object Windows.Media.Imaging.BitmapImage
    $bitmap.BeginInit(); $bitmap.CacheOption = 'OnLoad'
    $bitmap.UriSource = New-Object Uri (Join-Path $script:SwsdAssetRoot ('jwt-help/' + $pair[1]))
    $bitmap.EndInit(); $bitmap.Freeze(); $pair[0].Source = $bitmap
}

function Set-SwsdTheme {
    $mode = if ($appearance.SelectedItem -is [Windows.Controls.ComboBoxItem]) {[string]$appearance.SelectedItem.Tag} else {'system'}
    $script:SwsdThemeId = $mode
    $script:SwsdUseMica = $mode -in @('system','light','dark')
    $dark = $false
    if ($mode -eq 'dark') { $dark = $true }
    elseif ($mode -eq 'system') {
        $personalize = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction SilentlyContinue
        if ($personalize -and $personalize.PSObject.Properties['AppsUseLightTheme']) { $dark = ([int]$personalize.AppsUseLightTheme -eq 0) }
    }
    # Keep existing light/dark capture overrides; named choices always show their own palette.
    if ($script:SwsdUseMica) {
        if ($env:SWSD_THEME -eq 'dark') { $dark = $true } elseif ($env:SWSD_THEME -eq 'light') { $dark = $false }
    }
    $resolved = if ($script:SwsdUseMica) {if ($dark) {'dark'} else {'light'}} else {$mode}
    $palette = Get-SwsdThemePalette $resolved
    $script:SwsdResolvedThemeId = $resolved
    $dark = (Get-SwsdColorLuminance $palette.Canvas) -lt 0.5
    $script:SwsdDarkMode = $dark
    foreach ($key in $palette.Keys) { $form.Resources[$key] = [Windows.Media.BrushConverter]::new().ConvertFromString($palette[$key]) }
    $appRoot.SetResourceReference([Windows.Controls.Panel]::BackgroundProperty,'Canvas')
    $form.SetResourceReference([Windows.Controls.Control]::BackgroundProperty,'Canvas')
    if ($script:SwsdUseMica) {
        $wash = New-Object Windows.Media.LinearGradientBrush
        $wash.StartPoint = New-Object Windows.Point(0,0); $wash.EndPoint = New-Object Windows.Point(0,1)
        $wash.GradientStops.Add((New-Object Windows.Media.GradientStop ([Windows.Media.ColorConverter]::ConvertFromString($palette.WashLeft)),0))
        $wash.GradientStops.Add((New-Object Windows.Media.GradientStop ([Windows.Media.ColorConverter]::ConvertFromString($palette.Canvas)),0.44))
        $wash.GradientStops.Add((New-Object Windows.Media.GradientStop ([Windows.Media.ColorConverter]::ConvertFromString($palette.Canvas)),1))
        $appRoot.Background = $wash
    }
    $appearanceDescription.Text = if ($mode -eq 'system') { 'Follows Windows · currently ' + $(if ($dark) {'dark'} else {'light'}) } else { $script:SwsdThemes[$mode].name + ' appearance' }
    if ($script:SwsdHandle -ne [IntPtr]::Zero) {
        [SwsdDesktop.Windows]::ApplyDarkMode($script:SwsdHandle, $dark)
        Set-SwsdBackdrop
    }
}
function Set-SwsdBackdrop {
    $script:SwsdMicaEnabled=$false
    $target=[Windows.Interop.HwndSource]::FromHwnd($script:SwsdHandle).CompositionTarget
    if ($script:SwsdUseMica) {$script:SwsdMicaEnabled=[SwsdDesktop.Windows]::ApplyMicaBackdrop($script:SwsdHandle)}
    else {[SwsdDesktop.Windows]::ClearBackdrop($script:SwsdHandle)}
    if ($script:SwsdMicaEnabled) {
        $target.BackgroundColor=[Windows.Media.Colors]::Transparent
        $form.Background=[Windows.Media.Brushes]::Transparent
        # Keep an opaque palette fallback on older Windows. A subtle tint lets the
        # real DWM Mica show through on supported desktops; captures use an opaque
        # canvas so the PNG does not depend on the desktop wallpaper.
        $appRoot.Background.Opacity=if ($ValidateWindow) {1} else {0.92}
    } else {
        $target.BackgroundColor=$form.Resources['Canvas'].Color
        $form.SetResourceReference([Windows.Controls.Control]::BackgroundProperty,'Canvas')
    }
}
function Set-SwsdStatus {
    param([ValidateSet('success','warn','error','info')][string]$Kind = 'info', [string]$Text)
    $key = switch ($Kind) { success {'SuccessText'} warn {'WarningText'} error {'ErrorText'} default {'AccentChipText'} }
    $background = switch ($Kind) { success {'SuccessBackground'} warn {'WarningBackground'} error {'ErrorBackground'} default {'IconBackground'} }
    $status.Text = $Text; $status.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty,$key)
    $toast.SetResourceReference([Windows.Controls.Border]::BackgroundProperty,$background); $toast.Visibility = 'Visible'
}
function Format-SwsdFriendlyError([Exception]$Exception) {
    $message = $Exception.GetBaseException().Message
    $friendly = 'The action could not be completed. Try again, or ask IT to check the SWSD setup.'
    switch -Regex ($message) {
        '^Profile JSON:|^Your custom profile' { $friendly=$message; break }
        'Node\.js.*required|Node\.js.*newer' { $friendly = 'Node.js is missing or unsupported. Ask IT to install the supported Node.js version.'; break }
        '^Windows Package Manager is unavailable' { $friendly = 'Windows Package Manager is unavailable. Ask IT to install the supported Node.js version.'; break }
        '^Node\.js installation timed out' { $friendly = 'Node.js installation timed out. Ask IT to check Windows Package Manager.'; break }
        '^Node\.js installation failed' { $friendly = 'Node.js installation failed. Ask IT to install the supported Node.js version.'; break }
        'npm is missing' { $friendly = 'npm is missing from this Node.js installation. Ask IT to repair Node.js.'; break }
        '^Tool installation failed: The new tools could not be activated\.' { $friendly = 'The new tools could not be activated. Your previous tools remain available. Try again.'; break }
        '^Tool installation failed: The (downloaded|installed) tools did not pass' { $friendly = 'The update did not pass version and integrity checks. Your previous tools remain available. Try again later.'; break }
        'timed out' { $friendly = 'Installation timed out. Check npm registry access and retry.'; break }
        'Tool installation failed|npm registry' { $friendly = 'Tool installation failed. Ask IT to check npm registry access and proxy settings.'; break }
        '\(401\)' { $friendly = 'SolarWinds rejected this token. Check that you copied the full JSON Web Token.'; break }
        '\(403\)' { $friendly = 'SolarWinds denied incident access. Ask your SWSD administrator to review your account permissions.'; break }
        'Connection failed|network|DNS|proxy' { $friendly = 'Connection failed. Check network access, proxy settings, and the selected SWSD region.'; break }
        '^No token is saved' { $friendly = 'No JSON Web Token is saved. Paste one into the masked field, then select Test.'; break }
        '^Paste your' { $friendly = 'Paste your JSON Web Token into the masked field first.'; break }
        'recipe does not match|version does not match|installation is incomplete' { $friendly = 'The tools need repair. Ask IT to sync the reviewed plugin package, then select Repair.'; break }
    }
    if ($Exception.GetBaseException() -is [ComponentModel.Win32Exception] -and $Exception.GetBaseException().NativeErrorCode -eq 1312) { $friendly = 'Windows Credential Manager is unavailable in this session. Open setup from your signed-in Windows desktop.' }
    if ($ValidateHandlers -and $message -in @('mock install failure','synthetic handler crash')) { $friendly = $message }
    return @{ Friendly=$friendly; Technical=('Error type: ' + $Exception.GetBaseException().GetType().Name + '. ' + $friendly) }
}
function Set-SwsdBusy([bool]$Busy) {
    foreach ($name in @('install','setupInstall','checkUpdates','nodeInstallButton','test','remove','region','tokenBox','profile','toolsProfile','appearance','copyDiagnostics','copyPrompt','switchProfile','profileBuilder')) { (Get-Variable $name -Scope Script -ValueOnly).IsEnabled = -not $Busy }
    $progressBar.Visibility = if ($Busy) { 'Visible' } else { 'Collapsed' }
}
function Show-SwsdError([Exception]$Exception) {
    $info = Format-SwsdFriendlyError $Exception
    Set-SwsdStatus -Kind error -Text $info.Friendly
    $errorDetails.Text = $info.Technical; $showDetails.Visibility = 'Visible'
}
function Invoke-SwsdSafe {
    param([string]$Source = 'handler', [Parameter(Mandatory,Position=0)][scriptblock]$Body)
    try { & $Body } catch {
        $info = Format-SwsdFriendlyError $_.Exception
        $script:SwsdHandlerErrors += "${Source}: $($info.Friendly)"
        try { Add-Content -LiteralPath $script:SwsdDiagnosticsLogPath -Value ((Get-Date -Format u) + ' [' + $Source + '] ' + $info.Friendly) } catch {}
        Set-SwsdStatus -Kind error -Text ('Something went wrong: ' + $info.Friendly)
        if ($null -eq $script:SwsdInstallWorker) { Set-SwsdBusy $false }
    }
}
function Confirm-SwsdRemove { return [Windows.MessageBox]::Show($form, 'Remove this computer''s saved SWSD JSON Web Token? Fully quit your AI app afterwards to end running connections. This does not revoke the token in SWSD.', 'Remove saved JSON Web Token', 'YesNo', 'Question') }
function Confirm-SwsdNodeInstall { return [Windows.MessageBox]::Show($form, 'Install the supported Node.js version using Windows Package Manager? Windows may ask for administrator approval. Reopen setup after installation.', 'Install Node.js', 'YesNo', 'Question') }
function Test-SwsdToolInProfile($Item, [string]$Id) {
    if ($Id -eq 'custom' -or $Id.StartsWith('custom:')) {
        $row = if ($Id -eq 'custom') {$script:SwsdPickerProfiles[$profile.SelectedIndex]} else {$script:SwsdPickerProfiles | Where-Object {$_.id -eq $Id} | Select-Object -First 1}
        return $row -and $row.PSObject.Properties['tools'] -and @($row.tools) -ccontains $Item.name
    }
    $resolved = Resolve-SwsdProfileId $Id
    return $Item.profiles -contains $resolved -or ($resolved -eq 'operations' -and $Item.profiles -contains 'full')
}
function Get-SwsdProfileTools([string]$Id) { return @($script:SwsdCatalog | Where-Object { Test-SwsdToolInProfile $_ $Id }) }
function Get-SwsdCatalogNotInProfile([string]$Id) { return @($script:SwsdCatalog | Where-Object { -not (Test-SwsdToolInProfile $_ $Id) }) }
function Test-SwsdUpdateAvailable {
    param([string]$Installed = (Get-SwsdStatus).installedVersion)
    return $script:SwsdUpdateState -eq 'checked' -and (Compare-SwsdVersion -Installed $Installed -Latest $script:SwsdLatestVersion) -eq 'update'
}
function Set-SwsdCell([string]$Id, [string]$Value, [string]$Chip, [string]$Kind) {
    (Get-Variable "${Id}Value" -ValueOnly -Scope Script).Text = $Value
    $label = Get-Variable "${Id}ChipText" -ValueOnly -Scope Script
    $key=if ($Kind -eq 'Accent') {'AccentChipText'} else {$Kind+'Text'}
    $label.Text = $Chip; $label.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty,$key)
    (Get-Variable "${Id}Chip" -ValueOnly -Scope Script).SetResourceReference([Windows.Controls.Border]::BackgroundProperty,($Kind+'Background'))
}
function Update-SwsdDashboard {
    $s = Get-SwsdStatus
    $selection = Get-SwsdProfileRow $s.profile
    $count = @(Get-SwsdProfileTools $s.profile).Count
    Set-SwsdCell 'Node' $(if ($s.nodeVersion) {'v' + $s.nodeVersion} else {'Not installed'}) $(if ($s.nodeSupported) {'✓ OK'} else {'Needed'}) $(if ($s.nodeSupported) {'Success'} else {'Warning'})
    Set-SwsdCell 'Tools' $(if ($s.installedVersion) {'swsd-mcp ' + $s.installedVersion} else {'Not installed'}) $(if ($s.toolsInstalled) {'✓ OK'} elseif ($s.installedVersion) {'Repair'} else {'Needed'}) $(if ($s.toolsInstalled) {'Success'} else {'Warning'})
    $verified = $script:SwsdVerified -and $s.credentialSaved
    $identityText = if ($verified -and $script:SwsdIdentity) { $script:SwsdIdentity } elseif ($verified) {'Verified connection'} elseif ($s.credentialSaved) {'Saved · not verified'} else {'Not verified'}
    Set-SwsdCell 'Token' $identityText $(if ($verified) {'✓ Verified'} elseif ($script:SwsdTokenError) {'× Invalid'} else {'Not verified'}) $(if ($verified) {'Success'} elseif ($script:SwsdTokenError) {'Error'} else {'Warning'})
    Set-SwsdCell 'Region' $(if ($s.region -eq 'EU') {'Europe'} else {'United States'}) ('● ' + $s.region) 'Accent'
    Set-SwsdCell 'Profile' ($selection.name + ' · ' + $count + ' tools') '● Active' 'Accent'
    $updateValue = 'Not checked'; $updateChip='Check'; $updateKind='Accent'
    switch ($script:SwsdUpdateState) {
        'checking' { $updateValue='Checking…'; $updateChip='Checking' }
        'offline' { $updateValue='Unavailable'; $updateChip='Offline'; $updateKind='Warning' }
        'checked' {
            switch (Compare-SwsdVersion -Installed $s.installedVersion -Latest $script:SwsdLatestVersion) {
                'current' { $updateValue='Up to date'; $updateChip='✓ OK'; $updateKind='Success' }
                'update' { $updateValue=$script:SwsdLatestVersion + ' available'; $updateChip='● Update'; $updateKind='Warning' }
                'newer' { $updateValue='Newer installed'; $updateChip='Ahead' }
                default { $updateValue=$script:SwsdLatestVersion + ' available'; $updateChip='Install first' }
            }
        }
    }
    Set-SwsdCell 'Update' $updateValue $updateChip $updateKind
    $updateAvailable = Test-SwsdUpdateAvailable -Installed $s.installedVersion
    $checkUpdates.Content = if ($updateAvailable) {'Update'} else {'Check now'}
    if ($updateAvailable) { $checkUpdates.Style=$form.Resources['PrimaryButton'] } else { $checkUpdates.ClearValue([Windows.FrameworkElement]::StyleProperty) }
    $updatesDescription.Text = switch ($script:SwsdUpdateState) { 'checking' {'Checking for updates…'} 'offline' {'Could not check · try again'} 'checked' { if ($updateAvailable) { 'Version ' + $script:SwsdLatestVersion + ' is available' } else { $updateValue } } default {'Check for a newer version of SWSD tools'} }
    $profileDescription.Text = $selection.name + ' · ' + $selection.description + ' · ' + $count + ' tools'
    $profileDescription.ToolTip = $selection.description
    $tokenDescription.Text = if ($script:SwsdTokenError) {'Couldn''t verify · check the token and try again'} elseif ($verified) {'Verified just now'} else {'Select Test to verify'}
    $tokenPlaceholder.Text = if ($s.credentialSaved) {'••••••••'} else {'Paste token'}
    $tokenPlaceholder.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty,$(if ($verified) {'SuccessForeground'} else {'Muted'}))
    $tokenVerified.Visibility=if ($verified -and $tokenBox.SecurePassword.Length -eq 0) {'Visible'} else {'Collapsed'}
    $credentialActions.Visibility = if ($s.credentialSaved) {'Visible'} else {'Collapsed'}
    $tokenBox.SetResourceReference([Windows.Controls.Control]::BorderBrushProperty,$(if ($script:SwsdTokenError) {'ErrorForeground'} else {'ControlBorder'}))
    $firstRun = -not $s.toolsInstalled -or (-not $s.credentialSaved -and -not $script:SwsdTokenError)
    $dashboard.Visibility = if ($firstRun -or $script:SwsdHelpOpen) {'Collapsed'} else {'Visible'}
    $setup.Visibility = if ($firstRun -and -not $script:SwsdHelpOpen) {'Visible'} else {'Collapsed'}
    $pageTitle.Text = if ($toolsNav.IsChecked) {'Tools'} elseif ($firstRun -and -not $script:SwsdHelpOpen) {'Set up'} else {'Overview'}
    $readySteps = [int]$s.nodeSupported + [int]$s.toolsInstalled
    $setupProgress.Value = if ($readySteps -eq 2) {1.2} else {0.1}
    $step1Description.Text = if ($readySteps -eq 2) {'Tools and Node.js are ready.'} elseif (-not $s.nodeSupported) {'Install the supported Node.js version, then install SWSD tools.'} else {'Install SWSD tools on this PC.'}
    $setupInstall.Content = if ($readySteps -eq 2) {'✓ Done'} elseif (-not $s.nodeSupported) {'Install Node.js'} else {'Install tools'}
    $setupInstall.Height = if ($readySteps -eq 2) {22} else {32}
    $setupInstall.FontSize = if ($readySteps -eq 2) {11.5} else {13}
    $setupInstall.SetResourceReference([Windows.Controls.Control]::BackgroundProperty,$(if ($readySteps -eq 2) {'SuccessBackground'} else {'Accent'}))
    $setupInstall.SetResourceReference([Windows.Controls.Control]::ForegroundProperty,$(if ($readySteps -eq 2) {'SuccessText'} else {'AccentText'}))
    $step1Number.Text = if ($readySteps -eq 2) {'✓'} else {'1'}
    $step1Number.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty,$(if ($readySteps -eq 2) {'SuccessText'} else {'AccentChipText'}))
    $step1Circle.SetResourceReference([Windows.Controls.Border]::BackgroundProperty,$(if ($readySteps -eq 2) {'SuccessBackground'} else {'IconBackground'}))
    $step2Circle.SetResourceReference([Windows.Controls.Border]::BackgroundProperty,'IconBackground')
    $healthTitle.Text = if ($verified -and $s.toolsInstalled) {'Ready to use'} else {'Action needed'}
    $healthDescription.Text = if ($script:SwsdTokenError) {'Update your JSON Web Token to finish connecting'} elseif (-not $verified) {'Test your JSON Web Token to verify the connection'} elseif ($updateKind -eq 'Warning') {'One update available'} else {'Connect your AI apps to SWSD'}
    $good = [int]$s.nodeSupported + [int]$s.toolsInstalled + [int]$verified + 2 + [int]($updateKind -eq 'Success')
    $healthCount.Text = "$good/6"
    $angle = [Math]::Min(359.9, 360 * $good / 6.0); $rad = $angle * [Math]::PI / 180
    $endX = 30 + 26 * [Math]::Sin($rad); $endY = 30 - 26 * [Math]::Cos($rad)
    $arcData = 'M30,4 A26,26 0 ' + $(if ($angle -gt 180) {'1'} else {'0'}) + ',1 ' + $endX.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture) + ',' + $endY.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)
    $healthArc.Data = [Windows.Media.Geometry]::Parse($arcData)
    $healthArc.SetResourceReference([Windows.Shapes.Shape]::StrokeProperty,$(if ($script:SwsdTokenError) {'ErrorForeground'} else {'SuccessForeground'}))
    $nodeInstallButton.Visibility = if ($s.nodeSupported) {'Collapsed'} else {'Visible'}
    $repairRow.Visibility = if (-not $firstRun -and ($s.toolsInstalled -or $s.installedVersion)) {'Visible'} else {'Collapsed'}
}

function New-SwsdFragment([string]$Markup) {
    $Markup = [regex]::Replace($Markup, '^<(\w+)', '<$1 xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"', 1)
    return [Windows.Markup.XamlReader]::Parse($Markup)
}
function New-SwsdBadgeXaml([string]$Kind) {
    $label = switch ($Kind) { read {'Read'} edit {'Edit'} delete {'Delete'} }
    $color = switch ($Kind) { read {'Muted'} edit {'AccentChipText'} delete {'ErrorText'} }
    $background = switch ($Kind) { read {'Control'} edit {'IconBackground'} delete {'ErrorBackground'} }
    $glyph = if ($Kind -eq 'delete') {'<TextBlock Text="&#xE74D;" FontFamily="Segoe MDL2 Assets" Margin="0,0,4,0"/>'} else {''}
    return "<Border Background=`"{DynamicResource $background}`" BorderBrush=`"{DynamicResource Border}`" BorderThickness=`"1`" CornerRadius=`"4`" Padding=`"6,2`" HorizontalAlignment=`"Right`" VerticalAlignment=`"Center`"><StackPanel Orientation=`"Horizontal`" TextElement.Foreground=`"{DynamicResource $color}`" TextElement.FontSize=`"11`">$glyph<TextBlock Text=`"$label`"/></StackPanel></Border>"
}
foreach ($kind in @('read','edit','delete')) {
    [void]$toolLegend.Children.Add((New-SwsdFragment (New-SwsdBadgeXaml $kind)))
    $explanation = switch ($kind) { read {'looks up'} edit {'creates or changes'} delete {'always previewed'} }
    [void]$toolLegend.Children.Add((New-SwsdFragment "<TextBlock Text=`"$explanation`" FontSize=`"11.5`" Foreground=`"{DynamicResource Muted}`" VerticalAlignment=`"Center`" Margin=`"8,0,18,0`"/>"))
}
function Set-SwsdToolDetail([string]$Name) {
    $item = $script:SwsdCatalog | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $item) { $toolDetail.Visibility='Collapsed'; return }
    $script:SwsdSelectedTool = $item.name
    $detailTitle.Text=$item.friendly; $detailId.Text=$item.name
    $detailBadge.Content = New-SwsdFragment (New-SwsdBadgeXaml $item.kind)
    $names = @($item.profiles | ForEach-Object { Get-SwsdProfileDisplayName $_ } | Select-Object -Unique); $detailProfiles.Text='in ' + ($names -join ', ')
    $detailDescription.Text=$item.short
    $examplePrompt.Text='“' + $item.example + '”'
    $deleteNotice.Visibility=if ($item.kind -eq 'delete') {'Visible'} else {'Collapsed'}
    $currentId = $script:SwsdPickerProfiles[$profile.SelectedIndex].id
    $locked = -not (Test-SwsdToolInProfile $item $currentId)
    $switchProfile.Visibility=if ($locked) {'Visible'} else {'Collapsed'}
    $target = @((Get-SwsdPickerProfiles).id) | Where-Object { Test-SwsdToolInProfile $item $_ } | Select-Object -First 1
    $switchProfile.Tag=$target; $switchProfile.Content='Switch to ' + (Get-SwsdProfileDisplayName $target)
    $toolDetail.Visibility='Visible'
}
function New-SwsdToolRow($Item, [bool]$Locked) {
    $name=ConvertTo-SwsdXml $Item.friendly; $id=ConvertTo-SwsdXml $Item.name; $description=ConvertTo-SwsdXml $Item.short
    $badge = New-SwsdBadgeXaml $Item.kind
    $lock=''
    if ($Locked) {
        $target = @((Get-SwsdPickerProfiles).id) | Where-Object { Test-SwsdToolInProfile $Item $_ } | Select-Object -First 1
        $targetName=Get-SwsdProfileDisplayName $target
        $lock="<Border CornerRadius=`"10`" BorderBrush=`"{DynamicResource Border}`" BorderThickness=`"1`" Padding=`"6,1`" Margin=`"8,0,0,0`"><StackPanel Orientation=`"Horizontal`" TextElement.Foreground=`"{DynamicResource Muted}`" TextElement.FontSize=`"10.5`"><TextBlock Text=`"&#xE72E;`" FontFamily=`"Segoe MDL2 Assets`" Margin=`"0,0,4,0`"/><TextBlock Text=`"$targetName`"/></StackPanel></Border>"
    }
    $selected = if ($Item.name -eq $script:SwsdSelectedTool) {'IconBackground'} else {'Card'}
    $button = New-SwsdFragment @"
<Button Height="58" HorizontalContentAlignment="Stretch" Padding="18,0" BorderThickness="0,0,0,1" BorderBrush="{DynamicResource Divider}" Background="{DynamicResource $selected}" AutomationProperties.Name="$name">
<Grid><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="86"/></Grid.ColumnDefinitions><StackPanel VerticalAlignment="Center"><StackPanel Orientation="Horizontal"><TextBlock Text="$name" FontSize="13.5" FontWeight="Medium"/><TextBlock Text="$id" FontFamily="Consolas" FontSize="10.5" Foreground="{DynamicResource Muted}" Margin="8,2,0,0"/>$lock</StackPanel><TextBlock Text="$description" FontSize="12.5" Foreground="{DynamicResource Muted}" TextTrimming="CharacterEllipsis" Margin="0,2,0,0"/></StackPanel><ContentControl Grid.Column="1" HorizontalAlignment="Right" VerticalAlignment="Center">$badge</ContentControl></Grid>
</Button>
"@
    $button.Tag=$Item.name
    $button.Add_Click({ param($sender,$e) Invoke-SwsdSafe -Source 'ToolClick' { Set-SwsdToolDetail $sender.Tag; Update-SwsdTools } })
    return $button
}
function Update-SwsdTools {
    $id=$script:SwsdPickerProfiles[$profile.SelectedIndex].id; $name=$script:SwsdPickerProfiles[$profile.SelectedIndex].name
    $inProfile=@(Get-SwsdProfileTools $id)
    $pageSubtitle.Text=if ($toolsNav.IsChecked) { "$($inProfile.Count) of $($script:SwsdCatalog.Count) enabled by your $name profile" } else {'Connect your AI apps to SWSD'}
    $areaFilters.Children.Clear()
    $filters=@(@{Name="In $name"; Area=''; Count=$inProfile.Count})
    foreach ($area in $script:SwsdAreaOrder) {
        $count=@($inProfile | Where-Object {$_.area -eq $area}).Count
        if ($count -gt 0) { $filters+=@{Name=$area; Area=$area; Count=$count} }
    }
    foreach ($filter in $filters) {
        $button=New-Object Windows.Controls.Button
        $button.Content=$filter.Name + '  ' + $filter.Count; $button.Tag=$filter.Area
        $button.Height=28; $button.FontSize=12; $button.Padding='11,0'; $button.Margin='0,0,6,6'
        if ($script:SwsdArea -eq $filter.Area) { $button.Style=$form.Resources['PrimaryButton'] }
        $button.Add_Click({ param($sender,$e) Invoke-SwsdSafe -Source 'AreaClick' { $script:SwsdArea=[string]$sender.Tag; Update-SwsdTools } })
        [void]$areaFilters.Children.Add($button)
    }
    # Match literal search terms; wildcard characters must not broaden the search.
    $query=$search.Text.Trim()
    $searchPlaceholder.Visibility=if ($query) {'Collapsed'} else {'Visible'}
    $matches=@($script:SwsdCatalog | Where-Object {
        (-not $script:SwsdArea -or $_.area -eq $script:SwsdArea) -and
        (-not $query -or ($_.friendly + ' ' + $_.name + ' ' + $_.description).IndexOf($query,[StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    $enabled=@($matches | Where-Object {Test-SwsdToolInProfile $_ $id})
    $notInProfile=@(Get-SwsdCatalogNotInProfile $id)
    $parent=[Windows.Controls.Panel]$toolDetail.Parent
    if ($parent) { $parent.Children.Remove($toolDetail) }
    $toolGroups.Children.Clear(); $lockedTools.Children.Clear()
    $detailLayout=[Windows.Controls.Grid]$toolDetail.Child
    $examplePanel=$detailLayout.Children[1]
    $detailLayout.RowDefinitions.Clear()
    if ($query) {
        [void]$detailLayout.RowDefinitions.Add((New-Object Windows.Controls.RowDefinition))
        [void]$detailLayout.RowDefinitions.Add((New-Object Windows.Controls.RowDefinition))
        $detailLayout.ColumnDefinitions[2].Width='0'
        [Windows.Controls.Grid]::SetColumn($examplePanel,0)
        [Windows.Controls.Grid]::SetRow($examplePanel,1)
        $examplePanel.Margin='0,14,0,0'
    } else {
        $detailLayout.ColumnDefinitions[2].Width='320'
        [Windows.Controls.Grid]::SetColumn($examplePanel,2)
        [Windows.Controls.Grid]::SetRow($examplePanel,0)
        $examplePanel.Margin='0'
    }
    if ($query) {
        $heading=New-Object Windows.Controls.TextBlock
        $matchWord=if ($matches.Count -eq 1) {'match'} else {'matches'}
        $heading.Text="Search results · $($matches.Count) $matchWord"; $heading.Style=$form.Resources['Section']
        [void]$toolGroups.Children.Add($heading)
        $card=New-Object Windows.Controls.Border; $card.Style=$form.Resources['CardStyle']
        $rows=New-Object Windows.Controls.StackPanel
        foreach ($item in $matches) { [void]$rows.Children.Add((New-SwsdToolRow $item (-not (Test-SwsdToolInProfile $item $id)))) }
        if ($matches.Count -eq 0) { $empty=New-SwsdFragment '<TextBlock Text="No tools found. Try a friendly name, tool ID, or area." Margin="18" Foreground="{DynamicResource Muted}"/>'; [void]$rows.Children.Add($empty) }
        $card.Child=$rows
        if ($matches.Count -gt 0 -and @($matches.name) -notcontains $script:SwsdSelectedTool) { $script:SwsdSelectedTool=$matches[0].name }
        Set-SwsdToolDetail $script:SwsdSelectedTool
        if ($matches.Count -gt 0) {
            $split=New-Object Windows.Controls.Grid
            foreach ($width in @('*','14','300')) {$column=New-Object Windows.Controls.ColumnDefinition; $column.Width=$width; [void]$split.ColumnDefinitions.Add($column)}
            $card.MinHeight=320; $toolDetail.Margin='0'; $toolDetail.MinHeight=320
            [void]$split.Children.Add($card); [void]$split.Children.Add($toolDetail)
            [Windows.Controls.Grid]::SetColumn($toolDetail,2)
            [void]$toolGroups.Children.Add($split)
        } else { [void]$toolGroups.Children.Add($card) }
    } else {
        $toolDetail.MinHeight=0; $toolDetail.Margin='0,10,0,0'
        [Windows.Controls.Grid]::SetColumn($toolDetail,0)
        $selected=$script:SwsdCatalog | Where-Object {$_.name -eq $script:SwsdSelectedTool} | Select-Object -First 1
        $groups=@($enabled | Group-Object area | Sort-Object {$script:SwsdAreaOrder.IndexOf($_.Name)})
        foreach ($group in $groups) {
            $heading=New-Object Windows.Controls.TextBlock
            $heading.Text=$group.Name + '  ·  ' + $group.Count + " tools in $name"; $heading.Style=$form.Resources['Section']
            [void]$toolGroups.Children.Add($heading)
            $card=New-Object Windows.Controls.Border; $card.Style=$form.Resources['CardStyle']
            $rows=New-Object Windows.Controls.StackPanel
            $sorted=@($group.Group | Sort-Object @{Expression={switch ($_.kind) {read {0} edit {1} delete {2}}}},name)
            $limit=if ($script:SwsdExpandedAreas.ContainsKey($group.Name)) {$sorted.Count} else {8}
            foreach ($item in @($sorted | Select-Object -First $limit)) { [void]$rows.Children.Add((New-SwsdToolRow $item $false)) }
            if ($sorted.Count -gt $limit) {
                $more=New-Object Windows.Controls.Button
                $more.Content='+ ' + ($sorted.Count-$limit) + ' more in ' + $group.Name; $more.Tag=$group.Name
                $more.Style=$form.Resources['LinkButton']; $more.HorizontalContentAlignment='Left'; $more.Margin='18,0'
                $more.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'MoreTools' { $script:SwsdExpandedAreas[$sender.Tag]=$true; Update-SwsdTools }})
                [void]$rows.Children.Add($more)
            }
            $card.Child=$rows; [void]$toolGroups.Children.Add($card)
            if ($selected -and $selected.area -eq $group.Name) { Set-SwsdToolDetail $selected.name; [void]$toolGroups.Children.Add($toolDetail) }
        }
        foreach ($item in @($notInProfile | Sort-Object friendly)) { [void]$lockedTools.Children.Add((New-SwsdToolRow $item $true)) }
    }
    $noun=if ($notInProfile.Count -eq 1) {'tool'} else {'tools'}
    $otherTools.Header="Not in $name · $($notInProfile.Count) $noun · change profile to use these"
    $otherTools.Visibility=if (-not $query -and $notInProfile.Count -gt 0) {'Visible'} else {'Collapsed'}
}
function Set-SwsdPage {
    $whatsNewPage.Visibility='Collapsed'
    Set-SwsdJwtHelp $false
    $homePage.Visibility=if ($toolsNav.IsChecked) {'Collapsed'} else {'Visible'}
    $toolsPage.Visibility=if ($toolsNav.IsChecked) {'Visible'} else {'Collapsed'}
    Update-SwsdDashboard; Update-SwsdTools; $pageScroll.ScrollToTop()
}

function Show-SwsdWhatsNew {
    Set-SwsdJwtHelp $false
    $homePage.Visibility='Collapsed'; $toolsPage.Visibility='Collapsed'; $whatsNewPage.Visibility='Visible'
    $pageTitle.Text="What’s new"; $pageSubtitle.Text='Release notes for SWSD for AI apps'
    $releaseNoteContent.Children.Clear()
    foreach ($part in (Get-SwsdReleaseNotes -AssetRoot $script:SwsdAssetRoot)) {
        $block=New-Object Windows.Controls.TextBlock
        $block.Text=($part.text -replace 'SolarWinds Service Desk','SWSD' -replace '`','')
        $block.TextWrapping='Wrap'
        $block.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty,'Text')
        switch ($part.kind) {
            version {
                if ($block.Text.StartsWith('Unreleased')) {$block.Text=$block.Text -replace '^Unreleased','Upcoming'}
                $block.FontSize=22; $block.FontWeight='SemiBold'; $block.Margin='0,12,0,8'
            }
            section {$block.FontSize=14; $block.FontWeight='SemiBold'; $block.Margin='0,12,0,6'}
            item {$block.Text='•  ' + $block.Text; $block.FontSize=12.5; $block.Margin='0,0,0,8'}
        }
        [void]$releaseNoteContent.Children.Add($block)
    }
    $pageScroll.ScrollToTop()
}

$script:SwsdEditingProfilePath=$null
function Set-SwsdProfileEditor([string]$Path) {
    $script:SwsdEditingProfilePath=$Path
    $value=if ($Path) {Read-SwsdProfileFile $Path} else {$null}
    $customName.Text=if ($value) {$value.name} else {''}
    $customDescription.Text=if ($value -and $value.PSObject.Properties['description']) {$value.description} else {''}
    $selected=if ($value) {@($value.tools)} else {@((Get-SwsdProfileTools $script:SwsdPickerProfiles[$profile.SelectedIndex].id).name)}
    $customTools.Children.Clear()
    foreach ($tool in ($script:SwsdCatalog | Sort-Object @{Expression={[array]::IndexOf($script:SwsdAreaOrder,$_.area)}},friendly)) {
        $check=New-Object Windows.Controls.CheckBox
        $check.Tag=$tool.name; $check.Content=$tool.friendly + ' · ' + $tool.area
        $check.ToolTip=$tool.name + [Environment]::NewLine + $tool.short
        $check.Margin='4,5,4,5'; $check.IsChecked=$selected -ccontains $tool.name
        $check.SetResourceReference([Windows.Controls.Control]::ForegroundProperty,'Text')
        $check.Add_Checked({Update-SwsdCustomCount}); $check.Add_Unchecked({Update-SwsdCustomCount})
        [void]$customTools.Children.Add($check)
    }
    $renameCustom.IsEnabled=[bool]$Path; $deleteCustom.IsEnabled=[bool]$Path; $exportCustom.IsEnabled=[bool]$Path
    Update-SwsdCustomCount
}
function Update-SwsdCustomCount {
    $customCount.Text= [string]@($customTools.Children | Where-Object {$_.IsChecked}).Count + ' tools selected'
}
function Save-SwsdProfileEditor {
    try {
        $value=[pscustomobject]@{name=$customName.Text; version=1; tools=@($customTools.Children | Where-Object {$_.IsChecked} | ForEach-Object {[string]$_.Tag}); description=$customDescription.Text}
        if ($value.tools.Count -eq 0) {throw 'Profile JSON: Select at least one tool before saving your selection.'}
        $result=Save-SwsdCustomProfile -Value $value -PreviousPath $script:SwsdEditingProfilePath
        Save-SwsdProfile -Profile custom -ProfileFile $result.path
        Update-SwsdProfilePickers; Set-SwsdProfileEditor $result.path
        Update-SwsdDashboard; Update-SwsdTools
        Set-SwsdStatus -Kind success -Text ('Profile saved. Reopen your AI app and start a new chat. ' + $result.notice)
    } catch {Show-SwsdError $_.Exception}
}
function Import-SwsdProfileFromPath([string]$Path) {
    try {
        $result=Import-SwsdCustomProfile $Path
        Update-SwsdProfilePickers; Set-SwsdProfileEditor $result.path
        $profileBuilder.IsExpanded=$true
        Set-SwsdStatus -Kind $(if ($result.skipped.Count) {'warn'} else {'success'}) -Text ('Profile imported. Select Save profile to use it. ' + $result.notice)
    } catch {Show-SwsdError $_.Exception}
}
function Select-SwsdProfileFile([bool]$Save) {
    $dialog=if ($Save) {New-Object Microsoft.Win32.SaveFileDialog} else {New-Object Microsoft.Win32.OpenFileDialog}
    $dialog.Filter='JSON profile (*.json)|*.json'; $dialog.DefaultExt='.json'
    if ($Save) {$dialog.FileName=$customName.Text + '.json'}
    if ($dialog.ShowDialog($form)) {return $dialog.FileName}
    return $null
}
function Set-SwsdJwtHelp([bool]$Open) {
    $script:SwsdHelpOpen=$Open
    $jwtFlyout.Visibility=if ($Open) {'Visible'} else {'Collapsed'}
    $helpSpacer.Visibility=if ($Open) {'Visible'} else {'Collapsed'}
    $accountHeading.Margin=if ($Open) {'2,4,0,8'} else {'2,20,0,8'}
    if ($Open) { $toast.Visibility='Collapsed' }
    $tokenHelp.SetResourceReference([Windows.Controls.Control]::BackgroundProperty,$(if ($Open) {'Accent'} else {'Control'}))
    $tokenHelp.SetResourceReference([Windows.Controls.Control]::ForegroundProperty,$(if ($Open) {'AccentText'} else {'Muted'}))
    Update-SwsdDashboard
}

# Keep the existing bounded install/update runspace and retained repair recipe. Only the
# polling mechanism changes to DispatcherTimer; UI objects never cross the runspace.
$script:SwsdInstallTimer=New-Object Windows.Threading.DispatcherTimer
$script:SwsdInstallTimer.Interval=[TimeSpan]::FromMilliseconds(50)
function Reset-SwsdAction {
    $toast.Visibility='Collapsed'; $showDetails.Visibility='Collapsed'; $errorDetails.Visibility='Collapsed'
    $showDetails.Content='Show details'; $errorDetails.Text=''
}
function Show-SwsdUpdateUnavailable {
    $script:SwsdLatestVersion=$null; $script:SwsdUpdateState='offline'
    Set-SwsdStatus -Kind warn -Text 'Could not check for updates. Check your connection and npm installation, then try again.'
}
function Start-SwsdInstall {
    param([ValidateSet('Install','Update','CheckUpdates','Node')][string]$Operation='Install')
    if ($null -ne $script:SwsdInstallWorker) { return }
    Reset-SwsdAction; Set-SwsdBusy $true
    $message=switch ($Operation) { CheckUpdates {'Checking for updates…'} Node {'Installing Node.js…'} default {'Installing SWSD tools…'} }
    Set-SwsdStatus -Text $message
    if ($Operation -eq 'CheckUpdates') { $script:SwsdUpdateState='checking'; Update-SwsdDashboard }
    $powershell=$null; $runspace=$null; $script:SwsdInstallPollCount=0
    try {
        $runspace=[Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
        $runspace.ApartmentState='STA'; $runspace.ThreadOptions='ReuseThread'; $runspace.Open()
        $powershell=[Management.Automation.PowerShell]::Create(); $powershell.Runspace=$runspace
        $operationFunction=switch ($Operation) { CheckUpdates {'Get-SwsdLatestVersion'} Update {'Update-SwsdRuntime'} Node {'Install-SwsdNode'} default {'Install-SwsdTools'} }
        $mockBody=$null; $mockFails=$false; $mockCalls=$null; $mockResult=$null
        if ($ValidateHandlers) {
            $mockBody=(Get-Item ('Function:'+$operationFunction)).ScriptBlock.ToString()
            $mockFails=if ($Operation -eq 'Node') {$script:SwsdMockNodeFails} else {$script:SwsdMockInstallFails}
            $mockCalls=$script:SwsdMockCalls; $mockResult=$script:SwsdMockLatestVersion
        }
        [void]$powershell.AddScript({
            param($ScriptsRoot,$HomeOverride,$CredentialTarget,$MockBody,$MockFails,$MockCalls,$Operation,$OperationFunction,$MockResult)
            . (Join-Path $ScriptsRoot 'Common.ps1')
            $script:SwsdHome=$HomeOverride; $script:SwsdCredentialTarget=$CredentialTarget
            if ($MockBody) {
                $script:SwsdMockInstallFails=$MockFails; $script:SwsdMockCalls=$MockCalls; $script:SwsdMockLatestVersion=$MockResult
                Set-Item ('Function:'+$OperationFunction) ([scriptblock]::Create($MockBody))
            }
            if ($Operation -eq 'CheckUpdates') { return Get-SwsdLatestVersion }
            if ($Operation -eq 'Node') { Install-SwsdNode; return }
            if ($Operation -eq 'Update') { Update-SwsdRuntime; return }
            $sourceRoot=Split-Path $ScriptsRoot
            if (Test-Path -LiteralPath (Join-Path $ScriptsRoot 'runtime/package.json')) { $sourceRoot=$ScriptsRoot }
            if ($sourceRoot -eq $ScriptsRoot) {
                $stage=Join-Path $script:SwsdHome 'repair-source'
                New-Item -ItemType Directory -Path (Join-Path $stage 'scripts'),(Join-Path $stage 'runtime') -Force | Out-Null
                foreach ($name in @('Common.ps1','Manage-Swsd.ps1','Start-Swsd.ps1')) { Copy-Item -LiteralPath (Join-Path $ScriptsRoot $name) -Destination (Join-Path $stage 'scripts') -Force }
                Copy-Item -LiteralPath (Join-Path $ScriptsRoot 'runtime/package.json'),(Join-Path $ScriptsRoot 'runtime/package-lock.json') -Destination (Join-Path $stage 'runtime') -Force
                if (Test-Path -LiteralPath (Join-Path $ScriptsRoot 'assets')) { Copy-Item -LiteralPath (Join-Path $ScriptsRoot 'assets') -Destination $stage -Recurse -Force }
                $sourceRoot=$stage
            }
            Install-SwsdTools -SourceRoot $sourceRoot -Force
        }).AddArgument($PSScriptRoot).AddArgument($script:SwsdHome).AddArgument($script:SwsdCredentialTarget).AddArgument($mockBody).AddArgument($mockFails).AddArgument($mockCalls).AddArgument($Operation).AddArgument($operationFunction).AddArgument($mockResult)
        $handle=$powershell.BeginInvoke()
        $script:SwsdInstallWorker=@{PowerShell=$powershell; Runspace=$runspace; Handle=$handle; Operation=$Operation}
        $script:SwsdInstallTimer.Start()
    } catch {
        if ($powershell) {$powershell.Dispose()}; if ($runspace) {$runspace.Dispose()}
        $script:SwsdInstallWorker=$null; Set-SwsdBusy $false
        if ($Operation -eq 'CheckUpdates') {Show-SwsdUpdateUnavailable} else {Show-SwsdError $_.Exception}
        Update-SwsdDashboard
    }
}
function Complete-SwsdInstall {
    $worker=$script:SwsdInstallWorker
    if ($null -eq $worker -or -not $worker.Handle.IsCompleted) { return }
    $script:SwsdInstallTimer.Stop()
    try {
        $result=@($worker.PowerShell.EndInvoke($worker.Handle))
        if ($worker.PowerShell.HadErrors) { throw $worker.PowerShell.Streams.Error[0].Exception }
        switch ($worker.Operation) {
            CheckUpdates {
                $script:SwsdLatestVersion=if ($result.Count -gt 0) {[string]$result[-1]} else {$null}
                if (-not $script:SwsdLatestVersion) {Show-SwsdUpdateUnavailable} else {
                    $script:SwsdUpdateState='checked'; $installedVersion=(Get-SwsdStatus).installedVersion
                    switch (Compare-SwsdVersion -Installed $installedVersion -Latest $script:SwsdLatestVersion) {
                        current {Set-SwsdStatus -Kind success -Text "swsd-mcp $installedVersion is up to date."}
                        update {Set-SwsdStatus -Kind warn -Text "Version $($script:SwsdLatestVersion) is available. Select Update to install it."}
                        newer {Set-SwsdStatus -Text "Installed swsd-mcp $installedVersion is newer than the published version $($script:SwsdLatestVersion)."}
                        default {Set-SwsdStatus -Text "Latest published swsd-mcp: $($script:SwsdLatestVersion). Install tools to set up the reviewed version."}
                    }
                }
            }
            Node {Set-SwsdStatus -Kind success -Text 'Node.js installed. Reopen this window to continue setup.'}
            default {Set-SwsdStatus -Kind success -Text 'Tools installed. Test your JSON Web Token next. Setup is also available from the Windows Start menu.'}
        }
    } catch {
        if ($worker.Operation -eq 'CheckUpdates') {Show-SwsdUpdateUnavailable} else {Show-SwsdError $_.Exception}
    } finally {
        $worker.PowerShell.Dispose(); $worker.Runspace.Dispose(); $script:SwsdInstallWorker=$null
        Set-SwsdBusy $false; Update-SwsdDashboard
    }
}
function Invoke-SwsdNodeInstall {
    if ($null -ne $script:SwsdInstallWorker) {return}
    if ((Get-SwsdStatus).nodeSupported) {Set-SwsdStatus -Text 'A supported Node.js version is already installed.'; return}
    if ((Confirm-SwsdNodeInstall) -ne 'Yes') {Set-SwsdStatus -Text 'Node.js installation cancelled.'; return}
    Start-SwsdInstall -Operation Node
}
function Invoke-SwsdTokenTest {
    if ($null -ne $script:SwsdInstallWorker) {return}
    Set-SwsdBusy $true; Reset-SwsdAction
    $secret=$null; $script:SwsdVerified=$false; $script:SwsdIdentity=$null
    try {
        $secret=$tokenBox.Password.Trim(); $tokenBox.Clear()
        $entered=-not [string]::IsNullOrWhiteSpace($secret)
        if (-not $entered) {$secret=[SwsdDesktop.Credentials]::Read($script:SwsdCredentialTarget)}
        if ([string]::IsNullOrWhiteSpace($secret)) {throw 'No token is saved.'}
        $baseUrl=@('https://api.samanage.com','https://apieu.samanage.com')[$region.SelectedIndex]
        Test-SwsdToken -Token $secret -BaseUrl $baseUrl
        $old=Get-SwsdSettings
        Save-SwsdSettings -BaseUrl $baseUrl -Profile $old.profile
        try {if ($entered) {[SwsdDesktop.Credentials]::Save($script:SwsdCredentialTarget,$secret)}} catch {
            Save-SwsdSettings -BaseUrl $old.baseUrl -Profile $old.profile
            throw
        }
        $script:SwsdVerified=$true; $script:SwsdTokenError=$false
        $script:SwsdIdentity=Get-SwsdVerifiedIdentity -Token $secret -BaseUrl $baseUrl
        $message=if ($script:SwsdIdentity) {'Connected as ' + $script:SwsdIdentity + ' (' + $(if ($region.SelectedIndex -eq 1) {'EU'} else {'US'}) + ')'} else {'Connected to SWSD · JSON Web Token verified'}
        Set-SwsdStatus -Kind success -Text ($message + '. Start a new chat; fully reopen your AI app if an old connection remains.')
    } catch {$script:SwsdTokenError=$true; Show-SwsdError $_.Exception}
    finally {$secret=$null; Set-SwsdBusy $false; Update-SwsdDashboard}
}
function Save-SwsdSelectedProfile([int]$Index) {
    if ($script:SwsdSyncing -or $Index -lt 0) {return}
    $old=Get-SwsdSettings
    try {
        $row=$script:SwsdPickerProfiles[$Index]
        if ($row.id.StartsWith('custom:')) {Save-SwsdProfile -Profile custom -ProfileFile $row.profileFile; Set-SwsdProfileEditor $row.profileFile}
        else {Save-SwsdProfile -Profile $row.id; Set-SwsdProfileEditor ''}
        $script:SwsdSyncing=$true; $profile.SelectedIndex=$Index; $toolsProfile.SelectedIndex=$Index
        Set-SwsdStatus -Kind success -Text 'Profile saved. Fully quit and reopen your AI app, then start a new chat to load this tool set. Your saved JSON Web Token is unchanged.'
    } catch {Show-SwsdError $_.Exception; $script:SwsdSyncing=$true; $profile.SelectedIndex=Get-SwsdSelectedProfileIndex $old; $toolsProfile.SelectedIndex=$profile.SelectedIndex}
    finally {$script:SwsdSyncing=$false; $script:SwsdArea=''; Update-SwsdDashboard; Update-SwsdTools}
}

$script:SwsdInstallTimer.Add_Tick({param($sender,$e) Invoke-SwsdSafe -Source 'InstallTick' {$script:SwsdInstallPollCount++; Complete-SwsdInstall}})
$form.Add_Closing({param($sender,$e) Invoke-SwsdSafe -Source 'Closing' {
    if ($null -ne $script:SwsdInstallWorker) {$e.Cancel=$true; Set-SwsdStatus -Text 'The background action is still running. Please wait for it to finish before closing this window.'}
}})
$form.Add_SourceInitialized({param($sender,$e) Invoke-SwsdSafe -Source 'SourceInitialized' {
    $script:SwsdHandle=([Windows.Interop.WindowInteropHelper]::new($form)).Handle
    $script:SwsdDpi=[SwsdDesktop.WpfDpi]::new($script:SwsdHandle)
    $script:SwsdDeviceDpi=$script:SwsdDpi.DeviceDpi
    [SwsdDesktop.Windows]::ApplyDarkMode($script:SwsdHandle,$script:SwsdDarkMode)
    Set-SwsdBackdrop
    [SwsdDesktop.Windows]::ApplyRoundedCorners($script:SwsdHandle)
}})
$form.Add_DpiChanged({param($sender,$e) Invoke-SwsdSafe -Source 'DpiChanged' {$script:SwsdDeviceDpi=[int][Math]::Round($e.NewDpi.PixelsPerInchX)}})
$form.Add_ContentRendered({param($sender,$e) Invoke-SwsdSafe -Source 'ContentRendered' {
    if ($script:SwsdPresentationCount -eq 0) {
        $script:SwsdPresentationCount=1
        [void]$form.Activate(); [void][SwsdDesktop.Windows]::SetForegroundWindow($script:SwsdHandle)
    }
}})
$form.Add_PreviewKeyDown({param($sender,$e) Invoke-SwsdSafe -Source 'KeyDown' {
    if ($e.Key -eq 'F' -and [Windows.Input.Keyboard]::Modifiers -band [Windows.Input.ModifierKeys]::Control) {$toolsNav.IsChecked=$true; [void]$search.Focus(); $search.SelectAll(); $e.Handled=$true}
    if ($e.Key -eq 'Escape' -and $script:SwsdHelpOpen) {Set-SwsdJwtHelp $false; [void]$tokenHelp.Focus(); $e.Handled=$true}
}})
$form.Add_PreviewMouseDown({param($sender,$e) Invoke-SwsdSafe -Source 'DismissHelp' {
    if ($script:SwsdHelpOpen -and -not $jwtFlyout.IsMouseOver -and -not $tokenHelp.IsMouseOver -and -not $findToken.IsMouseOver) {Set-SwsdJwtHelp $false}
}})
$install.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'InstallClick' {Start-SwsdInstall}})
$setupInstall.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'SetupClick' {if (-not (Get-SwsdStatus).nodeSupported) {Invoke-SwsdNodeInstall} elseif (-not (Get-SwsdStatus).toolsInstalled) {Start-SwsdInstall}}})
$checkUpdates.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'UpdateClick' {if (Test-SwsdUpdateAvailable) {Start-SwsdInstall -Operation Update} else {Start-SwsdInstall -Operation CheckUpdates}}})
$nodeInstallButton.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'NodeClick' {Invoke-SwsdNodeInstall}})
$test.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'TestClick' {Invoke-SwsdTokenTest}})
$remove.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'RemoveClick' {
    if ((Confirm-SwsdRemove) -eq 'Yes') {
        try {[SwsdDesktop.Credentials]::Remove($script:SwsdCredentialTarget); $tokenBox.Clear(); $script:SwsdVerified=$false; $script:SwsdTokenError=$false; $script:SwsdIdentity=$null; Set-SwsdStatus -Text 'Saved JSON Web Token removed. Fully quit your AI app to stop running connections. Revoke the token in SWSD if needed.'} catch {Show-SwsdError $_.Exception}
        Update-SwsdDashboard
    }
}})
$region.Add_SelectionChanged({param($sender,$e) Invoke-SwsdSafe -Source 'RegionChanged' {
    if (-not $script:SwsdSyncing) {$script:SwsdVerified=$false; $script:SwsdIdentity=$null; $toast.Visibility='Collapsed'; Update-SwsdDashboard}
}})
$profile.Add_SelectionChanged({param($sender,$e) Invoke-SwsdSafe -Source 'ProfileChanged' {Save-SwsdSelectedProfile $profile.SelectedIndex}})
$toolsProfile.Add_SelectionChanged({param($sender,$e) Invoke-SwsdSafe -Source 'ToolsProfileChanged' {Save-SwsdSelectedProfile $toolsProfile.SelectedIndex}})
$appearance.Add_SelectionChanged({param($sender,$e) Invoke-SwsdSafe -Source 'AppearanceChanged' {
    if (-not $script:SwsdSyncing -and $appearance.SelectedItem -is [Windows.Controls.ComboBoxItem]) {$s=Get-SwsdSettings; Save-SwsdSettings -BaseUrl $s.baseUrl -Profile $s.profile -Theme ([string]$appearance.SelectedItem.Tag); Set-SwsdTheme; Update-SwsdDashboard; Update-SwsdTools}
}})
$tokenBox.Add_PasswordChanged({param($sender,$e) Invoke-SwsdSafe -Source 'PasswordChanged' {$tokenPlaceholder.Visibility=if ($tokenBox.SecurePassword.Length -gt 0) {'Collapsed'} else {'Visible'}; $tokenVerified.Visibility=if ($tokenBox.SecurePassword.Length -eq 0 -and $script:SwsdVerified) {'Visible'} else {'Collapsed'}}})
$showDetails.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'DetailsClick' {$open=$errorDetails.Visibility -ne 'Visible'; $errorDetails.Visibility=if ($open) {'Visible'} else {'Collapsed'}; $showDetails.Content=if ($open) {'Hide details'} else {'Show details'}}})
$copyDiagnostics.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'DiagnosticsClick' {
    $report=Get-SwsdDiagnostics -LogPath $script:SwsdDiagnosticsLogPath -Dpi $script:SwsdDeviceDpi -Scale ($script:SwsdUiScale * $script:SwsdDeviceDpi / 96) -Theme $(if ($script:SwsdDarkMode) {'dark'} else {'light'})
    Set-SwsdClipboard -Text $report; Set-SwsdStatus -Kind success -Text 'Diagnostics copied. The report includes credential presence only and redacts recent log entries.'
}})
$copyPrompt.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'CopyPromptClick' {
    $item=$script:SwsdCatalog | Where-Object {$_.name -eq $script:SwsdSelectedTool} | Select-Object -First 1
    if ($item) {Set-SwsdClipboard -Text $item.example; $copyPrompt.Content='Prompt copied'}
}})
$switchProfile.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'SwitchProfileClick' {$toolsProfile.SelectedIndex=[Math]::Max(0, @($script:SwsdPickerProfiles.id).IndexOf([string]$switchProfile.Tag))}})
$releaseNotes.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'ReleaseNotesClick' {Show-SwsdWhatsNew}})
$closeWhatsNew.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'CloseWhatsNew' {$homeNav.IsChecked=$true; Set-SwsdPage}})
$reportBug.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'ReportBug' {Start-Process (New-SwsdIssueUrl -Kind bug)}})
$requestFeature.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'RequestFeature' {Start-Process (New-SwsdIssueUrl -Kind feature)}})
$newCustom.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'NewProfile' {Set-SwsdProfileEditor ''}})
$saveCustom.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'SaveProfile' {Save-SwsdProfileEditor}})
$renameCustom.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'RenameProfile' {Save-SwsdProfileEditor}})
$deleteCustom.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'DeleteProfile' {Remove-SwsdCustomProfile $script:SwsdEditingProfilePath; Update-SwsdProfilePickers; Set-SwsdProfileEditor ''; Update-SwsdDashboard; Update-SwsdTools; Set-SwsdStatus -Text 'Custom profile deleted.'}})
$importCustom.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'ImportProfile' {$path=Select-SwsdProfileFile $false; if ($path) {Import-SwsdProfileFromPath $path}}})
$exportCustom.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'ExportProfile' {$path=Select-SwsdProfileFile $true; if ($path) {Export-SwsdCustomProfile $script:SwsdEditingProfilePath $path; Set-SwsdStatus -Kind success -Text 'Profile exported.'}}})
$tokenHelp.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'HelpClick' {Set-SwsdJwtHelp (-not $script:SwsdHelpOpen)}})
$findToken.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'FindTokenClick' {Set-SwsdJwtHelp $true}})
$closeHelp.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'CloseHelpClick' {Set-SwsdJwtHelp $false}})
$homeNav.Add_Checked({param($sender,$e) Invoke-SwsdSafe -Source 'HomeNav' {Set-SwsdPage}})
$toolsNav.Add_Checked({param($sender,$e) Invoke-SwsdSafe -Source 'ToolsNav' {Set-SwsdPage}})
$search.Add_TextChanged({param($sender,$e) Invoke-SwsdSafe -Source 'SearchChanged' {Update-SwsdTools}})
$minimize.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'MinimizeClick' {[Windows.SystemCommands]::MinimizeWindow($form)}})
$maximize.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'MaximizeClick' {if ($form.WindowState -eq 'Maximized') {[Windows.SystemCommands]::RestoreWindow($form)} else {[Windows.SystemCommands]::MaximizeWindow($form)}}})
$closeWindow.Add_Click({param($sender,$e) Invoke-SwsdSafe -Source 'CloseClick' {$form.Close()}})
$form.Dispatcher.Add_UnhandledException({param($sender,$e)
    $e.Handled=$true
    Invoke-SwsdSafe -Source 'DispatcherException' {throw $e.Exception}
})
$statusGrid.Add_SizeChanged({param($sender,$e) Invoke-SwsdSafe -Source 'DashboardResize' {
    $statusGrid.Columns=if ($statusGrid.ActualWidth -ge 800) {3} elseif ($statusGrid.ActualWidth -ge 550) {2} else {1}
}})
$script:SwsdSyncing=$false
Set-SwsdTheme; Update-SwsdDashboard; Update-SwsdTools
if ($savedSettings.profile -eq 'custom') {Set-SwsdProfileEditor $savedSettings.profileFile} else {Set-SwsdProfileEditor ''}
if ($savedSettings.profileError) {Set-SwsdStatus -Kind warn -Text $savedSettings.profileError}

# Match Windows follows a theme change while the window remains open. Keep this on
# the UI dispatcher, avoiding cross-thread SystemEvents callbacks into PowerShell.
$themeTimer=New-Object Windows.Threading.DispatcherTimer
$themeTimer.Interval=[TimeSpan]::FromSeconds(2)
$themeTimer.Add_Tick({param($sender,$e) Invoke-SwsdSafe -Source 'WindowsThemeChanged' {
    if ($appearance.SelectedIndex -eq 0 -and $env:SWSD_THEME -notin @('light','dark')) {
        $setting=Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -ErrorAction SilentlyContinue
        $dark=$setting -and $setting.PSObject.Properties['AppsUseLightTheme'] -and [int]$setting.AppsUseLightTheme -eq 0
        if ($dark -ne $script:SwsdDarkMode) {Set-SwsdTheme; Update-SwsdDashboard; Update-SwsdTools}
    }
}})

function Invoke-SwsdTestClick($Button) {
    $Button.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Button]::ClickEvent))
}
function Wait-SwsdDispatcher([int]$Milliseconds=30) {
    $frame=New-Object Windows.Threading.DispatcherFrame
    $timer=New-Object Windows.Threading.DispatcherTimer
    $timer.Interval=[TimeSpan]::FromMilliseconds($Milliseconds)
    $endFrame={param($sender,$e) $sender.Stop(); $frame.Continue=$false}.GetNewClosure()
    $timer.Add_Tick($endFrame); $timer.Start()
    try {[Windows.Threading.Dispatcher]::PushFrame($frame)} finally {$timer.Stop(); $timer.Remove_Tick($endFrame)}
}
function Assert-Swsd([bool]$Condition,[string]$Message) { if (-not $Condition) {throw $Message} }
function Get-SwsdControlText($Root) {
    if ($Root -is [Windows.Controls.TextBlock]) { $Root.Text }
    if ($Root -is [Windows.Controls.ContentControl] -and $Root.Content -is [string]) { $Root.Content }
    if ($Root -is [Windows.Controls.HeaderedContentControl] -and $Root.Header -is [string]) { $Root.Header }
    if ($Root -is [Windows.DependencyObject]) {
        foreach ($child in [Windows.LogicalTreeHelper]::GetChildren($Root)) { Get-SwsdControlText $child }
    }
}
function Assert-SwsdUiEncoding {
    # Numeric expectations survive even if PS 5.1 misdecodes this script itself.
    foreach ($pair in @(@($tokenVerified.Text,0x2713),@($minimize.Content,0x2014),@($maximize.Content,0x25a1),@($closeWindow.Content,0x00d7))) {
        $actual=[string]$pair[0]
        $codes=@($actual.ToCharArray() | ForEach-Object {'U+{0:X4}' -f [int]$_}) -join ' '
        Assert-Swsd ($actual -ceq [string][char]$pair[1]) ('UI UTF-8 decoding failed: expected U+{0:X4}, got {1}.' -f $pair[1],$codes)
    }
    Assert-Swsd ([string]$findToken.Content -ceq ('Where do I find my token? '+[char]0x2197)) 'Token help link must retain its Unicode arrow.'
    $texts=@(Get-SwsdControlText $form)
    foreach ($codes in @(@(0xe2,0x20ac),@(0xc2,0xb7),@(0xe2,0x153),@(0xe2,0x2013,0xa1),@(0xc3,0x2014),@(0xe2,0x2020))) {
        $marker=-join @($codes | ForEach-Object {[char]$_})
        Assert-Swsd (@($texts | Where-Object {$_.Contains($marker)}).Count -eq 0) 'UI control text contains mojibake.'
    }
    Assert-Swsd (-not ($texts -contains 'Your JSON Web Token stays on this PC and is only sent to SWSD.')) 'The old Home footer must stay removed.'
    if ($PreviewState -in @('ready','appearance')) {
        Assert-Swsd ($status.Text -ceq ([string][char]0x2713+'  Connected as Alex Rivera '+[char]0xb7+' Acme IT (US)')) 'Preview status must retain its check mark and middle dot.'
        Assert-Swsd ($tokenPlaceholder.Text -ceq ([string][char]0x2022)*8) 'Preview token mask must contain eight Unicode bullets.'
    }
}
function Assert-SwsdProfileLabels {
    $texts = @($homePage,$toolsPage | ForEach-Object {Get-SwsdControlText $_})
    Assert-Swsd (@($texts | Where-Object {$_ -cmatch '\bFull\b' -or $_ -match '^[RED]\s*·'}).Count -eq 0) 'Control text must use visible profile names and plain Read/Edit/Delete badges.'
}
function Remove-SwsdUiFixture {
    if (-not ($ValidateUi -or $ValidateWindow -or $ValidateHandlers)) {return}
    $resolved=[IO.Path]::GetFullPath($script:SwsdHome)
    $temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($temporaryRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^swsd-ui-test-[a-f0-9]{32}$') {throw 'Unsafe UI test cleanup path.'}
    [SwsdDesktop.Credentials]::Remove($script:SwsdCredentialTarget)
    if (Test-Path -LiteralPath $resolved) {Remove-Item -LiteralPath $resolved -Recurse -Force}
}
function Test-SwsdAppearanceControls {
    $profile.SelectedIndex=1
    Assert-Swsd ($appearance.Items.Count -eq 26 -and $appearance.Items[3] -is [Windows.Controls.ComboBoxItem] -and $appearance.Items[3].Tag -ceq '__separator' -and -not $appearance.Items[3].IsEnabled -and -not $appearance.Items[3].Focusable -and -not $appearance.Items[3].IsHitTestVisible) 'Appearance needs three Windows choices, a nonselectable divider and 22 named themes.'
    $ids=@($appearance.Items | Where-Object {$_ -is [Windows.Controls.ComboBoxItem] -and $_.Tag -cne '__separator'} | ForEach-Object {[string]$_.Tag})
    Assert-Swsd (($ids -join ',') -ceq ($script:SwsdThemes.Keys -join ',')) 'Appearance order or stable IDs changed.'
    Set-SwsdStatus -Kind error -Text 'Appearance contrast check'
    foreach ($id in $ids) {
        Set-SwsdAppearanceSelection $id
        Assert-Swsd ((Get-SwsdSettings).theme -eq $id) ('Appearance did not persist: '+$id)
        Assert-Swsd ($script:SwsdThemeId -eq $id) ('Appearance did not apply live: '+$id)
        $p=Get-SwsdThemePalette $script:SwsdResolvedThemeId
        foreach ($key in $p.Keys) {
            Assert-Swsd ($form.Resources[$key].Color.ToString() -ieq ('#ff'+$p[$key].Substring(1))) ('Live resource mismatch: '+$id+'/'+$key)
        }
        Assert-Swsd ($search.SelectionBrush.Color -eq $form.Resources['Accent'].Color -and $search.SelectionTextBrush.Color -eq $form.Resources['AccentText'].Color -and $search.SelectionOpacity -eq 1) 'Selected input text did not follow the readable accent pair.'
        Assert-Swsd ($tokenBox.CaretBrush.Color -eq $form.Resources['Text'].Color -and $tokenBox.SelectionTextBrush.Color -eq $form.Resources['AccentText'].Color) 'Password caret or selection kept the previous theme.'
        Assert-Swsd ($status.Foreground.Color -eq $form.Resources['ErrorText'].Color -and $toast.Background.Color -eq $form.Resources['ErrorBackground'].Color) 'An existing error banner kept the previous theme.'
        if ($id -notin @('system','light','dark')) {
            Assert-Swsd (-not $script:SwsdUseMica -and -not $script:SwsdMicaEnabled -and $appRoot.Background -is [Windows.Media.SolidColorBrush] -and $appRoot.Background.Color -eq $form.Resources['Canvas'].Color -and $appRoot.Background.Opacity -eq 1) 'Named themes must use an opaque solid palette.'
            Assert-Swsd ($script:SwsdDarkMode -eq ((Get-SwsdColorLuminance $p.Canvas) -lt 0.5)) 'Named theme caption mode is incorrect.'
        }
        Save-SwsdProfile agent
        Assert-Swsd ((Get-SwsdSettings).theme -eq $id) 'Profile save discarded Appearance.'
    }
    $toast.Visibility='Collapsed'
    Assert-Swsd ($script:SwsdHandlerErrors.Count -eq 0) 'Appearance raised a handler error.'
}
function Test-SwsdUiControls {
    Assert-Swsd (-not $appearance.IsDropDownOpen) 'Appearance must stay closed on normal startup.'
    Assert-Swsd ($tokenBox -is [Windows.Controls.PasswordBox]) 'JSON Web Token field must use PasswordBox.'
    Assert-Swsd ($profile.Items.Count -eq $script:SwsdPickerProfiles.Count -and $profile.Items.Count -ge 4 -and $profile.SelectedItem -eq 'Agent' -and -not ($profile.Items -contains 'Full')) 'Visible profiles (no Full) and Agent default are required.'
    Assert-Swsd ([object]::ReferenceEquals($profile.ItemsSource,$toolsProfile.ItemsSource)) 'Profile pickers must share their data source.'
    Assert-Swsd ($script:SwsdCatalog.Count -eq 145) 'The reviewed catalog must contain 145 tools.'
    Assert-Swsd (@(Get-SwsdProfileTools 'agent').Count -eq 51) 'Agent must expose 51 tools.'
    Assert-Swsd (@(Get-SwsdCatalogNotInProfile 'agent').Count -eq 94) 'Agent must have 94 tools outside the profile.'
    Assert-Swsd (-not $otherTools.IsExpanded) 'Not-in-profile tools must be collapsed by default.'
    Assert-Swsd ($appearance.SelectedIndex -eq 0) 'Appearance must default to Match Windows.'
    Assert-Swsd ([SwsdDesktop.Credentials]::ReadCount -eq 0) 'Loading the dashboard must not read a saved credential.'
    foreach ($id in $rowNames) {Assert-Swsd ($form.FindName($id+'Cell') -is [Windows.Controls.Border]) "Dashboard is missing $id."}
    foreach ($index in 0..($script:SwsdPickerProfiles.Count-1)) {
        $profile.SelectedIndex=$index
        # Selecting the already-selected item is intentionally a no-op.
        if ($index -eq 1 -and (Get-SwsdSettings).profile -ne 'agent') {Save-SwsdSelectedProfile $index}
        Assert-Swsd ((Get-SwsdSettings).profile -eq $script:SwsdPickerProfiles[$index].id) 'Profile selection did not persist.'
        Assert-Swsd ($toolsProfile.SelectedIndex -eq $index) 'Home and Tools profile pickers diverged.'
        Assert-Swsd ($profileDescription.ToolTip -eq $script:SwsdPickerProfiles[$index].description) 'Profile description did not refresh.'
        Assert-Swsd ($ProfileValue.Text.StartsWith($script:SwsdPickerProfiles[$index].name)) 'Dashboard profile did not refresh.'
        $id=$script:SwsdPickerProfiles[$index].id
        $expected=@(Get-SwsdProfileTools $id)
        Assert-Swsd ($areaFilters.Children[0].Content -eq ("In " + $script:SwsdPickerProfiles[$index].name + '  ' + $expected.Count)) 'In-profile chip count must match visible membership.'
        Assert-Swsd ($lockedTools.Children.Count -eq @(Get-SwsdCatalogNotInProfile $id).Count) 'Locked rows must cover the full catalog.'
        if ($id -eq 'operations') {
            Assert-Swsd ($expected.Count -eq 145 -and $otherTools.Visibility -eq 'Collapsed') 'Operations must include its hidden alias tools.'
        }
        Assert-SwsdProfileLabels
    }
    Test-SwsdAppearanceControls
    $oldTheme=(Get-SwsdSettings).theme
    Save-SwsdSettings -BaseUrl 'https://apieu.samanage.com' -Profile 'agent'
    Assert-Swsd ((Get-SwsdSettings).theme -eq $oldTheme) 'Account save discarded Appearance.'
    Invoke-SwsdTestClick $tokenHelp
    Assert-Swsd ($jwtFlyout.Visibility -eq 'Visible' -and $jwtProfileImage.Source -and $jwtActionsImage.Source) 'JWT help and both embedded figures must open.'
    Invoke-SwsdTestClick $closeHelp
    Assert-Swsd ($jwtFlyout.Visibility -eq 'Collapsed') 'JWT help did not close.'
    $toolsNav.IsChecked=$true
    Assert-Swsd ($toolsPage.Visibility -eq 'Visible' -and $homePage.Visibility -eq 'Collapsed') 'Tools navigation failed.'
    Assert-Swsd ($areaFilters.Children[0].Content -eq 'In Agent  51') 'Agent chip must show 51 tools.'
    Assert-Swsd ($otherTools.Header -eq 'Not in Agent · 94 tools · change profile to use these' -and $lockedTools.Children.Count -eq 94) 'Agent locked section must show all 94 tools.'
    $incidentChip=$areaFilters.Children | Where-Object {$_.Tag -eq 'Incidents'} | Select-Object -First 1
    Assert-Swsd ($incidentChip.Content -eq 'Incidents  15') 'Agent Incidents chip must show 15 tools.'
    Invoke-SwsdTestClick $incidentChip
    Assert-Swsd ($toolGroups.Children[0].Text -eq 'Incidents  ·  15 tools in Agent') 'Incident heading must match the chip membership.'
    Assert-Swsd ($otherTools.Header -eq 'Not in Agent · 94 tools · change profile to use these' -and $lockedTools.Children.Count -eq 94) 'Area selection must not shrink the locked catalog.'
    $incidentRows=$toolGroups.Children[1].Child
    $more=$incidentRows.Children | Where-Object {$_ -is [Windows.Controls.Button] -and $_.Content -is [string]} | Select-Object -First 1
    Invoke-SwsdTestClick $more
    Assert-Swsd ($toolGroups.Children[1].Child.Children.Count -eq 15) 'Expanded incident rows must match the chip count.'
    Assert-SwsdProfileLabels
    $search.Text='delete incident'
    Assert-Swsd ($detailId.Text -eq 'swsd_delete_incident' -and $deleteNotice.Visibility -eq 'Visible' -and $switchProfile.Visibility -eq 'Visible') 'Locked delete search must show its details, safety note, and profile action.'
    Assert-Swsd ($detailProfiles.Text -eq 'in Operations') 'Delete profile label must show Operations once.'
    Assert-Swsd ($otherTools.Visibility -eq 'Collapsed') 'Searching must hide the not-in-profile expander.'
    $deleteBadgeTexts=@(Get-SwsdControlText $detailBadge)
    Assert-Swsd ($deleteBadgeTexts -contains 'Delete' -and $deleteBadgeTexts -contains ([string][char]0xE74D)) 'Delete detail badge must show its trash glyph.'
    Assert-SwsdProfileLabels
    $search.Text='[no literal match*'
    Assert-Swsd ($toolGroups.Children.Count -eq 2) 'Search wildcard characters must remain literal.'
    $search.Clear(); $script:SwsdArea=''; $script:SwsdExpandedAreas.Clear(); $homeNav.IsChecked=$true
    # Check all update presentations using a version probe; never invoke an installer.
    $script:SwsdStatusProbe=(Get-Item Function:Get-SwsdStatus).ScriptBlock
    $installProbe=(Get-Item Function:Start-SwsdInstall).ScriptBlock
    $oldUpdateState=$script:SwsdUpdateState; $oldLatest=$script:SwsdLatestVersion
    try {
        function script:Get-SwsdStatus {$s=& $script:SwsdStatusProbe; $s.installedVersion=$script:SwsdPackageVersion; return $s}
        function script:Start-SwsdInstall {param($Operation) $script:SwsdOperationProbe=$Operation}
        $v=[version]$script:SwsdPackageVersion
        $script:SwsdLatestVersion="$($v.Major).$($v.Minor).$($v.Build+1)"; $script:SwsdUpdateState='checked'
        Update-SwsdDashboard
        Assert-Swsd ($updatesDescription.Text -eq "Version $($script:SwsdLatestVersion) is available") 'Update row description must be clean.'
        Assert-Swsd ($checkUpdates.Content -eq 'Update' -and $checkUpdates.Style -eq $form.Resources['PrimaryButton'] -and (Test-SwsdUpdateAvailable)) 'A newer version must offer the primary Update action.'
        Invoke-SwsdTestClick $checkUpdates
        Assert-Swsd ($script:SwsdOperationProbe -eq 'Update') 'Update must invoke the latest-version installer.'
        $script:SwsdLatestVersion=$script:SwsdPackageVersion
        foreach ($state in @('checked','unchecked','offline')) {
            $script:SwsdUpdateState=$state; Update-SwsdDashboard
            Assert-Swsd ($checkUpdates.Content -eq 'Check now' -and $checkUpdates.Style -ne $form.Resources['PrimaryButton'] -and -not (Test-SwsdUpdateAvailable)) 'Current, unchecked and offline states must offer the default Check now action.'
            Invoke-SwsdTestClick $checkUpdates
            Assert-Swsd ($script:SwsdOperationProbe -eq 'CheckUpdates') 'Check now must invoke the update check.'
        }
    } finally {
        Set-Item Function:Get-SwsdStatus $script:SwsdStatusProbe
        Set-Item Function:Start-SwsdInstall $installProbe
        $script:SwsdUpdateState=$oldUpdateState; $script:SwsdLatestVersion=$oldLatest; Update-SwsdDashboard
    }
    Assert-Swsd ($script:SwsdHandlerErrors.Count -eq 0) ('Unhandled WPF event errors: ' + ($script:SwsdHandlerErrors -join '; '))
    # Exercise the builder's real click handlers and shared picker binding.
    $search.Text=''; $profileBuilder.IsExpanded=$true
    Invoke-SwsdTestClick $newCustom
    foreach ($check in $customTools.Children) {$check.IsChecked=$check.Tag -in @('swsd_get_incident','swsd_list_my_incidents')}
    $customName.Text='Follow-up'; $customDescription.Text='Two incident tools'
    Invoke-SwsdTestClick $saveCustom
    Assert-Swsd ((Get-SwsdSettings).profile -eq 'custom' -and $profile.SelectedItem -eq 'Follow-up' -and $toolsProfile.SelectedIndex -eq $profile.SelectedIndex) 'Builder did not configure a shared custom selection.'
    Assert-Swsd (@(Get-SwsdProfileTools custom).Count -eq 2) 'Custom profile membership must use its selected tool names.'
    $customName.Text='Renamed follow-up'; Invoke-SwsdTestClick $renameCustom
    Assert-Swsd ($profile.SelectedItem -eq 'Renamed follow-up') 'Rename did not refresh both pickers.'
    $script:SwsdDialogProbe=Join-Path $script:SwsdHome 'profile-export.json'
    function Select-SwsdProfileFile {param($Save) return $script:SwsdDialogProbe}
    Invoke-SwsdTestClick $exportCustom
    Assert-Swsd ((Read-SwsdProfileFile $script:SwsdDialogProbe).tools.Count -eq 2) 'Export button did not write a profile.'
    Invoke-SwsdTestClick $deleteCustom
    Assert-Swsd ((Get-SwsdSettings).profile -eq 'agent' -and $profile.Items.Count -eq 4) 'Delete did not restore the built-in picker.'
    Invoke-SwsdTestClick $importCustom
    Assert-Swsd ($status.Text -like '*Profile imported*' -and $customName.Text -eq 'Renamed follow-up') 'Import button did not load the exported profile.'
    '{"name":"Invalid","version":1,"tools":[],"extra":true}' | Set-Content -LiteralPath $script:SwsdDialogProbe
    Invoke-SwsdTestClick $importCustom
    Assert-Swsd ($status.Text -like '*Profile JSON:*Only*' -and $toast.Visibility -eq 'Visible') 'Invalid import must show a friendly banner.'
    Invoke-SwsdTestClick $releaseNotes
    Assert-Swsd ($whatsNewPage.Visibility -eq 'Visible' -and $releaseNoteContent.Children.Count -gt 5) 'What''s new must render bundled release notes in-app.'
    Assert-Swsd ($releaseNoteContent.Children[0].Text -ceq 'Upcoming' -and $pageSubtitle.Text -ceq 'Release notes for SWSD for AI apps') 'What''s new must label bundled Unreleased notes as Upcoming and explain the page.'
    Assert-Swsd (@($releaseNoteContent.Children | Where-Object {$_.Text -cmatch '\bFull\b'}).Count -gt 0) 'Release notes must retain the explanation of Full.'
    Assert-SwsdProfileLabels
    Invoke-SwsdTestClick $closeWhatsNew
    $script:SwsdOpenedUrls=@()
    function Start-Process {param($FilePath) $script:SwsdOpenedUrls+= $FilePath}
    Invoke-SwsdTestClick $reportBug; Invoke-SwsdTestClick $requestFeature
    Assert-Swsd ($script:SwsdOpenedUrls.Count -eq 2 -and $script:SwsdOpenedUrls[0] -like '*template=bug_report.yml*' -and $script:SwsdOpenedUrls[1] -like '*template=feature_request.yml*') 'Issue buttons must use the matching prefill helper.'
    Assert-Swsd ($script:SwsdHandlerErrors.Count -eq 0) 'Companion handlers must not throw.'
    # Use exactly the same fixture as ValidateWindow. Measure without showing a
    # window, changing display settings, or accessing the desktop framebuffer.
    foreach ($state in @('ready','tools','profile-builder','custom-selected','import-error','whats-new')) {
        Set-SwsdPreviewFixture $state
        if ($state -eq 'ready') {Assert-SwsdUiEncoding}
        Wait-SwsdDispatcher 100
        $appRoot.Measure([Windows.Size]::new(1000,1000)); $appRoot.Arrange([Windows.Rect]::new(0,0,1000,1000)); $appRoot.UpdateLayout()
        Wait-SwsdDispatcher 50
        $appRoot.UpdateLayout()
        switch ($state) {
            ready {Assert-Swsd ($tokenPlaceholder.Text -eq '••••••••' -and $tokenDescription.Text -ceq 'Verified just now' -and $reportBug.Content -ceq 'Report a bug' -and $requestFeature.Content -ceq 'Request a feature') 'Ready preview copy is incorrect.'}
            tools {Assert-Swsd ($toolsPage.Visibility -eq 'Visible') 'Tools preview is missing.'}
            profile-builder {Assert-Swsd ($profileBuilder.IsExpanded -and $customTools.Children.Count -eq 145 -and $customName.Text -eq 'Incident follow-up') 'Builder preview is incomplete.'}
            custom-selected {Assert-Swsd ((Get-SwsdSettings).profile -eq 'custom' -and $profile.SelectedItem -eq 'Incident follow-up' -and @(Get-SwsdProfileTools custom).Count -eq 3) 'Custom preview must configure the server selection.'}
            import-error {Assert-Swsd ($toast.Visibility -eq 'Visible' -and $status.Text -like 'Profile JSON:*') 'Import-error preview must show a friendly banner.'}
            whats-new {Assert-Swsd ($whatsNewPage.Visibility -eq 'Visible' -and $releaseNoteContent.Children.Count -gt 5) 'Release notes preview is missing.'}
        }
        if ($env:SWSD_HEADLESS_SHOTS) {[SwsdDesktop.WpfDpi]::Capture($appRoot,(Join-Path $env:SWSD_HEADLESS_SHOTS ($state+'.png')))}
        Assert-Swsd ($script:SwsdHandlerErrors.Count -eq 0) ('Preview handler failed: '+$state)
    }
    Write-Output 'PASS: WPF controls and shared profile pickers; custom builder save/rename/delete/export/import and errors; issue buttons and bundled release notes; all six companion previews; Appearance, search, tool details, and masked credentials; no desktop or clipboard access.'
}

function Set-SwsdPreviewFixture([string]$PreviewState) {
    $theme=if ($PreviewTheme) {Resolve-SwsdThemeId $PreviewTheme} else {'system'}
    Save-SwsdSettings -BaseUrl 'https://api.samanage.com' -Profile agent -Theme $theme
    Update-SwsdProfilePickers
    $script:SwsdSyncing=$true; Set-SwsdAppearanceSelection $theme; $script:SwsdSyncing=$false; Set-SwsdTheme
    [SwsdDesktop.Credentials]::Remove($script:SwsdCredentialTarget)
    $script:SwsdVerified=$false; $script:SwsdTokenError=$false; $script:SwsdIdentity=$null
    $script:SwsdSelectedTool='swsd_list_my_incidents'; $script:SwsdArea=''; $script:SwsdExpandedAreas=@{}
    $tokenBox.Clear(); $search.Text=''; $toast.Visibility='Collapsed'
    $profileBuilder.IsExpanded=$false; $homeNav.IsChecked=$true; Set-SwsdPage

    # Deterministic presentation fixture. All credential operations stay in memory;
    # no network, installer, user settings or clipboard is available in this mode.
    function script:Get-SwsdStatus {
        $s=Get-SwsdSettings
        return [pscustomobject]@{nodePath=''; nodeVersion='24.15.0'; nodeSupported=$true; toolsInstalled=$true; credentialSaved=[SwsdDesktop.Credentials]::Exists($script:SwsdCredentialTarget); credentialAvailable=$true; packageVersion=$script:SwsdPackageVersion; installedVersion=$script:SwsdPackageVersion; profile=$s.profile; region=$(if ($s.baseUrl -eq 'https://apieu.samanage.com') {'EU'} else {'US'}); baseUrl=$s.baseUrl}
    }
    function script:Test-SwsdToken {throw 'Network is forbidden in window validation.'}
    function script:Get-SwsdVerifiedIdentity {throw 'Network is forbidden in window validation.'}
    function script:Install-SwsdTools {throw 'Installation is forbidden in window validation.'}
    function script:Update-SwsdRuntime {throw 'Installation is forbidden in window validation.'}
    function script:Install-SwsdNode {throw 'Installation is forbidden in window validation.'}
    function script:Get-SwsdLatestVersion {throw 'Network is forbidden in window validation.'}
    function script:Set-SwsdClipboard {throw 'Clipboard is forbidden in window validation.'}
    $script:SwsdUpdateState='checked'; $script:SwsdLatestVersion=$script:SwsdPackageVersion
    if ($PreviewState -ne 'firstrun') {
        [SwsdDesktop.Credentials]::Save($script:SwsdCredentialTarget,('synthetic'+[guid]::NewGuid().ToString('N')))
        $script:SwsdVerified=$true; $script:SwsdIdentity='Alex Rivera · Acme IT'
        Set-SwsdStatus -Kind success -Text '✓  Connected as Alex Rivera · Acme IT (US)'
    }
    if ($PreviewState -in @('ready','appearance','jwt-help','tools','tool-detail')) {$script:SwsdLatestVersion=([version]$script:SwsdPackageVersion).Major.ToString()+'.'+([version]$script:SwsdPackageVersion).Minor+'.'+(([version]$script:SwsdPackageVersion).Build+1)}
    if ($PreviewState -eq 'error') {
        $script:SwsdVerified=$false; $script:SwsdTokenError=$true
        $tokenBox.Password='synthetic'+[guid]::NewGuid().ToString('N')
        Set-SwsdStatus -Kind error -Text 'SolarWinds rejected this token. Check that you copied the complete JSON Web Token.'
    }
    Update-SwsdDashboard
    if ($PreviewState -in @('ready','appearance')) {
        Assert-Swsd ($checkUpdates.Content -eq 'Update' -and $checkUpdates.Style -eq $form.Resources['PrimaryButton']) 'Ready preview must show the primary Update button.'
        Assert-Swsd ($updatesDescription.Text -eq "Version $($script:SwsdLatestVersion) is available") 'Ready preview must show the clean update description.'
    }
    if ($PreviewState -eq 'jwt-help') {Set-SwsdJwtHelp $true}
    if ($PreviewState -in @('tools','tool-detail')) {$toolsNav.IsChecked=$true; $script:SwsdArea='Incidents'; Update-SwsdTools}
    if ($PreviewState -eq 'tool-detail') {$search.Text='delete incident'}
    if ($PreviewState -in @('profile-builder','custom-selected','import-error')) {
        $result=Save-SwsdCustomProfile ([pscustomobject]@{name='Incident follow-up'; version=1; description='Incidents and comments for daily follow-up'; tools=@('swsd_list_my_incidents','swsd_get_incident','swsd_add_incident_comment')})
        Update-SwsdProfilePickers
        if ($PreviewState -eq 'custom-selected') {
            Save-SwsdProfile -Profile custom -ProfileFile $result.path
            Update-SwsdProfilePickers; Update-SwsdDashboard; Update-SwsdTools
            Set-SwsdProfileEditor $result.path
        } else {
            $toolsNav.IsChecked=$true; Set-SwsdProfileEditor $result.path; $profileBuilder.IsExpanded=$true
        }
        if ($PreviewState -eq 'import-error') {
            $bad=Join-Path $script:SwsdHome 'invalid-profile.json'
            '{"name":"Broken profile","version":1,"tools":[],"extra":true}' | Set-Content -LiteralPath $bad
            Import-SwsdProfileFromPath $bad
        }
    }
    if ($PreviewState -eq 'whats-new') {Show-SwsdWhatsNew}

}

try {
if ($ValidateUi) {
    Test-SwsdUiControls
    if ($PreviewTheme) {
        Set-SwsdPreviewFixture $PreviewState
        Assert-Swsd ($script:SwsdThemeId -eq (Resolve-SwsdThemeId $PreviewTheme)) 'Requested preview theme was not applied.'
        Write-Output ('PASS: isolated preview '+$script:SwsdThemeId+'; dark caption='+$script:SwsdDarkMode+'; solid palette='+(-not $script:SwsdUseMica))
    }
} elseif ($ValidateHandlers) {
    $script:SwsdMockCalls=New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
    $script:SwsdMockInstallFails=$false; $script:SwsdMockNodeFails=$false
    $script:SwsdMockLatestVersion=$script:SwsdPackageVersion
    $script:SwsdMockNodeSupported=$false; $script:SwsdMockNodeConfirm='Yes'; $script:SwsdMockRemoveConfirm='Yes'
    $script:SwsdMockTokenFails=$false; $script:SwsdClipboardText=$null
    $script:SwsdRealGetStatus=(Get-Item Function:Get-SwsdStatus).ScriptBlock
    function script:Get-SwsdStatus {$s=& $script:SwsdRealGetStatus; $s.nodeSupported=$script:SwsdMockNodeSupported; return $s}
    function script:Get-SwsdLatestVersion {$script:SwsdMockCalls.Enqueue('update-check'); Start-Sleep -Milliseconds 350; if ($script:SwsdMockInstallFails) {throw 'Synthetic worker failure.'}; return $script:SwsdMockLatestVersion}
    function script:Install-SwsdNode {$script:SwsdMockCalls.Enqueue('node-install'); Start-Sleep -Milliseconds 350; if ($script:SwsdMockInstallFails) {throw 'Node.js installation failed.'}}
    function script:Confirm-SwsdNodeInstall {$script:SwsdMockCalls.Enqueue('node-confirm'); return $script:SwsdMockNodeConfirm}
    function script:Confirm-SwsdRemove {return $script:SwsdMockRemoveConfirm}
    function script:Install-SwsdTools {
        param($SourceRoot,[switch]$Force)
        if (-not $Force) {throw 'Repair must force installation.'}
        $script:SwsdMockCalls.Enqueue('install'); Start-Sleep -Milliseconds 350
        if ($script:SwsdMockInstallFails) {throw 'mock install failure'}
        $entry=Get-SwsdEntryPoint
        New-Item -ItemType Directory -Path (Split-Path $entry) -Force | Out-Null
        Set-Content -LiteralPath $entry -Value '// isolated UI fixture'
        @{version=$script:SwsdPackageVersion} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path (Split-Path $entry)) 'package.json')
    }
    function script:Update-SwsdRuntime {
        $script:SwsdMockCalls.Enqueue('update-latest'); Start-Sleep -Milliseconds 350
        if ($script:SwsdMockInstallFails) {throw 'mock install failure'}
        $entry=Join-Path $script:SwsdHome "runtime\$script:SwsdMockLatestVersion\node_modules\swsd-mcp\dist\cli.js"
        New-Item -ItemType Directory -Path (Split-Path $entry) -Force | Out-Null
        Set-Content -LiteralPath $entry -Value '// isolated UI fixture'
        @{version=$script:SwsdMockLatestVersion} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path (Split-Path $entry)) 'package.json')
        Set-SwsdActiveVersion $script:SwsdMockLatestVersion
    }
    function script:Test-SwsdToken {
        param($Token,$BaseUrl)
        $script:SwsdMockCalls.Enqueue('test')
        if ($BaseUrl -notin @('https://api.samanage.com','https://apieu.samanage.com')) {throw 'Unexpected test destination.'}
        if ($script:SwsdMockTokenFails) {throw 'SolarWinds rejected this token (401).'}
    }
    # Presentation fixture only; no fabricated HTTP response is used as upstream evidence.
    function script:Get-SwsdVerifiedIdentity {param($Token,$BaseUrl) return 'Alex Rivera · Acme IT'}
    function script:Set-SwsdClipboard {param([string]$Text) $script:SwsdMockCalls.Enqueue('clipboard'); $script:SwsdClipboardText=$Text}
    Test-SwsdAppearanceControls
    $buttons=@($install,$checkUpdates,$nodeInstallButton,$test,$remove,$copyDiagnostics,$copyPrompt)
    function Assert-SwsdAction($Button,[string]$Expected,[switch]$Worker) {
        $script:SwsdHandlerErrors=@(); $Button.IsEnabled=$true
        Invoke-SwsdTestClick $Button
        if ($Worker) {
            Assert-Swsd ($null -ne $script:SwsdInstallWorker) 'Button did not start its worker.'
            foreach ($b in $buttons) {Assert-Swsd (-not $b.IsEnabled) 'Action remained enabled while worker was running.'}
            $original=$script:SwsdInstallWorker
            Invoke-SwsdTestClick $Button
            Assert-Swsd ($script:SwsdInstallWorker -eq $original) 'Duplicate worker was started.'
            $closing=New-Object ComponentModel.CancelEventArgs
            $form.GetType().GetMethod('OnClosing',[Reflection.BindingFlags]'Instance,NonPublic').Invoke($form,@($closing.PSObject.BaseObject))
            Assert-Swsd $closing.Cancel 'Closing would abandon the active worker.'
            $deadline=[DateTime]::UtcNow.AddSeconds(15)
            while ($script:SwsdInstallWorker -and [DateTime]::UtcNow -lt $deadline) {Wait-SwsdDispatcher}
            Assert-Swsd ($null -eq $script:SwsdInstallWorker -and -not $script:SwsdInstallTimer.IsEnabled) 'Worker did not finish and stop its timer.'
            Assert-Swsd ($script:SwsdInstallPollCount -ge 2) 'Dispatcher did not stay responsive.'
        }
        Assert-Swsd ($status.Text -like "*$Expected*") ("Unexpected status: " + $status.Text + '; expected ' + $Expected)
        Assert-Swsd ($script:SwsdHandlerErrors.Count -eq 0) ('Unhandled handler: ' + ($script:SwsdHandlerErrors -join '; '))
        foreach ($b in $buttons) {Assert-Swsd $b.IsEnabled 'An action remained disabled.'}
    }
    Assert-SwsdAction $checkUpdates 'Latest published swsd-mcp' -Worker
    Assert-SwsdAction $install 'Tools installed' -Worker
    Assert-Swsd ($ToolsValue.Text -eq ('swsd-mcp '+$script:SwsdPackageVersion)) 'Installed dashboard did not refresh.'
    Assert-SwsdAction $checkUpdates 'is up to date' -Worker
    $script:SwsdMockLatestVersion='99.0.0'
    Assert-SwsdAction $checkUpdates 'is available' -Worker
    Assert-Swsd ($UpdateChipText.Text -eq '● Update') 'Available update badge missing.'
    Assert-Swsd ($checkUpdates.Content -eq 'Update' -and $updatesDescription.Text -eq 'Version 99.0.0 is available') 'Newer version must offer Update with a clean description.'
    $calls=$script:SwsdMockCalls.Count
    Assert-SwsdAction $checkUpdates 'Tools installed' -Worker
    Assert-Swsd ($script:SwsdMockCalls.Count -eq $calls+1 -and $script:SwsdMockCalls.ToArray()[-1] -eq 'update-latest') 'Update must invoke the latest installer.'
    Assert-Swsd ((Get-SwsdInstalledVersion) -eq '99.0.0' -and (Get-SwsdStatus).toolsInstalled) 'Updated active runtime must count as installed.'
    Set-SwsdActiveVersion $script:SwsdPackageVersion
    $script:SwsdUpdateState='unchecked'; Update-SwsdDashboard
    $script:SwsdMockLatestVersion='0.0.1'
    Assert-SwsdAction $checkUpdates 'is newer than' -Worker
    $script:SwsdMockLatestVersion=$null
    Assert-SwsdAction $checkUpdates 'Could not check' -Worker
    Assert-Swsd (-not $script:SwsdLatestVersion -and $UpdateChipText.Text -eq 'Offline') 'Offline state retained stale metadata.'
    $script:SwsdMockInstallFails=$true
    Assert-SwsdAction $checkUpdates 'Could not check' -Worker
    $script:SwsdMockInstallFails=$false; $script:SwsdMockLatestVersion=$script:SwsdPackageVersion
    Assert-SwsdAction $checkUpdates 'is up to date' -Worker
    $script:SwsdMockNodeConfirm='No'
    $calls=$script:SwsdMockCalls.Count
    Assert-SwsdAction $nodeInstallButton 'cancelled'
    Assert-Swsd ($script:SwsdMockCalls.Count -eq $calls+1) 'Cancelled Node action still installed.'
    $script:SwsdMockNodeConfirm='Yes'
    Assert-SwsdAction $nodeInstallButton 'Node.js installed' -Worker
    $script:SwsdMockNodeFails=$true
    Assert-SwsdAction $nodeInstallButton 'Node.js installation failed' -Worker
    $script:SwsdMockNodeFails=$false
    Assert-SwsdAction $nodeInstallButton 'Node.js installed' -Worker
    $script:SwsdMockNodeSupported=$true
    Assert-SwsdAction $nodeInstallButton 'already installed'
    $secret='synthetic'+[guid]::NewGuid().ToString('N')
    $tokenBox.Password=$secret
    Assert-SwsdAction $test 'Connected as'
    Assert-Swsd ($tokenBox.SecurePassword.Length -eq 0 -and $script:SwsdVerified) 'Test did not save/clear the entered secret.'
    Assert-Swsd ($tokenDescription.Text -ceq 'Verified just now' -and $tokenPlaceholder.Text -eq '••••••••' -and $tokenVerified.Visibility -eq 'Visible') 'Saved verified credential must show a mask, check, and exact verification subtitle.'
    $region.SelectedIndex=1
    Assert-Swsd (-not $script:SwsdVerified) 'Changing region retained a verified banner.'
    Assert-Swsd ((Get-SwsdSettings).baseUrl -eq 'https://api.samanage.com') 'Untested region was persisted.'
    [SwsdDesktop.Credentials]::FailSave=$true; $tokenBox.Password=$secret
    Assert-SwsdAction $test 'could not be completed'
    Assert-Swsd ((Get-SwsdSettings).baseUrl -eq 'https://api.samanage.com') 'Credential failure did not roll back region.'
    [SwsdDesktop.Credentials]::FailSave=$false; $tokenBox.Password=$secret
    Assert-SwsdAction $test 'Connected as'
    Assert-Swsd ((Get-SwsdSettings).baseUrl -eq 'https://apieu.samanage.com') 'Verified region was not saved.'
    $script:SwsdMockTokenFails=$true
    Assert-SwsdAction $test 'rejected this token'
    Assert-Swsd (-not $script:SwsdVerified -and $script:SwsdTokenError -and $TokenChipText.Text -eq '× Invalid') 'Failed verification retained verified state.'
    $script:SwsdMockTokenFails=$false
    Assert-SwsdAction $test 'Connected as'
    @('safe log line',('Authorization: Bearer '+$secret),$secret,('fragment '+$secret.Substring(7,8))) | Set-Content -LiteralPath $script:SwsdDiagnosticsLogPath -Encoding UTF8
    $reads=[SwsdDesktop.Credentials]::ReadCount
    Assert-SwsdAction $copyDiagnostics 'Diagnostics copied'
    Assert-Swsd ([SwsdDesktop.Credentials]::ReadCount -eq $reads) 'Diagnostics read a credential.'
    Assert-Swsd ($script:SwsdClipboardText.Contains('Credential PRESENT: yes') -and $script:SwsdClipboardText.Contains('[REDACTED]')) 'Diagnostics are missing presence or redaction.'
    for ($i=0;$i -le $secret.Length-8;$i++) {Assert-Swsd (-not $script:SwsdClipboardText.Contains($secret.Substring($i,8))) 'Diagnostics leaked a secret fragment.'}
    $profile.SelectedIndex=2
    Assert-Swsd ((Get-SwsdSettings).profile -eq 'knowledge' -and (Get-SwsdSettings).baseUrl -eq 'https://apieu.samanage.com') 'Profile save changed connection settings.'
    Set-SwsdToolDetail 'swsd_list_my_incidents'; Invoke-SwsdTestClick $copyPrompt
    Assert-Swsd ($script:SwsdClipboardText -eq 'Show my open P1 incidents') 'Copy prompt copied unexpected text.'
    $script:SwsdMockRemoveConfirm='No'; Invoke-SwsdTestClick $remove
    Assert-Swsd ([SwsdDesktop.Credentials]::Exists($script:SwsdCredentialTarget)) 'Cancelled removal deleted a credential.'
    $script:SwsdMockRemoveConfirm='Yes'
    Assert-SwsdAction $remove 'removed'
    Assert-SwsdAction $test 'No JSON Web Token is saved'
    $script:SwsdMockInstallFails=$true
    Assert-SwsdAction $install 'mock install failure' -Worker
    Invoke-SwsdTestClick $showDetails
    Assert-Swsd ($errorDetails.Visibility -eq 'Visible') 'Error details did not open.'
    Invoke-SwsdTestClick $showDetails
    Assert-Swsd ($errorDetails.Visibility -eq 'Collapsed') 'Error details did not close.'
    $script:SwsdMockInstallFails=$false
    Assert-SwsdAction $install 'Tools installed' -Worker
    $unsafe=Format-SwsdFriendlyError ([Exception]::new($secret))
    Assert-Swsd (-not $unsafe.Friendly.Contains($secret) -and -not $unsafe.Technical.Contains($secret)) 'Raw exception data was exposed.'
    Invoke-SwsdSafe -Source 'probe' {throw 'synthetic handler crash'}
    Assert-Swsd ($status.Text -like '*Something went wrong*' -and $test.IsEnabled) 'Last-resort handler did not recover.'
    $script:SwsdHandlerErrors=@()
    Write-Output 'PASS: actual WPF events under StrictMode; isolated credential save/test/remove, failure/rollback and region invalidation; mocked clipboard diagnostics/prompt; redaction; background install/update/Node failure/retry, responsive timer, duplicate and close guards; profile persistence; friendly error recovery.'
} elseif ($ValidateWindow) {
    Set-SwsdPreviewFixture $PreviewState
    Assert-SwsdUiEncoding
    Set-SwsdBusy $true; $progressBar.Visibility='Collapsed'; $appRoot.IsHitTestVisible=$false
    if ($ScreenshotPath) {
        $form.Height=switch ($PreviewState) {'appearance' {1350} 'jwt-help' {1350} 'tools' {1400} 'tool-detail' {1100} default {1000}}
    }
    $form.MinWidth=0; $form.MinHeight=0
    $script:SwsdWindowResults=New-Object 'System.Collections.Generic.List[object]'
    $script:SwsdDpiSteps=New-Object 'System.Collections.Generic.Queue[object]'
    $script:SwsdDpiStep='initial'
    if ($ValidateDpiChanges) {
        foreach ($monitor in [SwsdDesktop.WpfDpi]::Monitors()) {$script:SwsdDpiSteps.Enqueue(@{Monitor=$monitor; Name=('monitor '+$monitor.Name)})}
        foreach ($dpi in @(96,120,144,168,192,168,144,120,96)) {$script:SwsdDpiSteps.Enqueue(@{Dpi=$dpi; Name="WM_DPICHANGED $dpi"})}
    }
    $probe=New-Object Windows.Threading.DispatcherTimer
    $probe.Interval=[TimeSpan]::FromMilliseconds(200)
    $watchdog=New-Object Windows.Threading.DispatcherTimer
    $watchdog.Interval=[TimeSpan]::FromSeconds(30)
    $watchdog.Add_Tick({$watchdog.Stop(); $probe.Stop(); $form.Close()})
    $probe.Add_Tick({param($sender,$e) Invoke-SwsdSafe -Source 'WindowProbe' {
        $probe.Stop(); $form.UpdateLayout()
        $liveThemeSwitches=@()
        if ($PreviewTheme -and $PreviewState -eq 'ready' -and $script:SwsdDpiStep -eq 'initial') {
            # Exercise Mica -> named dark -> named light -> Mica on this actual HWND.
            foreach ($id in @('light','dracula','catppuccin-latte','dark')) {
                Set-SwsdAppearanceSelection $id
                $backdrop=[SwsdDesktop.Windows]::ReadWindowAttribute($script:SwsdHandle,38)
                $caption=[SwsdDesktop.Windows]::ReadWindowAttribute($script:SwsdHandle,20)
                if ($caption -ge 0) {Assert-Swsd ($caption -eq [int]$script:SwsdDarkMode) 'DWM caption did not apply live.'}
                if ($id -notin @('light','dark')) {
                    Assert-Swsd (-not $script:SwsdMicaEnabled -and $appRoot.Background -is [Windows.Media.SolidColorBrush] -and $appRoot.Background.Opacity -eq 1) 'Live named theme retained Mica or translucency.'
                    if ($backdrop -ge 0) {Assert-Swsd ($backdrop -eq 1) 'DWM retained a system backdrop on a named theme.'}
                } elseif ($script:SwsdMicaEnabled -and $backdrop -ge 0) {Assert-Swsd ($backdrop -eq 2) 'DWM did not restore Mica.'}
                $liveThemeSwitches+=$id
            }
            Set-SwsdPreviewFixture $PreviewState
            $form.UpdateLayout()
        }
        Assert-SwsdUiEncoding
        $failures=@($script:SwsdHandlerErrors)
        $awareness=[SwsdDpiBootstrap]::WindowAwareness($script:SwsdHandle)
        if ($awareness -ne 'PerMonitorV2') {$failures+='Window did not inherit PerMonitorV2 awareness.'}
        $dpi=[Windows.Media.VisualTreeHelper]::GetDpi($appRoot)
        $actualDpi=[int][Math]::Round($dpi.PixelsPerInchX)
        if ($actualDpi -ne $script:SwsdDpi.DeviceDpi) {$failures+="Visual DPI $actualDpi differs from message DPI $($script:SwsdDpi.DeviceDpi)."}
        foreach ($control in @($region,$profile,$appearance,$test,$tokenBox,$copyDiagnostics)) {if ($control.IsVisible -and $control.ActualHeight -lt 31) {$failures+='An account/maintenance control is clipped.'}}
        foreach ($input in @($customName,$customDescription,$search)) {
            if ($input.IsVisible -and $input.Text.Length -gt 0) {
                $rect=$input.GetRectFromCharacterIndex(0)
                if ($rect.IsEmpty -or $rect.Height -lt $input.FontSize -or $rect.Bottom -gt $input.ActualHeight) {$failures+='Input text is clipped by its template.'}
            }
        }
        if ($statusGrid.IsVisible) {
            $cells=@(foreach ($id in $rowNames) {$form.FindName($id+'Cell')})
            $widths=@($cells | ForEach-Object {[Math]::Round($_.ActualWidth,4)} | Sort-Object -Unique)
            $heights=@($cells | ForEach-Object {[Math]::Round($_.ActualHeight,4)} | Sort-Object -Unique)
            if ($widths.Count -gt 2 -or ($widths[-1]-$widths[0]) -gt 1.1) {$failures+='Dashboard columns are uneven.'}
            if ($heights.Count -gt 2 -or ($heights[-1]-$heights[0]) -gt 1.1) {$failures+='Dashboard rows are uneven.'}
        }
        $area=[SwsdDesktop.WpfDpi]::WorkingArea($script:SwsdHandle)
        $foreground=[SwsdDesktop.Windows]::GetForegroundWindow()
        $result=@{
            dpiStep=$script:SwsdDpiStep; dpiAwarenessPath=$script:SwsdDpiAwarenessPath; windowDpiAwareness=$awareness; deviceDpi=$actualDpi
            dashboardWidth=$statusGrid.ActualWidth; dashboardMinimumWidth=0; dashboardColumnWidth=($statusGrid.ActualWidth/$statusGrid.Columns); dashboardColumnWidths=@($statusGrid.ActualWidth/$statusGrid.Columns); dashboardParentWidth=$dashboard.ActualWidth; dashboardColumns=$statusGrid.Columns
            dashboardChipWidth=$NodeChip.ActualWidth; dashboardChipHeight=$NodeChip.ActualHeight
            visible=$form.IsVisible; foreground=($foreground -eq $script:SwsdHandle); foregroundAvailable=($foreground -ne [IntPtr]::Zero); behindForeground=[SwsdDesktop.Windows]::IsBehindForeground($script:SwsdHandle); alwaysOnTop=$form.Topmost; presentationCount=$script:SwsdPresentationCount
            consoleVisible=[SwsdDesktop.Windows]::IsWindowVisible([SwsdDesktop.Windows]::GetConsoleWindow()); tokenEntryEnabled=$tokenBox.IsEnabled
            workingAreaWidth=$area.Width; workingAreaHeight=$area.Height; formWidth=$form.ActualWidth; clientWidth=$appRoot.ActualWidth; formHeight=$form.ActualHeight; clientHeight=$appRoot.ActualHeight; preferredClientHeight=$homePage.DesiredSize.Height; frameHeight=0
            layoutFailures=@($failures); layoutNotes=@(); previewState=$PreviewState; renderer='WPF'; micaEnabled=$script:SwsdMicaEnabled
            themeId=$script:SwsdThemeId; resolvedThemeId=$script:SwsdResolvedThemeId; darkCaption=$script:SwsdDarkMode; canvasColor=$form.Resources['Canvas'].Color.ToString()
            liveThemeSwitches=$liveThemeSwitches
            updateButton=[string]$checkUpdates.Content; updateDescription=$updatesDescription.Text; notInProfileHeader=[string]$otherTools.Header
            statusText=$status.Text; tokenMask=$tokenPlaceholder.Text; verifiedGlyph=$tokenVerified.Text; tokenHelpText=[string]$findToken.Content
            captionGlyphs=@([string]$minimize.Content,[string]$maximize.Content,[string]$closeWindow.Content)
            appearanceDropDownOpen=$false; appearancePopupOpen=$false
        }
        $popupChild=$null
        if ($PreviewState -eq 'appearance') {
            # Open the real themed popup after Loaded/layout, with user input blocked.
            $appearance.IsEnabled=$true; $appearance.IsDropDownOpen=$true
            Wait-SwsdDispatcher 150; $form.UpdateLayout()
            $popup=$appearance.Template.FindName('PART_Popup',$appearance)
            Assert-Swsd ($appearance.IsDropDownOpen -and $popup.IsOpen -and $popup.Child.IsVisible) 'Appearance preview must show the actual dropdown.'
            $popupChild=$popup.Child
            $visuals=New-Object 'Collections.Generic.Queue[Windows.DependencyObject]'
            $visuals.Enqueue($popupChild); $popupScroll=$null
            while ($visuals.Count -gt 0 -and -not $popupScroll) {
                $visual=$visuals.Dequeue()
                if ($visual -is [Windows.Controls.ScrollViewer]) {$popupScroll=$visual; break}
                for ($i=0; $i -lt [Windows.Media.VisualTreeHelper]::GetChildrenCount($visual); $i++) {
                    $visuals.Enqueue([Windows.Media.VisualTreeHelper]::GetChild($visual,$i))
                }
            }
            Assert-Swsd ($null -ne $popupScroll) 'Appearance popup needs its scroll viewer.'
            $popupScroll.ScrollToHome()
            Wait-SwsdDispatcher 150; $form.UpdateLayout(); $popupChild.UpdateLayout()
            Assert-Swsd ($popupScroll.VerticalOffset -eq 0) 'Appearance preview must start with the Windows choices.'
            Assert-Swsd ($popupChild.ActualWidth -gt 0 -and $popupChild.ActualHeight -gt 0) 'Appearance popup must be laid out before capture.'
            $result.appearanceFirstItems=@($appearance.Items | Select-Object -First 3 | ForEach-Object {[string]$_.Content})
            $result.appearanceVerticalOffset=$popupScroll.VerticalOffset
            $result.appearanceDropDownOpen=$appearance.IsDropDownOpen; $result.appearancePopupOpen=$popup.IsOpen
            $result.appearancePopupWidth=$popupChild.ActualWidth; $result.appearancePopupHeight=$popupChild.ActualHeight
        }
        $script:SwsdWindowResults.Add($result)
        if ($ScreenshotPath -and $script:SwsdDpiStep -eq 'initial') {
            # Render the normal enabled appearance; input remains blocked at the root.
            # Network/install/clipboard operations also fail closed in this fixture.
            Set-SwsdBusy $false
            try {[SwsdDesktop.WpfDpi]::Capture($appRoot,[IO.Path]::GetFullPath($ScreenshotPath),$popupChild)}
            finally {Set-SwsdBusy $true; $progressBar.Visibility='Collapsed'}
        }
        if ($script:SwsdDpiSteps.Count -gt 0) {
            $step=$script:SwsdDpiSteps.Dequeue(); $script:SwsdDpiStep=$step.Name
            if ($step.ContainsKey('Monitor')) {[SwsdDesktop.WpfDpi]::Move($script:SwsdHandle,$step.Monitor,1000,1000)}
            else {[SwsdDesktop.WpfDpi]::SendDpi($script:SwsdHandle,$step.Dpi)}
            $probe.Start()
        } else {
            $watchdog.Stop(); $hold=New-Object Windows.Threading.DispatcherTimer
            $hold.Interval=[TimeSpan]::FromSeconds($WindowTestSeconds)
            $script:SwsdCloseTimer=$hold
            $hold.Add_Tick({$script:SwsdCloseTimer.Stop(); $form.Close()}); $hold.Start()
        }
    }})
    $form.Add_Loaded({$probe.Start(); $watchdog.Start()})
    try {
        [void]$form.ShowDialog()
        ConvertTo-Json -InputObject @($script:SwsdWindowResults.ToArray()) -Depth 5
        Assert-Swsd ($script:SwsdWindowResults.Count -gt 0 -and $script:SwsdDpiSteps.Count -eq 0) 'Window validation exceeded its watchdog.'
        foreach ($result in $script:SwsdWindowResults) {Assert-Swsd ($result.layoutFailures.Count -eq 0) ('Layout validation failed: '+($result.layoutFailures -join '; '))}
        foreach ($result in $script:SwsdWindowResults) {
            Assert-Swsd ($result.visible -and -not $result.alwaysOnTop -and $result.presentationCount -eq 1 -and -not $result.consoleVisible -and -not $result.tokenEntryEnabled) 'Setup window presentation check failed.'
            # Preserve the original presentation failure contract. check-dpi treats
            # unavailable headless foreground as soft only after layout/awareness
            # pass. An explicit PNG capture can still render that same visual tree.
            if (-not $ScreenshotPath) {Assert-Swsd ($result.foregroundAvailable -and -not $result.behindForeground) 'Setup window presentation check failed.'}
        }
    } finally {$probe.Stop(); $watchdog.Stop()}
} else {
    $themeTimer.Start()
    [void]$form.ShowDialog()
}
} finally {
    $themeTimer.Stop(); $script:SwsdInstallTimer.Stop(); $tokenBox.Clear()
    if ($null -eq $script:SwsdInstallWorker -and $form.IsVisible) {$form.Close()}
    Remove-SwsdUiFixture
}
