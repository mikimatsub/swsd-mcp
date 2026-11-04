param([switch]$CheckOnly, [switch]$ValidateUi, [switch]$ValidateWindow, [ValidateRange(1,15)][int]$WindowTestSeconds = 2)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
if ($ValidateUi -or $ValidateWindow) {
    # Exercise the real controls and save handler without touching a user's settings or credential.
    $script:SwsdHome = Join-Path ([IO.Path]::GetTempPath()) ('swsd-ui-test-' + [guid]::NewGuid().ToString('N'))
}
if ($CheckOnly) {
    $nodeOk = $false
    try { $null = Get-SwsdNode; $nodeOk = $true } catch {}
    [pscustomobject]@{
        nodeSupported = $nodeOk
        toolsInstalled = (Test-Path -LiteralPath (Get-SwsdEntryPoint))
        credentialSaved = (-not [string]::IsNullOrWhiteSpace([SwsdDesktop.Credentials]::Read($script:SwsdCredentialTarget)))
        packageVersion = $script:SwsdPackageVersion
        profile = (Get-SwsdSettings).profile
    } | ConvertTo-Json
    exit 0
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
# Last-resort safety net: never show the raw .NET "Unhandled exception" dialog.
$script:SwsdLayoutFailures = @()
[Windows.Forms.Application]::SetUnhandledExceptionMode([Windows.Forms.UnhandledExceptionMode]::CatchException)
[Windows.Forms.Application]::add_ThreadException({
    param($sender, $eventArgs)
    $message = $eventArgs.Exception.Message
    try { Add-Content -LiteralPath (Join-Path $env:TEMP 'swsd-settings.log') -Value ("{0:u} {1}" -f (Get-Date), $message) } catch {}
    try {
        if (Get-Command Set-SwsdStatus -ErrorAction SilentlyContinue) { Set-SwsdStatus -Kind error -Text "Something went wrong: $message" }
        foreach ($name in 'install','save','test','remove','saveProfile','region','tokenBox','profile') {
            $control = Get-Variable -Name $name -Scope Script -ValueOnly -ErrorAction SilentlyContinue
            if ($control -is [Windows.Forms.Control]) { $control.Enabled = $true }
        }
    } catch {}
})

# DPI awareness before any window is created
try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SwsdDpiBootstrap {
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("shcore.dll")] private static extern int SetProcessDpiAwarenessContext(IntPtr value);
    public static void Enable() {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); return; } catch {}
        try { SetProcessDPIAware(); } catch {}
    }
}
'@
    [SwsdDpiBootstrap]::Enable()
} catch {}

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
    protected override void WndProc(ref Message m) {
      base.WndProc(ref m);
      if (m.Msg == 0x000F || m.Msg == 0x0133) {
        using (Graphics g = Graphics.FromHwnd(Handle)) {
          Rectangle r = ClientRectangle;
          using (Pen back = new Pen(BackColor, 2)) { g.DrawRectangle(back, 1, 1, r.Width - 2, r.Height - 2); }
          int arrowWidth = SystemInformation.VerticalScrollBarWidth;
          Rectangle arrow = new Rectangle(r.Right - arrowWidth - 3, 1, arrowWidth + 2, r.Height - 2);
          using (SolidBrush b = new SolidBrush(BackColor)) { g.FillRectangle(b, arrow); }
          using (Pen inner = new Pen(BackColor)) { for (int i = 1; i <= 3; i++) g.DrawRectangle(inner, i, i, arrow.Left - i - 1, r.Height - 2 * i - 1); }
          int cx = arrow.Left + arrow.Width / 2, cy = arrow.Top + arrow.Height / 2;
          int w = Math.Max(3, arrowWidth / 4);
          using (Pen ap = new Pen(ArrowColor, Math.Max(1, arrowWidth / 12))) {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.DrawLines(ap, new Point[] { new Point(cx - w, cy - w / 2), new Point(cx, cy + w / 2), new Point(cx + w, cy - w / 2) });
          }
          g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.None;
          using (Pen border = new Pen(BorderColor)) { g.DrawRectangle(border, 0, 0, r.Width - 1, r.Height - 1); }
        }
      }
    }
  }
}
"@
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
        StatusWarnFg    = [Drawing.Color]::FromArgb(140, 110, 0)
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
        'Tools'     { return [char]0xE774 }
        'Key'       { return [char]0xE72E }
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

function ScalePx([int]$LogicalPx) {
    return [int][Math]::Round($LogicalPx * $script:SwsdUiScale)
}

function ScaleFont([double]$PointSize) {
    return [float]($PointSize * $script:SwsdUiScale)
}

# Layout constants (logical px at scale 1.0)
$script:SwsdCardPaddingH = 16
$script:SwsdCardPaddingV = 12
$script:SwsdCardGap = 12
$script:SwsdRowGap = 8
$script:SwsdRootPaddingH = 20
$script:SwsdRootPaddingV = 16
$script:SwsdButtonMinHeight = 32
$script:SwsdButtonPaddingH = 14
$script:SwsdButtonPaddingV = 4
$script:SwsdButtonGap = 8
$script:SwsdContentWidth = 560
$script:SwsdScreenMargin = 16

$form = New-Object Windows.Forms.Form
$form.Text = 'SolarWinds Service Desk Setup'
$form.StartPosition = 'Manual'
$form.FormBorderStyle = 'Sizable'
$form.MaximizeBox = $true
$form.MinimizeBox = $true
$form.AutoSize = $false
$form.AutoScaleMode = 'Dpi'
$form.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 10))
$form.BackColor = $script:SwsdPalette.WindowBg
$form.ForeColor = $script:SwsdPalette.TextPrimary

# DWM attributes applied after handle creation
$form.Add_HandleCreated({
    try {
        [SwsdDesktop.Windows]::ApplyDarkMode($form.Handle, $script:SwsdDarkMode)
        $osBuild = [Environment]::OSVersion.Version.Build
        if ($osBuild -ge 22621) { [SwsdDesktop.Windows]::ApplyMicaBackdrop($form.Handle) }
        if ($osBuild -ge 22000) { [SwsdDesktop.Windows]::ApplyRoundedCorners($form.Handle) }
    } catch {}
})

$script:SwsdPresentationCount = 0
$form.Add_Shown({
    # Start with the token field focused (or nothing), never a drop-down showing its focus frame.
    try { if ($tokenBox.Enabled) { $form.ActiveControl = $tokenBox } else { $form.ActiveControl = $null } } catch {}
    # Present once after the dialog has a visible handle, even when its console is hidden.
    [void]$form.BeginInvoke([Action]{
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
    })
    # Fade-in animation (skip during validation)
    if (-not $ValidateUi -and -not $ValidateWindow) {
        $form.Opacity = 0
        $fadeTimer = New-Object Windows.Forms.Timer
        $fadeTimer.Interval = 15
        $fadeSteps = 0
        $fadeTimer.Add_Tick({
            $fadeSteps++
            $form.Opacity = [Math]::Min(1.0, $fadeSteps / 10.0)
            if ($form.Opacity -ge 1.0) { $fadeTimer.Stop(); $fadeTimer.Dispose() }
        })
        $fadeTimer.Start()
    }
})

# Root layout panel
$rootPanel = New-Object Windows.Forms.TableLayoutPanel
$rootPanel.Dock = 'Fill'
$rootPanel.Padding = New-Object Windows.Forms.Padding((ScalePx $script:SwsdRootPaddingH), (ScalePx $script:SwsdRootPaddingV), (ScalePx $script:SwsdRootPaddingH), (ScalePx $script:SwsdRootPaddingV))
$rootPanel.ColumnCount = 1
$rootPanel.RowCount = 5
$rootPanel.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Percent', 100)))
$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
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
    $btn.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9.5))
    $textWidth = [Windows.Forms.TextRenderer]::MeasureText($Text, $btn.Font).Width
    $btn.Size = New-Object Drawing.Size(($textWidth + 2 * (ScalePx $script:SwsdButtonPaddingH) + 2), (ScalePx $script:SwsdButtonMinHeight))
    # Intentional disabled look: owner-draw so WinForms' muddy system gray is never used.
    $btn.Add_Paint({
        param($sender, $e)
        if ($sender.Enabled) { return }
        $rect = $sender.ClientRectangle
        $e.Graphics.Clear($script:SwsdPalette.DisabledBg)
        $pen = New-Object Drawing.Pen($script:SwsdPalette.Border)
        $e.Graphics.DrawRectangle($pen, 0, 0, $rect.Width - 1, $rect.Height - 1)
        $pen.Dispose()
        [Windows.Forms.TextRenderer]::DrawText($e.Graphics, $sender.Text, $sender.Font, $rect, $script:SwsdPalette.DisabledFg, [Windows.Forms.TextFormatFlags]'HorizontalCenter, VerticalCenter, SingleLine')
    })
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
    $l.Font = New-Object Drawing.Font('Segoe UI Semibold', (ScaleFont 9))
    $l.ForeColor = $script:SwsdPalette.TextPrimary
    return $l
}

# Helper: themed 1px border host so inputs never show the default light 3D border.
function New-SwsdComboHost([Windows.Forms.ComboBox]$Combo) {
    $hostPanel = New-Object Windows.Forms.Panel
    $hostPanel.BackColor = $script:SwsdPalette.InputBg
    $hostPanel.Padding = New-Object Windows.Forms.Padding(1)
    $hostPanel.Height = $Combo.PreferredSize.Height
    $hostPanel.Add_Paint({
        param($sender, $e)
        $pen = New-Object Drawing.Pen($script:SwsdPalette.InputBorder)
        $e.Graphics.DrawRectangle($pen, 0, 0, $sender.Width - 1, $sender.Height - 1)
        $pen.Dispose()
    })
    $clip = New-Object Windows.Forms.Panel
    $clip.Dock = 'Fill'
    $clip.BackColor = $script:SwsdPalette.InputBg
    $hostPanel.Controls.Add($clip)
    $Combo.Margin = New-Object Windows.Forms.Padding(0)
    $Combo.Location = New-Object Drawing.Point(-1, -1)
    $clip.Controls.Add($Combo)
    $clip.Add_Resize({ param($sender, $e) foreach ($c in $sender.Controls) { $c.Width = $sender.Width + 2 } })
    $hostPanel.Height = $Combo.Height
    return ,$hostPanel
}
function New-SwsdInputHost([Windows.Forms.Control]$Control, [int]$Inset = 1) {
    $hostPanel = New-Object Windows.Forms.Panel
    $hostPanel.BackColor = $script:SwsdPalette.InputBg
    $hostPanel.Padding = New-Object Windows.Forms.Padding($Inset)
    $hostPanel.Height = $Control.PreferredSize.Height + 2 * $Inset
    $hostPanel.Add_Paint({
        param($sender, $e)
        $pen = New-Object Drawing.Pen($script:SwsdPalette.InputBorder)
        $e.Graphics.DrawRectangle($pen, 0, 0, $sender.Width - 1, $sender.Height - 1)
        $pen.Dispose()
    })
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
            $iconLabel.Font = New-Object Drawing.Font($script:SwsdIconFont, (ScaleFont 12))
            $iconLabel.Text = Get-SwsdIconGlyph $IconName
            $iconLabel.ForeColor = $script:SwsdAccentColor
            $iconLabel.Margin = New-Object Windows.Forms.Padding(0, 0, (ScalePx 8), 0)
            $iconLabel.Anchor = 'Left'
            $titleRow.Controls.Add($iconLabel, 0, 0)
        }

        $sectionTitle = New-Object Windows.Forms.Label
        $sectionTitle.AutoSize = $true
        $sectionTitle.Text = $Title
        $sectionTitle.Font = New-Object Drawing.Font('Segoe UI Semibold', (ScaleFont 11))
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
$headerIcon.Font = New-Object Drawing.Font($headerIconFont, (ScaleFont 22))
$headerIcon.Text = Get-SwsdIconGlyph 'SolarWinds'
$headerIcon.ForeColor = $script:SwsdAccentColor
$headerIcon.Margin = New-Object Windows.Forms.Padding(0, 0, (ScalePx 10), 0)
$headerIcon.Anchor = 'Left'
$headerPanel.Controls.Add($headerIcon, 0, 0)
$headerPanel.SetRowSpan($headerIcon, 2)

$titleLabel = New-Object Windows.Forms.Label
$titleLabel.AutoSize = $true
$titleLabel.Text = 'SolarWinds Service Desk'
$titleLabel.Font = New-Object Drawing.Font('Segoe UI Semibold', (ScaleFont 16))
$titleLabel.ForeColor = $script:SwsdPalette.TextPrimary
$titleLabel.Anchor = 'Left,Bottom'
$headerPanel.Controls.Add($titleLabel, 1, 0)

$subtitleLabel = New-Object Windows.Forms.Label
$subtitleLabel.AutoSize = $true
$subtitleLabel.Text = 'Connect your own SolarWinds account. Your token stays in Windows Credential Manager on this computer.'
$subtitleLabel.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9))
$subtitleLabel.ForeColor = $script:SwsdPalette.TextSecondary
$subtitleLabel.Anchor = 'Left,Top'
$subtitleLabel.MaximumSize = New-Object Drawing.Size((ScalePx $script:SwsdContentWidth), 0)
$headerPanel.Controls.Add($subtitleLabel, 1, 1)

$rootPanel.Controls.Add($headerPanel, 0, 0)

# Card 1: Install tools
$card1 = New-SwsdCard '1. Install tools' 'Tools'
$installDesc = New-Object Windows.Forms.Label
$installDesc.AutoSize = $true
$installDesc.Text = 'Requires Node.js 24.15 or newer within version 24.'
$installDesc.ForeColor = $script:SwsdPalette.TextSecondary
$installDesc.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9))
$installDesc.MaximumSize = New-Object Drawing.Size((ScalePx $script:SwsdContentWidth), 0)
Add-CardRow $card1 $installDesc

$install = New-SwsdButton 'Install / repair tools' $true
$install.Anchor = 'Top,Left'
Add-CardRow $card1 $install
$rootPanel.Controls.Add($card1, 0, 1)

# Card 2: Region + token
$card2 = New-SwsdCard '2. Connect your account' 'Key'

$region = New-Object SwsdDesktop.ThemedComboBox
$region.BorderColor = $script:SwsdPalette.InputBorder; $region.ArrowColor = $script:SwsdPalette.TextSecondary
$region.DropDownStyle = 'DropDownList'
$region.FlatStyle = 'Flat'
$region.BackColor = $script:SwsdPalette.InputBg
$region.ForeColor = $script:SwsdPalette.TextPrimary
$region.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 10))
$region.Height = ScalePx 30
$region.DrawMode = 'OwnerDrawFixed'
$region.Add_DrawItem({
    param($sender, $e)
    if ($e.Index -lt 0) { return }
    $bg = if (($e.State -band [Windows.Forms.DrawItemState]::Selected) -eq [Windows.Forms.DrawItemState]::Selected) {
        $script:SwsdAccentColor
    } else { $script:SwsdPalette.InputBg }
    $fg = if (($e.State -band [Windows.Forms.DrawItemState]::Selected) -eq [Windows.Forms.DrawItemState]::Selected) {
        Get-SwsdContrastColor $script:SwsdAccentColor
    } elseif (-not $sender.Enabled) { $script:SwsdPalette.TextSecondary } else { $script:SwsdPalette.TextPrimary }
    $e.Graphics.FillRectangle((New-Object Drawing.SolidBrush($bg)), $e.Bounds)
    $text = $sender.GetItemText($sender.Items[$e.Index])
    $e.Graphics.DrawString($text, $sender.Font, (New-Object Drawing.SolidBrush($fg)), $e.Bounds.X + 2, $e.Bounds.Y + 2)
})
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
$tokenBox.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 10))
$tokenBox.Height = ScalePx 30
$tokenBox.Add_EnabledChanged({
    if (-not $tokenBox.Enabled) { $tokenBox.ForeColor = $script:SwsdPalette.TextSecondary }
    else { $tokenBox.ForeColor = $script:SwsdPalette.TextPrimary }
})
Add-CardRow $card2 (New-SwsdFieldLabel 'API token')
Add-CardRow $card2 (New-SwsdInputHost $tokenBox (ScalePx 6))
try { [void][SwsdDesktop.Windows]::SendMessage($tokenBox.Handle, 0x1501, [IntPtr]1, 'Paste your API token') } catch {}

$tokenHint = New-Object Windows.Forms.Label
$tokenHint.AutoSize = $true
$tokenHint.Text = 'Saved tokens are never displayed. Paste a new token only to add or replace it.'
$tokenHint.ForeColor = $script:SwsdPalette.TextSecondary
$tokenHint.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9))
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
$rootPanel.Controls.Add($card2, 0, 2)

# Card 3: Profile selection
$card3 = New-SwsdCard '3. Choose your tools' 'Profile'

$profileDesc = New-Object Windows.Forms.Label
$profileDesc.AutoSize = $true
$profileDesc.Text = 'You can change this later without re-entering a token.'
$profileDesc.ForeColor = $script:SwsdPalette.TextSecondary
$profileDesc.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9))
$profileDesc.MaximumSize = New-Object Drawing.Size((ScalePx $script:SwsdContentWidth), 0)
Add-CardRow $card3 $profileDesc

$profile = New-Object SwsdDesktop.ThemedComboBox
$profile.BorderColor = $script:SwsdPalette.InputBorder; $profile.ArrowColor = $script:SwsdPalette.TextSecondary
$profile.DropDownStyle = 'DropDownList'
$profile.AccessibleName = 'SWSD profile'
$profile.FlatStyle = 'Flat'
$profile.BackColor = $script:SwsdPalette.InputBg
$profile.ForeColor = $script:SwsdPalette.TextPrimary
$profile.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 10))
$profile.Height = ScalePx 30
$profile.DrawMode = 'OwnerDrawFixed'
$profile.Add_DrawItem({
    param($sender, $e)
    if ($e.Index -lt 0) { return }
    $bg = if (($e.State -band [Windows.Forms.DrawItemState]::Selected) -eq [Windows.Forms.DrawItemState]::Selected) {
        $script:SwsdAccentColor
    } else { $script:SwsdPalette.InputBg }
    $fg = if (($e.State -band [Windows.Forms.DrawItemState]::Selected) -eq [Windows.Forms.DrawItemState]::Selected) {
        Get-SwsdContrastColor $script:SwsdAccentColor
    } elseif (-not $sender.Enabled) { $script:SwsdPalette.TextSecondary } else { $script:SwsdPalette.TextPrimary }
    $e.Graphics.FillRectangle((New-Object Drawing.SolidBrush($bg)), $e.Bounds)
    $text = $sender.GetItemText($sender.Items[$e.Index])
    $e.Graphics.DrawString($text, $sender.Font, (New-Object Drawing.SolidBrush($fg)), $e.Bounds.X + 2, $e.Bounds.Y + 2)
})
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
$profileDescription.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9))
Add-CardRow $card3 $profileDescription
$profile.Add_SelectedIndexChanged({ $profileDescription.Text = $script:SwsdProfiles[$profile.SelectedIndex].description })

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
$currentProfile.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9))
$currentProfile.Anchor = 'Left'
$currentProfile.Margin = New-Object Windows.Forms.Padding((ScalePx 12), 0, 0, 0)
$currentProfile.AutoSize = $false
$currentProfile.TextAlign = 'MiddleLeft'
$currentProfile.Size = New-Object Drawing.Size(([Windows.Forms.TextRenderer]::MeasureText('Saved profile: Administrator (all tools)', $currentProfile.Font).Width), (ScalePx $script:SwsdButtonMinHeight))
$profileButtonRow.Controls.Add($currentProfile)

Add-CardRow $card3 $profileButtonRow
$rootPanel.Controls.Add($card3, 0, 3)

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
$status.Font = New-Object Drawing.Font('Segoe UI', (ScaleFont 9.5))
$statusPanel.Controls.Add($status)

$rootPanel.Controls.Add($statusPanel, 0, 4)

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
function Update-SwsdFormSize {
    try {
        $scaledContentWidth = ScalePx $script:SwsdContentWidth

        # First pass: set wrapping widths generously so GetPreferredSize sees unwrapped text
        foreach ($lbl in @($subtitleLabel, $installDesc, $tokenHint, $profileDesc, $profileDescription, $status)) {
            $lbl.MaximumSize = New-Object Drawing.Size(0, 0)
        }

        # Force layout recalculation
        $form.PerformLayout()
        $rootPanel.PerformLayout()

        # Get preferred size without width constraint to see natural content width
        $preferred = $rootPanel.GetPreferredSize([Drawing.Size]::Empty)

        # Use the larger of natural width and target content width
        $targetClientWidth = [Math]::Max($preferred.Width, $scaledContentWidth)

        # Now set wrapping widths based on target width
        $availableCardWidth = $targetClientWidth - (2 * (ScalePx $script:SwsdRootPaddingH)) - (2 * (ScalePx $script:SwsdCardPaddingH))
        if ($availableCardWidth -lt 100) { $availableCardWidth = $scaledContentWidth }
        $subtitleAvailable = $targetClientWidth - (2 * (ScalePx $script:SwsdRootPaddingH)) - (ScalePx 40)
        if ($subtitleAvailable -lt 100) { $subtitleAvailable = $availableCardWidth }
        $subtitleLabel.MaximumSize = New-Object Drawing.Size($subtitleAvailable, 0)
        foreach ($lbl in @($installDesc, $tokenHint, $profileDesc, $profileDescription, $status)) {
            $lbl.MaximumSize = New-Object Drawing.Size($availableCardWidth, 0)
        }

        # Re-layout with wrapping applied
        $form.PerformLayout()
        $rootPanel.PerformLayout()
        $preferredWrapped = $rootPanel.GetPreferredSize([Drawing.Size]::Empty)

        $screen = [Windows.Forms.Screen]::FromPoint([Windows.Forms.Cursor]::Position).WorkingArea
        $margin = ScalePx $script:SwsdScreenMargin
        $maxWidth = $screen.Width - (2 * $margin)
        $maxHeight = $screen.Height - (2 * $margin)

        $frameWidth = $form.Width - $form.ClientSize.Width
        $frameHeight = $form.Height - $form.ClientSize.Height

        $finalClientWidth = [Math]::Max($targetClientWidth, $preferredWrapped.Width)
        $finalClientHeight = $preferredWrapped.Height

        $targetWidth = $finalClientWidth + $frameWidth
        $targetHeight = $finalClientHeight + $frameHeight

        if ($targetWidth -gt $maxWidth) { $targetWidth = $maxWidth }
        if ($targetHeight -gt $maxHeight) { $targetHeight = $maxHeight }

        $form.MinimumSize = New-Object Drawing.Size($targetWidth, $targetHeight)
        $form.Size = New-Object Drawing.Size($targetWidth, $targetHeight)

        # Force layout after sizing
        $form.PerformLayout()
        $rootPanel.PerformLayout()

        $needsScroll = $finalClientHeight -gt ($targetHeight - $frameHeight)
        $rootPanel.AutoScroll = $needsScroll

        $centerX = $screen.Left + [int](($screen.Width - $targetWidth) / 2)
        $centerY = $screen.Top + [int](($screen.Height - $targetHeight) / 2)
        $form.Location = New-Object Drawing.Point($centerX, $centerY)

        # Final pass: update wrapping widths based on actual client width
        Update-SwsdWrappingWidths

        # Re-layout one more time after wrapping width update
        $form.PerformLayout()
        $rootPanel.PerformLayout()
    } catch {}
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

        foreach ($lbl in @($installDesc, $tokenHint, $profileDesc, $profileDescription, $status)) {
            $lbl.MaximumSize = New-Object Drawing.Size($availableCardWidth, 0)
        }
    } catch {}
}

$form.Add_Load({ Update-SwsdFormSize })
$form.Add_Resize({ Update-SwsdWrappingWidths })

# Handle PerMonitorV2 DPI changes
try {
    $form.Add_DpiChanged({
        param($sender, $e)
        try {
            if ($e.SuggestedRectangle -ne $null) {
                $form.Bounds = $e.SuggestedRectangle
            }
            Update-SwsdFormSize
        } catch {}
    })
} catch {}

function Invoke-SetupAction([scriptblock]$Action) {
    $form.UseWaitCursor = $true
    foreach ($button in @($install, $save, $test, $remove, $saveProfile)) { $button.Enabled = $false }
    Reset-SwsdStatus
    $status.Text = 'Working... please wait.'
    $form.Refresh()
    try { & $Action } catch {
        Set-SwsdStatus -Kind error -Text $_.Exception.Message
    } finally {
        $form.UseWaitCursor = $false
        foreach ($button in @($install, $save, $test, $remove, $saveProfile)) { $button.Enabled = $true }
    }
}
$install.Add_Click({ Invoke-SetupAction {
    $sourceRoot = Split-Path $PSScriptRoot
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'runtime\package.json')) { $sourceRoot = $PSScriptRoot }
    # Installed settings windows already reside beside the launcher; only repair the runtime there.
    if ($sourceRoot -eq $PSScriptRoot) {
        $stage = Join-Path $script:SwsdHome 'repair-source'
        New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
        foreach ($name in @('Common.ps1','Manage-Swsd.ps1','Start-Swsd.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage 'scripts') -Force }
        New-Item -ItemType Directory -Path (Join-Path $stage 'runtime') -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime\package.json'),(Join-Path $PSScriptRoot 'runtime\package-lock.json') -Destination (Join-Path $stage 'runtime') -Force
        $sourceRoot = $stage
    }
    Install-SwsdTools -SourceRoot $sourceRoot
    Set-SwsdStatus -Kind success -Text 'Tools installed. Test and save your token next. This window is also available from the Windows Start menu.'
} })
$save.Add_Click({ Invoke-SetupAction {
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
    } finally { $secret = $null }
} })
$test.Add_Click({ Invoke-SetupAction {
    $secret = [SwsdDesktop.Credentials]::Read($script:SwsdCredentialTarget)
    try {
        if ([string]::IsNullOrWhiteSpace($secret)) { throw 'No token is saved. Paste one into the masked field, then select Test and save token.' }
        Test-SwsdToken -Token $secret -BaseUrl (Get-SwsdSettings).baseUrl
        Set-SwsdStatus -Kind success -Text 'Saved connection verified. SolarWinds accepted the token and allowed the read-only check.'
    } finally { $secret = $null }
} })
$remove.Add_Click({
    $choice = [Windows.Forms.MessageBox]::Show('Remove this computer''s saved SWSD token? Fully quit ChatGPT afterwards to end running connections. This does not revoke the token in SolarWinds.', 'Remove saved token', 'YesNo', 'Question')
    if ($choice -eq 'Yes') { Invoke-SetupAction {
        [SwsdDesktop.Credentials]::Remove($script:SwsdCredentialTarget)
        $tokenBox.Clear()
        Set-SwsdStatus -Kind info -Text 'Saved token removed. Fully quit ChatGPT to stop running connections. Revoke the token in SolarWinds if needed.'
    } }
})
$saveProfile.Add_Click({ Invoke-SetupAction {
    $selection = $script:SwsdProfiles[$profile.SelectedIndex]
    Save-SwsdProfile -Profile $selection.id
    $currentProfile.Text = 'Saved profile: ' + $selection.name
    Set-SwsdStatus -Kind success -Text 'Profile saved. Fully quit and reopen the desktop app, then start a new chat to load this tool set. Your saved token is unchanged.'
} })
if ($ValidateWindow) {
    # Visible lifecycle probe: no token entry, installation, settings or credential actions.
    foreach ($control in @($install,$region,$tokenBox,$save,$test,$remove,$profile,$saveProfile)) { $control.Enabled = $false }
    $script:SwsdWindowResult = $null
    $probe = New-Object Windows.Forms.Timer
    $probe.Interval = 200
    $probe.Add_Tick({
        $probe.Stop()
        try {
        $script:SwsdLayoutFailures = @()
        $script:SwsdLayoutNotes = @()

        # Button rows must be pixel-identical: same Top and Height for every button (tolerance 0),
        # and equal widths inside a row of action buttons.
        foreach ($row in @($buttonRow2, $profileButtonRow)) {
            $rowButtons = @($row.Controls | Where-Object { $_ -is [Windows.Forms.Button] -and $_.Visible })
            if ($rowButtons.Count -lt 1) { continue }
            $tops = @($rowButtons | ForEach-Object { $_.Top } | Sort-Object -Unique)
            $heights = @($rowButtons | ForEach-Object { $_.Height } | Sort-Object -Unique)
            $widths = @($rowButtons | ForEach-Object { $_.Width } | Sort-Object -Unique)
            if ($tops.Count -ne 1) { $script:SwsdLayoutFailures += "Button row tops differ: $($tops -join ',')" }
            if ($heights.Count -ne 1) { $script:SwsdLayoutFailures += "Button row heights differ: $($heights -join ',')" }
            if ($widths.Count -ne 1) { $script:SwsdLayoutFailures += "Button row widths differ: $($widths -join ',')" }
        }
        $allHeights = @(@($install, $save, $test, $remove, $saveProfile) | ForEach-Object { $_.Height } | Sort-Object -Unique)
        if ($allHeights.Count -ne 1) { $script:SwsdLayoutFailures += "Button heights differ across cards: $($allHeights -join ',')" }

        $formClientScreen = $form.RectangleToScreen($form.ClientRectangle)
        $workingArea = [Windows.Forms.Screen]::FromControl($form).WorkingArea

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

        # Window fits working area check
        $formScreen = $form.RectangleToScreen($form.ClientRectangle)
        if (-not $workingArea.Contains($formScreen)) {
            $script:SwsdLayoutFailures += "Window extends outside working area"
        }

        $script:SwsdWindowResult = @{
            visible = $form.Visible
            foreground = ([SwsdDesktop.Windows]::GetForegroundWindow() -eq $form.Handle)
            foregroundAvailable = ([SwsdDesktop.Windows]::GetForegroundWindow() -ne [IntPtr]::Zero)
            behindForeground = [SwsdDesktop.Windows]::IsBehindForeground($form.Handle)
            alwaysOnTop = $form.TopMost
            presentationCount = $script:SwsdPresentationCount
            consoleVisible = [SwsdDesktop.Windows]::IsWindowVisible([SwsdDesktop.Windows]::GetConsoleWindow())
            tokenEntryEnabled = $tokenBox.Enabled
            layoutFailures = $script:SwsdLayoutFailures
            layoutNotes = $script:SwsdLayoutNotes
        }
        } catch {
            $script:SwsdWindowResult = @{ error = $_.Exception.Message }
        }
    })
    $close = New-Object Windows.Forms.Timer
    $close.Interval = $WindowTestSeconds * 1000
    $close.Add_Tick({ $close.Stop(); $form.Close() })
    $form.Add_Shown({ $probe.Start(); $close.Start() })
    try {
        [void]$form.ShowDialog()
        $script:SwsdWindowResult | ConvertTo-Json
        if (-not $script:SwsdWindowResult -or -not $script:SwsdWindowResult.visible -or
            -not $script:SwsdWindowResult.foregroundAvailable -or $script:SwsdWindowResult.behindForeground -or
            $script:SwsdWindowResult.alwaysOnTop -or
            $script:SwsdPresentationCount -ne 1 -or $script:SwsdWindowResult.consoleVisible -or
            $script:SwsdWindowResult.tokenEntryEnabled) { throw 'Setup window presentation check failed.' }
        if ($script:SwsdWindowResult.layoutFailures -and $script:SwsdWindowResult.layoutFailures.Count -gt 0) {
            $failureList = ($script:SwsdWindowResult.layoutFailures -join '; ')
            throw "Layout validation failed: $failureList"
        }
    } finally {
        $probe.Dispose(); $close.Dispose()
        $tokenBox.Clear(); $form.Dispose()
    }
    exit 0
} elseif ($ValidateUi) {
    try {
        if (-not $tokenBox.UseSystemPasswordChar) { throw 'Token field must be masked.' }
        if ($profile.Items.Count -ne 5) { throw 'Five profile choices are required.' }
        if ($profile.SelectedItem -ne 'Agent') { throw 'New installations must default to Agent.' }
        $onClick = $saveProfile.GetType().GetMethod('OnClick', [Reflection.BindingFlags]'Instance,NonPublic')
        foreach ($index in 0..4) {
            $profile.SelectedIndex = $index
            $onClick.Invoke($saveProfile, @([EventArgs]::Empty))
            if ((Get-SwsdSettings).profile -ne $script:SwsdProfiles[$index].id) { throw 'Profile button failed to persist selection.' }
            if ($profileDescription.Text -ne $script:SwsdProfiles[$index].description) { throw 'Profile description did not update.' }
            if ($status.Text -notlike '*Profile saved.*') { throw 'Profile save did not display success and restart guidance.' }
        }
        Write-Output 'PASS: masked entry, Agent default, all five dropdown choices, actual Save profile event, persistence, descriptions, and restart guidance.'
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
