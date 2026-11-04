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

$form = New-Object Windows.Forms.Form
$form.Text = 'SolarWinds Service Desk Setup'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'Sizable'
$form.MaximizeBox = $true
$form.MinimizeBox = $true
$form.MinimumSize = New-Object Drawing.Size(520, 580)
$form.AutoSize = $false
$form.AutoScaleMode = 'Dpi'
$form.Font = New-Object Drawing.Font('Segoe UI', 10)
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
$rootPanel.Padding = New-Object Windows.Forms.Padding(20, 16, 20, 16)
$rootPanel.ColumnCount = 1
$rootPanel.RowCount = 5
$rootPanel.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Percent', 100)))
$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$rootPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('Percent', 100)))
$rootPanel.AutoScroll = $true
$form.Controls.Add($rootPanel)

# Compute initial window size from content, capped to 90% of working area
$form.Add_Load({
    try {
        $preferred = $rootPanel.GetPreferredSize([Drawing.Size]::Empty)
        $screen = [Windows.Forms.Screen]::FromControl($form).WorkingArea
        $maxWidth = [int]($screen.Width * 0.9)
        $maxHeight = [int]($screen.Height * 0.9)
        $frameWidth = $form.Width - $form.ClientSize.Width
        $frameHeight = $form.Height - $form.ClientSize.Height
        $targetWidth = [Math]::Max($form.MinimumSize.Width, [Math]::Min($preferred.Width + $frameWidth + 40, $maxWidth))
        $targetHeight = [Math]::Max($form.MinimumSize.Height, [Math]::Min($preferred.Height + $frameHeight + 40, $maxHeight))
        $form.Size = New-Object Drawing.Size($targetWidth, $targetHeight)
    } catch {}
})

# Header band
$headerPanel = New-Object Windows.Forms.TableLayoutPanel
$headerPanel.Dock = 'Fill'
$headerPanel.AutoSize = $true
$headerPanel.ColumnCount = 2
$headerPanel.RowCount = 2
$headerPanel.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('AutoSize')))
$headerPanel.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Percent', 100)))
$headerPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$headerPanel.RowStyles.Add((New-Object Windows.Forms.RowStyle('AutoSize')))
$headerPanel.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 12)

$headerIcon = New-Object Windows.Forms.Label
$headerIcon.AutoSize = $true
$headerIconFont = if ($script:SwsdIconFont) { $script:SwsdIconFont } else { 'Segoe UI' }
$headerIcon.Font = New-Object Drawing.Font($headerIconFont, 22)
$headerIcon.Text = Get-SwsdIconGlyph 'SolarWinds'
$headerIcon.ForeColor = $script:SwsdAccentColor
$headerIcon.Margin = New-Object Windows.Forms.Padding(0, 0, 10, 0)
$headerIcon.Anchor = 'Left'
$headerPanel.Controls.Add($headerIcon, 0, 0)
$headerPanel.SetRowSpan($headerIcon, 2)

$titleLabel = New-Object Windows.Forms.Label
$titleLabel.AutoSize = $true
$titleLabel.Text = 'SolarWinds Service Desk'
$titleLabel.Font = New-Object Drawing.Font('Segoe UI Semibold', 16)
$titleLabel.ForeColor = $script:SwsdPalette.TextPrimary
$titleLabel.Anchor = 'Left,Bottom'
$headerPanel.Controls.Add($titleLabel, 1, 0)

$subtitleLabel = New-Object Windows.Forms.Label
$subtitleLabel.AutoSize = $true
$subtitleLabel.Text = 'Connect your own SolarWinds account. Your token stays in Windows Credential Manager on this computer.'
$subtitleLabel.Font = New-Object Drawing.Font('Segoe UI', 9)
$subtitleLabel.ForeColor = $script:SwsdPalette.TextSecondary
$subtitleLabel.Anchor = 'Left,Top'
$subtitleLabel.MaximumSize = New-Object Drawing.Size(500, 0)
$headerPanel.Controls.Add($subtitleLabel, 1, 1)

$rootPanel.Controls.Add($headerPanel, 0, 0)

# Helper: create a card panel with title; stores inner layout in card.Tag
function New-SwsdCard([string]$Title, [string]$IconName) {
    $card = New-Object Windows.Forms.Panel
    $card.BackColor = $script:SwsdPalette.CardBg
    $card.Padding = New-Object Windows.Forms.Padding(16, 12, 16, 14)
    $card.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 10)
    $card.AutoSize = $true
    $card.AutoSizeMode = 'GrowAndShrink'
    $card.Anchor = 'Top,Left,Right'

    $innerLayout = New-Object Windows.Forms.TableLayoutPanel
    $innerLayout.Dock = 'Fill'
    $innerLayout.AutoSize = $true
    $innerLayout.ColumnCount = 1
    [void]$innerLayout.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Percent', 100)))
    $innerLayout.RowCount = 1
    $card.Controls.Add($innerLayout)
    $card.Tag = $innerLayout

    if ($Title) {
        $titleRow = New-Object Windows.Forms.TableLayoutPanel
        $titleRow.AutoSize = $true
        $titleRow.Dock = 'Fill'
        $titleRow.ColumnCount = 2
        [void]$titleRow.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('AutoSize')))
        [void]$titleRow.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle('Percent', 100)))
        $titleRow.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 8)

        if ($IconName -and $script:SwsdIconFont) {
            $iconLabel = New-Object Windows.Forms.Label
            $iconLabel.AutoSize = $true
            $iconLabel.Font = New-Object Drawing.Font($script:SwsdIconFont, 12)
            $iconLabel.Text = Get-SwsdIconGlyph $IconName
            $iconLabel.ForeColor = $script:SwsdAccentColor
            $iconLabel.Margin = New-Object Windows.Forms.Padding(0, 0, 8, 0)
            $iconLabel.Anchor = 'Left'
            $titleRow.Controls.Add($iconLabel, 0, 0)
        }

        $sectionTitle = New-Object Windows.Forms.Label
        $sectionTitle.AutoSize = $true
        $sectionTitle.Text = $Title
        $sectionTitle.Font = New-Object Drawing.Font('Segoe UI Semibold', 11)
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
    $Control.Anchor = 'Top,Left,Right'
    $Control.Margin = New-Object Windows.Forms.Padding(0, 2, 0, 2)
    $layout.Controls.Add($Control, 0, $rowIndex)
}

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
    $btn.FlatAppearance.BorderSize = 1
    $btn.AutoSize = $true
    $btn.AutoSizeMode = 'GrowAndShrink'
    $btn.Padding = New-Object Windows.Forms.Padding(14, 4, 14, 4)
    $btn.MinimumSize = New-Object Drawing.Size(0, 32)
    $btn.Cursor = [Windows.Forms.Cursors]::Hand
    $btn.Font = New-Object Drawing.Font('Segoe UI', 9.5)
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

# Card 1: Install tools
$card1 = New-SwsdCard '1. Install tools' 'Tools'
$installDesc = New-Object Windows.Forms.Label
$installDesc.AutoSize = $true
$installDesc.Text = 'Requires Node.js 24.15 or newer within version 24.'
$installDesc.ForeColor = $script:SwsdPalette.TextSecondary
$installDesc.Font = New-Object Drawing.Font('Segoe UI', 9)
Add-CardRow $card1 $installDesc

$install = New-SwsdButton 'Install / repair tools' $true
$install.Anchor = 'Top,Left'
Add-CardRow $card1 $install
$rootPanel.Controls.Add($card1, 0, 1)

# Card 2: Region + token
$card2 = New-SwsdCard '2. Connect your account' 'Key'

$region = New-Object Windows.Forms.ComboBox
$region.DropDownStyle = 'DropDownList'
$region.FlatStyle = 'Flat'
$region.BackColor = $script:SwsdPalette.InputBg
$region.ForeColor = $script:SwsdPalette.TextPrimary
$region.Font = New-Object Drawing.Font('Segoe UI', 10)
$region.Height = 30
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
Add-CardRow $card2 $region

$tokenBox = New-Object Windows.Forms.TextBox
$tokenBox.UseSystemPasswordChar = $true
$tokenBox.BackColor = $script:SwsdPalette.InputBg
$tokenBox.ForeColor = $script:SwsdPalette.TextPrimary
$tokenBox.BorderStyle = 'FixedSingle'
$tokenBox.Font = New-Object Drawing.Font('Segoe UI', 10)
$tokenBox.Height = 30
$tokenBox.Add_EnabledChanged({
    if (-not $tokenBox.Enabled) { $tokenBox.ForeColor = $script:SwsdPalette.TextSecondary }
    else { $tokenBox.ForeColor = $script:SwsdPalette.TextPrimary }
})
Add-CardRow $card2 $tokenBox

$tokenHint = New-Object Windows.Forms.Label
$tokenHint.AutoSize = $true
$tokenHint.Text = 'Saved tokens are never displayed. Paste a new token only to add or replace it.'
$tokenHint.ForeColor = $script:SwsdPalette.TextSecondary
$tokenHint.Font = New-Object Drawing.Font('Segoe UI', 9)
Add-CardRow $card2 $tokenHint

$buttonRow2 = New-Object Windows.Forms.FlowLayoutPanel
$buttonRow2.AutoSize = $true
$buttonRow2.FlowDirection = 'LeftToRight'
$buttonRow2.WrapContents = $true
$buttonRow2.Anchor = 'Top,Left,Right'
$buttonRow2.Margin = New-Object Windows.Forms.Padding(0, 6, 0, 0)

$save = New-SwsdButton 'Test and save token' $true
$buttonRow2.Controls.Add($save)

$test = New-SwsdButton 'Test saved connection'
$test.Margin = New-Object Windows.Forms.Padding(6, 0, 0, 0)
$buttonRow2.Controls.Add($test)

$remove = New-SwsdButton 'Remove saved token'
$remove.Margin = New-Object Windows.Forms.Padding(6, 0, 0, 0)
$buttonRow2.Controls.Add($remove)

Add-CardRow $card2 $buttonRow2
$rootPanel.Controls.Add($card2, 0, 2)

# Card 3: Profile selection
$card3 = New-SwsdCard '3. Choose your tools' 'Profile'

$profileDesc = New-Object Windows.Forms.Label
$profileDesc.AutoSize = $true
$profileDesc.Text = 'You can change this later without re-entering a token.'
$profileDesc.ForeColor = $script:SwsdPalette.TextSecondary
$profileDesc.Font = New-Object Drawing.Font('Segoe UI', 9)
Add-CardRow $card3 $profileDesc

$profile = New-Object Windows.Forms.ComboBox
$profile.DropDownStyle = 'DropDownList'
$profile.AccessibleName = 'SWSD profile'
$profile.FlatStyle = 'Flat'
$profile.BackColor = $script:SwsdPalette.InputBg
$profile.ForeColor = $script:SwsdPalette.TextPrimary
$profile.Font = New-Object Drawing.Font('Segoe UI', 10)
$profile.Height = 30
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
Add-CardRow $card3 $profile

$profileDescription = New-Object Windows.Forms.Label
$profileDescription.AutoSize = $true
$profileDescription.MaximumSize = New-Object Drawing.Size(500, 0)
$profileDescription.Text = $script:SwsdProfiles[$profile.SelectedIndex].description
$profileDescription.ForeColor = $script:SwsdPalette.TextSecondary
$profileDescription.Font = New-Object Drawing.Font('Segoe UI', 9)
Add-CardRow $card3 $profileDescription
$profile.Add_SelectedIndexChanged({ $profileDescription.Text = $script:SwsdProfiles[$profile.SelectedIndex].description })

$profileButtonRow = New-Object Windows.Forms.FlowLayoutPanel
$profileButtonRow.AutoSize = $true
$profileButtonRow.FlowDirection = 'LeftToRight'
$profileButtonRow.WrapContents = $false
$profileButtonRow.Anchor = 'Top,Left,Right'
$profileButtonRow.Margin = New-Object Windows.Forms.Padding(0, 6, 0, 0)

$saveProfile = New-SwsdButton 'Save profile' $true
$profileButtonRow.Controls.Add($saveProfile)

$currentProfile = New-Object Windows.Forms.Label
$currentProfile.AutoSize = $true
$currentProfile.Text = 'Saved profile: ' + $script:SwsdProfiles[$profile.SelectedIndex].name
$currentProfile.ForeColor = $script:SwsdPalette.TextSecondary
$currentProfile.Font = New-Object Drawing.Font('Segoe UI', 9)
$currentProfile.Anchor = 'Left'
$currentProfile.Margin = New-Object Windows.Forms.Padding(12, 8, 0, 0)
$profileButtonRow.Controls.Add($currentProfile)

Add-CardRow $card3 $profileButtonRow
$rootPanel.Controls.Add($card3, 0, 3)

# Status area with chip support
$statusPanel = New-Object Windows.Forms.Panel
$statusPanel.Dock = 'Fill'
$statusPanel.AutoSize = $true
$statusPanel.Padding = New-Object Windows.Forms.Padding(4, 8, 4, 4)
$statusPanel.Anchor = 'Top,Left,Right'

$status = New-Object Windows.Forms.Label
$status.AutoSize = $true
$status.MaximumSize = New-Object Drawing.Size(550, 0)
$status.Text = 'Start with Install / repair tools. Then test and save your token. After setup, start a new chat.'
$status.ForeColor = $script:SwsdPalette.TextSecondary
$status.Font = New-Object Drawing.Font('Segoe UI', 9.5)
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
    $status.Padding = New-Object Windows.Forms.Padding(10, 6, 10, 6)
}

# Reset status to plain style
function Reset-SwsdStatus {
    $status.BackColor = [Drawing.Color]::Transparent
    $status.Padding = New-Object Windows.Forms.Padding(0)
    $status.ForeColor = $script:SwsdPalette.TextSecondary
}

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
        $script:SwsdWindowResult = @{
            visible = $form.Visible
            foreground = ([SwsdDesktop.Windows]::GetForegroundWindow() -eq $form.Handle)
            foregroundAvailable = ([SwsdDesktop.Windows]::GetForegroundWindow() -ne [IntPtr]::Zero)
            behindForeground = [SwsdDesktop.Windows]::IsBehindForeground($form.Handle)
            alwaysOnTop = $form.TopMost
            presentationCount = $script:SwsdPresentationCount
            consoleVisible = [SwsdDesktop.Windows]::IsWindowVisible([SwsdDesktop.Windows]::GetConsoleWindow())
            tokenEntryEnabled = $tokenBox.Enabled
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
