$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../../plugins/swsd/scripts/Common.ps1')

# Independent WCAG 2.2 calculation: do not use the production contrast helpers.
# https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
function Measure-Luminance([string]$Hex) {
    $rgb=@(1,3,5 | ForEach-Object {[Convert]::ToByte($Hex.Substring($_,2),16)/255.0})
    $linear=@($rgb | ForEach-Object {if ($_ -le 0.04045) {$_/12.92} else {[Math]::Pow(($_+0.055)/1.055,2.4)}})
    return 0.2126*$linear[0]+0.7152*$linear[1]+0.0722*$linear[2]
}
function Assert-Contrast([string]$Theme,[string]$Role,[string]$Foreground,[string]$Background,[double]$Minimum=4.5) {
    $a=Measure-Luminance $Foreground; $b=Measure-Luminance $Background
    $ratio=([Math]::Max($a,$b)+0.05)/([Math]::Min($a,$b)+0.05)
    if ($ratio -lt $Minimum) {throw "$Theme $Role is $ratio`:1 ($Foreground on $Background); needs $Minimum`:1."}
    return $ratio
}
$null=Assert-Contrast reference black-white '#000000' '#ffffff' 21
$source=Get-Content (Join-Path $PSScriptRoot 'fixtures/ttui-themes.rs') -Raw -Encoding UTF8
$rows=@([regex]::Matches($source,'\w+, "([^\"]+)", \[([^\]]+)\];') | Where-Object {$_.Groups[1].Value -notlike 'T-TUI*'})
if ($rows.Count -ne 22 -or $script:SwsdThemes.Count -ne 25) {throw 'Expected 22 named themes plus Match Windows, Light and Dark.'}
foreach ($row in $rows) {
    $name=$row.Groups[1].Value
    $theme=@($script:SwsdThemes.Values | Where-Object {$_.name.Replace('Ros'+[char]0xe9,'Rose') -eq $name})
    if ($theme.Count -ne 1) {throw "Missing or duplicated source palette: $name"}
    $colors=@($row.Groups[2].Value.Split(',') | ForEach-Object {'#'+$_.Substring(2)})
    if (($theme[0].colors -join ',') -cne ($colors -join ',')) {throw "Source palette changed: $name"}
}
foreach ($id in $script:SwsdThemes.Keys | Where-Object {$_ -ne 'system'}) {
    $p=Get-SwsdThemePalette $id
    $ratios=@()
    foreach ($surface in @('Canvas','Card','Control','Flyout','IconBackground','WashLeft','WashRight')) {
        $ratios+=Assert-Contrast $id "Text/$surface" $p.Text $p[$surface]
    }
    foreach ($surface in @('Canvas','Card','Control','Flyout','IconBackground')) {
        $ratios+=Assert-Contrast $id "Muted/$surface" $p.Muted $p[$surface]
        foreach ($kind in @('Accent','Success','Error','Warning')) {
            $ratios+=Assert-Contrast $id "$($kind)Foreground/$surface" $p[$kind+'Foreground'] $p[$surface]
        }
    }
    $ratios+=Assert-Contrast $id 'SelectedText/Selected' $p.SelectedText $p.Selected
    $ratios+=Assert-Contrast $id 'AccentText/Accent' $p.AccentText $p.Accent
    $ratios+=Assert-Contrast $id 'AccentChipText/AccentBackground' $p.AccentChipText $p.AccentBackground
    foreach ($kind in @('Success','Error','Warning')) {
        # These are the actual chip/banner text resources, derived only when needed.
        $ratios+=Assert-Contrast $id "$($kind)Text/$($kind)Background" $p[$kind+'Text'] $p[$kind+'Background']
    }
    foreach ($surface in @('Canvas','Card','Control')) {$null=Assert-Contrast $id "ControlBorder/$surface" $p.ControlBorder $p[$surface] 3}
    $raw=$script:SwsdThemes[$id].colors
    foreach ($mapping in @(@('Canvas',0),@('Card',1),@('Text',2),@('Border',4),@('Accent',5),@('Selected',6),@('Success',8),@('Error',9))) {
        if ($id -eq 'solarized-light' -and $mapping[0] -eq 'Text') {continue} # Source fg/panel = 4.392:1.
        if ($p[$mapping[0]] -cne $raw[$mapping[1]]) {throw "$id changed a source color: $($mapping[0])"}
    }
    Write-Output ('PASS: {0} - minimum text contrast {1:F3}:1; control boundaries >= 3:1.' -f $id,($ratios | Measure-Object -Minimum).Minimum)
}
Write-Output 'PASS: 24 palettes preserve source colors; body, muted, selected, links, buttons, chips and banners meet WCAG AA.'
